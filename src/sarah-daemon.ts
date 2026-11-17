import { execSync } from 'child_process';
import * as fs from 'fs';
import { createRequire } from 'module';
import * as path from 'path';
import { fileURLToPath } from 'url';
import {
  attachBulletproofCallPickup,
  getDynamicSelectors,
  readSarahState,
} from './watchdog/sarah-watchdog.ts';
import {
  BROWSER_PID_FILE,
  enforceExclusiveSarahCallOwnership,
  lockBrowserToSarahOnly,
} from './watchdog/anti-hijack.ts';
import {
  setupZeroLagPulseAudioTopology,
  GeminiVindemiatrixCallBridge,
  enforceChromiumPulseBinding,
  CALLER_SINK,
  SARAH_VIRTUAL_MIC,
  VOICE_PROFILE,
} from './audio/gemini-pulse-bridge.ts';

type Browser = any;
type Page = any;

const THIS_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(THIS_DIR, '..');

const USER_DATA_DIR =
  process.env.SARAH_CHROMIUM_PROFILE ||
  (fs.existsSync('/home/king/.sarah-chrome-profile')
    ? '/home/king/.sarah-chrome-profile'
    : '/root/.config/sarah-chromium-profile');
const GOOGLE_VOICE_URL = 'https://voice.google.com/u/0/calls';

export const SARAH_SYSTEM_PROMPT = `You are Sarah, the warm, poised, human-indistinguishable receptionist for I Will Global Insurance and Financial Services on (480) 331-9455.

VOICE & CADENCE RULES (Vindemiatrix):
- Speak with natural, unhurried, human-indistinguishable conversational warmth and gentle, natural breath pacing between phrases.
- Never sound robotic, rushed, clipped, or abrupt. Let sentences land naturally before pausing to listen.

MANDATORY RECEPTION FLOW & CALL-COMPLETION LAW:
1. Warm Opening Greeting: Greet every caller warmly ("Thank you for calling I Will Global Insurance and Financial Services, this is Sarah speaking. Whom do I have the pleasure of speaking with, and how may I help you today?").
2. Gather Caller Details: Patiently gather the caller's full name, callback phone number if needed, state, and exact reason for calling (Medicare Advantage/Supplement review, Life Insurance/IUL, Annuities/Retirement, Dental/Vision, Hospital Indemnity, or speaking/scheduling with King Amen-Ra or Aneesha Sullivan).
3. Confirm Next Steps: Clearly confirm their appointment details, callback confirmation, or warm transfer steps, and ask if there is anything else you can help them with today.
4. NEVER TERMINATE OR STOP PREMATURELY: You must NEVER hang up, end the conversation early, or go silent before completing your greeting, gathering the caller's name and reason for calling, confirming next steps, and hearing the caller say goodbye.`;

function resolvePuppeteer() {
  const requireFromDaemon = createRequire(path.join(REPO_ROOT, 'cloud-voip-daemon', 'package.json'));
  return requireFromDaemon('puppeteer-core');
}

function resolveChromiumExecutable(): string | undefined {
  const candidates = [
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    process.env.PUPPETEER_EXECUTABLE_PATH,
    process.env.CHROME_PATH,
  ].filter(Boolean) as string[];
  for (const bin of candidates) {
    if (fs.existsSync(bin)) return bin;
  }
  return undefined;
}

function ensureXvfbDisplay99(): void {
  if (process.platform !== 'linux') return;
  process.env.DISPLAY = process.env.DISPLAY || ':99';
  if (!fs.existsSync('/tmp/.X11-unix/X99')) {
    try {
      execSync('rm -f /tmp/.X99-lock && (Xvfb :99 -screen 0 1280x960x24 -nolisten tcp -ac -noreset >/dev/null 2>&1 &)');
      execSync('sleep 0.7');
    } catch {}
  }
}

export async function launchSarahExclusiveBrowser(): Promise<{
  browser: Browser;
  page: Page;
}> {
  await enforceExclusiveSarahCallOwnership();
  fs.mkdirSync(USER_DATA_DIR, { recursive: true });
  try {
    fs.rmSync(`${USER_DATA_DIR}/SingletonLock`, { force: true });
    fs.rmSync(`${USER_DATA_DIR}/SingletonCookie`, { force: true });
    fs.rmSync(`${USER_DATA_DIR}/SingletonSocket`, { force: true });
    fs.rmSync(`${USER_DATA_DIR}/Default/Extensions`, { recursive: true, force: true });
    fs.rmSync(`${USER_DATA_DIR}/Default/Service Worker`, { recursive: true, force: true });
  } catch {}

  ensureXvfbDisplay99();

  // 1. Provision Zero-Lag PulseAudio Virtual Sinks BEFORE Chromium boots
  setupZeroLagPulseAudioTopology();

  const puppeteer = resolvePuppeteer();
  const executablePath = resolveChromiumExecutable();
  const uid = typeof process.getuid === 'function' ? process.getuid() : 1000;

  // 2. Launch Exclusive Chromium Instance (No Extensions, Unmuted Audio, Bound to gv_speaker / sarah_virtual_mic)
  const browser = await puppeteer.launch({
    executablePath,
    headless: false,
    userDataDir: USER_DATA_DIR,
    env: {
      ...process.env,
      DISPLAY: process.env.DISPLAY || ':99',
      DBUS_SESSION_BUS_ADDRESS: '/dev/null',
      XDG_RUNTIME_DIR: process.env.XDG_RUNTIME_DIR || `/run/user/${uid}`,
      PULSE_SINK: CALLER_SINK,
      PULSE_SOURCE: SARAH_VIRTUAL_MIC,
      PULSE_LATENCY_MSEC: '10',
    },
    ignoreDefaultArgs: [
      '--enable-automation',
      '--disable-extensions',
      '--mute-audio',
    ],
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--disable-extensions',
      '--disable-component-extensions-with-background-pages',
      '--disable-default-apps',
      '--disable-sync',
      '--password-store=basic',
      '--use-mock-keychain',
      '--no-first-run',
      '--no-default-browser-check',
      '--autoplay-policy=no-user-gesture-required',
      '--use-fake-ui-for-media-stream',
      '--disable-background-timer-throttling',
      '--disable-backgrounding-occluded-windows',
      '--disable-renderer-backgrounding',
      '--disable-blink-features=AutomationControlled',
      '--disable-features=AudioServiceOutOfProcess,TranslateUI,BlinkGenPropertyTrees',
      '--alsa-output-device=pulse',
      '--remote-debugging-address=127.0.0.1',
      '--remote-debugging-port=9222',
      '--window-size=1280,960',
      `--display=${process.env.DISPLAY || ':99'}`,
    ],
    defaultViewport: { width: 1280, height: 960 },
  });

  const spawnedPid = browser.process()?.pid;
  if (spawnedPid) {
    try {
      fs.writeFileSync(BROWSER_PID_FILE, String(spawnedPid), 'utf-8');
    } catch {}
  }

  const context = browser.defaultBrowserContext();
  await context.overridePermissions('https://voice.google.com', [
    'microphone',
    'notifications',
  ]);

  const existingPages = await browser.pages();
  const primaryPage = existingPages.length > 0 ? existingPages[0] : await browser.newPage();

  await lockBrowserToSarahOnly(browser, primaryPage);
  setInterval(() => enforceExclusiveSarahCallOwnership().catch(() => {}), 10000);

  // Polyfill tsx/esbuild __name helper on every navigation
  await primaryPage.evaluateOnNewDocument('window.__name = (fn) => fn;').catch(() => {});

  const hydrateFromVaultCookies = async () => {
    try {
      const bridgeToken = process.env.GV_BRIDGE_TOKEN || 'iwg-sarah-cloud-bridge-v10-9455';
      const vRes = await fetch('http://127.0.0.1:4000/api/sarah/gv-session-sync', {
        headers: { 'x-iwg-bridge-token': bridgeToken },
      });
      if (!vRes.ok) return false;
      const vData: any = await vRes.json();
      if (!Array.isArray(vData?.cookies) || vData.cookies.length === 0) return false;
      const cdp = await primaryPage.createCDPSession();
      await cdp.send('Network.clearBrowserCookies').catch(() => {});
      for (const c of vData.cookies) {
        if (!c?.name || typeof c?.value !== 'string' || !c?.domain) continue;
        const rawDomain = String(c.domain);
        const cleanHost = rawDomain.replace(/^\.+/, '');
        const isHostPrefix = String(c.name).startsWith('__Host-');
        const isSecurePrefix = isHostPrefix || String(c.name).startsWith('__Secure-');
        const isHostOnly = isHostPrefix || c.hostOnly === true || !rawDomain.startsWith('.');
        const ss = String(c.sameSite || '').toLowerCase();
        let sameSite: string | undefined;
        if (ss === 'no_restriction' || ss === 'none') sameSite = 'None';
        else if (ss === 'lax') sameSite = 'Lax';
        else if (ss === 'strict') sameSite = 'Strict';
        const secure = Boolean(c.secure) || isSecurePrefix || sameSite === 'None';
        const cookiePath = isHostPrefix ? '/' : String(c.path || '/');
        const entry: any = {
          name: String(c.name),
          value: String(c.value),
          path: cookiePath,
          secure,
          httpOnly: Boolean(c.httpOnly),
        };
        if (isHostOnly) {
          entry.url = `${secure ? 'https' : 'http'}://${cleanHost}${cookiePath.startsWith('/') ? cookiePath : '/' + cookiePath}`;
        } else {
          entry.domain = rawDomain;
        }
        if (sameSite) entry.sameSite = sameSite;
        if (typeof c.expires === 'number' && c.expires > 0) entry.expires = c.expires;
        else if (typeof c.expirationDate === 'number' && c.expirationDate > 0) entry.expires = c.expirationDate;
        await cdp.send('Network.setCookie', entry).catch(() => {});
      }
      return true;
    } catch {
      return false;
    }
  };

  console.log('[Sarah Daemon] Opening Google Voice Calls view...');
  await primaryPage.goto(GOOGLE_VOICE_URL, {
    waitUntil: 'domcontentloaded',
    timeout: 60000,
  });

  if (primaryPage.url().includes('workspace.google.com')) {
    console.log('[Sarah Daemon] Completing Google Workspace passive grandcentral SSO -> /u/0/calls...');
    await primaryPage
      .goto(
        'https://accounts.google.com/ServiceLogin?service=grandcentral&passive=true&continue=https%3A%2F%2Fvoice.google.com%2Fu%2F0%2Fcalls',
        { waitUntil: 'domcontentloaded', timeout: 45000 }
      )
      .catch(() => {});
    await new Promise((r) => setTimeout(r, 2500));
  }

  if (primaryPage.url().includes('accounts.google.com') || primaryPage.url().includes('workspace.google.com')) {
    const hydrated = await hydrateFromVaultCookies();
    if (hydrated) {
      await primaryPage
        .goto(GOOGLE_VOICE_URL, { waitUntil: 'domcontentloaded', timeout: 45000 })
        .catch(() => {});
      if (primaryPage.url().includes('workspace.google.com')) {
        await primaryPage
          .goto(
            'https://accounts.google.com/ServiceLogin?service=grandcentral&passive=true&continue=https%3A%2F%2Fvoice.google.com%2Fu%2F0%2Fcalls',
            { waitUntil: 'domcontentloaded', timeout: 45000 }
          )
          .catch(() => {});
      }
      await new Promise((r) => setTimeout(r, 2500));
    }
  }
  await primaryPage.evaluate('window.__name = (fn) => fn;').catch(() => {});

  setTimeout(async () => {
    await primaryPage
      .evaluate(() => {
        const banners = document.querySelectorAll('gv-tel-registration-banner, gv-app-banner');
        for (const b of banners) {
          const closeBtn = b.querySelector<HTMLElement>(
            'button[aria-label*="Close" i], button[aria-label*="Dismiss" i]'
          );
          if (closeBtn) closeBtn.click();
        }
      })
      .catch(() => {});
  }, 4000);

  // 3. Attach 700ms Bulletproof Single-Click Call Pickup, Anti-Hangup DOM Guard, & Duration Auditor
  await attachBulletproofCallPickup(primaryPage, context);

  // 4. Wire Zero-Lag Gemini Live (Vindemiatrix) Audio Bridge to Active Call State
  const vindemiatrixBridge = new GeminiVindemiatrixCallBridge({
    onEndCallRequest: () => {
      const { hangupSelectors } = getDynamicSelectors();
      primaryPage
        .evaluate((sels: string[]) => {
          const win = window as any;
          win.__SARAH_AUTHORIZED_HANGUP__ = true;
          try {
            for (const sel of sels) {
              if (sel === '#sarah-synthetic-hangup-btn') continue;
              const btn = document.querySelector<HTMLElement>(sel);
              if (btn && btn.offsetWidth > 0) {
                btn.click();
                return;
              }
            }
          } finally {
            setTimeout(() => {
              win.__SARAH_AUTHORIZED_HANGUP__ = false;
            }, 250);
          }
        }, hangupSelectors)
        .catch(() => {});
    },
  });

  setInterval(() => {
    const state = readSarahState();
    if (state.activeCallInProgress) {
      enforceChromiumPulseBinding();
      vindemiatrixBridge.startCallBridge(SARAH_SYSTEM_PROMPT);
      const bStatus = vindemiatrixBridge.getBridgeStatus();
      const shouldLockHangup = Boolean(bStatus.isRunning && (!bStatus.scriptCompleted || bStatus.isSpeaking));
      primaryPage
        .evaluate((locked: boolean) => {
          (window as any).__SARAH_STREAM_LOCK_UNTIL_COMPLETE__ = locked;
        }, shouldLockHangup)
        .catch(() => {});
    } else {
      vindemiatrixBridge.stopCallBridge();
      primaryPage
        .evaluate(() => {
          (window as any).__SARAH_STREAM_LOCK_UNTIL_COMPLETE__ = false;
        })
        .catch(() => {});
    }
  }, 250);

  // Report live heartbeat to :4000/api/sarah/gv-heartbeat every 6s so CRM dashboard stays synced
  setInterval(() => {
    const state = readSarahState();
    fetch('http://127.0.0.1:4000/api/sarah/gv-heartbeat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        runner: 'cloud-daemon',
        url: state.gvUrl,
        title: `Google Voice (Sarah Gemini ${VOICE_PROFILE} Pulse Bridge)`,
        visibilityState: 'visible',
        sessionAuthenticated: state.isLoggedIn,
        callActive: state.activeCallInProgress,
        isSpeaking: state.sarahVoiceStreamActive,
        totalCallsAnswered: state.totalCallsAnswered,
        hasPreloadedGreeting: true,
        receivingCallsText: `Zero-Lag PulseAudio (gv_speaker <-> sarah_virtual_mic) + Gemini ${VOICE_PROFILE} ACTIVE`,
      }),
    }).catch(() => {});
  }, 6000);

  console.log(
    `[Sarah Daemon] Live! Exclusive Google Voice Pickup + Gemini ${VOICE_PROFILE} Audio Bridge active.`
  );
  return { browser, page: primaryPage };
}

const isDirectEntry =
  (typeof require !== 'undefined' && typeof module !== 'undefined' && require.main === module) ||
  Boolean(process.argv[1] && /sarah-daemon\.(ts|js|mjs)$/i.test(process.argv[1])) ||
  Boolean(process.env.pm_exec_path && /sarah-daemon\.(ts|js|mjs)$/i.test(process.env.pm_exec_path));

if (isDirectEntry) {
  launchSarahExclusiveBrowser().catch((err) => {
    console.error('[Sarah Daemon Fatal Error]', err);
    process.exit(1);
  });
}
