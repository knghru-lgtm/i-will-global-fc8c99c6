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
import { sendSarahCall } from '../src/services/sarahDialer.ts';

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

  test('Inbound Receptionist mode prompt includes (480) 331-9455, 42-member directory, and Whisper Transfer protocol', () => {
    const inboundPrompt = buildSarahSystemInstruction({ mode: 'inbound', force_work_hours: true });
    assert.match(inboundPrompt, /MODE 1: RECEPTIONIST WHEN PEOPLE CALL \(480\) 331-9455/i);
    assert.match(inboundPrompt, /Thank you for calling IWG Insurance and Financial Services/i);
    assert.match(inboundPrompt, /King Amen Ra/i);
    assert.match(inboundPrompt, /Aneesha Sullivan, PA/i);
    assert.match(inboundPrompt, /30-minute Telephone/i);
    assert.match(inboundPrompt, /60-minute In-Person/i);
    assert.match(inboundPrompt, /30-minute Video/i);
  });

  test('Outbound Caller mode prompt includes the complete 4-Step Outbound Script & Decision Tree on (480) 331-9455', () => {
    const outboundPrompt = buildSarahSystemInstruction({
      mode: 'outbound',
      prospect_name: 'Eleanor Vance',
      prospect_phone: '(480) 555-0199',
      state: 'AZ',
      address: '742 Evergreen Terrace, Scottsdale, AZ',
      force_work_hours: true,
    });
    assert.match(outboundPrompt, /MODE 2: OUTBOUND CALLER ON \(480\) 331-9455/i);
    assert.match(outboundPrompt, /Eleanor Vance/);
    assert.match(outboundPrompt, /STEP 1A/i);
    assert.match(outboundPrompt, /STEP 1B/i);
    assert.match(outboundPrompt, /\$1,788/i);
    assert.match(outboundPrompt, /\$209\.50/i);
    assert.match(outboundPrompt, /\$2,400/);
    assert.match(outboundPrompt, /Path A/i);
    assert.match(outboundPrompt, /Path B/i);
    assert.match(outboundPrompt, /6-PRODUCT-LINE ISOLATION/i);
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
    const res = await executeSarahTool(
      'whisper_warm_transfer',
      {
        recipient_name: 'King Amen Ra',
        customer_name: 'Eleanor Vance',
        customer_phone: '(480) 555-0199',
        customer_state: 'AZ',
        reason_for_call: '2027 Medicare Part D $2,400 cap and zero-premium advantage review',
        force_live_connect: true,
      },
      { mode: 'inbound', force_work_hours: true, force_live_connect: true }
    );

    assert.equal(res.success, true);
    assert.equal(res.recipient_name, 'King Amen Ra');
    assert.equal(res.recipient_phone, '+16024569681');
    assert.equal(res.originating_line, '+14803319455');
    assert.match(res.private_whisper_delivered, /King/i);
    assert.match(res.merge_announcement, /King Amen Ra/i);
  });

  test('Tool: book_appointment creates lead and confirms appointment with King Amen Ra in CRM', async () => {
    const testName = 'Sarah Test Prospect';
    const testPhone = '(480) 555-8899';
    const testDatetime = 'Tomorrow at 10:00 AM';

    const res = await executeSarahTool(
      'book_appointment',
      {
        customer_name: testName,
        phone: testPhone,
        address: '742 Evergreen Terrace, Scottsdale, AZ 85251',
        appointment_type: 'Telephone',
        preferred_datetime: testDatetime,
        state: 'AZ',
        notes: 'Interested in 2027 Medicare Part D $2,400 cap review',
      },
      { mode: 'inbound', force_work_hours: true }
    );

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

  test('GET and POST /api/sarah/inbound picks up all calls on (480) 331-9455, executes Whisper Warm Transfer, and books appointments', async () => {
    const res = await fetch(`${baseUrl}/api/sarah/inbound?force_work_hours=true&include_audio=0`);
    assert.equal(res.status, 200);
    const body: any = await res.json();
    assert.equal(body.ok, true);
    assert.equal(body.status, 'answered_internally');
    assert.equal(body.routing_mode, 'business_hours');
    assert.equal(body.voice, 'Vindemiatrix');
    assert.equal(body.voice_gender, 'female');
    assert.equal(body.line, '(480) 331-9455');
    assert.equal(body.line_e164, '+14803319455');
    assert.ok(body.directory_count >= 42);

    // Test POST inbound call requesting King Amen Ra (Automatic AI Whisper Transfer) and booking a Telephone appointment
    const postRes = await fetch(`${baseUrl}/api/sarah/inbound`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: '(480) 555-3322',
        caller_name: 'Martha Stewart',
        address: '100 E Camelback Rd, Phoenix, AZ 85012',
        requested_person: 'King Amen Ra',
        appointment_type: 'Telephone',
        preferred_datetime: 'Tomorrow at 2:00 PM',
        state: 'AZ',
        force_work_hours: true,
        skip_inline_tts: true,
      }),
    });
    assert.equal(postRes.status, 200);
    const postBody: any = await postRes.json();
    assert.equal(postBody.ok, true);
    assert.equal(postBody.status, 'answered_internally');
    assert.ok(postBody.activity_id, 'Inbound call should be logged in CRM activities');
    assert.equal(postBody.transfer_result.recipient_name, 'King Amen Ra');
    assert.equal(postBody.transfer_result.recipient_phone, '+16024569681');
    assert.equal(postBody.appointment_result.appointment_type, 'Telephone');
  });

  test('Autonomous Outbound Dialer on (480) 331-9455 calls assigned leads, schedules appointments, and executes Whisper Warm Transfers', async () => {
    const { setSarahCampaignActive, runSarahAutoDialerTick, SARAH_AI_USER_ID } = await import('../src/services/sarahDialer.ts');
    const { insert: dbInsert } = await import('../src/db/index.ts');

    const assignedLead = await dbInsert<{ id: string }>('leads', {
      first_name: 'Arthur',
      last_name: 'Pendelton',
      phone: '(480) 555-9911',
      state: 'AZ',
      status: 'New',
      owner_id: SARAH_AI_USER_ID,
      assigned_agent_id: SARAH_AI_USER_ID,
    });

    await setSarahCampaignActive(true);
    const tick = await runSarahAutoDialerTick({ reason: 'activate', force: true });

    assert.equal(tick.ok, true);
    assert.ok(tick.dispatched.length >= 1, 'Should dispatch outbound calls to assigned leads');
    const matched = tick.dispatched.find((d: any) => d.lead_id === assignedLead.id) || tick.dispatched[0];
    assert.equal(matched.line_number, '+14803319455');
    assert.ok(matched.appointment_event_id || matched.whisper_briefing, 'Should execute appointment or whisper warm transfer');
  });

  test('Test call to 6232230165 (+16232230165) is answered and transferred upon request via Live WebSocket & Google Voice', async () => {
    // 1. Verify outbound call dispatch to 6232230165 is answered and ready for transfer upon request
    const callRes = await sendSarahCall({
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
    const ws = new WebSocket(`${wsUrl}?mode=outbound&phone=6232230165&prospect_name=Test%20Beneficiary&state=AZ&force_work_hours=true&force_live_connect=true`);

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

    ws.close();
    assert.equal(transferEvent.success, true);
    assert.equal(transferEvent.telephony_provider, 'google_voice');
    assert.equal(transferEvent.recipient_name, 'King Amen Ra');
    assert.equal(transferEvent.recipient_phone, '+16024569681');
    assert.equal(transferEvent.google_voice_transfer_url, 'https://voice.google.com/u/0/calls?a=nc,%2B16024569681');
    assert.match(transferEvent.private_whisper_delivered || transferEvent.whisper_briefing, /King/i);
    assert.match(transferEvent.merge_announcement || transferEvent.merge_introduction, /King Amen Ra/i);
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
    assert.equal(readyEvent.voice, 'Vindemiatrix');
    assert.equal(readyEvent.mode, 'outbound');
    assert.equal(readyEvent.line, '(480) 331-9455');
    ws.close();
  });

  test('Instant <300ms 1st-ring America/Phoenix Business-Hours (Tue 10 AM MST) vs After-Hours (Mon 10 PM MST) routing on +14803319455', async () => {
    // 1. Tuesday 10:00 AM MST -> Business Hours
    const t0 = performance.now();
    const tueRes = await fetch(
      `${baseUrl}/api/sarah/inbound?simulated_now_iso=${encodeURIComponent('2026-11-10T10:00:00-07:00')}&include_audio=0`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ from: '+16025550111' }) }
    );
    const tueJson: any = await tueRes.json();
    const tueMs = performance.now() - t0;
    assert.equal(tueRes.status, 200);
    assert.ok(tueMs < 300, `Expected <300ms 1st-ring business-hours pickup, got ${tueMs.toFixed(2)}ms`);
    assert.equal(tueJson.routing_mode, 'business_hours');
    assert.equal(tueJson.is_after_hours, false);
    assert.equal(tueJson.should_hangup, false);
    assert.equal(tueJson.voice, 'Vindemiatrix');
    assert.equal(tueJson.voice_gender, 'female');
    assert.match(tueJson.reply, /This is Sarah speaking\. How may I direct your call today\?/i);

    const tueTwiml = await fetch(
      `${baseUrl}/api/sarah/inbound?format=twiml&simulated_now_iso=${encodeURIComponent('2026-11-10T10:00:00-07:00')}`,
      { method: 'POST' }
    ).then((r) => r.text());
    assert.match(tueTwiml, /<Gather/);
    assert.doesNotMatch(tueTwiml, /<Pause/);

    // 2. Monday 10:00 PM MST -> After Hours
    const t1 = performance.now();
    const monRes = await fetch(
      `${baseUrl}/api/sarah/inbound?simulated_now_iso=${encodeURIComponent('2026-11-09T22:00:00-07:00')}&include_audio=0`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ from: '+16025550112' }) }
    );
    const monJson: any = await monRes.json();
    const monMs = performance.now() - t1;
    assert.equal(monRes.status, 200);
    assert.ok(monMs < 300, `Expected <300ms 1st-ring after-hours pickup, got ${monMs.toFixed(2)}ms`);
    assert.equal(monJson.routing_mode, 'after_hours');
    assert.equal(monJson.is_after_hours, true);
    assert.equal(monJson.should_hangup, true);
    assert.equal(monJson.warm_transfers_allowed_now, false);
    assert.equal(monJson.voice, 'Vindemiatrix');
    assert.equal(monJson.voice_gender, 'female');
    assert.match(monJson.reply, /Thank you for calling I Will Global\. Our office is currently closed/i);

    const monTwiml = await fetch(
      `${baseUrl}/api/sarah/inbound?format=twiml&simulated_now_iso=${encodeURIComponent('2026-11-09T22:00:00-07:00')}`,
      { method: 'POST' }
    ).then((r) => r.text());
    assert.match(
      monTwiml,
      /(<Play>.*preset=after_hours.*<\/Play>|<Say[^>]*>Thank you for calling I Will Global\. Our office is currently closed\. Our regular business hours are Monday through Friday, from 8 AM to 5 PM Arizona time\. Please call us back during normal business hours\. Have a wonderful day\.<\/Say>)/
    );
    assert.match(monTwiml, /<Hangup\/>/);
    assert.doesNotMatch(monTwiml, /<Gather/);
  });

  test('Serverless HTTP endpoints /api/sarah/turn and /api/sarah/tool support iwillglobal.com voice & warm transfers', async () => {
    // 1. Initial outbound greeting turn
    const initRes = await fetch(`${baseUrl}/api/sarah/turn`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        is_initial: true,
        skip_inline_tts: true,
        context: {
          mode: 'outbound',
          prospect_name: 'Arthur Pendelton',
          prospect_phone: '6232230165',
          state: 'AZ',
        },
      }),
    }).then((r) => r.json());

    assert.equal(initRes.ok, true);
    assert.equal(initRes.line, '(480) 331-9455');
    assert.match(initRes.reply, /Hello Arthur, this is Sarah calling from the Medicare Helpline/i);

    // 2. Request a live warm transfer to King Amen Ra via /api/sarah/turn
    const transferRes = await fetch(`${baseUrl}/api/sarah/turn`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: 'Yes, please transfer me to King Amen Ra right now!',
        skip_inline_tts: true,
        context: {
          mode: 'outbound',
          prospect_name: 'Arthur Pendelton',
          prospect_phone: '6232230165',
          state: 'AZ',
          force_work_hours: true,
        },
      }),
    }).then((r) => r.json());

    assert.equal(transferRes.ok, true);
    assert.ok(transferRes.transfer);
    assert.equal(transferRes.transfer.success, true);
    assert.equal(transferRes.transfer.recipient_name, 'King Amen Ra');
    assert.equal(transferRes.transfer.recipient_phone, '+16024569681');
    assert.equal(transferRes.transfer.google_voice_transfer_url, 'https://voice.google.com/u/0/calls?a=nc,%2B16024569681');

    // 3. Direct tool endpoint /api/sarah/tool
    const toolRes = await fetch(`${baseUrl}/api/sarah/tool`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'get_cms_benefit_data',
        args: { query_type: 'part_b_giveback', state: 'AZ' },
      }),
    }).then((r) => r.json());

    assert.equal(toolRes.ok, true);
    assert.equal(toolRes.result.success, true);
    assert.match(toolRes.result.medicare_2027.part_a_hospital_deductible, /1,788/i);
  });
});
