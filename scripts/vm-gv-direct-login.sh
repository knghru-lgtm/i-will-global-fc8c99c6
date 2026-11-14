#!/usr/bin/env bash
# ==============================================================================
# One-Time Direct VM Google Voice Sign-In Helper (Bypasses Windows 11 TPM DBSC!)
# Use ONLY if Google marks copied Windows cookies as "Signed out" due to DBSC.
# Launches Chrome inside Xvfb :99 on the persistent VM profile & exposes VNC on
# 127.0.0.1:5900 (or noVNC web view on 127.0.0.1:6080) over secure SSH tunnel!
# ==============================================================================
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PROFILE_DIR="${REPO_DIR}/server/data/chrome-gv-profile"
mkdir -p "${PROFILE_DIR}"

echo "Stopping cloud-voip-daemon temporarily so persistent profile is unlocked..."
pm2 stop cloud-voip-daemon 2>/dev/null || true
pkill -9 -f "${PROFILE_DIR}" 2>/dev/null || true
pkill -f "Xvfb :99" 2>/dev/null || true
rm -f /tmp/.X99-lock /tmp/.X11-unix/X99
rm -rf "${PROFILE_DIR}"/Singleton* 2>/dev/null || true

if ! command -v x11vnc >/dev/null 2>&1 || ! command -v novnc_proxy >/dev/null 2>&1; then
  echo "Installing lightweight x11vnc + novnc for one-time browser sign-in..."
  sudo DEBIAN_FRONTEND=noninteractive apt-get update -qq
  sudo DEBIAN_FRONTEND=noninteractive apt-get install -y -qq xvfb x11vnc novnc websockify
fi

Xvfb :99 -screen 0 1280x800x24 -nolisten tcp -ac -noreset >/dev/null 2>&1 &
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
  --user-data-dir="${PROFILE_DIR}" \
  --window-size=1280,800 \
  "https://voice.google.com/u/0/calls" >/dev/null 2>&1 &
CHROME_PID=$!

x11vnc -display :99 -localhost -nopw -forever -shared -quiet >/dev/null 2>&1 &
VNC_PID=$!

websockify --web=/usr/share/novnc/ 127.0.0.1:6080 127.0.0.1:5900 >/dev/null 2>&1 &
WS_PID=$!

cleanup() {
  kill "${WS_PID}" "${VNC_PID}" "${CHROME_PID}" "${XVFB_PID}" 2>/dev/null || true
  rm -rf "${PROFILE_DIR}"/Singleton* 2>/dev/null || true
  echo "Restarting 24/7 cloud-voip-daemon with permanently authenticated VM profile..."
  pm2 start ecosystem.config.cjs --only cloud-voip-daemon --update-env || pm2 restart cloud-voip-daemon --update-env
  pm2 save
}
trap cleanup EXIT

echo ""
echo "=========================================================================="
echo "  ONE-TIME VM GOOGLE VOICE SIGN-IN READY!"
echo "  1. If using Google Cloud Console SSH-in-Browser:"
echo "     Click 'Web Preview' (top-right icon) -> 'Change port' -> 6080 ->"
echo "     open '/vnc.html?autoconnect=true' and sign into +14803319455!"
echo "  2. Once you see Google Voice Calls loaded, press ENTER here to save"
echo "     the session permanently and resume 24/7 cloud-voip-daemon!"
echo "=========================================================================="
read -r _
