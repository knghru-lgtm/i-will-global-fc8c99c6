#!/usr/bin/env node
/**
 * Sarah 24/7 AI Receptionist — Lead Systems Operations & Maintenance Manager (60s Supervisor)
 * 100% Google Cloud + Google Voice (+14803319455) + Google GenAI (@google/genai)
 *
 * Modes:
 *   node ./scripts/sarah-ops-supervisor.mjs --once             # Collect live telemetry & output strict JSON dispatch
 *   node ./scripts/sarah-ops-supervisor.mjs --once --execute   # Collect, auto-remediate via Sub-Agents, & verify
 *   node ./scripts/sarah-ops-supervisor.mjs --loop --execute   # Run every 60 seconds continuously
 */
import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import {
  ORCHESTRATOR_SYSTEM_PROMPT,
  SUBAGENT_PROMPTS,
  executeSubAgentDispatch,
  dispatchGoogleNativeAdminAlert,
} from './sarah-ops-subagents.mjs';

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const DATA_DIR = path.join(REPO_ROOT, 'server', 'data');
const STATE_PATH = path.join(DATA_DIR, 'ops-supervisor-state.json');
const LATEST_REPORT_PATH = path.join(DATA_DIR, 'ops-supervisor-latest.json');

const API_BASE = process.env.LOCAL_API_URL || 'http://127.0.0.1:4000';
const CDP_URL = process.env.CDP_URL || 'http://127.0.0.1:9222';
const INTERVAL_MS = Number(process.env.OPS_INTERVAL_MS || 60_000);

function readTailLines(filePath, maxLines = 30) {
  try {
    if (!existsSync(filePath)) return [];
    const lines = readFileSync(filePath, 'utf8').split(/\r?\n/).filter(Boolean);
    return lines.slice(-maxLines);
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
  const dayMap = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return {
    dateKey: `${map.year}-${map.month}-${map.day}`,
    weekday: map.weekday,
    dayOfWeek: dayMap[map.weekday] ?? -1,
    hour,
    minute,
    hhmm: `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`,
  };
}

async function runShellSafe(cmd) {
  if (process.platform === 'win32') return '';
  try {
    const { stdout } = await execFileAsync('/bin/sh', ['-c', cmd], { timeout: 8000 });
    return String(stdout || '').trim();
  } catch {
    return '';
  }
}

export async function collectSystemTelemetry() {
  const home = os.homedir();
  const pm2Raw = await runShellSafe('pm2 jlist');
  let pm2Processes = [];
  try {
    const parsed = JSON.parse(pm2Raw || '[]');
    pm2Processes = parsed.map((p) => ({
      name: p.name,
      status: p.pm2_env?.status || 'unknown',
      restarts: p.pm2_env?.restart_time || 0,
      uptimeMs: p.pm2_env?.pm_uptime ? Date.now() - p.pm2_env.pm_uptime : 0,
      memMB: Math.round((p.monit?.memory || 0) / 1048576),
      cpuPct: p.monit?.cpu || 0,
    }));
  } catch {}

  const [healthRes, gvStatus, dfOut, pulseOut] = await Promise.all([
    fetch(`${API_BASE}/health`)
      .then(async (r) => ({ status: r.status, body: await r.json().catch(() => null) }))
      .catch((e) => ({ status: 0, error: e?.message || 'unreachable' })),
    fetch(`${API_BASE}/api/sarah/gv-status`)
      .then((r) => r.json())
      .catch(() => null),
    runShellSafe('df -P / | tail -1'),
    runShellSafe('pactl list sinks short 2>/dev/null || true'),
  ]);

  let diskUsePct = 0;
  if (dfOut) {
    const m = dfOut.match(/(\d+)%/);
    if (m) diskUsePct = Number(m[1]);
  }

  const totalMemMB = Math.round(os.totalmem() / 1048576);
  const freeMemMB = Math.round(os.freemem() / 1048576);
  const memUsedPct = totalMemMB > 0 ? Math.round(((totalMemMB - freeMemMB) / totalMemMB) * 100) : 0;

  const daemonErrLines = readTailLines(path.join(home, '.pm2', 'logs', 'cloud-voip-daemon-error.log'), 30);
  const serverErrLines = readTailLines(path.join(home, '.pm2', 'logs', 'sarah-server-error.log'), 30);

  return {
    collectedAt: new Date().toISOString(),
    phoenix: getPhoenixClock(),
    host: {
      hostname: os.hostname(),
      platform: process.platform,
      totalMemMB,
      freeMemMB,
      memUsedPct,
      diskUsePct,
      pulseSinks: pulseOut,
    },
    pm2: pm2Processes,
    health: healthRes,
    gvStatus,
    errorLogs: {
      cloudVoipDaemon: daemonErrLines,
      sarahServer: serverErrLines,
    },
  };
}

function loadSupervisorState() {
  try {
    if (existsSync(STATE_PATH)) {
      return JSON.parse(readFileSync(STATE_PATH, 'utf8'));
    }
  } catch {}
  return { consecutiveFailures: 0, lastPreWindowMaintDate: '' };
}

function saveSupervisorState(st) {
  try {
    mkdirSync(DATA_DIR, { recursive: true });
    writeFileSync(STATE_PATH, JSON.stringify(st, null, 2));
  } catch {}
}

export function evaluateTelemetryToDispatch(telemetry, supervisorState) {
  const nowIso = new Date().toISOString();
  const { phoenix, host, pm2, health, gvStatus, errorLogs } = telemetry;
  const daemonProc = pm2.find((p) => p.name === 'cloud-voip-daemon');
  const serverProc = pm2.find((p) => p.name === 'sarah-server');
  const joinedDaemonErr = (errorLogs.cloudVoipDaemon || []).join('\n');

  // 1. CRITICAL: Backend API (:4000) down or PM2 sarah-server stopped/errored
  if (health.status !== 200 || !health.body?.ok || (serverProc && serverProc.status !== 'online')) {
    return {
      timestamp: nowIso,
      system_status: 'CRITICAL',
      diagnosis: {
        layer: 'VOICE_CRM',
        root_cause: 'Backend API server (sarah-server on :4000) failed HTTP 200 health probe or PM2 process is not online.',
        evidence: `HTTP status=${health.status}, pm2Status=${serverProc?.status || 'missing'}`,
      },
      dispatch: [
        {
          target_agent: 'INFRA_AGENT',
          priority: 'P0_IMMEDIATE',
          task_summary: 'Restart sarah-server under PM2 and verify /health returns HTTP 200.',
          exact_commands_or_actions: ['RESTART_SARAH_SERVER'],
          verification_check: 'curl -fsS http://127.0.0.1:4000/health returns {"ok":true}',
          timeout_seconds: 45,
        },
      ],
      admin_escalation: {
        notify_human: supervisorState.consecutiveFailures >= 2,
        alert_message:
          supervisorState.consecutiveFailures >= 2
            ? 'P0 CRITICAL: sarah-server (:4000) failed 2 consecutive auto-restarts on voice.iwillglobal.com.'
            : null,
      },
    };
  }

  // 2. Playbook A: Orphaned Chromium / Xvfb Lock or stopped cloud-voip-daemon
  const hasLockFault = /SingletonLock|XServer already running|Failed to create SingletonProcess/i.test(joinedDaemonErr);
  if ((daemonProc && daemonProc.status !== 'online') || hasLockFault) {
    return {
      timestamp: nowIso,
      system_status: 'CRITICAL',
      diagnosis: {
        layer: 'INFRA',
        root_cause: 'Playbook A triggered: cloud-voip-daemon stopped or blocked by orphaned SingletonLock / Xvfb :99 lock.',
        evidence: hasLockFault
          ? joinedDaemonErr.split('\n').slice(-2).join(' | ')
          : `cloud-voip-daemon status=${daemonProc?.status}`,
      },
      dispatch: [
        {
          target_agent: 'INFRA_AGENT',
          priority: 'P0_IMMEDIATE',
          task_summary: 'Execute Playbook A: clear X99 & Chromium Singleton locks, reap zombie Chrome processes, and restart cloud-voip-daemon.',
          exact_commands_or_actions: [
            'PLAYBOOK_A: pm2 stop cloud-voip-daemon && rm -rf /tmp/.X99-lock /home/king/.sarah-chrome-profile/Singleton* && pm2 start ecosystem.config.cjs --only cloud-voip-daemon',
          ],
          verification_check: 'curl -fsS http://127.0.0.1:4000/api/sarah/gv-status confirms cloudDaemonOnline=true',
          timeout_seconds: 60,
        },
      ],
      admin_escalation: {
        notify_human: supervisorState.consecutiveFailures >= 2,
        alert_message:
          supervisorState.consecutiveFailures >= 2
            ? 'P0 CRITICAL: cloud-voip-daemon failed Playbook A lock recovery twice on +14803319455.'
            : null,
      },
    };
  }

  // 3. Playbook B: Google Voice Logged Out / DOM Unauthenticated
  if (!gvStatus?.online || !gvStatus?.cloudDaemonOnline || !gvStatus?.sessionAuthenticated) {
    const needsHumanLogin = supervisorState.consecutiveFailures >= 2;
    return {
      timestamp: nowIso,
      system_status: 'CRITICAL',
      diagnosis: {
        layer: 'BROWSER',
        root_cause: 'Playbook B triggered: Google Voice (+14803319455) session is unauthenticated or heartbeat is stale.',
        evidence: `online=${gvStatus?.online}, sessionAuthenticated=${gvStatus?.sessionAuthenticated}, url=${gvStatus?.url || 'unknown'}`,
      },
      dispatch: [
        {
          target_agent: 'BROWSER_AGENT',
          priority: 'P0_IMMEDIATE',
          task_summary: 'Reload Google Voice /u/0/calls tab via CDP :9222, verify Workspace cookie auth, and confirm Ring-1 DOM observer.',
          exact_commands_or_actions: [
            'RELOAD_GV_CALLS_TAB',
            'VERIFY_GV_READY_DOM_AND_FALLBACK_SELECTOR ([aria-label*="Answer"])',
          ],
          verification_check: 'gv-status reports online=true, sessionAuthenticated=true, url=https://voice.google.com/u/0/calls',
          timeout_seconds: 60,
        },
      ],
      admin_escalation: {
        notify_human: needsHumanLogin,
        alert_message: needsHumanLogin
          ? 'P0 AUTH ALERT: Google Voice (+14803319455) requires fresh cookie sync or one-time VNC login (./scripts/vm-gv-direct-login.sh).'
          : null,
      },
    };
  }

  // 4. Playbook C: Dead Air / PulseAudio SarahCloudNullSink Missing or Suspended AudioContext
  const missingNullSink = host.platform === 'linux' && host.pulseSinks && !host.pulseSinks.includes('SarahCloudNullSink');
  const suspendedWebRtc = gvStatus?.audioCtxState && gvStatus.audioCtxState !== 'ready' && gvStatus.audioCtxState !== 'running';
  if (missingNullSink || suspendedWebRtc) {
    return {
      timestamp: nowIso,
      system_status: 'DEGRADED',
      diagnosis: {
        layer: missingNullSink ? 'INFRA' : 'BROWSER',
        root_cause: 'Playbook C triggered: Virtual audio sink SarahCloudNullSink missing or 48kHz WebRTC AudioContext suspended.',
        evidence: `pulseSinks=${host.pulseSinks || 'empty'}, audioCtxState=${gvStatus?.audioCtxState}`,
      },
      dispatch: [
        ...(missingNullSink
          ? [
              {
                target_agent: 'INFRA_AGENT',
                priority: 'P1_HIGH',
                task_summary: 'Execute Playbook C: reload 48kHz PulseAudio SarahCloudNullSink virtual audio cable.',
                exact_commands_or_actions: ['PLAYBOOK_C: pactl load-module module-null-sink sink_name=SarahCloudNullSink rate=48000 channels=1'],
                verification_check: 'pactl list sinks short includes SarahCloudNullSink',
                timeout_seconds: 30,
              },
            ]
          : []),
        {
          target_agent: 'BROWSER_AGENT',
          priority: 'P1_HIGH',
          task_summary: 'Resume 48,000 Hz WebRTC AudioContext and verify live virtual mic track.',
          exact_commands_or_actions: ['PLAYBOOK_C_RESUME_WEBRTC_AUDIO'],
          verification_check: '__IWG_WEBRTC_GET_DIAGNOSTICS__() reports audioCtxState=running and virtualTrackReadyState=live',
          timeout_seconds: 30,
        },
      ],
      admin_escalation: {
        notify_human: false,
        alert_message: null,
      },
    };
  }

  // 5. Playbook D: Pre-Window Daily Preventative Maintenance (08:50 MST, Monday–Saturday)
  const isBusinessDay = phoenix.dayOfWeek >= 1 && phoenix.dayOfWeek <= 6;
  const isPreWindowTime = phoenix.hour === 8 && phoenix.minute >= 50 && phoenix.minute <= 54;
  if (isBusinessDay && isPreWindowTime && supervisorState.lastPreWindowMaintDate !== phoenix.dateKey) {
    supervisorState.lastPreWindowMaintDate = phoenix.dateKey;
    return {
      timestamp: nowIso,
      system_status: 'HEALTHY',
      diagnosis: {
        layer: 'INFRA',
        root_cause: `Playbook D scheduled 08:50 MST preventative maintenance prior to 09:00 AM–07:00 PM Arizona business window (${phoenix.weekday}).`,
        evidence: `Phoenix clock=${phoenix.hhmm} MST, disk=${host.diskUsePct}%, mem=${host.memUsedPct}%`,
      },
      dispatch: [
        {
          target_agent: 'INFRA_AGENT',
          priority: 'P2_ROUTINE',
          task_summary: 'Flush PM2 logs and verify root disk usage is below 75%.',
          exact_commands_or_actions: ['PLAYBOOK_D: pm2 flush && df -P /'],
          verification_check: 'Root filesystem usage < 75% and /health returns HTTP 200',
          timeout_seconds: 45,
        },
        {
          target_agent: 'BROWSER_AGENT',
          priority: 'P2_ROUTINE',
          task_summary: 'Reload Google Voice /u/0/calls tab and confirm green Ready/Online WebRTC state before 09:00 AM MST.',
          exact_commands_or_actions: ['RELOAD_GV_CALLS_TAB'],
          verification_check: 'gv-status confirms online=true, sessionAuthenticated=true, audioCtxState=ready',
          timeout_seconds: 45,
        },
      ],
      admin_escalation: {
        notify_human: false,
        alert_message: null,
      },
    };
  }

  // 6. Resource Warning Check (Memory > 85% or Disk > 75%)
  if (host.diskUsePct >= 75 || host.memUsedPct >= 88) {
    return {
      timestamp: nowIso,
      system_status: 'DEGRADED',
      diagnosis: {
        layer: 'INFRA',
        root_cause: 'Host memory or disk utilization exceeded warning threshold.',
        evidence: `memUsedPct=${host.memUsedPct}%, diskUsePct=${host.diskUsePct}%`,
      },
      dispatch: [
        {
          target_agent: 'INFRA_AGENT',
          priority: 'P1_HIGH',
          task_summary: 'Flush PM2 logs to reclaim disk space and verify memory headroom.',
          exact_commands_or_actions: ['PLAYBOOK_D: pm2 flush && df -P /'],
          verification_check: 'df -P / < 75% and free memory available',
          timeout_seconds: 30,
        },
      ],
      admin_escalation: {
        notify_human: false,
        alert_message: null,
      },
    };
  }

  // 7. All Systems Nominal (HEALTHY)
  return {
    timestamp: nowIso,
    system_status: 'HEALTHY',
    diagnosis: {
      layer: 'BROWSER',
      root_cause: 'All 4 supervision layers (OS/PM2, Chromium Google Voice Ring-1 DOM + 48kHz WebRTC, Gemini/Neural Voice API, and CRM DB) are nominal.',
      evidence: `online=true, sessionAuthenticated=true, activeMode=${gvStatus.activeMode}, heartbeatAgeMs=${gvStatus.heartbeatAgeMs}ms, daemonMem=${daemonProc?.memMB ?? 'n/a'}MB, serverMem=${serverProc?.memMB ?? 'n/a'}MB, disk=${host.diskUsePct}%, phoenixTime=${phoenix.weekday} ${phoenix.hhmm} MST`,
    },
    dispatch: [],
    admin_escalation: {
      notify_human: false,
      alert_message: null,
    },
  };
}

export async function runSupervisorTick({ execute = false } = {}) {
  const supervisorState = loadSupervisorState();
  const telemetry = await collectSystemTelemetry();
  const report = evaluateTelemetryToDispatch(telemetry, supervisorState);

  if (report.system_status === 'CRITICAL') {
    supervisorState.consecutiveFailures += 1;
    if (supervisorState.consecutiveFailures >= 2 && !report.admin_escalation.notify_human) {
      report.admin_escalation.notify_human = true;
      report.admin_escalation.alert_message = `P0 ESCALATION (+14803319455): ${report.diagnosis.root_cause}`;
    }
  } else {
    supervisorState.consecutiveFailures = 0;
  }

  if (execute && report.dispatch.length > 0) {
    const executionResults = [];
    for (const item of report.dispatch) {
      const res = await executeSubAgentDispatch(item, { apiBase: API_BASE, cdpUrl: CDP_URL, repoDir: REPO_ROOT });
      executionResults.push({ target_agent: item.target_agent, results: res });
    }
    report.execution_results = executionResults;
  }

  if (report.admin_escalation.notify_human && report.admin_escalation.alert_message) {
    await dispatchGoogleNativeAdminAlert({
      apiBase: API_BASE,
      alertMessage: report.admin_escalation.alert_message,
      diagnosis: report.diagnosis,
    });
  }

  saveSupervisorState(supervisorState);
  try {
    mkdirSync(DATA_DIR, { recursive: true });
    writeFileSync(LATEST_REPORT_PATH, JSON.stringify(report, null, 2));
  } catch {}

  return { report, prompts: { orchestrator: ORCHESTRATOR_SYSTEM_PROMPT, subagents: SUBAGENT_PROMPTS } };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const execute = process.argv.includes('--execute');
  const loop = process.argv.includes('--loop');

  const tick = async () => {
    const { report } = await runSupervisorTick({ execute });
    console.log(JSON.stringify(report, null, 2));
  };

  await tick();
  if (loop) {
    setInterval(() => {
      tick().catch((err) => console.error('[Sarah Ops Supervisor] Tick error:', err?.message || err));
    }, INTERVAL_MS);
  }
}
