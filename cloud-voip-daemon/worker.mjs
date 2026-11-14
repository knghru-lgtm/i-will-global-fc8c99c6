import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import puppeteer from 'puppeteer-core';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const CHROME_PROFILE_DIR =
  process.env.CHROME_USER_DATA_DIR || path.resolve(REPO_ROOT, 'server/data/chrome-gv-profile');

const LOCAL_API_BASE = process.env.LOCAL_API_URL || 'http://127.0.0.1:4000';
const PUBLIC_API_BASE = process.env.APP_URL || 'https://voice.iwillglobal.com';
const API_BASES = Array.from(new Set([LOCAL_API_BASE, PUBLIC_API_BASE]));
const BRIDGE_TOKEN = process.env.GV_BRIDGE_TOKEN || 'iwg-sarah-cloud-bridge-v10-9455';
const REGION = process.env.GOOGLE_CLOUD_REGION || 'us-west1';
const INSTANCE_ID = `gcloud-${REGION}-${randomUUID().slice(0, 8)}`;
const EXTENSION_BUILD = '2026-11-14-v13';
const MAX_IDLE_SESSION_AGE_MS = 6 * 60 * 60 * 1000;

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
    execSync(`pkill -9 -f "${CHROME_PROFILE_DIR}" 2>/dev/null || true`, { stdio: 'ignore' });
    execSync('pkill -9 -f "/tmp/iwg-gv-daemon-profile" 2>/dev/null || true', { stdio: 'ignore' });
  } catch { }
  for (const lockName of ['SingletonLock', 'SingletonCookie', 'SingletonSocket']) {
    try {
      rmSync(path.join(CHROME_PROFILE_DIR, lockName), { force: true });
    } catch { }
  }
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
    if (!res || !res.ok) return { cookies: [], updatedAt: null, userAgent: null };
    const data = await res.json();
    return {
      cookies: Array.isArray(data?.cookies) ? data.cookies : [],
      updatedAt: data?.updatedAt || null,
      userAgent: data?.userAgent || null,
    };
  } catch (err) {
    console.error('[Sarah Cloud Daemon] Cookie fetch error:', err?.message);
    return { cookies: [], updatedAt: null, userAgent: null };
  }
}

async function saveRefreshedCookies(cookies, userAgent = '') {
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
        userAgent,
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
    const rawDomain = String(c.domain);
    const cleanHost = rawDomain.replace(/^\.+/, '');
    if (!cleanHost) continue;

    const isHostPrefix = name.startsWith('__Host-');
    const isSecurePrefix = isHostPrefix || name.startsWith('__Secure-');
    const isHostOnly = isHostPrefix || c.hostOnly === true || !rawDomain.startsWith('.');

    const ss = String(c.sameSite || '').toLowerCase();
    let sameSite;
    if (ss === 'no_restriction' || ss === 'none') sameSite = 'None';
    else if (ss === 'lax') sameSite = 'Lax';
    else if (ss === 'strict') sameSite = 'Strict';

    const secure = Boolean(c.secure) || isSecurePrefix || sameSite === 'None';
    const cookiePath = isHostPrefix ? '/' : String(c.path || '/');
    const entry = {
      name,
      value: String(c.value),
      path: cookiePath,
      secure,
      httpOnly: Boolean(c.httpOnly),
    };

    // CRITICAL RFC 6265 / Chromium CDP rule:
    // Host-only cookies (such as LSID, __Secure-1PLSID, ACCOUNT_CHOOSER on accounts.google.com,
    // and __Host-* cookies) MUST omit `domain` and specify `url` so CDP does NOT convert them
    // into `.accounts.google.com` domain cookies!
    if (isHostOnly) {
      entry.url = `${secure ? 'https' : 'http'}://${cleanHost}${cookiePath.startsWith('/') ? cookiePath : '/' + cookiePath}`;
    } else {
      entry.domain = rawDomain;
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

async function launchResilientBrowser(execPath) {
  mkdirSync(CHROME_PROFILE_DIR, { recursive: true });
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
    '--disable-blink-features=AutomationControlled',
    '--password-store=basic',
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
    `--user-data-dir=${CHROME_PROFILE_DIR}`,
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

function isGoogleVoiceAuthenticatedUrl(urlStr, titleStr = '') {
  if (!urlStr) return false;
  if (!urlStr.startsWith('https://voice.google.com')) return false;
  if (urlStr.includes('/about') || urlStr.includes('/signup')) return false;
  if (/sign\s*in/i.test(titleStr)) return false;
  return true;
}

async function resolveAccountChooserIfNeeded(page) {
  for (let step = 0; step < 3; step++) {
    const curUrl = page.url();
    if (!curUrl.includes('accounts.google.com')) return true;

    // Wait briefly for passive CheckCookie redirects or account list animation
    await new Promise((r) => setTimeout(r, 2200));
    if (!page.url().includes('accounts.google.com')) return true;

    if (page.url().includes('accountchooser')) {
      const chooserInfo = await page
        .evaluate(() => {
          const items = Array.from(
            document.querySelectorAll('[data-identifier], [data-email], li div[role="link"]')
          );
          const summary = items.map((el) => {
            const id =
              el.getAttribute('data-identifier') ||
              el.getAttribute('data-email') ||
              (el.textContent || '').trim().slice(0, 80);
            const fullText = (el.closest('li')?.innerText || el.innerText || '').replace(/\s+/g, ' ').trim();
            const signedOut = /signed\s*out|session\s*expired/i.test(fullText);
            return { id, signedOut, fullText: fullText.slice(0, 120) };
          });
          // Click first account tile that is NOT marked "Signed out"
          const activeIdx = summary.findIndex((s) => !s.signedOut);
          if (activeIdx >= 0 && items[activeIdx]) {
            items[activeIdx].click();
            return { clicked: true, summary };
          }
          return { clicked: false, summary };
        })
        .catch(() => ({ clicked: false, summary: [] }));

      console.log(
        `[Sarah Cloud Daemon ${INSTANCE_ID}] AccountChooser inspection: ${JSON.stringify(chooserInfo)}`
      );

      if (chooserInfo.clicked) {
        await page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => { });
        await new Promise((r) => setTimeout(r, 2500));
        if (!page.url().includes('accounts.google.com')) return true;
      } else {
        // Every listed account says "Signed out" (missing non-Secure SID/HSID cookie or Windows DBSC TPM-bound session)
        return false;
      }
    }
  }
  return !page.url().includes('accounts.google.com');
}

async function runBrowserSession(cookies, syncedUserAgent = null) {
  const execPath = resolveChromeBinary();
  const keyNames = new Set(cookies.map((c) => String(c?.name || '')));
  const presentKeys = ['SID', 'HSID', 'SSID', 'SAPISID', 'LSID', '__Secure-1PSID', '__Secure-1PSIDTS'].filter((k) =>
    keyNames.has(k)
  );
  console.log(
    `[Sarah Cloud Daemon ${INSTANCE_ID}] Launching ultra-slim Chromium with ${cookies.length} cookies (keys: ${presentKeys.join(',') || 'none'})...`
  );

  const browser = await launchResilientBrowser(execPath);
  activeBrowser = browser;
  const sessionStartedAt = Date.now();

  try {
    const pages = await browser.pages();
    const page = pages[0] || (await browser.newPage());
    await page.setViewport({ width: 800, height: 600 });

    const client = await page.createCDPSession();
    await client.send('Browser.grantPermissions', {
      origin: 'https://voice.google.com',
      permissions: ['audioCapture', 'notifications'],
    });

    // Check if persistent VM Chrome profile ALREADY has a valid native Linux Google Voice session
    const nativeVmAuthMarker = path.join(CHROME_PROFILE_DIR, '.native-vm-auth');
    const hasNativeVmAuthMarker = existsSync(nativeVmAuthMarker);
    const existingProfileCookies = await client.send('Network.getAllCookies').catch(() => ({ cookies: [] }));
    const profileHasNativeGvAuth =
      hasNativeVmAuthMarker ||
      (Array.isArray(existingProfileCookies?.cookies) &&
        existingProfileCookies.cookies.some((c) => c.domain?.includes('voice.google.com')) &&
        existingProfileCookies.cookies.some((c) => c.name === 'SID' || c.name === '__Secure-1PSID'));

    // Strip HeadlessChrome marker; if using native Linux VM profile, keep Linux UA instead of synced Windows UA
    const defaultUa = (await browser.userAgent()).replace(/HeadlessChrome\//gi, 'Chrome/');
    const effectiveUa =
      !profileHasNativeGvAuth && syncedUserAgent && !/HeadlessChrome/i.test(syncedUserAgent)
        ? syncedUserAgent
        : defaultUa;
    await page.setUserAgent(effectiveUa);

    // Zero-latency (<1ms) local Node IPC bridge from Chrome -> http://127.0.0.1:4000
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

    const cdpCookies = normalizeCookiesForCdp(cookies);
    if (cdpCookies.length > 0 && !profileHasNativeGvAuth) {
      let applied = 0;
      for (const ck of cdpCookies) {
        try {
          await client.send('Network.setCookie', ck);
          applied++;
        } catch { }
      }
      console.log(`[Sarah Cloud Daemon ${INSTANCE_ID}] Injected ${applied}/${cdpCookies.length} Google Voice cookies (hostOnly-preserved).`);
    } else if (profileHasNativeGvAuth) {
      console.log(`[Sarah Cloud Daemon ${INSTANCE_ID}] Using persistent VM Chrome profile session (${existingProfileCookies?.cookies?.length || 0} profile cookies).`);
    }

    const stealthAndVisibilityShim = `
      try {
        Object.defineProperty(navigator, 'webdriver', { get: () => false, configurable: true });
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

    // Inject BOTH Zero-Echo WebRTC Bridge AND TrustedHTML-safe Auto-Answer Controller on every navigation!
    await page.evaluateOnNewDocument(
      `${stealthAndVisibilityShim}\n${configBootstrap}\n${webrtcBridgeCode}\n;if (location.hostname === 'voice.google.com') {\n${contentControllerCode}\n}`
    );

    await page.goto('https://voice.google.com/u/0/calls', {
      waitUntil: 'domcontentloaded',
      timeout: 45000,
    });
    console.log(`[Sarah Cloud Daemon ${INSTANCE_ID}] Initial navigation URL: ${page.url()}`);

    if (page.url().includes('accounts.google.com')) {
      const resolved = await resolveAccountChooserIfNeeded(page);
      if (!resolved && profileHasNativeGvAuth && !hasNativeVmAuthMarker && cdpCookies.length > 0) {
        // Persistent profile expired — fall back to fresh vault cookies once
        for (const ck of cdpCookies) {
          try {
            await client.send('Network.setCookie', ck);
          } catch { }
        }
        await page.goto('https://voice.google.com/u/0/calls', {
          waitUntil: 'domcontentloaded',
          timeout: 45000,
        }).catch(() => { });
        await resolveAccountChooserIfNeeded(page);
      }
    }

    await new Promise((r) => setTimeout(r, 2500));

    // Unlock WebAudio 48kHz AudioContext immediately
    try {
      await page.mouse.click(80, 80);
    } catch { }

    if (isGoogleVoiceAuthenticatedUrl(page.url(), await page.title().catch(() => ''))) {
      await page
        .evaluate(
          `${configBootstrap}\nif (!window.__IWG_GV_RECEPTIONIST_ACTIVE__ && location.hostname === 'voice.google.com') {\n${contentControllerCode}\n}`
        )
        .catch(() => { });

      const readyTitle = await page.title().catch(() => 'Google Voice');
      console.log(`[Sarah Cloud Daemon ${INSTANCE_ID}] AUTHENTICATED & LIVE on ${page.url()} (${readyTitle})`);
      try {
        const all = await client.send('Network.getAllCookies');
        if (Array.isArray(all?.cookies) && all.cookies.length > 0) {
          await saveRefreshedCookies(all.cookies, effectiveUa);
        }
      } catch { }
      await reportDaemonHeartbeat({
        url: page.url(),
        title: readyTitle,
        visibilityState: 'visible',
        sessionAuthenticated: true,
        hasPreloadedGreeting: true,
        receivingCallsText: 'Zero-Echo Pure Digital WebRTC Isolation ACTIVE',
      });
    }

    let lastRefreshSave = Date.now();
    while (!shuttingDown && browser.connected && !page.isClosed()) {
      const currentUrl = page.url();
      const title = await page.title().catch(() => '');
      const isSignedOut =
        currentUrl.includes('accounts.google.com') ||
        currentUrl.includes('voice.google.com/about') ||
        /sign\s*in/i.test(title);

      if (isSignedOut) {
        console.warn(
          `[Sarah Cloud Daemon ${INSTANCE_ID}] Session unauthenticated at ${currentUrl} — reload Chrome extension (v3.3.0) or run ./scripts/vm-gv-direct-login.sh once on VM.`
        );
        await reportDaemonHeartbeat({
          url: currentUrl,
          title,
          sessionAuthenticated: false,
          receivingCallsText: 'Awaiting Fresh Google Voice Session (Reload Extension v3.3.0 or Run vm-gv-direct-login.sh)',
        });
        return { reason: 'signed_out' };
      }

      // Persist rotated Google cookies back to AES-256 Cloud Vault every 4 mins
      if (Date.now() - lastRefreshSave > 4 * 60 * 1000) {
        lastRefreshSave = Date.now();
        try {
          const all = await client.send('Network.getAllCookies');
          if (Array.isArray(all?.cookies) && all.cookies.length > 0) {
            await saveRefreshedCookies(all.cookies, effectiveUa);
          }
        } catch { }
      }

      // Proactive 6h idle memory hygiene when no call is active
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
    const { cookies, updatedAt, userAgent } = await fetchCloudCookieVault();
    const hasPersistentProfile = existsSync(path.join(CHROME_PROFILE_DIR, 'Default'));

    if ((!cookies || cookies.length === 0) && !hasPersistentProfile) {
      await reportDaemonHeartbeat({
        url: 'https://voice.google.com/u/0/calls',
        title: 'Waiting for initial cookie vault sync',
        sessionAuthenticated: false,
        receivingCallsText: 'Awaiting Initial Session Sync',
      });
      await new Promise((r) => setTimeout(r, 6000));
      continue;
    }

    if (consecutiveSignOuts >= 2 && updatedAt && updatedAt === lastFailedCookieStamp) {
      await reportDaemonHeartbeat({
        url: 'https://accounts.google.com',
        title: 'Awaiting fresh Google Voice cookie sync (v3.3.0) or one-time VM login',
        sessionAuthenticated: false,
        receivingCallsText: 'Paused Chromium — Reload Extension v3.3.0 or Run vm-gv-direct-login.sh',
      });
      await new Promise((r) => setTimeout(r, 8000));
      continue;
    }

    try {
      const outcome = await runBrowserSession(cookies || [], userAgent);
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
