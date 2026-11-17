import { exec } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { promisify } from 'util';

const execAsync = promisify(exec);

const TMP_ROOT = process.platform === 'win32' ? os.tmpdir() : '/tmp';
export const BROWSER_PID_FILE = path.join(TMP_ROOT, 'sarah-browser.pid');

export interface AntiHijackAuditResult {
  chromeVoicePurged: boolean;
  extensionBanEnforced: boolean;
  singleBrowserInstanceLocked: boolean;
  rootBrowserCount: number;
  killedPids: number[];
}

export async function enforcePulseAudioVirtualBridgeBinding(): Promise<boolean> {
  if (process.platform !== 'linux') return true;
  try {
    const cmd = [
      'export XDG_RUNTIME_DIR="/run/user/$(id -u)"',
      'pulseaudio --check 2>/dev/null || pulseaudio -D --exit-idle-time=-1 --realtime=true --system=false --disallow-module-loading=false 2>/dev/null || true',
      'pactl list short sinks 2>/dev/null | grep -q gv_speaker || pactl load-module module-null-sink sink_name=gv_speaker rate=16000 channels=1 sink_properties=device.description="Caller_From_GoogleVoice" 2>/dev/null || true',
      'pactl list short sinks 2>/dev/null | grep -q gv_mic_sink || pactl load-module module-null-sink sink_name=gv_mic_sink rate=24000 channels=1 sink_properties=device.description="Sarah_Aoede_Output" 2>/dev/null || true',
      'pactl list short sources 2>/dev/null | grep -q sarah_virtual_mic || pactl load-module module-remap-source master=gv_mic_sink.monitor source_name=sarah_virtual_mic source_properties=device.description="Sarah_Virtual_Mic" 2>/dev/null || true',
      'pactl set-default-sink gv_speaker 2>/dev/null || true',
      'pactl set-default-source sarah_virtual_mic 2>/dev/null || true',
      'pactl set-sink-mute gv_speaker 0 2>/dev/null || true',
      'pactl set-sink-mute gv_mic_sink 0 2>/dev/null || true',
      'pactl set-source-mute sarah_virtual_mic 0 2>/dev/null || true',
    ].join('; ');
    await execAsync(cmd);
    const { stdout: sinksOut } = await execAsync(
      'XDG_RUNTIME_DIR="/run/user/$(id -u)" pactl list short sinks 2>/dev/null'
    );
    const { stdout: sourcesOut } = await execAsync(
      'XDG_RUNTIME_DIR="/run/user/$(id -u)" pactl list short sources 2>/dev/null'
    );
    return (
      sinksOut.includes('gv_speaker') &&
      sinksOut.includes('gv_mic_sink') &&
      sourcesOut.includes('sarah_virtual_mic')
    );
  } catch {
    return false;
  }
}

export async function enforceExclusiveSarahCallOwnership(): Promise<AntiHijackAuditResult> {
  if (process.platform !== 'linux') {
    return {
      chromeVoicePurged: true,
      extensionBanEnforced: true,
      singleBrowserInstanceLocked: true,
      rootBrowserCount: 1,
      killedPids: [],
    };
  }

  const killedPids: number[] = [];
  const thisDir = path.dirname(fileURLToPath(import.meta.url));
  const repoRoot =
    path.basename(thisDir) === 'api'
      ? path.resolve(thisDir, '..')
      : path.resolve(thisDir, '..', '..');

  const forbiddenPaths = [
    path.join(repoRoot, 'google-voice-extension'),
    '/home/king/.sarah-chrome-profile/Default/Extensions',
    '/home/king/.sarah-chrome-profile/Default/Extensions/kcnhkahnjcbndmmehfkdnkjomaanaooo',
    '/root/.config/sarah-chromium-profile/Default/Extensions',
    '/root/.config/chromium/Default/Extensions/kcnhkahnjcbndmmehfkdnkjomaanaooo',
    '/etc/chromium/policies/managed/extension_install_forcelist.json',
    '/etc/opt/chrome/policies/managed/extension_install_forcelist.json',
  ];
  for (const fp of forbiddenPaths) {
    if (fs.existsSync(fp)) {
      try {
        fs.rmSync(fp, { recursive: true, force: true });
      } catch {}
    }
  }

  let authorizedRootPid = 0;
  try {
    if (fs.existsSync(BROWSER_PID_FILE)) {
      authorizedRootPid = Number(fs.readFileSync(BROWSER_PID_FILE, 'utf-8').trim()) || 0;
    }
  } catch {}

  let rootBrowserPids: number[] = [];
  let rogueExtensionFound = false;

  try {
    const { stdout } = await execAsync('ps -eo pid=,ppid=,args=');
    const lines = stdout.split(/\r?\n/);
    for (const rawLine of lines) {
      const m = rawLine.trim().match(/^(\d+)\s+(\d+)\s+(.*)$/);
      if (!m) continue;
      const pid = Number(m[1]);
      const args = m[3];

      if (/\bx11vnc\b/i.test(args)) {
        try {
          process.kill(pid, 'SIGKILL');
          killedPids.push(pid);
        } catch {}
        continue;
      }

      const isBrowserBin =
        /^(\/opt\/google\/chrome\/chrome|\/usr\/bin\/google-chrome|\/usr\/bin\/chromium|\/usr\/lib\/chromium\/chromium)\b/.test(
          args
        );
      if (!isBrowserBin) continue;

      if (
        /--load-extension|--disable-extensions-except|kcnhkahnjcbndmmehfkdnkjomaanaooo|google-voice-extension/i.test(
          args
        )
      ) {
        rogueExtensionFound = true;
        try {
          process.kill(pid, 'SIGKILL');
          killedPids.push(pid);
        } catch {}
        continue;
      }

      if (!args.includes('--type=') && !args.includes('crashpad')) {
        rootBrowserPids.push(pid);
      }
    }

    if (rootBrowserPids.length > 1) {
      const keepPid =
        authorizedRootPid && rootBrowserPids.includes(authorizedRootPid)
          ? authorizedRootPid
          : Math.max(...rootBrowserPids);
      for (const rPid of rootBrowserPids) {
        if (rPid !== keepPid) {
          try {
            process.kill(rPid, 'SIGKILL');
            killedPids.push(rPid);
          } catch {}
        }
      }
      rootBrowserPids = [keepPid];
    }
  } catch {}

  await enforcePulseAudioVirtualBridgeBinding();

  const extStillOnDisk = [
    path.join(repoRoot, 'google-voice-extension'),
    '/home/king/.sarah-chrome-profile/Default/Extensions/kcnhkahnjcbndmmehfkdnkjomaanaooo',
    '/root/.config/chromium/Default/Extensions/kcnhkahnjcbndmmehfkdnkjomaanaooo',
  ].some((fp) => fs.existsSync(fp));

  return {
    chromeVoicePurged: !extStillOnDisk && !rogueExtensionFound,
    extensionBanEnforced: !rogueExtensionFound,
    singleBrowserInstanceLocked: rootBrowserPids.length <= 1,
    rootBrowserCount: rootBrowserPids.length,
    killedPids,
  };
}

export async function lockBrowserToSarahOnly(browser: any, primaryPage: any): Promise<void> {
  const spawnedPid = browser?.process?.()?.pid;
  if (spawnedPid) {
    try {
      fs.writeFileSync(BROWSER_PID_FILE, String(spawnedPid), 'utf-8');
    } catch {}
  }

  const pruneExtraPages = async () => {
    try {
      if (!browser?.connected || primaryPage?.isClosed?.()) return;
      const pages = await browser.pages();
      for (const p of pages) {
        if (p !== primaryPage) {
          await p.close().catch(() => {});
        }
      }
      await enforcePulseAudioVirtualBridgeBinding();
    } catch {}
  };

  await pruneExtraPages();
  const timer = setInterval(pruneExtraPages, 5000);
  primaryPage?.once?.('close', () => clearInterval(timer));
}
