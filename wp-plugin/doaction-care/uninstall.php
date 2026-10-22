<?php
if ( ! defined( 'WP_UNINSTALL_PLUGIN' ) ) {
	exit;
}
delete_option( 'doaction_care_settings' );
wp_clear_scheduled_hook( 'doaction_care_heartbeat' );
