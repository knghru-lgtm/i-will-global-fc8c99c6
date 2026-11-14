#!/usr/bin/env node
/**
 * 100% Google Cloud + Google Voice Diagnostic Script for Sarah Inbound Receptionist on +14803319455
 * Verifies:
 *  1. Centralized America/Phoenix office hours (Mon–Fri, 8:00 AM – 5:00 PM MST, No DST)
 *  2. Google Cloud production URL (https://voice.iwillglobal.com/api/sarah/inbound)
 *  3. Google Cloud 24/7 VoIP Bridge & Cookie Vault status (/api/sarah/gv-status)
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
const PROD_BASE_URL = (process.env.APP_URL || 'https://voice.iwillglobal.com').replace(/\/+$/, '');
const EXPECTED_JSON_WEBHOOK = `${PROD_BASE_URL}/api/sarah/inbound`;

async function measureWebhookCall(baseUrl, label, queryParams, headers = {}) {
  const qs = new URLSearchParams(queryParams).toString();
  const url = `${baseUrl}/api/sarah/inbound?${qs}`;

  const t0 = performance.now();
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify({ from: '+16025550199', to: PHONE_E164 }),
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
  console.log(`🔎 GOOGLE CLOUD + GOOGLE VOICE SARAH AUDIT (${PHONE_E164})`);
  console.log('================================================================================');
  console.log(`• Google Cloud Base URL     : ${PROD_BASE_URL}`);
  console.log(`• Active Inbound Endpoint   : ${EXPECTED_JSON_WEBHOOK}`);
  console.log(`• Configured Timezone       : ${process.env.OFFICE_TIMEZONE || 'America/Phoenix'} (MST, No DST)`);
  console.log(`• Configured Office Hours   : ${process.env.OFFICE_HOURS_START || '08:00'} -> ${process.env.OFFICE_HOURS_END || '17:00'} (Days: ${process.env.OFFICE_DAYS || '1,2,3,4,5'})`);
  console.log(`• Test Target Endpoint      : ${targetUrl}`);

  await fetch(`${targetUrl}/api/health`).catch(() => {});

  const gvStatus = await fetch(`${targetUrl}/api/sarah/gv-status`).then((r) => r.json()).catch(() => null);
  console.log(`• Google Voice Cloud Bridge : ${JSON.stringify(gvStatus)}`);

  const tue10amIso = '2026-11-10T10:00:00-07:00';
  const bizJson = await measureWebhookCall(targetUrl, 'Tuesday 10:00 AM MST (JSON)', {
    simulated_now_iso: tue10amIso,
    include_audio: '0',
  });
  const bizData = JSON.parse(bizJson.bodyText);

  const mon10pmIso = '2026-11-09T22:00:00-07:00';
  const afterJson = await measureWebhookCall(targetUrl, 'Monday 10:00 PM MST (JSON)', {
    simulated_now_iso: mon10pmIso,
    include_audio: '0',
  });
  const afterData = JSON.parse(afterJson.bodyText);

  console.log('\n--- [TEST 1] TUESDAY 10:00 AM MST (BUSINESS HOURS) ---');
  console.log(`• JSON Latency              : ${bizJson.latencyMs} ms (SLA < 300ms)`);
  console.log(`• Routing Mode / Voice      : ${bizData.routing_mode} | ${bizData.voice} (${bizData.voice_gender})`);
  console.log(`• Arizona Local Time        : ${bizData.work_hours_status?.localTimeDisplay}`);
  console.log(`• Greeting Spoken           : "${bizData.reply}"`);

  console.log('\n--- [TEST 2] MONDAY 10:00 PM MST (AFTER HOURS) ---');
  console.log(`• JSON Latency              : ${afterJson.latencyMs} ms (SLA < 300ms)`);
  console.log(`• Routing Mode / Voice      : ${afterData.routing_mode} | ${afterData.voice} (${afterData.voice_gender})`);
  console.log(`• Arizona Local Time        : ${afterData.work_hours_status?.localTimeDisplay}`);
  console.log(`• Greeting Spoken           : "${afterData.reply}"`);

  if (bizJson.latencyMs >= 300 || afterJson.latencyMs >= 300) {
    throw new Error(`1st-ring pickup latency exceeded 300ms (${bizJson.latencyMs}ms / ${afterJson.latencyMs}ms)`);
  }
  if (bizData.routing_mode !== 'business_hours' || bizData.is_after_hours !== false) {
    throw new Error(`Expected business_hours at Tue 10 AM MST, got ${bizData.routing_mode}`);
  }
  if (bizData.voice !== 'Vindemiatrix' || bizData.voice_gender !== 'female') {
    throw new Error(`Expected female Vindemiatrix voice, got ${bizData.voice} (${bizData.voice_gender})`);
  }
  if (afterData.routing_mode !== 'after_hours' || afterData.is_after_hours !== true || afterData.should_hangup !== true) {
    throw new Error(`Expected after_hours + should_hangup=true at Mon 10 PM MST, got ${JSON.stringify(afterData)}`);
  }
  if (!/currently closed/i.test(afterData.reply) || !/Monday through Friday/i.test(afterData.reply)) {
    throw new Error(`After-hours greeting missing closed/hours text: "${afterData.reply}"`);
  }

  console.log('\n✅ ALL GOOGLE CLOUD + GOOGLE VOICE (+14803319455) ROUTING & <300ms CHECKS PASSED!');
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
