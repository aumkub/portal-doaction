# Wake relay

Client sites behind Cloudflare with bot protection answer a call from a
Cloudflare Worker with HTTP 403, so the portal's wake never arrives. The relay
sends the same signed call from a normal server instead. It only forwards to
`https://<public host>/?rest_route=/doaction-care/v1/wake`, and the site still
checks the portal's HMAC signature, so the relay holds no site secrets.

## Install (Ubuntu/Debian, Node 18+)

```bash
sudo mkdir -p /opt/wake-relay && sudo cp wake-relay.mjs /opt/wake-relay/
openssl rand -hex 32   # the RELAY_SECRET; keep it for the portal too
```

`/etc/systemd/system/wake-relay.service`:

```ini
[Unit]
Description=Do Action Care wake relay
After=network-online.target

[Service]
Environment=RELAY_SECRET=<secret>
Environment=PORT=8787
ExecStart=/usr/bin/node /opt/wake-relay/wake-relay.mjs
Restart=always
DynamicUser=yes
NoNewPrivileges=yes
ProtectSystem=strict
ProtectHome=yes

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload && sudo systemctl enable --now wake-relay
```

The relay listens on 127.0.0.1 only. Put HTTPS in front, e.g. Caddy:

```
relay.doaction.co.th {
  reverse_proxy 127.0.0.1:8787
}
```

## Portal

```bash
npx wrangler secret put WAKE_RELAY_URL      # https://relay.doaction.co.th/wake
npx wrangler secret put WAKE_RELAY_SECRET   # same value as RELAY_SECRET
```

Remove both secrets to go back to waking sites directly from the Worker.
