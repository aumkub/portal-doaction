=== do action Care ===
Contributors: doaction
Requires at least: 6.0
Tested up to: 6.6
Requires PHP: 7.4
Stable tag: 0.1.0
License: GPLv2 or later
License URI: https://www.gnu.org/licenses/gpl-2.0.html

Connects a WordPress site to the do action client portal and reports a read-only inventory.

== Description ==
Every 15 minutes (WP-Cron) the plugin sends a signed (HMAC-SHA256) snapshot to the portal:
WordPress/PHP/MySQL versions, plugins and themes with available updates, core update,
disk free, database size, whether file modifications are allowed, and Site Health counts.

The plugin never accepts or executes remote commands. The portal never connects to the site.

== Installation ==
1. Upload the `doaction-care` folder to `/wp-content/plugins/` and activate it.
2. Go to Settings → do action Care.
3. Enter the portal URL and the one-time pairing code from do action, then click "เชื่อมต่อ".

== Changelog ==
= 0.1.0 =
* Initial read-only release.
