import { execSync } from 'child_process';
import * as fs from 'fs';
import { createRequire } from 'module';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { attachBulletproofCallPickup } from './watchdog/sarah-watchdog.ts';
import {
  BROWSER_PID_FILE,
  enforceExclusiveSarahCallOwnership,
  lockBrowserToSarahOnly,
} from './watchdog/anti-hijack.ts';

type Browser = any;
type Page = any;

const THIS_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(THIS_DIR, '..');

const USER_DATA_DIR =
  process.env.SARAH_CHROMIUM_PROFILE ||
  (fs.existsSync('/home/king')
    ? '/home/king/.sarah-chrome-profile'
    : '/root/.config/sarah-chromium-profile');
const GOOGLE_VOICE_URL = 'https://voice.google.com/u/0/calls';

function resolvePuppeteer() {
  const requireFromDaemon = createRequire(path.join(REPO_ROOT, 'cloud-voip-daemon', 'package.json'));
  return requireFromDaemon('puppeteer-core');
}

function resolveChromiumExecutable(): string | undefined {
  const candidates = [
    process.env.PUPPETEER_EXECUTABLE_PATH,
    process.env.CHROME_PATH,
    '/usr/local/bin/sarah-chrome',
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
  ].filter(Boolean) as string[];
  for (const bin of candidates) {
    if (fs.existsSync(bin)) return bin;
  }
  return undefined;
}

export async function launchSarahExclusiveBrowser(): Promise<{
  browser: Browser;
  page: Page;
}> {
  // 1. Pre-Launch Purge: Kill rogue Chrome Voice processes, extensions, and stale profile locks
  await enforceExclusiveSarahCallOwnership();
  fs.mkdirSync(USER_DATA_DIR, { recursive: true });
  try {
    fs.rmSync(`${USER_DATA_DIR}/SingletonLock`, { force: true });
    fs.rmSync(`${USER_DATA_DIR}/SingletonCookie`, { force: true });
    fs.rmSync(`${USER_DATA_DIR}/SingletonSocket`, { force: true });
    fs.rmSync(`${USER_DATA_DIR}/Default/Extensions`, { recursive: true, force: true });
    fs.rmSync(`${USER_DATA_DIR}/Default/Service Worker`, { recursive: true, force: true });
  } catch { }

  // Ensure virtual display :99 and PulseAudio virtual sinks are active
  process.env.DISPLAY = process.env.DISPLAY || ':99';
  if (process.platform === 'linux') {
    try {
      execSync(
        'export XDG_RUNTIME_DIR="/run/user/$(id -u)"; pulseaudio --check 2>/dev/null || pulseaudio --start || true; pactl list short sinks 2>/dev/null | grep -q virtual_speaker || pactl load-module module-null-sink sink_name=virtual_speaker rate=48000 channels=1 || true; pactl list short sources 2>/dev/null | grep -q virtual_mic || pactl load-module module-remap-source master=virtual_speaker.monitor source_name=virtual_mic || true; pactl set-default-sink virtual_speaker || true; pactl set-default-source virtual_mic || true'
      );
    } catch { }
  }

  const puppeteer = resolvePuppeteer();
  const executablePath = resolveChromiumExecutable();

  // 2. Launch Chromium with Extensions Strictly Disabled & WebRTC Audio Unthrottled
  const browser = await puppeteer.launch({
    executablePath,
    headless: false, // Runs on Xvfb :99 so WebRTC & Google Voice UI render natively
    userDataDir: USER_DATA_DIR,
    ignoreDefaultArgs: [
      '--enable-automation',
      '--disable-extensions', // Handled explicitly in args below to prevent override
      '--mute-audio', // CRITICAL: Never mute audio or Gemini Live Vindemiatrix cannot hear/speak
    ],
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      // PERMANENTLY BAN ALL EXTENSIONS & CHROME VOICE HIJACKERS:
      '--disable-extensions',
      '--disable-component-extensions-with-background-pages',
      '--disable-default-apps',
      '--disable-sync', // Prevents Chrome profile sync from re-downloading Chrome Voice extensions
      // UNTHROTTLED WEBRTC & AUDIO STREAMING FOR GEMINI LIVE (VINDEMIATRIX):
      '--autoplay-policy=no-user-gesture-required',
      '--use-fake-ui-for-media-stream',
      '--disable-background-timer-throttling',
      '--disable-backgrounding-occluded-windows',
      '--disable-renderer-backgrounding',
      '--disable-features=AudioServiceOutOfProcess,TranslateUI,BlinkGenPropertyTrees',
      '--remote-debugging-address=127.0.0.1',
      '--remote-debugging-port=9222',
      '--window-size=1280,960',
      `--display=${process.env.DISPLAY}`,
    ],
    defaultViewport: { width: 1280, height: 960 },
  });

  const spawnedPid = browser.process()?.pid;
  if (spawnedPid) {
    try {
      fs.writeFileSync(BROWSER_PID_FILE, String(spawnedPid), 'utf-8');
    } catch { }
  }

  const context = browser.defaultBrowserContext();
  await context.overridePermissions('https://voice.google.com', [
    'microphone',
    'notifications',
  ]);

  // 3. Reuse the first tab as Sarah's Exclusive Primary Page and close all others
  const existingPages = await browser.pages();
  const primaryPage = existingPages.length > 0 ? existingPages[0] : await browser.newPage();

  // Inject Sarah's Pure Digital WebRTC Virtual Bridge + Voice Receptionist Controller
  const webrtcBridgePath = path.join(REPO_ROOT, 'cloud-voip-daemon', 'webrtc-bridge.js');
  const contentScriptPath = path.join(REPO_ROOT, 'cloud-voip-daemon', 'content.js');
  if (fs.existsSync(webrtcBridgePath) && fs.existsSync(contentScriptPath)) {
    const webrtcCode = fs.readFileSync(webrtcBridgePath, 'utf-8');
    const contentCode = fs.readFileSync(contentScriptPath, 'utf-8');
    const cfgShim = `window.__IWG_CLOUD_DAEMON_CONFIG__ = { runner: "cloud-daemon", apiBase: "http://127.0.0.1:4000" };`;
    await primaryPage.evaluateOnNewDocument(
      `${cfgShim}\n${webrtcCode}\nif (location.hostname === 'voice.google.com') {\n${contentCode}\n}`
    );
  }

  // Enforce single-tab exclusivity every 5s (closes any popups or duplicate tabs)
  await lockBrowserToSarahOnly(browser, primaryPage);

  // Continuous 10s background check to terminate any rogue Chrome Voice processes
  setInterval(() => {
    enforceExclusiveSarahCallOwnership().catch(() => { });
  }, 10000);

  // 4. Navigate to Google Voice Calls View
  console.log('[Sarah Boot] Navigating to Google Voice...');
  await primaryPage.goto(GOOGLE_VOICE_URL, {
    waitUntil: 'domcontentloaded',
    timeout: 60000,
  });

  // 5. Attach the 700ms Multi-Vector Call Pickup & Gemini Auto-Patcher Loop
  await attachBulletproofCallPickup(primaryPage, context);
  console.log(
    '[Sarah Boot] Exclusive Call Pickup & Anti-Hijack Lock active (100% Google-Native / Gemini Live Vindemiatrix).'
  );

  return { browser, page: primaryPage };
}

const isDirectEntry =
  (typeof require !== 'undefined' && typeof module !== 'undefined' && require.main === module) ||
  Boolean(process.argv[1] && /sarah-browser\.(ts|js|mjs)$/i.test(process.argv[1]));

if (isDirectEntry) {
  launchSarahExclusiveBrowser().catch((err) => {
    console.error('[Sarah Boot Fatal Error]', err);
    process.exit(1);
  });
}
