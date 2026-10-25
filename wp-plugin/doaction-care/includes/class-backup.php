<?php
/**
 * Reads what the site's backup plugin recorded about its last backup.
 * Supports UpdraftPlus and All-in-One WP Migration (incl. Pro scheduled
 * backups to Google Drive). Only times, sizes, statuses and yes/no flags
 * leave the site, never tokens or passwords.
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class DoAction_Care_Backup {

	/** @return array<string,mixed> */
	public static function status() {
		// Backup tools change their storage between versions; never let that break the heartbeat.
		$sources = array();
		foreach ( array( 'updraft', 'ai1wm' ) as $reader ) {
			try {
				$src = self::$reader();
			} catch ( Throwable $e ) {
				$src = null;
			}
			if ( $src ) {
				$sources[] = $src;
			}
		}
		$last    = 0;
		foreach ( $sources as $src ) {
			$last = max( $last, (int) $src['last_at'] );
		}
		return array(
			'last_at' => $last ? $last : null,
			'sources' => array_values( $sources ),
		);
	}

	/** All-in-One WP Migration is active: only then is a backup date worth showing in wp-admin. */
	public static function ai1wm_active() {
		if ( ! function_exists( 'is_plugin_active' ) ) {
			require_once ABSPATH . 'wp-admin/includes/plugin.php';
		}
		return is_plugin_active( 'all-in-one-wp-migration/all-in-one-wp-migration.php' );
	}

	/** Seconds since the newest backup any supported tool recorded, or null. */
	public static function latest_age() {
		$s = self::status();
		return $s['last_at'] ? max( 0, time() - (int) $s['last_at'] ) : null;
	}

	/** @return array<string,mixed>|null */
	private static function updraft() {
		$last = get_option( 'updraft_last_backup' );
		if ( ! is_array( $last ) || empty( $last['backup_time'] ) ) {
			return null;
		}
		$errors = isset( $last['errors'] ) && is_array( $last['errors'] ) ? count( $last['errors'] ) : 0;
		return array(
			'tool'     => 'updraftplus',
			'last_at'  => (int) $last['backup_time'],
			'ok'       => ! empty( $last['success'] ) && 0 === $errors,
			'remote'   => self::updraft_remote(),
			'files'    => array(),
		);
	}

	private static function updraft_remote() {
		$service = get_option( 'updraft_service' );
		$service = is_array( $service ) ? $service : array( $service );
		return array_values( array_filter( array_map( 'strval', $service ), static function ( $s ) {
			return '' !== $s && 'none' !== $s;
		} ) );
	}

	/**
	 * All-in-One WP Migration. Scheduled backups (Pro / extensions) live in
	 * `ai1wmke_schedule_events`; each event's runs are logged in
	 * `ai1wmke_schedule_event_log_{id}`. "Success" is logged only after the
	 * upload step (e.g. Google Drive) has finished.
	 *
	 * @return array<string,mixed>|null
	 */
	private static function ai1wm() {
		$files = array();
		foreach ( (array) glob( WP_CONTENT_DIR . '/ai1wm-backups/*.wpress' ) as $path ) {
			$files[] = array(
				'name' => basename( $path ),
				'size' => (int) filesize( $path ),
				'at'   => (int) filemtime( $path ),
			);
		}
		usort( $files, static function ( $a, $b ) {
			return $b['at'] - $a['at'];
		} );
		$files = array_slice( $files, 0, 3 );

		$events = array();
		$raw    = get_option( 'ai1wmke_schedule_events', array() );
		foreach ( is_array( $raw ) ? $raw : array() as $e ) {
			$e = self::event_fields( $e );
			if ( ! $e || empty( $e['event_id'] ) || ( isset( $e['type'] ) && 'Export' !== $e['type'] ) ) {
				continue;
			}
			$id      = (string) $e['event_id'];
			$log     = get_option( 'ai1wmke_schedule_event_log_' . $id, array() );
			$success = null;
			$failed  = null;
			$error   = null;
			foreach ( is_array( $log ) ? $log : array() as $rec ) {
				$at = isset( $rec['time'] ) ? (int) $rec['time'] : 0;
				$st = isset( $rec['status'] ) ? (string) $rec['status'] : '';
				if ( 'Success' === $st && null === $success ) {
					$success = $at;
				} elseif ( 'Failed' === $st && null === $failed ) {
					$failed = $at;
					$error  = isset( $rec['message'] ) ? wp_strip_all_tags( (string) $rec['message'] ) : null;
				}
			}
			$events[] = array(
				'title'           => isset( $e['title'] ) ? wp_strip_all_tags( (string) $e['title'] ) : '',
				'storage'         => isset( $e['storage'] ) ? (string) $e['storage'] : 'file',
				'enabled'         => isset( $e['status'] ) && 'Enabled' === $e['status'],
				'interval'        => isset( $e['schedule']['interval'] ) ? (string) $e['schedule']['interval'] : '',
				'last_status'     => (string) get_option( 'ai1wmke_schedule_event_last_run_' . $id, 'None' ),
				'last_success_at' => $success,
				'last_failed_at'  => $failed,
				'last_error'      => $error ? substr( $error, 0, 300 ) : null,
			);
		}

		if ( ! function_exists( 'is_plugin_active' ) ) {
			require_once ABSPATH . 'wp-admin/includes/plugin.php';
		}
		$active = is_plugin_active( 'all-in-one-wp-migration/all-in-one-wp-migration.php' );
		if ( ! $active && ! $files && ! $events ) {
			return null;
		}

		$times  = wp_list_pluck( $files, 'at' );
		$remote = array();
		$ok     = null;
		foreach ( $events as $ev ) {
			if ( ! $ev['enabled'] ) {
				continue;
			}
			if ( $ev['last_success_at'] ) {
				$times[] = $ev['last_success_at'];
				if ( 'file' !== $ev['storage'] ) {
					$remote[] = 'gdrive' === $ev['storage'] ? 'googledrive' : $ev['storage'];
				}
			}
			$ok = ( false !== $ok ) && 'Failed' !== $ev['last_status'];
		}
		return array(
			'tool'          => 'ai1wm',
			'last_at'       => $times ? max( $times ) : 0,
			'ok'            => $ok,
			'remote'        => array_values( array_unique( $remote ) ),
			'files'         => $files,
			'events'        => array_slice( $events, 0, 10 ),
			'drive_linked'  => '' !== (string) get_option( 'ai1wmke_gdrive_token', '' ),
		);
	}

	/**
	 * Pro stores events as serialized Ai1wmke_Schedule_Event objects (protected
	 * properties). Read them even when Pro is inactive (incomplete class).
	 *
	 * @param mixed $e
	 * @return array<string,mixed>|null
	 */
	private static function event_fields( $e ) {
		if ( is_array( $e ) ) {
			return $e;
		}
		if ( ! is_object( $e ) ) {
			return null;
		}
		if ( ! ( $e instanceof __PHP_Incomplete_Class ) && method_exists( $e, 'to_array' ) ) {
			return (array) $e->to_array();
		}
		$out = array();
		foreach ( (array) $e as $k => $v ) {
			$out[ preg_replace( '/^\0[^\0]*\0/', '', (string) $k ) ] = $v;
		}
		return $out;
	}

}
