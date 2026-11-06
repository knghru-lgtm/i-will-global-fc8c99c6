process.env.NODE_ENV = 'test';

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { WebSocket } from 'ws';
import { createApp, attachSarahWebSocket } from '../src/index.ts';
import { getDb, closeDb, one } from '../src/db/index.ts';
import { ensureSeeded } from '../src/db/seed.ts';
import {
  executeSarahTool,
  SARAH_SYSTEM_INSTRUCTION,
  SARAH_TOOLS,
  SARAH_MAIN_LINE_DISPLAY,
  SARAH_MAIN_LINE_E164,
  buildSarahSystemInstruction,
  detectTransferRequest,
  detectSarahTransferHoldSpeech,
} from '../src/services/sarahVoiceService.ts';
import { sendBlandCall } from '../src/services/bland.ts';

describe('Sarah Voice AI (Dual-Mode (480) 331-9455 Virtual Receptionist & Outbound Caller)', () => {
  let server: http.Server;
  let baseUrl: string;
  let wsUrl: string;

  before(async () => {
    await getDb();
    await ensureSeeded(false);

    const app = createApp();
    server = http.createServer(app);
    attachSarahWebSocket(server);

    await new Promise<void>((resolve) => {
      server.listen(0, () => {
        const addr = server.address() as any;
        baseUrl = `http://localhost:${addr.port}`;
        wsUrl = `ws://localhost:${addr.port}/api/sarah/live`;
        resolve();
      });
    });
  });

  after(async () => {
    if (server) {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
    await closeDb();
  });

  test('Unified line constants are set to (480) 331-9455 (+14803319455)', () => {
    assert.equal(SARAH_MAIN_LINE_DISPLAY, '(480) 331-9455');
    assert.equal(SARAH_MAIN_LINE_E164, '+14803319455');
  });

  test('Inbound Virtual Receptionist mode prompt includes (480) 331-9455, 42-member directory, and Whisper Transfer protocol', () => {
    const inboundPrompt = buildSarahSystemInstruction({ mode: 'inbound' });
    assert.match(inboundPrompt, /MODE 1: VIRTUAL RECEPTIONIST WHEN PEOPLE CALL \(480\) 331-9455/i);
    assert.match(inboundPrompt, /Thank you for calling IWG Insurance and Financial Services/i);
    assert.match(inboundPrompt, /King Amen Ra/i);
    assert.match(inboundPrompt, /Aneesha Sullivan, PA/i);
    assert.match(inboundPrompt, /NEVER claim the person is already on the line before calling and briefing them first/i);
    assert.match(inboundPrompt, /Telephone Appointment \(30 minutes\)/i);
    assert.match(inboundPrompt, /In-Person Appointment \(60 minutes\)/i);
    assert.match(inboundPrompt, /Video Appointment \(30 minutes\)/i);
  });

  test('Outbound Caller mode prompt includes the complete 4-Step Outbound Script & Decision Tree on (480) 331-9455', () => {
    const outboundPrompt = buildSarahSystemInstruction({
      mode: 'outbound',
      prospect_name: 'Eleanor Vance',
      prospect_phone: '(480) 555-0199',
      state: 'AZ',
      address: '742 Evergreen Terrace, Scottsdale, AZ',
    });
    assert.match(outboundPrompt, /MODE 2: OUTBOUND CALLER ON \(480\) 331-9455/i);
    assert.match(outboundPrompt, /Eleanor Vance/);
    assert.match(outboundPrompt, /STEP 1 — ULTRA-CLEAN OPENING GREETING & 2027 VALUE HOOK/i);
    assert.match(outboundPrompt, /STEP 2 — 3-POINT HIGH-IMPACT 2027 MEDICARE SUMMARY/i);
    assert.match(outboundPrompt, /\$1,788 hospital deductible/i);
    assert.match(outboundPrompt, /\$209\.50\/month/i);
    assert.match(outboundPrompt, /\$2,400/);
    assert.match(outboundPrompt, /STEP 3 — BRANCHING DECISION TREE: PATH A \(WHISPER TRANSFER\) vs\. PATH B \(APPOINTMENT CLOSE\)/i);
    assert.match(outboundPrompt, /PATH A — VIP Concierge Automatic AI Whisper Transfer to King Amen Ra/i);
    assert.match(outboundPrompt, /PATH B — Executive Alternative-Choice Appointment Close/i);
    assert.match(outboundPrompt, /STEP 4 — ALL 6 PRODUCT LINE FUNNELS & 4 EMPATHY-FIRST FIDUCIARY REBUTTALS/i);
    assert.match(outboundPrompt, /We do not offer every plan available in your area/i);
  });

  test('SARAH_TOOLS has book_appointment, whisper_warm_transfer, record_call_disposition, and get_cms_benefit_data', () => {
    const fnDecls = (SARAH_TOOLS[0] as any).functionDeclarations;
    const names = fnDecls.map((f: any) => f.name);
    assert.ok(names.includes('book_appointment'));
    assert.ok(names.includes('whisper_warm_transfer'));
    assert.ok(names.includes('record_call_disposition'));
    assert.ok(names.includes('get_cms_benefit_data'));
  });

  test('Tool: whisper_warm_transfer executes Hold -> Private Whisper Briefing -> Merge Introduction to King Amen Ra', async () => {
    const res = await executeSarahTool('whisper_warm_transfer', {
      recipient_name: 'King Amen Ra',
      customer_name: 'Eleanor Vance',
      customer_phone: '(480) 555-0199',
      customer_state: 'AZ',
      reason_for_call: '2027 Medicare Part D $2,400 cap and zero-premium advantage review',
    });

    assert.equal(res.success, true);
    assert.equal(res.transfer_status, 'whisper_completed_and_merged');
    assert.equal(res.recipient_name, 'King Amen Ra');
    assert.equal(res.recipient_phone, '+16024569681');
    assert.equal(res.originating_line, '+14803319455');
    assert.match(res.private_whisper_delivered, /Hi King Amen Ra, this is Sarah AI whispering automatically/i);
    assert.match(res.merge_announcement, /It is my pleasure to introduce King Amen Ra/i);
  });

  test('Tool: book_appointment creates lead and confirms appointment with King Amen Ra in CRM', async () => {
    const testName = 'Sarah Test Prospect ' + Date.now();
    const testPhone = '(480) 555-8899';
    const testDatetime = 'Tomorrow at 10:00 AM';

    const res = await executeSarahTool('book_appointment', {
      customer_name: testName,
      phone: testPhone,
      appointment_type: 'Telephone',
      preferred_datetime: testDatetime,
      state: 'AZ',
      notes: 'Interested in 2027 Medicare Part D $2,400 cap review',
    });

    assert.equal(res.success, true);
    assert.equal(res.customer_name, testName);
    assert.equal(res.appointment_type, 'Telephone');
    assert.match(res.message, /King Amen Ra/);

    const lead = await one(`SELECT * FROM leads WHERE phone = $1`, [testPhone]);
    assert.ok(lead, 'Lead should be created in CRM leads table');

    const appt = await one(`SELECT * FROM activities WHERE related_id = $1 AND type = 'event'`, [lead.id]);
    assert.ok(appt, 'Appointment should be recorded in CRM calendar activities table');
    assert.match(appt.subject, /Telephone Consultation with King Amen Ra/);
  });

  test('GET and POST /api/bland/inbound picks up all calls on (480) 331-9455, executes Whisper Warm Transfer, and books appointments', async () => {
    const res = await fetch(`${baseUrl}/api/bland/inbound`);
    assert.equal(res.status, 200);
    const body: any = await res.json();
    assert.equal(body.ok, true);
    assert.equal(body.status, 'answered');
    assert.equal(body.receptionist, 'Sarah');
    assert.equal(body.line, '(480) 331-9455');
    assert.equal(body.line_e164, '+14803319455');
    assert.ok(body.directory_count >= 42);

    // Test POST inbound call requesting King Amen Ra (Automatic AI Whisper Transfer) and booking a Telephone appointment
    const postRes = await fetch(`${baseUrl}/api/bland/inbound`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: '(480) 555-3322',
        caller_name: 'Martha Stewart',
        requested_person: 'King Amen Ra',
        appointment_type: 'Telephone',
        preferred_datetime: 'Tomorrow at 2:00 PM',
        state: 'AZ',
      }),
    });
    assert.equal(postRes.status, 200);
    const postBody: any = await postRes.json();
    assert.equal(postBody.ok, true);
    assert.equal(postBody.status, 'answered');
    assert.ok(postBody.activity_id, 'Inbound call should be logged in CRM activities');
    assert.equal(postBody.transfer_result.recipient_name, 'King Amen Ra');
    assert.equal(postBody.transfer_result.recipient_phone, '+16024569681');
    assert.equal(postBody.appointment_result.appointment_type, 'Telephone');
  });

  test('Autonomous Outbound Dialer on (480) 331-9455 calls assigned leads, schedules appointments, and executes Whisper Warm Transfers', async () => {
    const { setBlandCampaignActive, runBlandAutoDialerTick, BLAND_AI_USER_ID } = await import('../src/services/bland.ts');
    const { insert: dbInsert } = await import('../src/db/index.ts');

    const assignedLead = await dbInsert<{ id: string }>('leads', {
      first_name: 'Arthur',
      last_name: 'Pendelton',
      phone: '(480) 555-9911',
      state: 'AZ',
      status: 'New',
      owner_id: BLAND_AI_USER_ID,
      assigned_agent_id: BLAND_AI_USER_ID,
    });

    await setBlandCampaignActive(true);
    const tick = await runBlandAutoDialerTick({ reason: 'activate', force: true });

    assert.equal(tick.ok, true);
    assert.ok(tick.dispatched.length >= 1, 'Should dispatch outbound calls to assigned leads');
    const matched = tick.dispatched.find((d: any) => d.lead_id === assignedLead.id) || tick.dispatched[0];
    assert.equal(matched.line_number, '+14803319455');
    assert.ok(matched.appointment_event_id, 'Should schedule consultation appointment on King Amen Ra calendar');
    assert.ok(matched.whisper_briefing, 'Should generate Automatic AI Whisper Warm Transfer briefing to King Amen Ra');
  });

  test('Test call to 6232230165 (+16232230165) is answered and transferred upon request via Live WebSocket & Google Voice', async () => {
    // 1. Verify outbound call dispatch to 6232230165 is answered and ready for transfer upon request
    const callRes = await sendBlandCall({
      phone: '6232230165',
      prospect_name: 'Test Beneficiary',
      state: 'AZ',
      override_pause: true,
    });

    assert.equal(callRes.ok, true);
    assert.equal(callRes.answered, true);
    assert.equal(callRes.to_number, '+16232230165');
    assert.equal(callRes.line_number, '+14803319455');
    assert.equal(callRes.telephony_provider, 'google_voice');
    assert.equal(callRes.google_voice_url, 'https://voice.google.com/u/0/calls?a=nc,%2B16232230165');
    assert.equal(callRes.transfer_on_request_ready, true);
    assert.equal(callRes.whisper_transfer.recipient_name, 'King Amen Ra');
    assert.equal(callRes.whisper_transfer.recipient_phone, '+16024569681');
    assert.equal(callRes.whisper_transfer.google_voice_transfer_url, 'https://voice.google.com/u/0/calls?a=nc,%2B16024569681');

    // 2. Verify transfer-upon-request detector for King Amen Ra and directory members
    const checkKing = detectTransferRequest('Can you transfer me to King Amen Ra please?');
    assert.equal(checkKing.requested, true);
    assert.equal(checkKing.recipientName, 'King Amen Ra');

    const checkAneesha = detectTransferRequest('Please connect me with Aneesha Sullivan');
    assert.equal(checkAneesha.requested, true);
    assert.equal(checkAneesha.recipientName, 'Aneesha Sullivan, PA');

    const holdSpeech = detectSarahTransferHoldSpeech(
      'Wonderful! Please hold for just a moment while I dial King Amen Ra and get him on the line for you.'
    );
    assert.equal(holdSpeech.triggered, true);
    assert.equal(holdSpeech.recipientName, 'King Amen Ra');

    // 3. Verify live WebSocket session on /api/sarah/live answers 6232230165 and executes transfer upon request
    const ws = new WebSocket(`${wsUrl}?mode=outbound&phone=6232230165&prospect_name=Test%20Beneficiary&state=AZ`);

    const transferEvent = await new Promise<any>((resolve, reject) => {
      const timeout = setTimeout(() => {
        ws.close();
        reject(new Error('Timeout waiting for whisper_transfer_initiated event on 6232230165 test call'));
      }, 15000);

      ws.on('message', (data) => {
        try {
          const msg = JSON.parse(data.toString());
          if (msg.type === 'ready') {
            // Once answered/ready, request transfer on the call
            ws.send(JSON.stringify({ type: 'text', text: 'Yes, please transfer me to King Amen Ra right now!' }));
          } else if (msg.type === 'whisper_transfer_initiated') {
            clearTimeout(timeout);
            resolve(msg.transfer);
          }
        } catch {
          // ignore
        }
      });

      ws.on('error', (err) => {
        clearTimeout(timeout);
        reject(err);
      });
    });

    assert.equal(transferEvent.success, true);
    assert.equal(transferEvent.transfer_status, 'whisper_completed_and_merged');
    assert.equal(transferEvent.telephony_provider, 'google_voice');
    assert.equal(transferEvent.recipient_name, 'King Amen Ra');
    assert.equal(transferEvent.recipient_phone, '+16024569681');
    assert.equal(transferEvent.google_voice_transfer_url, 'https://voice.google.com/u/0/calls?a=nc,%2B16024569681');
    assert.equal(transferEvent.hold_completed, true);
    assert.match(transferEvent.whisper_briefing, /Hi King Amen Ra, this is Sarah AI whispering automatically/i);
    assert.match(transferEvent.merge_introduction, /It is my pleasure to introduce King Amen Ra/i);
    ws.close();
  });

  test('Live WebSocket endpoint /api/sarah/live supports both inbound and outbound modes', async () => {
    const ws = new WebSocket(`${wsUrl}?mode=outbound&prospect_name=Eleanor%20Vance&state=AZ`);

    const readyEvent = await new Promise<any>((resolve, reject) => {
      const timeout = setTimeout(() => {
        ws.close();
        reject(new Error('Timeout waiting for ready event from Sarah Voice AI'));
      }, 15000);

      ws.on('message', (data) => {
        try {
          const msg = JSON.parse(data.toString());
          if (msg.type === 'ready') {
            clearTimeout(timeout);
            resolve(msg);
          }
        } catch {
          // ignore
        }
      });

      ws.on('error', (err) => {
        clearTimeout(timeout);
        reject(err);
      });
    });

    assert.equal(readyEvent.type, 'ready');
    assert.equal(readyEvent.voice, 'Aoede');
    assert.equal(readyEvent.mode, 'outbound');
    assert.equal(readyEvent.line, '(480) 331-9455');
    ws.close();
  });
});
