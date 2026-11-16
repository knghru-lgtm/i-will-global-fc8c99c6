#!/usr/bin/env bash
set -e

echo "===================================================================="
echo "🚀 DEPLOYING PERMANENT GOOGLE-NATIVE SARAH WATCHDOG & PICKUP ENGINE"
echo "===================================================================="

mkdir -p src/watchdog .agent/rules

# 1. Lock in Permanent Workspace Rules so Antigravity IDE never forgets
cat << 'RULES_EOF' > .cursorrules
# PERMANENT ARCHITECTURAL LAW: SARAH AI RECEPTIONIST (100% GOOGLE STACK)
1. STRICT GOOGLE STACK ONLY: Sarah uses ONLY Google Voice (+14803319455), Puppeteer/Chromium, PulseAudio virtual audio sinks (`virtual_speaker` / `virtual_mic`), Google Workspace APIs (Calendar/Gmail/Chat), and Gemini Live API (`Aoede`). Never use, import, suggest, or reference external third-party voice or SMS platforms.
2. AUTONOMOUS SELF-HEALING: `src/watchdog/sarah-watchdog.ts` is the permanent Operations & Maintenance Manager. It runs 24/7 under PM2 (`:4099`), monitors Google Voice DOM & WebRTC state every 700ms, audits Google Voice "Web" and "Do Not Disturb" toggles every 3 minutes, runs the 8:55 AM MST synthetic morning probe (`src/watchdog/synthetic-morning-probe.ts`), and uses Gemini 2.5 Flash to auto-patch DOM selectors whenever a pickup fails.
3. ALWAYS AUTO-WIRE: Whenever modifying Sarah's backend or Puppeteer scripts, ensure `attachBulletproofCallPickup(page, context)` from `src/watchdog/sarah-watchdog.ts` remains attached to the Google Voice page instance.
RULES_EOF

cp .cursorrules .windsurfrules
cp .cursorrules .agent/rules/sarah-manager.md
echo "✅ Step 1: Permanent IDE Workspace Rules written."

# 2. Enforce Arizona Timezone (America/Phoenix — MST year-round) on Linux VM
if command -v timedatectl >/dev/null 2>&1; then
  sudo timedatectl set-timezone America/Phoenix || true
  echo "✅ Step 2: System timezone locked to $(timedatectl show -p Timezone --value)."
fi

# 3. Compile API & Watchdog ESM Bundles (`api/index.js` + `api/sarah-watchdog.js`)
npm run build:api
echo "✅ Step 3: Bundled api/index.js & api/sarah-watchdog.js."

# 4. Ensure Caddy Reverse Proxy Routes `/watchdog*` -> `localhost:4099`
if command -v caddy >/dev/null 2>&1 && [ -f /etc/caddy/Caddyfile ]; then
  if ! grep -q "localhost:4099" /etc/caddy/Caddyfile; then
    sudo tee /etc/caddy/Caddyfile >/dev/null << 'CADDY_EOF'
voice.iwillglobal.com {
    handle /watchdog* {
        reverse_proxy localhost:4099
    }
    handle {
        reverse_proxy localhost:4000
    }
}
CADDY_EOF
  fi
  sudo caddy validate --config /etc/caddy/Caddyfile && sudo systemctl reload caddy
  echo "✅ Step 4: Caddy validated & reloaded (/watchdog* -> :4099)."
fi

# 5. Restart PM2 Daemons, Watchdog (:4099), & 8:55 AM MST Synthetic Probe
if command -v pm2 >/dev/null 2>&1; then
  pm2 delete sarah-watchdog 2>/dev/null || true
  pm2 delete sarah-855-probe 2>/dev/null || true

  pm2 stop cloud-voip-daemon 2>/dev/null || true
  rm -f /tmp/sarah-call-state.json /tmp/sarah-trigger-synthetic-ring.flag /tmp/sarah-audit-settings.flag 2>/dev/null || true
  sleep 1
  pm2 start cloud-voip-daemon --update-env 2>/dev/null || pm2 start ecosystem.config.cjs --only cloud-voip-daemon
  pm2 restart sarah-server --update-env 2>/dev/null || pm2 start ecosystem.config.cjs --only sarah-server
  pm2 start src/watchdog/sarah-watchdog.ts --name sarah-watchdog --interpreter npx --interpreter-args "tsx"

  echo "⏳ Waiting for Google Voice WebRTC session to come online..."
  for i in $(seq 1 48); do
    if grep -q '"isLoggedIn": true' /tmp/sarah-call-state.json 2>/dev/null && curl -fsS http://127.0.0.1:4000/api/sarah/gv-status 2>/dev/null | grep -q '"online":true'; then
      echo "✅ Google Voice (+14803319455) authenticated & online."
      break
    fi
    sleep 2
  done

  pm2 start src/watchdog/synthetic-morning-probe.ts --name sarah-855-probe --interpreter npx --interpreter-args "tsx" --cron-restart="55 8 * * 1-5" --no-autorestart
  pm2 save --force
  echo "✅ Step 5: PM2 processes started & saved."
fi

echo "===================================================================="
echo "🎯 RUNNING LIVE 8:55 AM SYNTHETIC PROBE & 5-SECOND SLA VERIFICATION"
echo "===================================================================="
for i in $(seq 1 15); do
  if ! command -v pm2 >/dev/null 2>&1 || pm2 jlist | grep -q '"name":"sarah-855-probe".*"status":"stopped"'; then
    break
  fi
  sleep 1
done

npx tsx src/watchdog/synthetic-morning-probe.ts
echo "===================================================================="
echo "✅ DEPLOYMENT & SLA VERIFICATION COMPLETE"
echo "===================================================================="
