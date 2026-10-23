<?php
/**
 * Collects a read-only snapshot of the site. Nothing here modifies the site.
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class DoAction_Care_Inventory {

	/** @return array<string,mixed> */
	public static function collect() {
		global $wpdb;

		if ( ! function_exists( 'get_plugins' ) ) {
			require_once ABSPATH . 'wp-admin/includes/plugin.php';
		}
		if ( ! function_exists( 'get_core_updates' ) ) {
			require_once ABSPATH . 'wp-admin/includes/update.php';
		}

		$plugin_updates = get_site_transient( 'update_plugins' );
		$theme_updates  = get_site_transient( 'update_themes' );
		$auto_plugins   = (array) get_site_option( 'auto_update_plugins', array() );

		$plugins = array();
		foreach ( get_plugins() as $file => $data ) {
			$update    = ( is_object( $plugin_updates ) && isset( $plugin_updates->response[ $file ]->new_version ) )
				? (string) $plugin_updates->response[ $file ]->new_version : null;
			$plugins[] = array(
				'slug'           => (string) $file,
				'name'           => wp_strip_all_tags( (string) $data['Name'] ),
				'version'        => (string) $data['Version'],
				'active'         => is_plugin_active( $file ),
				'update_version' => $update,
				'update_blocked' => $update ? DoAction_Care_Runner::incompatibility( (array) $plugin_updates->response[ $file ] ) : null,
				'auto_update'    => in_array( $file, $auto_plugins, true ),
			);
		}

		$active_theme = get_stylesheet();
		$themes       = array();
		foreach ( wp_get_themes() as $slug => $theme ) {
			$update   = ( is_object( $theme_updates ) && isset( $theme_updates->response[ $slug ]['new_version'] ) )
				? (string) $theme_updates->response[ $slug ]['new_version'] : null;
			$themes[] = array(
				'slug'           => (string) $slug,
				'name'           => wp_strip_all_tags( (string) $theme->get( 'Name' ) ),
				'version'        => (string) $theme->get( 'Version' ),
				'active'         => ( $slug === $active_theme || $slug === get_template() ),
				'update_version' => $update,
				'update_blocked' => $update ? DoAction_Care_Runner::incompatibility( (array) $theme_updates->response[ $slug ] ) : null,
			);
		}

		$core_update  = null;
		$core_blocked = null;
		$core         = get_core_updates();
		if ( is_array( $core ) && isset( $core[0]->response ) && 'upgrade' === $core[0]->response ) {
			$core_update = (string) $core[0]->current;
			if ( ! empty( $core[0]->php_version ) && ! is_php_version_compatible( (string) $core[0]->php_version ) ) {
				$core_blocked = 'WordPress ' . $core_update . ' ต้องใช้ PHP ' . $core[0]->php_version . ' ขึ้นไป แต่เว็บนี้ใช้ PHP ' . PHP_VERSION;
			}
		}

		$disk_free = null;
		if ( function_exists( 'disk_free_space' ) ) {
			$free = @disk_free_space( ABSPATH ); // phpcs:ignore WordPress.PHP.NoSilencedErrors.Discouraged
			if ( false !== $free ) {
				$disk_free = round( $free / 1048576, 1 );
			}
		}

		// information_schema can be slow on shared MySQL: measure at most twice a day.
		$db_size = get_transient( 'doaction_care_db_size' );
		$size    = false !== $db_size ? null : $wpdb->get_var( $wpdb->prepare( 'SELECT SUM(data_length + index_length) FROM information_schema.TABLES WHERE table_schema = %s', DB_NAME ) ); // phpcs:ignore WordPress.DB.DirectDatabaseQuery
		if ( null !== $size ) {
			$db_size = round( (float) $size / 1048576, 1 );
			set_transient( 'doaction_care_db_size', $db_size, 12 * HOUR_IN_SECONDS );
		}
		$db_size = false === $db_size ? null : (float) $db_size;

		$file_mods = ! ( defined( 'DISALLOW_FILE_MODS' ) && DISALLOW_FILE_MODS );
		if ( $file_mods && defined( 'FS_METHOD' ) && 'direct' !== FS_METHOD ) {
			$file_mods = false;
		}

		$health = null;
		$cached = get_transient( 'health-check-site-status-result' );
		if ( is_string( $cached ) ) {
			$decoded = json_decode( $cached, true );
			if ( is_array( $decoded ) && isset( $decoded['good'], $decoded['recommended'], $decoded['critical'] ) ) {
				$health = array(
					'good'        => (int) $decoded['good'],
					'recommended' => (int) $decoded['recommended'],
					'critical'    => (int) $decoded['critical'],
				);
			}
		}

		// Read from disk: right after a self-update the constant still holds the old version.
		$self = get_file_data( DOACTION_CARE_FILE, array( 'Version' => 'Version' ) );

		return array(
			'plugin_version'    => $self['Version'] ? (string) $self['Version'] : DOACTION_CARE_VERSION,
			'wp_version'        => (string) get_bloginfo( 'version' ),
			'php_version'       => PHP_VERSION,
			'mysql_version'     => (string) $wpdb->db_version(),
			'site_url'          => site_url(),
			'home_url'          => home_url(),
			'is_multisite'      => is_multisite(),
			'plugins'           => $plugins,
			'themes'            => $themes,
			'core_update'       => $core_update,
			'core_update_blocked' => $core_blocked,
			'disk_free_mb'      => $disk_free,
			'db_size_mb'        => $db_size,
			'file_mods_allowed' => $file_mods,
			'site_health'       => $health,
			'backup'            => DoAction_Care_Backup::status(),
		);
	}
}
