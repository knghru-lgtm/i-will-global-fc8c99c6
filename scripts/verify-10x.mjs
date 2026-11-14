#!/usr/bin/env node
/**
 * 10x End-to-End Verification Suite for IWG Sarah 24/7 Cloud Receptionist (+14803319455)
 * Runs 10 complete verification rounds testing:
 *   1. Encrypted Cookie Vault update (/api/sarah/gv-session-sync POST + GET, updated cookieVaultCount)
 *   2. Cloud Daemon Heartbeat & /api/sarah/gv-status asserting ALL booleans === true
 *      (online, cloudDaemonOnline, laptopIndependent, sessionAuthenticated, WebRTC Isolation ACTIVE)
 *   3. Ephemeral /gv-login/:token HTTP + binary WebSocket tunnel & instant 404 seal when token removed
 *   4. Business-Hours (America/Phoenix MST) 1st-ring greeting + multi-turn Sarah response
 *   5. After-Hours (America/Phoenix MST) closed-office greeting + hangup=true
 *
 * Usage:
 *   - Standalone self-contained mode (starts local Express + WS server): `node scripts/verify-10x.mjs`
 *   - Live VM production check against running sarah-server (:4000):     `node scripts/verify-10x.mjs --live`
 */
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocket, WebSocketServer } from 'ws';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const isLiveMode = process.argv.includes('--live');
const BRIDGE_TOKEN = process.env.GV_BRIDGE_TOKEN || 'iwg-sarah-cloud-bridge-v10-9455';

const CUSTOMER_SCENARIOS = [
  { name: 'Martha Jenkins', phone: '+14805550101', utterance: 'Hi Sarah, I am turning 65 next month in Phoenix and need Medicare help.' },
  { name: 'Robert Alvarez', phone: '+16025550102', utterance: 'Hello, I want to compare life insurance and final expense options.' },
  { name: 'Evelyn Carter', phone: '+16235550103', utterance: 'Can I schedule an appointment with King Amen Ra about rolling over my 401k?' },
  { name: 'David Nguyen', phone: '+14805550104', utterance: 'Hi, our small business in Scottsdale needs group health benefits for 12 employees.' },
  { name: ' Patricia Brooks', phone: '+15205550105', utterance: 'I need ACA health insurance coverage for my family in Arizona.' },
  { name: 'James Miller', phone: '+16025550106', utterance: 'Good morning, I would like a dental and vision plan review.' },
  { name: 'Linda Morales', phone: '+14805550107', utterance: 'Please connect me with a licensed advisor for Medicare Advantage.' },
  { name: 'Charles Thompson', phone: '+16235550108', utterance: 'I am looking for fixed index annuities with principal protection.' },
  { name: 'Barbara White', phone: '+14805550109', utterance: 'Do you charge any broker fees to compare Medicare Supplement plans?' },
  { name: 'Anthony Davis', phone: '+16025550110', utterance: 'Hi Sarah, can you transfer me to King Amen Ra please?' },
];

async function main() {
  let baseUrl = process.env.VERIFY_BASE_URL || 'http://127.0.0.1:4000';
  let appServer = null;
  let mockVncServer = null;
  const tokenFile = path.join(repoRoot, 'server', 'data', 'gv-login-token.txt');

  if (!isLiveMode) {
    process.env.NODE_ENV = 'test';

    const mockVncWss = new WebSocketServer({
      noServer: true,
      handleProtocols: (protocols) => (protocols.has('binary') ? 'binary' : false),
    });
    mockVncWss.on('connection', (ws) => {
      ws.on('message', (data) => {
        ws.send(Buffer.concat([Buffer.from('OK:'), Buffer.isBuffer(data) ? data : Buffer.from(String(data))]));
      });
    });
    mockVncServer = http.createServer((req, res) => {
      if (req.url?.startsWith('/vnc.html')) {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end('<!doctype html><title>noVNC</title>');
        return;
      }
      res.writeHead(200, { 'Content-Type': 'text/plain' }).end('ok');
    });
    mockVncServer.on('upgrade', (req, socket, head) => {
      mockVncWss.handleUpgrade(req, socket, head, (ws) => mockVncWss.emit('connection', ws, req));
    });
    await new Promise((r) => mockVncServer.listen(0, '127.0.0.1', r));
    process.env.GV_VNC_PORT = String(mockVncServer.address().port);

    const { createApp, attachSarahWebSocket } = await import('../api/index.js');
    const app = createApp();
    appServer = http.createServer(app);
    attachSarahWebSocket(appServer);
    await new Promise((r) => appServer.listen(0, '127.0.0.1', r));
    baseUrl = `http://127.0.0.1:${appServer.address().port}`;
  }

  console.log(`\n=== Running 10x Complete End-to-End Verification against ${baseUrl} (${isLiveMode ? 'LIVE VM' : 'BUNDLED API'}) ===\n`);

  const results = [];

  try {
    for (let i = 0; i < 10; i++) {
      const round = i + 1;
      const scenario = CUSTOMER_SCENARIOS[i];
      const t0 = Date.now();

      // 1. Health check
      const healthRes = await fetch(`${baseUrl}/api/health`);
      assert.equal(healthRes.status, 200, `Round ${round}: /api/health must return 200`);
      const health = await healthRes.json();
      assert.equal(health.ok, true);
      assert.equal(health.line, '+14803319455');

      if (!isLiveMode) {
        // 2. Cookie Vault Update + Decryption Roundtrip (varying cookie count 90..99 to prove live update each round)
        const expectedCount = 90 + i;
        const freshCookies = [
          { name: 'SID', value: `linux-sid-r${round}`, domain: '.google.com', path: '/', secure: false, httpOnly: false },
          { name: 'HSID', value: `linux-hsid-r${round}`, domain: '.google.com', path: '/', secure: true, httpOnly: true },
          { name: 'SSID', value: `linux-ssid-r${round}`, domain: '.google.com', path: '/', secure: true, httpOnly: true },
          { name: '__Secure-1PSID', value: `linux-1psid-r${round}`, domain: '.google.com', path: '/', secure: true, httpOnly: true },
          { name: '__Secure-1PSIDTS', value: `linux-1psidts-r${round}-${Date.now()}`, domain: '.google.com', path: '/', secure: true, httpOnly: true },
          { name: 'LSID', value: `linux-lsid-r${round}`, domain: 'accounts.google.com', hostOnly: true, path: '/', secure: true, httpOnly: true },
          ...Array.from({ length: expectedCount - 6 }, (_, k) => ({
            name: `GV_EXTRA_${k}`,
            value: `val_${round}_${k}`,
            domain: '.voice.google.com',
            path: '/',
            secure: true,
            httpOnly: false,
          })),
        ];

        const syncPost = await fetch(`${baseUrl}/api/sarah/gv-session-sync`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-iwg-bridge-token': BRIDGE_TOKEN },
          body: JSON.stringify({
            cookies: freshCookies,
            userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
            source: `verify-10x-round-${round}`,
          }),
        });
        assert.equal(syncPost.status, 200, `Round ${round}: POST /api/sarah/gv-session-sync must succeed`);
        const syncJson = await syncPost.json();
        assert.equal(syncJson.ok, true);
        assert.equal(syncJson.count, expectedCount);

        const syncGet = await fetch(`${baseUrl}/api/sarah/gv-session-sync`, {
          headers: { 'x-iwg-bridge-token': BRIDGE_TOKEN },
        });
        assert.equal(syncGet.status, 200);
        const vault = await syncGet.json();
        assert.equal(vault.count, expectedCount);

        // 3. Cloud Daemon Heartbeat
        const hbRes = await fetch(`${baseUrl}/api/sarah/gv-heartbeat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            runner: 'cloud-daemon',
            instanceId: `gcloud-us-west1-verify-${round}`,
            region: 'us-west1',
            extensionBuild: '2026-11-14-v14',
            url: 'https://voice.google.com/u/0/calls',
            title: 'Google Voice - Calls',
            visibilityState: 'visible',
            sessionAuthenticated: true,
            hasPreloadedGreeting: true,
            receivingCallsText: 'Zero-Echo Pure Digital WebRTC Isolation ACTIVE',
            totalCallsAnswered: round,
          }),
        });
        assert.equal(hbRes.status, 200);

        // 4. Ephemeral /gv-login/:token HTTP + Binary WebSocket Tunnel + Instant 404 Seal
        mkdirSync(path.dirname(tokenFile), { recursive: true });
        const tok = `abcdef0123456789abcdef0${round % 10}`;
        writeFileSync(tokenFile, tok, 'utf8');
        const vncHttp = await fetch(`${baseUrl}/gv-login/${tok}/vnc.html`);
        assert.equal(vncHttp.status, 200);

        const wsUrl = baseUrl.replace(/^http/, 'ws') + `/gv-login/${tok}/websockify`;
        await new Promise((resolve, reject) => {
          const ws = new WebSocket(wsUrl, ['binary']);
          ws.on('error', reject);
          ws.on('open', () => ws.send(Buffer.from(`PING_${round}`)));
          ws.on('message', (msg) => {
            assert.equal(msg.toString(), `OK:PING_${round}`);
            ws.close();
            resolve();
          });
        });

        rmSync(tokenFile, { force: true });
        const sealedRes = await fetch(`${baseUrl}/gv-login/${tok}/vnc.html`);
        assert.equal(sealedRes.status, 404, `Round ${round}: /gv-login must return 404 immediately once token is removed`);
      }

      // 5. Verify /api/sarah/gv-status has ALL booleans === true
      const statusRes = await fetch(`${baseUrl}/api/sarah/gv-status`);
      assert.equal(statusRes.status, 200);
      const st = await statusRes.json();
      assert.equal(st.ok, true, `Round ${round}: st.ok must be true`);
      assert.equal(st.online, true, `Round ${round}: st.online must be true (got ${st.online})`);
      assert.equal(st.cloudDaemonOnline, true, `Round ${round}: st.cloudDaemonOnline must be true (got ${st.cloudDaemonOnline})`);
      assert.equal(st.laptopIndependent, true, `Round ${round}: st.laptopIndependent must be true (got ${st.laptopIndependent})`);
      assert.equal(st.sessionAuthenticated, true, `Round ${round}: st.sessionAuthenticated must be true (got ${st.sessionAuthenticated})`);
      assert.equal(st.cloudDaemon?.sessionAuthenticated, true, `Round ${round}: st.cloudDaemon.sessionAuthenticated must be true`);
      assert.equal(st.activeMode, 'cloud_daemon_24_7');
      assert.ok(st.cookieVaultCount > 0, `Round ${round}: cookieVaultCount must be > 0`);
      assert.equal(st.receivingCallsText, 'Zero-Echo Pure Digital WebRTC Isolation ACTIVE');

      // 6. Verify Business-Hours (Tue 10:30 AM America/Phoenix MST) 1st-Ring Greeting + Customer Turn
      const openGreetingRes = await fetch(`${baseUrl}/api/sarah/turn`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          is_initial: true,
          skip_tts: round > 1,
          context: {
            mode: 'inbound',
            source_channel: 'call_in_lead',
            prospect_name: scenario.name.trim(),
            prospect_phone: scenario.phone,
            simulated_now_iso: '2026-11-17T10:30:00-07:00',
          },
        }),
      });
      assert.equal(openGreetingRes.status, 200);
      const openGreeting = await openGreetingRes.json();
      assert.equal(openGreeting.ok, true);
      assert.equal(openGreeting.routing_mode, 'business_hours');
      assert.equal(openGreeting.is_after_hours, false);
      assert.equal(openGreeting.should_hangup, false);
      assert.ok(String(openGreeting.reply || '').includes('Sarah'), `Round ${round}: Business-hours greeting must introduce Sarah`);

      const custTurnRes = await fetch(`${baseUrl}/api/sarah/turn`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: scenario.utterance,
          skip_tts: true,
          history: [{ speaker: 'sarah', text: openGreeting.reply }],
          context: {
            mode: 'inbound',
            source_channel: 'call_in_lead',
            prospect_name: scenario.name.trim(),
            prospect_phone: scenario.phone,
            simulated_now_iso: '2026-11-17T10:31:00-07:00',
          },
        }),
      });
      assert.equal(custTurnRes.status, 200);
      const custTurn = await custTurnRes.json();
      assert.equal(custTurn.ok, true);
      assert.ok(String(custTurn.reply || '').length > 15, `Round ${round}: Sarah must reply meaningfully to customer`);

      // 7. Verify After-Hours (Sat 8:00 PM America/Phoenix MST) Closed-Office Greeting + Clean Hangup
      const afterHoursRes = await fetch(`${baseUrl}/api/sarah/turn`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          is_initial: true,
          skip_tts: round > 1,
          context: {
            mode: 'inbound',
            source_channel: 'call_in_lead',
            prospect_phone: scenario.phone,
            simulated_now_iso: '2026-11-14T20:00:00-07:00',
          },
        }),
      });
      assert.equal(afterHoursRes.status, 200);
      const afterHours = await afterHoursRes.json();
      assert.equal(afterHours.ok, true);
      assert.equal(afterHours.routing_mode, 'after_hours');
      assert.equal(afterHours.is_after_hours, true);
      assert.equal(afterHours.should_hangup, true, `Round ${round}: After-hours greeting must set should_hangup=true`);
      assert.ok(
        String(afterHours.reply || '').includes('8 AM to 5 PM Arizona time'),
        `Round ${round}: After-hours greeting must state 8 AM to 5 PM Arizona time`
      );

      const elapsedMs = Date.now() - t0;
      results.push({
        round: `${round}/10`,
        customer: scenario.name.trim(),
        online: st.online,
        cloudDaemonOnline: st.cloudDaemonOnline,
        laptopIndependent: st.laptopIndependent,
        sessionAuthenticated: st.sessionAuthenticated,
        cookieVaultCount: st.cookieVaultCount,
        audio: st.receivingCallsText,
        elapsedMs: `${elapsedMs}ms`,
      });
      console.log(
        `✅ [Pass ${String(round).padStart(2, '0')}/10] ${scenario.name.trim().padEnd(18)} | allFlags=true | cookies=${st.cookieVaultCount} | WebRTC=ACTIVE | biz+afterHours=OK (${elapsedMs}ms)`
      );
    }

    console.log('\n=== 10/10 VERIFICATION ROUNDS PASSED (0 FAILURES) ===');
    console.table(results);
  } finally {
    rmSync(tokenFile, { force: true });
    if (appServer) await new Promise((r) => appServer.close(r));
    if (mockVncServer) await new Promise((r) => mockVncServer.close(r));
  }
}

main().catch((err) => {
  console.error('\n❌ VERIFICATION FAILED:', err);
  process.exit(1);
});
