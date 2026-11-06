process.env.NODE_ENV = 'test';

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/index.ts';
import { getDb, closeDb, one, insert } from '../src/db/index.ts';
import { ensureSeeded } from '../src/db/seed.ts';
import type { Server } from 'node:http';

let server: Server;
let baseUrl: string;
let principalToken: string;
let schedulerToken: string;

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

describe('Bland AI Conversational Voice Agent Integration', () => {
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

    const princRes = await request('/api/auth/login', {
      method: 'POST',
      body: { email: 'king@iwillglobal.com', password: 'Heru5464' },
    });
    principalToken = princRes.json.token;

    const schRes = await request('/api/auth/login', {
      method: 'POST',
      body: { email: 'jakeeta@iwillglobal.com', password: 'Welcome123!' },
    });
    schedulerToken = schRes.json.token;
  });

  after(async () => {
    if (server) server.close();
    await closeDb();
  });

  test('GET /api/bland/config returns configuration with default voice, pathway_id and Medicare prompt', async () => {
    const res = await request('/api/bland/config', { token: principalToken });
    assert.equal(res.status, 200);
    assert.equal(res.json.default_voice, 'maya');
    assert.equal(res.json.model, 'enhanced');
    assert.equal(res.json.pathway_id, 'fc8c99c6-88c3-435d-952b-8c93c2db17a6');
    assert.equal(res.json.from_number, '+14803319455');
    assert.ok(res.json.prompt_template.includes('TPMO Disclaimer'));
    assert.ok(res.json.prompt_template.includes('King Amen Ra'));
  });

  test('POST /api/bland/config saves updated settings for admin', async () => {
    const res = await request('/api/bland/config', {
      method: 'POST',
      token: principalToken,
      body: {
        default_voice: 'nat',
        transfer_phone_number: '+14803319455',
        pathway_id: '3b13b658-e85d-4d14-a24a-868b61040c42',
      },
    });
    assert.equal(res.status, 200);
    assert.equal(res.json.success, true);
    assert.equal(res.json.config.default_voice, 'nat');
    assert.equal(res.json.config.transfer_phone_number, '+14803319455');
    assert.equal(res.json.config.pathway_id, '3b13b658-e85d-4d14-a24a-868b61040c42');
  });

  test('POST /api/bland/config rejects non-admin/non-manager roles with 403', async () => {
    const res = await request('/api/bland/config', {
      method: 'POST',
      token: schedulerToken,
      body: { default_voice: 'josh' },
    });
    assert.equal(res.status, 403);
    assert.ok(res.json.error.includes('Only administrators'));
  });

  test('GET /api/bland/voices returns available voice personas', async () => {
    const res = await request('/api/bland/voices', { token: principalToken });
    assert.equal(res.status, 200);
    assert.ok(Array.isArray(res.json.voices));
    const maya = res.json.voices.find((v: any) => v.id === 'maya');
    assert.ok(maya);
    assert.equal(maya.gender, 'Female');
    assert.equal(maya.is_recommended, true);
  });

  test('POST /api/bland/call dispatches Bland AI call and creates In Progress activity', async () => {
    const testLead = await insert<{ id: string }>('leads', {
      first_name: 'BlandTest',
      last_name: 'Beneficiary',
      phone: '4805557788',
      state: 'AZ',
      status: 'New',
    });

    const res = await request('/api/bland/call', {
      method: 'POST',
      token: principalToken,
      body: {
        lead_id: testLead.id,
        voice: 'maya',
      },
    });

    assert.equal(res.status, 200);
    assert.equal(res.json.success, true);
    assert.ok(res.json.call_id);
    assert.ok(res.json.activity_id);

    // Verify activity record in DB
    const act = await one<any>(`SELECT * FROM activities WHERE id = $1`, [res.json.activity_id]);
    assert.ok(act);
    assert.equal(act.provider, 'bland_ai');
    assert.equal(act.status, 'In Progress');
    assert.equal(act.meta?.bland_call_id, res.json.call_id);
  });

  test('POST /api/bland/webhook receives call transcript, summary, audio and completes activity', async () => {
    // 1. Create lead and initial Bland call
    const lead = await insert<{ id: string }>('leads', {
      first_name: 'Webhook',
      last_name: 'Tester',
      phone: '4805558899',
      state: 'AZ',
      status: 'New',
    });

    const dispatchRes = await request('/api/bland/call', {
      method: 'POST',
      token: principalToken,
      body: {
        lead_id: lead.id,
        voice: 'nat',
      },
    });

    const callId = dispatchRes.json.call_id;

    // 2. Simulate Bland AI sending webhook callback
    const webhookRes = await request('/api/bland/webhook', {
      method: 'POST',
      body: {
        call_id: callId,
        call_length: 2.5,
        status: 'completed',
        answered_by: 'human',
        summary: 'Beneficiary Eleanor is turning 65 in December and requested an appointment to review Medigap Plan G with King Amen Ra.',
        concatenated_transcript: 'Agent: Hi Eleanor, this is Sarah with the Medicare Helpline at I Will Global.\nUser: Yes, I am turning 65 soon and need help choosing a plan.\nAgent: Wonderful, I can book an appointment with licensed agent King Amen Ra tomorrow at 10 AM.',
        recording_url: 'https://api.bland.ai/recordings/test_rec_123.mp3',
        metadata: {
          lead_id: lead.id,
        },
      },
    });

    assert.equal(webhookRes.status, 200);
    assert.equal(webhookRes.json.success, true);

    // 3. Verify activity was updated to Completed with audio recording and transcript
    const updatedAct = await one<any>(`SELECT * FROM activities WHERE meta->>'bland_call_id' = $1`, [callId]);
    assert.ok(updatedAct);
    assert.equal(updatedAct.status, 'Completed');
    assert.equal(updatedAct.completed, true);
    assert.equal(updatedAct.disposition_id, 'appointment_set');
    assert.equal(updatedAct.meta?.recording_url, 'https://api.bland.ai/recordings/test_rec_123.mp3');
    assert.ok(updatedAct.body.includes('Beneficiary Eleanor is turning 65'));

    // 4. Verify GET /api/bland/calls/:call_id returns details
    const detailsRes = await request(`/api/bland/calls/${callId}`, { token: principalToken });
    assert.equal(detailsRes.status, 200);
    assert.equal(detailsRes.json.recording_url, 'https://api.bland.ai/recordings/test_rec_123.mp3');
  });

  test('POST /api/bland/test-call dispatches instant test call to specified phone', async () => {
    const res = await request('/api/bland/test-call', {
      method: 'POST',
      token: principalToken,
      body: {
        test_phone: '(602) 456-9681',
        voice: 'maya',
      },
    });

    assert.equal(res.status, 200);
    assert.equal(res.json.success, true);
    assert.ok(res.json.call_id);
    assert.ok(res.json.message.includes('dispatched'));
  });
});
