#!/usr/bin/env bash
# Workers on the doaction.co.th zone can't reach a grey-clouded record in the
# same zone (Cloudflare routes it through the zone's Flexible SSL -> 308 loop).
# Serve the relay on an sslip.io name too: outside Cloudflare, own LE cert.
#
# The server's shared Caddy runs as the `proxy` container (caddy:2) on the
# `web` network, with one file per site in /opt/proxy/sites. wake-relay is on
# the same network, so the site file can proxy to it by container name.
set -euo pipefail
ssh ubuntu@51.79.223.252 bash -s <<'REMOTE'
set -euo pipefail
H=51-79-223-252.sslip.io
F=/opt/proxy/sites/wake-relay.caddy
if ! sudo grep -q "import sites/\|import /etc/caddy/sites/" /opt/proxy/Caddyfile; then
  echo "Caddyfile does not import /etc/caddy/sites; add the block to /opt/proxy/Caddyfile by hand:" >&2
  sudo cat /opt/proxy/Caddyfile >&2
  exit 1
fi
printf '%s {\n\treverse_proxy wake-relay:8787\n}\n' "$H" | sudo tee "$F" >/dev/null
sudo docker exec proxy caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile 2>&1 | tail -1
sudo docker exec proxy caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile
REMOTE
sleep 20
curl -s -X POST https://51-79-223-252.sslip.io/wake; echo
