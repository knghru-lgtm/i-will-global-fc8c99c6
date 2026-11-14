#!/usr/bin/env bash
# ==============================================================================
# IWG 100% Google Cloud e2-small (Ubuntu 24.04 LTS, 2 vCPUs, 2GB RAM + 2GB Swap)
# Peak Kernel, Swap, OOM-Killer, TCP BBR/MSS, and Caddy HTTP/3 + Zstd Optimizer
# ==============================================================================
set -euo pipefail

echo "[1/5] Ensuring Xvfb, PulseAudio, and 2 GB /swapfile are active on e2-small..."
if ! command -v Xvfb >/dev/null 2>&1 || ! command -v pactl >/dev/null 2>&1; then
  sudo DEBIAN_FRONTEND=noninteractive apt-get update -qq
  sudo DEBIAN_FRONTEND=noninteractive apt-get install -y -qq xvfb pulseaudio pulseaudio-utils >/dev/null
fi
if ! swapon --show | grep -q "/swapfile"; then
  if [ ! -f /swapfile ]; then
    sudo fallocate -l 2G /swapfile || sudo dd if=/dev/zero of=/swapfile bs=1M count=2048
    sudo chmod 600 /swapfile
    sudo mkswap /swapfile
  fi
  sudo swapon /swapfile
fi
if ! grep -q "^/swapfile" /etc/fstab; then
  echo "/swapfile none swap sw 0 0" | sudo tee -a /etc/fstab >/dev/null
fi

echo "[2/5] Applying e2-small (2GB RAM, 2 vCPU) + WebRTC + BBR + 5G/464XLAT sysctl tuning..."
sudo rm -f /etc/sysctl.d/99-iwg-sarah-e2micro.conf 2>/dev/null || true
sudo tee /etc/sysctl.d/99-iwg-sarah-e2small.conf >/dev/null <<'EOF'
# Memory & Swap tuning for 2 GB RAM e2-small: keep Node + WebRTC pinned in physical RAM
vm.swappiness = 10
vm.vfs_cache_pressure = 50
vm.dirty_ratio = 15
vm.dirty_background_ratio = 5
vm.min_free_kbytes = 49152
vm.overcommit_memory = 1

# Low-latency BBR congestion control + UDP buffers for WebRTC & HTTP/3 QUIC
net.core.default_qdisc = fq
net.ipv4.tcp_congestion_control = bbr
net.core.rmem_max = 8388608
net.core.wmem_max = 8388608
net.ipv4.tcp_fastopen = 3
net.ipv4.tcp_slow_start_after_idle = 0
net.ipv4.tcp_keepalive_time = 60
net.ipv4.tcp_keepalive_intvl = 10
net.ipv4.tcp_keepalive_probes = 6

# Cellular 5G (DNS64 / 464XLAT) MTU blackhole prevention
net.ipv4.tcp_mtu_probing = 2
net.ipv4.tcp_base_mss = 1024
EOF
sudo sysctl --system >/dev/null

# Persist MSS clamping on default route & iptables so 5G TLS handshakes never stall
DEFAULT_ROUTE="$(ip route show default | head -n1)"
if [ -n "${DEFAULT_ROUTE}" ]; then
  sudo ip route change ${DEFAULT_ROUTE} advmss 1200 2>/dev/null || true
fi
if command -v iptables >/dev/null 2>&1; then
  sudo iptables -t mangle -C POSTROUTING -p tcp --tcp-flags SYN,RST SYN -j TCPMSS --set-mss 1200 2>/dev/null || \
    sudo iptables -t mangle -A POSTROUTING -p tcp --tcp-flags SYN,RST SYN -j TCPMSS --set-mss 1200 2>/dev/null || true
fi

echo "[3/5] Immunizing sshd and Caddy against Linux OOM Killer..."
sudo mkdir -p /etc/systemd/system/ssh.service.d /etc/systemd/system/caddy.service.d
sudo tee /etc/systemd/system/ssh.service.d/oom-protect.conf >/dev/null <<'EOF'
[Service]
OOMScoreAdjust=-900
EOF
sudo tee /etc/systemd/system/caddy.service.d/oom-protect.conf >/dev/null <<'EOF'
[Service]
OOMScoreAdjust=-500
LimitNOFILE=65535
EOF
sudo systemctl daemon-reload
sudo systemctl restart ssh 2>/dev/null || sudo systemctl restart sshd 2>/dev/null || true

echo "[4/5] Upgrading Caddyfile with HTTP/3, zstd + gzip compression, and zero-buffering WebSocket/Audio proxy..."
if command -v caddy >/dev/null 2>&1 && [ -f /etc/caddy/Caddyfile ]; then
  sudo cp /etc/caddy/Caddyfile /etc/caddy/Caddyfile.bak
  sudo tee /etc/caddy/Caddyfile >/dev/null <<'EOF'
{
    servers {
        protocols h1 h2 h3
    }
}

voice.iwillglobal.com, iwillglobal.com, www.iwillglobal.com {
    encode zstd gzip

    @realtime {
        path /api/sarah/live* /api/sarah/turn* /api/sarah/inbound* /api/sarah/audio.wav* /api/stream* /gv-login/*
    }
    reverse_proxy @realtime 127.0.0.1:4000 {
        flush_interval -1
        transport http {
            keepalive 90s
            keepalive_idle_conns 64
        }
    }

    reverse_proxy 127.0.0.1:4000 {
        transport http {
            keepalive 90s
            keepalive_idle_conns 64
        }
    }
}
EOF
  if sudo caddy validate --config /etc/caddy/Caddyfile >/dev/null 2>&1; then
    sudo systemctl reload caddy
  else
    echo "      Restoring previous Caddyfile (custom domain block detected)..."
    sudo cp /etc/caddy/Caddyfile.bak /etc/caddy/Caddyfile
  fi
fi

echo "[5/5] Verifying e2-small memory, swap, and BBR state..."
free -h
sysctl net.ipv4.tcp_congestion_control vm.swappiness
echo "✅ e2-small OS & Caddy optimization complete!"
