#!/bin/sh
set -e

# Start virtual PulseAudio null-sink (48kHz stereo clock, zero physical mic/speaker, zero echo)
pulseaudio -D --exit-idle-time=-1 --system=false 2>/dev/null || true
pactl load-module module-null-sink sink_name=SarahCloudNullSink sink_properties=device.description="SarahCloudNullSink" 2>/dev/null || true
pactl set-default-sink SarahCloudNullSink 2>/dev/null || true

# Start virtual X11 display so Chromium runs un-throttled with visibilityState="visible"
rm -f /tmp/.X99-lock
Xvfb :99 -screen 0 1280x800x24 -ac +extension GLX +render -noreset &
sleep 1

exec node /app/worker.mjs

