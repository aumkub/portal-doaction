<?php
/**
 * Plugin Name:       do action Care
 * Plugin URI:        https://doaction.co.th
 * Description:       Connects this site to the do action client portal: reports versions and available updates, runs updates the do action team starts (with checks and automatic rollback), and shows a care summary on the dashboard.
 * Version:           0.2.0
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

define( 'DOACTION_CARE_VERSION', '0.2.0' );
define( 'DOACTION_CARE_CRON_HOOK', 'doaction_care_heartbeat' );
define( 'DOACTION_CARE_OPTION', 'doaction_care_settings' );
define( 'DOACTION_CARE_POLL_HOOK', 'doaction_care_poll' );

require_once __DIR__ . '/includes/class-api-client.php';
require_once __DIR__ . '/includes/class-inventory.php';
require_once __DIR__ . '/includes/class-admin.php';
require_once __DIR__ . '/includes/class-runner.php';
require_once __DIR__ . '/includes/class-widget.php';

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
add_action( DOACTION_CARE_CRON_HOOK, array( 'DoAction_Care_Runner', 'poll' ), 20 );
add_action( DOACTION_CARE_POLL_HOOK, array( 'DoAction_Care_Runner', 'poll' ) );

// The portal's wake call carries no command: it only makes the site pull its jobs now.
add_action(
	'rest_api_init',
	static function () {
		register_rest_route(
			'doaction-care/v1',
			'/wake',
			array(
				'methods'             => 'POST',
				'permission_callback' => array( 'DoAction_Care_Api_Client', 'verify_portal_request' ),
				'callback'            => static function () {
					if ( ! wp_next_scheduled( DOACTION_CARE_POLL_HOOK ) ) {
						wp_schedule_single_event( time(), DOACTION_CARE_POLL_HOOK );
					}
					spawn_cron();
					return new WP_REST_Response( array( 'ok' => true ), 202 );
				},
			)
		);
	}
);

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
		wp_clear_scheduled_hook( DOACTION_CARE_POLL_HOOK );
	}
);

if ( is_admin() ) {
	DoAction_Care_Admin::init();
	DoAction_Care_Widget::init();
}
