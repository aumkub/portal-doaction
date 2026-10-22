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
| **S0 — 2FA** | TOTP for admin and co-admin, recovery codes, login challenge, settings UI. Prerequisite for anything that changes client sites. Enforced for all staff; passkey or TOTP. | done |
| **P0 — Connect & see** | Pairing code, signed heartbeat every 15 min, inventory (WP/PHP, plugins, themes, updates, health, file-mods allowed), portal "connected sites" on the client page, revoke. Read-only. | done |
| **P1 — Client widget** | wp-admin dashboard widget: contract status, 30-day uptime (via portal, no API key in the plugin), last backup, updates done this month, open tickets, "แจ้งปัญหา" → ticket, short-lived link into the portal. Heartbeat silence alerts on the admin overview. | done (uptime and portal sign-in link left out, see below) |
| **P2 — Safe update (manual)** | Command queue in D1, per-site lock, one-click update from the portal: pre-check → keep previous version → update one item → post-check (homepage + key URLs, fatal-error text, PHP log) → auto rollback. Progress view, audit log, emergency "stop all". Requires S0 enforced for admins. | done |
| **P3 — Policies & reports** | Update windows (night, Bangkok), auto for minor/security, approval for major, exclusions, staged rollout, per-host concurrency. Update history auto-fills monthly report tasks. | done as night window + report auto-fill |
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
  - The WebDAV backup screens were removed (migration 0021); backup status
    now comes only from the plugin (UpdraftPlus / All-in-One WP Migration).
- **Updates are always started by the team** (no automatic updates). P3's
  "policies" become saved selections + update windows, still launched by a
  person.
- **We build the update runner ourselves** (no MainWP), keeping the fixed
  command list and signing rules above.

## How P1–P3 work (2026-10-22)

- **Jobs.** `site_jobs` (migration 0019) is the queue and the audit log. A
  job is one item: plugin, theme or core. Only items the site's own latest
  inventory lists as updatable can be queued.
- **Start.** The team picks items on `/admin/sites` or the client page. The
  portal queues them and sends a signed, content-free "wake" to
  `?rest_route=/doaction-care/v1/wake`; the plugin schedules a cron run and
  pulls `/agent/v1/jobs/next`. Without the wake, jobs start at the next
  15-minute heartbeat. "Night" jobs carry `not_before` = next 01:00 Bangkok.
- **Run (plugin/theme).** Check `/` and `/wp-login.php` over HTTP → copy the
  current files to `wp-content/doaction-care-backup/` → upgrade → wait for
  opcache → check again → on failure restore the copy and check again.
  Result `succeeded`, `rolled_back` or `failed` (failed after a restore means
  "check the site now").
- **Run (core).** Refused unless UpdraftPlus reports a backup newer than 24 h.
  No automatic rollback; a broken check is reported as failed.
- **Safety.** One running job per site (unique index). Stop-all is the KV flag
  `care:paused`; it cancels everything queued. Cron fails jobs running > 20
  min and cancels jobs not picked up within 24 h. Re-pairing a site revokes its
  older pairing. Updates are offered only for sites heard from in the last 2 h.
- **Reports.** Successful jobs become maintenance tasks in that month's report:
  immediately if a draft exists, otherwise when the report is created.
- **Widget.** wp-admin dashboard: contract end, updates this month, open
  tickets, last backup, and "report a problem" which opens a ticket as the
  client's user.

### Not built yet

- One-click portal sign-in link from wp-admin (it would be a login
  credential inside the client's wp-admin; left out on purpose).
- P4: vulnerability feed (needs a Patchstack/WPScan API key), before/after
  screenshots (needs Cloudflare Browser Rendering), external security review.

## Signed plugin self-update (P4)

- Key pair: Ed25519. The private key is only on the release machine at
  `~/.config/doaction-care/signing.key`; back it up offline. The public key is
  `DOACTION_CARE_PUBKEY` in the plugin.
- Release: bump `Version` and `DOACTION_CARE_VERSION`, then
  `node scripts/release-care-plugin.mjs`. It zips, signs and uploads the zip
  and `care-plugin/latest.json` to R2.
- Sites learn of the release from the heartbeat reply, WordPress offers it as
  a normal update, and `upgrader_pre_download` installs it only if the
  signature verifies. The team can also push it from the portal as a job.
