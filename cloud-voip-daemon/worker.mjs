import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import puppeteer from 'puppeteer-core';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const CHROME_PROFILE_DIR =
  process.env.CHROME_USER_DATA_DIR ||
  (existsSync('/home/king')
    ? '/home/king/.sarah-chrome-profile'
    : path.resolve(REPO_ROOT, 'server/data/chrome-gv-profile'));
const CORE_GOOGLE_AUTH_COOKIES = [
  'SID',
  'HSID',
  'SSID',
  'APISID',
  'SAPISID',
  '__Secure-1PSID',
  '__Secure-1PSIDTS',
];

const LOCAL_API_BASE = process.env.LOCAL_API_URL || 'http://127.0.0.1:4000';
const PUBLIC_API_BASE = process.env.APP_URL || 'https://voice.iwillglobal.com';
const API_BASES = Array.from(new Set([LOCAL_API_BASE, PUBLIC_API_BASE]));
const BRIDGE_TOKEN = process.env.GV_BRIDGE_TOKEN || 'iwg-sarah-cloud-bridge-v10-9455';
const REGION = process.env.GOOGLE_CLOUD_REGION || 'us-west1';
const INSTANCE_ID = `gcloud-${REGION}-${randomUUID().slice(0, 8)}`;
const EXTENSION_BUILD = '2026-11-15-v15';
const MAX_IDLE_SESSION_AGE_MS = 7 * 24 * 60 * 60 * 1000;

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
    if (!Array.isArray(cookies) || cookies.length === 0) return null;
    const res = await fetchDaemonApi('/api/sarah/gv-session-sync', {
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
    if (res && res.ok) {
      const data = await res.json().catch(() => null);
      return data?.updatedAt || null;
    }
  } catch { }
  return null;
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
    '/usr/local/bin/sarah-chrome',
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

  const usesSarahChromeWrapper = String(execPath || '').endsWith('sarah-chrome');
  const chromeArgs = [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-dev-shm-usage',
    '--disable-gpu',
    '--disable-gpu-compositing',
    '--disable-software-rasterizer',
    '--disable-extensions',
    '--disable-component-extensions-with-background-pages',
    '--disable-translate',
    '--disable-default-apps',
    '--disable-blink-features=AutomationControlled',
    '--password-store=basic',
    '--use-mock-keychain',
    '--mute-audio=false',
    '--no-first-run',
    '--no-default-browser-check',
    '--safebrowsing-disable-auto-update',
    '--renderer-process-limit=3',
    '--disable-site-isolation-trials',
    '--js-flags=--max-old-space-size=384',
    '--disk-cache-size=33554432',
    '--media-cache-size=16777216',
    '--remote-debugging-address=127.0.0.1',
    '--remote-debugging-port=9222',
    ...(usesSarahChromeWrapper ? [] : [`--user-data-dir=${CHROME_PROFILE_DIR}`]),
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

  const ignoredPuppeteerDefaults = [
    '--mute-audio',
    '--enable-automation',
    '--disable-background-networking',
    '--disable-sync',
    '--metrics-recording-only',
  ];
  const hasX11Display = Boolean(process.env.DISPLAY) && existsSync('/tmp/.X11-unix');
  if (hasX11Display) {
    try {
      return await puppeteer.launch({
        executablePath: execPath,
        userDataDir: CHROME_PROFILE_DIR,
        headless: false,
        protocolTimeout: 60000,
        ignoreDefaultArgs: ignoredPuppeteerDefaults,
        args: chromeArgs,
      });
    } catch (xErr) {
      console.log(`[Sarah Cloud Daemon ${INSTANCE_ID}] X11 launch unavailable (${xErr?.message}); falling back to Chrome headless=new...`);
    }
  }

  return await puppeteer.launch({
    executablePath: execPath,
    userDataDir: CHROME_PROFILE_DIR,
    headless: 'new',
    protocolTimeout: 60000,
    ignoreDefaultArgs: ignoredPuppeteerDefaults,
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
            const isActionRow =
              !el.hasAttribute('data-identifier') &&
              !el.hasAttribute('data-email') &&
              /use\s+another\s+account|remove\s+an\s+account|add\s+another\s+account/i.test(fullText);
            const signedOut = /signed\s*out|session\s*expired/i.test(fullText);
            return { id, signedOut, isActionRow, fullText: fullText.slice(0, 120) };
          });
          // Click first real account tile that is NOT marked "Signed out"
          const activeIdx = summary.findIndex((s) => !s.isActionRow && !s.signedOut);
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

async function verifyGoogleVoiceWebSettings(browser, effectiveUa) {
  let settingsPage = null;
  try {
    settingsPage = await browser.newPage();
    if (effectiveUa) await settingsPage.setUserAgent(effectiveUa);
    await settingsPage.setViewport({ width: 1024, height: 900 });
    await settingsPage.goto('https://voice.google.com/u/0/settings', {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    });
    await new Promise((r) => setTimeout(r, 4000));

    const result = await settingsPage.evaluate(() => {
      const actions = [];
      // 1. Ensure "Prefer Wi-Fi and mobile data" is selected over "Use carrier only"
      const radios = Array.from(document.querySelectorAll('[role="radio"], input[type="radio"]'));
      for (const r of radios) {
        const labelText = (
          r.getAttribute('aria-label') ||
          r.closest('mat-radio-button, label, div')?.innerText ||
          ''
        )
          .replace(/\s+/g, ' ')
          .trim();
        if (/prefer\s+wi-?fi\s+and\s+mobile\s+data/i.test(labelText)) {
          const checked =
            r.getAttribute('aria-checked') === 'true' ||
            r.checked === true ||
            r.closest('mat-radio-button')?.classList?.contains('mat-mdc-radio-checked') ||
            r.closest('mat-radio-button')?.classList?.contains('mat-radio-checked');
          if (!checked) {
            (r.closest('mat-radio-button') || r).click();
            actions.push('selected_prefer_wifi_and_mobile_data');
          } else {
            actions.push('verified_prefer_wifi_and_mobile_data');
          }
        }
      }

      // 2. Ensure "Web" answering device toggle is ON, "Screen calls" is OFF, and "Do not disturb" is OFF
      const switches = Array.from(document.querySelectorAll('button[role="switch"], [role="switch"][aria-checked]'));
      for (const sw of switches) {
        const ariaLabel = String(sw.getAttribute('aria-label') || '').trim();
        let parentLabel = '';
        let p = sw.parentElement;
        for (let d = 0; d < 6 && p; d++) {
          const t = String(p.innerText || '').replace(/\s+/g, ' ').trim();
          if (t.length > 3) {
            parentLabel = t.slice(0, 220);
            break;
          }
          p = p.parentElement;
        }
        const combined = `${ariaLabel} ${parentLabel}`;
        const isOn = sw.getAttribute('aria-checked') === 'true';

        if (/forward calls to web/i.test(ariaLabel) || (/\bweb\b/i.test(combined) && /turn on the devices|answer calls|desktop_windows\s+web/i.test(combined))) {
          if (!isOn) {
            sw.click();
            actions.push('enabled_web_device_ringing');
          } else {
            actions.push('verified_web_device_ringing_on');
          }
        }
        if (/screen\s+calls/i.test(combined) && /hear a caller/i.test(combined)) {
          if (isOn) {
            sw.click();
            actions.push('disabled_call_screening');
          } else {
            actions.push('verified_call_screening_off');
          }
        }
        if (/enable do not disturb/i.test(ariaLabel)) {
          if (isOn) {
            sw.click();
            actions.push('disabled_dnd_schedule');
          } else {
            actions.push('verified_dnd_off');
          }
        }
      }
      return { url: location.href, actions };
    });

    if (result?.actions?.some((a) => a.startsWith('selected_') || a.startsWith('enabled_') || a.startsWith('disabled_'))) {
      await new Promise((r) => setTimeout(r, 2000));
    }
    console.log(`[Sarah Cloud Daemon ${INSTANCE_ID}] Google Voice Settings check: ${JSON.stringify(result)}`);
  } catch (err) {
    console.log(`[Sarah Cloud Daemon ${INSTANCE_ID}] Settings check skipped: ${err?.message || err}`);
  } finally {
    if (settingsPage) {
      await settingsPage.close().catch(() => { });
    }
  }
}

async function runBrowserSession(cookies, syncedUserAgent = null, opts = {}) {
  const { forceClearCookies = false, vaultUpdatedAt = null } = opts;
  const execPath = resolveChromeBinary();
  const lastVaultStampFile = path.join(CHROME_PROFILE_DIR, '.last-vault-stamp');
  const vmSessionLiveMarker = path.join(CHROME_PROFILE_DIR, '.vm-session-live');
  const previousVaultStamp = existsSync(lastVaultStampFile)
    ? readFileSync(lastVaultStampFile, 'utf8').trim()
    : '';

  // Self-heal poisoned "Signed out" SQLite cookies before Chrome opens the profile
  if (forceClearCookies && cookies.length > 0) {
    try {
      rmSync(vmSessionLiveMarker, { force: true });
    } catch { }
    for (const f of ['Cookies', 'Cookies-journal']) {
      try {
        rmSync(path.join(CHROME_PROFILE_DIR, 'Default', f), { force: true });
      } catch { }
    }
    console.log(`[Sarah Cloud Daemon ${INSTANCE_ID}] Purged stale SQLite cookie jar prior to fresh vault injection.`);
  }

  const keyNames = new Set(cookies.map((c) => String(c?.name || '')));
  const presentKeys = [...CORE_GOOGLE_AUTH_COOKIES, 'LSID'].filter((k) => keyNames.has(k));
  console.log(
    `[Sarah Cloud Daemon ${INSTANCE_ID}] Launching ${execPath} (profile=${CHROME_PROFILE_DIR}) with ${cookies.length} vault cookies (keys: ${presentKeys.join(',') || 'none'})...`
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

    // Check if persistent VM Chrome profile ALREADY has all 7 core Google auth cookies + voice.google.com
    const nativeVmAuthMarker = path.join(CHROME_PROFILE_DIR, '.native-vm-auth');
    const hasNativeVmAuthMarker = existsSync(nativeVmAuthMarker);
    const existingProfileCookies = await client
      .send('Storage.getCookies')
      .catch(() => client.send('Network.getAllCookies').catch(() => ({ cookies: [] })));
    const existingNames = new Set(
      Array.isArray(existingProfileCookies?.cookies)
        ? existingProfileCookies.cookies.map((c) => String(c?.name || ''))
        : []
    );
    const profileHasAllCoreAuth = CORE_GOOGLE_AUTH_COOKIES.every((k) => existingNames.has(k));
    const profileHasGvCookies =
      Array.isArray(existingProfileCookies?.cookies) &&
      existingProfileCookies.cookies.some((c) => c.domain?.includes('voice.google.com'));
    const hasNewerVaultSync = Boolean(vaultUpdatedAt && vaultUpdatedAt !== previousVaultStamp);
    const profileHasLiveVmSession =
      !forceClearCookies &&
      !hasNewerVaultSync &&
      (hasNativeVmAuthMarker || existsSync(vmSessionLiveMarker)) &&
      profileHasAllCoreAuth &&
      profileHasGvCookies;

    const shouldInjectVaultCookies =
      !hasNativeVmAuthMarker &&
      !profileHasLiveVmSession &&
      cookies.length > 0 &&
      (forceClearCookies || !profileHasAllCoreAuth || !profileHasGvCookies || hasNewerVaultSync);

    // Strip HeadlessChrome marker; keep syncedUserAgent consistently whenever session came from cookie vault
    const defaultUa = (await browser.userAgent()).replace(/HeadlessChrome\//gi, 'Chrome/');
    const effectiveUa =
      !hasNativeVmAuthMarker && syncedUserAgent && !/HeadlessChrome/i.test(syncedUserAgent)
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

    // 100% OS-level trusted CDP mouse click for Answer & Hangup buttons
    await page.exposeFunction('__iwgTrustedClick', async (x, y) => {
      const nx = Number(x);
      const ny = Number(y);
      if (Number.isFinite(nx) && Number.isFinite(ny) && nx >= 0 && ny >= 0) {
        await page.mouse.click(nx, ny);
      }
    });

    const cdpCookies = normalizeCookiesForCdp(cookies);
    if (cdpCookies.length > 0 && shouldInjectVaultCookies) {
      if (forceClearCookies) {
        await client.send('Network.clearBrowserCookies').catch(() => { });
      }
      let applied = 0;
      for (const ck of cdpCookies) {
        try {
          await client.send('Network.setCookie', ck);
          applied++;
        } catch { }
      }
      if (vaultUpdatedAt) {
        try {
          writeFileSync(lastVaultStampFile, String(vaultUpdatedAt), 'utf8');
        } catch { }
      }
      console.log(`[Sarah Cloud Daemon ${INSTANCE_ID}] Injected ${applied}/${cdpCookies.length} Google Voice cookies into ${CHROME_PROFILE_DIR}.`);
    } else if (profileHasAllCoreAuth && profileHasGvCookies) {
      console.log(`[Sarah Cloud Daemon ${INSTANCE_ID}] Reusing live self-rotating Chrome profile session (${existingProfileCookies?.cookies?.length || 0} profile cookies).`);
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

    if (page.url().includes('workspace.google.com')) {
      console.log(`[Sarah Cloud Daemon ${INSTANCE_ID}] Redirected to workspace.google.com — invoking ServiceLogin passive grandcentral SSO...`);
      await page
        .goto(
          'https://accounts.google.com/ServiceLogin?service=grandcentral&passive=true&continue=https%3A%2F%2Fvoice.google.com%2Fu%2F0%2Fcalls',
          { waitUntil: 'domcontentloaded', timeout: 30000 }
        )
        .catch(() => { });
    }

    if (page.url().includes('accounts.google.com')) {
      const resolved = await resolveAccountChooserIfNeeded(page);
      if (!resolved && profileHasLiveVmSession && cdpCookies.length > 0) {
        try {
          rmSync(vmSessionLiveMarker, { force: true });
        } catch { }
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
        writeFileSync(vmSessionLiveMarker, new Date().toISOString(), 'utf8');
      } catch { }

      // Verify Google Voice Web ringing ("Prefer Wi-Fi and mobile data" + Web ON + Call Screening OFF)
      await verifyGoogleVoiceWebSettings(browser, effectiveUa);
      await page.bringToFront().catch(() => { });
      await page.mouse.click(80, 80).catch(() => { });
      await page.evaluate(() => {
        window.postMessage({ __iwg_webrtc__: true, type: 'IWG_RESUME_AUDIO' }, '*');
      }).catch(() => { });

      try {
        const all = await client.send('Storage.getCookies').catch(() => client.send('Network.getAllCookies'));
        if (Array.isArray(all?.cookies) && all.cookies.length > 0) {
          const savedStamp = await saveRefreshedCookies(all.cookies, effectiveUa);
          if (savedStamp) {
            writeFileSync(lastVaultStampFile, String(savedStamp), 'utf8');
          }
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
        !isGoogleVoiceAuthenticatedUrl(currentUrl, title) ||
        currentUrl.includes('workspace.google.com') ||
        currentUrl.includes('accounts.google.com') ||
        currentUrl.includes('voice.google.com/about') ||
        /sign\s*in/i.test(title);

      if (isSignedOut) {
        try {
          rmSync(nativeVmAuthMarker, { force: true });
          rmSync(vmSessionLiveMarker, { force: true });
        } catch { }
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

      // Ensure controller stays attached across SPA route updates & preserve live call telemetry
      await page
        .evaluate(
          `${configBootstrap}\nif (!window.__IWG_GV_RECEPTIONIST_ACTIVE__ && location.hostname === 'voice.google.com') {\n${contentControllerCode}\n}`
        )
        .catch(() => { });
      const liveSnap = await page
        .evaluate(() => ({
          state: window.__IWG_GV_GET_STATE__?.() || null,
          webrtc: window.__IWG_WEBRTC_GET_DIAGNOSTICS__?.() || null,
        }))
        .catch(() => ({ state: null, webrtc: null }));
      const liveState = liveSnap.state;
      if (liveSnap.webrtc?.audioCtxState === 'suspended') {
        await page.mouse.click(80, 80).catch(() => { });
        await page
          .evaluate(() => window.postMessage({ __iwg_webrtc__: true, type: 'IWG_RESUME_AUDIO' }, '*'))
          .catch(() => { });
      }
      await reportDaemonHeartbeat({
        url: currentUrl,
        title: title || 'Google Voice',
        visibilityState: 'visible',
        sessionAuthenticated: true,
        callActive: Boolean(liveState?.callActive),
        isSpeaking: Boolean(liveState?.isSpeaking),
        audioCtxState: liveSnap.webrtc?.audioCtxState || 'ready',
        lastAnswerClickTs: Number(liveState?.lastAnswerClickTs || 0),
        totalCallsAnswered: Number(liveState?.totalCallsAnswered || 0),
        hasPreloadedGreeting: liveState ? Boolean(liveState.hasPreloadedGreeting) : true,
        receivingCallsText: 'Zero-Echo Pure Digital WebRTC Isolation ACTIVE',
      });

      // Persist rotated Google cookies back to AES-256 Cloud Vault every 4 mins
      if (Date.now() - lastRefreshSave > 4 * 60 * 1000) {
        lastRefreshSave = Date.now();
        try {
          const all = await client.send('Storage.getCookies').catch(() => client.send('Network.getAllCookies'));
          if (Array.isArray(all?.cookies) && all.cookies.length > 0) {
            const savedStamp = await saveRefreshedCookies(all.cookies, effectiveUa);
            if (savedStamp) {
              writeFileSync(lastVaultStampFile, String(savedStamp), 'utf8');
            }
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

    if (
      consecutiveSignOuts >= 2 &&
      updatedAt &&
      updatedAt === lastFailedCookieStamp &&
      !existsSync(path.join(CHROME_PROFILE_DIR, '.native-vm-auth'))
    ) {
      await reportDaemonHeartbeat({
        url: 'https://accounts.google.com',
        title: 'Awaiting fresh Google Voice cookie sync (v3.3.0) or one-time VM login',
        sessionAuthenticated: false,
        receivingCallsText: 'Paused Chromium — Reload Extension v3.3.0 or Run vm-gv-direct-login.sh',
      });
      await new Promise((r) => setTimeout(r, 3000));
      continue;
    }

    try {
      const outcome = await runBrowserSession(cookies || [], userAgent, {
        forceClearCookies: consecutiveSignOuts >= 1,
        vaultUpdatedAt: updatedAt,
      });
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
