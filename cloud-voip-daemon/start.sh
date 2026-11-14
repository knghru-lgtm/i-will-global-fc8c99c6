#!/bin/sh
set -e

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"

# Start virtual PulseAudio null-sink (48kHz stereo clock, zero physical mic/speaker, zero echo)
pulseaudio -D --exit-idle-time=-1 --system=false 2>/dev/null || true
pactl load-module module-null-sink sink_name=SarahCloudNullSink sink_properties=device.description="SarahCloudNullSink" 2>/dev/null || true
pactl set-default-sink SarahCloudNullSink 2>/dev/null || true

# Start virtual X11 display so Chrome/Chromium runs un-throttled with visibilityState="visible"
rm -f /tmp/.X99-lock
Xvfb :99 -screen 0 1280x800x24 -ac +extension GLX +render -noreset &
sleep 1

export DISPLAY=:99
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

exec node "$SCRIPT_DIR/worker.mjs"
