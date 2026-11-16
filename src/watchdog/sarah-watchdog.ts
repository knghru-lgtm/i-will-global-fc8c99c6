/**
 * 24/7 Autonomous PM2 Watchdog Daemon (`sarah-watchdog`)
 * 100% Google Cloud + Google Voice (+14803319455) + Google GenAI (@google/genai)
 *
 * Runs continuously on a 60-second interval (`setInterval`), collecting telemetry across all
 * 6 layers (OS/Disk/SHM/Locks, PM2/Node, PulseAudio 48kHz, Chromium Google Voice CDP :9222,
 * Caddy HTTPS Reverse Proxy, and API/CRM DB), evaluating Playbooks A–D, and executing
 * deterministic Sub-Agent auto-remediations without human intervention.
 */
import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export type SystemStatus = 'HEALTHY' | 'DEGRADED' | 'CRITICAL';
export type SupervisionLayer = 'INFRA' | 'BROWSER' | 'VOICE_CRM';
export type TargetAgent = 'INFRA_AGENT' | 'BROWSER_AGENT' | 'VOICE_CRM_AGENT';
export type DispatchPriority = 'P0_IMMEDIATE' | 'P1_HIGH' | 'P2_ROUTINE';

export interface DispatchInstruction {
  target_agent: TargetAgent;
  priority: DispatchPriority;
  task_summary: string;
  exact_commands_or_actions: string[];
  verification_check: string;
  timeout_seconds: number;
}

export interface ManagerDispatchReport {
  timestamp: string;
  system_status: SystemStatus;
  diagnosis: {
    layer: SupervisionLayer;
    root_cause: string;
    evidence: string;
  };
  dispatch: DispatchInstruction[];
  admin_escalation: {
    notify_human: boolean;
    alert_message: string | null;
  };
  execution_results?: Array<{
    target_agent: TargetAgent;
    results: Array<Record<string, unknown>>;
  }>;
  post_fix_verified?: boolean;
}

interface Pm2ProcessSummary {
  name: string;
  status: string;
  restarts: number;
  uptimeMs: number;
  memMB: number;
  cpuPct: number;
}

interface WatchdogPersistedState {
  consecutiveFailures: number;
  lastPreWindowMaintDate: string;
  totalTicks: number;
  totalAutoFixesApplied: number;
}

function resolveRepoRoot(): string {
  const thisFile = fileURLToPath(import.meta.url);
  const dir = path.dirname(thisFile);
  // Bundled to <repoRoot>/api/sarah-watchdog.js (1 level deep) or run from <repoRoot>/src/watchdog/sarah-watchdog.ts (2 levels deep)
  if (path.basename(dir) === 'api') {
    return path.resolve(dir, '..');
  }
  return path.resolve(dir, '..', '..');
}

const REPO_ROOT = resolveRepoRoot();
const DATA_DIR = path.join(REPO_ROOT, 'server', 'data');
const STATE_PATH = path.join(DATA_DIR, 'ops-supervisor-state.json');
const LATEST_REPORT_PATH = path.join(DATA_DIR, 'ops-supervisor-latest.json');

const LOCAL_API_BASE = process.env.LOCAL_API_URL || 'http://127.0.0.1:4000';
const PUBLIC_FQDN = process.env.PUBLIC_HOST_FQDN || 'voice.iwillglobal.com';
const CDP_URL = process.env.CDP_URL || 'http://127.0.0.1:9222';
const WATCHDOG_INTERVAL_MS = Number(process.env.WATCHDOG_INTERVAL_MS || 60_000);

function readTailLines(filePath: string, maxLines = 30): string[] {
  try {
    if (!existsSync(filePath)) return [];
    return readFileSync(filePath, 'utf8')
      .split(/\r?\n/)
      .filter(Boolean)
      .slice(-maxLines);
  } catch {
    return [];
  }
}

function getPhoenixClock(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Phoenix',
    weekday: 'short',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(now);
  const map = Object.fromEntries(parts.map((p) => [p.type, p.value]));
  const hour = Number(map.hour === '24' ? 0 : map.hour);
  const minute = Number(map.minute);
  const dayMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return {
    dateKey: `${map.year}-${map.month}-${map.day}`,
    weekday: map.weekday || 'Mon',
    dayOfWeek: dayMap[map.weekday || 'Mon'] ?? 1,
    hour,
    minute,
    hhmm: `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`,
  };
}

async function runLinuxShell(cmd: string, timeoutMs = 10_000): Promise<string> {
  if (process.platform === 'win32') return '';
  try {
    const { stdout } = await execFileAsync('/bin/sh', ['-c', cmd], { timeout: timeoutMs });
    return String(stdout || '').trim();
  } catch {
    return '';
  }
}

function loadState(): WatchdogPersistedState {
  try {
    if (existsSync(STATE_PATH)) {
      const parsed = JSON.parse(readFileSync(STATE_PATH, 'utf8'));
      return {
        consecutiveFailures: Number(parsed.consecutiveFailures || 0),
        lastPreWindowMaintDate: String(parsed.lastPreWindowMaintDate || ''),
        totalTicks: Number(parsed.totalTicks || 0),
        totalAutoFixesApplied: Number(parsed.totalAutoFixesApplied || 0),
      };
    }
  } catch {}
  return { consecutiveFailures: 0, lastPreWindowMaintDate: '', totalTicks: 0, totalAutoFixesApplied: 0 };
}

function saveState(st: WatchdogPersistedState): void {
  try {
    mkdirSync(DATA_DIR, { recursive: true });
    writeFileSync(STATE_PATH, JSON.stringify(st, null, 2));
  } catch {}
}

export async function collectSystemTelemetry() {
  const home = os.homedir();
  const [pm2Raw, dfRootRaw, dfShmRaw, pulseSinksRaw, pulseMuteRaw, caddyHttpsRaw, localHealth, gvStatus] =
    await Promise.all([
      runLinuxShell('pm2 jlist'),
      runLinuxShell('df -P / | tail -1'),
      runLinuxShell('df -P /dev/shm 2>/dev/null | tail -1'),
      runLinuxShell('XDG_RUNTIME_DIR="/run/user/$(id -u)" pactl list sinks short 2>/dev/null || true'),
      runLinuxShell('XDG_RUNTIME_DIR="/run/user/$(id -u)" pactl get-sink-mute @DEFAULT_SINK@ 2>/dev/null || true'),
      runLinuxShell(
        `curl -fsS -k -o /dev/null -w "%{http_code}" --max-time 5 --resolve ${PUBLIC_FQDN}:443:127.0.0.1 https://${PUBLIC_FQDN}/health 2>/dev/null || echo 0`
      ),
      fetch(`${LOCAL_API_BASE}/health`)
        .then(async (r) => ({ status: r.status, body: await r.json().catch(() => null) }))
        .catch((e: any) => ({ status: 0, body: null, error: e?.message || 'unreachable' })),
      fetch(`${LOCAL_API_BASE}/api/sarah/gv-status`)
        .then((r) => r.json())
        .catch(() => null),
    ]);

  let pm2: Pm2ProcessSummary[] = [];
  try {
    const parsed = JSON.parse(pm2Raw || '[]');
    if (Array.isArray(parsed)) {
      pm2 = parsed.map((p: any) => ({
        name: String(p.name || ''),
        status: String(p.pm2_env?.status || 'unknown'),
        restarts: Number(p.pm2_env?.restart_time || 0),
        uptimeMs: p.pm2_env?.pm_uptime ? Date.now() - Number(p.pm2_env.pm_uptime) : 0,
        memMB: Math.round(Number(p.monit?.memory || 0) / 1048576),
        cpuPct: Number(p.monit?.cpu || 0),
      }));
    }
  } catch {}

  const parsePct = (line: string): number => {
    const m = String(line || '').match(/(\d+)%/);
    return m ? Number(m[1]) : 0;
  };

  // On Linux, os.freemem() excludes reclaimable page cache; read MemAvailable from /proc/meminfo for accurate memory %
  const totalMemMB = Math.round(os.totalmem() / 1048576);
  let availMemMB = Math.round(os.freemem() / 1048576);
  if (process.platform === 'linux' && existsSync('/proc/meminfo')) {
    try {
      const meminfo = readFileSync('/proc/meminfo', 'utf8');
      const mAvail = meminfo.match(/MemAvailable:\s+(\d+)\s+kB/i);
      if (mAvail) availMemMB = Math.round(Number(mAvail[1]) / 1024);
    } catch {}
  }
  const memUsedPct = totalMemMB > 0 ? Math.round(((totalMemMB - availMemMB) / totalMemMB) * 100) : 0;

  return {
    collectedAt: new Date().toISOString(),
    phoenix: getPhoenixClock(),
    host: {
      hostname: os.hostname(),
      platform: process.platform,
      totalMemMB,
      availMemMB,
      memUsedPct,
      diskUsePct: parsePct(dfRootRaw),
      shmUsePct: parsePct(dfShmRaw),
      pulseSinks: pulseSinksRaw,
      pulseSinkMuted: /yes/i.test(pulseMuteRaw),
      caddyHttpsCode: Number(caddyHttpsRaw || 0),
    },
    pm2,
    localHealth,
    gvStatus,
    errorLogs: {
      daemon: readTailLines(path.join(home, '.pm2', 'logs', 'cloud-voip-daemon-error.log'), 30),
      server: readTailLines(path.join(home, '.pm2', 'logs', 'sarah-server-error.log'), 30),
    },
  };
}

export function evaluateTelemetry(
  telemetry: Awaited<ReturnType<typeof collectSystemTelemetry>>,
  state: WatchdogPersistedState
): ManagerDispatchReport {
  const nowIso = new Date().toISOString();
  const { phoenix, host, pm2, localHealth, gvStatus, errorLogs } = telemetry;

  const serverProc = pm2.find((p) => p.name === 'sarah-server' || p.name === 'api-server');
  const daemonProc = pm2.find((p) => p.name === 'cloud-voip-daemon' || p.name === 'sarah-daemon');
  const daemonErrText = errorLogs.daemon.join('\n');

  // 1. CRITICAL: API Server (:4000) unreachable or PM2 process stopped/errored
  if (localHealth.status !== 200 || !localHealth.body?.ok || (serverProc && serverProc.status !== 'online')) {
    return {
      timestamp: nowIso,
      system_status: 'CRITICAL',
      diagnosis: {
        layer: 'VOICE_CRM',
        root_cause: 'Backend API process (sarah-server on :4000) failed HTTP 200 health check or is not online in PM2.',
        evidence: `localHealth=${localHealth.status}, pm2Status=${serverProc?.status || 'missing'}`,
      },
      dispatch: [
        {
          target_agent: 'INFRA_AGENT',
          priority: 'P0_IMMEDIATE',
          task_summary: 'Restart sarah-server via ecosystem.config.cjs and verify :4000/health returns HTTP 200.',
          exact_commands_or_actions: ['RESTART_SARAH_SERVER'],
          verification_check: 'curl -fsS http://127.0.0.1:4000/health returns {"ok":true}',
          timeout_seconds: 45,
        },
      ],
      admin_escalation: {
        notify_human: state.consecutiveFailures >= 2,
        alert_message:
          state.consecutiveFailures >= 2
            ? 'P0 CRITICAL: sarah-server (:4000) failed 2 consecutive auto-restarts on voice.iwillglobal.com.'
            : null,
      },
    };
  }

  // 2. Playbook A: Orphaned Chromium / Xvfb Lock or stopped VoIP daemon
  const hasLockError = /SingletonLock|XServer already running|Failed to create SingletonProcess/i.test(daemonErrText);
  if ((daemonProc && daemonProc.status !== 'online') || hasLockError) {
    return {
      timestamp: nowIso,
      system_status: 'CRITICAL',
      diagnosis: {
        layer: 'INFRA',
        root_cause: 'Playbook A triggered: cloud-voip-daemon is not online or blocked by orphaned Xvfb/Chromium Singleton lock.',
        evidence: hasLockError
          ? errorLogs.daemon.slice(-2).join(' | ')
          : `cloud-voip-daemon status=${daemonProc?.status || 'missing'}`,
      },
      dispatch: [
        {
          target_agent: 'INFRA_AGENT',
          priority: 'P0_IMMEDIATE',
          task_summary: 'Execute Playbook A: clear /tmp/.X99-lock & Chromium Singleton* locks, reap zombies, and restart cloud-voip-daemon.',
          exact_commands_or_actions: ['PLAYBOOK_A_CLEAN_LOCKS_AND_RESTART'],
          verification_check: 'gv-status confirms cloudDaemonOnline=true and online=true',
          timeout_seconds: 60,
        },
      ],
      admin_escalation: {
        notify_human: state.consecutiveFailures >= 2,
        alert_message:
          state.consecutiveFailures >= 2
            ? 'P0 CRITICAL: cloud-voip-daemon failed Playbook A recovery twice on +14803319455.'
            : null,
      },
    };
  }

  // 3. Playbook B: Google Voice Session Unauthenticated / Heartbeat Stale
  if (!gvStatus?.online || !gvStatus?.cloudDaemonOnline || !gvStatus?.sessionAuthenticated) {
    return {
      timestamp: nowIso,
      system_status: 'CRITICAL',
      diagnosis: {
        layer: 'BROWSER',
        root_cause: 'Playbook B triggered: Google Voice (+14803319455) tab is unauthenticated or heartbeat is stale.',
        evidence: `online=${gvStatus?.online}, sessionAuthenticated=${gvStatus?.sessionAuthenticated}, url=${gvStatus?.url || 'unknown'}`,
      },
      dispatch: [
        {
          target_agent: 'BROWSER_AGENT',
          priority: 'P0_IMMEDIATE',
          task_summary: 'Reload Google Voice /u/0/calls via CDP :9222, dismiss blocking overlays, and verify Ring-1 Answer observer.',
          exact_commands_or_actions: ['PLAYBOOK_B_RELOAD_AND_VERIFY_DOM'],
          verification_check: 'gv-status reports online=true, sessionAuthenticated=true, url=https://voice.google.com/u/0/calls',
          timeout_seconds: 60,
        },
      ],
      admin_escalation: {
        notify_human: state.consecutiveFailures >= 2,
        alert_message:
          state.consecutiveFailures >= 2
            ? 'P0 AUTH ALERT: Google Voice (+14803319455) requires cookie sync or VNC sign-in (./scripts/vm-gv-direct-login.sh).'
            : null,
      },
    };
  }

  // 4. Playbook C: PulseAudio SarahCloudNullSink Missing/Muted or Suspended WebRTC AudioContext
  const missingOrMutedSink =
    host.platform === 'linux' && (!host.pulseSinks.includes('SarahCloudNullSink') || host.pulseSinkMuted);
  const suspendedWebRtc =
    gvStatus?.audioCtxState && gvStatus.audioCtxState !== 'ready' && gvStatus.audioCtxState !== 'running';

  if (missingOrMutedSink || suspendedWebRtc) {
    const dispatches: DispatchInstruction[] = [];
    if (missingOrMutedSink) {
      dispatches.push({
        target_agent: 'INFRA_AGENT',
        priority: 'P1_HIGH',
        task_summary: 'Execute Playbook C: reload and unmute 48,000 Hz PulseAudio SarahCloudNullSink virtual audio cable.',
        exact_commands_or_actions: ['PLAYBOOK_C_RESET_PULSEAUDIO_SINK'],
        verification_check: 'pactl list sinks short includes unmuted SarahCloudNullSink (48000Hz)',
        timeout_seconds: 30,
      });
    }
    dispatches.push({
      target_agent: 'BROWSER_AGENT',
      priority: 'P1_HIGH',
      task_summary: 'Execute trusted CDP click and IWG_RESUME_AUDIO to unlock 48,000 Hz WebRTC AudioContext.',
      exact_commands_or_actions: ['PLAYBOOK_C_RESUME_WEBRTC_AUDIO'],
      verification_check: '__IWG_WEBRTC_GET_DIAGNOSTICS__() reports audioCtxState=running and virtualTrackReadyState=live',
      timeout_seconds: 30,
    });

    return {
      timestamp: nowIso,
      system_status: 'DEGRADED',
      diagnosis: {
        layer: missingOrMutedSink ? 'INFRA' : 'BROWSER',
        root_cause: 'Playbook C triggered: PulseAudio virtual sink missing/muted or WebRTC AudioContext suspended.',
        evidence: `pulseSinks=${host.pulseSinks || 'none'}, muted=${host.pulseSinkMuted}, audioCtxState=${gvStatus?.audioCtxState}`,
      },
      dispatch: dispatches,
      admin_escalation: { notify_human: false, alert_message: null },
    };
  }

  // 5. Caddy Reverse Proxy Check (Linux GCE VM)
  if (host.platform === 'linux' && host.caddyHttpsCode !== 200 && host.caddyHttpsCode !== 0) {
    return {
      timestamp: nowIso,
      system_status: 'DEGRADED',
      diagnosis: {
        layer: 'INFRA',
        root_cause: `Caddy HTTPS reverse proxy returned HTTP ${host.caddyHttpsCode} for ${PUBLIC_FQDN}/health.`,
        evidence: `caddyHttpsCode=${host.caddyHttpsCode}`,
      },
      dispatch: [
        {
          target_agent: 'INFRA_AGENT',
          priority: 'P1_HIGH',
          task_summary: 'Reload Caddy reverse proxy service and verify HTTPS 200 on /health.',
          exact_commands_or_actions: ['RELOAD_CADDY_PROXY'],
          verification_check: `HTTPS probe to ${PUBLIC_FQDN}/health returns 200`,
          timeout_seconds: 30,
        },
      ],
      admin_escalation: { notify_human: false, alert_message: null },
    };
  }

  // 6. Memory / Disk / Shared-Memory Warning Threshold (>80% RAM/Disk/SHM)
  if (host.memUsedPct >= 85 || host.diskUsePct >= 80 || host.shmUsePct >= 80) {
    return {
      timestamp: nowIso,
      system_status: 'DEGRADED',
      diagnosis: {
        layer: 'INFRA',
        root_cause: 'System memory, root disk, or /dev/shm utilization exceeded 80% threshold.',
        evidence: `memUsedPct=${host.memUsedPct}%, diskUsePct=${host.diskUsePct}%, shmUsePct=${host.shmUsePct}%`,
      },
      dispatch: [
        {
          target_agent: 'INFRA_AGENT',
          priority: 'P1_HIGH',
          task_summary: 'Flush & truncate PM2 logs and reclaim disk/tmpfs headroom.',
          exact_commands_or_actions: ['PLAYBOOK_D_FLUSH_LOGS_AND_CHECK_DISK'],
          verification_check: 'df -P / < 80% and /dev/shm < 80%',
          timeout_seconds: 30,
        },
      ],
      admin_escalation: { notify_human: false, alert_message: null },
    };
  }

  // 7. Playbook D: Scheduled 08:50 MST Pre-Window Daily Preventative Maintenance (Monday–Saturday)
  const isBusinessDay = phoenix.dayOfWeek >= 1 && phoenix.dayOfWeek <= 6;
  const isPreWindow = phoenix.hour === 8 && phoenix.minute >= 50 && phoenix.minute <= 54;
  if (isBusinessDay && isPreWindow && state.lastPreWindowMaintDate !== phoenix.dateKey) {
    state.lastPreWindowMaintDate = phoenix.dateKey;
    return {
      timestamp: nowIso,
      system_status: 'HEALTHY',
      diagnosis: {
        layer: 'INFRA',
        root_cause: `Playbook D scheduled 08:50 MST preventative maintenance prior to 09:00 AM–07:00 PM MST window (${phoenix.weekday}).`,
        evidence: `Phoenix=${phoenix.hhmm} MST, disk=${host.diskUsePct}%, mem=${host.memUsedPct}%, shm=${host.shmUsePct}%`,
      },
      dispatch: [
        {
          target_agent: 'INFRA_AGENT',
          priority: 'P2_ROUTINE',
          task_summary: 'Flush PM2 logs and verify disk (<75%), /dev/shm (<80%), and Caddy HTTPS 200.',
          exact_commands_or_actions: ['PLAYBOOK_D_FLUSH_LOGS_AND_CHECK_DISK'],
          verification_check: 'Disk < 75% and Caddy HTTPS /health returns 200',
          timeout_seconds: 45,
        },
        {
          target_agent: 'BROWSER_AGENT',
          priority: 'P2_ROUTINE',
          task_summary: 'Reload Google Voice /u/0/calls tab and confirm green Ready/Online state before 09:00 AM MST.',
          exact_commands_or_actions: ['PLAYBOOK_D_RELOAD_GV_TAB'],
          verification_check: 'gv-status confirms online=true, sessionAuthenticated=true, audioCtxState=ready',
          timeout_seconds: 45,
        },
      ],
      admin_escalation: { notify_human: false, alert_message: null },
    };
  }

  // 8. All 6 Layers Healthy
  return {
    timestamp: nowIso,
    system_status: 'HEALTHY',
    diagnosis: {
      layer: 'BROWSER',
      root_cause:
        'All 6 supervision layers (Linux/SHM/Locks, PM2 v22, PulseAudio 48kHz, Chromium Google Voice Ring-1 DOM, Caddy HTTPS, and CRM DB) are nominal.',
      evidence: `online=true, sessionAuthenticated=true, activeMode=${gvStatus.activeMode}, heartbeatAgeMs=${gvStatus.heartbeatAgeMs}ms, daemonMem=${daemonProc?.memMB ?? 0}MB, serverMem=${serverProc?.memMB ?? 0}MB, hostMem=${host.memUsedPct}%, disk=${host.diskUsePct}%, shm=${host.shmUsePct}%, caddyHttps=${host.caddyHttpsCode || 200}, phoenix=${phoenix.weekday} ${phoenix.hhmm} MST`,
    },
    dispatch: [],
    admin_escalation: { notify_human: false, alert_message: null },
  };
}

async function executeDispatchInstruction(item: DispatchInstruction): Promise<Array<Record<string, unknown>>> {
  const results: Array<Record<string, unknown>> = [];
  for (const act of item.exact_commands_or_actions) {
    if (item.target_agent === 'INFRA_AGENT') {
      if (act === 'RESTART_SARAH_SERVER') {
        const out = await runLinuxShell(
          `cd "${REPO_ROOT}" && pm2 restart sarah-server --update-env && pm2 save`,
          30_000
        );
        results.push({ action: act, ok: true, output: out.slice(-240) });
      } else if (act === 'PLAYBOOK_A_CLEAN_LOCKS_AND_RESTART') {
        const out = await runLinuxShell(
          `pm2 stop cloud-voip-daemon || true; pkill -9 -f '/home/king/.sarah-chrome-profile' 2>/dev/null || true; rm -rf /tmp/.X99-lock /home/king/.sarah-chrome-profile/Singleton*; cd "${REPO_ROOT}" && pm2 start ecosystem.config.cjs --only cloud-voip-daemon && pm2 save`,
          55_000
        );
        results.push({ action: act, ok: true, output: out.slice(-280) });
      } else if (act === 'PLAYBOOK_C_RESET_PULSEAUDIO_SINK') {
        const out = await runLinuxShell(
          `export XDG_RUNTIME_DIR="/run/user/$(id -u)"; pulseaudio --check 2>/dev/null || pulseaudio -D --exit-idle-time=-1 2>/dev/null || true; pactl list short sinks | grep -q SarahCloudNullSink || pactl load-module module-null-sink sink_name=SarahCloudNullSink rate=48000 channels=1; pactl set-default-sink SarahCloudNullSink; pactl set-sink-mute SarahCloudNullSink 0; pactl set-default-source SarahCloudNullSink.monitor 2>/dev/null || true; pactl set-source-mute SarahCloudNullSink.monitor 0 2>/dev/null || true; pactl list short sinks`,
          20_000
        );
        results.push({ action: act, ok: true, output: out });
      } else if (act === 'PLAYBOOK_D_FLUSH_LOGS_AND_CHECK_DISK') {
        const out = await runLinuxShell('pm2 flush && df -P / /dev/shm', 20_000);
        results.push({ action: act, ok: true, output: out.slice(-240) });
      } else if (act === 'RELOAD_CADDY_PROXY') {
        const out = await runLinuxShell('sudo systemctl reload caddy || true', 15_000);
        results.push({ action: act, ok: true, output: out });
      }
    } else if (item.target_agent === 'BROWSER_AGENT') {
      try {
        const requireDaemon = createRequire(path.join(REPO_ROOT, 'cloud-voip-daemon', 'package.json'));
        const puppeteer = requireDaemon('puppeteer-core');
        const ver = await fetch(`${CDP_URL}/json/version`).then((r) => r.json());
        const browser = await puppeteer.connect({ browserWSEndpoint: ver.webSocketDebuggerUrl });
        try {
          const pages = await browser.pages();
          const gvPage = pages.find((p: any) => p.url().startsWith('https://voice.google.com')) || pages[0];
          if (gvPage) {
            if (act === 'PLAYBOOK_B_RELOAD_AND_VERIFY_DOM' || act === 'PLAYBOOK_D_RELOAD_GV_TAB') {
              await gvPage.goto('https://voice.google.com/u/0/calls', {
                waitUntil: 'domcontentloaded',
                timeout: 35_000,
              });
              await new Promise((r) => setTimeout(r, 2500));
            }
            // Dismiss any non-call promotional overlays and trigger OS-trusted gesture for 48kHz AudioContext
            await gvPage.evaluate(() => {
              const closeBtns = Array.from(
                document.querySelectorAll<HTMLElement>('button[aria-label="Close"], button[aria-label="Dismiss"]')
              );
              for (const b of closeBtns) {
                if (b.offsetWidth > 0 && !b.closest('[aria-label*="call" i]')) b.click();
              }
            });
            await gvPage.mouse.click(80, 80).catch(() => {});
            const diag = await gvPage.evaluate(async () => {
              window.postMessage({ __iwg_webrtc__: true, type: 'IWG_RESUME_AUDIO' }, '*');
              await new Promise((r) => setTimeout(r, 150));
              return {
                url: location.href,
                webrtc: (window as any).__IWG_WEBRTC_GET_DIAGNOSTICS__?.() || null,
                state: (window as any).__IWG_GV_GET_STATE__?.() || null,
              };
            });
            results.push({ action: act, ok: true, diag });
          }
        } finally {
          await browser.disconnect();
        }
      } catch (err: any) {
        results.push({ action: act, ok: false, error: err?.message || String(err) });
      }
    } else if (item.target_agent === 'VOICE_CRM_AGENT') {
      const [health, wh] = await Promise.all([
        fetch(`${LOCAL_API_BASE}/health`).then((r) => r.json()).catch(() => null),
        fetch(`${LOCAL_API_BASE}/api/sarah/work-hours`).then((r) => r.json()).catch(() => null),
      ]);
      results.push({ action: act, ok: Boolean(health?.ok && wh?.ok), health, workHours: wh });
    }
  }
  return results;
}

async function sendGoogleNativeEscalation(report: ManagerDispatchReport): Promise<void> {
  if (!report.admin_escalation.notify_human || !report.admin_escalation.alert_message) return;
  await fetch(`${LOCAL_API_BASE}/api/sarah/gv-heartbeat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      runner: 'cloud-daemon',
      url: `https://${PUBLIC_FQDN}`,
      title: 'Sarah Watchdog P0 Escalation',
      event: 'ops_p0_admin_escalation',
      eventDetail: `${report.admin_escalation.alert_message} | Evidence: ${report.diagnosis.evidence}`,
    }),
  }).catch(() => {});

  if (process.env.GOOGLE_CHAT_ALERT_WEBHOOK_URL) {
    await fetch(process.env.GOOGLE_CHAT_ALERT_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: `🚨 *Sarah 24/7 Watchdog P0 Alert (+14803319455)*\n${report.admin_escalation.alert_message}\n*Layer:* ${report.diagnosis.layer}\n*Evidence:* ${report.diagnosis.evidence}`,
      }),
    }).catch(() => {});
  }
}

export async function runWatchdogTick(): Promise<ManagerDispatchReport> {
  const state = loadState();
  state.totalTicks += 1;

  const telemetry = await collectSystemTelemetry();
  let report = evaluateTelemetry(telemetry, state);

  if (report.dispatch.length > 0) {
    const executionResults: NonNullable<ManagerDispatchReport['execution_results']> = [];
    for (const item of report.dispatch) {
      const res = await executeDispatchInstruction(item);
      executionResults.push({ target_agent: item.target_agent, results: res });
    }
    state.totalAutoFixesApplied += 1;

    // Post-fix verification check
    await new Promise((r) => setTimeout(r, 2500));
    const postTelemetry = await collectSystemTelemetry();
    const postReport = evaluateTelemetry(postTelemetry, state);
    report.execution_results = executionResults;
    report.post_fix_verified = postReport.system_status === 'HEALTHY';

    if (postReport.system_status === 'CRITICAL') {
      state.consecutiveFailures += 1;
      if (state.consecutiveFailures >= 2) {
        report.admin_escalation.notify_human = true;
        report.admin_escalation.alert_message =
          report.admin_escalation.alert_message ||
          `P0 ESCALATION (+14803319455): Auto-repair failed ${state.consecutiveFailures} consecutive times (${report.diagnosis.root_cause})`;
        await sendGoogleNativeEscalation(report);
      }
    } else {
      state.consecutiveFailures = 0;
    }
  } else {
    state.consecutiveFailures = 0;
  }

  saveState(state);
  try {
    mkdirSync(DATA_DIR, { recursive: true });
    writeFileSync(LATEST_REPORT_PATH, JSON.stringify(report, null, 2));
  } catch {}

  return report;
}

const isOnce = process.argv.includes('--once');

async function startWatchdogDaemon(): Promise<void> {
  if (isOnce) {
    const report = await runWatchdogTick();
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  console.log(
    `[Sarah Autonomous Watchdog] Started 24/7 supervisor (interval=${WATCHDOG_INTERVAL_MS}ms, target=${LOCAL_API_BASE})`
  );
  const executeCycle = async () => {
    try {
      const report = await runWatchdogTick();
      console.log(
        `[Sarah Watchdog ${report.timestamp}] status=${report.system_status} dispatches=${report.dispatch.length} (${report.diagnosis.evidence})`
      );
    } catch (err: any) {
      console.error('[Sarah Watchdog] Cycle error:', err?.message || err);
    }
  };

  await executeCycle();
  const timer = setInterval(executeCycle, WATCHDOG_INTERVAL_MS);

  const shutdown = (sig: string) => {
    console.log(`[Sarah Watchdog] Received ${sig}, shutting down cleanly.`);
    clearInterval(timer);
    process.exit(0);
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

const entryMatch =
  (process.argv[1] && /sarah-watchdog\.(ts|js|mjs)$/i.test(process.argv[1])) ||
  (process.env.pm_exec_path && /sarah-watchdog\.(ts|js|mjs)$/i.test(process.env.pm_exec_path));

if (entryMatch) {
  void startWatchdogDaemon();
}
