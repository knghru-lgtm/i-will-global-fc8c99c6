#!/bin/sh
set -e

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"

# Clean up any stale orphaned Xvfb :99 or previous daemon Chrome instances before starting fresh
pkill -f "Xvfb :99" 2>/dev/null || true
pkill -f "/tmp/iwg-gv-daemon-profile" 2>/dev/null || true
rm -f /tmp/.X99-lock

# Start virtual PulseAudio null-sink (48kHz stereo clock, zero physical mic/speaker, zero echo)
if command -v pulseaudio >/dev/null 2>&1; then
  pulseaudio -D --exit-idle-time=-1 --system=false 2>/dev/null || true
  pactl load-module module-null-sink sink_name=SarahCloudNullSink sink_properties=device.description="SarahCloudNullSink" 2>/dev/null || true
  pactl set-default-sink SarahCloudNullSink 2>/dev/null || true
fi

# Start virtual X11 display if Xvfb is installed (worker.mjs automatically falls back to headless=new if not)
if command -v Xvfb >/dev/null 2>&1; then
  Xvfb :99 -screen 0 1280x800x24 -ac +extension GLX +render -noreset >/dev/null 2>&1 &
  sleep 1
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

# Run daemon under nice -n 10 so Caddy TLS (:443) and sarah-server (:4000) always get top CPU priority
if command -v nice >/dev/null 2>&1; then
  exec nice -n 10 node "$SCRIPT_DIR/worker.mjs"
else
  exec node "$SCRIPT_DIR/worker.mjs"
fi
