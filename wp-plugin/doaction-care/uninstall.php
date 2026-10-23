<?php
if ( ! defined( 'WP_UNINSTALL_PLUGIN' ) ) {
	exit;
}
delete_option( 'doaction_care_settings' );
wp_clear_scheduled_hook( 'doaction_care_heartbeat' );
wp_clear_scheduled_hook( 'doaction_care_poll' );
wp_clear_scheduled_hook( 'doaction_care_wake' );
delete_option( 'doaction_care_pending_restore' );
delete_transient( 'doaction_care_db_size' );
// Pre-update backups (zips of old plugin/theme versions).
$doaction_care_backups = WP_CONTENT_DIR . '/doaction-care-backup';
if ( is_dir( $doaction_care_backups ) ) {
	require_once ABSPATH . 'wp-admin/includes/file.php';
	if ( WP_Filesystem() ) {
		global $wp_filesystem;
		$wp_filesystem->delete( $doaction_care_backups, true );
	}
}
