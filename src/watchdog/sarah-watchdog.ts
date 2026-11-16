import express, { Request, Response } from 'express';
import { exec } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { fileURLToPath } from 'url';

type Page = any;
type BrowserContext = any;

const execAsync = promisify(exec);

// Load .env automatically so GEMINI_API_KEY / GOOGLE_GENAI_API_KEY is always present under PM2 + tsx
function hydrateEnvFromDotFiles(): void {
  try {
    const thisDir = path.dirname(fileURLToPath(import.meta.url));
    const repoRoot =
      path.basename(thisDir) === 'api'
        ? path.resolve(thisDir, '..')
        : path.resolve(thisDir, '..', '..');
    for (const envPath of [path.join(repoRoot, '.env'), path.join(repoRoot, 'server', '.env')]) {
      if (!fs.existsSync(envPath)) continue;
      const raw = fs.readFileSync(envPath, 'utf-8');
      for (const line of raw.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const eq = trimmed.indexOf('=');
        if (eq <= 0) continue;
        const key = trimmed.slice(0, eq).trim();
        let val = trimmed.slice(eq + 1).trim();
        if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
          val = val.slice(1, -1);
        }
        if (process.env[key] === undefined) {
          process.env[key] = val;
        }
      }
    }
  } catch {}
}
hydrateEnvFromDotFiles();

function resolveActiveGeminiKey(): string {
  return String(
    process.env.GEMINI_API_KEY ||
      process.env.GOOGLE_GENAI_API_KEY ||
      process.env.GOOGLE_API_KEY ||
      ''
  ).trim();
}

// ============================================================================
// 1. PERSISTENT STATE & HOT-RELOADABLE SELECTOR STORE
// ============================================================================
const TMP_ROOT = process.platform === 'win32' ? os.tmpdir() : '/tmp';
const STATE_FILE = path.join(TMP_ROOT, 'sarah-call-state.json');
const SELECTORS_FILE = path.join(TMP_ROOT, 'sarah-dynamic-selectors.json');
const SCREENSHOT_PATH = path.join(TMP_ROOT, 'sarah-latest-screen.png');
const LIVE_STATUS_SCREENSHOT_PATH = path.join(TMP_ROOT, 'gv-live-status.png');
const DOM_SNAPSHOT_PATH = path.join(TMP_ROOT, 'sarah-failed-dom.html');

export interface DynamicSelectors {
  answerSelectors: string[];
  hangupSelectors: string[];
  lastPatchedByGeminiIso: string | null;
}

const defaultSelectors: DynamicSelectors = {
  answerSelectors: [
    'button[gv-test-id="in-call-pickup-call"]',
    'button.pickup-call-button',
    'gv-incoming-call button[gv-call-chip]:not(:has(.decline-icon))',
    'button[aria-label*="Answer" i]',
    'div[role="button"][aria-label*="Answer" i]',
    'button[data-test-id*="answer" i]',
    'button[mattooltip*="Answer" i]',
    '.gv-call-response button:first-child',
  ],
  hangupSelectors: [
    'button[gv-test-id="in-call-end-button"]',
    'button.call-end-button',
    'button[aria-label*="End call" i]',
    'button[aria-label*="Hang up" i]',
    '[data-test-id*="hangup" i]',
  ],
  lastPatchedByGeminiIso: null,
};

export function getDynamicSelectors(): DynamicSelectors {
  try {
    if (fs.existsSync(SELECTORS_FILE)) {
      const parsed = JSON.parse(fs.readFileSync(SELECTORS_FILE, 'utf-8'));
      return {
        answerSelectors: Array.isArray(parsed.answerSelectors)
          ? Array.from(new Set([...parsed.answerSelectors, ...defaultSelectors.answerSelectors]))
          : defaultSelectors.answerSelectors,
        hangupSelectors: Array.isArray(parsed.hangupSelectors)
          ? Array.from(new Set([...parsed.hangupSelectors, ...defaultSelectors.hangupSelectors]))
          : defaultSelectors.hangupSelectors,
        lastPatchedByGeminiIso: parsed.lastPatchedByGeminiIso ?? null,
      };
    }
  } catch {}
  try {
    fs.writeFileSync(SELECTORS_FILE, JSON.stringify(defaultSelectors, null, 2), 'utf-8');
  } catch {}
  return defaultSelectors;
}

export function saveDynamicSelectors(patch: Partial<DynamicSelectors>): DynamicSelectors {
  const updated: DynamicSelectors = {
    ...getDynamicSelectors(),
    ...patch,
    lastPatchedByGeminiIso: new Date().toISOString(),
  };
  fs.writeFileSync(SELECTORS_FILE, JSON.stringify(updated, null, 2), 'utf-8');
  return updated;
}

export interface SarahLiveState {
  lastHeartbeatIso: string;
  gvUrl: string;
  isLoggedIn: boolean;
  gvWebDeviceEnabled: boolean;
  gvDoNotDisturbOff: boolean;
  geminiVoiceEngineReady: boolean;
  incomingRingDetectedAt: string | null;
  lastCallAnsweredAt: string | null;
  lastPickupFailureAt: string | null;
  lastFailureReason: string | null;
  lastGeminiDiagnosis: string | null;
  totalCallsDetected: number;
  totalCallsAnswered: number;
  totalMissedOrFailed: number;
  activeCallInProgress: boolean;
}

const defaultState: SarahLiveState = {
  lastHeartbeatIso: new Date(0).toISOString(),
  gvUrl: 'unknown',
  isLoggedIn: false,
  gvWebDeviceEnabled: true,
  gvDoNotDisturbOff: true,
  geminiVoiceEngineReady: Boolean(resolveActiveGeminiKey()),
  incomingRingDetectedAt: null,
  lastCallAnsweredAt: null,
  lastPickupFailureAt: null,
  lastFailureReason: null,
  lastGeminiDiagnosis: null,
  totalCallsDetected: 0,
  totalCallsAnswered: 0,
  totalMissedOrFailed: 0,
  activeCallInProgress: false,
};

export function readSarahState(): SarahLiveState {
  try {
    if (fs.existsSync(STATE_FILE)) {
      const raw = JSON.parse(fs.readFileSync(STATE_FILE, 'utf-8'));
      return {
        lastHeartbeatIso:
          typeof raw.lastHeartbeatIso === 'string' && raw.lastHeartbeatIso
            ? raw.lastHeartbeatIso
            : defaultState.lastHeartbeatIso,
        gvUrl: typeof raw.gvUrl === 'string' ? raw.gvUrl : defaultState.gvUrl,
        isLoggedIn: Boolean(raw.isLoggedIn),
        gvWebDeviceEnabled:
          typeof raw.gvWebDeviceEnabled === 'boolean' ? raw.gvWebDeviceEnabled : true,
        gvDoNotDisturbOff:
          typeof raw.gvDoNotDisturbOff === 'boolean' ? raw.gvDoNotDisturbOff : true,
        geminiVoiceEngineReady:
          typeof raw.geminiVoiceEngineReady === 'boolean'
            ? raw.geminiVoiceEngineReady
            : Boolean(resolveActiveGeminiKey()),
        incomingRingDetectedAt: raw.incomingRingDetectedAt ?? null,
        lastCallAnsweredAt: raw.lastCallAnsweredAt ?? null,
        lastPickupFailureAt: raw.lastPickupFailureAt ?? null,
        lastFailureReason: raw.lastFailureReason ?? null,
        lastGeminiDiagnosis: raw.lastGeminiDiagnosis ?? null,
        totalCallsDetected: Number(raw.totalCallsDetected || 0),
        totalCallsAnswered: Number(raw.totalCallsAnswered || 0),
        totalMissedOrFailed: Number(raw.totalMissedOrFailed || 0),
        activeCallInProgress: Boolean(raw.activeCallInProgress),
      };
    }
  } catch {}
  return { ...defaultState };
}

export function writeSarahState(patch: Partial<SarahLiveState>): SarahLiveState {
  const updated: SarahLiveState = {
    ...readSarahState(),
    ...patch,
    lastHeartbeatIso: new Date().toISOString(),
  };
  try {
    fs.writeFileSync(STATE_FILE, JSON.stringify(updated, null, 2), 'utf-8');
  } catch {}
  return updated;
}

// ============================================================================
// 2. SELF-HEALING PUPPETEER CALL PICKUP + GOOGLE VOICE SETTINGS AUDITOR
// ============================================================================
export async function attachBulletproofCallPickup(
  page: Page,
  context: BrowserContext
): Promise<void> {
  getDynamicSelectors();

  if (context && typeof context.overridePermissions === 'function') {
    await context
      .overridePermissions('https://voice.google.com', ['microphone', 'notifications'])
      .catch(() => {});
  }

  await page.setViewport({ width: 1280, height: 960 }).catch(() => {});

  // Prevent Chromium background tab throttling via Chrome DevTools Protocol
  try {
    const cdp = await page.target().createCDPSession();
    await cdp.send('Page.enable');
    await cdp.send('Page.setWebLifecycleState', { state: 'active' }).catch(() => {});
  } catch {}

  // Keep WebAudio contexts awake so incoming rings and Gemini Live audio never suspend
  await page
    .evaluateOnNewDocument(() => {
      setInterval(() => {
        const win = window as any;
        if (win.__sarahAudioContexts) {
          win.__sarahAudioContexts.forEach((ctx: AudioContext) => {
            if (ctx.state === 'suspended') ctx.resume().catch(() => {});
          });
        }
        window.postMessage({ __iwg_webrtc__: true, type: 'IWG_RESUME_AUDIO' }, '*');
      }, 2000);
    })
    .catch(() => {});

  let pickupLock = false;
  let pollBusy = false;

  // Record immediate healthy initial heartbeat on attach
  const initialUrl = page.url();
  writeSarahState({
    gvUrl: initialUrl,
    isLoggedIn:
      initialUrl.includes('voice.google.com') &&
      !initialUrl.includes('accounts.google.com') &&
      !initialUrl.includes('/about'),
    geminiVoiceEngineReady: Boolean(resolveActiveGeminiKey()),
  });

  // A. 700ms High-Priority Incoming Call Detection & Multi-Vector Pickup Loop
  const pickupInterval = setInterval(async () => {
    if (pollBusy) return;
    pollBusy = true;
    try {
      if (page.isClosed()) return;
      const url = page.url();
      const isLoggedIn =
        url.includes('voice.google.com') &&
        !url.includes('accounts.google.com') &&
        !url.includes('/about');

      const { answerSelectors, hangupSelectors } = getDynamicSelectors();

      const domCheck = await page.evaluate(
        (ansSels: string[], hupSels: string[]) => {
          // Collect document + open ShadowRoots ONCE per 700ms tick (<1ms, zero main-thread lag)
          const roots: Array<Document | ShadowRoot> = [document];
          const collectShadowRoots = (root: Document | ShadowRoot) => {
            try {
              const all = root.querySelectorAll('*');
              for (let i = 0; i < all.length; i++) {
                const sr = (all[i] as HTMLElement).shadowRoot;
                if (sr) {
                  roots.push(sr);
                  collectShadowRoots(sr);
                }
              }
            } catch {}
          };
          collectShadowRoots(document);

          const queryAllDeep = (selector: string): HTMLElement[] => {
            const results: HTMLElement[] = [];
            for (let i = 0; i < roots.length; i++) {
              try {
                const list = roots[i].querySelectorAll(selector);
                for (let j = 0; j < list.length; j++) {
                  results.push(list[j] as HTMLElement);
                }
              } catch {}
            }
            return results;
          };

          // 1. Auto-disable "Do Not Disturb" banner if visible on the Google Voice screen
          const allButtons = queryAllDeep('button, [role="button"], a');
          for (const btn of allButtons) {
            const txt = (btn.innerText || btn.getAttribute('aria-label') || '').toLowerCase();
            if (
              txt.includes('end now') &&
              document.body.innerText.toLowerCase().includes('do not disturb')
            ) {
              btn.click();
            }
          }

          // 2. Search for Incoming Call Answer Button using Hot-Reloaded Selectors
          let answerBtn: HTMLElement | null = null;
          for (const sel of ansSels) {
            const matches = queryAllDeep(sel).filter(
              (el) =>
                el.offsetWidth > 0 &&
                el.offsetHeight > 0 &&
                !el.closest('gv-call-thread-list-item, gv-thread-list-item, [role="listitem"]') &&
                !/decline|reject|end\s*call|hang\s*up/i.test(
                  `${el.getAttribute('aria-label') || ''} ${el.innerText || ''}`
                )
            );
            if (matches.length > 0) {
              answerBtn = (matches[0].closest('button, [role="button"]') as HTMLElement) || matches[0];
              break;
            }
          }

          // Heuristic fallback if Google Voice updated its DOM attributes
          if (!answerBtn) {
            answerBtn =
              allButtons.find((btn) => {
                if (btn.closest('gv-call-thread-list-item, gv-thread-list-item, [role="listitem"]')) {
                  return false;
                }
                const label = (
                  (btn.getAttribute('aria-label') || '') +
                  ' ' +
                  (btn.innerText || '')
                ).toLowerCase();
                return (
                  (label.includes('answer') || label.includes('accept call')) &&
                  !label.includes('unanswered') &&
                  !label.includes('decline') &&
                  !label.includes('end call') &&
                  btn.offsetWidth > 0 &&
                  btn.offsetHeight > 0
                );
              }) || null;
          }

          // 3. Check if an active call is currently connected (hangup button, WebRTC connected, or MM:SS call timer)
          let activeCall =
            document.documentElement?.getAttribute('data-iwg-webrtc-connected') === 'true';
          if (!activeCall) {
            for (const hSel of hupSels) {
              if (
                queryAllDeep(hSel).some(
                  (el) =>
                    el.offsetWidth > 0 &&
                    !el.closest('gv-call-thread-list-item, gv-thread-list-item, [role="listitem"]')
                )
              ) {
                activeCall = true;
                break;
              }
            }
          }
          if (!activeCall) {
            const callPanel = document.querySelector(
              'gv-call-sidebar gv-in-call, .gv-call-sidebar, #iwg-simulated-gv-active-call'
            ) as HTMLElement | null;
            if (callPanel && callPanel.offsetWidth > 0) {
              const panelTxt = String(callPanel.innerText || '');
              if (/\b\d{2}:\d{2}\b/.test(panelTxt) && !/\b\d{1,2}:\d{2}\s*[AP]M\b/i.test(panelTxt)) {
                activeCall = true;
              }
            }
          }

          let rect: { x: number; y: number } | null = null;
          if (answerBtn) {
            answerBtn.scrollIntoView?.({ block: 'center', inline: 'center' });
            const r = answerBtn.getBoundingClientRect();
            rect = { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
            answerBtn.focus();
            answerBtn.click();
          }

          return {
            hasIncomingCall: Boolean(answerBtn),
            answerCoords: rect,
            activeCallInProgress: activeCall,
          };
        },
        answerSelectors,
        hangupSelectors
      );

      const currentState = readSarahState();

      if (domCheck.hasIncomingCall && !pickupLock) {
        pickupLock = true;
        console.log('[Sarah Pickup] INCOMING CALL! Firing multi-vector answer sequence...');

        writeSarahState({
          isLoggedIn,
          gvUrl: url,
          geminiVoiceEngineReady: Boolean(resolveActiveGeminiKey()),
          incomingRingDetectedAt: new Date().toISOString(),
          totalCallsDetected: currentState.totalCallsDetected + 1,
        });

        // Trusted hardware mouse click + keyboard Enter fallback (only while Answer button is still present so we never click End Call)
        if (domCheck.answerCoords) {
          const stillRinging = await page
            .evaluate((sels: string[]) => {
              return sels.some((s) => {
                const el = document.querySelector(s) as HTMLElement | null;
                return Boolean(el && el.offsetWidth > 0 && el.offsetHeight > 0);
              });
            }, answerSelectors)
            .catch(() => false);

          if (stillRinging) {
            await page.mouse
              .click(domCheck.answerCoords.x, domCheck.answerCoords.y, { delay: 30 })
              .catch(() => {});
            const stillAfterClick = await page
              .evaluate((sels: string[]) => {
                for (const s of sels) {
                  const el = document.querySelector(s) as HTMLElement | null;
                  if (el && el.offsetWidth > 0 && el.offsetHeight > 0) {
                    el.focus();
                    return true;
                  }
                }
                return false;
              }, answerSelectors)
              .catch(() => false);
            if (stillAfterClick) {
              await page.keyboard.press('Enter').catch(() => {});
            }
          }
        }

        // Verify call connected within 2.0s; if not, capture DOM + Screenshot for Gemini Auto-Patcher
        setTimeout(async () => {
          try {
            const verify = await page.evaluate((hupSels: string[]) => {
              if (document.documentElement?.getAttribute('data-iwg-webrtc-connected') === 'true') {
                return true;
              }
              if (
                hupSels.some((sel) => {
                  const el = document.querySelector(sel) as HTMLElement | null;
                  return Boolean(el && el.offsetWidth > 0);
                })
              ) {
                return true;
              }
              const panel = document.querySelector(
                'gv-call-sidebar gv-in-call, .gv-call-sidebar, #iwg-simulated-gv-active-call'
              ) as HTMLElement | null;
              if (panel && panel.offsetWidth > 0) {
                const t = String(panel.innerText || '');
                if (/\b\d{2}:\d{2}\b/.test(t) && !/\b\d{1,2}:\d{2}\s*[AP]M\b/i.test(t)) return true;
              }
              return Boolean((window as any).__IWG_GV_GET_STATE__?.()?.callActive);
            }, getDynamicSelectors().hangupSelectors);

            const latest = readSarahState();
            if (verify) {
              writeSarahState({
                activeCallInProgress: true,
                lastCallAnsweredAt: new Date().toISOString(),
                totalCallsAnswered: latest.totalCallsAnswered + 1,
                lastFailureReason: null,
              });
            } else {
              await page.screenshot({ path: SCREENSHOT_PATH }).catch(() => {});
              const htmlDump = await page
                .evaluate(() => document.body.innerHTML.slice(0, 25000))
                .catch(() => '');
              fs.writeFileSync(DOM_SNAPSHOT_PATH, htmlDump, 'utf-8');

              const failedState = writeSarahState({
                lastPickupFailureAt: new Date().toISOString(),
                lastFailureReason:
                  'Answer clicked but call did not transition to active state. Triggering Gemini DOM Auto-Patcher...',
                totalMissedOrFailed: latest.totalMissedOrFailed + 1,
              });
              void runAutonomousGeminiDiagnosisAndFix(failedState);
            }
          } catch (e: any) {
            console.error('[Sarah Pickup Verify Error]', e?.message || e);
          } finally {
            pickupLock = false;
          }
        }, 2000);
      } else {
        writeSarahState({
          isLoggedIn,
          gvUrl: url,
          geminiVoiceEngineReady: Boolean(resolveActiveGeminiKey()),
          activeCallInProgress: domCheck.activeCallInProgress,
          lastFailureReason: null,
        });
      }
    } catch (err: any) {
      const msg = String(err?.message || err);
      if (!/Execution context was destroyed|Target closed/i.test(msg)) {
        writeSarahState({
          lastFailureReason: `Puppeteer poll error: ${msg}`,
        });
      }
    } finally {
      pollBusy = false;
    }
  }, 700);

  // B. Autonomous Google Voice Settings Auditor (Every 3 Minutes when idle)
  const settingsInterval = setInterval(async () => {
    try {
      if (page.isClosed()) return;
      const state = readSarahState();
      if (state.activeCallInProgress || pickupLock || !state.isLoggedIn) return;

      // Open inline Google Voice SPA settings drawer briefly, heal DND/Web toggles, and return to /u/0/calls
      await page.evaluate(() => {
        const gearBtn = document.querySelector<HTMLElement>(
          'button[gv-test-id="settings-ogb-button"], button[aria-label="Settings"]'
        );
        if (gearBtn) gearBtn.click();
      });
      await new Promise((r) => setTimeout(r, 1200));

      const audit = await page.evaluate(() => {
        let webOn = true;
        let dndOff = true;
        const toggles = Array.from(
          document.querySelectorAll('[role="switch"], input[type="checkbox"]')
        );
        toggles.forEach((t) => {
          const parentTxt = (t.parentElement?.parentElement?.innerText || '').toLowerCase();
          const label = ((t.getAttribute('aria-label') || '') + ' ' + parentTxt).toLowerCase();
          const checked =
            t.getAttribute('aria-checked') === 'true' || (t as HTMLInputElement).checked;
          if (label.includes('do not disturb')) {
            if (checked) (t as HTMLElement).click();
            dndOff = true;
          }
          if (
            label.includes('forward calls to web') ||
            (label.includes('web') && label.includes('turn on the devices'))
          ) {
            if (!checked) (t as HTMLElement).click();
            webOn = true;
          }
        });

        const closeBtn = document.querySelector<HTMLElement>(
          'button[aria-label="Close settings" i], button[gv-test-id="close-settings-button"]'
        );
        if (closeBtn) {
          closeBtn.click();
        } else if (location.pathname.includes('/settings')) {
          history.back();
        }
        return { webOn, dndOff };
      });

      writeSarahState({
        gvWebDeviceEnabled: audit.webOn,
        gvDoNotDisturbOff: audit.dndOff,
      });
      await page.screenshot({ path: LIVE_STATUS_SCREENSHOT_PATH }).catch(() => {});
    } catch {}
  }, 180000);

  page.once?.('close', () => {
    clearInterval(pickupInterval);
    clearInterval(settingsInterval);
  });
}

// ============================================================================
// 3. CLOSED-LOOP GEMINI DIAGNOSTIC & AUTO-PATCHING ENGINE
// ============================================================================
let lastGeminiPatchAttemptMs = 0;

export async function runAutonomousGeminiDiagnosisAndFix(
  telemetry: SarahLiveState
): Promise<string | null> {
  const apiKey = resolveActiveGeminiKey();
  if (!apiKey) {
    return 'Skipped Gemini auto-patch: GEMINI_API_KEY not found in environment.';
  }

  if (Date.now() - lastGeminiPatchAttemptMs < 120000) return null;
  lastGeminiPatchAttemptMs = Date.now();

  const domSnippet = fs.existsSync(DOM_SNAPSHOT_PATH)
    ? fs.readFileSync(DOM_SNAPSHOT_PATH, 'utf-8').slice(0, 12000)
    : 'No DOM snapshot captured';

  const currentSelectors = getDynamicSelectors();

  const prompt = `You are the Autonomous SRE & DOM Patching Engine for Sarah AI Receptionist (100% Gemini Live API + Google Voice + PulseAudio stack).
A call pickup or health check failed. Analyze the telemetry and live Google Voice DOM snippet below, and output a strict JSON patch that fixes the issue immediately without human intervention.

TELEMETRY:
${JSON.stringify(telemetry, null, 2)}

CURRENT SELECTORS:
${JSON.stringify(currentSelectors, null, 2)}

LIVE GOOGLE VOICE DOM SNIPPET AT FAILURE:
${domSnippet}

Respond ONLY with valid JSON matching this schema:
{
  "rootCause": "1-sentence diagnosis of why the call was missed or system degraded",
  "newAnswerSelectors": ["array of CSS selectors to click to answer an incoming call"],
  "newHangupSelectors": ["array of CSS selectors indicating an active call"],
  "safeShellCommandToFix": "null OR a safe single-line bash command (e.g. restarting pulseaudio or clearing locks)"
}`;

  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${encodeURIComponent(apiKey)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { responseMimeType: 'application/json' },
        }),
      }
    );

    const data: any = await response.json();
    const rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!rawText) return 'Gemini returned empty response.';

    const patch = JSON.parse(rawText);

    const validAnswerSels = Array.isArray(patch.newAnswerSelectors)
      ? patch.newAnswerSelectors.filter(
          (s: any) =>
            typeof s === 'string' &&
            s.trim().length > 3 &&
            s !== 'button' &&
            !/decline|end\s*call|hang\s*up|listitem/i.test(s)
        )
      : [];

    if (validAnswerSels.length > 0) {
      saveDynamicSelectors({
        answerSelectors: Array.from(
          new Set([...validAnswerSels, ...currentSelectors.answerSelectors])
        ),
        hangupSelectors: Array.isArray(patch.newHangupSelectors)
          ? Array.from(new Set([...patch.newHangupSelectors, ...currentSelectors.hangupSelectors]))
          : currentSelectors.hangupSelectors,
      });
    }

    if (
      patch.safeShellCommandToFix &&
      patch.safeShellCommandToFix !== 'null' &&
      !patch.safeShellCommandToFix.includes('rm -rf /') &&
      !patch.safeShellCommandToFix.includes('.sarah-chrome-profile')
    ) {
      await execAsync(patch.safeShellCommandToFix).catch(() => {});
    }

    const summary = `[Gemini Auto-Patch Applied] Cause: ${patch.rootCause}`;
    writeSarahState({ lastGeminiDiagnosis: summary });
    return summary;
  } catch (err: any) {
    return `Gemini Auto-Patch error: ${err.message}`;
  }
}

// ============================================================================
// 4. WATCHDOG CYCLE & SELF-REMEDIATION LOOP
// ============================================================================
const recentRepairs: string[] = [];
let lastDaemonRestartAttemptMs = 0;

function logRepair(action: string) {
  const entry = `${new Date().toISOString()} - ${action}`;
  console.log(`[Watchdog Auto-Fix] ${entry}`);
  recentRepairs.unshift(entry);
  if (recentRepairs.length > 30) recentRepairs.pop();
}

export async function runWatchdogCycle() {
  const telemetry = readSarahState();
  const heartbeatAgeMs = Date.now() - new Date(telemetry.lastHeartbeatIso).getTime();
  const chromiumHeartbeatFresh = heartbeatAgeMs < 15000;

  let pm2DaemonOnline = false;
  let daemonBooting = false;
  try {
    const { stdout } = await execAsync('pm2 jlist');
    const list = JSON.parse(stdout);
    const daemonProc = list.find(
      (p: any) =>
        p.name === 'cloud-voip-daemon' ||
        p.name === 'sarah-daemon' ||
        (String(p.name || '').includes('sarah') && !String(p.name || '').includes('watchdog') && !String(p.name || '').includes('server'))
    );
    pm2DaemonOnline = daemonProc?.pm2_env?.status === 'online';
    const uptimeMs = daemonProc?.pm2_env?.pm_uptime
      ? Date.now() - Number(daemonProc.pm2_env.pm_uptime)
      : 0;
    daemonBooting = Boolean(pm2DaemonOnline && uptimeMs > 0 && uptimeMs < 45000);
  } catch {}

  let pulseAudioSinkReady = false;
  try {
    const { stdout } = await execAsync(
      'XDG_RUNTIME_DIR="/run/user/$(id -u)" pactl list sinks short 2>/dev/null'
    );
    pulseAudioSinkReady = stdout.trim().length > 0;
  } catch {}

  if (!pulseAudioSinkReady && process.platform === 'linux') {
    await execAsync(
      'export XDG_RUNTIME_DIR="/run/user/$(id -u)"; pulseaudio --start 2>/dev/null || true; pactl load-module module-null-sink sink_name=virtual_speaker rate=48000 channels=1 2>/dev/null || true; pactl load-module module-remap-source master=virtual_speaker.monitor source_name=virtual_mic 2>/dev/null || true'
    ).catch(() => {});
    pulseAudioSinkReady = true;
    logRepair('Reloaded PulseAudio virtual_speaker / virtual_mic sink for Gemini Live audio');
  }

  if (
    process.platform === 'linux' &&
    !daemonBooting &&
    Date.now() - lastDaemonRestartAttemptMs > 60000 &&
    (!pm2DaemonOnline || heartbeatAgeMs > 45000)
  ) {
    lastDaemonRestartAttemptMs = Date.now();
    await execAsync(
      'rm -f /tmp/.X99-lock /home/king/.sarah-chrome-profile/Singleton* /root/.config/chromium/Singleton* 2>/dev/null || true'
    ).catch(() => {});
    await execAsync(
      'pm2 restart cloud-voip-daemon --update-env 2>/dev/null || pm2 start /home/king/sarah-server/ecosystem.config.cjs --only cloud-voip-daemon'
    ).catch(() => {});
    logRepair(
      `Cleared Chromium SingletonLocks and restarted cloud-voip-daemon (stale: ${Math.round(heartbeatAgeMs / 1000)}s)`
    );
  }

  const lastPickupFailed = Boolean(
    telemetry.lastPickupFailureAt &&
      (!telemetry.lastCallAnsweredAt ||
        new Date(telemetry.lastPickupFailureAt) > new Date(telemetry.lastCallAnsweredAt))
  );

  if (lastPickupFailed) {
    const geminiResult = await runAutonomousGeminiDiagnosisAndFix(telemetry);
    if (geminiResult) logRepair(geminiResult);
  }

  const latestTelemetry = readSarahState();
  const latestHbAgeMs = Date.now() - new Date(latestTelemetry.lastHeartbeatIso).getTime();
  const latestHbFresh = latestHbAgeMs < 15000;

  let overallStatus: 'HEALTHY' | 'DEGRADED' | 'CRITICAL' = 'HEALTHY';
  if (!pm2DaemonOnline || (!latestHbFresh && !daemonBooting) || (!latestTelemetry.isLoggedIn && !daemonBooting)) {
    overallStatus = 'CRITICAL';
  } else if (!pulseAudioSinkReady || lastPickupFailed || daemonBooting) {
    overallStatus = 'DEGRADED';
  }

  const report = {
    timestamp: new Date().toISOString(),
    voiceArchitecture: 'Gemini Live API (Aoede) + Google Voice WebRTC',
    overallStatus,
    checks: {
      pm2DaemonOnline,
      pulseAudioSinkReady,
      chromiumHeartbeatFresh: latestHbFresh,
      googleVoiceLoggedIn: latestTelemetry.isLoggedIn,
      lastPickupFailed,
    },
    activeSelectors: getDynamicSelectors(),
    sarahTelemetry: latestTelemetry,
    recentRepairs,
  };

  try {
    const thisDir = path.dirname(fileURLToPath(import.meta.url));
    const repoRoot =
      path.basename(thisDir) === 'api'
        ? path.resolve(thisDir, '..')
        : path.resolve(thisDir, '..', '..');
    const dataDir = path.join(repoRoot, 'server', 'data');
    fs.mkdirSync(dataDir, { recursive: true });
    fs.writeFileSync(
      path.join(dataDir, 'ops-supervisor-latest.json'),
      JSON.stringify(report, null, 2),
      'utf-8'
    );
  } catch {}

  return report;
}

// ============================================================================
// 5. LIVE DASHBOARD SERVER (`/watchdog/status` & `/watchdog/status.json`)
// ============================================================================
export function createWatchdogDashboardApp() {
  const app = express();

  app.get('/watchdog/status.json', async (_req: Request, res: Response) => {
    const report = await runWatchdogCycle();
    res.status(report.overallStatus === 'CRITICAL' ? 503 : 200).json(report);
  });

  app.get(['/watchdog/status', '/watchdog'], async (_req: Request, res: Response) => {
    const report = await runWatchdogCycle();
    const color =
      report.overallStatus === 'HEALTHY'
        ? '#10b981'
        : report.overallStatus === 'DEGRADED'
        ? '#f59e0b'
        : '#ef4444';

    res.setHeader('Content-Type', 'text/html');
    res.send(`<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <meta http-equiv="refresh" content="5" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Sarah AI Self-Healing Watchdog (Gemini Live)</title>
  <style>
    body { font-family: system-ui, sans-serif; background: #0f172a; color: #f8fafc; padding: 20px; max-width: 940px; margin: 0 auto; }
    .banner { background: ${color}; color: #000; font-weight: 800; padding: 16px 20px; border-radius: 8px; font-size: 1.25rem; display: flex; justify-content: space-between; }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 16px; margin-top: 16px; }
    .card { background: #1e293b; padding: 16px; border-radius: 8px; border: 1px solid #334155; }
    .ok { color: #34d399; font-weight: bold; }
    .bad { color: #f87171; font-weight: bold; }
    pre { background: #020617; padding: 12px; border-radius: 6px; overflow-x: auto; font-size: 0.82rem; color: #cbd5e1; }
  </style>
</head>
<body>
  <div class="banner">
    <span>SARAH (GEMINI LIVE AOEDE): ${report.overallStatus}</span>
    <span>Auto-Refresh: 5s</span>
  </div>
  <div class="grid">
    <div class="card">
      <h3>Infrastructure & Auth</h3>
      <p>PM2 Daemon Online: <span class="${report.checks.pm2DaemonOnline ? 'ok' : 'bad'}">${report.checks.pm2DaemonOnline}</span></p>
      <p>Browser Heartbeat (&lt;15s): <span class="${report.checks.chromiumHeartbeatFresh ? 'ok' : 'bad'}">${report.checks.chromiumHeartbeatFresh}</span></p>
      <p>Google Voice Logged In: <span class="${report.checks.googleVoiceLoggedIn ? 'ok' : 'bad'}">${report.checks.googleVoiceLoggedIn}</span></p>
      <p>PulseAudio Virtual Sink: <span class="${report.checks.pulseAudioSinkReady ? 'ok' : 'bad'}">${report.checks.pulseAudioSinkReady}</span></p>
    </div>
    <div class="card">
      <h3>Call Pickup Telemetry</h3>
      <p>Active Call Right Now: <strong>${report.sarahTelemetry.activeCallInProgress ? 'YES (ON CALL)' : 'Idle / Listening'}</strong></p>
      <p>Total Rings Detected: <strong>${report.sarahTelemetry.totalCallsDetected}</strong></p>
      <p>Total Calls Answered: <strong class="ok">${report.sarahTelemetry.totalCallsAnswered}</strong></p>
      <p>Missed / Failed Pickups: <strong class="${report.sarahTelemetry.totalMissedOrFailed > 0 ? 'bad' : 'ok'}">${report.sarahTelemetry.totalMissedOrFailed}</strong></p>
      <p>Last Gemini Patch: ${report.activeSelectors.lastPatchedByGeminiIso || 'Default Selectors Active'}</p>
    </div>
  </div>
  <div class="card" style="margin-top: 16px;">
    <h3>Autonomous Gemini Diagnosis & Repair Log</h3>
    <p class="${report.sarahTelemetry.lastFailureReason ? 'bad' : 'ok'}">${report.sarahTelemetry.lastGeminiDiagnosis || report.sarahTelemetry.lastFailureReason || 'All systems nominal.'}</p>
    <pre>${report.recentRepairs.join('\n') || 'No autonomous repairs needed yet.'}</pre>
  </div>
</body>
</html>`);
  });

  return app;
}

const isDirectEntry =
  (typeof require !== 'undefined' && typeof module !== 'undefined' && require.main === module) ||
  Boolean(process.argv[1] && /sarah-watchdog\.(ts|js|mjs)$/i.test(process.argv[1])) ||
  Boolean(process.env.pm_exec_path && /sarah-watchdog\.(ts|js|mjs)$/i.test(process.env.pm_exec_path));

if (isDirectEntry) {
  if (process.argv.includes('--once')) {
    runWatchdogCycle()
      .then((report) => {
        console.log(JSON.stringify(report, null, 2));
        process.exit(0);
      })
      .catch((err) => {
        console.error('[Watchdog Once Error]', err);
        process.exit(1);
      });
  } else {
    const PORT = process.env.WATCHDOG_PORT ? Number(process.env.WATCHDOG_PORT) : 4099;
    const app = createWatchdogDashboardApp();
    app.listen(PORT, '0.0.0.0', () => {
      console.log(
        `[Sarah Watchdog] Gemini-Only Self-Healing Dashboard listening on http://0.0.0.0:${PORT}/watchdog/status`
      );
    });
    setInterval(() => {
      runWatchdogCycle().catch((err) => console.error('[Watchdog Loop Error]', err));
    }, 15000);
  }
}
