process.env.NODE_ENV = 'test';

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/index.ts';
import { getDb, closeDb, q, one, insert } from '../src/db/index.ts';
import { ensureSeeded } from '../src/db/seed.ts';
import { iepWindow, turning65Date, daysUntil65 } from '../src/services/enrollment.ts';
import { redactSensitive, needsLicensedAgent, schedulerBenefitFlags } from '../src/services/ai/guardrails.ts';
import { toE164, googleVoiceWebUrl, isWithinCallingHours } from '../src/services/phone.ts';
import type { Server } from 'node:http';

let server: Server;
let baseUrl: string;
let principalToken: string;
let adminToken: string;
let cooToken: string;
let schedulerToken: string;
let agentToken: string;

async function request(path: string, options: any = {}) {
  const headers: any = { 'Content-Type': 'application/json', ...(options.headers || {}) };
  if (options.token) headers['Authorization'] = `Bearer ${options.token}`;
  const res = await fetch(`${baseUrl}${path}`, {
    method: options.method || 'GET',
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const text = await res.text();
  let json: any;
  try { json = JSON.parse(text); } catch { json = text; }
  return { status: res.status, headers: res.headers, json };
}

describe('IWG CRM Full Test Suite', () => {
  before(async () => {
    await getDb();
    await ensureSeeded(true);
    const app = createApp();
    await new Promise<void>((resolve) => {
      server = app.listen(0, () => {
        const addr = server.address() as any;
        baseUrl = `http://localhost:${addr.port}`;
        resolve();
      });
    });

    // Login users to acquire tokens
    const princRes = await request('/api/auth/login', { method: 'POST', body: { email: 'king@iwillglobal.com', password: 'Heru5464' } });
    principalToken = princRes.json.token;

    const adminRes = await request('/api/auth/login', { method: 'POST', body: { email: 'admin@iwillglobal.com', password: 'Welcome123!' } });
    adminToken = adminRes.json.token;

    const cooRes = await request('/api/auth/login', { method: 'POST', body: { email: 'aneesha@iwillglobal.com', password: 'Welcome123!' } });
    cooToken = cooRes.json.token;

    const schRes = await request('/api/auth/login', { method: 'POST', body: { email: 'jakeeta@iwillglobal.com', password: 'Welcome123!' } });
    schedulerToken = schRes.json.token;

    const agRes = await request('/api/auth/login', { method: 'POST', body: { email: 'rchen@iwillglobal.com', password: 'Welcome123!' } });
    agentToken = agRes.json.token;
  });

  after(async () => {
    if (server) server.close();
    await closeDb();
  });

  describe('1. Auth & Team Structure', () => {
    test('Login succeeds for Principal King Amen Ra (king@iwillglobal.com / Heru5464) and team', async () => {
      assert.ok(principalToken, 'Principal token should be acquired with Heru5464');
      assert.ok(adminToken, 'Admin token should be acquired');
      assert.ok(schedulerToken, 'Scheduler token should be acquired');
      assert.ok(agentToken, 'Agent token should be acquired');
    });

    test('GET /api/auth/me returns Principal profile & NPN 16094432', async () => {
      const res = await request('/api/auth/me', { token: principalToken });
      assert.equal(res.status, 200);
      assert.equal(res.json.user.email, 'king@iwillglobal.com');
      assert.equal(res.json.user.name, 'King Amen Ra');
      assert.equal(res.json.user.npn, '16094432');
      assert.equal(res.json.user.role, 'admin');
    });

    test('Principal or COO can add team members and assign roles', async () => {
      // 1. Principal adds a team member
      const addByPrincipal = await request('/api/users', {
        method: 'POST',
        token: principalToken,
        body: {
          name: 'Tariq Johnson',
          email: 'tjohnson@iwillglobal.com',
          role: 'scheduler',
          title: 'Outbound Appointment Setter',
          phone: '(602) 456-9901',
          states: ['AZ', 'CA'],
        },
      });
      assert.equal(addByPrincipal.status, 201);
      assert.equal(addByPrincipal.json.email, 'tjohnson@iwillglobal.com');
      const newUserId = addByPrincipal.json.id;

      // 2. COO promotes team member role to licensed_agent
      const updateByCOO = await request(`/api/users/${newUserId}`, {
        method: 'PATCH',
        token: cooToken, // Aneesha Sullivan (COO & Admin)
        body: {
          role: 'licensed_agent',
          title: 'Licensed Medicare Specialist',
          npn: '20948501',
        },
      });
      assert.equal(updateByCOO.status, 200);
      assert.equal(updateByCOO.json.role, 'licensed_agent');
      assert.equal(updateByCOO.json.npn, '20948501');
    });

    test('GET /api/team lists agents with licensing status and Google Meet URLs', async () => {
      const res = await request('/api/team', { token: adminToken });
      assert.equal(res.status, 200);
      assert.ok(Array.isArray(res.json));
      assert.ok(res.json.length >= 20, 'Should seed 20+ users for I Will Global');
      assert.ok(res.json[0].google_meet_url.includes('meet.google.com/iwg-'));
    });

    test('Team member can update and change their password via /api/auth/change-password', async () => {
      // 1. Invalid current password is rejected
      const badCur = await request('/api/auth/change-password', {
        method: 'POST',
        token: agentToken, // rchen@iwillglobal.com
        body: { currentPassword: 'WrongPassword123!', newPassword: 'NewSecurePassword789!' },
      });
      assert.equal(badCur.status, 400);
      assert.ok(badCur.json.error.includes('Current password is incorrect'));

      // 2. Short new password (<6 chars) is rejected
      const shortPass = await request('/api/auth/change-password', {
        method: 'POST',
        token: agentToken,
        body: { currentPassword: 'Welcome123!', newPassword: '123' },
      });
      assert.equal(shortPass.status, 400);

      // 3. Valid change password succeeds
      const changeOk = await request('/api/auth/change-password', {
        method: 'POST',
        token: agentToken,
        body: { currentPassword: 'Welcome123!', newPassword: 'NewAgentPass2027!' },
      });
      assert.equal(changeOk.status, 200);
      assert.equal(changeOk.json.ok, true);

      // 4. Login with old password now fails
      const oldLogin = await request('/api/auth/login', {
        method: 'POST',
        body: { email: 'rchen@iwillglobal.com', password: 'Welcome123!' },
      });
      assert.equal(oldLogin.status, 401);

      // 5. Login with new password succeeds
      const newLogin = await request('/api/auth/login', {
        method: 'POST',
        body: { email: 'rchen@iwillglobal.com', password: 'NewAgentPass2027!' },
      });
      assert.equal(newLogin.status, 200);
      assert.ok(newLogin.json.token);

      // Restore password back to Welcome123! so subsequent tests remain unaffected
      const resetBack = await request('/api/auth/change-password', {
        method: 'POST',
        token: newLogin.json.token,
        body: { currentPassword: 'NewAgentPass2027!', newPassword: 'Welcome123!' },
      });
      assert.equal(resetBack.status, 200);
    });

    test('Administrator can reset any team member password via /api/users/:id/reset-password', async () => {
      // Find a team member (e.g. jrivera)
      const usersRes = await request('/api/users', { token: adminToken });
      const targetUser = usersRes.json.find((u: any) => u.email === 'jrivera@iwillglobal.com');
      assert.ok(targetUser, 'Jordan Rivera user should exist');

      // 1. Non-admin cannot reset password
      const nonAdminReset = await request(`/api/users/${targetUser.id}/reset-password`, {
        method: 'POST',
        token: agentToken,
        body: { newPassword: 'HackedPassword123!' },
      });
      assert.equal(nonAdminReset.status, 403);

      // 2. Admin successfully resets team member password
      const adminReset = await request(`/api/users/${targetUser.id}/reset-password`, {
        method: 'POST',
        token: principalToken,
        body: { newPassword: 'RiveraTempPass99!' },
      });
      assert.equal(adminReset.status, 200);
      assert.equal(adminReset.json.ok, true);

      // 3. User can login with the admin-reset password
      const loginRes = await request('/api/auth/login', {
        method: 'POST',
        body: { email: 'jrivera@iwillglobal.com', password: 'RiveraTempPass99!' },
      });
      assert.equal(loginRes.status, 200);
      assert.ok(loginRes.json.token);

      // Reset back to Welcome123!
      await request(`/api/users/${targetUser.id}/reset-password`, {
        method: 'POST',
        token: principalToken,
        body: { newPassword: 'Welcome123!' },
      });
    });
  });

  describe('2. Medicare Enrollment Engine & Phone Helpers', () => {
    test('Turns 65 IEP window calculation', () => {
      const dob = '1961-06-15'; // Birthday June 15, 2026 -> 65th birthday
      const t65 = turning65Date(dob);
      assert.equal(t65, '2026-06-15');
      const iep = iepWindow(dob);
      assert.equal(iep.start, '2026-03-01', '3 months before birthday month');
      assert.equal(iep.end, '2026-09-30', '3 months after birthday month');
    });

    test('Phone E.164 normalization & Google Voice web URL', () => {
      const raw = '(480) 331-9455';
      const e164 = toE164(raw);
      assert.equal(e164, '+14803319455');
      const gvUrl = googleVoiceWebUrl(e164!);
      assert.equal(gvUrl, 'https://voice.google.com/u/0/calls?a=nc,%2B14803319455');
    });
  });

  describe('3. Call Lifecycle & Disposition Automations', () => {
    test('Start call checks TCPA quiet hours and returns Google Voice links', async () => {
      const startRes = await request('/api/calls/start', {
        method: 'POST',
        token: adminToken,
        body: { related_type: 'lead', related_id: 'lead_1', override: true },
      });
      assert.equal(startRes.status, 200);
      assert.equal(startRes.json.dial.provider, 'google_voice');
      assert.ok(startRes.json.dial.webUrl.includes('voice.google.com'));
      assert.ok(startRes.json.call.id);

      // Complete call with 'SOA Sent' disposition
      const callId = startRes.json.call.id;
      const compRes = await request(`/api/calls/${callId}/complete`, {
        method: 'POST',
        token: adminToken,
        body: {
          disposition_id: 'soa_sent',
          notes: 'Customer asked for Scope of Appointment e-sign link via text.',
          duration_sec: 180,
          tpmo_given: true,
          callback_at: new Date(Date.now() + 86400000).toISOString(),
        },
      });
      assert.equal(compRes.status, 200);
      assert.ok(compRes.json.actions.some((a: string) => a.includes('SOA')));
    });

    test('Scheduler appointment booking routes to a licensed agent', async () => {
      const startRes = await request('/api/calls/start', {
        method: 'POST',
        token: schedulerToken,
        body: { related_type: 'lead', related_id: 'lead_1', override: true },
      });
      const callId = startRes.json.call.id;
      const apptTime = new Date(Date.now() + 2 * 86400000).toISOString();

      const compRes = await request(`/api/calls/${callId}/complete`, {
        method: 'POST',
        token: schedulerToken,
        body: {
          disposition_id: 'appointment_set',
          notes: 'Booked Medicare consultation for Thursday.',
          appointment_at: apptTime,
        },
      });
      assert.equal(compRes.status, 200);
      assert.ok(compRes.json.actions.some((a: string) => a.includes('Appointment booked')));
    });
  });

  describe('4. AI Guardrails & Compliance', () => {
    test('Redacts sensitive MBI and SSN from text', () => {
      const input = 'My Medicare number is 1EG4-TE5-MK72 and my SSN is 123-45-6789.';
      const { text, found } = redactSensitive(input);
      assert.ok(text.includes('[MBI REDACTED]'));
      assert.ok(text.includes('[SSN REDACTED]'));
      assert.equal(found.length, 2);
    });

    test('Detects plan-specific advice requests needing a licensed agent', () => {
      assert.equal(needsLicensedAgent('Which Medicare Advantage plan is best for me?'), true);
      assert.equal(needsLicensedAgent('What are the general rules for Medicare?'), false);
    });

    test('Flags unlicensed scheduler benefit talk', () => {
      const flags = schedulerBenefitFlags('The copay for this plan is $0 and the dental benefit is $2000.');
      assert.ok(flags.includes('copay'));
      assert.ok(flags.includes('dental benefit'));
    });
  });

  describe('5. Website Chat Widget & SOA E-Sign Flow', () => {
    let convId: string;
    let token: string;
    let soaToken: string;

    test('Public chat widget start and visitor message', async () => {
      const startRes = await request('/api/public/chat/start', { method: 'POST' });
      assert.equal(startRes.status, 200);
      convId = startRes.json.conversation_id;
      token = startRes.json.token;
      assert.ok(convId);
      assert.ok(token);

      const msgRes = await request(`/api/public/chat/${convId}/messages`, {
        method: 'POST',
        body: { token, body: 'Hi, I am turning 65 in November and need help understanding Medicare.' },
      });
      assert.equal(msgRes.status, 200);
      assert.ok(msgRes.json.replies.length > 0);
    });

    test('Public SOA E-Sign completion', async () => {
      // Find the seeded SOA
      const soaRow = await one<{ token: string }>('SELECT token FROM soas LIMIT 1');
      assert.ok(soaRow);
      soaToken = soaRow.token;

      const getRes = await request(`/api/public/soa/${soaToken}`);
      assert.equal(getRes.status, 200);

      const signRes = await request(`/api/public/soa/${soaToken}/sign`, {
        method: 'POST',
        body: {
          signer_name: 'Arthur Pendleton',
          products: ['Medicare Advantage (Part C)', 'Prescription Drug Plan (Part D)'],
        },
      });
      assert.equal(signRes.status, 200);
      assert.equal(signRes.json.ok, true);

      const updated = await one<{ status: string }>('SELECT status FROM soas WHERE token=$1', [soaToken]);
      assert.equal(updated?.status, 'Signed');
    });
  });

  describe('6. Appointment Scheduling & Scheduler Lead Credit Rules', () => {
    test('Available agents endpoint returns state-licensed agents', async () => {
      const res = await request('/api/appointments/available-agents?state=AZ', { token: schedulerToken });
      assert.equal(res.status, 200);
      assert.ok(Array.isArray(res.json));
      assert.ok(res.json.length > 0);
      assert.ok(res.json[0].state_licensed);
    });

    test('Schedule appointment creates event & pending customer confirmation SMS', async () => {
      const apptAt = new Date(Date.now() + 86400000).toISOString();
      const res = await request('/api/appointments/schedule', {
        method: 'POST',
        token: schedulerToken,
        body: {
          related_type: 'lead',
          related_id: 'lead_1',
          appointment_type: 'in_person',
          appointment_at: apptAt,
          agent_id: 'u_agent1',
          location: '742 E Camelback Rd, Phoenix, AZ 85014',
          notes: 'Turning 65 in-person home visit consultation.',
          send_confirmation_sms: true,
          send_confirmation_email: true,
        },
      });

      assert.equal(res.status, 201);
      assert.ok(res.json.appointment);
      assert.equal(res.json.appointment.status, 'Pending Customer Confirmation');
      assert.equal(res.json.assigned_agent.id, 'u_agent1');
      assert.equal(res.json.sms_sent, true);
    });

    test('Customer SMS YES reply converts status to Confirmed & awards Scheduler Lead Credit', async () => {
      const smsRes = await request('/api/public/sms/inbound', {
        method: 'POST',
        body: {
          phone: '(480) 555-0144',
          text: 'YES',
        },
      });

      assert.equal(smsRes.status, 200);
      assert.equal(smsRes.json.confirmed, true);
      assert.ok(smsRes.json.credited_scheduler_name);

      // Verify DB activity updated to Confirmed and Credited
      const act = await one<{ status: string; meta: any }>(
        `SELECT status, meta FROM activities WHERE related_id='lead_1' AND type='event' ORDER BY created_at DESC LIMIT 1`,
      );
      assert.equal(act?.status, 'Confirmed Appointment Set');
      assert.equal(act?.meta?.scheduler_credit_status, 'Credited');
      assert.equal(act?.meta?.customer_confirmed, true);
    });

    test('Scheduled appointments connect & sync to info@iwillglobal.com master calendar', async () => {
      const res = await request('/api/appointments/calendar', { token: adminToken });
      assert.equal(res.status, 200);
      assert.equal(res.json.calendar_email, 'info@iwillglobal.com');
      assert.ok(Array.isArray(res.json.appointments));
      assert.ok(res.json.appointments.length > 0);
      assert.ok(res.json.webcal_url.includes('agency.ics'));
      assert.ok(res.json.google_calendar_subscribe_url.includes('calendar.google.com'));

      // Check that appointment has google_calendar_url pointing to info@iwillglobal.com
      const sample = res.json.appointments[0];
      assert.ok(sample.google_calendar_url.includes('info%40iwillglobal.com') || sample.google_calendar_url.includes('info@iwillglobal.com'));
      assert.equal(sample.meta.master_calendar_email, 'info@iwillglobal.com');
      assert.equal(sample.meta.master_calendar_synced, true);
    });

    test('POST /api/appointments/sync-master-calendar syncs all set appointments to info@iwillglobal.com', async () => {
      const syncRes = await request('/api/appointments/sync-master-calendar', {
        method: 'POST',
        token: adminToken,
      });
      assert.equal(syncRes.status, 200);
      assert.equal(syncRes.json.success, true);
      assert.equal(syncRes.json.calendar_email, 'info@iwillglobal.com');
      assert.ok(syncRes.json.synced_count > 0);
      assert.ok(syncRes.json.ics_url.includes('/api/public/calendar/agency.ics'));
    });

    test('Public iCal feeds (agency.ics and info@iwillgloabl.com.ics) export standard RFC 5545 format', async () => {
      // 1. Standard agency.ics
      const icsRes = await request('/api/public/calendar/agency.ics');
      assert.equal(icsRes.status, 200);
      assert.ok(icsRes.json.includes('BEGIN:VCALENDAR'));
      assert.ok(icsRes.json.includes('X-WR-CALNAME:I Will Global Master Calendar (info@iwillglobal.com)'));
      assert.ok(icsRes.json.includes('END:VCALENDAR'));

      // 2. Email alias with user typo info@iwillgloabl.com.ics
      const typoRes = await request('/api/public/calendar/info@iwillgloabl.com.ics');
      assert.equal(typoRes.status, 200);
      assert.ok(typoRes.json.includes('BEGIN:VCALENDAR'));
    });
  });

  describe('7. Warm Transfer & Lead Handoff Engine', () => {
    let transferId: string;

    test('Scheduler initiates Warm Transfer to state-licensed agent', async () => {
      const initRes = await request('/api/calls/transfer/initiate', {
        method: 'POST',
        token: schedulerToken,
        body: {
          related_type: 'lead',
          related_id: 'lead_2',
          target_agent_id: 'u_agent1',
          notes: 'Prospect Eleanor Vance interested in Medigap vs MAPD. High dental user.',
          prospect_data: {
            first_name: 'Eleanor',
            last_name: 'Vance',
            phone: '(602) 555-0192',
            state: 'AZ',
          },
        },
      });

      assert.equal(initRes.status, 200);
      assert.ok(initRes.json.transfer_id);
      assert.equal(initRes.json.status, 'Agent Ringing');
      assert.equal(initRes.json.target_agent.id, 'u_agent1');
      transferId = initRes.json.transfer_id;
    });

    test('Licensed agent accepts Warm Transfer & retrieves prospect briefing', async () => {
      const acceptRes = await request('/api/calls/transfer/accept', {
        method: 'POST',
        token: agentToken,
        body: { transfer_id: transferId },
      });

      assert.equal(acceptRes.status, 200);
      assert.equal(acceptRes.json.activity.status, 'Warm Transfer Briefing');
      assert.ok(acceptRes.json.briefing.notes.includes('High dental'));
    });

    test('Complete Warm Transfer converts prospect, reassigns owner, and awards $25 scheduler credit', async () => {
      const compRes = await request('/api/calls/transfer/complete', {
        method: 'POST',
        token: agentToken,
        body: {
          transfer_id: transferId,
          disposition_id: 'warm_transfer_success',
          notes: 'Handed off call to agent Robert Chen. Lead converted & assigned.',
        },
      });

      assert.equal(compRes.status, 200);
      assert.equal(compRes.json.scheduler_credit_awarded, true);
      assert.equal(compRes.json.scheduler_amount, 25.00);

      // Verify Lead owner was updated to licensed agent
      const lead = await one<{ owner_id: string; status: string }>('SELECT owner_id, status FROM leads WHERE id=\'lead_2\'');
      assert.equal(lead?.owner_id, 'u_agent1');
      assert.equal(lead?.status, 'Contacted (Warm Transferred)');
    });
  });

  describe('8. AI Licensed Agent Avatar & Needs Analysis Engine', () => {
    test('POST /api/ai/avatar/analysis performs needs assessment & ranks plans', async () => {
      const res = await request('/api/ai/avatar/analysis', {
        method: 'POST',
        token: agentToken,
        body: {
          beneficiaryName: 'Marcus Aurelius',
          zipCode: '85251',
          hasMedicaid: true,
          needsTransportation: true,
          doctors: ['Mayo Clinic'],
          prescriptions: ['Eliquis'],
        },
      });

      assert.equal(res.status, 200);
      assert.equal(res.json.agentNpn, '19842011');
      assert.equal(res.json.dualEligible, true);
      assert.ok(Array.isArray(res.json.plans));
      assert.ok(res.json.topMatch.overallMatchPct >= 90);
    });

    test('POST /api/ai/avatar/enroll submits enrollment under NPN 19842011 via iwillglobal.com', async () => {
      const res = await request('/api/ai/avatar/enroll', {
        method: 'POST',
        token: agentToken,
        body: {
          beneficiaryName: 'Marcus Aurelius',
          carrier: 'Humana',
          planName: 'Humana Gold Plus HMO',
          zipCode: '85251',
          phone: '(480) 331-9999',
          email: 'marcus@example.com',
        },
      });

      assert.equal(res.status, 200);
      assert.equal(res.json.success, true);
      assert.ok(res.json.quoteUrl.includes('agent=19842011'));

      // Verify Policy was inserted under Principal Licensed Agent (u_admin)
      const policy = await one<{ agent_id: string; carrier: string }>('SELECT agent_id, carrier FROM policies WHERE client_id=$1', [res.json.client.id]);
      assert.equal(policy?.agent_id, 'u_admin');
      assert.equal(policy?.carrier, 'Humana');
    });
  });

  describe('9. Outbound Schedulers Selecting King Amen Ra to Assign Leads', () => {
    test('Available agents endpoint prioritizes King Amen Ra at the top with is_principal flag', async () => {
      const res = await request('/api/appointments/available-agents?state=AZ', { token: schedulerToken });
      assert.equal(res.status, 200);
      assert.ok(Array.isArray(res.json));
      assert.ok(res.json.length > 0);

      const firstAgent = res.json[0];
      assert.equal(firstAgent.id, 'u_principal');
      assert.equal(firstAgent.name, 'King Amen Ra');
      assert.equal(firstAgent.npn, '16094432');
      assert.equal(firstAgent.is_principal, true);
      assert.equal(firstAgent.state_licensed, true);
    });

    test('Outbound scheduler can select King Amen Ra when booking an appointment', async () => {
      // Create a test lead
      const leadRes = await request('/api/records/leads', {
        method: 'POST',
        token: schedulerToken,
        body: {
          first_name: 'Arthur',
          last_name: 'Pendelton',
          phone: '(602) 555-1212',
          email: 'arthur.pendelton@example.com',
          state: 'AZ',
          city: 'Phoenix',
          zip: '85001',
          source: 'Outbound Cold Call',
        },
      });
      assert.equal(leadRes.status, 201);
      const leadId = leadRes.json.id;

      // Scheduler schedules appointment explicitly choosing King Amen Ra
      const apptRes = await request('/api/appointments/schedule', {
        method: 'POST',
        token: schedulerToken,
        body: {
          related_type: 'lead',
          related_id: leadId,
          appointment_type: 'telephone',
          appointment_at: new Date(Date.now() + 86400000).toISOString(),
          agent_id: 'u_principal',
          notes: 'Customer interested in Aetna vs Humana MAPD. Schedulers booked directly for King Amen Ra.',
        },
      });

      assert.equal(apptRes.status, 201);
      assert.equal(apptRes.json.assigned_agent.id, 'u_principal');
      assert.equal(apptRes.json.assigned_agent.name, 'King Amen Ra');
      assert.equal(apptRes.json.assigned_agent.npn, '16094432');

      // Verify database state: lead assigned to King Amen Ra
      const updatedLead = await one<{ assigned_agent_id: string; status: string }>(
        'SELECT assigned_agent_id, status FROM leads WHERE id=$1',
        [leadId]
      );
      assert.equal(updatedLead?.assigned_agent_id, 'u_principal');
      assert.equal(updatedLead?.status, 'Appointment Set');
    });

    test('Outbound scheduler can directly assign a lead to King Amen Ra via /leads/:id/assign-agent', async () => {
      // Create a test lead
      const leadRes = await request('/api/records/leads', {
        method: 'POST',
        token: schedulerToken,
        body: {
          first_name: 'Beatrice',
          last_name: 'Montgomery',
          phone: '(602) 555-3434',
          email: 'beatrice.montgomery@example.com',
          state: 'AZ',
          city: 'Scottsdale',
          zip: '85251',
          source: 'Outbound Dialer',
        },
      });
      assert.equal(leadRes.status, 201);
      const leadId = leadRes.json.id;

      // Assign to King Amen Ra
      const assignRes = await request(`/api/records/leads/${leadId}/assign-agent`, {
        method: 'POST',
        token: schedulerToken,
        body: {
          agent_id: 'u_principal',
          status: 'Appointment Set',
          notes: 'High net-worth Medicare supplement prospect assigned directly to King Amen Ra.',
        },
      });

      assert.equal(assignRes.status, 200);
      assert.equal(assignRes.json.success, true);
      assert.equal(assignRes.json.assigned_agent.id, 'u_principal');
      assert.equal(assignRes.json.assigned_agent.name, 'King Amen Ra');
      assert.equal(assignRes.json.assigned_agent.is_principal, true);

      // Verify activity log & notification created for King Amen Ra
      const notif = await one<{ title: string }>(
        `SELECT title FROM notifications WHERE user_id='u_principal' ORDER BY created_at DESC LIMIT 1`
      );
      assert.ok(notif?.title.includes('Lead Assigned'));
    });

    test('Callers list in pool-stats has King Amen Ra listed at the top for lead distribution', async () => {
      const res = await request('/api/records/leads/pool-stats', { token: schedulerToken });
      assert.equal(res.status, 200);
      assert.ok(Array.isArray(res.json.callers));
      assert.equal(res.json.callers[0].id, 'u_principal');
      assert.equal(res.json.callers[0].name, 'King Amen Ra');
    });
  });

  describe('10. Email Deliverability & Anti-Spam Safeguards', () => {
    test('GET /api/email/deliverability/dns-check returns live DNS health and DMARC recommendation', async () => {
      const res = await request('/api/email/deliverability/dns-check?domain=iwillglobal.com', { token: adminToken });
      assert.equal(res.status, 200);
      assert.equal(res.json.domain, 'iwillglobal.com');
      assert.ok(res.json.mx.records.length > 0);
      assert.equal(res.json.spf.status, 'PASS');
      assert.equal(res.json.dkim.status, 'PASS');
      assert.ok(['PASS', 'WARN', 'FAIL'].includes(res.json.dmarc.status));
      assert.ok(res.json.recommendedDnsRecords.some((r: any) => r.host === '_dmarc' || r.value.includes('v=DMARC1')));
      assert.ok(res.json.overallScore >= 50);
    });

    test('POST /api/email/deliverability/analyze-content catches spam triggers & low score', async () => {
      const spamRes = await request('/api/email/deliverability/analyze-content', {
        method: 'POST',
        token: adminToken,
        body: {
          subject: 'FREE MONEY GUARANTEE ACT NOW 100% RISK FREE $$$',
          body: 'URGENT BUY DIRECT CLICK HERE FOR FREE CASH AND GUARANTEED PRE-APPROVAL RIGHT NOW!!!!!',
        },
      });

      assert.equal(spamRes.status, 200);
      assert.ok(spamRes.json.spamScore >= 30);
      assert.ok(spamRes.json.detectedTriggerWords.length >= 2);
      assert.equal(spamRes.json.canSpamCompliant, false);
      assert.ok(['High Spam Risk', 'Moderate Risk'].includes(spamRes.json.deliverabilityRating));
    });

    test('POST /api/email/deliverability/analyze-content passes compliant professional Medicare email', async () => {
      const goodRes = await request('/api/email/deliverability/analyze-content', {
        method: 'POST',
        token: adminToken,
        body: {
          subject: 'Your Upcoming Medicare Benefits Consultation with King Amen Ra',
          body: `Hello Arthur,\n\nThank you for scheduling your consultation with King Amen Ra regarding your Medicare options. We look forward to speaking with you on Tuesday at 2:00 PM MST.\n\nBest regards,\nI Will Global Insurance Agency\n\nI Will Global Insurance Agency LLC\n4800 N Scottsdale Rd, Scottsdale, AZ 85251\nUnsubscribe: https://iwillglobal.com/api/public/unsubscribe?email=test@example.com`,
        },
      });

      assert.equal(goodRes.status, 200);
      assert.ok(goodRes.json.spamScore <= 20);
      assert.equal(goodRes.json.detectedTriggerWords.length, 0);
      assert.equal(goodRes.json.canSpamCompliant, true);
      assert.ok(['Excellent', 'Good'].includes(goodRes.json.deliverabilityRating));
    });

    test('Public Unsubscribe endpoints (GET and POST RFC 8058) respond properly', async () => {
      const getRes = await request('/api/public/unsubscribe?email=prospect@example.com');
      assert.equal(getRes.status, 200);
      assert.ok(typeof getRes.json === 'string' && getRes.json.includes('Unsubscribed Successfully'));

      const postRes = await request('/api/public/unsubscribe', {
        method: 'POST',
        body: { email: 'prospect@example.com' },
      });
      assert.equal(postRes.status, 200);
      assert.equal(postRes.json.success, true);
      assert.equal(postRes.json.unsubscribed, 'prospect@example.com');
    });
  });

  describe('11. Appointment Durations, Buffer Spacing & Double-Booking Prevention', () => {
    const futureDate = '2027-04-15';

    test('GET /api/appointments/available-slots defaults to 30 min for telephone with 30 min buffer', async () => {
      const res = await request(`/api/appointments/available-slots?date=${futureDate}&appointment_type=telephone`, { token: adminToken });
      assert.equal(res.status, 200);
      assert.equal(res.json.agent.id, 'u_principal');
      assert.equal(res.json.agent.name, 'King Amen Ra');
      assert.equal(res.json.duration_minutes, 30);
      assert.equal(res.json.buffer_minutes, 30);
      assert.ok(res.json.total_slots >= 18);
      assert.ok(res.json.available_slots_count > 0);
      assert.equal(res.json.slots[0].time_label, '8:00 AM');
    });

    test('GET /api/appointments/available-slots sets 60 min duration for in_person', async () => {
      const res = await request(`/api/appointments/available-slots?date=${futureDate}&appointment_type=in_person`, { token: adminToken });
      assert.equal(res.status, 200);
      assert.equal(res.json.duration_minutes, 60);
      assert.equal(res.json.buffer_minutes, 30);
      assert.ok(res.json.slots[0].time_range.includes('8:00 AM - 9:00 AM'));
    });

    test('Double-booking prevention: blocks overlapping appointment with 409 Conflict', async () => {
      // 1. Book first appointment for King Amen Ra from 10:00 to 10:30 AM
      const appt1Res = await request('/api/appointments/schedule', {
        method: 'POST',
        token: schedulerToken,
        body: {
          related_type: 'lead',
          related_id: 'lead_3',
          appointment_type: 'telephone',
          appointment_at: `${futureDate}T10:00:00-07:00`,
          agent_id: 'u_principal',
          notes: 'First consultation with King Amen Ra',
        },
      });
      assert.equal(appt1Res.status, 201);
      assert.equal(appt1Res.json.appointment.due_at, new Date(`${futureDate}T10:00:00-07:00`).toISOString());
      // Duration should automatically be 30 minutes
      const endAtExpected = new Date(new Date(`${futureDate}T10:00:00-07:00`).getTime() + 30 * 60000).toISOString();
      assert.equal(appt1Res.json.appointment.end_at, endAtExpected);

      // 2. Attempt exact double-booking at 10:00 AM -> expect 409
      const doubleBookRes = await request('/api/appointments/schedule', {
        method: 'POST',
        token: schedulerToken,
        body: {
          related_type: 'lead',
          related_id: 'lead_4',
          appointment_type: 'telephone',
          appointment_at: `${futureDate}T10:00:00-07:00`,
          agent_id: 'u_principal',
          notes: 'Conflicting appointment attempt at same time',
        },
      });
      assert.equal(doubleBookRes.status, 409);
      assert.ok(doubleBookRes.json.error.includes('Double-booking') || doubleBookRes.json.error.includes('conflict'));
    });

    test('Buffer rule: blocks booking within 30-minute buffer window with 409 Conflict', async () => {
      // Appt 1 is 10:00 to 10:30 AM.
      // Booking at 10:45 AM has only 15 min gap (< 30 min buffer) -> expect 409
      const bufferConflictRes = await request('/api/appointments/schedule', {
        method: 'POST',
        token: schedulerToken,
        body: {
          related_type: 'lead',
          related_id: 'lead_5',
          appointment_type: 'telephone',
          appointment_at: `${futureDate}T10:45:00-07:00`,
          agent_id: 'u_principal',
          notes: 'Attempt within 30 min buffer',
        },
      });
      assert.equal(bufferConflictRes.status, 409);
      assert.ok(bufferConflictRes.json.error.includes('30-minute buffer') || bufferConflictRes.json.error.includes('buffer'));
    });

    test('Buffer rule: allows booking after 30-minute buffer (11:00 AM)', async () => {
      // 10:30 AM + 30 min buffer = 11:00 AM. This should succeed!
      const validApptRes = await request('/api/appointments/schedule', {
        method: 'POST',
        token: schedulerToken,
        body: {
          related_type: 'lead',
          related_id: 'lead_6',
          appointment_type: 'video',
          appointment_at: `${futureDate}T11:00:00-07:00`,
          agent_id: 'u_principal',
          notes: 'Video meeting scheduled after 30m buffer',
        },
      });
      assert.equal(validApptRes.status, 201);
      assert.equal(validApptRes.json.assigned_agent.id, 'u_principal');

      // Check slot availability reflects both booked slots and buffer slots
      const slotsCheck = await request(`/api/appointments/available-slots?date=${futureDate}&appointment_type=telephone`, { token: adminToken });
      assert.equal(slotsCheck.status, 200);

      const slot1000 = slotsCheck.json.slots.find((s: any) => s.time_label === '10:00 AM');
      assert.equal(slot1000?.available, false);
      assert.equal(slot1000?.reason, 'Booked');

      const slot1030 = slotsCheck.json.slots.find((s: any) => s.time_label === '10:30 AM');
      assert.equal(slot1030?.available, false);
      assert.equal(slot1030?.reason, '30m Buffer Window');

      const slot1100 = slotsCheck.json.slots.find((s: any) => s.time_label === '11:00 AM');
      assert.equal(slot1100?.available, false);
      assert.equal(slot1100?.reason, 'Booked');

      const slot1130 = slotsCheck.json.slots.find((s: any) => s.time_label === '11:30 AM');
      assert.equal(slot1130?.available, false);
      assert.equal(slot1130?.reason, '30m Buffer Window');

      const slot1200 = slotsCheck.json.slots.find((s: any) => s.time_label === '12:00 PM');
      assert.equal(slot1200?.available, true);
    });
  });

  describe('12. Running Late Automated Text Alert Engine', () => {
    const todayStr = new Date().toISOString().slice(0, 10);

    test('GET /api/appointments/running-late-status returns current & next appointments and suggested delay', async () => {
      // 1. Create a current appointment for King Amen Ra that started 20 mins ago (due_at = now - 20m, end_at = now - 5m)
      const now = Date.now();
      const pastStart = new Date(now - 25 * 60 * 1000);
      const pastEnd = new Date(now - 5 * 60 * 1000); // 5 minutes overdue
      const nextStart = new Date(now + 25 * 60 * 1000); // next appointment in 25 mins

      await q(
        `INSERT INTO activities (id, type, subject, body, related_type, related_id, assigned_to, due_at, end_at, status, completed, meta)
         VALUES ($1, 'event', 'Active Consultation Running Long', 'Consultation taking longer than expected', 'lead', 'lead_1', 'u_principal', $2, $3, 'In Progress', false, '{"customer_name":"Sarah Jenkins","customer_phone":"(602) 555-0199"}'::jsonb)`,
        ['act_current_long', pastStart.toISOString(), pastEnd.toISOString()]
      );

      // 2. Create the next appointment
      await q(
        `INSERT INTO activities (id, type, subject, body, related_type, related_id, assigned_to, due_at, end_at, status, completed, meta)
         VALUES ($1, 'event', 'Upcoming Medicare Phone Appointment', 'Next client waiting for review', 'lead', 'lead_2', 'u_principal', $2, $3, 'Confirmed', false, '{"customer_name":"Robert Diaz","customer_phone":"(480) 555-0144"}'::jsonb)`,
        ['act_next_client', nextStart.toISOString(), new Date(nextStart.getTime() + 30 * 60000).toISOString()]
      );

      // 3. Query running-late status for King Amen Ra
      const res = await request('/api/appointments/running-late-status', { token: principalToken });
      assert.equal(res.status, 200);
      assert.equal(res.json.has_running_late, true);
      assert.ok(res.json.minutes_overdue >= 4);
      assert.equal(res.json.current_appointment.id, 'act_current_long');
      assert.equal(res.json.next_appointment.id, 'act_next_client');
      assert.ok(res.json.suggested_delay_minutes >= 10);
      assert.ok(res.json.default_sms_message.includes('King Amen Ra'));
      assert.ok(res.json.default_sms_message.includes('I Will Global Insurance'));
      assert.ok(res.json.default_sms_message.includes('running about'));
    });

    test('POST /api/appointments/running-late sends automated SMS to next appointment attendee', async () => {
      // Send running late alert with 15-minute delay
      const res = await request('/api/appointments/running-late', {
        method: 'POST',
        token: principalToken,
        body: {
          next_appointment_id: 'act_next_client',
          minutes_delayed: 15,
        },
      });

      assert.equal(res.status, 200);
      assert.equal(res.json.success, true);
      assert.equal(res.json.minutes_delayed, 15);
      assert.ok(res.json.recipient.phone);
      assert.ok(res.json.message_sent.includes('King Amen Ra'));
      assert.ok(res.json.message_sent.includes('15 minutes'));
      assert.ok(res.json.next_appointment.new_time_formatted);

      // Verify outbound SMS activity was created in database
      const smsAct = await one<{ subject: string; body: string; meta: any }>(
        `SELECT subject, body, meta FROM activities WHERE type='call' AND meta->>'running_late'='true' AND meta->>'appointment_id'='act_next_client'`
      );
      assert.ok(smsAct);
      assert.ok(smsAct.subject.includes('Running Late'));
      assert.equal(smsAct.meta.minutes_delayed, 15);

      // Verify next appointment activity was updated with delay metadata
      const nextAct = await one<{ meta: any }>(
        `SELECT meta FROM activities WHERE id='act_next_client'`
      );
      assert.equal(nextAct?.meta.running_late_alert, true);
      assert.equal(nextAct?.meta.minutes_delayed, 15);
      assert.ok(nextAct?.meta.estimated_due_at);
      assert.ok(nextAct?.meta.last_running_late_sms);
    });

    test('POST /api/appointments/auto-running-late-check executes scanner without errors', async () => {
      const res = await request('/api/appointments/auto-running-late-check', {
        method: 'POST',
        token: adminToken,
        body: { minutes_threshold: 5 },
      });
      assert.equal(res.status, 200);
      assert.ok(typeof res.json.triggered_count === 'number');
      assert.ok(Array.isArray(res.json.alerts));
    });

    test('Running late endpoints reject non-admin/agents with 403 (only admin & agents allowed)', async () => {
      const schLogin = await request('/api/auth/login', {
        method: 'POST',
        body: { email: 'dmiller@iwillglobal.com', password: 'Welcome123!' },
      });
      const schToken = schLogin.json.token;

      const getRes = await request('/api/appointments/running-late-status', { token: schToken });
      assert.equal(getRes.status, 403);
      assert.ok(getRes.json.error.includes('administrators and licensed agents'));

      const postRes = await request('/api/appointments/running-late', {
        method: 'POST',
        token: schToken,
        body: { next_appointment_id: 'act_next_client' },
      });
      assert.equal(postRes.status, 403);
      assert.ok(postRes.json.error.includes('administrators and licensed agents'));
    });
  });

  describe('13. Master List Bank Bulk Assignment (5 - 500 Prospects)', () => {
    let pureSchedulerToken: string;

    before(async () => {
      const pureSchRes = await request('/api/auth/login', {
        method: 'POST',
        body: { email: 'dmiller@iwillglobal.com', password: 'Welcome123!' },
      });
      pureSchedulerToken = pureSchRes.json.token;

      // Seed a batch of unassigned prospects into Master List Bank
      for (let i = 1; i <= 30; i++) {
        await q(
          `INSERT INTO leads (id, first_name, last_name, phone, email, state, status, score, source, created_at)
           VALUES ($1, $2, $3, $4, $5, 'AZ', 'New', $6, 'Master Direct Mail', now())
           ON CONFLICT (id) DO UPDATE SET owner_id = NULL, status = 'New'`,
          [`lead_bank_${i}`, `BankProspect${i}`, `Test${i}`, `(480) 555-90${i.toString().padStart(2, '0')}`, `bank${i}@test.com`, 60 + i]
        );
      }
    });

    test('GET /api/records/leads/pool-stats returns master_list_bank_count and callers list', async () => {
      const res = await request('/api/records/leads/pool-stats', { token: principalToken });
      assert.equal(res.status, 200);
      assert.ok(typeof res.json.master_list_bank_count === 'number');
      assert.ok(res.json.master_list_bank_count >= 30);
      assert.ok(Array.isArray(res.json.callers));
      assert.ok(Array.isArray(res.json.state_breakdown));

      // King Amen Ra should be at the top of callers list with is_self = true for principal
      const firstCaller = res.json.callers[0];
      assert.equal(firstCaller.email, 'king@iwillglobal.com');
      assert.equal(firstCaller.is_self, true);
      assert.equal(firstCaller.is_admin, true);

      // Schedulers like David Miller should have is_scheduler = true
      const dmiller = res.json.callers.find((c: any) => c.email === 'dmiller@iwillglobal.com');
      assert.ok(dmiller);
      assert.equal(dmiller.is_scheduler, true);
    });

    test('Non-admin scheduler receives 0 for master_list_bank_count and empty state breakdown in pool-stats', async () => {
      const res = await request('/api/records/leads/pool-stats', { token: pureSchedulerToken });
      assert.equal(res.status, 200);
      assert.equal(res.json.master_list_bank_count, 0);
      assert.equal(res.json.unassigned_count, 0);
      assert.deepEqual(res.json.state_breakdown, []);
      assert.equal(res.json.is_admin, false);
    });

    test('Non-admin scheduler querying /records/leads cannot see unassigned master list bank leads', async () => {
      const res = await request('/api/records/leads?limit=100', { token: pureSchedulerToken });
      assert.equal(res.status, 200);
      for (const row of res.json.rows) {
        assert.ok(row.owner_id === 'u_sch2' || row.owner_id !== null, 'Scheduler must not see unassigned master list bank leads');
      }
    });

    test('POST /api/records/leads/assign-bulk rejects non-admin with 403 (only admin allowed)', async () => {
      const res = await request('/api/records/leads/assign-bulk', {
        method: 'POST',
        token: pureSchedulerToken,
        body: { caller_id: 'u_sch2', count: 10 },
      });
      assert.equal(res.status, 403);
      assert.ok(res.json.error.includes('Only administrators'));
    });

    test('POST /api/records/leads/assign-bulk validates batch size (5 <= count <= 500)', async () => {
      // count < 5 rejected
      const resLow = await request('/api/records/leads/assign-bulk', {
        method: 'POST',
        token: principalToken,
        body: { caller_id: 'u_sch2', count: 4 },
      });
      assert.equal(resLow.status, 400);
      assert.ok(resLow.json.error.includes('between 5 and 500'));

      // count > 500 rejected
      const resHigh = await request('/api/records/leads/assign-bulk', {
        method: 'POST',
        token: principalToken,
        body: { caller_id: 'u_sch2', count: 501 },
      });
      assert.equal(resHigh.status, 400);
      assert.ok(resHigh.json.error.includes('between 5 and 500'));
    });

    test('Admin assigns 5 prospects to individual outbound scheduler with notification', async () => {
      const res = await request('/api/records/leads/assign-bulk', {
        method: 'POST',
        token: principalToken,
        body: {
          caller_id: 'u_sch2', // David Miller (dedicated outbound scheduler)
          count: 5,
        },
      });

      assert.equal(res.status, 200);
      assert.equal(res.json.success, true);
      assert.equal(res.json.assigned, 5);
      assert.equal(res.json.caller_id, 'u_sch2');
      assert.equal(res.json.caller_name, 'David Miller');
      assert.equal(res.json.is_self, false);

      // Verify leads were assigned in database
      const assigned = await q<{ id: string; owner_id: string }>(
        `SELECT id, owner_id FROM leads WHERE owner_id = 'u_sch2' AND id LIKE 'lead_bank_%'`
      );
      assert.ok(assigned.length >= 5);

      // Verify in-app notification sent to the scheduler
      const notif = await one<{ title: string; body: string }>(
        `SELECT title, body FROM notifications WHERE user_id = 'u_sch2' ORDER BY created_at DESC LIMIT 1`
      );
      assert.ok(notif);
      assert.ok(notif.title.includes('Master List Bank'));
      assert.ok(notif.body.includes('King Amen Ra assigned 5 prospects'));
    });

    test('Admin assigns prospects to themselves as caller (caller_id: "self")', async () => {
      const res = await request('/api/records/leads/assign-bulk', {
        method: 'POST',
        token: principalToken,
        body: {
          caller_id: 'self',
          count: 10,
        },
      });

      assert.equal(res.status, 200);
      assert.equal(res.json.success, true);
      assert.equal(res.json.assigned, 10);
      assert.equal(res.json.caller_id, 'u_principal');
      assert.equal(res.json.caller_name, 'King Amen Ra');
      assert.equal(res.json.is_self, true);

      // Verify database owner_id updated to u_principal
      const principalLeads = await q<{ id: string }>(
        `SELECT id FROM leads WHERE owner_id = 'u_principal' AND id LIKE 'lead_bank_%'`
      );
      assert.ok(principalLeads.length >= 10);

      // Verify audit record logged with source 'master_list_bank'
      const auditLog = await one<{ action: string; details: any }>(
        `SELECT action, details FROM audit_log WHERE user_id = 'u_principal' AND action = 'bulk_assign' ORDER BY created_at DESC LIMIT 1`
      );
      assert.ok(auditLog);
      assert.equal(auditLog.details.source, 'master_list_bank');
      assert.equal(auditLog.details.is_self, true);
      assert.equal(auditLog.details.count, 10);
    });
  });

  describe('14. Admin Ability to Unassign Any Prospect', () => {
    let pureSchedulerToken: string;

    before(async () => {
      const pureSchRes = await request('/api/auth/login', {
        method: 'POST',
        body: { email: 'dmiller@iwillglobal.com', password: 'Welcome123!' },
      });
      pureSchedulerToken = pureSchRes.json.token;
    });

    test('Non-admin is rejected with 403 when attempting to unassign single prospect', async () => {
      const lead = await one<{ id: string }>(`SELECT id FROM leads LIMIT 1`);
      assert.ok(lead);

      const res = await request(`/api/records/leads/${lead.id}/unassign`, {
        method: 'POST',
        token: pureSchedulerToken,
      });

      assert.equal(res.status, 403);
      assert.ok(res.json.error.includes('Only administrators'));
    });

    test('Non-admin is rejected with 403 when attempting to bulk unassign prospects', async () => {
      const res = await request(`/api/records/leads/unassign-bulk`, {
        method: 'POST',
        token: agentToken,
        body: { lead_ids: ['lead_1', 'lead_2'] },
      });

      assert.equal(res.status, 403);
      assert.ok(res.json.error.includes('Only administrators'));
    });

    test('Admin successfully unassigns a single prospect via POST /api/records/leads/:id/unassign', async () => {
      // First ensure the lead is assigned to someone
      const testLead = await one<{ id: string }>(`SELECT id FROM leads LIMIT 1`);
      assert.ok(testLead);

      await q(`UPDATE leads SET owner_id = 'u_sch2', assigned_agent_id = 'u_principal' WHERE id = $1`, [testLead.id]);

      // Verify it was assigned
      const before = await one<{ owner_id: string; assigned_agent_id: string }>(
        `SELECT owner_id, assigned_agent_id FROM leads WHERE id = $1`, [testLead.id]
      );
      assert.equal(before?.owner_id, 'u_sch2');
      assert.equal(before?.assigned_agent_id, 'u_principal');

      // Admin calls unassign
      const res = await request(`/api/records/leads/${testLead.id}/unassign`, {
        method: 'POST',
        token: principalToken,
      });

      assert.equal(res.status, 200);
      assert.equal(res.json.success, true);
      assert.ok(res.json.message.includes('unassigned'));

      // Verify database updated: owner_id IS NULL and assigned_agent_id IS NULL
      const after = await one<{ owner_id: string | null; assigned_agent_id: string | null }>(
        `SELECT owner_id, assigned_agent_id FROM leads WHERE id = $1`, [testLead.id]
      );
      assert.equal(after?.owner_id, null);
      assert.equal(after?.assigned_agent_id, null);

      // Verify activity recorded
      const activity = await one<{ subject: string; body: string }>(
        `SELECT subject, body FROM activities WHERE related_id = $1 AND type = 'system' ORDER BY created_at DESC LIMIT 1`,
        [testLead.id]
      );
      assert.ok(activity);
      assert.ok(activity.subject.includes('Prospect Unassigned'));

      // Verify audit log recorded
      const auditLog = await one<{ action: string; details: any }>(
        `SELECT action, details FROM audit_log WHERE entity_id = $1 AND action = 'unassign_prospect' ORDER BY created_at DESC LIMIT 1`,
        [testLead.id]
      );
      assert.ok(auditLog);
      assert.equal(auditLog.details.previous_owner_id, 'u_sch2');
      assert.equal(auditLog.details.previous_assigned_agent_id, 'u_principal');
    });

    test('Admin successfully bulk unassigns prospects via POST /api/records/leads/unassign-bulk', async () => {
      // Assign 3 leads
      const leadsToAssign = await q<{ id: string }>(`SELECT id FROM leads LIMIT 3`);
      assert.equal(leadsToAssign.length, 3);
      const ids = leadsToAssign.map(l => l.id);

      await q(`UPDATE leads SET owner_id = 'u_jakeeta', assigned_agent_id = 'u_agent1' WHERE id = ANY($1)`, [ids]);

      // Admin bulk unassigns
      const res = await request('/api/records/leads/unassign-bulk', {
        method: 'POST',
        token: adminToken,
        body: { lead_ids: ids },
      });

      assert.equal(res.status, 200);
      assert.equal(res.json.success, true);
      assert.equal(res.json.unassigned, 3);

      // Verify all 3 leads have null owner_id and assigned_agent_id
      const verified = await q<{ id: string; owner_id: string | null; assigned_agent_id: string | null }>(
        `SELECT id, owner_id, assigned_agent_id FROM leads WHERE id = ANY($1)`, [ids]
      );
      for (const row of verified) {
        assert.equal(row.owner_id, null);
        assert.equal(row.assigned_agent_id, null);
      }
    });

    test('Admin unassigns prospect via assign-agent endpoint with agent_id "__unassign__"', async () => {
      const testLead = await one<{ id: string }>(`SELECT id FROM leads LIMIT 1`);
      assert.ok(testLead);

      await q(`UPDATE leads SET owner_id = 'u_jakeeta', assigned_agent_id = 'u_principal' WHERE id = $1`, [testLead.id]);

      const res = await request(`/api/records/leads/${testLead.id}/assign-agent`, {
        method: 'POST',
        token: principalToken,
        body: { agent_id: '__unassign__' },
      });

      assert.equal(res.status, 200);
      assert.equal(res.json.success, true);
      assert.equal(res.json.unassigned, true);

      const after = await one<{ owner_id: string | null; assigned_agent_id: string | null }>(
        `SELECT owner_id, assigned_agent_id FROM leads WHERE id = $1`, [testLead.id]
      );
      assert.equal(after?.owner_id, null);
      assert.equal(after?.assigned_agent_id, null);
    });
  });

  describe('15. Admin Ability to Remove or Delete Leads', () => {
    let pureSchedulerToken: string;

    before(async () => {
      const pureSchRes = await request('/api/auth/login', {
        method: 'POST',
        body: { email: 'dmiller@iwillglobal.com', password: 'Welcome123!' },
      });
      pureSchedulerToken = pureSchRes.json.token;
    });

    test('Non-admin is rejected with 403 when attempting to delete single lead', async () => {
      const lead = await one<{ id: string }>(`SELECT id FROM leads LIMIT 1`);
      assert.ok(lead);

      const res = await request(`/api/records/leads/${lead.id}`, {
        method: 'DELETE',
        token: pureSchedulerToken,
      });

      assert.equal(res.status, 403);
      assert.ok(res.json.error.includes('Only administrators can delete or remove leads'));
    });

    test('Non-admin agent is rejected with 403 when attempting to bulk delete leads', async () => {
      const res = await request(`/api/records/leads/delete-bulk`, {
        method: 'POST',
        token: agentToken,
        body: { lead_ids: ['lead_1', 'lead_2'] },
      });

      assert.equal(res.status, 403);
      assert.ok(res.json.error.includes('Only administrators can delete or remove leads'));
    });

    test('Admin successfully deletes a single lead with cascade cleanup of activities and calls', async () => {
      // Create a test lead to delete
      const newLead = await insert<{ id: string }>('leads', {
        first_name: 'ToDelete',
        last_name: 'LeadSingle',
        phone: '4805559090',
        state: 'AZ',
        status: 'New',
      });

      // Add a related activity and SOA
      await insert('activities', {
        type: 'task',
        subject: 'Call lead to delete',
        related_type: 'lead',
        related_id: newLead.id,
        user_id: 'u_principal',
      });

      await insert('soas', {
        token: `soa-del-${Date.now()}`,
        lead_id: newLead.id,
        beneficiary_name: 'ToDelete LeadSingle',
      });

      // Admin deletes the lead
      const res = await request(`/api/records/leads/${newLead.id}`, {
        method: 'DELETE',
        token: principalToken,
      });

      assert.equal(res.status, 200);
      assert.equal(res.json.success || res.json.ok, true);

      // Verify lead is deleted
      const checkLead = await one(`SELECT id FROM leads WHERE id = $1`, [newLead.id]);
      assert.equal(checkLead, null);

      // Verify related activity and SOA are deleted
      const checkAct = await one(`SELECT id FROM activities WHERE related_id = $1`, [newLead.id]);
      assert.equal(checkAct, null);

      const checkSoa = await one(`SELECT id FROM soas WHERE lead_id = $1`, [newLead.id]);
      assert.equal(checkSoa, null);
    });

    test('Admin successfully bulk deletes selected leads', async () => {
      // Create 2 test leads
      const lead1 = await insert<{ id: string }>('leads', { first_name: 'BulkDel1', last_name: 'Test', state: 'AZ', status: 'New' });
      const lead2 = await insert<{ id: string }>('leads', { first_name: 'BulkDel2', last_name: 'Test', state: 'AZ', status: 'New' });

      const res = await request(`/api/records/leads/delete-bulk`, {
        method: 'POST',
        token: adminToken,
        body: { lead_ids: [lead1.id, lead2.id] },
      });

      assert.equal(res.status, 200);
      assert.equal(res.json.success, true);
      assert.equal(res.json.deleted, 2);

      const check = await q(`SELECT id FROM leads WHERE id IN ($1, $2)`, [lead1.id, lead2.id]);
      assert.equal(check.length, 0);
    });
  });

  describe('16. Duplicate Guard on Upload & Duplicate Cleanup', () => {
    let pureSchedulerToken: string;

    before(async () => {
      const schRes = await request('/api/auth/login', {
        method: 'POST',
        body: { email: 'dmiller@iwillglobal.com', password: 'Welcome123!' },
      });
      pureSchedulerToken = schRes.json.token;
    });

    test('Batch import guards against duplicates within the uploaded batch', async () => {
      const uniquePhone = '4809990001';
      const duplicatePhone = '4809990002';

      const res = await request('/api/records/batch-import/leads', {
        method: 'POST',
        token: principalToken,
        body: {
          guard_duplicates: true,
          leads: [
            { first_name: 'LeadA', last_name: 'Test', phone: uniquePhone, email: 'leada_unique@test.com', state: 'AZ', address: '101 E Main St' },
            { first_name: 'LeadB1', last_name: 'Test', phone: duplicatePhone, email: 'leadb1@test.com', state: 'AZ', address: '102 E Main St' },
            { first_name: 'LeadB2_Dupe', last_name: 'Test', phone: `(${duplicatePhone.slice(0,3)}) ${duplicatePhone.slice(3,6)}-${duplicatePhone.slice(6)}`, email: 'leadb2@test.com', state: 'AZ', address: '103 E Main St' },
          ],
        },
      });

      assert.equal(res.status, 200);
      assert.equal(res.json.success, true);
      assert.equal(res.json.imported, 2);
      assert.equal(res.json.duplicates_skipped, 1);
      assert.equal(res.json.total_processed, 3);
    });

    test('Batch import guards against duplicates matching existing prospects in CRM', async () => {
      // First ensure an existing lead exists
      const existingPhone = '4809990099';
      await insert('leads', {
        first_name: 'Existing',
        last_name: 'Client',
        phone: existingPhone,
        email: 'existing_client@test.com',
        state: 'AZ',
        address: '104 E Main St',
        status: 'Sold',
      });

      // Attempt to batch-import a prospect with the same 10-digit phone
      const res = await request('/api/records/batch-import/leads', {
        method: 'POST',
        token: principalToken,
        body: {
          guard_duplicates: true,
          leads: [
            { first_name: 'Duplicate', last_name: 'Upload', phone: `+1 (${existingPhone.slice(0,3)}) ${existingPhone.slice(3,6)}-${existingPhone.slice(6)}`, email: 'new_email@test.com', state: 'AZ', address: '105 E Main St' },
          ],
        },
      });

      assert.equal(res.status, 200);
      assert.equal(res.json.success, true);
      assert.equal(res.json.imported, 0);
      assert.equal(res.json.duplicates_skipped, 1);
    });

    test('Non-admin cannot run database duplicate cleanup (403 Forbidden)', async () => {
      const res = await request('/api/records/leads/cleanup-duplicates', {
        method: 'POST',
        token: pureSchedulerToken,
      });

      assert.equal(res.status, 403);
      assert.ok(res.json.error.includes('Only administrators'));
    });

    test('Admin successfully cleans existing duplicate leads and retains primary record', async () => {
      const dupePhone = '4807771234';

      // Insert primary lead (higher score, converted/sold)
      const primaryLead = await insert<{ id: string }>('leads', {
        first_name: 'Primary',
        last_name: 'Record',
        phone: dupePhone,
        email: 'primary_clean@test.com',
        status: 'Sold',
        score: 95,
        state: 'AZ',
      });

      // Insert duplicate lead (lower score, new status)
      const secondaryLead = await insert<{ id: string }>('leads', {
        first_name: 'Duplicate',
        last_name: 'Clone',
        phone: `(${dupePhone.slice(0,3)}) ${dupePhone.slice(3,6)}-${dupePhone.slice(6)}`,
        email: 'secondary_clean@test.com',
        status: 'New',
        score: 40,
        state: 'AZ',
      });

      // Run cleanup
      const res = await request('/api/records/leads/cleanup-duplicates', {
        method: 'POST',
        token: principalToken,
      });

      assert.equal(res.status, 200);
      assert.equal(res.json.success, true);
      assert.ok(res.json.removed_duplicates >= 1);
      assert.ok(res.json.duplicate_groups_found >= 1);

      // Verify primary lead was kept
      const checkPrimary = await one(`SELECT id, status FROM leads WHERE id = $1`, [primaryLead.id]);
      assert.ok(checkPrimary);
      assert.equal(checkPrimary.status, 'Sold');

      // Verify secondary clone was removed
      const checkSecondary = await one(`SELECT id FROM leads WHERE id = $1`, [secondaryLead.id]);
      assert.equal(checkSecondary, null);
    });
  });

  describe('17. Scheduler Exit Copilot & Quick Disposition', () => {
    let pureSchedulerToken: string;

    before(async () => {
      const loginRes = await request('/api/auth/login', {
        method: 'POST',
        body: { email: 'dmiller@iwillglobal.com', password: 'Welcome123!' },
      });
      pureSchedulerToken = loginRes.json.token;
    });

    test('Scheduler can quick-disposition a prospect directly via /api/calls/quick-disposition', async () => {
      // Create a test lead
      const testLead = await insert<{ id: string }>('leads', {
        first_name: 'Copilot',
        last_name: 'Prospect',
        phone: '4805559876',
        status: 'New',
        state: 'AZ',
      });

      const res = await request('/api/calls/quick-disposition', {
        method: 'POST',
        token: pureSchedulerToken,
        body: {
          related_type: 'lead',
          related_id: testLead.id,
          disposition_id: 'voicemail',
          notes: 'Customer did not pick up, left standard Medicare AEP review voicemail message.',
          duration_sec: 45,
          tpmo_given: true,
        },
      });

      assert.equal(res.status, 200);
      assert.equal(res.json.success, true);
      assert.equal(res.json.call.disposition_id, 'voicemail');
      assert.equal(res.json.call.disposition, 'Left Voicemail');

      // Verify lead record updated
      const updatedLead = await one<any>(`SELECT * FROM leads WHERE id=$1`, [testLead.id]);
      assert.ok(updatedLead);
      assert.equal(updatedLead.last_disposition, 'Left Voicemail');
      assert.ok(updatedLead.attempts >= 1);
    });

    test('Scheduler receives 403 when trying to quick-disposition with licensed_only disposition', async () => {
      const testLead = await insert<{ id: string }>('leads', {
        first_name: 'Licensed',
        last_name: 'Required',
        phone: '4805559877',
        status: 'Contacted',
        state: 'AZ',
      });

      const res = await request('/api/calls/quick-disposition', {
        method: 'POST',
        token: pureSchedulerToken,
        body: {
          related_type: 'lead',
          related_id: testLead.id,
          disposition_id: 'app_submitted',
          notes: 'Attempted to submit application as unlicensed scheduler.',
        },
      });

      assert.equal(res.status, 403);
      assert.ok(res.json.error.includes('licensed agent'));
    });

    test('Scheduler quick-disposition with callback creates callback task', async () => {
      const testLead = await insert<{ id: string }>('leads', {
        first_name: 'Callback',
        last_name: 'Prospect',
        phone: '4805559878',
        status: 'Contacted',
        state: 'AZ',
      });

      const callbackTime = new Date(Date.now() + 24 * 3600 * 1000).toISOString();
      const res = await request('/api/calls/quick-disposition', {
        method: 'POST',
        token: pureSchedulerToken,
        body: {
          related_type: 'lead',
          related_id: testLead.id,
          disposition_id: 'callback',
          notes: 'Requested callback tomorrow at 2 PM.',
          callback_at: callbackTime,
        },
      });

      assert.equal(res.status, 200);
      assert.equal(res.json.success, true);
      assert.ok(res.json.actions.some((a: string) => a.includes('Callback task scheduled')));

      // Verify task created in activities table
      const task = await one(`SELECT * FROM activities WHERE related_id=$1 AND type='task'`, [testLead.id]);
      assert.ok(task);
      assert.equal(task.status, 'Open');
    });
  });

  describe('20. Performance Numbers Scoping (Schedulers & Agents see only their own, Admin sees everyone)', () => {
    let pureSchedulerToken: string;

    before(async () => {
      const loginRes = await request('/api/auth/login', {
        method: 'POST',
        body: { email: 'dmiller@iwillglobal.com', password: 'Welcome123!' },
      });
      pureSchedulerToken = loginRes.json.token;
    });

    test('Scheduler dashboard leaderboard is scoped strictly to self and is_admin is false', async () => {
      const res = await request('/api/dashboard', { token: pureSchedulerToken });
      assert.equal(res.status, 200);
      assert.equal(res.json.is_admin, false);
      // Leaderboard should only include the scheduler's own performance record
      for (const row of res.json.leaderboard) {
        assert.equal(row.id, 'u_sch2'); // David Miller
      }
    });

    test('Licensed agent dashboard leaderboard is scoped strictly to self and is_admin is false', async () => {
      const res = await request('/api/dashboard', { token: agentToken });
      assert.equal(res.status, 200);
      assert.equal(res.json.is_admin, false);
      for (const row of res.json.leaderboard) {
        assert.equal(row.id, 'u_agent1'); // Robert Chen
      }
    });

    test('Admin dashboard leaderboard includes agency-wide members and is_admin is true', async () => {
      const res = await request('/api/dashboard', { token: principalToken });
      assert.equal(res.status, 200);
      assert.equal(res.json.is_admin, true);
      assert.ok(res.json.leaderboard.length > 1);
    });

    test('Scheduler calling stats locks to self even if another user_id is provided', async () => {
      const res = await request('/api/calls/stats?days=30&user_id=u_agent1', { token: pureSchedulerToken });
      assert.equal(res.status, 200);
      assert.equal(res.json.is_admin, false);
      for (const ag of res.json.byAgent) {
        assert.equal(ag.id, 'u_sch2');
      }
    });

    test('Licensed agent calling stats locks to self and reports is_admin as false', async () => {
      const res = await request('/api/calls/stats?days=30', { token: agentToken });
      assert.equal(res.status, 200);
      assert.equal(res.json.is_admin, false);
      for (const ag of res.json.byAgent) {
        assert.equal(ag.id, 'u_agent1');
      }
    });

    test('Admin calling stats can view all team members and filter by specific user', async () => {
      const allRes = await request('/api/calls/stats?days=30', { token: principalToken });
      assert.equal(allRes.status, 200);
      assert.equal(allRes.json.is_admin, true);

      const filteredRes = await request('/api/calls/stats?days=30&user_id=u_sch2', { token: principalToken });
      assert.equal(filteredRes.status, 200);
      assert.equal(filteredRes.json.is_admin, true);
      for (const ag of filteredRes.json.byAgent) {
        assert.equal(ag.id, 'u_sch2');
      }
    });

    test('Scheduler credits endpoint returns only own credits for non-admin', async () => {
      const res = await request('/api/appointments/scheduler-credits', { token: pureSchedulerToken });
      assert.equal(res.status, 200);
      assert.ok(Array.isArray(res.json));
      assert.ok(res.json.length <= 1);
      if (res.json.length === 1) {
        assert.equal(res.json[0].user_id, 'u_sch2');
      }
    });

    test('Scheduler credits endpoint returns all schedulers for admin', async () => {
      const res = await request('/api/appointments/scheduler-credits', { token: principalToken });
      assert.equal(res.status, 200);
      assert.ok(Array.isArray(res.json));
      assert.ok(res.json.length > 1);
    });

    test('Commissions object endpoint scopes to agent_id for licensed agent', async () => {
      const res = await request('/api/records/commissions', { token: agentToken });
      assert.equal(res.status, 200);
      assert.ok(Array.isArray(res.json.rows));
      for (const row of res.json.rows) {
        assert.equal(row.agent_id, 'u_agent1');
      }
    });

    test('Scheduler New Leads (30d) KPI strictly excludes unassigned master list leads', async () => {
      // 1. Create an unassigned lead (master list bank prospect)
      const unassignedLead = await insert<{ id: string }>('leads', {
        first_name: 'Unassigned',
        last_name: 'PoolProspect',
        phone: '6025557711',
        status: 'New',
        state: 'AZ',
        owner_id: null,
      });

      // 2. Fetch dashboard as scheduler
      const beforeSchDash = await request('/api/dashboard', { token: pureSchedulerToken });
      assert.equal(beforeSchDash.status, 200);
      const initialCount = beforeSchDash.json.kpis.new_leads_30d;

      // 3. Scheduler creates their own individual lead
      const createdRes = await request('/api/records/leads', {
        method: 'POST',
        token: pureSchedulerToken,
        body: {
          first_name: 'SchedulerCreated',
          last_name: 'Prospect',
          phone: '6025557722',
          status: 'New',
          state: 'AZ',
        },
      });
      assert.equal(createdRes.status, 201);
      assert.equal(createdRes.json.owner_id, 'u_sch2');

      // 4. Fetch dashboard again as scheduler: count should increment by exactly 1 (the created lead, not the unassigned one)
      const afterSchDash = await request('/api/dashboard', { token: pureSchedulerToken });
      assert.equal(afterSchDash.json.kpis.new_leads_30d, initialCount + 1);

      // 5. Admin dashboard includes both unassigned and all user leads
      const adminDash = await request('/api/dashboard', { token: principalToken });
      assert.ok(adminDash.json.kpis.new_leads_30d > afterSchDash.json.kpis.new_leads_30d);
    });

    test('Licensed agent New Leads (30d) KPI strictly reflects only their assigned and created leads', async () => {
      const agentDash = await request('/api/dashboard', { token: agentToken });
      assert.equal(agentDash.status, 200);
      const agentLeadCount = agentDash.json.kpis.new_leads_30d;

      // Check against DB count for this agent
      const actualDbCount = await one<{ n: number }>(
        `SELECT count(*)::int AS n FROM leads WHERE (owner_id = 'u_agent1' OR assigned_agent_id = 'u_agent1') AND created_at >= now() - interval '30 days'`
      );
      assert.equal(agentLeadCount, actualDbCount?.n);
    });
  });
});


