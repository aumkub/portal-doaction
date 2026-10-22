<?php
/**
 * Plugin Name:       do action Care
 * Plugin URI:        https://doaction.co.th
 * Description:       Connects this site to the do action client portal and reports a read-only inventory (versions, plugins, themes, available updates). It never executes remote commands.
 * Version:           0.1.0
 * Requires at least: 6.0
 * Requires PHP:      7.4
 * Author:            do action
 * License:           GPL-2.0-or-later
 * License URI:       https://www.gnu.org/licenses/gpl-2.0.html
 * Text Domain:       doaction-care
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

define( 'DOACTION_CARE_VERSION', '0.1.0' );
define( 'DOACTION_CARE_CRON_HOOK', 'doaction_care_heartbeat' );
define( 'DOACTION_CARE_OPTION', 'doaction_care_settings' );

require_once __DIR__ . '/includes/class-api-client.php';
require_once __DIR__ . '/includes/class-inventory.php';
require_once __DIR__ . '/includes/class-admin.php';

add_filter(
	'cron_schedules',
	static function ( $schedules ) {
		$schedules['doaction_care_15min'] = array(
			'interval' => 15 * MINUTE_IN_SECONDS,
			'display'  => 'Every 15 minutes (do action Care)',
		);
		return $schedules;
	}
);

add_action( DOACTION_CARE_CRON_HOOK, array( 'DoAction_Care_Api_Client', 'send_heartbeat' ) );

register_activation_hook(
	__FILE__,
	static function () {
		if ( ! wp_next_scheduled( DOACTION_CARE_CRON_HOOK ) ) {
			wp_schedule_event( time() + 60, 'doaction_care_15min', DOACTION_CARE_CRON_HOOK );
		}
	}
);

register_deactivation_hook(
	__FILE__,
	static function () {
		wp_clear_scheduled_hook( DOACTION_CARE_CRON_HOOK );
	}
);

if ( is_admin() ) {
	DoAction_Care_Admin::init();
}
