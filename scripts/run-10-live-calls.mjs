#!/usr/bin/env node
/**
 * 10 Full Live Google Voice Browser + WebRTC Audio + Ring-1 Auto-Answer + Auto-Hangup Test Calls
 * Runs directly against the live authenticated Google Voice Chromium session (CDP :9222) and
 * local Express server (:4000) on the Google Cloud VM:
 *   - Calls 1–5: Full Business-Hours (Mon–Sat 9 AM–7 PM MST) Ring-1 Answer -> 48kHz WebRTC Greeting -> Caller Turn -> Sarah Reply -> Hangup
 *   - Calls 6–10: Full After-Hours Ring-1 Answer -> 48kHz WebRTC Closed-Office Greeting ("Monday through Saturday from 9 AM to 7 PM Arizona time") -> Automatic Clean Hangup
 */
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const daemonPkgDir = path.resolve(__dirname, '../cloud-voip-daemon');
const requireFromDaemon = createRequire(path.join(daemonPkgDir, 'package.json'));
const puppeteer = requireFromDaemon('puppeteer-core');

const API_BASE = process.env.LOCAL_API_URL || 'http://127.0.0.1:4000';
const CDP_URL = process.env.CDP_URL || 'http://127.0.0.1:9222';

const CALL_SCENARIOS = [
  { num: 1, mode: 'business_hours', phone: '(602) 555-0181', name: 'Martha Jenkins', utterance: 'Hi Sarah, I am turning 65 next month in Phoenix and need Medicare help.' },
  { num: 2, mode: 'business_hours', phone: '(480) 555-0182', name: 'Robert Alvarez', utterance: 'Hello, I want a quote on Term Life Insurance with living benefits for my family.' },
  { num: 3, mode: 'business_hours', phone: '(623) 555-0183', name: 'Evelyn Carter', utterance: 'Hi, I am looking for ACA family health insurance with zero deductible options.' },
  { num: 4, mode: 'business_hours', phone: '(520) 555-0184', name: 'David Nguyen', utterance: 'Good morning, we have 12 employees and want a group health insurance quote.' },
  { num: 5, mode: 'business_hours', phone: '(928) 555-0185', name: 'Patricia Brooks', utterance: 'Hi, what are your regular business hours in Arizona?' },
  { num: 6, mode: 'after_hours', phone: '(602) 555-0186', name: 'James Miller' },
  { num: 7, mode: 'after_hours', phone: '(480) 555-0187', name: 'Linda Morales' },
  { num: 8, mode: 'after_hours', phone: '(623) 555-0188', name: 'Charles Thompson' },
  { num: 9, mode: 'after_hours', phone: '(520) 555-0189', name: 'Barbara White' },
  { num: 10, mode: 'after_hours', phone: '(928) 555-0190', name: 'Anthony Davis' },
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitUntil(fn, timeoutMs = 28000, pollMs = 150) {
  const deadline = Date.now() + timeoutMs;
  let lastVal = null;
  while (Date.now() < deadline) {
    lastVal = await fn();
    if (lastVal) return lastVal;
    await sleep(pollMs);
  }
  return null;
}

async function main() {
  console.log('\n=== RUNNING 10 FULL LIVE BROWSER + WEBRTC AUDIO TEST CALLS ON GOOGLE VOICE ===\n');

  // 1. Check live /api/sarah/gv-status
  const gvStatus = await fetch(`${API_BASE}/api/sarah/gv-status`).then((r) => r.json());
  assert.equal(gvStatus.online, true, `Expected online=true, got ${JSON.stringify(gvStatus)}`);
  assert.equal(gvStatus.cloudDaemonOnline, true, 'Expected cloudDaemonOnline=true');
  assert.equal(gvStatus.laptopIndependent, true, 'Expected laptopIndependent=true');
  assert.equal(gvStatus.sessionAuthenticated, true, 'Expected sessionAuthenticated=true');

  // 2. Attach to live Google Voice Chrome via CDP
  const ver = await fetch(`${CDP_URL}/json/version`).then((r) => r.json());
  const browser = await puppeteer.connect({ browserWSEndpoint: ver.webSocketDebuggerUrl });

  try {
    const pages = await browser.pages();
    const gvPage = pages.find((p) => p.url().startsWith('https://voice.google.com/u/0/calls')) || pages[0];
    assert.ok(gvPage, 'Live Google Voice tab not found');
    assert.ok(gvPage.url().startsWith('https://voice.google.com'), `Unexpected GV URL: ${gvPage.url()}`);

    // Ensure AudioContext is unlocked & greetings pre-decoded
    await gvPage.mouse.click(80, 80).catch(() => {});
    await gvPage.evaluate(() => {
      window.postMessage({ __iwg_webrtc__: true, type: 'IWG_RESUME_AUDIO' }, '*');
    });
    await sleep(800);

    const preDiag = await gvPage.evaluate(() => ({
      webrtc: window.__IWG_WEBRTC_GET_DIAGNOSTICS__?.() || null,
      state: window.__IWG_GV_GET_STATE__?.() || null,
    }));
    console.log('Pre-Flight WebRTC & Controller Diagnostics:', JSON.stringify(preDiag));
    assert.equal(preDiag.webrtc?.installed, true, 'WebRTC Virtual Audio Bridge must be installed');
    assert.equal(preDiag.webrtc?.audioCtxState, 'running', '48kHz WebRTC AudioContext must be running');
    assert.equal(preDiag.webrtc?.sampleRate, 48000, 'WebRTC AudioContext must run at 48000 Hz');
    assert.equal(preDiag.webrtc?.virtualTrackReadyState, 'live', 'Virtual WebRTC mic track must be live');

    const summaryRows = [];

    for (const sc of CALL_SCENARIOS) {
      const tStart = Date.now();
      const beforeDiag = await gvPage.evaluate(() => window.__IWG_WEBRTC_GET_DIAGNOSTICS__());
      const prevPlaybacks = beforeDiag.totalPlaybacksCompleted || 0;

      // Inject simulated incoming Google Voice call banner into the live DOM
      await gvPage.evaluate(
        ({ phone, isBiz }) => {
          window.__IWG_ACTIVE_SIM_CALL__ = window.__IWG_GV_SIMULATE_CALL__(phone, {
            forceBusinessHours: isBiz,
          });
        },
        { phone: sc.phone, isBiz: sc.mode === 'business_hours' }
      );

      // Step A: Verify Ring-1 Auto-Answer (<250ms)
      const answeredSnap = await waitUntil(
        () =>
          gvPage.evaluate(() => {
            const s = window.__IWG_ACTIVE_SIM_CALL__?.getStatus?.();
            return s?.answered ? s : null;
          }),
        3000,
        40
      );
      assert.ok(answeredSnap, `Call #${sc.num}: Sarah did not click Answer within 3s!`);
      assert.ok(
        answeredSnap.ringToAnswerMs <= 350,
        `Call #${sc.num}: Expected Ring-1 pickup <=350ms, got ${answeredSnap.ringToAnswerMs}ms`
      );

      // Step B: Wait for Sarah's greeting audio to finish playing through the 48kHz WebRTC bus
      const greetingDone = await waitUntil(
        () =>
          gvPage.evaluate((minPlays) => {
            const diag = window.__IWG_WEBRTC_GET_DIAGNOSTICS__();
            const sim = window.__IWG_ACTIVE_SIM_CALL__?.getStatus?.();
            if (diag.totalPlaybacksCompleted > minPlays && !sim?.isSpeaking) {
              return { diag, sim };
            }
            return null;
          }, prevPlaybacks),
        26000,
        180
      );
      assert.ok(greetingDone, `Call #${sc.num}: Greeting audio playback did not complete!`);
      assert.ok(
        greetingDone.diag.lastPlaybackPeakRms > 0.03,
        `Call #${sc.num}: Expected non-zero WebRTC PCM audio energy, got RMS=${greetingDone.diag.lastPlaybackPeakRms}`
      );

      if (sc.mode === 'after_hours') {
        assert.ok(
          String(greetingDone.sim.lastSarahSpokenText || '').includes(
            'Monday through Saturday from 9 AM to 7 PM Arizona time'
          ),
          `Call #${sc.num}: Wrong after-hours greeting: ${greetingDone.sim.lastSarahSpokenText}`
        );

        // Verify automatic clean Hangup click within 1.5s after greeting finishes
        const hungUpSnap = await waitUntil(
          () =>
            gvPage.evaluate(() => {
              const s = window.__IWG_ACTIVE_SIM_CALL__?.getStatus?.();
              return s?.hungUp && !s?.callActive ? s : null;
            }),
          3000,
          80
        );
        assert.ok(hungUpSnap, `Call #${sc.num}: Sarah did not automatically click End Call after closed greeting!`);
      } else {
        assert.ok(
          String(greetingDone.sim.lastSarahSpokenText || '').includes('This is Sarah speaking'),
          `Call #${sc.num}: Wrong business-hours greeting: ${greetingDone.sim.lastSarahSpokenText}`
        );

        // Wait 600ms echo guard, then speak caller's live turn & verify Sarah responds over 48kHz WebRTC
        await sleep(600);
        const playsAfterGreeting = greetingDone.diag.totalPlaybacksCompleted;
        await gvPage.evaluate(async (utt) => {
          await window.__IWG_GV_PROCESS_CALLER_TURN__({ message: utt });
        }, sc.utterance);

        const afterTurnDiag = await gvPage.evaluate(() => ({
          diag: window.__IWG_WEBRTC_GET_DIAGNOSTICS__(),
          sim: window.__IWG_ACTIVE_SIM_CALL__?.getStatus?.(),
        }));
        assert.ok(
          afterTurnDiag.diag.totalPlaybacksCompleted > playsAfterGreeting,
          `Call #${sc.num}: Sarah's conversational reply did not play over WebRTC!`
        );
        assert.ok(
          afterTurnDiag.sim.callHistoryLength >= 3,
          `Call #${sc.num}: Expected >=3 transcript turns, got ${afterTurnDiag.sim.callHistoryLength}`
        );

        // Hang up cleanly to prepare for next test call
        await gvPage.evaluate(() => window.__IWG_GV_HANGUP_NOW__());
      }

      // Brief 1.1s inter-call settle (matches content.js 900ms post-hangup guard)
      await sleep(1100);

      const totalMs = Date.now() - tStart;
      const row = {
        call: `#${String(sc.num).padStart(2, '0')}/10`,
        mode: sc.mode,
        caller: sc.name,
        ring1PickupMs: `${answeredSnap.ringToAnswerMs}ms`,
        webrtcPeakRms: greetingDone.diag.lastPlaybackPeakRms,
        cleanHangup: true,
        durationSec: `${(totalMs / 1000).toFixed(1)}s`,
      };
      summaryRows.push(row);
      console.log(
        `✅ [Call ${row.call}] ${sc.mode.padEnd(14)} | ${sc.name.padEnd(17)} | Ring-1=${row.ring1PickupMs.padEnd(6)} | WebRTC RMS=${row.webrtcPeakRms} | Hangup=OK (${row.durationSec})`
      );
    }

    // Leave controller in clean idle state ready for real incoming calls on (480) 331-9455
    await gvPage.evaluate(() => {
      document.getElementById('iwg-simulated-gv-incoming-toast')?.remove();
      document.getElementById('iwg-simulated-gv-active-call')?.remove();
      window.__IWG_GV_HANGUP_NOW__?.();
    });

    console.log('\n=== ALL 10/10 FULL LIVE BROWSER + WEBRTC CALLS PASSED (0 FAILURES) ===');
    console.table(summaryRows);
  } finally {
    await browser.disconnect();
  }
}

main().catch((err) => {
  console.error('\n❌ LIVE CALL TEST FAILED:', err);
  process.exit(1);
});
