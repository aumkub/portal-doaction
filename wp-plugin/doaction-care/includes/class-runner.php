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
	const MAX_RUN_TIME   = 240;
	const BACKUP_MAX_AGE = 86400; // core updates need a backup newer than this

	/** @var string[] */
	private $log = array();

	/** Cron/wake entry point: run every due job, then refresh the inventory. */
	public static function poll() {
		if ( ! DoAction_Care_Api_Client::is_paired() || get_transient( self::LOCK ) ) {
			return;
		}
		set_transient( self::LOCK, time(), 10 * MINUTE_IN_SECONDS );
		ignore_user_abort( true );
		if ( function_exists( 'set_time_limit' ) ) {
			@set_time_limit( 600 ); // phpcs:ignore WordPress.PHP.NoSilencedErrors.Discouraged
		}
		$started = time();
		$ran     = 0;
		try {
			while ( time() - $started < self::MAX_RUN_TIME ) {
				$res = DoAction_Care_Api_Client::signed_post( 'jobs/next', array() );
				if ( is_wp_error( $res ) || 200 !== $res['status'] || empty( $res['data']['job'] ) || ! is_array( $res['data']['job'] ) ) {
					break;
				}
				$job    = $res['data']['job'];
				$runner = new self();
				$result = $runner->run( $job );
				DoAction_Care_Api_Client::signed_post(
					'jobs/report',
					array(
						'job_id'         => (string) $job['id'],
						'status'         => $result['status'],
						'result_version' => $result['version'],
						'log'            => substr( implode( "\n", $runner->log ), 0, 7900 ),
					)
				);
				++$ran;
			}
		} finally {
			delete_transient( self::LOCK );
		}
		if ( $ran > 0 ) {
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
			$from
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
	private function guarded_update( $target, callable $update, callable $version, $from ) {
		$before = $this->check_site();
		if ( ! $before['ok'] ) {
			$this->note( 'เว็บมีปัญหาอยู่แล้วก่อนอัปเดต: ' . $before['detail'] . ' — ไม่ได้อัปเดต' );
			return $this->result( 'failed' );
		}
		$this->note( 'ตรวจก่อนอัปเดต: ' . $before['detail'] );

		$backup = $this->backup( $target );
		if ( ! $backup ) {
			$this->note( 'สำรองไฟล์เดิมไม่สำเร็จ — ไม่ได้อัปเดต' );
			return $this->result( 'failed' );
		}
		$this->note( 'สำรองไฟล์เดิมไว้แล้ว' );

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
		global $wp_filesystem;
		$wp_filesystem->delete( $target, true );
		$ok = is_dir( $backup ) ? $this->copy_tree( $backup, $target ) : $wp_filesystem->copy( $backup, $target, true );
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
		return $this->result( 'failed', $from );
	}

	// ── Core ──────────────────────────────────────────────────────────────────

	private function update_core() {
		$age = self::latest_backup_age();
		if ( null === $age ) {
			$this->note( 'ไม่พบข้อมูล backup (UpdraftPlus) — ไม่อัปเดต core เพื่อความปลอดภัย' );
			return $this->result( 'failed' );
		}
		if ( $age > self::BACKUP_MAX_AGE ) {
			$this->note( 'backup ล่าสุดเก่า ' . round( $age / 3600 ) . ' ชม. (ต้องไม่เกิน 24 ชม.) — ไม่อัปเดต core' );
			return $this->result( 'failed' );
		}
		$before = $this->check_site();
		if ( ! $before['ok'] ) {
			$this->note( 'เว็บมีปัญหาอยู่แล้วก่อนอัปเดต: ' . $before['detail'] . ' — ไม่ได้อัปเดต' );
			return $this->result( 'failed' );
		}
		wp_version_check( array(), true );
		$updates = get_core_updates();
		$update  = ( is_array( $updates ) && isset( $updates[0] ) && 'upgrade' === $updates[0]->response ) ? $updates[0] : null;
		if ( ! $update ) {
			$this->note( 'ไม่มีอัปเดต WordPress core แล้ว' );
			return $this->result( 'succeeded', get_bloginfo( 'version' ) );
		}
		$this->note( 'WordPress ' . get_bloginfo( 'version' ) . ' → ' . $update->current . ' (backup อายุ ' . round( $age / 3600, 1 ) . ' ชม.)' );
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
		return $this->result( 'failed' );
	}

	/** Seconds since the newest UpdraftPlus backup, or null when unknown. */
	public static function latest_backup_age() {
		$last = get_option( 'updraft_last_backup' );
		if ( is_array( $last ) && ! empty( $last['backup_time'] ) ) {
			return max( 0, time() - (int) $last['backup_time'] );
		}
		return null;
	}

	// ── Checks ────────────────────────────────────────────────────────────────

	/** @return array{ok:bool,detail:string} */
	public function check_site() {
		$urls = array(
			add_query_arg( 'doaction_care_check', (string) time(), home_url( '/' ) ),
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
			$parts[] = $path . ' ' . $code;
		}
		return array(
			'ok'     => true,
			'detail' => implode( ', ', $parts ),
		);
	}

	private static function looks_fatal( $body ) {
		foreach ( array( 'There has been a critical error', 'Fatal error</b>', 'PHP Fatal error', 'เกิดข้อผิดพลาดร้ายแรง' ) as $needle ) {
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

	/** Copies $target aside. Returns the backup path or false. */
	private function backup( $target ) {
		global $wp_filesystem;
		$root = self::backup_root();
		if ( ! is_dir( $root ) ) {
			wp_mkdir_p( $root );
			$wp_filesystem->put_contents( $root . '/index.php', "<?php\n// Silence is golden.\n" );
			$wp_filesystem->put_contents( $root . '/.htaccess', "Require all denied\nDeny from all\n" );
		}
		$dest = $root . '/' . gmdate( 'Ymd-His' ) . '-' . wp_generate_password( 6, false ) . '-' . basename( $target );
		if ( is_dir( $target ) ) {
			return $this->copy_tree( $target, $dest ) ? $dest : false;
		}
		return $wp_filesystem->copy( $target, $dest, true ) ? $dest : false;
	}

	private function copy_tree( $from, $to ) {
		global $wp_filesystem;
		if ( ! wp_mkdir_p( $to ) ) {
			return false;
		}
		$res = copy_dir( $from, $to );
		return true === $res;
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
