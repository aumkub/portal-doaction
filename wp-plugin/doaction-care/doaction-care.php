<?php
/**
 * Plugin Name:       Do Action: Care
 * Plugin URI:        https://doaction.co.th
 * Description:       Connects this site to the do action client portal: reports versions and available updates, runs updates the do action team starts (with checks and automatic rollback), and shows a care summary on the dashboard.
 * Version:           0.5.0
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

define( 'DOACTION_CARE_VERSION', '0.5.0' );
define( 'DOACTION_CARE_FILE', __FILE__ );
if ( ! defined( 'DOACTION_CARE_PORTAL' ) ) {
	define( 'DOACTION_CARE_PORTAL', 'https://portal.doaction.co.th' );
}
define( 'DOACTION_CARE_CRON_HOOK', 'doaction_care_heartbeat' );
define( 'DOACTION_CARE_OPTION', 'doaction_care_settings' );
define( 'DOACTION_CARE_POLL_HOOK', 'doaction_care_poll' );
// Ed25519 public key for signed self-updates (private key stays on the release machine).
define( 'DOACTION_CARE_PUBKEY', 'K24PewIlSU0GbgObclSRej0DQNT/zUhtwRDNDTDnbd4=' );

// Classes load on first use, so a normal page view only reads this file.
spl_autoload_register(
	static function ( $class ) {
		$map = array(
			'DoAction_Care_Api_Client' => 'class-api-client.php',
			'DoAction_Care_Inventory'  => 'class-inventory.php',
			'DoAction_Care_Admin'      => 'class-admin.php',
			'DoAction_Care_Backup'     => 'class-backup.php',
			'DoAction_Care_Runner'     => 'class-runner.php',
			'DoAction_Care_Widget'     => 'class-widget.php',
			'DoAction_Care_Updater'    => 'class-updater.php',
		);
		if ( isset( $map[ $class ] ) ) {
			require_once __DIR__ . '/includes/' . $map[ $class ];
		}
	}
);

DoAction_Care_Updater::init();

define( 'DOACTION_CARE_WAKE_HOOK', 'doaction_care_wake' );

/** Heartbeat runs hourly; sites scheduled by older versions (every 15 min) are moved over. */
function doaction_care_ensure_schedule() {
	if ( 'hourly' !== wp_get_schedule( DOACTION_CARE_CRON_HOOK ) ) {
		wp_clear_scheduled_hook( DOACTION_CARE_CRON_HOOK );
		wp_schedule_event( time() + 60, 'hourly', DOACTION_CARE_CRON_HOOK );
	}
}
add_action( 'init', 'doaction_care_ensure_schedule' );

define( 'DOACTION_CARE_DUE_OPTION', 'doaction_care_due' );
define( 'DOACTION_CARE_DUE_EVERY', 5 * MINUTE_IN_SECONDS );

/**
 * While the portal has jobs waiting for this site, the next ordinary page view
 * (at most once per 5 minutes) sends a heartbeat and pulls jobs after its
 * response is finished. This works when the portal's wake call is blocked by
 * the site's firewall/CDN and WP-cron's loopback is blocked too. When nothing is
 * waiting the option is absent and this costs one autoloaded option read.
 */
function doaction_care_due_check() {
	$due = get_option( DOACTION_CARE_DUE_OPTION );
	if ( false === $due || (int) $due > time() || wp_doing_cron() || ( defined( 'WP_INSTALLING' ) && WP_INSTALLING ) ) {
		return;
	}
	global $wpdb;
	// Claim this slot atomically so concurrent page views run it once.
	$claimed = $wpdb->query( $wpdb->prepare( "UPDATE {$wpdb->options} SET option_value = %s WHERE option_name = %s AND option_value = %s", (string) ( time() + DOACTION_CARE_DUE_EVERY ), DOACTION_CARE_DUE_OPTION, (string) $due ) ); // phpcs:ignore WordPress.DB.DirectDatabaseQuery
	wp_cache_delete( 'alloptions', 'options' );
	if ( 1 !== $claimed ) {
		return;
	}
	ignore_user_abort( true );
	if ( function_exists( 'fastcgi_finish_request' ) ) {
		fastcgi_finish_request();
	} elseif ( function_exists( 'litespeed_finish_request' ) ) {
		litespeed_finish_request();
	} else {
		return; // Can't detach from the visitor's request: leave it to cron.
	}
	do_action( DOACTION_CARE_WAKE_HOOK );
}
add_action( 'shutdown', 'doaction_care_due_check', PHP_INT_MAX );

// Health probe used by the runner around updates: answers only to the
// one-time token it just stored, after every plugin and the theme loaded.
add_action(
	'template_redirect',
	static function () {
		if ( ! isset( $_GET['doaction_care_check'] ) ) { // phpcs:ignore WordPress.Security.NonceVerification.Recommended
			return;
		}
		$token = (string) get_transient( 'doaction_care_check_token' );
		if ( '' === $token || ! hash_equals( $token, (string) wp_unslash( $_GET['doaction_care_check'] ) ) ) { // phpcs:ignore WordPress.Security.NonceVerification.Recommended, WordPress.Security.ValidatedSanitizedInput.InputNotSanitized
			return;
		}
		nocache_headers();
		header( 'Content-Type: text/plain; charset=utf-8' );
		echo 'DOACTION_CARE_OK:' . esc_html( $token );
		exit;
	},
	0
);

add_action( DOACTION_CARE_CRON_HOOK, array( 'DoAction_Care_Api_Client', 'send_heartbeat' ) );
add_action( DOACTION_CARE_CRON_HOOK, array( 'DoAction_Care_Runner', 'poll' ), 20 );
add_action( DOACTION_CARE_POLL_HOOK, array( 'DoAction_Care_Runner', 'poll' ) );
add_action( DOACTION_CARE_WAKE_HOOK, array( 'DoAction_Care_Api_Client', 'send_heartbeat' ) );
add_action( DOACTION_CARE_WAKE_HOOK, array( 'DoAction_Care_Runner', 'poll' ), 20 );

// The portal's wake call carries no command: the site sends fresh data and pulls its jobs now.
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
					// Do the work in this request after the reply is sent, instead of
					// relying on WP-cron's loopback (often blocked by WAFs/CDNs).
					add_action(
						'shutdown',
						static function () {
							ignore_user_abort( true );
							if ( function_exists( 'fastcgi_finish_request' ) ) {
								fastcgi_finish_request();
							} elseif ( function_exists( 'litespeed_finish_request' ) ) {
								litespeed_finish_request();
							}
							do_action( DOACTION_CARE_WAKE_HOOK );
						},
						PHP_INT_MAX
					);
					return new WP_REST_Response( array( 'ok' => true ), 202 );
				},
			)
		);
	}
);

register_activation_hook(
	__FILE__,
	static function () {
		doaction_care_ensure_schedule();
	}
);

register_deactivation_hook(
	__FILE__,
	static function () {
		wp_clear_scheduled_hook( DOACTION_CARE_CRON_HOOK );
		wp_clear_scheduled_hook( DOACTION_CARE_POLL_HOOK );
		wp_clear_scheduled_hook( DOACTION_CARE_WAKE_HOOK );
		delete_option( DOACTION_CARE_DUE_OPTION );
	}
);

if ( is_admin() ) {
	DoAction_Care_Admin::init();
	DoAction_Care_Widget::init();
}
