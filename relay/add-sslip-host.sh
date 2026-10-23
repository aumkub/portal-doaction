#!/usr/bin/env bash
# Workers on the doaction.co.th zone can't reach a grey-clouded record in the
# same zone (Cloudflare routes it through the zone's Flexible SSL -> 308 loop).
# Serve the relay on an sslip.io name too: outside Cloudflare, own LE cert.
set -euo pipefail
ssh ubuntu@51.79.223.252 bash -s <<'REMOTE'
set -euo pipefail
F=/opt/pdpc/deploy/Caddyfile
H=51-79-223-252.sslip.io
if ! sudo grep -q "^$H " "$F"; then
  sudo cp "$F" "$F.bak-$(date +%Y%m%d%H%M%S)"
  printf '\n%s {\n\treverse_proxy wake-relay:8787\n}\n' "$H" | sudo tee -a "$F" >/dev/null
fi
sudo docker exec pdpc-caddy-1 caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile 2>&1 | tail -1
sudo docker exec pdpc-caddy-1 caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile
REMOTE
sleep 15
curl -s -X POST https://51-79-223-252.sslip.io/wake; echo
