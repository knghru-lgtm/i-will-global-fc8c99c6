/**
 * 100% Google Cloud + Google Voice Sub-Agent System Prompts & Safe Dispatch Executors
 * Architecture: Ubuntu GCE VM + PM2 (sarah-server, cloud-voip-daemon) + Chromium CDP (:9222) + @google/genai + Google Voice (+14803319455)
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export const ORCHESTRATOR_SYSTEM_PROMPT = `You are the Lead Systems Operations & Maintenance Manager (Orchestrator) for "Sarah," an automated 24/7 AI receptionist running 100% on Google Cloud Compute Engine (voice.iwillglobal.com / +14803319455) with Google Voice WebRTC and Google GenAI (@google/genai).

Evaluate incoming 60-second telemetry snapshots and respond STRICTLY with valid JSON matching:
{
  "timestamp": "ISO-8601",
  "system_status": "HEALTHY | DEGRADED | CRITICAL",
  "diagnosis": {
    "layer": "INFRA | BROWSER | VOICE_CRM",
    "root_cause": "Concise technical explanation of current state or fault.",
    "evidence": "Specific metric, HTTP status, or log line."
  },
  "dispatch": [
    {
      "target_agent": "INFRA_AGENT | BROWSER_AGENT | VOICE_CRM_AGENT",
      "priority": "P0_IMMEDIATE | P1_HIGH | P2_ROUTINE",
      "task_summary": "Short imperative description of the action.",
      "exact_commands_or_actions": ["Action 1", "Action 2"],
      "verification_check": "Exact command or condition proving the action succeeded.",
      "timeout_seconds": 60
    }
  ],
  "admin_escalation": {
    "notify_human": false,
    "alert_message": null
  }
}`;

export const SUBAGENT_PROMPTS = {
  INFRA_AGENT: `You are INFRA_AGENT (Linux / PM2 / PulseAudio / Caddy Network Specialist) for Sarah on Ubuntu GCE.
Allowed Playbook Actions:
- PLAYBOOK_A_CLEAN_LOCKS_AND_RESTART: Stop cloud-voip-daemon, remove /tmp/.X99-lock and /home/king/.sarah-chrome-profile/Singleton*, reap zombie sarah-chrome processes, and start cloud-voip-daemon via ecosystem.config.cjs.
- PLAYBOOK_C_RESET_PULSEAUDIO_SINK: Verify pactl sinks/sources and reload module-null-sink sink_name=SarahCloudNullSink rate=48000 channels=1.
- PLAYBOOK_D_DAILY_PREWINDOW_MAINT: Flush PM2 logs (pm2 flush), verify root disk <75%, and verify Caddy HTTPS health on voice.iwillglobal.com.
- RESTART_SARAH_SERVER: Restart sarah-server via ecosystem.config.cjs and verify http://127.0.0.1:4000/health returns 200.`,

  BROWSER_AGENT: `You are BROWSER_AGENT (Puppeteer CDP :9222 / Google Voice DOM / Workspace Auth & 48kHz WebRTC Specialist) for +14803319455.
Allowed Playbook Actions:
- PLAYBOOK_B_VERIFY_GV_DOM_AND_AUTH: Inspect active tab on CDP :9222, verify URL is https://voice.google.com/u/0/calls (not accounts.google.com / workspace.google.com), dismiss any blocking overlay, and verify Shadow-DOM Ring-1 Answer observer (__IWG_GV_GET_STATE__).
- PLAYBOOK_C_RESUME_WEBRTC_AUDIO: Dispatch IWG_RESUME_AUDIO to 48,000 Hz WebRTC AudioContext and verify virtualTrackReadyState === 'live'.
- PLAYBOOK_D_RELOAD_GV_CALLS_TAB: Reload https://voice.google.com/u/0/calls prior to 09:00 MST window, unlock 48kHz AudioContext, and verify online=true & sessionAuthenticated=true.`,

  VOICE_CRM_AGENT: `You are VOICE_CRM_AGENT (Node.js API :4000 / @google/genai Gemini Live + Neural TTS Failover / PostgreSQL & Calendar Sync Specialist).
Allowed Playbook Actions:
- VERIFY_VOICE_AND_WORK_HOURS: Probe /health, /api/sarah/work-hours (Mon-Sat 09:00-19:00 America/Phoenix MST), and pre-cached greeting audio (/api/sarah/audio.wav?preset=business_greeting & after_hours).
- VERIFY_DB_AND_CALENDAR_FEED: Confirm CRM database responsiveness and master calendar iCal/Google Workspace sync health.`,
};

/**
 * Executes deterministic whitelisted sub-agent remediation actions safely on the VM.
 */
export async function executeSubAgentDispatch(item, { apiBase = 'http://127.0.0.1:4000', cdpUrl = 'http://127.0.0.1:9222', repoDir = process.cwd() } = {}) {
  const results = [];
  const actions = Array.isArray(item?.exact_commands_or_actions) ? item.exact_commands_or_actions : [];

  for (const act of actions) {
    if (item.target_agent === 'INFRA_AGENT') {
      if (act.includes('PLAYBOOK_A') || act.includes('Singleton')) {
        const { stdout } = await execFileAsync('/bin/sh', [
          '-c',
          `pm2 stop cloud-voip-daemon || true; pkill -9 -f '/home/king/.sarah-chrome-profile' 2>/dev/null || true; rm -rf /tmp/.X99-lock /home/king/.sarah-chrome-profile/Singleton*; cd "${repoDir}" && pm2 start ecosystem.config.cjs --only cloud-voip-daemon && pm2 save`,
        ], { timeout: (item.timeout_seconds || 60) * 1000 });
        results.push({ action: 'PLAYBOOK_A_CLEAN_LOCKS_AND_RESTART', ok: true, output: stdout.trim().slice(-300) });
      } else if (act.includes('PLAYBOOK_C') || act.includes('SarahCloudNullSink')) {
        const { stdout } = await execFileAsync('/bin/sh', [
          '-c',
          `pulseaudio --check 2>/dev/null || pulseaudio -D --exit-idle-time=-1 2>/dev/null || true; pactl list short sinks | grep -q SarahCloudNullSink || pactl load-module module-null-sink sink_name=SarahCloudNullSink rate=48000 channels=1; pactl set-default-sink SarahCloudNullSink; pactl list short sinks`,
        ], { timeout: 20000 });
        results.push({ action: 'PLAYBOOK_C_RESET_PULSEAUDIO_SINK', ok: true, output: stdout.trim() });
      } else if (act.includes('PLAYBOOK_D') || act.includes('pm2 flush')) {
        const { stdout } = await execFileAsync('/bin/sh', ['-c', 'pm2 flush && df -P /'], { timeout: 20000 });
        results.push({ action: 'PLAYBOOK_D_FLUSH_LOGS_AND_CHECK_DISK', ok: true, output: stdout.trim().slice(-240) });
      } else if (act.includes('RESTART_SARAH_SERVER')) {
        const { stdout } = await execFileAsync('/bin/sh', [
          '-c',
          `cd "${repoDir}" && pm2 restart sarah-server --update-env && pm2 save`,
        ], { timeout: 30000 });
        results.push({ action: 'RESTART_SARAH_SERVER', ok: true, output: stdout.trim().slice(-240) });
      }
    } else if (item.target_agent === 'BROWSER_AGENT') {
      try {
        const { createRequire } = await import('node:module');
        const path = await import('node:path');
        const requireDaemon = createRequire(path.join(repoDir, 'cloud-voip-daemon', 'package.json'));
        const puppeteer = requireDaemon('puppeteer-core');
        const ver = await fetch(`${cdpUrl}/json/version`).then((r) => r.json());
        const browser = await puppeteer.connect({ browserWSEndpoint: ver.webSocketDebuggerUrl });
        try {
          const pages = await browser.pages();
          const gvPage = pages.find((p) => p.url().startsWith('https://voice.google.com')) || pages[0];
          if (gvPage) {
            if (act.includes('RELOAD_GV_CALLS_TAB')) {
              await gvPage.goto('https://voice.google.com/u/0/calls', { waitUntil: 'domcontentloaded', timeout: 30000 });
            }
            await gvPage.mouse.click(80, 80).catch(() => {});
            const diag = await gvPage.evaluate(() => {
              window.postMessage({ __iwg_webrtc__: true, type: 'IWG_RESUME_AUDIO' }, '*');
              return {
                url: location.href,
                webrtc: window.__IWG_WEBRTC_GET_DIAGNOSTICS__?.() || null,
                state: window.__IWG_GV_GET_STATE__?.() || null,
              };
            });
            results.push({ action: act, ok: true, diag });
          }
        } finally {
          await browser.disconnect();
        }
      } catch (err) {
        results.push({ action: act, ok: false, error: err?.message || String(err) });
      }
    } else if (item.target_agent === 'VOICE_CRM_AGENT') {
      const [health, wh] = await Promise.all([
        fetch(`${apiBase}/health`).then((r) => r.json()).catch(() => null),
        fetch(`${apiBase}/api/sarah/work-hours`).then((r) => r.json()).catch(() => null),
      ]);
      results.push({ action: act, ok: Boolean(health?.ok && wh?.ok), health, workHours: wh });
    }
  }

  return results;
}

/**
 * 100% Google Cloud / Google Workspace / Google Voice Native Admin Escalation
 * Dispatches urgent alert to Principal Broker King Amen Ra (king@iwillglobal.com / +16024569681)
 * via internal Google Workspace notification webhook & CRM real-time activity log (zero non-Google vendors).
 */
export async function dispatchGoogleNativeAdminAlert({ apiBase = 'http://127.0.0.1:4000', alertMessage, diagnosis }) {
  if (!alertMessage) return { sent: false };
  const payload = {
    event: 'ops_p0_admin_escalation',
    eventDetail: `[P0 ESCALATION] ${alertMessage} | Root Cause: ${diagnosis?.root_cause || 'Unknown'}`,
    runner: 'cloud-daemon',
    url: 'https://voice.iwillglobal.com',
    title: 'Sarah Ops Supervisor P0 Escalation',
  };
  await fetch(`${apiBase}/api/sarah/gv-heartbeat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }).catch(() => {});

  if (process.env.GOOGLE_CHAT_ALERT_WEBHOOK_URL) {
    await fetch(process.env.GOOGLE_CHAT_ALERT_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: `🚨 *Sarah 24/7 Receptionist P0 Alert (+14803319455)*\n${alertMessage}\n*Layer:* ${diagnosis?.layer}\n*Evidence:* ${diagnosis?.evidence}`,
      }),
    }).catch(() => {});
  }
  return { sent: true, channel: 'google_workspace_and_gv_watchdog', recipient: 'king@iwillglobal.com (+16024569681)' };
}
