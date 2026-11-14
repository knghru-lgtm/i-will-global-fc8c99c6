#!/usr/bin/env bash
# ==============================================================================
# One-Time Direct VM Google Voice Sign-In & Cookie Vault Sync
# Launches Chrome on Xvfb :99 with persistent server/data/chrome-gv-profile,
# exposes a one-time HTTPS noVNC view via /gv-login/<TOKEN>, automatically
# syncs the signed-in cookies into /api/sarah/gv-session-sync, and verifies
# cloud-voip-daemon reports online=true and sessionAuthenticated=true.
# ==============================================================================
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DATA_DIR="${REPO_DIR}/server/data"
PROFILE_DIR="${DATA_DIR}/chrome-gv-profile"
TOKEN_FILE="${DATA_DIR}/gv-login-token.txt"
BRIDGE_TOKEN="${GV_BRIDGE_TOKEN:-iwg-sarah-cloud-bridge-v10-9455}"
PUBLIC_BASE="${APP_URL:-https://voice.iwillglobal.com}"
PUBLIC_BASE="${PUBLIC_BASE%/}"

mkdir -p "${PROFILE_DIR}"

echo "[1/5] Applying OS sysctl settings & unlocking persistent Chrome profile..."
if [ -f "${REPO_DIR}/scripts/optimize-e2-small-os.sh" ]; then
  bash "${REPO_DIR}/scripts/optimize-e2-small-os.sh" >/dev/null 2>&1 || true
fi

pm2 stop cloud-voip-daemon >/dev/null 2>&1 || true
pkill -f "websockify.*6080" 2>/dev/null || true
pkill -f "x11vnc.*:99" 2>/dev/null || true
pkill -TERM -f "${PROFILE_DIR}" 2>/dev/null || true
sleep 1
pkill -9 -f "${PROFILE_DIR}" 2>/dev/null || true
pkill -f "Xvfb :99" 2>/dev/null || true
rm -f /tmp/.X99-lock /tmp/.X11-unix/X99 "${TOKEN_FILE}" "${PROFILE_DIR}/.native-vm-auth"
rm -rf "${PROFILE_DIR}"/Singleton* 2>/dev/null || true

if [ ! -f /usr/share/novnc/vnc.html ] || ! command -v x11vnc >/dev/null 2>&1 || ! command -v websockify >/dev/null 2>&1; then
  echo "[2/5] Installing xvfb + x11vnc + novnc + websockify..."
  sudo DEBIAN_FRONTEND=noninteractive apt-get update -qq
  sudo DEBIAN_FRONTEND=noninteractive apt-get install -y -qq xvfb x11vnc novnc websockify python3-websockify
else
  echo "[2/5] x11vnc + noVNC + websockify ready."
fi

LOGIN_TOKEN="$(node -e "process.stdout.write(require('crypto').randomBytes(12).toString('hex'))")"
umask 077
printf '%s' "${LOGIN_TOKEN}" > "${TOKEN_FILE}"

echo "[3/5] Starting Xvfb :99 + Chrome + localhost VNC (:6080)..."
Xvfb :99 -screen 0 1280x800x24 -nolisten tcp -ac -noreset >/tmp/iwg-xvfb-login.log 2>&1 &
XVFB_PID=$!
sleep 1
export DISPLAY=:99

CHROME_BIN="$(command -v google-chrome || command -v google-chrome-stable || command -v chromium || command -v chromium-browser)"
"${CHROME_BIN}" \
  --no-sandbox \
  --disable-setuid-sandbox \
  --disable-dev-shm-usage \
  --disable-gpu \
  --disable-blink-features=AutomationControlled \
  --password-store=basic \
  --no-first-run \
  --no-default-browser-check \
  --remote-debugging-address=127.0.0.1 \
  --remote-debugging-port=9222 \
  --user-data-dir="${PROFILE_DIR}" \
  --window-size=1280,800 \
  --window-position=0,0 \
  "https://voice.google.com/u/0/calls" >/tmp/iwg-chrome-login.log 2>&1 &
CHROME_PID=$!

sleep 1
x11vnc -display :99 -rfbport 5900 -localhost -nopw -forever -shared >/tmp/iwg-x11vnc.log 2>&1 &
VNC_PID=$!

sleep 1
if command -v websockify >/dev/null 2>&1; then
  websockify --web=/usr/share/novnc 127.0.0.1:6080 127.0.0.1:5900 >/tmp/iwg-websockify.log 2>&1 &
else
  python3 -m websockify --web /usr/share/novnc 127.0.0.1:6080 127.0.0.1:5900 >/tmp/iwg-websockify.log 2>&1 &
fi
WS_PID=$!

LOGIN_COMPLETED=0
CLEANED_UP=0

sync_profile_cookies_to_vault() {
  node --input-type=module - "${BRIDGE_TOKEN}" <<'NODE_EOF'
import puppeteer from 'puppeteer-core';

const bridgeToken = process.argv[2];
try {
  const verRes = await fetch('http://127.0.0.1:9222/json/version');
  if (verRes.ok) {
    const ver = await verRes.json();
    const ua = String(ver['User-Agent'] || '').replace(/HeadlessChrome\//gi, 'Chrome/');
    const browser = await puppeteer.connect({ browserWSEndpoint: ver.webSocketDebuggerUrl });
    const pages = await browser.pages();
    const page = pages[0];
    if (page) {
      const client = await page.createCDPSession();
      const all = await client.send('Network.getAllCookies');
      const cookies = Array.isArray(all?.cookies) ? all.cookies : [];
      const onGv = pages.some((p) => {
        const u = p.url() || '';
        return u.startsWith('https://voice.google.com') && !u.includes('/about');
      });
      if (cookies.length > 0 && onGv) {
        const syncRes = await fetch('http://127.0.0.1:4000/api/sarah/gv-session-sync', {
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
        });
        if (syncRes.ok) {
          const out = await syncRes.json();
          console.log(`[Cookie Vault Updated] Saved ${out.count} fresh native Linux cookies (${out.updatedAt})`);
          process.exit(0);
        }
      }
    }
    await browser.disconnect();
  }
} catch (err) {
  console.error('[Cookie Vault Sync Notice]', err?.message || err);
}
process.exit(1);
NODE_EOF
}

cleanup() {
  if [ "${CLEANED_UP}" -eq 1 ]; then
    return
  fi
  CLEANED_UP=1
  echo ""
  echo "Closing login view & saving Google Voice session..."
  rm -f "${TOKEN_FILE}"

  if sync_profile_cookies_to_vault; then
    LOGIN_COMPLETED=1
    date -u +"%Y-%m-%dT%H:%M:%SZ" > "${PROFILE_DIR}/.native-vm-auth"
  fi

  if kill -0 "${CHROME_PID}" 2>/dev/null; then
    kill -TERM "${CHROME_PID}" 2>/dev/null || true
    for _ in 1 2 3 4 5; do
      kill -0 "${CHROME_PID}" 2>/dev/null || break
      sleep 1
    done
    kill -9 "${CHROME_PID}" 2>/dev/null || true
  fi

  kill "${WS_PID}" "${VNC_PID}" "${XVFB_PID}" 2>/dev/null || true
  pkill -f "websockify.*6080" 2>/dev/null || true
  pkill -f "x11vnc.*:99" 2>/dev/null || true
  rm -rf "${PROFILE_DIR}"/Singleton* 2>/dev/null || true

  echo "Starting 24/7 cloud-voip-daemon..."
  (cd "${REPO_DIR}" && (pm2 restart cloud-voip-daemon --update-env || pm2 start ecosystem.config.cjs --only cloud-voip-daemon --update-env))
  pm2 save >/dev/null 2>&1 || true

  echo "Waiting up to 25s for all status flags to turn true..."
  for _ in $(seq 1 12); do
    sleep 2
    if curl -fsS http://127.0.0.1:4000/api/sarah/gv-status | node -e "const d=JSON.parse(require('fs').readFileSync(0,'utf8')); process.exit(d.online && d.cloudDaemonOnline && d.laptopIndependent && d.sessionAuthenticated ? 0 : 1);" 2>/dev/null; then
      break
    fi
  done
  curl -fsS http://127.0.0.1:4000/api/sarah/gv-status | node -e "const d=JSON.parse(require('fs').readFileSync(0,'utf8')); console.log({online:d.online, cloudDaemonOnline:d.cloudDaemonOnline, laptopIndependent:d.laptopIndependent, sessionAuthenticated:d.sessionAuthenticated, activeMode:d.activeMode, cookieVaultCount:d.cookieVaultCount, url:d.url, title:d.title, audio:d.receivingCallsText});" || true
}
trap cleanup EXIT INT TERM

echo "[4/5] Checking local VNC (:6080) & sarah-server (:4000)..."
for _ in $(seq 1 15); do
  if curl -fsS http://127.0.0.1:6080/vnc.html >/dev/null 2>&1; then
    break
  fi
  sleep 1
done

if ! curl -fsS "http://127.0.0.1:4000/gv-login/${LOGIN_TOKEN}/vnc.html" >/dev/null 2>&1; then
  (cd "${REPO_DIR}" && (pm2 restart sarah-server --update-env || pm2 start ecosystem.config.cjs --only sarah-server --update-env))
  for _ in $(seq 1 15); do
    if curl -fsS "http://127.0.0.1:4000/gv-login/${LOGIN_TOKEN}/vnc.html" >/dev/null 2>&1; then
      break
    fi
    sleep 1
  done
fi

DIRECT_URL="${PUBLIC_BASE}/gv-login/${LOGIN_TOKEN}"

echo ""
echo "=========================================================================="
echo "  [5/5] ONE-TIME GOOGLE VOICE VM SIGN-IN READY"
echo ""
echo "  1. Open this link in your browser:"
echo "     ${DIRECT_URL}"
echo ""
echo "  2. Sign into Google Voice (+14803319455) until the Calls page loads."
echo "     (This script auto-detects sign-in and updates the cookie vault,"
echo "      or you can press ENTER manually once signed in!)"
echo "=========================================================================="

# Poll every 2s for either ENTER on stdin OR automatic detection of voice.google.com/u/0/calls
while true; do
  if read -r -t 2 _; then
    break
  fi
  if curl -fsS http://127.0.0.1:9222/json/list 2>/dev/null | node -e "const tabs=JSON.parse(require('fs').readFileSync(0,'utf8')); const ok=Array.isArray(tabs)&&tabs.some(t=>String(t.url||'').startsWith('https://voice.google.com/')&&!String(t.url||'').includes('/about')&&!String(t.title||'').toLowerCase().includes('sign in')); process.exit(ok?0:1);" 2>/dev/null; then
    echo "✅ Detected authenticated Google Voice Calls page! Waiting 3s for cookies to settle..."
    sleep 3
    LOGIN_COMPLETED=1
    break
  fi
done
