#!/bin/sh
set -e

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
REPO_DIR="$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)"
if [ -d "/home/king" ]; then
  PROFILE_DIR="/home/king/.sarah-chrome-profile"
else
  PROFILE_DIR="${CHROME_USER_DATA_DIR:-$REPO_DIR/server/data/chrome-gv-profile}"
fi

mkdir -p "$PROFILE_DIR"

# 1. Reap any stale orphaned Xvfb :99 or zombie daemon Chrome trees before starting fresh
pkill -9 -f "$PROFILE_DIR" 2>/dev/null || true
pkill -9 -f "/home/king/sarah-server/server/data/chrome-gv-profile" 2>/dev/null || true
pkill -9 -f "/tmp/iwg-gv-daemon-profile" 2>/dev/null || true
pkill -f "Xvfb :99" 2>/dev/null || true
rm -f /tmp/.X99-lock /tmp/.X11-unix/X99
rm -rf "$PROFILE_DIR"/Singleton* 2>/dev/null || true

# 2. Ultra-low-latency 20ms mono 48kHz PulseAudio null-sink (persistent /tmp/sarah-pulse survives SSH disconnect & systemd boot)
export PULSE_RUNTIME_PATH="/tmp/sarah-pulse"
mkdir -p "$PULSE_RUNTIME_PATH" 2>/dev/null || true
chmod 700 "$PULSE_RUNTIME_PATH" 2>/dev/null || true
export PULSE_LATENCY_MSEC=20
if command -v pulseaudio >/dev/null 2>&1; then
  pulseaudio --check 2>/dev/null || pulseaudio -D --exit-idle-time=-1 --system=false --disallow-module-loading=false 2>/dev/null || true
  if ! pactl list short sinks 2>/dev/null | grep -q "SarahCloudNullSink"; then
    pactl load-module module-null-sink sink_name=SarahCloudNullSink rate=48000 channels=1 sink_properties=device.description="Sarah_48kHz_Studio_Speaker" 2>/dev/null || true
  fi
  if ! pactl list short sinks 2>/dev/null | grep -q "virtual_speaker"; then
    pactl load-module module-null-sink sink_name=virtual_speaker rate=48000 channels=1 sink_properties=device.description="Gemini_Live_Virtual_Speaker" 2>/dev/null || true
  fi
  pactl set-default-sink SarahCloudNullSink 2>/dev/null || true
  pactl set-sink-mute SarahCloudNullSink 0 2>/dev/null || true
  pactl set-sink-mute virtual_speaker 0 2>/dev/null || true
  if ! pactl list short sources 2>/dev/null | grep -q "SarahCloudVirtualMic"; then
    pactl load-module module-remap-source master=SarahCloudNullSink.monitor source_name=SarahCloudVirtualMic source_properties=device.description="Sarah_48kHz_Studio_Microphone" 2>/dev/null || true
  fi
  if ! pactl list short sources 2>/dev/null | grep -q "virtual_mic"; then
    pactl load-module module-remap-source master=virtual_speaker.monitor source_name=virtual_mic source_properties=device.description="Gemini_Live_Virtual_Mic" 2>/dev/null || true
  fi
  pactl set-default-source SarahCloudVirtualMic 2>/dev/null || true
  pactl set-source-mute SarahCloudVirtualMic 0 2>/dev/null || true
  pactl set-source-mute virtual_mic 0 2>/dev/null || true
fi

# 3. Full 1280x960x24 Xvfb display so Google Voice's 3-column layout and bottom Answer button are NEVER clipped off-screen
if command -v Xvfb >/dev/null 2>&1; then
  Xvfb :99 -screen 0 1280x960x24 -nolisten tcp -ac -noreset >/dev/null 2>&1 &
  sleep 0.6
  export DISPLAY=:99
fi

if [ -f /usr/local/bin/sarah-chrome ]; then
  chmod +x /usr/local/bin/sarah-chrome 2>/dev/null || true
  export CHROME_PATH=/usr/local/bin/sarah-chrome
  export PUPPETEER_EXECUTABLE_PATH=/usr/local/bin/sarah-chrome
elif [ -x /usr/bin/google-chrome ]; then
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
