#!/usr/bin/env bash
# Installs or updates the wake relay on the VPS (187.53.130.168, shared with ko and DEX):
# a locked-down node:22-alpine container on the "web" network, served by the shared
# Caddy (`proxy` container, one file per site in /opt/proxy/sites) on an sslip.io name.
#
# The sslip.io name sits outside Cloudflare on purpose: a Worker on the doaction.co.th
# zone cannot fetch a name in its own zone (308 loop). Caddy gets its own LE certificate.
#
# Run from the repo root on your Mac:  bash relay/install.sh
set -euo pipefail

SERVER=root@187.53.130.168
RELAY_HOST=187-53-130-168.sslip.io

scp -q relay/wake-relay.mjs "$SERVER:/tmp/wake-relay.mjs"

ssh "$SERVER" RELAY_HOST="$RELAY_HOST" bash -s <<'REMOTE'
set -euo pipefail
mkdir -p /opt/wake-relay
mv /tmp/wake-relay.mjs /opt/wake-relay/wake-relay.mjs
chmod 644 /opt/wake-relay/wake-relay.mjs
if [ ! -f /opt/wake-relay/.env ]; then
  (umask 077 && echo "RELAY_SECRET=$(openssl rand -hex 32)" > /opt/wake-relay/.env)
  echo "New RELAY_SECRET created: set the same value as WAKE_RELAY_SECRET in the portal."
fi

docker rm -f wake-relay >/dev/null 2>&1 || true
docker run -d --name wake-relay --restart unless-stopped --network web \
  --env-file /opt/wake-relay/.env -e HOST=0.0.0.0 -e PORT=8787 \
  --read-only --cap-drop ALL --security-opt no-new-privileges --memory 64m --user node \
  -v /opt/wake-relay/wake-relay.mjs:/app/wake-relay.mjs:ro \
  node:22-alpine node /app/wake-relay.mjs >/dev/null
sleep 3
docker logs wake-relay

printf '%s {\n\treverse_proxy wake-relay:8787\n}\n' "$RELAY_HOST" > /opt/proxy/sites/wake-relay.caddy
# Validate first; a bad config never reaches the running Caddy.
docker exec proxy caddy validate --config /etc/caddy/Caddyfile 2>&1 | tail -1
docker exec proxy caddy reload --config /etc/caddy/Caddyfile
echo "relay installed"
REMOTE

echo "Test (expect {\"error\":\"unauthorized\"}; a new certificate may take a minute):"
sleep 20
curl -s -X POST "https://$RELAY_HOST/wake"; echo
