<?php
/**
 * Runs update jobs pulled from the portal, one item at a time.
 *
 * The portal can only ask for: update plugin X, update theme Y, update core.
 * Each plugin/theme job: check the site works → copy the current files aside →
 * update → check the site over HTTP (a separate PHP process, so a fatal in the
 * new code can't kill this runner) → on failure put the old files back.
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class DoAction_Care_Runner {

	const LOCK           = 'doaction_care_runner_lock';
	const BACKUP_DIR     = 'doaction-care-backup';
	const MAX_RUN_TIME   = 60;   // no new job starts after this; keeps runs inside host PHP timeouts
	const PENDING        = 'doaction_care_pending_restore';
	const SELF           = 'doaction-care/doaction-care.php';

	/** @var string[] */
	private $log = array();

	/** Set when the site is left broken (or was already broken): the portal then stops this site's queue. */
	private $broken = false;

	/** Cron/wake entry point: run every due job, then refresh the inventory. */
	public static function poll() {
		if ( ! DoAction_Care_Api_Client::is_paired() || get_transient( self::LOCK ) ) {
			return;
		}
		require_once ABSPATH . 'wp-admin/includes/class-wp-upgrader.php';
		// Share WordPress's own updater lock so its background updates never run alongside ours.
		if ( ! WP_Upgrader::create_lock( 'auto_updater', 15 * MINUTE_IN_SECONDS ) ) {
			return;
		}
		set_transient( self::LOCK, time(), 15 * MINUTE_IN_SECONDS );
		ignore_user_abort( true );
		if ( function_exists( 'set_time_limit' ) ) {
			@set_time_limit( 600 ); // phpcs:ignore WordPress.PHP.NoSilencedErrors.Discouraged
		}
		$started      = time();
		$ran          = 0;
		$self_updated = false;
		$out_of_time  = false;
		try {
			self::recover_interrupted();
			while ( true ) {
				if ( time() - $started >= self::MAX_RUN_TIME ) {
					$out_of_time = true;
					break;
				}
				set_transient( self::LOCK, time(), 15 * MINUTE_IN_SECONDS );
				$res = DoAction_Care_Api_Client::signed_post( 'jobs/next', array( 'group' => true ) );
				if ( is_wp_error( $res ) || 200 !== $res['status'] || empty( $res['data']['job'] ) || ! is_array( $res['data']['job'] ) ) {
					break;
				}
				$job    = $res['data']['job'];
				$group  = ( ! empty( $res['data']['group'] ) && is_array( $res['data']['group'] ) ) ? array_values( array_filter( $res['data']['group'], 'is_array' ) ) : array();
				$runner = new self();
				// A plugin and its add-ons are updated together and checked once at the end.
				$results = $group ? $runner->run_group( array_merge( array( $job ), $group ) ) : array( (string) $job['id'] => $runner->run( $job ) );
				foreach ( $results as $job_id => $result ) {
					DoAction_Care_Api_Client::signed_post(
						'jobs/report',
						array(
							'job_id'         => (string) $job_id,
							'status'         => $result['status'],
							'result_version' => $result['version'],
							'site_broken'    => $runner->broken,
							'log'            => substr( implode( "\n", $runner->log ), 0, 7900 ),
						)
					);
				}
				++$ran;
				if ( $runner->broken ) {
					break; // The portal stops this site's queue; don't touch a broken site again.
				}
				// Our own files were just replaced; stop before old and new code mix.
				if ( self::SELF === (string) $job['slug'] ) {
					$self_updated = true;
					break;
				}
			}
		} finally {
			delete_transient( self::LOCK );
			WP_Upgrader::release_lock( 'auto_updater' );
		}
		// Work left: ask the portal to wake us again for the next batch (a
		// fresh request, so each batch stays inside the host's time limit).
		if ( $out_of_time || $self_updated ) {
			DoAction_Care_Api_Client::signed_post( 'jobs/continue', array() );
		}
		if ( $ran > 0 && ! $self_updated ) {
			wp_clean_plugins_cache( true );
			wp_clean_themes_cache( true );
			delete_site_transient( 'update_plugins' );
			delete_site_transient( 'update_themes' );
			wp_update_plugins();
			wp_update_themes();
			DoAction_Care_Api_Client::send_heartbeat();
		}
		self::prune_backups();
	}

	private function note( $line ) {
		$this->log[] = gmdate( 'H:i:s' ) . ' ' . $line;
	}

	/**
	 * @param array<string,mixed> $job
	 * @return array{status:string,version:?string}
	 */
	public function run( array $job ) {
		$kind = isset( $job['kind'] ) ? (string) $job['kind'] : '';
		$slug = isset( $job['slug'] ) ? (string) $job['slug'] : '';
		try {
			$this->load_admin();
			if ( is_multisite() ) {
				$this->note( 'เว็บแบบ multisite: อัปเดตมีผลทั้ง network ซึ่งระบบตรวจไม่ครบ — ไม่ได้ทำอะไร ให้อัปเดตด้วยตนเอง' );
				return $this->result( 'failed' );
			}
			if ( ! $this->file_mods_allowed() ) {
				$this->note( 'เว็บนี้ปิดการแก้ไขไฟล์ (DISALLOW_FILE_MODS / FS_METHOD) — ไม่ได้ทำอะไร' );
				return $this->result( 'failed' );
			}
			if ( 'plugin' === $kind ) {
				return $this->update_plugin( $slug );
			}
			if ( 'theme' === $kind ) {
				return $this->update_theme( $slug );
			}
			if ( 'core' === $kind ) {
				return $this->update_core();
			}
			$this->note( 'ไม่รู้จักงานประเภท ' . $kind );
			return $this->result( 'failed' );
		} catch ( Throwable $e ) {
			$this->note( 'ข้อผิดพลาด: ' . $e->getMessage() );
			return $this->result( 'failed' );
		} finally {
			$this->clear_maintenance();
		}
	}

	/** Adds the upgrader's own error text to the log when it failed. */
	private function note_skin( $skin, $ok ) {
		if ( true === $ok ) {
			return;
		}
		$messages = array_filter( array_map( 'wp_strip_all_tags', (array) $skin->get_upgrade_messages() ) );
		if ( isset( $skin->result ) && is_wp_error( $skin->result ) ) {
			$messages[] = $skin->result->get_error_message();
		}
		if ( $messages ) {
			$this->note( 'upgrader: ' . implode( ' | ', array_slice( $messages, -5 ) ) );
		}
	}

	/** @return array{status:string,version:?string} */
	private function result( $status, $version = null ) {
		return array(
			'status'  => $status,
			'version' => $version,
		);
	}

	// ── Plugins ───────────────────────────────────────────────────────────────

	private function update_plugin( $file ) {
		$plugins = get_plugins();
		if ( ! isset( $plugins[ $file ] ) || validate_file( $file ) !== 0 ) {
			$this->note( 'ไม่พบปลั๊กอิน ' . $file );
			return $this->result( 'failed' );
		}
		$from = (string) $plugins[ $file ]['Version'];
		wp_update_plugins();
		$updates = get_site_transient( 'update_plugins' );
		if ( ! is_object( $updates ) || empty( $updates->response[ $file ] ) ) {
			$this->note( 'ไม่มีอัปเดตสำหรับ ' . $file . ' แล้ว (เวอร์ชันปัจจุบัน ' . $from . ')' );
			return $this->result( 'succeeded', $from );
		}
		$this->note( 'ปลั๊กอิน ' . $plugins[ $file ]['Name'] . ' ' . $from . ' → ' . $updates->response[ $file ]->new_version );
		$why = self::incompatibility( (array) $updates->response[ $file ] );
		if ( $why ) {
			$this->note( 'ไม่อัปเดต: ' . $why );
			return $this->result( 'failed' );
		}

		$dir    = dirname( $file );
		$target = '.' === $dir ? WP_PLUGIN_DIR . '/' . $file : WP_PLUGIN_DIR . '/' . $dir;

		return $this->guarded_update(
			$target,
			function () use ( $file ) {
				$was_active = is_plugin_active( $file );
				$skin       = new Automatic_Upgrader_Skin();
				$upgrader   = new Plugin_Upgrader( $skin );
				$ok         = $upgrader->upgrade( $file );
				$this->note_skin( $skin, $ok );
				// Reactivate without loading the new code in this process; the HTTP check loads it.
				if ( $was_active && ! is_plugin_active( $file ) ) {
					$active = (array) get_option( 'active_plugins', array() );
					$active[] = $file;
					update_option( 'active_plugins', array_values( array_unique( $active ) ) );
					$this->note( 'เปิดใช้งานปลั๊กอินกลับเหมือนเดิม' );
				}
				return $ok;
			},
			function () use ( $file ) {
				wp_clean_plugins_cache( true );
				$p = get_plugins();
				return isset( $p[ $file ] ) ? (string) $p[ $file ]['Version'] : null;
			},
			$from,
			$file
		);
	}

	// ── Themes ────────────────────────────────────────────────────────────────

	private function update_theme( $slug ) {
		$theme = wp_get_theme( $slug );
		if ( ! $theme->exists() || validate_file( $slug ) !== 0 ) {
			$this->note( 'ไม่พบธีม ' . $slug );
			return $this->result( 'failed' );
		}
		$from = (string) $theme->get( 'Version' );
		wp_update_themes();
		$updates = get_site_transient( 'update_themes' );
		if ( ! is_object( $updates ) || empty( $updates->response[ $slug ] ) ) {
			$this->note( 'ไม่มีอัปเดตสำหรับธีม ' . $slug . ' แล้ว' );
			return $this->result( 'succeeded', $from );
		}
		$this->note( 'ธีม ' . $theme->get( 'Name' ) . ' ' . $from . ' → ' . $updates->response[ $slug ]['new_version'] );
		$why = self::incompatibility( (array) $updates->response[ $slug ] );
		if ( $why ) {
			$this->note( 'ไม่อัปเดต: ' . $why );
			return $this->result( 'failed' );
		}

		return $this->guarded_update(
			$theme->get_stylesheet_directory(),
			function () use ( $slug ) {
				$skin     = new Automatic_Upgrader_Skin();
				$upgrader = new Theme_Upgrader( $skin );
				$ok       = $upgrader->upgrade( $slug );
				$this->note_skin( $skin, $ok );
				return $ok;
			},
			function () use ( $slug ) {
				wp_clean_themes_cache( true );
				$t = wp_get_theme( $slug );
				return $t->exists() ? (string) $t->get( 'Version' ) : null;
			},
			$from
		);
	}

	/**
	 * Backup → update → HTTP check → restore on failure.
	 *
	 * @param callable():mixed    $update
	 * @param callable():?string  $version
	 * @return array{status:string,version:?string}
	 */
	private function guarded_update( $target, callable $update, callable $version, $from, $plugin_file = null ) {
		$before = $this->check_site();
		if ( ! $before['ok'] ) {
			$this->note( 'เว็บมีปัญหาอยู่แล้วก่อนอัปเดต: ' . $before['detail'] . ' — ไม่ได้อัปเดต' );
			$this->broken = true;
			return $this->result( 'failed' );
		}
		$this->note( 'ตรวจก่อนอัปเดต: ' . $before['detail'] );

		$backup = $this->backup( $target );
		if ( ! $backup ) {
			$this->note( 'สำรองไฟล์เดิมไม่สำเร็จ (หรือพื้นที่ดิสก์ไม่พอ) — ไม่ได้อัปเดต' );
			return $this->result( 'failed' );
		}
		$this->note( 'สำรองไฟล์เดิมไว้แล้ว' );
		// If PHP is killed from here on, the next run restores from this zip.
		update_option(
			self::PENDING,
			array(
				'target'     => $target,
				'zip'        => $backup,
				'from'       => $from,
				'plugin'     => $plugin_file,
				'was_active' => $plugin_file ? is_plugin_active( $plugin_file ) : false,
				'at'         => time(),
			),
			false
		);
		$result = $this->update_and_verify( $target, $update, $version, $from, $backup );
		delete_option( self::PENDING );
		return $result;
	}

	private function update_and_verify( $target, callable $update, callable $version, $from, $backup ) {

		try {
			$ok = call_user_func( $update );
		} catch ( Throwable $e ) {
			$ok = new WP_Error( 'doaction_care_exception', $e->getMessage() );
		}
		$this->clear_maintenance();
		if ( true !== $ok || is_wp_error( $ok ) ) {
			$this->note( 'อัปเดตไม่สำเร็จ: ' . ( is_wp_error( $ok ) ? $ok->get_error_message() : 'upgrader คืนค่า ' . var_export( $ok, true ) ) ); // phpcs:ignore WordPress.PHP.DevelopmentFunctions.error_log_var_export
			return $this->restore( $backup, $target, $from );
		}

		$this->settle( $target );
		$after = $this->check_site();
		$new   = call_user_func( $version );
		if ( $after['ok'] ) {
			$this->note( 'ตรวจหลังอัปเดต: ' . $after['detail'] . ' — สำเร็จ เวอร์ชัน ' . $new );
			return $this->result( 'succeeded', $new );
		}
		$this->note( 'เว็บพังหลังอัปเดต: ' . $after['detail'] );
		return $this->restore( $backup, $target, $from );
	}

	private function restore( $backup, $target, $from ) {
		$ok = self::restore_files( $backup, $target );
		for ( $try = 0; $try < 3; $try++ ) {
			$this->settle( $target );
			$check = $this->check_site();
			if ( $check['ok'] ) {
				break;
			}
		}
		if ( $ok && $check['ok'] ) {
			$this->note( 'ย้อนกลับเป็นเวอร์ชัน ' . $from . ' แล้ว เว็บกลับมาปกติ (' . $check['detail'] . ')' );
			return $this->result( 'rolled_back', $from );
		}
		$this->note( '!!! ย้อนกลับแล้วแต่เว็บยังมีปัญหา: ' . $check['detail'] . ' — ต้องตรวจด่วน' );
		$this->broken = true;
		return $this->result( 'failed', $from );
	}

	/**
	 * A plugin and its add-ons (grouped by the portal, parent first): back up all,
	 * update all, check the site once, and on failure restore all of them. An
	 * add-on built for the new parent (or the reverse) breaks the site when only
	 * one side is updated, so they are never checked half-way.
	 *
	 * @param array<int,array<string,mixed>> $jobs
	 * @return array<string,array{status:string,version:?string}> by job id
	 */
	public function run_group( array $jobs ) {
		$out = array();
		$items = array();
		try {
			$this->load_admin();
			if ( is_multisite() || ! $this->file_mods_allowed() ) {
				$this->note( is_multisite() ? 'เว็บแบบ multisite — ไม่ได้ทำอะไร' : 'เว็บนี้ปิดการแก้ไขไฟล์ — ไม่ได้ทำอะไร' );
				return $this->fill( $jobs, $out, 'failed' );
			}
			$plugins = get_plugins();
			wp_update_plugins();
			$updates = get_site_transient( 'update_plugins' );
			foreach ( $jobs as $j ) {
				$id   = (string) $j['id'];
				$file = (string) $j['slug'];
				if ( 'plugin' !== ( $j['kind'] ?? '' ) || ! isset( $plugins[ $file ] ) || validate_file( $file ) !== 0 ) {
					$this->note( 'ไม่พบปลั๊กอิน ' . $file );
					$out[ $id ] = $this->result( 'failed' );
					continue;
				}
				$from = (string) $plugins[ $file ]['Version'];
				if ( ! is_object( $updates ) || empty( $updates->response[ $file ] ) ) {
					$this->note( 'ไม่มีอัปเดตสำหรับ ' . $file . ' แล้ว (เวอร์ชันปัจจุบัน ' . $from . ')' );
					$out[ $id ] = $this->result( 'succeeded', $from );
					continue;
				}
				$why = self::incompatibility( (array) $updates->response[ $file ] );
				if ( $why ) {
					$this->note( 'ไม่อัปเดต ' . $plugins[ $file ]['Name'] . ': ' . $why );
					$out[ $id ] = $this->result( 'failed' );
					continue;
				}
				$dir     = dirname( $file );
				$items[] = array(
					'id'         => $id,
					'file'       => $file,
					'name'       => (string) $plugins[ $file ]['Name'],
					'from'       => $from,
					'to'         => (string) $updates->response[ $file ]->new_version,
					'target'     => '.' === $dir ? WP_PLUGIN_DIR . '/' . $file : WP_PLUGIN_DIR . '/' . $dir,
					'was_active' => is_plugin_active( $file ),
				);
			}
			if ( ! $items ) {
				return $out;
			}
			$this->note( 'อัปเดตเป็นชุด (ตัวหลัก + ส่วนเสริม): ' . implode( ', ', array_map( static function ( $i ) {
				return $i['name'] . ' ' . $i['from'] . ' → ' . $i['to'];
			}, $items ) ) );

			$before = $this->check_site();
			if ( ! $before['ok'] ) {
				$this->note( 'เว็บมีปัญหาอยู่แล้วก่อนอัปเดต: ' . $before['detail'] . ' — ไม่ได้อัปเดต' );
				$this->broken = true;
				return $this->fill( $jobs, $out, 'failed' );
			}
			$this->note( 'ตรวจก่อนอัปเดต: ' . $before['detail'] );

			foreach ( $items as $k => $i ) {
				$zip = $this->backup( $i['target'] );
				if ( ! $zip ) {
					$this->note( 'สำรองไฟล์ ' . $i['name'] . ' ไม่สำเร็จ (หรือพื้นที่ดิสก์ไม่พอ) — ไม่ได้อัปเดตทั้งชุด' );
					return $this->fill( $jobs, $out, 'failed' );
				}
				$items[ $k ]['zip'] = $zip;
			}
			$this->note( 'สำรองไฟล์เดิมทั้งชุดไว้แล้ว' );
			update_option(
				self::PENDING,
				array(
					'items' => array_map( static function ( $i ) {
						return array(
							'target'     => $i['target'],
							'zip'        => $i['zip'],
							'from'       => $i['from'],
							'plugin'     => $i['file'],
							'was_active' => $i['was_active'],
						);
					}, $items ),
					'at'    => time(),
				),
				false
			);

			$updated = true;
			foreach ( $items as $i ) {
				try {
					$skin     = new Automatic_Upgrader_Skin();
					$upgrader = new Plugin_Upgrader( $skin );
					$ok       = $upgrader->upgrade( $i['file'] );
					$this->note_skin( $skin, $ok );
				} catch ( Throwable $e ) {
					$ok = new WP_Error( 'doaction_care_exception', $e->getMessage() );
				}
				$this->clear_maintenance();
				self::reactivate( $i );
				if ( true !== $ok || is_wp_error( $ok ) ) {
					$this->note( 'อัปเดต ' . $i['name'] . ' ไม่สำเร็จ: ' . ( is_wp_error( $ok ) ? $ok->get_error_message() : 'upgrader คืนค่า ' . var_export( $ok, true ) ) ); // phpcs:ignore WordPress.PHP.DevelopmentFunctions.error_log_var_export
					$updated = false;
					break;
				}
			}

			if ( $updated ) {
				$this->settle_all( $items );
				$after = $this->check_site();
				if ( $after['ok'] ) {
					wp_clean_plugins_cache( true );
					$now = get_plugins();
					$this->note( 'ตรวจหลังอัปเดตทั้งชุด: ' . $after['detail'] . ' — สำเร็จ' );
					foreach ( $items as $i ) {
						$out[ $i['id'] ] = $this->result( 'succeeded', isset( $now[ $i['file'] ] ) ? (string) $now[ $i['file'] ]['Version'] : null );
					}
					delete_option( self::PENDING );
					return $out;
				}
				$this->note( 'เว็บพังหลังอัปเดตชุด: ' . $after['detail'] );
			}

			// Put every member back, add-ons first.
			$restored = true;
			foreach ( array_reverse( $items ) as $i ) {
				$restored = self::restore_files( $i['zip'], $i['target'] ) && $restored;
				self::reactivate( $i );
			}
			wp_clean_plugins_cache( true );
			for ( $try = 0; $try < 3; $try++ ) {
				$this->settle_all( $items );
				$check = $this->check_site();
				if ( $check['ok'] ) {
					break;
				}
			}
			delete_option( self::PENDING );
			if ( $restored && $check['ok'] ) {
				$this->note( 'ย้อนกลับทั้งชุดแล้ว เว็บกลับมาปกติ (' . $check['detail'] . ')' );
				foreach ( $items as $i ) {
					$out[ $i['id'] ] = $this->result( 'rolled_back', $i['from'] );
				}
				return $out;
			}
			$this->note( '!!! ย้อนกลับทั้งชุดแล้วแต่เว็บยังมีปัญหา: ' . $check['detail'] . ' — ต้องตรวจด่วน' );
			$this->broken = true;
			foreach ( $items as $i ) {
				$out[ $i['id'] ] = $this->result( 'failed', $i['from'] );
			}
			return $out;
		} catch ( Throwable $e ) {
			$this->note( 'ข้อผิดพลาด: ' . $e->getMessage() );
			return $this->fill( $jobs, $out, 'failed' );
		} finally {
			$this->clear_maintenance();
		}
	}

	/** Gives every job without a result yet the same status. */
	private function fill( array $jobs, array $out, $status ) {
		foreach ( $jobs as $j ) {
			$id = (string) $j['id'];
			if ( ! isset( $out[ $id ] ) ) {
				$out[ $id ] = $this->result( $status );
			}
		}
		return $out;
	}

	/** The upgrader deactivates while swapping files; restore the previous state without loading the code here. */
	private static function reactivate( array $i ) {
		if ( ! empty( $i['was_active'] ) && ! is_plugin_active( $i['file'] ) ) {
			$active   = (array) get_option( 'active_plugins', array() );
			$active[] = $i['file'];
			update_option( 'active_plugins', array_values( array_unique( $active ) ) );
		}
	}

	private function settle_all( array $items ) {
		foreach ( $items as $i ) {
			if ( function_exists( 'wp_opcache_invalidate_directory' ) && is_dir( $i['target'] ) ) {
				wp_opcache_invalidate_directory( $i['target'] );
			} elseif ( function_exists( 'wp_opcache_invalidate' ) && is_file( $i['target'] ) ) {
				wp_opcache_invalidate( $i['target'], true );
			}
		}
		sleep( 3 );
	}

	/**
	 * Unzips into a scratch folder first and only then swaps it in, so a
	 * failed unzip (disk full, memory) never leaves the plugin missing.
	 */
	public static function restore_files( $zip, $target ) {
		global $wp_filesystem;
		if ( ! $wp_filesystem ) {
			require_once ABSPATH . 'wp-admin/includes/file.php';
			WP_Filesystem();
		}
		$scratch = self::backup_root() . '/restore-' . wp_generate_password( 12, false );
		if ( ! wp_mkdir_p( $scratch ) || true !== unzip_file( $zip, $scratch ) ) {
			$wp_filesystem->delete( $scratch, true );
			return false;
		}
		$fresh = $scratch . '/' . basename( $target );
		if ( ! file_exists( $fresh ) ) {
			$wp_filesystem->delete( $scratch, true );
			return false;
		}
		$wp_filesystem->delete( $target, true );
		$ok = @rename( $fresh, $target ); // phpcs:ignore WordPress.PHP.NoSilencedErrors.Discouraged, WordPress.WP.AlternativeFunctions.rename_rename
		if ( ! $ok ) {
			$ok = is_dir( $fresh ) ? ( wp_mkdir_p( $target ) && true === copy_dir( $fresh, $target ) ) : $wp_filesystem->copy( $fresh, $target, true );
		}
		$wp_filesystem->delete( $scratch, true );
		return $ok;
	}

	/** A previous run was killed between backup and verification: put the old files back if they are gone. */
	private static function recover_interrupted() {
		$p = get_option( self::PENDING );
		$list = is_array( $p ) && isset( $p['items'] ) && is_array( $p['items'] ) ? $p['items'] : array( $p );
		$list = array_values( array_filter( $list, static function ( $i ) {
			return is_array( $i ) && ! empty( $i['target'] ) && ! empty( $i['zip'] );
		} ) );
		if ( ! $list ) {
			if ( false !== $p ) {
				delete_option( self::PENDING );
			}
			return;
		}
		delete_option( self::PENDING );
		$file = ABSPATH . '.maintenance';
		if ( file_exists( $file ) ) {
			wp_delete_file( $file );
		}
		// We cannot know how far the killed run got (files half-copied, plugin
		// left deactivated, new version never checked), so go back to the
		// version we saved and to the activation state it had.
		require_once ABSPATH . 'wp-admin/includes/admin.php';
		$ok    = true;
		$names = array();
		foreach ( array_reverse( $list ) as $i ) {
			if ( ! file_exists( $i['zip'] ) ) {
				continue;
			}
			$one = self::restore_files( $i['zip'], $i['target'] );
			$ok  = $one && $ok;
			if ( $one && ! empty( $i['plugin'] ) && ! empty( $i['was_active'] ) && ! is_plugin_active( (string) $i['plugin'] ) ) {
				$active   = (array) get_option( 'active_plugins', array() );
				$active[] = (string) $i['plugin'];
				update_option( 'active_plugins', array_values( array_unique( $active ) ) );
			}
			$names[] = basename( $i['target'] ) . ' ' . $i['from'];
		}
		wp_clean_plugins_cache( true );
		$s                  = DoAction_Care_Api_Client::get_settings();
		$s['last_error']    = ( $ok ? 'กู้คืน ' : 'กู้คืนไม่สำเร็จ: ' ) . implode( ', ', $names ) . ' หลังการอัปเดตถูกตัดกลางคัน';
		$s['last_error_at'] = time();
		DoAction_Care_Api_Client::save_settings( $s );
	}

	// ── Core ──────────────────────────────────────────────────────────────────

	private function update_core() {
		$age = self::latest_backup_age();
		if ( null === $age ) {
			$this->note( 'ไม่พบข้อมูล backup (UpdraftPlus / All-in-One WP Migration) — ไม่อัปเดต core เพื่อความปลอดภัย' );
			return $this->result( 'failed' );
		}
		$before = $this->check_site();
		if ( ! $before['ok'] ) {
			$this->note( 'เว็บมีปัญหาอยู่แล้วก่อนอัปเดต: ' . $before['detail'] . ' — ไม่ได้อัปเดต' );
			$this->broken = true;
			return $this->result( 'failed' );
		}
		wp_version_check( array(), true );
		$updates = get_core_updates();
		$update  = ( is_array( $updates ) && isset( $updates[0] ) && 'upgrade' === $updates[0]->response ) ? $updates[0] : null;
		if ( $update && ! empty( $update->php_version ) && ! is_php_version_compatible( (string) $update->php_version ) ) {
			$this->note( 'ไม่อัปเดต: WordPress ' . $update->current . ' ต้องใช้ PHP ' . $update->php_version . ' ขึ้นไป แต่เว็บนี้ใช้ PHP ' . PHP_VERSION );
			return $this->result( 'failed' );
		}
		if ( ! $update ) {
			$this->note( 'ไม่มีอัปเดต WordPress core แล้ว' );
			return $this->result( 'succeeded', get_bloginfo( 'version' ) );
		}
		$this->note( 'WordPress ' . get_bloginfo( 'version' ) . ' → ' . $update->current . ' (backup ล่าสุด ' . round( $age / 3600, 1 ) . ' ชม. ที่แล้ว)' );
		$upgrader = new Core_Upgrader( new Automatic_Upgrader_Skin() );
		$res      = $upgrader->upgrade( $update );
		$this->clear_maintenance();
		sleep( 3 );
		if ( is_wp_error( $res ) || ! $res ) {
			$this->note( 'อัปเดต core ไม่สำเร็จ: ' . ( is_wp_error( $res ) ? $res->get_error_message() : 'unknown' ) );
		}
		$after = $this->check_site();
		if ( ! is_wp_error( $res ) && $res && $after['ok'] ) {
			$this->note( 'ตรวจหลังอัปเดต: ' . $after['detail'] . ' — สำเร็จ' );
			return $this->result( 'succeeded', (string) $res );
		}
		$this->note( '!!! ตรวจหลังอัปเดต: ' . $after['detail'] . ' — core ย้อนกลับอัตโนมัติไม่ได้ ต้องกู้จาก backup' );
		$this->broken = ! $after['ok'];
		return $this->result( 'failed' );
	}

	/**
	 * Why an update offer (from the update_plugins / update_themes transient)
	 * cannot run on this site, or null when it can.
	 *
	 * @param array<string,mixed> $offer
	 */
	public static function incompatibility( array $offer ) {
		$php = isset( $offer['requires_php'] ) ? (string) $offer['requires_php'] : '';
		$wp  = isset( $offer['requires'] ) ? (string) $offer['requires'] : '';
		if ( '' !== $php && ! is_php_version_compatible( $php ) ) {
			return 'รุ่นใหม่ต้องใช้ PHP ' . $php . ' ขึ้นไป แต่เว็บนี้ใช้ PHP ' . PHP_VERSION;
		}
		if ( '' !== $wp && ! is_wp_version_compatible( $wp ) ) {
			return 'รุ่นใหม่ต้องใช้ WordPress ' . $wp . ' ขึ้นไป แต่เว็บนี้ใช้ ' . get_bloginfo( 'version' );
		}
		return null;
	}

	/** Seconds since the newest backup any supported tool recorded, or null. */
	public static function latest_backup_age() {
		return DoAction_Care_Backup::latest_age();
	}

	// ── Checks ────────────────────────────────────────────────────────────────

	/** @return array{ok:bool,detail:string} */
	public function check_site() {
		// The marker request loads every plugin and the theme but skips page
		// caches (unique token, nocache headers): it proves PHP still boots.
		$token = wp_generate_password( 20, false );
		set_transient( 'doaction_care_check_token', $token, 120 );
		$urls = array(
			add_query_arg( 'doaction_care_check', $token, home_url( '/' ) ),
			add_query_arg( 'doaction_care_nc', (string) time(), home_url( '/' ) ),
			wp_login_url(),
		);
		$parts = array();
		foreach ( $urls as $url ) {
			$res = wp_remote_get(
				$url,
				array(
					'timeout'     => 30,
					'redirection' => 3,
					'sslverify'   => false, // loopback to ourselves; local certs are often self-signed
					'headers'     => array( 'Cache-Control' => 'no-cache' ),
				)
			);
			$path = (string) wp_parse_url( $url, PHP_URL_PATH );
			if ( is_wp_error( $res ) ) {
				return array(
					'ok'     => false,
					'detail' => $path . ' เปิดไม่ได้ (' . $res->get_error_message() . ')',
				);
			}
			$code = (int) wp_remote_retrieve_response_code( $res );
			$body = (string) wp_remote_retrieve_body( $res );
			if ( $code >= 500 || self::looks_fatal( $body ) ) {
				return array(
					'ok'     => false,
					'detail' => $path . ' HTTP ' . $code . ( self::looks_fatal( $body ) ? ' มีข้อความ fatal error' : '' ),
				);
			}
			if ( false !== strpos( $url, 'doaction_care_check=' ) && false === strpos( $body, 'DOACTION_CARE_OK:' . $token ) ) {
				return array(
					'ok'     => false,
					'detail' => 'ตรวจการทำงานของ PHP ไม่ผ่าน (HTTP ' . $code . ')',
				);
			}
			$parts[] = ( false !== strpos( $url, 'doaction_care_check=' ) ? 'php-ok' : $path ) . ' ' . $code;
		}
		return array(
			'ok'     => true,
			'detail' => implode( ', ', $parts ),
		);
	}

	private static function looks_fatal( $body ) {
		foreach ( array( 'There has been a critical error', 'Fatal error</b>', 'เกิดข้อผิดพลาดร้ายแรง' ) as $needle ) {
			if ( false !== stripos( $body, $needle ) ) {
				return true;
			}
		}
		return false;
	}

	// ── Files ─────────────────────────────────────────────────────────────────

	private function load_admin() {
		require_once ABSPATH . 'wp-admin/includes/admin.php';
		require_once ABSPATH . 'wp-admin/includes/class-wp-upgrader.php';
		require_once ABSPATH . 'wp-admin/includes/update.php';
		WP_Filesystem();
	}

	private function file_mods_allowed() {
		global $wp_filesystem;
		if ( defined( 'DISALLOW_FILE_MODS' ) && DISALLOW_FILE_MODS ) {
			return false;
		}
		return $wp_filesystem && 'direct' === $wp_filesystem->method;
	}

	private static function backup_root() {
		return WP_CONTENT_DIR . '/' . self::BACKUP_DIR;
	}

	/**
	 * Zips $target aside. A zip is not executable, so the old (possibly
	 * vulnerable) PHP code is never reachable over the web, even on servers
	 * that ignore .htaccess. Returns the zip path or false.
	 */
	private function backup( $target ) {
		global $wp_filesystem;
		$root = self::backup_root();
		if ( ! is_dir( $root ) ) {
			wp_mkdir_p( $root );
			$wp_filesystem->put_contents( $root . '/index.php', "<?php\n// Silence is golden.\n" );
			$wp_filesystem->put_contents( $root . '/.htaccess', "Require all denied\nDeny from all\n" );
		}
		$dest = $root . '/' . gmdate( 'Ymd-His' ) . '-' . wp_generate_password( 12, false ) . '-' . basename( $target ) . '.zip';
		if ( ! self::enough_disk( $target ) ) {
			$this->note( 'พื้นที่ดิสก์ว่างไม่พอสำหรับสำรองและอัปเดต' );
			return false;
		}
		$base = dirname( $target );
		$files = is_dir( $target )
			? iterator_to_array( new RecursiveIteratorIterator( new RecursiveDirectoryIterator( $target, FilesystemIterator::SKIP_DOTS ) ), false )
			: array( new SplFileInfo( $target ) );

		if ( class_exists( 'ZipArchive' ) ) {
			$zip = new ZipArchive();
			if ( true !== $zip->open( $dest, ZipArchive::CREATE | ZipArchive::OVERWRITE ) ) {
				return false;
			}
			foreach ( $files as $file ) {
				if ( $file->isFile() && ! $zip->addFile( $file->getPathname(), ltrim( substr( $file->getPathname(), strlen( $base ) ), '/' ) ) ) {
					$zip->close();
					return false;
				}
			}
			return $zip->close() && is_file( $dest ) ? $dest : false;
		}
		require_once ABSPATH . 'wp-admin/includes/class-pclzip.php';
		$zip = new PclZip( $dest );
		return 0 !== $zip->create( $target, PCLZIP_OPT_REMOVE_PATH, $base ) && is_file( $dest ) ? $dest : false;
	}


	/**
	 * Lets the web server see the files just written: PHP's opcache may keep
	 * serving the previous code for a couple of seconds (revalidate_freq).
	 */
	private function settle( $target ) {
		if ( function_exists( 'wp_opcache_invalidate_directory' ) && is_dir( $target ) ) {
			wp_opcache_invalidate_directory( $target );
		} elseif ( function_exists( 'wp_opcache_invalidate' ) && is_file( $target ) ) {
			wp_opcache_invalidate( $target, true );
		}
		sleep( 3 );
	}

	/** Room for the zip, the new version and the scratch restore, plus 50 MB headroom. */
	private static function enough_disk( $target ) {
		if ( ! function_exists( 'disk_free_space' ) ) {
			return true;
		}
		$free = @disk_free_space( WP_CONTENT_DIR ); // phpcs:ignore WordPress.PHP.NoSilencedErrors.Discouraged
		if ( false === $free ) {
			return true;
		}
		$size = 0;
		if ( is_dir( $target ) ) {
			foreach ( new RecursiveIteratorIterator( new RecursiveDirectoryIterator( $target, FilesystemIterator::SKIP_DOTS ) ) as $f ) {
				$size += $f->getSize();
			}
		} elseif ( is_file( $target ) ) {
			$size = filesize( $target );
		}
		return $free > 3 * $size + 50 * 1048576;
	}

	private function clear_maintenance() {
		$file = ABSPATH . '.maintenance';
		if ( file_exists( $file ) ) {
			wp_delete_file( $file );
		}
	}

	/** Backups older than 7 days are removed. */
	public static function prune_backups() {
		global $wp_filesystem;
		$root = self::backup_root();
		if ( ! is_dir( $root ) ) {
			return;
		}
		if ( ! $wp_filesystem ) {
			require_once ABSPATH . 'wp-admin/includes/file.php';
			WP_Filesystem();
		}
		foreach ( (array) glob( $root . '/2*' ) as $path ) {
			if ( filemtime( $path ) < time() - 7 * DAY_IN_SECONDS ) {
				$wp_filesystem->delete( $path, true );
			}
		}
	}
}
