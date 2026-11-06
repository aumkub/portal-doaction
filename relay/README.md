# Wake relay

Client sites behind Cloudflare with bot protection answer a call from a
Cloudflare Worker with HTTP 403, so the portal's wake never arrives. The relay
sends the same signed call from a normal server instead. It only forwards to
`https://<public host>/?rest_route=/doaction-care/v1/wake`, and the site still
checks the portal's HMAC signature, so the relay holds no site secrets.

## Install

It runs as the `wake-relay` container on the VPS (187.53.130.168), behind the shared
Caddy at `https://187-53-130-168.sslip.io/wake`. Install or update from the repo root:

```bash
bash relay/install.sh
```

## Portal

```bash
npx wrangler secret put WAKE_RELAY_URL      # https://187-53-130-168.sslip.io/wake (not a doaction.co.th name: same-zone Worker fetches loop)
npx wrangler secret put WAKE_RELAY_SECRET   # same value as RELAY_SECRET
```

Remove both secrets to go back to waking sites directly from the Worker.
