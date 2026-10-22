# Remote site care — phased plan

A WordPress plugin ("do action Care") paired with the portal, so the team
can see every client site's state, run safe updates, and feed the monthly
report — without storing client admin passwords.

## Principles

- **Pull only.** The plugin calls the portal; the portal never calls the
  site. Works behind WAFs and keeps the plugin's attack surface tiny.
- **Fixed command list.** The plugin will only ever accept: inventory,
  health check, update plugin/theme/core. Never arbitrary PHP, SQL or file
  writes. A compromised portal can at worst trigger normal updates.
- **Signed both ways.** HMAC-SHA256 over timestamp + nonce + body hash,
  ±5 min clock window, nonce replay protection, per-site secret, instant
  revoke.
- **Async jobs.** Long work runs on the client server one item per step;
  every portal request is short. Workers usage stays far below free limits.
- **Never punish the site.** Contract expiry only stops remote work and
  shows a wp-admin notice; the public site is never changed.

## Phases

| Phase | Scope | Status |
|---|---|---|
| **S0 — 2FA** | TOTP for admin and co-admin, recovery codes, login challenge, settings UI. Prerequisite for anything that changes client sites. | in progress |
| **P0 — Connect & see** | Pairing code, signed heartbeat every 15 min, inventory (WP/PHP, plugins, themes, updates, health, file-mods allowed), portal "connected sites" on the client page, revoke. Read-only. | in progress |
| **P1 — Client widget** | wp-admin dashboard widget: contract status, 30-day uptime (via portal, no API key in the plugin), last backup, updates done this month, open tickets, "แจ้งปัญหา" → ticket, short-lived link into the portal. Heartbeat silence alerts on the admin overview. | planned |
| **P2 — Safe update (manual)** | Command queue in D1, per-site lock, one-click update from the portal: pre-check → keep previous version → update one item → post-check (homepage + key URLs, fatal-error text, PHP log) → auto rollback. Progress view, audit log, emergency "stop all". Requires S0 enforced for admins. | planned |
| **P3 — Policies & reports** | Update windows (night, Bangkok), auto for minor/security, approval for major, exclusions, staged rollout, per-host concurrency. Update history auto-fills monthly report tasks. | planned |
| **P4 — Hardening & extras** | Vulnerability feed (Patchstack/WPScan), signed plugin self-update from our server (signing key kept off Cloudflare), before/after screenshots, external security review of the plugin before wide rollout. | planned |

## Decisions (2026-10-22)

- **All clients run WordPress.** No non-WP path needed beyond uptime/tickets.
- **Backups now go to Google Drive** (WebDAV was unreliable and is no longer
  used). Pre-update safety therefore cannot depend on WebDAV:
  - P2 keeps the previous version of each updated plugin/theme on the site
    itself, so a failed update rolls back in seconds without any backup.
  - For core/major updates, P2 checks the age of the latest Drive backup
    (reported by the plugin from the backup tool in use, e.g. UpdraftPlus)
    and blocks or warns when it is older than 24 h.
  - The portal's WebDAV backup screens should later be replaced by Google
    Drive backup status.
- **Updates are always started by the team** (no automatic updates). P3's
  "policies" become saved selections + update windows, still launched by a
  person.
- **We build the update runner ourselves** (no MainWP), keeping the fixed
  command list and signing rules above.
