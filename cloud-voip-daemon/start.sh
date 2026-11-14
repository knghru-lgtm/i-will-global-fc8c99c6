#!/bin/sh
set -e

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
REPO_DIR="$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)"
PROFILE_DIR="$REPO_DIR/server/data/chrome-gv-profile"

mkdir -p "$PROFILE_DIR"

# 1. Reap any stale orphaned Xvfb :99 or zombie daemon Chrome trees before starting fresh
pkill -9 -f "$PROFILE_DIR" 2>/dev/null || true
pkill -9 -f "/tmp/iwg-gv-daemon-profile" 2>/dev/null || true
pkill -f "Xvfb :99" 2>/dev/null || true
rm -f /tmp/.X99-lock /tmp/.X11-unix/X99
rm -rf "$PROFILE_DIR"/Singleton* 2>/dev/null || true

# 2. Ultra-low-latency 20ms mono 48kHz PulseAudio null-sink (zero physical mic/speaker, zero echo, half RAM)
export PULSE_LATENCY_MSEC=20
if command -v pulseaudio >/dev/null 2>&1; then
  pulseaudio --check 2>/dev/null || pulseaudio -D --exit-idle-time=-1 --system=false --disallow-module-loading=false 2>/dev/null || true
  if ! pactl list short sinks 2>/dev/null | grep -q "SarahCloudNullSink"; then
    pactl load-module module-null-sink sink_name=SarahCloudNullSink rate=48000 channels=1 sink_properties=device.description="SarahCloudNullSink" 2>/dev/null || true
  fi
  pactl set-default-sink SarahCloudNullSink 2>/dev/null || true
fi

# 3. Ultra-slim 16-bit 800x600 Xvfb (no GLX/TCP bloat — saves ~45 MB RAM on e2-small)
if command -v Xvfb >/dev/null 2>&1; then
  Xvfb :99 -screen 0 800x600x16 -nolisten tcp -ac -noreset >/dev/null 2>&1 &
  sleep 0.6
  export DISPLAY=:99
fi

if [ -x /usr/bin/google-chrome ]; then
  export CHROME_PATH=/usr/bin/google-chrome
  export PUPPETEER_EXECUTABLE_PATH=/usr/bin/google-chrome
elif [ -x /usr/bin/google-chrome-stable ]; then
  export CHROME_PATH=/usr/bin/google-chrome-stable
  export PUPPETEER_EXECUTABLE_PATH=/usr/bin/google-chrome-stable
elif [ -x /usr/bin/chromium ]; then
  export CHROME_PATH=/usr/bin/chromium
  export PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium
elif [ -x /usr/bin/chromium-browser ]; then
  export CHROME_PATH=/usr/bin/chromium-browser
  export PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser
fi

export CHROME_USER_DATA_DIR="$PROFILE_DIR"

# 4. Cap worker V8 heap at 160MB & run under nice -n 5 on e2-small (2 vCPUs, 2GB RAM)
if command -v nice >/dev/null 2>&1; then
  exec nice -n 5 node --max-old-space-size=160 "$SCRIPT_DIR/worker.mjs"
else
  exec node --max-old-space-size=160 "$SCRIPT_DIR/worker.mjs"
fi
