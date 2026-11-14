#!/usr/bin/env bash
# ==============================================================================
# One-Time Direct VM Google Voice Sign-In via HTTPS (Zero Port-6080 Web Preview!)
# Opens Chrome on Xvfb :99 using persistent server/data/chrome-gv-profile and
# exposes a temporary, 24-hex-token-gated HTTPS noVNC session directly through
# https://voice.iwillglobal.com/gv-login/<RANDOM_TOKEN> over standard port 443.
# As soon as you press ENTER (or Ctrl+C), the token is destroyed (404) and
# 24/7 cloud-voip-daemon resumes with your native Linux Google Voice session!
# ==============================================================================
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DATA_DIR="${REPO_DIR}/server/data"
PROFILE_DIR="${DATA_DIR}/chrome-gv-profile"
TOKEN_FILE="${DATA_DIR}/gv-login-token.txt"
PUBLIC_BASE="${APP_URL:-https://voice.iwillglobal.com}"
PUBLIC_BASE="${PUBLIC_BASE%/}"

mkdir -p "${PROFILE_DIR}"

echo "[1/5] Unlocking persistent VM Chrome profile..."
pm2 stop cloud-voip-daemon >/dev/null 2>&1 || true
pkill -f "websockify.*6080" 2>/dev/null || true
pkill -f "x11vnc.*:99" 2>/dev/null || true
pkill -TERM -f "${PROFILE_DIR}" 2>/dev/null || true
sleep 1
pkill -9 -f "${PROFILE_DIR}" 2>/dev/null || true
pkill -f "Xvfb :99" 2>/dev/null || true
rm -f /tmp/.X99-lock /tmp/.X11-unix/X99 "${TOKEN_FILE}"
rm -rf "${PROFILE_DIR}"/Singleton* 2>/dev/null || true

if [ ! -f /usr/share/novnc/vnc.html ] || ! command -v x11vnc >/dev/null 2>&1 || ! command -v websockify >/dev/null 2>&1; then
  echo "[2/5] Installing lightweight xvfb + x11vnc + novnc + websockify..."
  sudo DEBIAN_FRONTEND=noninteractive apt-get update -qq
  sudo DEBIAN_FRONTEND=noninteractive apt-get install -y -qq xvfb x11vnc novnc websockify python3-websockify
else
  echo "[2/5] x11vnc + noVNC + websockify already installed."
fi

LOGIN_TOKEN="$(node -e "process.stdout.write(require('crypto').randomBytes(12).toString('hex'))")"
umask 077
printf '%s' "${LOGIN_TOKEN}" > "${TOKEN_FILE}"

echo "[3/5] Launching isolated Xvfb :99 + Chrome + localhost noVNC (:6080)..."
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

cleanup() {
  if [ "${CLEANED_UP}" -eq 1 ]; then
    return
  fi
  CLEANED_UP=1
  echo ""
  echo "Sealing temporary login tunnel & flushing Chrome session to disk..."
  rm -f "${TOKEN_FILE}"

  if [ "${LOGIN_COMPLETED}" -eq 1 ]; then
    date -u +"%Y-%m-%dT%H:%M:%SZ" > "${PROFILE_DIR}/.native-vm-auth"
  fi

  # Graceful SIGTERM first so Chrome cleanly checkpoints SQLite Default/Cookies!
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

  echo "Restarting 24/7 cloud-voip-daemon with permanently authenticated VM profile..."
  (cd "${REPO_DIR}" && (pm2 restart cloud-voip-daemon --update-env || pm2 start ecosystem.config.cjs --only cloud-voip-daemon --update-env))
  pm2 save >/dev/null 2>&1 || true

  if [ "${LOGIN_COMPLETED}" -eq 1 ]; then
    echo "Waiting 20s for cloud-voip-daemon to verify Google Voice +14803319455..."
    sleep 20
    curl -fsS http://127.0.0.1:4000/api/sarah/gv-status | node -e "const d=JSON.parse(require('fs').readFileSync(0,'utf8')); console.log({online:d.online, cloudDaemonOnline:d.cloudDaemonOnline, laptopIndependent:d.laptopIndependent, sessionAuthenticated:d.cloudDaemon?.sessionAuthenticated, activeMode:d.activeMode, cookieVaultCount:d.cookieVaultCount, url:d.url, title:d.title, audio:d.receivingCallsText});" || true
  fi
}
trap cleanup EXIT INT TERM

echo "[4/5] Verifying local VNC (:6080) & sarah-server HTTPS tunnel (:4000)..."
VNC_OK=0
for _ in $(seq 1 15); do
  if curl -fsS http://127.0.0.1:6080/vnc.html >/dev/null 2>&1; then
    VNC_OK=1
    break
  fi
  sleep 1
done

if [ "${VNC_OK}" -ne 1 ]; then
  echo "❌ Local websockify (:6080) failed to start. Log output:"
  cat /tmp/iwg-websockify.log || true
  exit 1
fi

# Ensure sarah-server is running latest build with /gv-login/:token route
if ! curl -fsS "http://127.0.0.1:4000/gv-login/${LOGIN_TOKEN}/vnc.html" >/dev/null 2>&1; then
  echo "      Restarting sarah-server so /gv-login tunnel route is active..."
  (cd "${REPO_DIR}" && (pm2 restart sarah-server --update-env || pm2 start ecosystem.config.cjs --only sarah-server --update-env))
  for _ in $(seq 1 15); do
    if curl -fsS "http://127.0.0.1:4000/gv-login/${LOGIN_TOKEN}/vnc.html" >/dev/null 2>&1; then
      break
    fi
    sleep 1
  done
fi

if ! curl -fsS "http://127.0.0.1:4000/gv-login/${LOGIN_TOKEN}/vnc.html" >/dev/null 2>&1; then
  echo "❌ sarah-server (:4000) did not expose /gv-login tunnel. Ensure 'git pull' updated api/index.js."
  exit 1
fi

DIRECT_URL="${PUBLIC_BASE}/gv-login/${LOGIN_TOKEN}"

echo ""
echo "=========================================================================="
echo "  ✅ ONE-TIME GOOGLE VOICE VM SIGN-IN IS LIVE (NO PORT 6080 NEEDED!)"
echo ""
echo "  1. Open this secure one-time link in your regular browser:"
echo "     ${DIRECT_URL}"
echo ""
echo "  2. Inside that browser view, sign into Google Voice (+14803319455)"
echo "     until you see the Google Voice Calls screen."
echo ""
echo "  3. Come back here and press ENTER to seal the link & go 24/7 LIVE!"
echo "=========================================================================="
read -r _
LOGIN_COMPLETED=1
