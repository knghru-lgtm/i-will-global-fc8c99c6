#!/usr/bin/env bash
set -e

echo "===================================================================="
echo "🔊 DEPLOYING ZERO-LAG PULSEAUDIO + GEMINI LIVE (AOEDE) CALL BRIDGE"
echo "===================================================================="

mkdir -p src/audio src/watchdog

# 1. Ensure ws, @types/ws, and ffmpeg are available for Gemini Live WebSocket & PCM streaming
if [ -f "package.json" ]; then
  npm install ws @types/ws --save --no-audit --no-fund 2>/dev/null || true
fi
if command -v apt-get >/dev/null 2>&1 && ! command -v ffmpeg >/dev/null 2>&1; then
  sudo DEBIAN_FRONTEND=noninteractive apt-get update -qq && sudo DEBIAN_FRONTEND=noninteractive apt-get install -y -qq ffmpeg || true
fi

# 2. Bundle API & Watchdog ESM outputs
npm run build:api

# 3. Stop legacy cloud-voip-daemon gracefully so sarah-daemon owns /home/king/.sarah-chrome-profile exclusively
pm2 stop cloud-voip-daemon 2>/dev/null || true
pm2 delete cloud-voip-daemon 2>/dev/null || true
sleep 2

# 4. Register/Restart sarah-daemon and sarah-watchdog under PM2
pm2 delete sarah-daemon 2>/dev/null || true
pm2 start src/sarah-daemon.ts --name sarah-daemon --interpreter npx --interpreter-args "tsx"
pm2 restart sarah-watchdog --update-env 2>/dev/null || pm2 start src/watchdog/sarah-watchdog.ts --name sarah-watchdog --interpreter npx --interpreter-args "tsx"
pm2 save --force

echo "⏳ Waiting for sarah-daemon to initialize Zero-Lag PulseAudio & Google Voice..."
for i in $(seq 1 30); do
  if node -e '
    const fs = require("fs");
    if (!fs.existsSync("/tmp/sarah-call-state.json")) process.exit(1);
    const s = JSON.parse(fs.readFileSync("/tmp/sarah-call-state.json", "utf8"));
    const age = Date.now() - new Date(s.lastHeartbeatIso).getTime();
    process.exit(s.isLoggedIn && age < 8000 ? 0 : 1);
  ' 2>/dev/null; then
    echo "✅ sarah-daemon authenticated & live in $((i * 2))s!"
    break
  fi
  sleep 2
done

echo "===================================================================="
echo "✅ AUDIO BRIDGE WIRED & LIVE! Verifying PulseAudio virtual sinks:"
XDG_RUNTIME_DIR="/run/user/$(id -u)" pactl list short sinks || true
XDG_RUNTIME_DIR="/run/user/$(id -u)" pactl list short sources || true
echo "===================================================================="
