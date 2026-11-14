import { existsSync, readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import puppeteer from 'puppeteer-core';

const PUBLIC_API_BASE = process.env.APP_URL || 'https://voice.iwillglobal.com';
const API_BASES = Array.from(
  new Set([
    process.env.LOCAL_API_URL || 'http://127.0.0.1:4000',
    PUBLIC_API_BASE,
  ])
);
const BRIDGE_TOKEN = process.env.GV_BRIDGE_TOKEN || 'iwg-sarah-cloud-bridge-v10-9455';
const REGION = process.env.GOOGLE_CLOUD_REGION || 'us-west1';
const INSTANCE_ID = `gcloud-${REGION}-${randomUUID().slice(0, 8)}`;

async function fetchDaemonApi(pathname, init = {}) {
  let lastErr = null;
  for (const base of API_BASES) {
    try {
      const res = await fetch(`${base}${pathname}`, init);
      if (res.ok) return res;
    } catch (err) {
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

process.on('SIGTERM', async () => {
  console.log(`[Sarah Cloud Daemon ${INSTANCE_ID}] SIGTERM received — shutting down cleanly...`);
  shuttingDown = true;
  if (activeBrowser) {
    try {
      await activeBrowser.close();
    } catch { }
  }
  process.exit(0);
});

async function fetchCloudCookies() {
  try {
    const res = await fetchDaemonApi('/api/sarah/gv-session-sync', {
      headers: { 'x-iwg-bridge-token': BRIDGE_TOKEN },
    });
    if (!res || !res.ok) return [];
    const data = await res.json();
    return Array.isArray(data?.cookies) ? data.cookies : [];
  } catch (err) {
    console.error('[Sarah Cloud Daemon] Cookie fetch error:', err?.message);
    return [];
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
        extensionBuild: '2026-11-10-v12',
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

async function waitForLocalApiReady(maxWaitMs = 20000) {
  const deadline = Date.now() + maxWaitMs;
  while (!shuttingDown && Date.now() < deadline) {
    try {
      const res = await fetchDaemonApi('/health');
      if (res && res.ok) return true;
    } catch { }
    await new Promise((r) => setTimeout(r, 1000));
  }
  return false;
}

async function launchResilientBrowser(execPath) {
  const chromeArgs = [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-dev-shm-usage',
    '--disable-gpu',
    '--disable-software-rasterizer',
    '--disable-extensions',
    '--user-data-dir=/tmp/iwg-gv-daemon-profile',
    '--autoplay-policy=no-user-gesture-required',
    '--use-fake-ui-for-media-stream',
    '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding',
    '--disable-backgrounding-occluded-windows',
    '--disable-features=BlockInsecurePrivateNetworkRequests,PrivateNetworkAccessSendPreflights,PrivateNetworkAccessRespectPreflightResults',
    '--window-size=1280,800',
  ];

  const hasX11Display = Boolean(process.env.DISPLAY) && existsSync('/tmp/.X11-unix');
  if (hasX11Display) {
    try {
      return await puppeteer.launch({
        executablePath: execPath,
        headless: false,
        ignoreDefaultArgs: ['--mute-audio'],
        args: chromeArgs,
      });
    } catch (xErr) {
      console.log(`[Sarah Cloud Daemon ${INSTANCE_ID}] X11 launch unavailable (${xErr?.message}); falling back to Chrome headless=new...`);
    }
  }

  return await puppeteer.launch({
    executablePath: execPath,
    headless: 'new',
    ignoreDefaultArgs: ['--mute-audio'],
    args: chromeArgs,
  });
}

async function runBrowserSession(cookies) {
  const execPath = resolveChromeBinary();
  console.log(`[Sarah Cloud Daemon ${INSTANCE_ID}] Launching Chromium with ${cookies.length} Google Voice cookies...`);

  const browser = await launchResilientBrowser(execPath);
  activeBrowser = browser;

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 800 });

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
      apiBase: 'https://voice.iwillglobal.com',
    })};`;

    // Inject Zero-Echo WebRTC Bridge BEFORE any page scripts run
    await page.evaluateOnNewDocument(`${visibilityShim}\n${configBootstrap}\n${webrtcBridgeCode}`);

    await page.goto('https://voice.google.com/u/0/calls', {
      waitUntil: 'domcontentloaded',
      timeout: 45000,
    });
    console.log(`[Sarah Cloud Daemon ${INSTANCE_ID}] Loaded Google Voice page: ${page.url()}`);

    await new Promise((r) => setTimeout(r, 3500));

    // Click page once so Chromium unlocks WebAudio AudioContext at 48kHz immediately
    try {
      await page.mouse.click(80, 80);
    } catch { }

    // Inject Cloud Auto-Answer & Conversational Controller
    await page.evaluate(`${configBootstrap}\n${contentControllerCode}`);

    let lastRefreshSave = Date.now();
    while (!shuttingDown && browser.connected && !page.isClosed()) {
      const currentUrl = page.url();
      const title = await page.title().catch(() => '');
      const isSignedOut = currentUrl.includes('accounts.google.com') || /sign in/i.test(title);
      if (isSignedOut) {
        console.warn(`[Sarah Cloud Daemon ${INSTANCE_ID}] Session redirected to sign-in (${currentUrl}); waiting for refreshed cookies...`);
        await reportDaemonHeartbeat({
          url: currentUrl,
          title,
          sessionAuthenticated: false,
          receivingCallsText: 'Awaiting Google Voice Session Sync',
        });
        break;
      }

      // Periodically persist rotated Google cookies (__Secure-1PSIDTS) back to encrypted Cloud Postgres vault
      if (Date.now() - lastRefreshSave > 5 * 60 * 1000) {
        lastRefreshSave = Date.now();
        try {
          const all = await client.send('Network.getAllCookies');
          if (Array.isArray(all?.cookies) && all.cookies.length > 0) {
            await saveRefreshedCookies(all.cookies);
          }
        } catch { }
      }

      await new Promise((r) => setTimeout(r, 8000));
    }
  } finally {
    try {
      await browser.close();
    } catch { }
    if (activeBrowser === browser) activeBrowser = null;
  }
}

async function main() {
  console.log(`[Sarah Cloud Daemon ${INSTANCE_ID}] Starting 24/7 Cloud Receptionist for +14803319455 -> ${PUBLIC_API_BASE}`);
  await waitForLocalApiReady(20000);
  while (!shuttingDown) {
    const cookies = await fetchCloudCookies();
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

    try {
      await runBrowserSession(cookies);
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
      await new Promise((r) => setTimeout(r, 10000));
    }
  }
}

void main();

