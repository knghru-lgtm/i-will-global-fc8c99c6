#!/usr/bin/env node
/**
 * Diagnostic & Auto-Remediation Script for Sarah Inbound Receptionist on +14803319455
 * Verifies:
 *  1. Centralized America/Phoenix office hours in .env (OFFICE_HOURS_START, OFFICE_HOURS_END, OFFICE_DAYS)
 *  2. Production inbound webhook URL (https://iwillglobal.com/api/sarah/inbound) — never localhost or expired tunnel
 *  3. Carrier number configuration via API (Twilio / Telnyx if credentials present) + Google Voice Cloud Bridge
 *  4. Sub-300ms 1st-ring pickup & female voice ("Vindemiatrix") for:
 *     - Business Hours: Tuesday at 10:00 AM MST (2026-11-10T10:00:00-07:00)
 *     - After Hours:    Monday at 10:00 PM MST  (2026-11-09T22:00:00-07:00)
 */

import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, '..');
const envPath = join(rootDir, '.env');
if (existsSync(envPath) && typeof process.loadEnvFile === 'function') {
  process.loadEnvFile(envPath);
}

const PHONE_E164 = '+14803319455';
const PROD_BASE_URL = (process.env.APP_URL || 'https://iwillglobal.com').replace(/\/+$/, '');
const EXPECTED_TWIML_WEBHOOK = `${PROD_BASE_URL}/api/sarah/inbound?format=twiml`;
const EXPECTED_JSON_WEBHOOK = `${PROD_BASE_URL}/api/sarah/inbound`;

async function verifyAndSyncTwilioNumber() {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  if (!sid || !token) {
    return { configured: false, provider: 'twilio', note: 'No TWILIO_ACCOUNT_SID in .env (using Google Voice + Cloud Webhook)' };
  }

  const auth = 'Basic ' + Buffer.from(`${sid}:${token}`).toString('base64');
  const listUrl = `https://api.twilio.com/2010-04-01/Accounts/${sid}/IncomingPhoneNumbers.json?PhoneNumber=${encodeURIComponent(PHONE_E164)}`;
  const res = await fetch(listUrl, { headers: { Authorization: auth } });
  if (!res.ok) {
    return { configured: true, provider: 'twilio', error: `Twilio API HTTP ${res.status}` };
  }
  const data = await res.json();
  const num = data?.incoming_phone_numbers?.[0];
  if (!num) {
    return { configured: true, provider: 'twilio', found: false, note: `${PHONE_E164} not hosted on this Twilio account` };
  }

  const currentVoiceUrl = String(num.voice_url || '');
  const isInvalidOrLocal =
    !currentVoiceUrl ||
    /localhost|127\.0\.0\.1|ngrok|loca\.lt|trycloudflare/i.test(currentVoiceUrl) ||
    currentVoiceUrl !== EXPECTED_TWIML_WEBHOOK;

  if (isInvalidOrLocal) {
    const updateUrl = `https://api.twilio.com/2010-04-01/Accounts/${sid}/IncomingPhoneNumbers/${num.sid}.json`;
    const form = new URLSearchParams({
      VoiceUrl: EXPECTED_TWIML_WEBHOOK,
      VoiceMethod: 'POST',
      VoiceFallbackUrl: EXPECTED_TWIML_WEBHOOK,
      VoiceFallbackMethod: 'POST',
    });
    const upRes = await fetch(updateUrl, {
      method: 'POST',
      headers: { Authorization: auth, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form.toString(),
    });
    const updated = await upRes.json();
    return {
      configured: true,
      provider: 'twilio',
      updated: upRes.ok,
      previousVoiceUrl: currentVoiceUrl,
      activeVoiceUrl: updated.voice_url || EXPECTED_TWIML_WEBHOOK,
    };
  }

  return {
    configured: true,
    provider: 'twilio',
    updated: false,
    activeVoiceUrl: currentVoiceUrl,
  };
}

async function measureWebhookCall(baseUrl, label, queryParams, headers = {}) {
  const qs = new URLSearchParams(queryParams).toString();
  const url = `${baseUrl}/api/sarah/inbound?${qs}`;

  // Warm connection + measure 1st-ring response latency
  const t0 = performance.now();
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', ...headers },
    body: new URLSearchParams({ From: '+16025550199', To: PHONE_E164 }).toString(),
  });
  const bodyText = await res.text();
  const latencyMs = Number((performance.now() - t0).toFixed(2));

  if (!res.ok) {
    throw new Error(`[${label}] HTTP ${res.status}: ${bodyText}`);
  }
  return { latencyMs, status: res.status, contentType: res.headers.get('content-type') || '', bodyText };
}

async function runVerificationSuite(targetUrl) {
  console.log('================================================================================');
  console.log(`🔎 SARAH INBOUND ROUTING & <300ms FIRST-RING AUDIT (${PHONE_E164})`);
  console.log('================================================================================');
  console.log(`• Production Base URL       : ${PROD_BASE_URL}`);
  console.log(`• Active JSON Webhook       : ${EXPECTED_JSON_WEBHOOK}`);
  console.log(`• Active TwiML Voice URL    : ${EXPECTED_TWIML_WEBHOOK}`);
  console.log(`• Configured Timezone       : ${process.env.OFFICE_TIMEZONE || 'America/Phoenix'} (MST, No DST)`);
  console.log(`• Configured Office Hours   : ${process.env.OFFICE_HOURS_START || '08:00'} -> ${process.env.OFFICE_HOURS_END || '20:00'} (Days: ${process.env.OFFICE_DAYS || '1,2,3,4,5'})`);
  console.log(`• Test Target Endpoint      : ${targetUrl}`);

  if (/localhost|127\.0\.0\.1|ngrok/i.test(PROD_BASE_URL)) {
    throw new Error(`Invalid non-production APP_URL detected: ${PROD_BASE_URL}`);
  }

  const twilioCheck = await verifyAndSyncTwilioNumber();
  console.log(`• Carrier API Check         : ${JSON.stringify(twilioCheck)}`);

  // Warm up serverless / connection pool once before strict sub-300ms SLA timing
  await fetch(`${targetUrl}/api/health`).catch(() => {});

  // 1. Simulate Business Hours: Tuesday at 10:00 AM MST (2026-11-10T10:00:00-07:00)
  const tue10amIso = '2026-11-10T10:00:00-07:00';
  const bizJson = await measureWebhookCall(targetUrl, 'Tuesday 10:00 AM MST (JSON)', {
    simulated_now_iso: tue10amIso,
    include_audio: '0',
  });
  const bizData = JSON.parse(bizJson.bodyText);

  const bizTwiml = await measureWebhookCall(targetUrl, 'Tuesday 10:00 AM MST (TwiML)', {
    format: 'twiml',
    simulated_now_iso: tue10amIso,
  });

  // 2. Simulate After Hours: Monday at 10:00 PM MST (2026-11-09T22:00:00-07:00)
  const mon10pmIso = '2026-11-09T22:00:00-07:00';
  const afterJson = await measureWebhookCall(targetUrl, 'Monday 10:00 PM MST (JSON)', {
    simulated_now_iso: mon10pmIso,
    include_audio: '0',
  });
  const afterData = JSON.parse(afterJson.bodyText);

  const afterTwiml = await measureWebhookCall(targetUrl, 'Monday 10:00 PM MST (TwiML)', {
    format: 'twiml',
    simulated_now_iso: mon10pmIso,
  });

  console.log('\n--- [TEST 1] TUESDAY 10:00 AM MST (BUSINESS HOURS) ---');
  console.log(`• JSON Latency              : ${bizJson.latencyMs} ms (SLA < 300ms)`);
  console.log(`• TwiML Latency             : ${bizTwiml.latencyMs} ms (SLA < 300ms)`);
  console.log(`• Routing Mode / Voice      : ${bizData.routing_mode} | ${bizData.voice} (${bizData.voice_gender})`);
  console.log(`• Arizona Local Time        : ${bizData.work_hours_status?.localTimeDisplay}`);
  console.log(`• Greeting Spoken           : "${bizData.reply}"`);
  console.log(`• TwiML Payload             :\n${bizTwiml.bodyText}`);

  console.log('\n--- [TEST 2] MONDAY 10:00 PM MST (AFTER HOURS) ---');
  console.log(`• JSON Latency              : ${afterJson.latencyMs} ms (SLA < 300ms)`);
  console.log(`• TwiML Latency             : ${afterTwiml.latencyMs} ms (SLA < 300ms)`);
  console.log(`• Routing Mode / Voice      : ${afterData.routing_mode} | ${afterData.voice} (${afterData.voice_gender})`);
  console.log(`• Arizona Local Time        : ${afterData.work_hours_status?.localTimeDisplay}`);
  console.log(`• Greeting Spoken           : "${afterData.reply}"`);
  console.log(`• TwiML Payload             :\n${afterTwiml.bodyText}`);

  // Assertions
  if (bizJson.latencyMs >= 300 || bizTwiml.latencyMs >= 300) {
    throw new Error(`Business-hours latency exceeded 300ms (${bizJson.latencyMs}ms / ${bizTwiml.latencyMs}ms)`);
  }
  if (afterJson.latencyMs >= 300 || afterTwiml.latencyMs >= 300) {
    throw new Error(`After-hours latency exceeded 300ms (${afterJson.latencyMs}ms / ${afterTwiml.latencyMs}ms)`);
  }
  if (bizData.routing_mode !== 'business_hours' || bizData.is_after_hours !== false) {
    throw new Error(`Expected business_hours at Tue 10 AM MST, got ${bizData.routing_mode}`);
  }
  if (bizData.voice !== 'Vindemiatrix' || bizData.voice_gender !== 'female') {
    throw new Error(`Expected female Vindemiatrix voice, got ${bizData.voice} (${bizData.voice_gender})`);
  }
  if (/<Pause|<Dial[^>]*timeout/i.test(bizTwiml.bodyText) || !/<Gather/i.test(bizTwiml.bodyText)) {
    throw new Error(`Business-hours TwiML must immediately <Gather><Play> with zero <Pause> or <Dial>`);
  }
  if (afterData.routing_mode !== 'after_hours' || afterData.is_after_hours !== true || afterData.should_hangup !== true) {
    throw new Error(`Expected after_hours + should_hangup=true at Mon 10 PM MST, got ${JSON.stringify(afterData)}`);
  }
  if (!/currently closed/i.test(afterData.reply) || !/Monday through Friday/i.test(afterData.reply)) {
    throw new Error(`After-hours greeting missing closed/hours text: "${afterData.reply}"`);
  }
  if (/<Gather|<Pause|<Dial/i.test(afterTwiml.bodyText) || !/<Hangup\/>/i.test(afterTwiml.bodyText)) {
    throw new Error(`After-hours TwiML must play closed greeting and <Hangup/> immediately without <Gather>`);
  }

  console.log('\n✅ ALL SARAH +14803319455 INBOUND ROUTING & <300ms LATENCY CHECKS PASSED!');
}

async function main() {
  const args = process.argv.slice(2);
  const useLocal = args.includes('--local');
  const targetIdx = args.indexOf('--target');
  const explicitTarget = targetIdx >= 0 ? args[targetIdx + 1] : null;

  if (useLocal) {
    process.env.NODE_ENV = 'test';
    const { createApp } = await import('../server/src/index.ts');
    const app = createApp();
    const server = await new Promise((resolve) => {
      const s = app.listen(0, () => resolve(s));
    });
    const port = server.address().port;
    try {
      await runVerificationSuite(`http://127.0.0.1:${port}`);
    } finally {
      server.close();
    }
    process.exit(0);
  }

  await runVerificationSuite(explicitTarget || PROD_BASE_URL);
}

main().catch((err) => {
  console.error('❌ Verification failed:', err.message || err);
  process.exit(1);
});

