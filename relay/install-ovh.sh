#!/usr/bin/env bash
# Installs the wake relay on the OVH server next to the PDPC stack:
# a locked-down node:22-alpine container on the "web" network, plus a
# relay.<domain> block in /opt/pdpc/deploy/Caddyfile (validated before reload).
#
# Run from the repo root on your Mac:  bash relay/install-ovh.sh
# Needs: DNS A record relay.doaction.co.th -> 51.79.223.252 set to "DNS only".
set -euo pipefail

SERVER=ubuntu@51.79.223.252
RELAY_HOST=relay.doaction.co.th

scp -q relay/wake-relay.mjs "$SERVER:/tmp/wake-relay.mjs"

ssh "$SERVER" RELAY_HOST="$RELAY_HOST" bash -s <<'REMOTE'
set -euo pipefail
sudo mkdir -p /opt/wake-relay
sudo mv /tmp/wake-relay.mjs /opt/wake-relay/wake-relay.mjs
sudo chmod 644 /opt/wake-relay/wake-relay.mjs
if [ ! -f /opt/wake-relay/.env ]; then
  echo "RELAY_SECRET=$(openssl rand -hex 32)" | sudo tee /opt/wake-relay/.env >/dev/null
  sudo chmod 600 /opt/wake-relay/.env
fi

sudo docker rm -f wake-relay >/dev/null 2>&1 || true
sudo docker run -d --name wake-relay --restart unless-stopped --network web \
  --env-file /opt/wake-relay/.env -e HOST=0.0.0.0 -e PORT=8787 \
  --read-only --cap-drop ALL --security-opt no-new-privileges --memory 64m --user node \
  -v /opt/wake-relay/wake-relay.mjs:/app/wake-relay.mjs:ro \
  node:22-alpine node /app/wake-relay.mjs >/dev/null
sleep 3
sudo docker logs wake-relay

CADDYFILE=/opt/pdpc/deploy/Caddyfile
if ! sudo grep -q "^$RELAY_HOST " "$CADDYFILE"; then
  sudo cp "$CADDYFILE" "$CADDYFILE.bak-$(date +%Y%m%d%H%M%S)"
  printf '\n%s {\n\treverse_proxy wake-relay:8787\n}\n' "$RELAY_HOST" | sudo tee -a "$CADDYFILE" >/dev/null
fi
# Validate first; a bad config never reaches the running Caddy.
sudo docker exec pdpc-caddy-1 caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
sudo docker exec pdpc-caddy-1 caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile
echo "relay installed"
REMOTE

echo "Test (expect {\"error\":\"unauthorized\"}, the certificate may take a minute):"
sleep 20
curl -s -X POST "https://$RELAY_HOST/wake"; echo
