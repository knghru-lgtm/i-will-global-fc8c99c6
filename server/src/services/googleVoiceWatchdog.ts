import { exec } from 'node:child_process';
import { createCipheriv, createDecipheriv, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { config, repoRoot } from '../config.ts';
import { one, q } from '../db/index.ts';

export const CURRENT_GV_EXTENSION_BUILD = '2026-11-14-v14';
export const DEFAULT_GV_BRIDGE_TOKEN = 'iwg-sarah-cloud-bridge-v10-9455';
const DISK_COOKIE_VAULT_PATH = path.resolve(repoRoot, 'server/data/gv-cookie-vault.enc.json');

export interface GvButtonTelemetry {
  tag: string;
  aria: string;
  title: string;
  testId: string;
  text: string;
  classes: string;
  visible: boolean;
  rect: string;
}

export interface GvRunnerTelemetry {
  runner: 'cloud-daemon' | 'chrome-extension';
  instanceId?: string;
  region?: string;
  lastHeartbeatAt: number;
  extensionBuild: string;
  url: string;
  title: string;
  visibilityState: string;
  receivingCallsText: string;
  incomingBannerText: string;
  callActive: boolean;
  isSpeaking: boolean;
  hasPreloadedGreeting: boolean;
  audioCtxState: string;
  sessionAuthenticated: boolean;
  lastAnswerClickTs: number;
  totalCallsAnswered: number;
}

export interface GvHeartbeatState {
  lastHeartbeatAt: number;
  lastLaunchAttemptAt: number;
  launchCount: number;
  extensionBuild: string;
  url: string;
  title: string;
  visibilityState: string;
  receivingCallsText: string;
  incomingBannerText: string;
  callActive: boolean;
  isSpeaking: boolean;
  hasPreloadedGreeting: boolean;
  audioCtxState: string;
  lastAnswerClickTs: number;
  totalCallsAnswered: number;
  cloudDaemon: GvRunnerTelemetry | null;
  localExtension: GvRunnerTelemetry | null;
  cookieVaultUpdatedAt: string | null;
  cookieVaultCount: number;
  visibleButtons: GvButtonTelemetry[];
  recentEvents: Array<{ ts: string; event: string; detail?: string }>;
  pendingCommand: {
    targetRunner?: 'cloud-daemon' | 'chrome-extension' | 'any';
    reloadExtension?: boolean;
    reloadTab?: boolean;
    simulateIncomingCall?: boolean;
    callerPhone?: string;
    dialOutboundPhone?: string;
    leadId?: string;
  } | null;
}

const state: GvHeartbeatState = {
  lastHeartbeatAt: 0,
  lastLaunchAttemptAt: 0,
  launchCount: 0,
  extensionBuild: '',
  url: '',
  title: '',
  visibilityState: '',
  receivingCallsText: '',
  incomingBannerText: '',
  callActive: false,
  isSpeaking: false,
  hasPreloadedGreeting: false,
  audioCtxState: '',
  lastAnswerClickTs: 0,
  totalCallsAnswered: 0,
  cloudDaemon: null,
  localExtension: null,
  cookieVaultUpdatedAt: null,
  cookieVaultCount: 0,
  visibleButtons: [],
  recentEvents: [],
  pendingCommand: null,
};

let settingsReady = false;
async function ensureSettingsTable() {
  if (settingsReady) return;
  try {
    await q(`CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value JSONB NOT NULL DEFAULT '{}'::jsonb,
      updated_at TIMESTAMPTZ DEFAULT now()
    )`);
    settingsReady = true;
  } catch {
    // ignore
  }
}

function getVaultKeys(): Buffer[] {
  const bridgeToken = process.env.GV_BRIDGE_TOKEN || DEFAULT_GV_BRIDGE_TOKEN;
  const stablePrimary = scryptSync(
    `${process.env.GV_BRIDGE_SECRET || bridgeToken}|iwg-gv-cloud-vault-v13`,
    'iwg-sarah-9455-salt',
    32
  );
  const legacyJwtKey = scryptSync(
    `${process.env.GV_BRIDGE_SECRET || ''}|${config.jwtSecret}|iwg-gv-cloud-vault-v10`,
    'iwg-sarah-9455-salt',
    32
  );
  return [stablePrimary, legacyJwtKey];
}

function decryptVaultRecord(val: any): any[] | null {
  if (!val || !val.ciphertext || !val.iv || !val.tag) return null;
  for (const key of getVaultKeys()) {
    try {
      const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(val.iv, 'base64'));
      decipher.setAuthTag(Buffer.from(val.tag, 'base64'));
      const decrypted = Buffer.concat([
        decipher.update(Buffer.from(val.ciphertext, 'base64')),
        decipher.final(),
      ]);
      const parsed = JSON.parse(decrypted.toString('utf8'));
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    } catch {
      // try next candidate key
    }
  }
  return null;
}

export function verifyBridgeToken(provided?: string | null): boolean {
  const expected = process.env.GV_BRIDGE_TOKEN || DEFAULT_GV_BRIDGE_TOKEN;
  const clean = String(provided || '').trim();
  if (!clean || clean.length !== expected.length) return false;
  try {
    return timingSafeEqual(Buffer.from(clean, 'utf8'), Buffer.from(expected, 'utf8'));
  } catch {
    return false;
  }
}

export async function saveCloudGvCookies(
  cookies: any[],
  source = 'extension',
  userAgent = ''
): Promise<{ ok: boolean; count: number; updatedAt: string }> {
  if (!Array.isArray(cookies) || cookies.length === 0) {
    throw new Error('No cookies provided');
  }
  const googleCookies = cookies.filter((c) => {
    const dom = String(c?.domain || '').toLowerCase();
    return c?.name && typeof c?.value === 'string' && (dom.endsWith('google.com') || dom === 'google.com');
  });
  const hasAuthCookie = googleCookies.some((c) =>
    ['SID', '__Secure-1PSID', '__Secure-3PSID', 'HSID', 'SSID'].includes(String(c.name))
  );
  if (!hasAuthCookie) {
    throw new Error('Cookie set does not contain authenticated Google session cookies (SID / __Secure-1PSID)');
  }

  await ensureSettingsTable();
  const [key] = getVaultKeys();
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const plaintext = Buffer.from(JSON.stringify(googleCookies), 'utf8');
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  const updatedAt = new Date().toISOString();

  const record = {
    v: 2,
    alg: 'aes-256-gcm',
    iv: iv.toString('base64'),
    tag: tag.toString('base64'),
    ciphertext: encrypted.toString('base64'),
    count: googleCookies.length,
    source,
    userAgent: userAgent ? String(userAgent).slice(0, 300) : undefined,
    updatedAt,
  };

  await q(
    `INSERT INTO settings (key, value, updated_at) VALUES ('sarah_gv_cloud_cookies', $1::jsonb, now())
     ON CONFLICT (key) DO UPDATE SET value = $1::jsonb, updated_at = now()`,
    [JSON.stringify(record)]
  );

  if (process.env.NODE_ENV !== 'test') {
    try {
      mkdirSync(path.dirname(DISK_COOKIE_VAULT_PATH), { recursive: true });
      writeFileSync(DISK_COOKIE_VAULT_PATH, JSON.stringify(record, null, 2), { mode: 0o600 });
    } catch { }
  }

  state.cookieVaultUpdatedAt = updatedAt;
  state.cookieVaultCount = googleCookies.length;
  recordGvEvent('gv_cloud_cookies_synced', `Saved ${googleCookies.length} encrypted Google Voice cookies (${source})`);
  await persistGvStateToDb().catch(() => { });

  return { ok: true, count: googleCookies.length, updatedAt };
}

let checkedLegacyCookieMigration = false;

export async function loadCloudGvCookies(): Promise<{
  cookies: any[];
  updatedAt: string | null;
  count: number;
  userAgent?: string | null;
}> {
  await ensureSettingsTable();
  let row = await one<{ value: any }>(`SELECT value FROM settings WHERE key = 'sarah_gv_cloud_cookies'`);

  // Self-healing fallback 1: encrypted on-disk vault file (survives any PGlite directory reset)
  if ((!row?.value || !row.value.ciphertext) && process.env.NODE_ENV !== 'test' && existsSync(DISK_COOKIE_VAULT_PATH)) {
    try {
      const diskRecord = JSON.parse(readFileSync(DISK_COOKIE_VAULT_PATH, 'utf8'));
      if (diskRecord?.ciphertext) {
        row = { value: diskRecord };
        await q(
          `INSERT INTO settings (key, value, updated_at) VALUES ('sarah_gv_cloud_cookies', $1::jsonb, now())
           ON CONFLICT (key) DO UPDATE SET value = $1::jsonb, updated_at = now()`,
          [JSON.stringify(diskRecord)]
        ).catch(() => { });
      }
    } catch { }
  }

  // Self-healing fallback 2: legacy data/pg PGlite vault migration
  if ((!row?.value || !row.value.ciphertext) && !checkedLegacyCookieMigration && process.env.NODE_ENV !== 'test') {
    checkedLegacyCookieMigration = true;
    const altPgDir = path.join(repoRoot, 'data', 'pg');
    if (altPgDir !== config.dataDir && existsSync(path.join(altPgDir, 'PG_VERSION'))) {
      try {
        const { PGlite } = await import('@electric-sql/pglite');
        const altDb = await PGlite.create(altPgDir);
        const altRes: any = await altDb.query(`SELECT value FROM settings WHERE key = 'sarah_gv_cloud_cookies'`);
        await altDb.close().catch(() => { });
        const altVal = altRes?.rows?.[0]?.value;
        if (altVal?.ciphertext) {
          await q(
            `INSERT INTO settings (key, value, updated_at) VALUES ('sarah_gv_cloud_cookies', $1::jsonb, now())
             ON CONFLICT (key) DO UPDATE SET value = $1::jsonb, updated_at = now()`,
            [JSON.stringify(altVal)]
          );
          row = { value: altVal };
          recordGvEvent('gv_cloud_cookies_migrated', 'Recovered encrypted Google Voice cookie vault from legacy data/pg');
        }
      } catch {
        // ignore if legacy directory is locked or unreadable
      }
    }
  }

  const val = row?.value;
  const cookies = decryptVaultRecord(val);
  if (!cookies || cookies.length === 0) {
    // Reset stale metadata so `needsCookieSync` immediately signals extension to push fresh cookies
    state.cookieVaultCount = 0;
    state.cookieVaultUpdatedAt = null;
    return { cookies: [], updatedAt: null, count: 0 };
  }

  state.cookieVaultCount = cookies.length;
  state.cookieVaultUpdatedAt = val.updatedAt || state.cookieVaultUpdatedAt;
  return {
    cookies,
    updatedAt: val.updatedAt || null,
    count: cookies.length,
    userAgent: val.userAgent || null,
  };
}

async function loadGvStateFromDb(): Promise<GvHeartbeatState> {
  await ensureSettingsTable();
  try {
    const row = await one<{ value: any }>(`SELECT value FROM settings WHERE key = 'sarah_gv_bridge_status'`);
    if (row?.value && typeof row.value === 'object') {
      const dbVal = row.value as Partial<GvHeartbeatState>;
      // Merge fresher DB state into in-memory state
      if ((dbVal.lastHeartbeatAt || 0) >= state.lastHeartbeatAt) {
        Object.assign(state, dbVal);
      } else {
        if (
          dbVal.cloudDaemon &&
          (!state.cloudDaemon || dbVal.cloudDaemon.lastHeartbeatAt >= state.cloudDaemon.lastHeartbeatAt)
        ) {
          state.cloudDaemon = dbVal.cloudDaemon;
        }
        if (
          dbVal.localExtension &&
          (!state.localExtension || dbVal.localExtension.lastHeartbeatAt >= state.localExtension.lastHeartbeatAt)
        ) {
          state.localExtension = dbVal.localExtension;
        }
        if (dbVal.pendingCommand && !state.pendingCommand) {
          state.pendingCommand = dbVal.pendingCommand;
        }
        if (dbVal.cookieVaultUpdatedAt) {
          state.cookieVaultUpdatedAt = dbVal.cookieVaultUpdatedAt;
          state.cookieVaultCount = dbVal.cookieVaultCount || 0;
        }
      }
    }
  } catch {
    // fallback to in-memory state
  }
  return state;
}

async function persistGvStateToDb(): Promise<void> {
  await ensureSettingsTable();
  try {
    await q(
      `INSERT INTO settings (key, value, updated_at) VALUES ('sarah_gv_bridge_status', $1::jsonb, now())
       ON CONFLICT (key) DO UPDATE SET value = $1::jsonb, updated_at = now()`,
      [JSON.stringify(state)]
    );
  } catch {
    // ignore transient db write errors
  }
}

export function recordGvEvent(event: string, detail?: string) {
  state.recentEvents.unshift({
    ts: new Date().toISOString(),
    event,
    detail: detail ? String(detail).slice(0, 300) : undefined,
  });
  if (state.recentEvents.length > 40) {
    state.recentEvents.length = 40;
  }
}

export async function handleGvHeartbeat(payload: any) {
  await loadGvStateFromDb();
  const now = Date.now();
  const runner: 'cloud-daemon' | 'chrome-extension' =
    payload?.runner === 'cloud-daemon' ? 'cloud-daemon' : 'chrome-extension';

  const prevRunner = runner === 'cloud-daemon' ? state.cloudDaemon : state.localExtension;
  const wasRunnerOffline = !prevRunner || now - prevRunner.lastHeartbeatAt > 20_000;

  const urlStr = payload?.url ? String(payload.url) : prevRunner?.url || '';
  const titleStr = payload?.title !== undefined ? String(payload.title) : prevRunner?.title || '';
  const sessionAuthenticated =
    typeof payload?.sessionAuthenticated === 'boolean'
      ? payload.sessionAuthenticated
      : Boolean(urlStr.includes('voice.google.com') && !urlStr.includes('accounts.google.com') && !/sign in/i.test(titleStr));

  const runnerTelemetry: GvRunnerTelemetry = {
    runner,
    instanceId: payload?.instanceId ? String(payload.instanceId) : prevRunner?.instanceId,
    region: payload?.region ? String(payload.region) : prevRunner?.region,
    lastHeartbeatAt: now,
    extensionBuild: payload?.extensionBuild ? String(payload.extensionBuild) : prevRunner?.extensionBuild || '',
    url: urlStr,
    title: titleStr,
    visibilityState: payload?.visibilityState ? String(payload.visibilityState) : prevRunner?.visibilityState || 'visible',
    receivingCallsText:
      payload?.receivingCallsText !== undefined
        ? String(payload.receivingCallsText)
        : prevRunner?.receivingCallsText || '',
    incomingBannerText:
      payload?.incomingBannerText !== undefined
        ? String(payload.incomingBannerText)
        : prevRunner?.incomingBannerText || '',
    callActive: typeof payload?.callActive === 'boolean' ? payload.callActive : Boolean(prevRunner?.callActive),
    isSpeaking: typeof payload?.isSpeaking === 'boolean' ? payload.isSpeaking : Boolean(prevRunner?.isSpeaking),
    hasPreloadedGreeting:
      typeof payload?.hasPreloadedGreeting === 'boolean'
        ? payload.hasPreloadedGreeting
        : Boolean(prevRunner?.hasPreloadedGreeting),
    audioCtxState: payload?.audioCtxState ? String(payload.audioCtxState) : prevRunner?.audioCtxState || '',
    sessionAuthenticated,
    lastAnswerClickTs:
      typeof payload?.lastAnswerClickTs === 'number' ? payload.lastAnswerClickTs : prevRunner?.lastAnswerClickTs || 0,
    totalCallsAnswered:
      typeof payload?.totalCallsAnswered === 'number'
        ? payload.totalCallsAnswered
        : prevRunner?.totalCallsAnswered || 0,
  };

  if (runner === 'cloud-daemon') {
    state.cloudDaemon = runnerTelemetry;
  } else {
    state.localExtension = runnerTelemetry;
  }

  const cloudDaemonOnline = Boolean(
    state.cloudDaemon &&
    now - state.cloudDaemon.lastHeartbeatAt < 20_000 &&
    state.cloudDaemon.sessionAuthenticated !== false
  );

  // Top-level state always reflects the active primary responder (Cloud Daemon first, Laptop Extension fallback)
  const primary = cloudDaemonOnline && state.cloudDaemon ? state.cloudDaemon : runnerTelemetry;
  state.lastHeartbeatAt = primary.lastHeartbeatAt;
  state.extensionBuild = primary.extensionBuild;
  state.url = primary.url;
  state.title = primary.title;
  state.visibilityState = primary.visibilityState;
  state.receivingCallsText = primary.receivingCallsText;
  state.incomingBannerText = primary.incomingBannerText;
  state.callActive = primary.callActive;
  state.isSpeaking = primary.isSpeaking;
  state.hasPreloadedGreeting = primary.hasPreloadedGreeting;
  state.audioCtxState = primary.audioCtxState;
  state.lastAnswerClickTs = primary.lastAnswerClickTs;
  state.totalCallsAnswered =
    (state.cloudDaemon?.totalCallsAnswered || 0) + (state.localExtension?.totalCallsAnswered || 0);

  if (Array.isArray(payload?.visibleButtons) && (runner === 'cloud-daemon' || !cloudDaemonOnline)) {
    state.visibleButtons = payload.visibleButtons.slice(0, 35);
  }
  if (payload?.event) {
    recordGvEvent(`[${runner}] ${String(payload.event)}`, payload.eventDetail);
  } else if (wasRunnerOffline) {
    recordGvEvent(
      `gv_${runner}_connected`,
      `${runnerTelemetry.url} (build=${runnerTelemetry.extensionBuild}, auth=${sessionAuthenticated})`
    );
  }

  // Deliver pendingCommand only to the targeted runner (or Cloud Daemon by default when online)
  let cmdToDeliver: GvHeartbeatState['pendingCommand'] = null;
  if (state.pendingCommand) {
    const target = state.pendingCommand.targetRunner || (cloudDaemonOnline ? 'cloud-daemon' : 'any');
    if (target === 'any' || target === runner) {
      cmdToDeliver = state.pendingCommand;
      state.pendingCommand = null;
    }
  }

  await persistGvStateToDb();

  const needsReload =
    runner === 'chrome-extension' &&
    Boolean(payload?.extensionBuild) &&
    String(payload.extensionBuild) !== CURRENT_GV_EXTENSION_BUILD;

  const cloudNeedsFreshCookies = Boolean(
    !state.cookieVaultUpdatedAt ||
    state.cookieVaultCount === 0 ||
    (state.cloudDaemon &&
      now - state.cloudDaemon.lastHeartbeatAt < 30_000 &&
      state.cloudDaemon.sessionAuthenticated === false)
  );

  return {
    ok: true,
    targetBuild: CURRENT_GV_EXTENSION_BUILD,
    cloudDaemonOnline,
    standbyForCloud: runner === 'chrome-extension' && cloudDaemonOnline,
    needsCookieSync: cloudNeedsFreshCookies,
    reloadExtension: cmdToDeliver?.reloadExtension || needsReload || false,
    reloadTab: cmdToDeliver?.reloadTab || false,
    simulateIncomingCall: cmdToDeliver?.simulateIncomingCall || false,
    callerPhone: cmdToDeliver?.callerPhone || '',
    dialOutboundPhone: cmdToDeliver?.dialOutboundPhone || '',
    leadId: cmdToDeliver?.leadId || '',
  };
}

export async function getGvWatchdogStatus() {
  await loadGvStateFromDb();
  const now = Date.now();
  const cloudAgeMs = state.cloudDaemon?.lastHeartbeatAt ? now - state.cloudDaemon.lastHeartbeatAt : null;
  const localAgeMs = state.localExtension?.lastHeartbeatAt ? now - state.localExtension.lastHeartbeatAt : null;
  const cloudDaemonOnline = Boolean(
    cloudAgeMs !== null && cloudAgeMs < 20_000 && state.cloudDaemon?.sessionAuthenticated !== false
  );
  const localExtensionOnline = Boolean(localAgeMs !== null && localAgeMs < 15_000);
  const online = cloudDaemonOnline || localExtensionOnline;
  const ageMs = cloudDaemonOnline ? cloudAgeMs : localExtensionOnline ? localAgeMs : state.lastHeartbeatAt ? now - state.lastHeartbeatAt : null;

  const sessionAuthenticated = Boolean(
    cloudDaemonOnline || (localExtensionOnline && state.localExtension?.sessionAuthenticated !== false)
  );

  return {
    ok: true,
    online,
    cloudDaemonOnline,
    localExtensionOnline,
    laptopIndependent: cloudDaemonOnline,
    sessionAuthenticated,
    activeMode: cloudDaemonOnline
      ? 'cloud_daemon_24_7'
      : localExtensionOnline
        ? 'laptop_extension_fallback'
        : 'offline',
    heartbeatAgeMs: ageMs,
    cloudHeartbeatAgeMs: cloudAgeMs,
    localHeartbeatAgeMs: localAgeMs,
    targetBuild: CURRENT_GV_EXTENSION_BUILD,
    ...state,
  };
}

export async function queueGvCommand(cmd: NonNullable<GvHeartbeatState['pendingCommand']>) {
  await loadGvStateFromDb();
  state.pendingCommand = { ...(state.pendingCommand || {}), ...cmd };
  recordGvEvent('gv_command_queued', JSON.stringify(state.pendingCommand));
  await persistGvStateToDb();
  return { ok: true, queued: state.pendingCommand };
}

export function launchGoogleVoiceChromeWindow(reason = 'watchdog'): boolean {
  if (process.env.VERCEL || process.platform !== 'win32') return false;
  const chromeExe = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
  if (!existsSync(chromeExe)) return false;

  state.lastLaunchAttemptAt = Date.now();
  state.launchCount += 1;
  recordGvEvent('gv_chrome_launch', `Ensuring Google Voice Profile 7 with extension (${reason})`);

  try {
    const extDir = fileURLToPath(new URL('../../../google-voice-extension', import.meta.url));
    const psScript = `
$procs = Get-CimInstance Win32_Process -Filter "Name = 'chrome.exe'" | Where-Object { $_.CommandLine -notlike '*--type=*' }
$needsRestart = $false
if ($procs) {
  foreach ($p in $procs) {
    if ($p.CommandLine -notlike '*google-voice-extension*') {
      $needsRestart = $true
    }
  }
}
if ($needsRestart) {
  Get-Process chrome -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
  Start-Sleep -Milliseconds 500
}
$cmd = '"${chromeExe}" --restore-last-session --profile-directory="Profile 7" --load-extension="${extDir}" --autoplay-policy=no-user-gesture-required --use-fake-ui-for-media-stream --disable-background-timer-throttling --disable-renderer-backgrounding --disable-backgrounding-occluded-windows https://voice.google.com/u/0/calls'
Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{ CommandLine = $cmd } | Out-Null
`.trim();

    const encoded = Buffer.from(psScript, 'utf16le').toString('base64');
    exec(`powershell.exe -NoProfile -NonInteractive -WindowStyle Hidden -EncodedCommand ${encoded}`, (err) => {
      if (err) {
        recordGvEvent('gv_chrome_launch_error', err.message);
      }
    });
    return true;
  } catch (err: any) {
    recordGvEvent('gv_chrome_launch_error', err?.message || 'spawn error');
    return false;
  }
}

let watchdogTimer: ReturnType<typeof setInterval> | null = null;

export function startGoogleVoiceWatchdog() {
  if (process.env.VERCEL || process.platform !== 'win32') return;
  if (watchdogTimer) return;

  recordGvEvent('watchdog_started', 'Monitoring Google Voice (480) 331-9455 (Cloud-First + Local Standby)');

  watchdogTimer = setInterval(async () => {
    try {
      const status = await getGvWatchdogStatus();
      // Never auto-launch local Chrome if the 24/7 Cloud Daemon is already online!
      if (status.cloudDaemonOnline) return;

      const now = Date.now();
      const heartbeatMissing = !status.online;
      const cooldownElapsed = now - state.lastLaunchAttemptAt > 30_000;

      if (heartbeatMissing && cooldownElapsed && process.env.IWG_DISABLE_LOCAL_CHROME !== '1') {
        launchGoogleVoiceChromeWindow('cloud_offline_fallback');
      }
    } catch {
      // ignore
    }
  }, 10_000);
}
