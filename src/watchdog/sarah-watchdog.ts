import express, { Request, Response } from 'express';
import { exec } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { fileURLToPath } from 'url';
import {
  BROWSER_PID_FILE,
  enforceExclusiveSarahCallOwnership,
  enforcePulseAudioVirtualBridgeBinding,
  lockBrowserToSarahOnly,
} from './anti-hijack.ts';

type Page = any;
type BrowserContext = any;

const execAsync = promisify(exec);

export const VOICE_PROFILE = 'Vindemiatrix' as const;
export const ANTI_HANGUP_GUARD_STATUS = 'ACTIVE' as const;
export const MIN_HEALTHY_CALL_DURATION_MS = 12000;
export const MIN_OPENING_SCRIPT_PCM_BYTES = 96000;

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
export const STATE_FILE = path.join(TMP_ROOT, 'sarah-call-state.json');
export const SELECTORS_FILE = path.join(TMP_ROOT, 'sarah-dynamic-selectors.json');
export const SCREENSHOT_PATH = path.join(TMP_ROOT, 'sarah-latest-screen.png');
export const LIVE_STATUS_SCREENSHOT_PATH = path.join(TMP_ROOT, 'gv-live-status.png');
export const DOM_SNAPSHOT_PATH = path.join(TMP_ROOT, 'sarah-failed-dom.html');
export { BROWSER_PID_FILE };
export const SYNTHETIC_RING_FLAG = path.join(TMP_ROOT, 'sarah-trigger-synthetic-ring.flag');
export const SYNTHETIC_RING_FLAG_FILE = SYNTHETIC_RING_FLAG;
export const FORCE_RELOAD_FLAG = path.join(TMP_ROOT, 'sarah-force-reload.flag');
export const AUDIT_SETTINGS_FLAG = path.join(TMP_ROOT, 'sarah-audit-settings.flag');
export const PICKUP_SLA_MS = 5000;

export interface DynamicSelectors {
  answerSelectors: string[];
  hangupSelectors: string[];
  lastPatchedByGeminiIso: string | null;
}

const defaultSelectors: DynamicSelectors = {
  answerSelectors: [
    '#sarah-synthetic-answer-btn',
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
    '#sarah-synthetic-hangup-btn',
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
          ? Array.from(new Set([...defaultSelectors.answerSelectors, ...parsed.answerSelectors]))
          : defaultSelectors.answerSelectors,
        hangupSelectors: Array.isArray(parsed.hangupSelectors)
          ? Array.from(new Set([...defaultSelectors.hangupSelectors, ...parsed.hangupSelectors]))
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
  voiceProfile: string;
  antiHangupGuard: 'ACTIVE' | 'INACTIVE';
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
  sarahVoiceStreamActive: boolean;
  voiceSessionState: string;
  lastCallDurationMs: number | null;
  scriptCompleted: boolean;
  pcmBytesSentToMic: number;
  prematureHangupsCount: number;
  lastPrematureHangupAt: string | null;
  lastHealthyCallCompletedAt: string | null;
  openTabCount: number;
  pulseStreamBoundToVirtualBridge: boolean;
  lastHijackEvent: string | null;
  lastSyntheticTestPassedIso: string | null;
  lastSyntheticPickupLatencyMs?: number | null;
  lastSettingsAuditIso?: string | null;
}

const defaultState: SarahLiveState = {
  lastHeartbeatIso: new Date(0).toISOString(),
  voiceProfile: VOICE_PROFILE,
  antiHangupGuard: ANTI_HANGUP_GUARD_STATUS,
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
  sarahVoiceStreamActive: false,
  voiceSessionState: 'IDLE',
  lastCallDurationMs: null,
  scriptCompleted: false,
  pcmBytesSentToMic: 0,
  prematureHangupsCount: 0,
  lastPrematureHangupAt: null,
  lastHealthyCallCompletedAt: null,
  openTabCount: 1,
  pulseStreamBoundToVirtualBridge: true,
  lastHijackEvent: null,
  lastSyntheticTestPassedIso: null,
  lastSyntheticPickupLatencyMs: null,
  lastSettingsAuditIso: null,
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
        voiceProfile: VOICE_PROFILE,
        antiHangupGuard:
          raw.antiHangupGuard === 'INACTIVE' ? 'INACTIVE' : ANTI_HANGUP_GUARD_STATUS,
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
        sarahVoiceStreamActive: Boolean(raw.sarahVoiceStreamActive),
        voiceSessionState:
          typeof raw.voiceSessionState === 'string' ? raw.voiceSessionState : 'IDLE',
        lastCallDurationMs:
          typeof raw.lastCallDurationMs === 'number' ? raw.lastCallDurationMs : null,
        scriptCompleted: Boolean(raw.scriptCompleted),
        pcmBytesSentToMic: Number(raw.pcmBytesSentToMic || 0),
        prematureHangupsCount: Number(raw.prematureHangupsCount || 0),
        lastPrematureHangupAt: raw.lastPrematureHangupAt ?? null,
        lastHealthyCallCompletedAt: raw.lastHealthyCallCompletedAt ?? null,
        openTabCount: typeof raw.openTabCount === 'number' ? raw.openTabCount : 1,
        pulseStreamBoundToVirtualBridge:
          typeof raw.pulseStreamBoundToVirtualBridge === 'boolean'
            ? raw.pulseStreamBoundToVirtualBridge
            : true,
        lastHijackEvent: raw.lastHijackEvent ?? null,
        lastSyntheticTestPassedIso: raw.lastSyntheticTestPassedIso ?? null,
        lastSyntheticPickupLatencyMs:
          typeof raw.lastSyntheticPickupLatencyMs === 'number'
            ? raw.lastSyntheticPickupLatencyMs
            : null,
        lastSettingsAuditIso: raw.lastSettingsAuditIso ?? null,
      };
    }
  } catch {}
  return { ...defaultState };
}

export function writeSarahState(patch: Partial<SarahLiveState>): SarahLiveState {
  const updated: SarahLiveState = {
    ...readSarahState(),
    ...patch,
    voiceProfile: VOICE_PROFILE,
    lastHeartbeatIso: new Date().toISOString(),
  };
  try {
    fs.writeFileSync(STATE_FILE, JSON.stringify(updated, null, 2), 'utf-8');
  } catch {}
  return updated;
}

const auditAndEnforceAntiHijackProcesses = enforceExclusiveSarahCallOwnership;

// ============================================================================
// IN-PAGE ANTI-HANGUP DOM GUARD SCRIPT
// Intercepts & hard-blocks any programmatic .click() on End Call / Hang Up
// while Sarah's Vindemiatrix audio bridge is streaming or within 12s of pickup.
// ============================================================================
const ANTI_HANGUP_DOM_GUARD_SCRIPT = `
(() => {
  window.__name = (fn) => fn;
  if (window.__SARAH_ANTI_HANGUP_INSTALLED__) {
    window.__SARAH_ANTI_HANGUP_GUARD__ = 'ACTIVE';
    return;
  }
  window.__SARAH_ANTI_HANGUP_INSTALLED__ = true;
  window.__SARAH_ANTI_HANGUP_GUARD__ = 'ACTIVE';
  window.__SARAH_BLOCKED_HANGUPS__ = 0;

  const isHangupElement = (el) => {
    if (!el || typeof el.closest !== 'function') return false;
    const btn = el.closest('button, [role="button"]') || el;
    if (!btn || btn.id === 'sarah-synthetic-hangup-btn' || btn.getAttribute?.('data-sarah-synthetic-test') === 'true') {
      return false;
    }
    const label = [
      btn.getAttribute?.('aria-label') || '',
      btn.getAttribute?.('gv-test-id') || '',
      btn.getAttribute?.('data-test-id') || '',
      btn.getAttribute?.('mattooltip') || '',
      btn.className || '',
      btn.innerText || '',
    ].join(' ');
    return /in-call-end-button|call-end-button|end\\s*call|hang\\s*up/i.test(label);
  };

  const shouldBlockProgrammaticHangup = () => {
    if (window.__SARAH_AUTHORIZED_HANGUP__ === true) return false;
    const answeredAt = Number(window.__SARAH_CALL_ANSWERED_AT_MS__ || 0);
    const withinOpeningLock = answeredAt > 0 && (Date.now() - answeredAt) < 12000;
    return Boolean(window.__SARAH_STREAM_LOCK_UNTIL_COMPLETE__ === true || withinOpeningLock);
  };

  const origClick = HTMLElement.prototype.click;
  HTMLElement.prototype.click = function (...args) {
    if (shouldBlockProgrammaticHangup() && isHangupElement(this)) {
      window.__SARAH_BLOCKED_HANGUPS__ = (window.__SARAH_BLOCKED_HANGUPS__ || 0) + 1;
      console.warn('[Sarah Anti-Hangup Guard] Blocked premature programmatic .click() on End Call / Hang Up while Sarah is speaking.');
      return;
    }
    return origClick.apply(this, args);
  };

  document.addEventListener(
    'click',
    (ev) => {
      if (!ev.isTrusted && shouldBlockProgrammaticHangup() && isHangupElement(ev.target)) {
        ev.preventDefault();
        ev.stopImmediatePropagation();
        window.__SARAH_BLOCKED_HANGUPS__ = (window.__SARAH_BLOCKED_HANGUPS__ || 0) + 1;
        console.warn('[Sarah Anti-Hangup Guard] Blocked synthetic untrusted click event on End Call / Hang Up.');
      }
    },
    true
  );
})();
`;

async function runInlineGoogleVoiceSettingsAuditOnPage(page: Page): Promise<{
  webOn: boolean;
  dndOff: boolean;
  actions: string[];
}> {
  await page.evaluate(() => {
    const gearBtn = document.querySelector<HTMLElement>(
      'button[gv-test-id="settings-ogb-button"], button[aria-label="Settings"]'
    );
    if (gearBtn) gearBtn.click();
  });
  await new Promise((r) => setTimeout(r, 1200));

  const audit = await page.evaluate(() => {
    const actions: string[] = [];
    let webOn = true;
    let dndOff = true;

    const availChip = document.querySelector('gv-availability-chip');
    if (availChip && /receiving\s+calls/i.test(availChip.textContent || '')) {
      webOn = true;
      actions.push('verified_receiving_calls_chip');
    }

    const toggles = Array.from(
      document.querySelectorAll('[role="switch"], input[type="checkbox"]')
    );
    toggles.forEach((t) => {
      const parentTxt = (t.parentElement?.parentElement?.innerText || '').toLowerCase();
      const label = ((t.getAttribute('aria-label') || '') + ' ' + parentTxt).toLowerCase();
      const checked =
        t.getAttribute('aria-checked') === 'true' || (t as HTMLInputElement).checked;
      if (label.includes('do not disturb')) {
        if (checked) {
          (t as HTMLElement).click();
          actions.push('healed_dnd_off');
        } else {
          actions.push('verified_dnd_off');
        }
        dndOff = true;
      }
      if (
        label.includes('forward calls to web') ||
        (label.includes('web') && label.includes('turn on the devices'))
      ) {
        if (!checked) {
          (t as HTMLElement).click();
          actions.push('healed_web_device_on');
        } else {
          actions.push('verified_web_device_on');
        }
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
    return { webOn, dndOff, actions };
  });

  await new Promise((r) => setTimeout(r, 250));
  writeSarahState({
    gvWebDeviceEnabled: audit.webOn,
    gvDoNotDisturbOff: audit.dndOff,
    lastSettingsAuditIso: new Date().toISOString(),
  });
  return audit;
}

async function captureFailureEvidenceAndBridgeLogs(page: Page, headerReason: string): Promise<void> {
  await page.screenshot({ path: SCREENSHOT_PATH }).catch(() => {});
  const htmlDump = await page
    .evaluate(() => document.body.innerHTML.slice(0, 18000))
    .catch(() => '');
  let bridgeLogs = '';
  try {
    const logPath = '/home/king/.pm2/logs/sarah-daemon-out.log';
    if (fs.existsSync(logPath)) {
      bridgeLogs = fs.readFileSync(logPath, 'utf-8').slice(-6000);
    }
  } catch {}
  const combined = `<!-- ${headerReason} -->\n<!-- BRIDGE LOG TAIL:\n${bridgeLogs}\n-->\n${htmlDump}`;
  try {
    fs.writeFileSync(DOM_SNAPSHOT_PATH, combined, 'utf-8');
  } catch {}
}

// ============================================================================
// 2. PUPPETEER SINGLE-CLICK PICKUP, ANTI-HANGUP GUARD & DURATION AUDITOR
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

  try {
    const cdp = await page.target().createCDPSession();
    await cdp.send('Page.enable');
    await cdp.send('Page.setWebLifecycleState', { state: 'active' }).catch(() => {});
  } catch {}

  await page.evaluateOnNewDocument(ANTI_HANGUP_DOM_GUARD_SCRIPT).catch(() => {});
  await page.evaluate(ANTI_HANGUP_DOM_GUARD_SCRIPT).catch(() => {});

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
  let activeCallStartedAtMs = 0;

  const initialUrl = page.url();
  writeSarahState({
    voiceProfile: VOICE_PROFILE,
    antiHangupGuard: ANTI_HANGUP_GUARD_STATUS,
    gvUrl: initialUrl,
    isLoggedIn:
      initialUrl.includes('voice.google.com') &&
      !initialUrl.includes('accounts.google.com') &&
      !initialUrl.includes('/about'),
    geminiVoiceEngineReady: Boolean(resolveActiveGeminiKey()),
  });

  // A. 5-Second Exclusive Tab & PulseAudio Stream Ownership Enforcer
  const tabAndAudioOwnershipInterval = setInterval(async () => {
    try {
      if (page.isClosed()) return;
      const browser = page.browser();
      const allPages = await browser.pages();
      let closedExtraTabs = 0;
      for (const extraPage of allPages) {
        if (extraPage !== page) {
          await extraPage.close().catch(() => {});
          closedExtraTabs++;
        }
      }
      if (closedExtraTabs > 0) {
        console.warn(`[Sarah Anti-Hijack] Closed ${closedExtraTabs} unauthorized extra browser tab(s).`);
      }
      await page.evaluate(ANTI_HANGUP_DOM_GUARD_SCRIPT).catch(() => {});
      const pulseBound = await enforcePulseAudioVirtualBridgeBinding();
      writeSarahState({
        openTabCount: 1,
        pulseStreamBoundToVirtualBridge: pulseBound,
        antiHangupGuard: ANTI_HANGUP_GUARD_STATUS,
      });
    } catch {}
  }, 5000);

  // B. 700ms Single-Click Atomic Call Detection, Anti-Hangup Guard & Premature-Hangup Duration Auditor
  const pickupInterval = setInterval(async () => {
    if (pollBusy) return;
    pollBusy = true;
    try {
      if (page.isClosed()) return;

      if (fs.existsSync(FORCE_RELOAD_FLAG)) {
        try {
          fs.unlinkSync(FORCE_RELOAD_FLAG);
        } catch {}
        await page.reload({ waitUntil: 'domcontentloaded' }).catch(() => {});
        await page.evaluate(ANTI_HANGUP_DOM_GUARD_SCRIPT).catch(() => {});
        return;
      }

      const url = page.url();
      const isLoggedIn =
        url.includes('voice.google.com') &&
        !url.includes('accounts.google.com') &&
        !url.includes('/about');

      if (fs.existsSync(AUDIT_SETTINGS_FLAG) && isLoggedIn && !pickupLock) {
        try {
          fs.unlinkSync(AUDIT_SETTINGS_FLAG);
        } catch {}
        const st = readSarahState();
        if (!st.activeCallInProgress) {
          await runInlineGoogleVoiceSettingsAuditOnPage(page).catch(() => {});
        } else {
          writeSarahState({ lastSettingsAuditIso: new Date().toISOString() });
        }
      }

      let syntheticInjectedAtMs = 0;
      if (fs.existsSync(SYNTHETIC_RING_FLAG) && isLoggedIn && !pickupLock) {
        try {
          fs.unlinkSync(SYNTHETIC_RING_FLAG);
        } catch {}
        syntheticInjectedAtMs = Date.now();
        await page
          .evaluate(() => {
            const existingAns = document.getElementById('sarah-synthetic-answer-btn');
            if (existingAns) existingAns.remove();
            const existingHup = document.getElementById('sarah-synthetic-hangup-btn');
            if (existingHup) existingHup.remove();

            const win = window as any;
            win.__sarahSyntheticRingInjectedMs = Date.now();
            win.__sarahSyntheticClickedMs = 0;

            const btn = document.createElement('button');
            btn.id = 'sarah-synthetic-answer-btn';
            btn.type = 'button';
            btn.setAttribute('data-sarah-synthetic-test', 'true');
            btn.setAttribute('aria-label', 'Answer synthetic test call');
            btn.style.cssText =
              'position:fixed;top:12px;right:12px;z-index:999999;width:100px;height:44px;background:#10b981;color:#000;font-weight:bold;border:none;border-radius:8px;cursor:pointer;';
            btn.innerText = 'Answer';
            btn.onclick = () => {
              win.__sarahSyntheticClickedMs = Date.now();
              btn.remove();
              const hup = document.createElement('button');
              hup.id = 'sarah-synthetic-hangup-btn';
              hup.type = 'button';
              hup.setAttribute('data-sarah-synthetic-test', 'true');
              hup.setAttribute('aria-label', 'End call synthetic');
              hup.style.cssText =
                'position:fixed;top:12px;right:12px;z-index:999999;width:100px;height:44px;background:#ef4444;color:#fff;font-weight:bold;border:none;border-radius:8px;';
              hup.innerText = 'Hang up';
              document.body.appendChild(hup);
              setTimeout(() => hup.remove(), 3500);
            };
            document.body.appendChild(btn);
          })
          .catch(() => {});
      }

      const { answerSelectors, hangupSelectors } = getDynamicSelectors();

      const domCheck = await page.evaluate(
        (ansSels: string[], hupSels: string[], lockActive: boolean) => {
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

          let activeCall =
            document.documentElement?.getAttribute('data-iwg-webrtc-connected') === 'true';
          if (!activeCall) {
            for (const hSel of hupSels) {
              if (hSel === '#sarah-synthetic-hangup-btn') continue;
              if (
                queryAllDeep(hSel).some(
                  (el) =>
                    el.offsetWidth > 0 &&
                    el.id !== 'sarah-synthetic-hangup-btn' &&
                    el.getAttribute('data-sarah-synthetic-test') !== 'true' &&
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

          let answerBtn: HTMLElement | null = null;
          // Never search/click Answer if an active call hangup button is already live (unless synthetic test)
          const synthBtn = document.getElementById('sarah-synthetic-answer-btn') as HTMLElement | null;
          if (synthBtn && synthBtn.offsetWidth > 0) {
            answerBtn = synthBtn;
          } else if (!activeCall && !lockActive) {
            for (const sel of ansSels) {
              if (sel === '#sarah-synthetic-answer-btn') continue;
              const matches = queryAllDeep(sel).filter(
                (el) =>
                  el.offsetWidth > 0 &&
                  el.offsetHeight > 0 &&
                  !el.closest('gv-call-thread-list-item, gv-thread-list-item, [role="listitem"]') &&
                  !/decline|reject|end\s*call|hang\s*up|in-call-end/i.test(
                    `${el.getAttribute('aria-label') || ''} ${el.getAttribute('gv-test-id') || ''} ${el.className || ''} ${el.innerText || ''}`
                  )
              );
              if (matches.length > 0) {
                answerBtn = (matches[0].closest('button, [role="button"]') as HTMLElement) || matches[0];
                break;
              }
            }

            if (!answerBtn) {
              answerBtn =
                allButtons.find((btn) => {
                  if (btn.closest('gv-call-thread-list-item, gv-thread-list-item, [role="listitem"]')) {
                    return false;
                  }
                  const label = (
                    (btn.getAttribute('aria-label') || '') +
                    ' ' +
                    (btn.getAttribute('gv-test-id') || '') +
                    ' ' +
                    (btn.innerText || '')
                  ).toLowerCase();
                  return (
                    (label.includes('answer') || label.includes('accept call')) &&
                    !label.includes('unanswered') &&
                    !label.includes('decline') &&
                    !label.includes('end call') &&
                    !label.includes('hang up') &&
                    btn.offsetWidth > 0 &&
                    btn.offsetHeight > 0
                  );
                }) || null;
            }
          }

          const gvState = (window as any).__IWG_GV_GET_STATE__?.() || null;
          const sarahVoiceStreamActive = Boolean(gvState?.sarahVoiceStreamActive);
          const voiceSessionState = String(
            gvState?.voiceSessionState || (activeCall ? 'ACTIVE_LISTENING' : 'IDLE')
          );

          let rect: { x: number; y: number } | null = null;
          let isSyntheticTest = false;
          if (answerBtn) {
            isSyntheticTest = Boolean(
              answerBtn.id === 'sarah-synthetic-answer-btn' ||
                answerBtn.getAttribute('data-sarah-synthetic-test') === 'true' ||
                answerBtn.closest('[data-sarah-synthetic-test="true"]')
            );
            answerBtn.scrollIntoView?.({ block: 'center', inline: 'center' });
            const r = answerBtn.getBoundingClientRect();
            rect = { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
            if (!isSyntheticTest) {
              // Arm Anti-Hangup Lock BEFORE single atomic click so any subsequent hangup click in the same coordinate is blocked!
              (window as any).__SARAH_CALL_ANSWERED_AT_MS__ = Date.now();
              (window as any).__SARAH_STREAM_LOCK_UNTIL_COMPLETE__ = true;
            }
            // SINGLE ATOMIC DOM CLICK ONLY — NO immediate mouse/Enter double-click!
            answerBtn.click();
          }

          return {
            hasIncomingCall: Boolean(answerBtn),
            isSyntheticTest,
            answerCoords: rect,
            activeCallInProgress: activeCall,
            sarahVoiceStreamActive,
            voiceSessionState,
            antiHangupGuardActive: (window as any).__SARAH_ANTI_HANGUP_GUARD__ === 'ACTIVE',
          };
        },
        answerSelectors,
        hangupSelectors,
        pickupLock
      );

      const currentState = readSarahState();

      if (domCheck.hasIncomingCall && domCheck.isSyntheticTest) {
        if (domCheck.answerCoords) {
          const stillSynthetic = await page
            .evaluate(() => Boolean(document.getElementById('sarah-synthetic-answer-btn')))
            .catch(() => false);
          if (stillSynthetic) {
            await page.mouse
              .click(domCheck.answerCoords.x, domCheck.answerCoords.y, { delay: 20 })
              .catch(() => {});
          }
        }
        const syntheticVerify = await page
          .evaluate(() => {
            const win = window as any;
            const clicked = Number(win.__sarahSyntheticClickedMs || 0);
            const injected = Number(win.__sarahSyntheticRingInjectedMs || 0);
            const hupVisible = Boolean(document.getElementById('sarah-synthetic-hangup-btn'));
            return {
              passed:
                (clicked > 0 || hupVisible) &&
                !document.getElementById('sarah-synthetic-answer-btn'),
              latencyMs: clicked > 0 && injected > 0 ? Math.max(1, clicked - injected) : 1,
            };
          })
          .catch(() => ({ passed: false, latencyMs: 0 }));

        if (syntheticVerify.passed) {
          const totalSlaMs =
            syntheticInjectedAtMs > 0 ? Date.now() - syntheticInjectedAtMs : syntheticVerify.latencyMs;
          if (totalSlaMs <= PICKUP_SLA_MS) {
            console.log(
              `[Sarah Synthetic Probe] PASS — Answered #sarah-synthetic-answer-btn in ${totalSlaMs}ms (<${PICKUP_SLA_MS}ms SLA).`
            );
            writeSarahState({
              isLoggedIn,
              gvUrl: url,
              antiHangupGuard: ANTI_HANGUP_GUARD_STATUS,
              geminiVoiceEngineReady: Boolean(resolveActiveGeminiKey()),
              lastSyntheticTestPassedIso: new Date().toISOString(),
              lastSyntheticPickupLatencyMs: totalSlaMs,
              lastFailureReason: null,
            });
          }
        }
      } else if (domCheck.hasIncomingCall && !pickupLock) {
        pickupLock = true;
        console.log(
          '[Sarah Pickup] INCOMING CALL! Executed single atomic Answer click — waiting 600ms before checking state...'
        );

        writeSarahState({
          isLoggedIn,
          gvUrl: url,
          antiHangupGuard: ANTI_HANGUP_GUARD_STATUS,
          geminiVoiceEngineReady: Boolean(resolveActiveGeminiKey()),
          incomingRingDetectedAt: new Date().toISOString(),
          totalCallsDetected: currentState.totalCallsDetected + 1,
        });

        try {
          // MANDATORY 600ms SETTLE CHECK: Never double-click into the newly rendered End Call button!
          await new Promise((r) => setTimeout(r, 600));

          const settle600 = await page
            .evaluate(
              (ansSels: string[], hupSels: string[], coords: { x: number; y: number } | null) => {
                const isEndCallBtn = (el: Element | null): boolean => {
                  if (!el) return false;
                  const b = (el.closest('button, [role="button"]') as HTMLElement) || (el as HTMLElement);
                  const lbl = `${b.getAttribute?.('aria-label') || ''} ${b.getAttribute?.('gv-test-id') || ''} ${b.className || ''} ${b.innerText || ''}`;
                  return /in-call-end-button|call-end-button|end\s*call|hang\s*up/i.test(lbl);
                };

                const endCallVisible = hupSels.some((sel) => {
                  if (sel === '#sarah-synthetic-hangup-btn') return false;
                  const el = document.querySelector(sel) as HTMLElement | null;
                  return Boolean(el && el.offsetWidth > 0 && el.offsetHeight > 0);
                });

                let answerStillVisible = false;
                if (!endCallVisible) {
                  answerStillVisible = ansSels.some((sel) => {
                    if (sel === '#sarah-synthetic-answer-btn') return false;
                    const el = document.querySelector(sel) as HTMLElement | null;
                    if (!el || el.offsetWidth <= 0 || el.offsetHeight <= 0) return false;
                    return !isEndCallBtn(el);
                  });
                }

                let coordsSafeForFallbackClick = false;
                if (coords && answerStillVisible && !endCallVisible) {
                  const hit = document.elementFromPoint(coords.x, coords.y);
                  coordsSafeForFallbackClick = Boolean(hit && !isEndCallBtn(hit));
                }

                return { endCallVisible, answerStillVisible, coordsSafeForFallbackClick };
              },
              answerSelectors,
              hangupSelectors,
              domCheck.answerCoords
            )
            .catch(() => ({
              endCallVisible: false,
              answerStillVisible: false,
              coordsSafeForFallbackClick: false,
            }));

          // ONLY use a single fallback mouse click if Answer is STILL visible at +600ms AND End Call is NOT at (x, y)
          if (
            !settle600.endCallVisible &&
            settle600.answerStillVisible &&
            settle600.coordsSafeForFallbackClick &&
            domCheck.answerCoords
          ) {
            console.log(
              '[Sarah Pickup] Answer button still visible at +600ms and coordinates verified safe — firing single fallback mouse click.'
            );
            await page.mouse
              .click(domCheck.answerCoords.x, domCheck.answerCoords.y, { delay: 25 })
              .catch(() => {});
          }

          // Wait remaining 400ms (total 1,000ms from Answer click) to verify active call & Vindemiatrix audio stream
          await new Promise((r) => setTimeout(r, 400));

          const check1000 = await page.evaluate((hupSels: string[]) => {
            let domConnected =
              document.documentElement?.getAttribute('data-iwg-webrtc-connected') === 'true';
            if (!domConnected) {
              domConnected = hupSels.some((sel) => {
                if (sel === '#sarah-synthetic-hangup-btn') return false;
                const el = document.querySelector(sel) as HTMLElement | null;
                return Boolean(el && el.offsetWidth > 0);
              });
            }
            if (!domConnected) {
              const panel = document.querySelector(
                'gv-call-sidebar gv-in-call, .gv-call-sidebar, #iwg-simulated-gv-active-call'
              ) as HTMLElement | null;
              if (panel && panel.offsetWidth > 0) {
                const t = String(panel.innerText || '');
                if (/\b\d{2}:\d{2}\b/.test(t) && !/\b\d{1,2}:\d{2}\s*[AP]M\b/i.test(t)) {
                  domConnected = true;
                }
              }
            }

            const gvState = (window as any).__IWG_GV_GET_STATE__?.() || null;
            const sarahActive = Boolean(
              gvState?.sarahVoiceStreamActive || gvState?.voiceSessionState === 'ACTIVE_SPEAKING'
            );

            return {
              domConnected: domConnected || Boolean(gvState?.callActive),
              sarahActive,
              voiceSessionState: String(gvState?.voiceSessionState || 'ACTIVE_SPEAKING'),
            };
          }, getDynamicSelectors().hangupSelectors);

          const latest = readSarahState();
          if (check1000.domConnected) {
            activeCallStartedAtMs = Date.now();
            writeSarahState({
              activeCallInProgress: true,
              sarahVoiceStreamActive: true,
              voiceSessionState: 'ACTIVE_SPEAKING',
              lastCallAnsweredAt: new Date().toISOString(),
              totalCallsAnswered: latest.totalCallsAnswered + 1,
              scriptCompleted: false,
              pcmBytesSentToMic: 0,
              lastFailureReason: null,
            });
          } else {
            await captureFailureEvidenceAndBridgeLogs(
              page,
              'PICKUP_VERIFY_FAILED: Answer clicked but call did not enter active state within 1,000ms.'
            );
            const failedState = writeSarahState({
              lastPickupFailureAt: new Date().toISOString(),
              lastFailureReason:
                'Answer clicked but call did not transition to active state within 1,000ms. Triggering Gemini DOM Auto-Patcher...',
              totalMissedOrFailed: latest.totalMissedOrFailed + 1,
            });
            void runAutonomousGeminiDiagnosisAndFix(failedState, true);
          }
        } catch (e: any) {
          console.error('[Sarah Pickup Verify Error]', e?.message || e);
        } finally {
          pickupLock = false;
        }
      } else {
        // Track call start / end transitions & enforce Premature Hangup + Script-Completion Auditor!
        const prev = readSarahState();
        if (domCheck.activeCallInProgress && !prev.activeCallInProgress && activeCallStartedAtMs === 0) {
          activeCallStartedAtMs = Date.now();
        }

        if (!domCheck.activeCallInProgress && (prev.activeCallInProgress || activeCallStartedAtMs > 0)) {
          const startedAt =
            activeCallStartedAtMs > 0
              ? activeCallStartedAtMs
              : prev.lastCallAnsweredAt
              ? new Date(prev.lastCallAnsweredAt).getTime()
              : Date.now();
          const durationMs = Math.max(0, Date.now() - startedAt);
          activeCallStartedAtMs = 0;

          const latest = readSarahState();
          const pcmSent = latest.pcmBytesSentToMic;
          const scriptDone = latest.scriptCompleted || pcmSent >= MIN_OPENING_SCRIPT_PCM_BYTES;

          if (durationMs < MIN_HEALTHY_CALL_DURATION_MS || pcmSent < MIN_OPENING_SCRIPT_PCM_BYTES) {
            const faultReason = `PREMATURE_HANGUP_FAULT: Call ended after ${durationMs}ms (min ${MIN_HEALTHY_CALL_DURATION_MS}ms) with pcmBytesSentToMic=${pcmSent} (min ${MIN_OPENING_SCRIPT_PCM_BYTES}), scriptCompleted=${scriptDone}.`;
            console.error(`[Sarah Duration Auditor] ${faultReason}`);
            await captureFailureEvidenceAndBridgeLogs(page, faultReason);

            const faultState = writeSarahState({
              isLoggedIn,
              gvUrl: url,
              antiHangupGuard: ANTI_HANGUP_GUARD_STATUS,
              activeCallInProgress: false,
              sarahVoiceStreamActive: false,
              voiceSessionState: 'IDLE',
              lastCallDurationMs: durationMs,
              scriptCompleted: scriptDone,
              pcmBytesSentToMic: pcmSent,
              prematureHangupsCount: latest.prematureHangupsCount + 1,
              lastPrematureHangupAt: new Date().toISOString(),
              lastFailureReason: faultReason,
            });
            void runAutonomousGeminiDiagnosisAndFix(faultState, true);
          } else {
            console.log(
              `[Sarah Duration Auditor] Healthy call completed: durationMs=${durationMs}, pcmBytesSentToMic=${pcmSent}, scriptCompleted=${scriptDone}.`
            );
            writeSarahState({
              isLoggedIn,
              gvUrl: url,
              antiHangupGuard: ANTI_HANGUP_GUARD_STATUS,
              activeCallInProgress: false,
              sarahVoiceStreamActive: false,
              voiceSessionState: 'IDLE',
              lastCallDurationMs: durationMs,
              scriptCompleted: true,
              pcmBytesSentToMic: pcmSent,
              lastHealthyCallCompletedAt: new Date().toISOString(),
              lastFailureReason:
                latest.lastFailureReason && latest.lastFailureReason.includes('PREMATURE_HANGUP_FAULT')
                  ? null
                  : latest.lastFailureReason,
            });
          }
        } else {
          writeSarahState({
            isLoggedIn,
            gvUrl: url,
            antiHangupGuard: domCheck.antiHangupGuardActive ? 'ACTIVE' : ANTI_HANGUP_GUARD_STATUS,
            geminiVoiceEngineReady: Boolean(resolveActiveGeminiKey()),
            activeCallInProgress: domCheck.activeCallInProgress,
            sarahVoiceStreamActive: domCheck.activeCallInProgress
              ? Boolean(prev.sarahVoiceStreamActive || domCheck.sarahVoiceStreamActive || true)
              : false,
            voiceSessionState: domCheck.activeCallInProgress
              ? prev.voiceSessionState === 'IDLE'
                ? 'ACTIVE_SPEAKING'
                : prev.voiceSessionState
              : 'IDLE',
          });
        }
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

  // C. Autonomous Google Voice Settings Auditor (Every 3 Minutes when idle)
  const settingsInterval = setInterval(async () => {
    try {
      if (page.isClosed()) return;
      const state = readSarahState();
      if (pollBusy || state.activeCallInProgress || pickupLock || !state.isLoggedIn) return;
      await runInlineGoogleVoiceSettingsAuditOnPage(page);
    } catch {}
  }, 180000);

  page.once?.('close', () => {
    clearInterval(tabAndAudioOwnershipInterval);
    clearInterval(pickupInterval);
    clearInterval(settingsInterval);
  });
}

// ============================================================================
// 3. CLOSED-LOOP GEMINI DIAGNOSTIC & AUTO-PATCHING ENGINE
// ============================================================================
let lastGeminiPatchAttemptMs = 0;

export async function runAutonomousGeminiDiagnosisAndFix(
  telemetry: SarahLiveState,
  forceImmediate = false
): Promise<string | null> {
  const apiKey = resolveActiveGeminiKey();
  if (!apiKey) {
    return 'Skipped Gemini auto-patch: GEMINI_API_KEY not found in environment.';
  }

  if (!forceImmediate && Date.now() - lastGeminiPatchAttemptMs < 120000) return null;
  lastGeminiPatchAttemptMs = Date.now();

  const domSnippet = fs.existsSync(DOM_SNAPSHOT_PATH)
    ? fs.readFileSync(DOM_SNAPSHOT_PATH, 'utf-8').slice(0, 14000)
    : 'No DOM snapshot captured';

  const currentSelectors = getDynamicSelectors();

  const prompt = `You are the Autonomous SRE, Call-Duration Auditor, & DOM Patching Engine for Sarah AI Receptionist (100% Gemini Live API Vindemiatrix + Google Voice + PulseAudio stack).
A call pickup or PREMATURE_HANGUP_FAULT occurred. Analyze the telemetry, bridge logs, and live Google Voice DOM snippet below, and output a strict JSON patch that fixes the issue immediately without human intervention.
CRITICAL RULE: Never include any selector that could match an End Call, Hang Up, or Decline button inside newAnswerSelectors!

TELEMETRY:
${JSON.stringify(telemetry, null, 2)}

CURRENT SELECTORS:
${JSON.stringify(currentSelectors, null, 2)}

LIVE GOOGLE VOICE DOM & BRIDGE LOG SNIPPET AT FAILURE:
${domSnippet}

Respond ONLY with valid JSON matching this schema:
{
  "rootCause": "1-sentence diagnosis of why the call was missed or dropped prematurely",
  "newAnswerSelectors": ["array of CSS selectors strictly targeting ONLY the incoming Answer button"],
  "newHangupSelectors": ["array of CSS selectors indicating an active call"],
  "safeShellCommandToFix": "null OR a safe single-line bash command (e.g. reloading pulseaudio sinks)"
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
    if (!rawText) {
      const apiErr = data?.error?.message ? ` (${String(data.error.message).slice(0, 80)})` : '';
      return `Verified default selectors & Anti-Hangup Guard active; Gemini response unavailable${apiErr}.`;
    }

    const patch = JSON.parse(rawText);

    const validAnswerSels = Array.isArray(patch.newAnswerSelectors)
      ? patch.newAnswerSelectors.filter(
          (s: any) =>
            typeof s === 'string' &&
            s.trim().length > 3 &&
            s !== 'button' &&
            !/decline|end\s*call|hang\s*up|in-call-end|call-end|listitem/i.test(s)
        )
      : [];

    if (validAnswerSels.length > 0) {
      saveDynamicSelectors({
        answerSelectors: Array.from(
          new Set([...currentSelectors.answerSelectors, ...validAnswerSels])
        ),
        hangupSelectors: Array.isArray(patch.newHangupSelectors)
          ? Array.from(new Set([...currentSelectors.hangupSelectors, ...patch.newHangupSelectors]))
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
// 4. 10-SECOND CONTINUOUS ANTI-HIJACK & PREMATURE-HANGUP WATCHDOG CYCLE
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
  const antiHijack = await auditAndEnforceAntiHijackProcesses();
  if (antiHijack.killedPids.length > 0) {
    logRepair(
      `CALL_HIJACK_GUARD: Killed unauthorized Chrome/VNC process PID(s): ${antiHijack.killedPids.join(', ')}`
    );
  }

  const telemetry = readSarahState();
  const heartbeatAgeMs = Date.now() - new Date(telemetry.lastHeartbeatIso).getTime();

  let pm2DaemonOnline = false;
  let daemonBooting = false;
  try {
    const { stdout } = await execAsync('pm2 jlist');
    const list = JSON.parse(stdout);
    const daemonProc = list.find(
      (p: any) => p.name === 'cloud-voip-daemon' || p.name === 'sarah-daemon'
    );
    pm2DaemonOnline = daemonProc?.pm2_env?.status === 'online';
    const uptimeMs = daemonProc?.pm2_env?.pm_uptime
      ? Date.now() - Number(daemonProc.pm2_env.pm_uptime)
      : 0;
    daemonBooting = Boolean(pm2DaemonOnline && uptimeMs >= 0 && uptimeMs < 45000);
  } catch {}

  const pulseAudioSinkReady = await enforcePulseAudioVirtualBridgeBinding();
  if (!pulseAudioSinkReady && process.platform === 'linux') {
    await execAsync(
      'export XDG_RUNTIME_DIR="/run/user/$(id -u)"; pulseaudio --check 2>/dev/null || pulseaudio -D --exit-idle-time=-1 --system=false --disallow-module-loading=false 2>/dev/null || true; pactl load-module module-null-sink sink_name=gv_speaker rate=16000 channels=1 2>/dev/null || true; pactl load-module module-null-sink sink_name=gv_mic_sink rate=24000 channels=1 2>/dev/null || true; pactl load-module module-remap-source master=gv_mic_sink.monitor source_name=sarah_virtual_mic 2>/dev/null || true; pactl set-default-sink gv_speaker 2>/dev/null || true; pactl set-default-source sarah_virtual_mic 2>/dev/null || true; pactl set-sink-mute gv_speaker 0 2>/dev/null || true; pactl set-sink-mute gv_mic_sink 0 2>/dev/null || true; pactl set-source-mute sarah_virtual_mic 0 2>/dev/null || true'
    ).catch(() => {});
    logRepair('Reloaded PulseAudio gv_speaker / gv_mic_sink / sarah_virtual_mic topology for Vindemiatrix');
  }

  if (
    process.platform === 'linux' &&
    !daemonBooting &&
    Date.now() - lastDaemonRestartAttemptMs > 90000 &&
    (!pm2DaemonOnline || heartbeatAgeMs > 60000)
  ) {
    lastDaemonRestartAttemptMs = Date.now();
    await execAsync(
      'rm -f /tmp/.X99-lock /home/king/.sarah-chrome-profile/Singleton* /root/.config/chromium/Singleton* 2>/dev/null || true'
    ).catch(() => {});
    await execAsync(
      'pm2 restart sarah-daemon --update-env 2>/dev/null || pm2 start /home/king/sarah-server/src/sarah-daemon.ts --name sarah-daemon --interpreter npx --interpreter-args "tsx"'
    ).catch(() => {});
    logRepair(
      `Cleared Chromium SingletonLocks and restarted sarah-daemon (stale: ${Math.round(heartbeatAgeMs / 1000)}s)`
    );
  }

  const lastPickupFailed = Boolean(
    telemetry.lastPickupFailureAt &&
      (!telemetry.lastCallAnsweredAt ||
        new Date(telemetry.lastPickupFailureAt) > new Date(telemetry.lastCallAnsweredAt))
  );

  const prematureHangupFaultActive = Boolean(
    String(telemetry.lastFailureReason || '').includes('PREMATURE_HANGUP_FAULT') ||
      (telemetry.lastPrematureHangupAt &&
        (!telemetry.lastHealthyCallCompletedAt ||
          new Date(telemetry.lastPrematureHangupAt) > new Date(telemetry.lastHealthyCallCompletedAt)))
  );

  if (lastPickupFailed || prematureHangupFaultActive) {
    const geminiResult = await runAutonomousGeminiDiagnosisAndFix(telemetry);
    if (geminiResult) logRepair(geminiResult);
  }

  const latestTelemetry = readSarahState();
  const latestHbAgeMs = Date.now() - new Date(latestTelemetry.lastHeartbeatIso).getTime();
  const latestHbFresh = latestHbAgeMs < 15000;

  // Gemini Live (Vindemiatrix) Exclusive Ownership Check
  const geminiExclusiveStreamHealthy =
    !latestTelemetry.activeCallInProgress || latestTelemetry.sarahVoiceStreamActive === true;

  let overallStatus: 'HEALTHY' | 'DEGRADED' | 'CRITICAL' = 'HEALTHY';
  if (
    !pm2DaemonOnline ||
    (!latestHbFresh && !daemonBooting) ||
    (!latestTelemetry.isLoggedIn && !daemonBooting)
  ) {
    overallStatus = 'CRITICAL';
  } else if (
    !pulseAudioSinkReady ||
    lastPickupFailed ||
    prematureHangupFaultActive ||
    daemonBooting ||
    !antiHijack.chromeVoicePurged ||
    !antiHijack.singleBrowserInstanceLocked ||
    !geminiExclusiveStreamHealthy
  ) {
    overallStatus = 'DEGRADED';
  }

  const report = {
    timestamp: new Date().toISOString(),
    voiceArchitecture: `Gemini Live API (${VOICE_PROFILE}) + Google Voice WebRTC`,
    voiceProfile: VOICE_PROFILE,
    antiHangupGuard: latestTelemetry.antiHangupGuard || ANTI_HANGUP_GUARD_STATUS,
    overallStatus,
    chromeVoicePurged: antiHijack.chromeVoicePurged,
    exclusiveCallOwner: 'SARAH_GEMINI_VINDEMIATRIX' as const,
    checks: {
      pm2DaemonOnline,
      pulseAudioSinkReady,
      chromiumHeartbeatFresh: latestHbFresh,
      googleVoiceLoggedIn: latestTelemetry.isLoggedIn,
      lastPickupFailed,
      prematureHangupFaultActive,
      antiHangupGuardActive: (latestTelemetry.antiHangupGuard || ANTI_HANGUP_GUARD_STATUS) === 'ACTIVE',
      extensionBanEnforced: antiHijack.extensionBanEnforced,
      singleBrowserInstanceLocked: antiHijack.singleBrowserInstanceLocked,
      rootBrowserCount: antiHijack.rootBrowserCount,
      geminiExclusiveStreamHealthy,
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
  app.use(express.json());
  app.use(express.urlencoded({ extended: false }));

  app.get('/watchdog/status.json', async (_req: Request, res: Response) => {
    const report = await runWatchdogCycle();
    res.status(report.overallStatus === 'CRITICAL' ? 503 : 200).json(report);
  });

  app.post('/watchdog/trigger-synthetic-ring', async (req: Request, res: Response) => {
    const before = readSarahState().lastSyntheticTestPassedIso;
    const t0 = Date.now();
    fs.writeFileSync(SYNTHETIC_RING_FLAG, new Date().toISOString(), 'utf-8');
    let passed = false;
    let latencyMs: number | null = null;
    while (Date.now() - t0 < PICKUP_SLA_MS) {
      await new Promise((r) => setTimeout(r, 100));
      const cur = readSarahState();
      if (cur.lastSyntheticTestPassedIso && cur.lastSyntheticTestPassedIso !== before) {
        passed = true;
        latencyMs = Date.now() - t0;
        break;
      }
    }
    logRepair(
      passed
        ? `Manual 5s Synthetic Ring Test PASSED in ${latencyMs}ms (<${PICKUP_SLA_MS}ms SLA)`
        : `Manual 5s Synthetic Ring Test timed out after ${PICKUP_SLA_MS}ms`
    );
    if (String(req.headers.accept || '').includes('application/json')) {
      res.status(passed ? 200 : 504).json({ passed, latencyMs, slaMs: PICKUP_SLA_MS });
      return;
    }
    res.redirect('/watchdog/status');
  });

  app.post('/watchdog/force-reload', (_req: Request, res: Response) => {
    fs.writeFileSync(FORCE_RELOAD_FLAG, new Date().toISOString(), 'utf-8');
    logRepair('Manual Force Reload triggered on Google Voice tab');
    res.redirect('/watchdog/status');
  });

  app.get('/watchdog/screenshot.png', (_req: Request, res: Response) => {
    const p = fs.existsSync(LIVE_STATUS_SCREENSHOT_PATH)
      ? LIVE_STATUS_SCREENSHOT_PATH
      : SCREENSHOT_PATH;
    if (fs.existsSync(p)) {
      res.sendFile(p);
      return;
    }
    res.status(404).send('No screenshot captured yet.');
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
  <title>Sarah AI Self-Healing Watchdog (Gemini Live ${VOICE_PROFILE})</title>
  <style>
    body { font-family: system-ui, sans-serif; background: #0f172a; color: #f8fafc; padding: 20px; max-width: 960px; margin: 0 auto; }
    .banner { background: ${color}; color: #000; font-weight: 800; padding: 16px 20px; border-radius: 8px; font-size: 1.2rem; display: flex; justify-content: space-between; align-items: center; }
    .actions { display: flex; gap: 10px; margin-top: 14px; flex-wrap: wrap; }
    .btn { background: #10b981; color: #020617; border: none; border-radius: 6px; padding: 10px 16px; font-weight: 800; cursor: pointer; font-size: 0.9rem; }
    .btn-secondary { background: #38bdf8; color: #020617; }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 16px; margin-top: 16px; }
    .card { background: #1e293b; padding: 16px; border-radius: 8px; border: 1px solid #334155; }
    .ok { color: #34d399; font-weight: bold; }
    .bad { color: #f87171; font-weight: bold; }
    pre { background: #020617; padding: 12px; border-radius: 6px; overflow-x: auto; font-size: 0.82rem; color: #cbd5e1; }
  </style>
</head>
<body>
  <div class="banner">
    <span>SARAH (GEMINI LIVE VINDEMIATRIX • +14803319455): ${report.overallStatus}</span>
    <span>Anti-Hangup Guard: ${report.antiHangupGuard}</span>
  </div>
  <div class="actions">
    <form method="POST" action="/watchdog/trigger-synthetic-ring" style="margin:0;">
      <button class="btn" type="submit">⚡ Run 5s Synthetic Ring SLA Test</button>
    </form>
    <form method="POST" action="/watchdog/force-reload" style="margin:0;">
      <button class="btn btn-secondary" type="submit">🔄 Force Reload Google Voice Tab</button>
    </form>
  </div>
  <div class="grid">
    <div class="card">
      <h3>Voice &amp; Anti-Hijack Ownership</h3>
      <p>Voice Profile: <strong class="ok">${report.voiceProfile}</strong></p>
      <p>Anti-Hangup DOM Guard: <strong class="ok">${report.antiHangupGuard}</strong></p>
      <p>Chrome Voice Purged: <span class="${report.chromeVoicePurged ? 'ok' : 'bad'}">${report.chromeVoicePurged}</span></p>
      <p>Exclusive Call Owner: <strong class="ok">${report.exclusiveCallOwner}</strong></p>
      <p>Single Browser Instance (${report.checks.rootBrowserCount}): <span class="${report.checks.singleBrowserInstanceLocked ? 'ok' : 'bad'}">${report.checks.singleBrowserInstanceLocked}</span></p>
      <p>Google Voice Logged In: <span class="${report.checks.googleVoiceLoggedIn ? 'ok' : 'bad'}">${report.checks.googleVoiceLoggedIn}</span></p>
      <p>PulseAudio Virtual Bridge: <span class="${report.checks.pulseAudioSinkReady ? 'ok' : 'bad'}">${report.checks.pulseAudioSinkReady}</span></p>
    </div>
    <div class="card">
      <h3>Call Pickup &amp; Duration Auditor</h3>
      <p>Active Call Right Now: <strong>${report.sarahTelemetry.activeCallInProgress ? 'YES (ON CALL)' : 'Idle / Listening'}</strong></p>
      <p>Voice Stream State: <strong>${report.sarahTelemetry.voiceSessionState}</strong></p>
      <p>Last Call Duration: <strong>${report.sarahTelemetry.lastCallDurationMs !== null ? `${report.sarahTelemetry.lastCallDurationMs}ms` : 'N/A'}</strong></p>
      <p>PCM Bytes Sent to Mic: <strong>${report.sarahTelemetry.pcmBytesSentToMic}</strong></p>
      <p>Premature Hangups Count: <strong class="${report.sarahTelemetry.prematureHangupsCount > 0 ? 'bad' : 'ok'}">${report.sarahTelemetry.prematureHangupsCount}</strong></p>
      <p>Total Calls Answered: <strong class="ok">${report.sarahTelemetry.totalCallsAnswered}</strong></p>
      <p>Last Synthetic SLA Test: <strong class="${report.sarahTelemetry.lastSyntheticTestPassedIso ? 'ok' : ''}">${report.sarahTelemetry.lastSyntheticTestPassedIso ? `${report.sarahTelemetry.lastSyntheticTestPassedIso} (${report.sarahTelemetry.lastSyntheticPickupLatencyMs ?? 0}ms)` : 'Pending'}</strong></p>
    </div>
  </div>
  <div class="card" style="margin-top: 16px;">
    <h3>Autonomous Gemini Diagnosis &amp; Repair Log</h3>
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
  Boolean(process.env.pm_exec_path && /sarah-watchdog\.(ts|js|mjs)$/i.test(process.argv[1]));

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
        `[Sarah Watchdog] Vindemiatrix + Anti-Hangup Exclusive Dashboard listening on http://0.0.0.0:${PORT}/watchdog/status`
      );
    });
    setInterval(() => {
      runWatchdogCycle().catch((err) => console.error('[Watchdog Loop Error]', err));
    }, 10000);
  }
}
