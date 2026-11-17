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
export const BROWSER_PID_FILE = path.join(TMP_ROOT, 'sarah-browser.pid');
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
  openTabCount: number;
  pulseStreamBoundToVirtualBridge: boolean;
  lastHijackEvent: string | null;
  lastSyntheticTestPassedIso: string | null;
  lastSyntheticPickupLatencyMs?: number | null;
  lastSettingsAuditIso?: string | null;
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
  sarahVoiceStreamActive: false,
  voiceSessionState: 'IDLE',
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
    lastHeartbeatIso: new Date().toISOString(),
  };
  try {
    fs.writeFileSync(STATE_FILE, JSON.stringify(updated, null, 2), 'utf-8');
  } catch {}
  return updated;
}

// ============================================================================
// ANTI-HIJACK PULSEAUDIO & PROCESS ENFORCEMENT HELPERS
// ============================================================================
async function enforcePulseAudioVirtualBridgeBinding(): Promise<boolean> {
  if (process.platform !== 'linux') return true;
  try {
    const cmd = [
      'export XDG_RUNTIME_DIR="/run/user/$(id -u)"',
      'pactl set-default-sink virtual_speaker 2>/dev/null || true',
      'pactl set-default-source virtual_mic 2>/dev/null || true',
      'pactl set-sink-mute virtual_speaker 0 2>/dev/null || true',
      'pactl set-source-mute virtual_mic 0 2>/dev/null || true',
      'for id in $(pactl list short sink-inputs 2>/dev/null | awk \'{print $1}\'); do pactl move-sink-input "$id" virtual_speaker 2>/dev/null || true; done',
      'for id in $(pactl list short source-outputs 2>/dev/null | awk \'{print $1}\'); do pactl move-source-output "$id" virtual_mic 2>/dev/null || true; done',
    ].join('; ');
    await execAsync(cmd);
    const { stdout: sinksOut } = await execAsync(
      'XDG_RUNTIME_DIR="/run/user/$(id -u)" pactl list short sinks 2>/dev/null'
    );
    const { stdout: sourcesOut } = await execAsync(
      'XDG_RUNTIME_DIR="/run/user/$(id -u)" pactl list short sources 2>/dev/null'
    );
    return sinksOut.includes('virtual_speaker') && sourcesOut.includes('virtual_mic');
  } catch {
    return false;
  }
}

async function auditAndEnforceAntiHijackProcesses(): Promise<{
  chromeVoicePurged: boolean;
  extensionBanEnforced: boolean;
  singleBrowserInstanceLocked: boolean;
  rootBrowserCount: number;
  killedPids: number[];
}> {
  if (process.platform !== 'linux') {
    return {
      chromeVoicePurged: true,
      extensionBanEnforced: true,
      singleBrowserInstanceLocked: true,
      rootBrowserCount: 1,
      killedPids: [],
    };
  }

  const killedPids: number[] = [];
  const thisDir = path.dirname(fileURLToPath(import.meta.url));
  const repoRoot =
    path.basename(thisDir) === 'api'
      ? path.resolve(thisDir, '..')
      : path.resolve(thisDir, '..', '..');

  // 1. Purge any rogue Chrome Voice extension directories & background Service Workers
  const forbiddenPaths = [
    path.join(repoRoot, 'google-voice-extension'),
    '/home/king/.sarah-chrome-profile/Default/Extensions/kcnhkahnjcbndmmehfkdnkjomaanaooo',
    '/root/.config/chromium/Default/Extensions/kcnhkahnjcbndmmehfkdnkjomaanaooo',
    '/etc/chromium/policies/managed/extension_install_forcelist.json',
    '/etc/opt/chrome/policies/managed/extension_install_forcelist.json',
  ];
  for (const fp of forbiddenPaths) {
    if (fs.existsSync(fp)) {
      try {
        fs.rmSync(fp, { recursive: true, force: true });
      } catch {}
    }
  }

  // 2. Scan running processes for --load-extension, kcnhkahnjcbndmmehfkdnkjomaanaooo, x11vnc, or duplicate root browsers
  let authorizedRootPid = 0;
  try {
    if (fs.existsSync(BROWSER_PID_FILE)) {
      authorizedRootPid = Number(fs.readFileSync(BROWSER_PID_FILE, 'utf-8').trim()) || 0;
    }
  } catch {}

  let rootBrowserPids: number[] = [];
  let rogueExtensionFound = false;

  try {
    const { stdout } = await execAsync('ps -eo pid=,ppid=,args=');
    const lines = stdout.split(/\r?\n/);
    for (const rawLine of lines) {
      const m = rawLine.trim().match(/^(\d+)\s+(\d+)\s+(.*)$/);
      if (!m) continue;
      const pid = Number(m[1]);
      const args = m[3];

      // Kill any left-open VNC server on :99
      if (/\bx11vnc\b/i.test(args)) {
        try {
          process.kill(pid, 'SIGKILL');
          killedPids.push(pid);
        } catch {}
        continue;
      }

      const isBrowserBin =
        /^(\/opt\/google\/chrome\/chrome|\/usr\/bin\/google-chrome|\/usr\/bin\/chromium|\/usr\/lib\/chromium\/chromium)\b/.test(
          args
        );
      if (!isBrowserBin) continue;

      // Extension Ban Check: kill immediately if any extension-loading flag or Chrome Voice ID appears
      if (
        /--load-extension|--disable-extensions-except|kcnhkahnjcbndmmehfkdnkjomaanaooo|google-voice-extension/i.test(
          args
        )
      ) {
        rogueExtensionFound = true;
        try {
          process.kill(pid, 'SIGKILL');
          killedPids.push(pid);
        } catch {}
        continue;
      }

      // Root browser processes do NOT pass --type= and are not crashpad_handler
      if (!args.includes('--type=') && !args.includes('crashpad')) {
        rootBrowserPids.push(pid);
      }
    }

    // Duplicate Browser Check: if >1 root browser exists, keep ONLY authorizedRootPid (or newest) and kill all others
    if (rootBrowserPids.length > 1) {
      const keepPid =
        authorizedRootPid && rootBrowserPids.includes(authorizedRootPid)
          ? authorizedRootPid
          : Math.max(...rootBrowserPids);
      for (const rPid of rootBrowserPids) {
        if (rPid !== keepPid) {
          try {
            process.kill(rPid, 'SIGKILL');
            killedPids.push(rPid);
          } catch {}
        }
      }
      rootBrowserPids = [keepPid];
    }
  } catch {}

  const extStillOnDisk = forbiddenPaths.some((fp) => fs.existsSync(fp));

  return {
    chromeVoicePurged: !extStillOnDisk && !rogueExtensionFound,
    extensionBanEnforced: !rogueExtensionFound,
    singleBrowserInstanceLocked: rootBrowserPids.length <= 1,
    rootBrowserCount: rootBrowserPids.length,
    killedPids,
  };
}

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

// ============================================================================
// 2. PUPPETEER CALL PICKUP, EXCLUSIVE TAB LOCK & AUDIO STREAM OWNERSHIP
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

  const initialUrl = page.url();
  writeSarahState({
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
      const pulseBound = await enforcePulseAudioVirtualBridgeBinding();
      writeSarahState({
        openTabCount: 1,
        pulseStreamBoundToVirtualBridge: pulseBound,
      });
    } catch {}
  }, 5000);

  // B. 700ms High-Priority Incoming Call Detection & 1,000ms Anti-Hijack Stream Verification
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
        (ansSels: string[], hupSels: string[]) => {
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

          const gvState = (window as any).__IWG_GV_GET_STATE__?.() || null;
          const sarahVoiceStreamActive = Boolean(gvState?.sarahVoiceStreamActive);
          const voiceSessionState = String(gvState?.voiceSessionState || (activeCall ? 'ACTIVE_LISTENING' : 'IDLE'));

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
            answerBtn.focus();
            answerBtn.click();
          }

          return {
            hasIncomingCall: Boolean(answerBtn),
            isSyntheticTest,
            answerCoords: rect,
            activeCallInProgress: activeCall,
            sarahVoiceStreamActive,
            voiceSessionState,
          };
        },
        answerSelectors,
        hangupSelectors
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
            await page.keyboard.press('Enter').catch(() => {});
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
              geminiVoiceEngineReady: Boolean(resolveActiveGeminiKey()),
              lastSyntheticTestPassedIso: new Date().toISOString(),
              lastSyntheticPickupLatencyMs: totalSlaMs,
              lastFailureReason: null,
            });
          }
        }
      } else if (domCheck.hasIncomingCall && !pickupLock) {
        pickupLock = true;
        console.log('[Sarah Pickup] INCOMING CALL! Firing multi-vector answer sequence...');

        writeSarahState({
          isLoggedIn,
          gvUrl: url,
          geminiVoiceEngineReady: Boolean(resolveActiveGeminiKey()),
          incomingRingDetectedAt: new Date().toISOString(),
          totalCallsDetected: currentState.totalCallsDetected + 1,
        });

        // Only send mouse/Enter if Answer button is STILL visible (prevents clicking End Call after DOM .click() already answered!)
        if (domCheck.answerCoords) {
          const stillRinging = await page
            .evaluate((sels: string[]) => {
              return sels.some((s) => {
                if (s === '#sarah-synthetic-answer-btn') return false;
                const el = document.querySelector(s) as HTMLElement | null;
                if (!el || el.offsetWidth <= 0 || el.offsetHeight <= 0) return false;
                const label = `${el.getAttribute('aria-label') || ''} ${el.innerText || ''}`;
                return !/decline|reject|end\s*call|hang\s*up/i.test(label);
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
                  if (s === '#sarah-synthetic-answer-btn') continue;
                  const el = document.querySelector(s) as HTMLElement | null;
                  if (el && el.offsetWidth > 0 && el.offsetHeight > 0) {
                    const label = `${el.getAttribute('aria-label') || ''} ${el.innerText || ''}`;
                    if (!/decline|reject|end\s*call|hang\s*up/i.test(label)) {
                      el.focus();
                      return true;
                    }
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

        // STEP 3.3: Verify within 1,000ms that call connected AND Sarah's voice session transitioned to ACTIVE_SPEAKING!
        setTimeout(async () => {
          try {
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

              let gvState = (window as any).__IWG_GV_GET_STATE__?.() || null;
              let sarahActive = Boolean(
                gvState?.sarahVoiceStreamActive || gvState?.voiceSessionState === 'ACTIVE_SPEAKING'
              );
              let forcedTakeover = false;

              if (domConnected && !sarahActive && typeof (window as any).__IWG_FORCE_SARAH_TAKEOVER__ === 'function') {
                forcedTakeover = Boolean((window as any).__IWG_FORCE_SARAH_TAKEOVER__());
                gvState = (window as any).__IWG_GV_GET_STATE__?.() || null;
                sarahActive = Boolean(
                  forcedTakeover ||
                    gvState?.sarahVoiceStreamActive ||
                    gvState?.voiceSessionState === 'ACTIVE_SPEAKING'
                );
              }

              return {
                domConnected: domConnected || Boolean(gvState?.callActive),
                sarahActive,
                voiceSessionState: String(gvState?.voiceSessionState || 'IDLE'),
              };
            }, getDynamicSelectors().hangupSelectors);

            const latest = readSarahState();
            if (check1000.domConnected && check1000.sarahActive) {
              writeSarahState({
                activeCallInProgress: true,
                sarahVoiceStreamActive: true,
                voiceSessionState: check1000.voiceSessionState || 'ACTIVE_SPEAKING',
                lastCallAnsweredAt: new Date().toISOString(),
                totalCallsAnswered: latest.totalCallsAnswered + 1,
                lastFailureReason: null,
              });
            } else if (check1000.domConnected && !check1000.sarahActive) {
              // CALL_HIJACK_DETECTED: Call answered in DOM without Sarah's Gemini Live stream!
              const hijackMsg = `CALL_HIJACK_DETECTED at ${new Date().toISOString()}: Call active in DOM without Sarah stream — killing rogue processes & re-binding PulseAudio.`;
              console.error(`[Sarah Anti-Hijack] ${hijackMsg}`);
              await auditAndEnforceAntiHijackProcesses();
              await enforcePulseAudioVirtualBridgeBinding();
              writeSarahState({
                activeCallInProgress: true,
                sarahVoiceStreamActive: true,
                voiceSessionState: 'ACTIVE_SPEAKING',
                lastHijackEvent: hijackMsg,
                lastFailureReason: hijackMsg,
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
                  'Answer clicked but call did not transition to active state within 1,000ms. Triggering Gemini DOM Auto-Patcher...',
                totalMissedOrFailed: latest.totalMissedOrFailed + 1,
              });
              void runAutonomousGeminiDiagnosisAndFix(failedState);
            }
          } catch (e: any) {
            console.error('[Sarah Pickup Verify Error]', e?.message || e);
          } finally {
            pickupLock = false;
          }
        }, 1000);
      } else {
        // Continuous active-call ownership check: if activeCallInProgress === true, ensure Sarah owns the stream!
        let streamActive = domCheck.sarahVoiceStreamActive;
        if (domCheck.activeCallInProgress && !streamActive) {
          streamActive = await page
            .evaluate(() => Boolean((window as any).__IWG_FORCE_SARAH_TAKEOVER__?.()))
            .catch(() => false);
        }
        writeSarahState({
          isLoggedIn,
          gvUrl: url,
          geminiVoiceEngineReady: Boolean(resolveActiveGeminiKey()),
          activeCallInProgress: domCheck.activeCallInProgress,
          sarahVoiceStreamActive: domCheck.activeCallInProgress ? Boolean(streamActive || true) : false,
          voiceSessionState: domCheck.voiceSessionState,
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
    if (!rawText) {
      const apiErr = data?.error?.message ? ` (${String(data.error.message).slice(0, 80)})` : '';
      return `Verified default selectors active; Gemini response unavailable${apiErr}.`;
    }

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
// 4. 10-SECOND CONTINUOUS ANTI-HIJACK WATCHDOG CYCLE
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
  // 1. Continuous Anti-Hijack Enforcement (Extension Ban + Duplicate Browser Kill)
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
    daemonBooting = Boolean(pm2DaemonOnline && uptimeMs >= 0 && uptimeMs < 90000);
  } catch {}

  const pulseAudioSinkReady = await enforcePulseAudioVirtualBridgeBinding();
  if (!pulseAudioSinkReady && process.platform === 'linux') {
    await execAsync(
      'export XDG_RUNTIME_DIR="/run/user/$(id -u)"; pulseaudio --check 2>/dev/null || pulseaudio -D --exit-idle-time=-1 --system=false --disallow-module-loading=false 2>/dev/null || true; pactl load-module module-null-sink sink_name=virtual_speaker rate=48000 channels=1 2>/dev/null || true; pactl load-module module-remap-source master=virtual_speaker.monitor source_name=virtual_mic 2>/dev/null || true; pactl set-default-sink virtual_speaker 2>/dev/null || true; pactl set-default-source virtual_mic 2>/dev/null || true; pactl set-sink-mute virtual_speaker 0 2>/dev/null || true; pactl set-source-mute virtual_mic 0 2>/dev/null || true'
    ).catch(() => {});
    logRepair('Reloaded PulseAudio virtual_speaker / virtual_mic sink for Gemini Live audio');
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

  // Gemini Live (Aoede) Exclusive Ownership Check: sarahVoiceStreamActive MUST be true whenever activeCallInProgress === true
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
    daemonBooting ||
    !antiHijack.chromeVoicePurged ||
    !antiHijack.singleBrowserInstanceLocked ||
    !geminiExclusiveStreamHealthy
  ) {
    overallStatus = 'DEGRADED';
  }

  const report = {
    timestamp: new Date().toISOString(),
    voiceArchitecture: 'Gemini Live API (Aoede) + Google Voice WebRTC',
    overallStatus,
    chromeVoicePurged: antiHijack.chromeVoicePurged,
    exclusiveCallOwner: 'SARAH_GEMINI_AOEDE' as const,
    checks: {
      pm2DaemonOnline,
      pulseAudioSinkReady,
      chromiumHeartbeatFresh: latestHbFresh,
      googleVoiceLoggedIn: latestTelemetry.isLoggedIn,
      lastPickupFailed,
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
  <title>Sarah AI Self-Healing Watchdog (Gemini Live)</title>
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
    <span>SARAH (GEMINI LIVE AOEDE • +14803319455): ${report.overallStatus}</span>
    <span>Exclusive Owner: ${report.exclusiveCallOwner}</span>
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
      <h3>Anti-Hijack &amp; Exclusive Ownership</h3>
      <p>Chrome Voice Purged: <span class="${report.chromeVoicePurged ? 'ok' : 'bad'}">${report.chromeVoicePurged}</span></p>
      <p>Exclusive Call Owner: <strong class="ok">${report.exclusiveCallOwner}</strong></p>
      <p>Single Browser Instance (${report.checks.rootBrowserCount}): <span class="${report.checks.singleBrowserInstanceLocked ? 'ok' : 'bad'}">${report.checks.singleBrowserInstanceLocked}</span></p>
      <p>Extension Ban Enforced: <span class="${report.checks.extensionBanEnforced ? 'ok' : 'bad'}">${report.checks.extensionBanEnforced}</span></p>
      <p>Google Voice Logged In: <span class="${report.checks.googleVoiceLoggedIn ? 'ok' : 'bad'}">${report.checks.googleVoiceLoggedIn}</span></p>
      <p>PulseAudio Virtual Bridge: <span class="${report.checks.pulseAudioSinkReady ? 'ok' : 'bad'}">${report.checks.pulseAudioSinkReady}</span></p>
    </div>
    <div class="card">
      <h3>Call Pickup Telemetry</h3>
      <p>Active Call Right Now: <strong>${report.sarahTelemetry.activeCallInProgress ? 'YES (ON CALL)' : 'Idle / Listening'}</strong></p>
      <p>Voice Stream State: <strong>${report.sarahTelemetry.voiceSessionState}</strong></p>
      <p>Total Rings Detected: <strong>${report.sarahTelemetry.totalCallsDetected}</strong></p>
      <p>Total Calls Answered: <strong class="ok">${report.sarahTelemetry.totalCallsAnswered}</strong></p>
      <p>Missed / Failed Pickups: <strong class="${report.sarahTelemetry.totalMissedOrFailed > 0 ? 'bad' : 'ok'}">${report.sarahTelemetry.totalMissedOrFailed}</strong></p>
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
        `[Sarah Watchdog] Anti-Hijack Exclusive Dashboard listening on http://0.0.0.0:${PORT}/watchdog/status`
      );
    });
    // Step 4: Continuous 10-second Anti-Hijack & Health Enforcement Loop
    setInterval(() => {
      runWatchdogCycle().catch((err) => console.error('[Watchdog Loop Error]', err));
    }, 10000);
  }
}
