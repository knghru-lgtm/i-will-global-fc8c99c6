import { execSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import puppeteer from 'puppeteer-core';

const LOCAL_API_BASE = process.env.LOCAL_API_URL || 'http://127.0.0.1:4000';
const PUBLIC_API_BASE = process.env.APP_URL || 'https://voice.iwillglobal.com';
const API_BASES = Array.from(new Set([LOCAL_API_BASE, PUBLIC_API_BASE]));
const BRIDGE_TOKEN = process.env.GV_BRIDGE_TOKEN || 'iwg-sarah-cloud-bridge-v10-9455';
const REGION = process.env.GOOGLE_CLOUD_REGION || 'us-west1';
const INSTANCE_ID = `gcloud-${REGION}-${randomUUID().slice(0, 8)}`;
const EXTENSION_BUILD = '2026-11-14-v13';
const MAX_IDLE_SESSION_AGE_MS = 6 * 60 * 60 * 1000; // Proactive 6h idle heap recycle

async function fetchDaemonApi(pathname, init = {}) {
  let lastErr = null;
  for (const base of API_BASES) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12000);
    try {
      const res = await fetch(`${base}${pathname}`, {
        ...init,
        signal: controller.signal,
      });
      clearTimeout(timer);
      if (res.ok) return res;
    } catch (err) {
      clearTimeout(timer);
      lastErr = err;
    }
  }
  if (lastErr) throw lastErr;
  return null;
}

const webrtcBridgeCode = readFileSync(new URL('./webrtc-bridge.js', import.meta.url), 'utf8');
const contentControllerCode = readFileSync(new URL('./content.js', import.meta.url), 'utf8');

let shuttingDown = false;
let activeBrowser = null;

function reapZombieChromeProcesses() {
  if (process.platform === 'win32') return;
  try {
    execSync('pkill -9 -f "/tmp/iwg-gv-daemon-profile" 2>/dev/null || true', { stdio: 'ignore' });
  } catch { }
}

async function cleanExit(signalName, exitCode = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[Sarah Cloud Daemon ${INSTANCE_ID}] ${signalName} received — closing Chrome cleanly...`);
  const browser = activeBrowser;
  activeBrowser = null;
  if (browser) {
    const pid = browser.process()?.pid;
    try {
      await Promise.race([
        browser.close(),
        new Promise((r) => setTimeout(r, 2500)),
      ]);
    } catch { }
    if (pid) {
      try {
        process.kill(pid, 'SIGKILL');
      } catch { }
    }
  }
  reapZombieChromeProcesses();
  process.exit(exitCode);
}

process.on('SIGTERM', () => void cleanExit('SIGTERM', 0));
process.on('SIGINT', () => void cleanExit('SIGINT', 0));
process.on('unhandledRejection', (reason) => {
  console.error(`[Sarah Cloud Daemon ${INSTANCE_ID}] Non-fatal unhandledRejection:`, reason?.message || reason);
});
process.on('uncaughtException', (err) => {
  console.error(`[Sarah Cloud Daemon ${INSTANCE_ID}] Fatal uncaughtException:`, err?.message || err);
  void cleanExit('uncaughtException', 1);
});

async function fetchCloudCookieVault() {
  try {
    const res = await fetchDaemonApi('/api/sarah/gv-session-sync', {
      headers: { 'x-iwg-bridge-token': BRIDGE_TOKEN },
    });
    if (!res || !res.ok) return { cookies: [], updatedAt: null };
    const data = await res.json();
    return {
      cookies: Array.isArray(data?.cookies) ? data.cookies : [],
      updatedAt: data?.updatedAt || null,
    };
  } catch (err) {
    console.error('[Sarah Cloud Daemon] Cookie fetch error:', err?.message);
    return { cookies: [], updatedAt: null };
  }
}

async function saveRefreshedCookies(cookies) {
  try {
    if (!Array.isArray(cookies) || cookies.length === 0) return;
    await fetchDaemonApi('/api/sarah/gv-session-sync', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-iwg-bridge-token': BRIDGE_TOKEN,
      },
      body: JSON.stringify({
        cookies,
        source: `cloud-daemon-${INSTANCE_ID}`,
      }),
    });
  } catch { }
}

async function reportDaemonHeartbeat(extra = {}) {
  try {
    await fetchDaemonApi('/api/sarah/gv-heartbeat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        runner: 'cloud-daemon',
        instanceId: INSTANCE_ID,
        region: REGION,
        extensionBuild: EXTENSION_BUILD,
        ...extra,
      }),
    });
  } catch { }
}

function normalizeCookiesForCdp(rawCookies) {
  const out = [];
  for (const c of rawCookies) {
    if (!c?.name || typeof c.value !== 'string' || !c.domain) continue;
    const name = String(c.name);
    const cleanHost = String(c.domain).replace(/^\.+/, '');
    if (!cleanHost) continue;

    const isHostPrefix = name.startsWith('__Host-');
    const isSecurePrefix = isHostPrefix || name.startsWith('__Secure-');
    const ss = String(c.sameSite || '').toLowerCase();
    let sameSite;
    if (ss === 'no_restriction' || ss === 'none') sameSite = 'None';
    else if (ss === 'lax') sameSite = 'Lax';
    else if (ss === 'strict') sameSite = 'Strict';

    const secure = Boolean(c.secure) || isSecurePrefix || sameSite === 'None';
    const entry = {
      name,
      value: String(c.value),
      path: isHostPrefix ? '/' : String(c.path || '/'),
      secure,
      httpOnly: Boolean(c.httpOnly),
    };

    // RFC 6265bis / Chromium CDP rule: __Host- cookies MUST omit `domain` and specify `url` instead
    if (isHostPrefix) {
      entry.url = `https://${cleanHost}/`;
    } else {
      entry.domain = String(c.domain);
    }

    if (sameSite) entry.sameSite = sameSite;

    const exp =
      typeof c.expirationDate === 'number' && c.expirationDate > 0
        ? c.expirationDate
        : typeof c.expires === 'number' && c.expires > 0
          ? c.expires
          : null;
    if (exp && Number.isFinite(exp)) {
      entry.expires = exp;
    }
    out.push(entry);
  }
  return out;
}

function resolveChromeBinary() {
  const candidates = [
    process.env.PUPPETEER_EXECUTABLE_PATH,
    process.env.CHROME_PATH,
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
  ].filter(Boolean);
  for (const bin of candidates) {
    if (existsSync(bin)) return bin;
  }
  return '/usr/bin/google-chrome';
}

async function waitForLocalApiReady(maxWaitMs = 25000) {
  const deadline = Date.now() + maxWaitMs;
  while (!shuttingDown && Date.now() < deadline) {
    try {
      const res = await fetchDaemonApi('/health');
      if (res && res.ok) return true;
    } catch { }
    await new Promise((r) => setTimeout(r, 800));
  }
  return false;
}

// Ultra-slim Chromium flags tailored for e2-small (2 vCPUs, 2 GB RAM + 2 GB Swap) — cuts GPU/process bloat by ~50%
// while keeping WebRTC Opus 48kHz streams and visibilityState="visible" 100% unthrottled in physical RAM.
async function launchResilientBrowser(execPath) {
  reapZombieChromeProcesses();
  const chromeArgs = [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-dev-shm-usage',
    '--disable-gpu',
    '--disable-gpu-compositing',
    '--disable-software-rasterizer',
    '--disable-extensions',
    '--disable-component-extensions-with-background-pages',
    '--disable-background-networking',
    '--disable-sync',
    '--disable-translate',
    '--disable-default-apps',
    '--mute-audio=false',
    '--no-first-run',
    '--no-default-browser-check',
    '--metrics-recording-only',
    '--safebrowsing-disable-auto-update',
    '--renderer-process-limit=3',
    '--disable-site-isolation-trials',
    '--js-flags=--max-old-space-size=384',
    '--disk-cache-size=33554432',
    '--media-cache-size=16777216',
    '--user-data-dir=/tmp/iwg-gv-daemon-profile',
    '--autoplay-policy=no-user-gesture-required',
    '--use-fake-ui-for-media-stream',
    '--alsa-output-device=pulse',
    '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding',
    '--disable-backgrounding-occluded-windows',
    '--disable-ipc-flooding-protection',
    '--disable-features=IsolateOrigins,site-per-process,Translate,OptimizationHints,MediaRouter,DialMediaRouteProvider,CalculateNativeWinOcclusion,AudioServiceOutOfProcess,BlockInsecurePrivateNetworkRequests,PrivateNetworkAccessSendPreflights,PrivateNetworkAccessRespectPreflightResults',
    '--window-size=800,600',
  ];

  const hasX11Display = Boolean(process.env.DISPLAY) && existsSync('/tmp/.X11-unix');
  if (hasX11Display) {
    try {
      return await puppeteer.launch({
        executablePath: execPath,
        headless: false,
        protocolTimeout: 60000,
        ignoreDefaultArgs: ['--mute-audio', '--enable-automation'],
        args: chromeArgs,
      });
    } catch (xErr) {
      console.log(`[Sarah Cloud Daemon ${INSTANCE_ID}] X11 launch unavailable (${xErr?.message}); falling back to Chrome headless=new...`);
    }
  }

  return await puppeteer.launch({
    executablePath: execPath,
    headless: 'new',
    protocolTimeout: 60000,
    ignoreDefaultArgs: ['--mute-audio', '--enable-automation'],
    args: chromeArgs,
  });
}

async function runBrowserSession(cookies) {
  const execPath = resolveChromeBinary();
  console.log(`[Sarah Cloud Daemon ${INSTANCE_ID}] Launching ultra-slim Chromium with ${cookies.length} Google Voice cookies...`);

  const browser = await launchResilientBrowser(execPath);
  activeBrowser = browser;
  const sessionStartedAt = Date.now();

  try {
    const pages = await browser.pages();
    const page = pages[0] || (await browser.newPage());
    await page.setViewport({ width: 800, height: 600 });

    // Zero-latency (<1ms) local Node IPC bridge from Chrome -> http://127.0.0.1:4000
    // Eliminates Hairpin NAT TLS overhead, CORS, Mixed Content blocks, and IPv6 localhost delays!
    await page.exposeFunction('__iwgDaemonBridgeCall', async (endpoint, payload) => {
      const res = await fetchDaemonApi(String(endpoint || ''), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-iwg-bridge-token': BRIDGE_TOKEN,
        },
        body: JSON.stringify(payload || {}),
      });
      if (!res || !res.ok) return null;
      return await res.json();
    });

    const client = await page.createCDPSession();
    await client.send('Browser.grantPermissions', {
      origin: 'https://voice.google.com',
      permissions: ['audioCapture', 'notifications'],
    });

    const cdpCookies = normalizeCookiesForCdp(cookies);
    if (cdpCookies.length > 0) {
      let applied = 0;
      try {
        await client.send('Network.setCookies', { cookies: cdpCookies });
        applied = cdpCookies.length;
      } catch {
        for (const ck of cdpCookies) {
          try {
            await client.send('Network.setCookie', ck);
            applied++;
          } catch { }
        }
      }
      console.log(`[Sarah Cloud Daemon ${INSTANCE_ID}] Injected ${applied}/${cdpCookies.length} Google Voice cookies into Chrome session.`);
    }

    const visibilityShim = `
      try {
        Object.defineProperty(document, 'visibilityState', { get: () => 'visible', configurable: true });
        Object.defineProperty(document, 'hidden', { get: () => false, configurable: true });
      } catch {}
    `;
    const configBootstrap = `window.__IWG_CLOUD_DAEMON_CONFIG__ = ${JSON.stringify({
      runner: 'cloud-daemon',
      instanceId: INSTANCE_ID,
      region: REGION,
      apiBase: PUBLIC_API_BASE,
    })};`;

    // Inject BOTH Zero-Echo WebRTC Bridge AND Auto-Answer Controller on every document navigation/redirect!
    await page.evaluateOnNewDocument(
      `${visibilityShim}\n${configBootstrap}\n${webrtcBridgeCode}\n;if (location.hostname === 'voice.google.com') {\n${contentControllerCode}\n}`
    );

    await page.goto('https://voice.google.com/u/0/calls', {
      waitUntil: 'domcontentloaded',
      timeout: 45000,
    });
    console.log(`[Sarah Cloud Daemon ${INSTANCE_ID}] Loaded Google Voice page: ${page.url()}`);

    await new Promise((r) => setTimeout(r, 2500));

    // Click page once so Chromium unlocks WebAudio AudioContext at 48kHz immediately
    try {
      await page.mouse.click(80, 80);
    } catch { }

    // Ensure controller is running even if document_start fired prior to redirect finish
    await page
      .evaluate(`${configBootstrap}\nif (!window.__IWG_GV_RECEPTIONIST_ACTIVE__ && location.hostname === 'voice.google.com') {\n${contentControllerCode}\n}`)
      .catch(() => { });

    let lastRefreshSave = Date.now();
    while (!shuttingDown && browser.connected && !page.isClosed()) {
      const currentUrl = page.url();
      const title = await page.title().catch(() => '');
      const isSignedOut =
        currentUrl.includes('accounts.google.com/v3/signin') ||
        currentUrl.includes('accounts.google.com/ServiceLogin') ||
        (currentUrl.includes('accounts.google.com') && /sign in/i.test(title));
      if (isSignedOut) {
        console.warn(`[Sarah Cloud Daemon ${INSTANCE_ID}] Session redirected to sign-in (${currentUrl}); signaling cookie refresh...`);
        await reportDaemonHeartbeat({
          url: currentUrl,
          title,
          sessionAuthenticated: false,
          receivingCallsText: 'Awaiting Refreshed Google Voice Cookies',
        });
        return { reason: 'signed_out' };
      }

      // Periodically persist rotated Google cookies (__Secure-1PSIDTS / SIDTS) back to AES-256 Cloud Vault every 4 mins
      if (Date.now() - lastRefreshSave > 4 * 60 * 1000) {
        lastRefreshSave = Date.now();
        try {
          const all = await client.send('Network.getAllCookies');
          if (Array.isArray(all?.cookies) && all.cookies.length > 0) {
            await saveRefreshedCookies(all.cookies);
          }
        } catch { }
      }

      // Proactive idle memory hygiene: cleanly recycle Chromium after 6h ONLY when no call is active
      if (Date.now() - sessionStartedAt > MAX_IDLE_SESSION_AGE_MS) {
        const stateSnap = await page.evaluate(() => window.__IWG_GV_GET_STATE__?.() || null).catch(() => null);
        if (!stateSnap?.callActive && !stateSnap?.isSpeaking) {
          console.log(`[Sarah Cloud Daemon ${INSTANCE_ID}] Performing scheduled 6h idle Chromium memory recycle...`);
          return { reason: 'idle_recycle' };
        }
      }

      await new Promise((r) => setTimeout(r, 8000));
    }
    return { reason: 'browser_disconnected' };
  } finally {
    const pid = browser.process()?.pid;
    try {
      await Promise.race([
        browser.close(),
        new Promise((r) => setTimeout(r, 3000)),
      ]);
    } catch { }
    if (pid) {
      try {
        process.kill(pid, 'SIGKILL');
      } catch { }
    }
    reapZombieChromeProcesses();
    if (activeBrowser === browser) activeBrowser = null;
  }
}

async function main() {
  console.log(`[Sarah Cloud Daemon ${INSTANCE_ID}] Starting 24/7 Cloud Receptionist for +14803319455 -> ${LOCAL_API_BASE}`);
  await waitForLocalApiReady(25000);

  let lastFailedCookieStamp = null;
  let consecutiveSignOuts = 0;

  while (!shuttingDown) {
    const { cookies, updatedAt } = await fetchCloudCookieVault();
    if (!cookies || cookies.length === 0) {
      await reportDaemonHeartbeat({
        url: 'https://voice.google.com/u/0/calls',
        title: 'Waiting for initial cookie vault sync',
        sessionAuthenticated: false,
        receivingCallsText: 'Awaiting Initial Session Sync',
      });
      await new Promise((r) => setTimeout(r, 6000));
      continue;
    }

    // Prevent infinite 15s Chromium crash-loops on stale/revoked cookies:
    // After 2 consecutive sign-outs with the exact same vault timestamp, sleep Chrome (freeing 350MB RAM)
    // and poll quietly until the extension pushes a newer cookie vault timestamp!
    if (consecutiveSignOuts >= 2 && updatedAt && updatedAt === lastFailedCookieStamp) {
      await reportDaemonHeartbeat({
        url: 'https://accounts.google.com',
        title: 'Awaiting fresh Google Voice cookie sync from extension',
        sessionAuthenticated: false,
        receivingCallsText: 'Paused Chromium — Waiting for Fresh Cookie Sync',
      });
      await new Promise((r) => setTimeout(r, 8000));
      continue;
    }

    try {
      const outcome = await runBrowserSession(cookies);
      if (outcome?.reason === 'signed_out') {
        consecutiveSignOuts += 1;
        lastFailedCookieStamp = updatedAt || 'unknown';
      } else {
        consecutiveSignOuts = 0;
      }
    } catch (err) {
      const msg = err?.message || String(err);
      console.log(`[Sarah Cloud Daemon ${INSTANCE_ID}] Browser loop error: ${msg}`);
      await reportDaemonHeartbeat({
        url: 'https://voice.google.com/u/0/calls',
        title: `Session restart: ${msg.slice(0, 120)}`,
        sessionAuthenticated: false,
        receivingCallsText: `Recovering (${msg.slice(0, 80)})`,
      });
    }

    if (!shuttingDown) {
      await new Promise((r) => setTimeout(r, 6000));
    }
  }
}

void main();
