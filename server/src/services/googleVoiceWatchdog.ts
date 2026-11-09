import { exec } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const CURRENT_GV_EXTENSION_BUILD = '2026-11-09-v8';

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
  visibleButtons: GvButtonTelemetry[];
  recentEvents: Array<{ ts: string; event: string; detail?: string }>;
  pendingCommand: {
    reloadExtension?: boolean;
    reloadTab?: boolean;
    simulateIncomingCall?: boolean;
    callerPhone?: string;
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
  visibleButtons: [],
  recentEvents: [],
  pendingCommand: null,
};

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

export function handleGvHeartbeat(payload: any) {
  const now = Date.now();
  const wasOffline = state.lastHeartbeatAt === 0 || now - state.lastHeartbeatAt > 15_000;
  state.lastHeartbeatAt = now;
  if (payload?.extensionBuild) state.extensionBuild = String(payload.extensionBuild);
  if (payload?.url) state.url = String(payload.url);
  if (payload?.title !== undefined) state.title = String(payload.title);
  if (payload?.visibilityState) state.visibilityState = String(payload.visibilityState);
  if (payload?.receivingCallsText !== undefined) state.receivingCallsText = String(payload.receivingCallsText);
  if (payload?.incomingBannerText !== undefined) state.incomingBannerText = String(payload.incomingBannerText);
  if (typeof payload?.callActive === 'boolean') state.callActive = payload.callActive;
  if (typeof payload?.isSpeaking === 'boolean') state.isSpeaking = payload.isSpeaking;
  if (typeof payload?.hasPreloadedGreeting === 'boolean') state.hasPreloadedGreeting = payload.hasPreloadedGreeting;
  if (payload?.audioCtxState) state.audioCtxState = String(payload.audioCtxState);
  if (typeof payload?.lastAnswerClickTs === 'number') state.lastAnswerClickTs = payload.lastAnswerClickTs;
  if (typeof payload?.totalCallsAnswered === 'number') state.totalCallsAnswered = payload.totalCallsAnswered;
  if (Array.isArray(payload?.visibleButtons)) {
    state.visibleButtons = payload.visibleButtons.slice(0, 35);
  }
  if (payload?.event) {
    recordGvEvent(String(payload.event), payload.eventDetail);
  } else if (wasOffline) {
    recordGvEvent('gv_heartbeat_connected', `${state.url} (build=${state.extensionBuild})`);
  }

  const cmd = state.pendingCommand;
  state.pendingCommand = null;

  const needsReload =
    Boolean(payload?.extensionBuild) &&
    String(payload.extensionBuild) !== CURRENT_GV_EXTENSION_BUILD;

  return {
    ok: true,
    targetBuild: CURRENT_GV_EXTENSION_BUILD,
    reloadExtension: cmd?.reloadExtension || needsReload || false,
    reloadTab: cmd?.reloadTab || false,
    simulateIncomingCall: cmd?.simulateIncomingCall || false,
    callerPhone: cmd?.callerPhone || '',
  };
}

export function getGvWatchdogStatus() {
  const now = Date.now();
  const ageMs = state.lastHeartbeatAt ? now - state.lastHeartbeatAt : null;
  return {
    ok: true,
    online: ageMs !== null && ageMs < 12_000,
    heartbeatAgeMs: ageMs,
    targetBuild: CURRENT_GV_EXTENSION_BUILD,
    ...state,
  };
}

export function queueGvCommand(cmd: NonNullable<GvHeartbeatState['pendingCommand']>) {
  state.pendingCommand = { ...(state.pendingCommand || {}), ...cmd };
  recordGvEvent('gv_command_queued', JSON.stringify(state.pendingCommand));
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
    // Launch via WMI Win32_Process.Create so Chrome starts outside any temporary Job Object
    // and automatically restarts with --restore-last-session + --load-extension if regular Chrome was started without the extension flag
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

  recordGvEvent('watchdog_started', 'Monitoring Google Voice (480) 331-9455 24/7 with WebRTC Direct Audio Bridge');

  setTimeout(() => {
    const now = Date.now();
    if (now - state.lastHeartbeatAt > 10_000 && now - state.lastLaunchAttemptAt > 15_000) {
      launchGoogleVoiceChromeWindow('server_startup');
    }
  }, 3_500);

  watchdogTimer = setInterval(() => {
    const now = Date.now();
    const heartbeatMissing = state.lastHeartbeatAt === 0 || now - state.lastHeartbeatAt > 15_000;
    const cooldownElapsed = now - state.lastLaunchAttemptAt > 25_000;

    if (heartbeatMissing && cooldownElapsed) {
      launchGoogleVoiceChromeWindow('heartbeat_timeout_reopen_gv');
    }
  }, 6_000);
}
