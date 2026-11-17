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
  GeminiAoedeCallBridge,
  enforceChromiumPulseBinding,
  CALLER_SINK,
  SARAH_VIRTUAL_MIC,
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

const SARAH_SYSTEM_PROMPT = `You are Sarah, the warm, poised, and helpful AI receptionist for I Will Global LLC (IWG Insurance and Financial Services).
Speak naturally with a friendly, reassuring cadence.
Greet callers warmly, ask for their name and how you can help them today (such as scheduling a consultation with King Amen-Ra or Aneesha Sullivan, or answering general Medicare/health plan reception questions), and keep responses concise for phone conversation.`;

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

  console.log('[Sarah Daemon] Opening Google Voice Calls view...');
  await primaryPage.goto(GOOGLE_VOICE_URL, {
    waitUntil: 'domcontentloaded',
    timeout: 60000,
  });

  // Dismiss any promotional banner so full call sidebar height stays visible
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

  // 3. Attach 700ms Bulletproof Call Pickup & Gemini Auto-Patcher
  await attachBulletproofCallPickup(primaryPage, context);

  // 4. Wire Zero-Lag Gemini Live (Aoede) Audio Bridge to Active Call State
  const aoedeBridge = new GeminiAoedeCallBridge({
    onEndCallRequest: () => {
      const { hangupSelectors } = getDynamicSelectors();
      primaryPage
        .evaluate((sels: string[]) => {
          for (const sel of sels) {
            if (sel === '#sarah-synthetic-hangup-btn') continue;
            const btn = document.querySelector<HTMLElement>(sel);
            if (btn && btn.offsetWidth > 0) {
              btn.click();
              return;
            }
          }
        }, hangupSelectors)
        .catch(() => {});
    },
  });

  setInterval(() => {
    const state = readSarahState();
    if (state.activeCallInProgress) {
      enforceChromiumPulseBinding();
      aoedeBridge.startCallBridge(SARAH_SYSTEM_PROMPT);
    } else {
      aoedeBridge.stopCallBridge();
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
        title: 'Google Voice (Sarah Gemini Aoede Pulse Bridge)',
        visibilityState: 'visible',
        sessionAuthenticated: state.isLoggedIn,
        callActive: state.activeCallInProgress,
        isSpeaking: state.sarahVoiceStreamActive,
        totalCallsAnswered: state.totalCallsAnswered,
        hasPreloadedGreeting: true,
        receivingCallsText: 'Zero-Lag PulseAudio (gv_speaker <-> sarah_virtual_mic) + Gemini Aoede ACTIVE',
      }),
    }).catch(() => {});
  }, 6000);

  console.log(
    '[Sarah Daemon] Live! Exclusive Google Voice Pickup + Gemini Aoede Audio Bridge active.'
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
