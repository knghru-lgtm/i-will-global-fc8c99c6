#!/usr/bin/env bash
# ==============================================================================
# One-Time Direct VM Google Voice Sign-In & Persistent Profile Lock
# Uses /usr/local/bin/sarah-chrome (--disable-extensions --disable-sync),
# starts directly on Google ServiceLogin -> voice.google.com/u/0/calls,
# verifies live Xvfb :99 + x11vnc :5900 + websockify :6080 RFB socket,
# and ONLY completes once gv-availability-chip / settings-ogb-button is live!
# ==============================================================================
set -uo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DATA_DIR="${REPO_DIR}/server/data"
if [ -d "/home/king" ]; then
  PROFILE_DIR="/home/king/.sarah-chrome-profile"
else
  PROFILE_DIR="${CHROME_USER_DATA_DIR:-${DATA_DIR}/chrome-gv-profile}"
fi
TOKEN_FILE="${DATA_DIR}/gv-login-token.txt"
BRIDGE_TOKEN="${GV_BRIDGE_TOKEN:-iwg-sarah-cloud-bridge-v10-9455}"
PUBLIC_BASE="http://35.202.66.108"

mkdir -p "${PROFILE_DIR}" "${DATA_DIR}"

echo "[1/5] Stopping background daemons & unlocking persistent Chrome profile..."
pm2 stop sarah-watchdog >/dev/null 2>&1 || true
pm2 stop sarah-daemon >/dev/null 2>&1 || true
pm2 delete cloud-voip-daemon >/dev/null 2>&1 || true
pkill -9 -f "websockify.*6080" 2>/dev/null || true
pkill -9 -f "x11vnc.*5900" 2>/dev/null || true
pkill -9 -f "x11vnc.*:99" 2>/dev/null || true
pkill -TERM -f "${PROFILE_DIR}" 2>/dev/null || true
sleep 1
pkill -9 -f "${PROFILE_DIR}" 2>/dev/null || true
pkill -9 -f "Xvfb :99" 2>/dev/null || true

# Wait until any old Xvfb :99 abstract socket is 100% released by the kernel
for _ in $(seq 1 20); do
  if ! pgrep -f "Xvfb :99" >/dev/null 2>&1; then
    break
  fi
  sleep 0.2
done
sudo rm -f /tmp/.X99-lock /tmp/.X11-unix/X99 2>/dev/null || rm -f /tmp/.X99-lock /tmp/.X11-unix/X99 2>/dev/null || true
rm -f "${TOKEN_FILE}" "${PROFILE_DIR}/.native-vm-auth" "${PROFILE_DIR}/.last-vault-stamp"
rm -rf "${PROFILE_DIR}"/Singleton* "${PROFILE_DIR}/Default/Extensions" "${PROFILE_DIR}/Default/Service Worker" 2>/dev/null || true

LOGIN_TOKEN="$(node -e "process.stdout.write(require('crypto').randomBytes(12).toString('hex'))")"
umask 077
printf '%s' "${LOGIN_TOKEN}" > "${TOKEN_FILE}"

echo "[2/5] Starting Xvfb :99 (1280x960) + hardened sarah-chrome + localhost VNC (:5900 -> :6080)..."
Xvfb :99 -screen 0 1280x960x24 -nolisten tcp -ac -noreset >/tmp/iwg-xvfb-login.log 2>&1 &
XVFB_PID=$!

# Wait for Xvfb :99 socket to exist and stay alive
for _ in $(seq 1 25); do
  if [ -S /tmp/.X11-unix/X99 ] && kill -0 "${XVFB_PID}" 2>/dev/null; then
    break
  fi
  sleep 0.2
done

if ! kill -0 "${XVFB_PID}" 2>/dev/null; then
  echo "❌ ERROR: Xvfb :99 failed to start:"
  cat /tmp/iwg-xvfb-login.log 2>/dev/null || true
  exit 1
fi

export DISPLAY=:99
unset DBUS_SESSION_BUS_ADDRESS

CHROME_BIN="/usr/local/bin/sarah-chrome"
if [ ! -x "${CHROME_BIN}" ]; then
  CHROME_BIN="$(command -v google-chrome || command -v google-chrome-stable || command -v chromium || command -v chromium-browser)"
fi

"${CHROME_BIN}" \
  --user-data-dir="${PROFILE_DIR}" \
  --disable-extensions \
  --disable-component-extensions-with-background-pages \
  --disable-default-apps \
  --disable-sync \
  --no-sandbox \
  --disable-setuid-sandbox \
  --disable-dev-shm-usage \
  --disable-gpu \
  --disable-blink-features=AutomationControlled \
  --password-store=basic \
  --use-mock-keychain \
  --no-first-run \
  --no-default-browser-check \
  --remote-debugging-address=127.0.0.1 \
  --remote-debugging-port=9222 \
  --window-size=1280,960 \
  --window-position=0,0 \
  "https://accounts.google.com/ServiceLogin?service=grandcentral&Email=king%40iwillglobal.com&continue=https%3A%2F%2Fvoice.google.com%2Fu%2F0%2Fcalls" >/tmp/iwg-chrome-login.log 2>&1 &
CHROME_PID=$!

sleep 2
x11vnc -display :99 -rfbport 5900 -localhost -nopw -forever -shared -noxdamage >/tmp/iwg-x11vnc.log 2>&1 &
VNC_PID=$!

# Wait for x11vnc TCP 127.0.0.1:5900 to listen
for _ in $(seq 1 25); do
  if ss -tln 2>/dev/null | grep -q ':5900 '; then
    break
  fi
  sleep 0.2
done

if command -v websockify >/dev/null 2>&1; then
  websockify --web=/usr/share/novnc 127.0.0.1:6080 127.0.0.1:5900 >/tmp/iwg-websockify.log 2>&1 &
else
  python3 -m websockify --web /usr/share/novnc 127.0.0.1:6080 127.0.0.1:5900 >/tmp/iwg-websockify.log 2>&1 &
fi
WS_PID=$!

CLEANED_UP=0

verify_real_gv_dom_ready() {
  (cd "${REPO_DIR}/cloud-voip-daemon" && node --input-type=module - <<'NODE_EOF'
import puppeteer from 'puppeteer-core';
try {
  const verRes = await fetch('http://127.0.0.1:9222/json/version');
  if (!verRes.ok) process.exit(1);
  const ver = await verRes.json();
  const browser = await puppeteer.connect({ browserWSEndpoint: ver.webSocketDebuggerUrl, defaultViewport: null });
  try {
    const pages = await browser.pages();
    for (const p of pages) {
      const url = p.url() || '';
      if (!url.startsWith('https://voice.google.com/u/0')) continue;
      if (url.includes('accounts.google.com') || url.includes('workspace.google.com') || url.includes('/about')) continue;
      const domReady = await p.evaluate(() => {
        const titleOk = /voice/i.test(document.title || '') && !/sign\s*in/i.test(document.title || '');
        const hasUi = Boolean(
          document.querySelector('gv-availability-chip, button[gv-test-id="settings-ogb-button"], button[aria-label="Settings"]')
        );
        return titleOk && hasUi;
      }).catch(() => false);
      if (domReady) {
        process.exit(0);
      }
    }
  } finally {
    await browser.disconnect();
  }
} catch {}
process.exit(1);
NODE_EOF
  )
}

sync_and_close_browser_cleanly() {
  (cd "${REPO_DIR}/cloud-voip-daemon" && node --input-type=module - "${BRIDGE_TOKEN}" <<'NODE_EOF'
import puppeteer from 'puppeteer-core';
const bridgeToken = process.argv[2];
try {
  const verRes = await fetch('http://127.0.0.1:9222/json/version');
  if (verRes.ok) {
    const ver = await verRes.json();
    const ua = String(ver['User-Agent'] || '').replace(/HeadlessChrome\//gi, 'Chrome/');
    const browser = await puppeteer.connect({ browserWSEndpoint: ver.webSocketDebuggerUrl, defaultViewport: null });
    const pages = await browser.pages();
    const page = pages[0];
    if (page) {
      const client = await page.createCDPSession();
      const all = await client.send('Storage.getCookies').catch(() => client.send('Network.getAllCookies'));
      const cookies = Array.isArray(all?.cookies) ? all.cookies : [];
      const hasCore = ['SID', 'HSID', 'SSID', '__Secure-1PSID'].every((k) => cookies.some((c) => c.name === k));
      if (cookies.length > 0 && hasCore) {
        await fetch('http://127.0.0.1:4000/api/sarah/gv-session-sync', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-iwg-bridge-token': bridgeToken,
          },
          body: JSON.stringify({
            cookies,
            userAgent: ua,
            source: 'vm-direct-login-native',
          }),
        }).catch(() => {});
        await browser.close().catch(() => {});
        process.exit(0);
      }
    }
    await browser.disconnect().catch(() => {});
  }
} catch {}
process.exit(1);
NODE_EOF
  )
}

cleanup() {
  if [ "${CLEANED_UP}" -eq 1 ]; then
    return
  fi
  CLEANED_UP=1
  echo ""
  echo "Closing login view & checkpointing Google Voice session..."
  rm -f "${TOKEN_FILE}"

  if sync_and_close_browser_cleanly; then
    rm -f "${PROFILE_DIR}/.last-vault-stamp" 2>/dev/null || true
    date -u +"%Y-%m-%dT%H:%M:%SZ" > "${PROFILE_DIR}/.native-vm-auth"
    date -u +"%Y-%m-%dT%H:%M:%SZ" > "${PROFILE_DIR}/.vm-session-live"
    echo "✅ Checkpointed SQLite Default/Cookies & locked .native-vm-auth!"
  fi

  sleep 1
  if kill -0 "${CHROME_PID}" 2>/dev/null; then
    kill -TERM "${CHROME_PID}" 2>/dev/null || true
    sleep 2
    kill -9 "${CHROME_PID}" 2>/dev/null || true
  fi

  kill "${WS_PID}" "${VNC_PID}" "${XVFB_PID}" 2>/dev/null || true
  pkill -9 -f "websockify.*6080" 2>/dev/null || true
  pkill -9 -f "x11vnc.*5900" 2>/dev/null || true
  rm -rf "${PROFILE_DIR}"/Singleton* 2>/dev/null || true

  echo "Starting 24/7 sarah-daemon & sarah-watchdog..."
  (cd "${REPO_DIR}" && (pm2 start sarah-daemon --update-env || pm2 start src/sarah-daemon.ts --name sarah-daemon --interpreter npx --interpreter-args "tsx"))
  (cd "${REPO_DIR}" && (pm2 start sarah-watchdog --update-env || pm2 start src/watchdog/sarah-watchdog.ts --name sarah-watchdog --interpreter npx --interpreter-args "tsx"))
  pm2 save --force >/dev/null 2>&1 || true
}
trap cleanup EXIT INT TERM

for _ in $(seq 1 20); do
  if curl -fsS http://127.0.0.1:6080/vnc.html >/dev/null 2>&1; then
    break
  fi
  sleep 0.5
done

echo "=========================================================================="
echo "  ONE-TIME GOOGLE VOICE VM SIGN-IN READY"
echo "  Direct Cloud IP:  ${PUBLIC_BASE}/gv-login/${LOGIN_TOKEN}"
echo "  Local SSH Tunnel: http://localhost:4000/gv-login/${LOGIN_TOKEN}"
echo "=========================================================================="

while true; do
  sleep 3
  # Self-heal x11vnc or websockify if either ever exits unexpectedly while Chrome is open
  if kill -0 "${XVFB_PID}" 2>/dev/null; then
    if ! kill -0 "${VNC_PID}" 2>/dev/null; then
      x11vnc -display :99 -rfbport 5900 -localhost -nopw -forever -shared -noxdamage >/tmp/iwg-x11vnc.log 2>&1 &
      VNC_PID=$!
    fi
    if ! kill -0 "${WS_PID}" 2>/dev/null; then
      websockify --web=/usr/share/novnc 127.0.0.1:6080 127.0.0.1:5900 >/tmp/iwg-websockify.log 2>&1 &
      WS_PID=$!
    fi
  fi

  if verify_real_gv_dom_ready; then
    sleep 4
    if verify_real_gv_dom_ready; then
      echo "✅ Verified REAL authenticated Google Voice Calls UI (gv-availability-chip live)!"
      break
    fi
  fi
done
