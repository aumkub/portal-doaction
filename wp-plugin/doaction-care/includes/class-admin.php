<?php
/**
 * Settings → Do Action: Care.
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class DoAction_Care_Admin {

	const PAGE = 'doaction-care';

	public static function init() {
		add_action( 'admin_menu', array( __CLASS__, 'menu' ) );
		add_action( 'admin_post_doaction_care_pair', array( __CLASS__, 'handle_pair' ) );
		add_action( 'admin_post_doaction_care_send', array( __CLASS__, 'handle_send' ) );
		add_action( 'admin_post_doaction_care_disconnect', array( __CLASS__, 'handle_disconnect' ) );
		add_action( 'admin_enqueue_scripts', array( __CLASS__, 'assets' ) );
		add_filter( 'plugin_action_links_' . plugin_basename( DOACTION_CARE_FILE ), array( __CLASS__, 'action_links' ) );
	}

	public static function settings_url() {
		return admin_url( 'options-general.php?page=' . self::PAGE );
	}

	/** "ตั้งค่า" link on the Plugins screen. */
	public static function action_links( $links ) {
		array_unshift( $links, '<a href="' . esc_url( self::settings_url() ) . '">ตั้งค่า</a>' );
		return $links;
	}

	public static function assets( $hook ) {
		if ( 'settings_page_' . self::PAGE === $hook ) {
			wp_enqueue_style( 'doaction-care-admin', plugins_url( 'assets/admin.css', DOACTION_CARE_FILE ), array(), DOACTION_CARE_VERSION );
		}
	}

	public static function menu() {
		add_options_page( 'Do Action: Care', 'Do Action: Care', 'manage_options', self::PAGE, array( __CLASS__, 'render' ) );
	}

	private static function guard( $action ) {
		if ( ! current_user_can( 'manage_options' ) ) {
			wp_die( esc_html__( 'Sorry, you are not allowed to do that.', 'doaction-care' ), 403 );
		}
		check_admin_referer( $action );
	}

	private static function back( $notice, $type = 'success' ) {
		set_transient( 'doaction_care_notice_' . get_current_user_id(), array( 'msg' => $notice, 'type' => $type ), 60 );
		wp_safe_redirect( admin_url( 'options-general.php?page=' . self::PAGE ) );
		exit;
	}

	public static function handle_pair() {
		self::guard( 'doaction_care_pair' );
		$url  = DOACTION_CARE_PORTAL;
		$code = isset( $_POST['pair_code'] ) ? strtoupper( preg_replace( '/[^A-Za-z0-9]/', '', sanitize_text_field( wp_unslash( $_POST['pair_code'] ) ) ) ) : '';
		if ( strlen( $code ) < 8 ) {
			self::back( 'กรุณากรอกรหัสจับคู่ให้ครบ', 'error' );
		}
		$result = DoAction_Care_Api_Client::pair( $url, $code );
		if ( is_wp_error( $result ) ) {
			self::back( $result->get_error_message(), 'error' );
		}
		$hb = DoAction_Care_Api_Client::send_heartbeat();
		self::back( is_wp_error( $hb ) ? 'เชื่อมต่อแล้ว แต่ส่งข้อมูลครั้งแรกไม่สำเร็จ: ' . $hb->get_error_message() : 'เชื่อมต่อและส่งข้อมูลเรียบร้อย' );
	}

	public static function handle_send() {
		self::guard( 'doaction_care_send' );
		$hb = DoAction_Care_Api_Client::send_heartbeat();
		if ( is_wp_error( $hb ) ) {
			self::back( $hb->get_error_message(), 'error' );
		}
		// Pull queued jobs after the redirect is sent, so the page doesn't hang while updates run.
		add_action(
			'shutdown',
			static function () {
				ignore_user_abort( true );
				if ( function_exists( 'fastcgi_finish_request' ) ) {
					fastcgi_finish_request();
				} elseif ( function_exists( 'litespeed_finish_request' ) ) {
					litespeed_finish_request();
				}
				DoAction_Care_Runner::poll();
			},
			PHP_INT_MAX
		);
		self::back( 'ส่งข้อมูลแล้ว กำลังรับงานอัปเดตที่รอคิวอยู่ในเบื้องหลัง' );
	}

	public static function handle_disconnect() {
		self::guard( 'doaction_care_disconnect' );
		DoAction_Care_Api_Client::disconnect();
		self::back( 'ยกเลิกการเชื่อมต่อแล้ว' );
	}

	public static function render() {
		if ( ! current_user_can( 'manage_options' ) ) {
			return;
		}
		$s      = DoAction_Care_Api_Client::get_settings();
		$paired = DoAction_Care_Api_Client::is_paired();
		$notice = get_transient( 'doaction_care_notice_' . get_current_user_id() );
		delete_transient( 'doaction_care_notice_' . get_current_user_id() );
		$fmt    = get_option( 'date_format' ) . ' ' . get_option( 'time_format' );
		$w      = isset( $s['widget'] ) && is_array( $s['widget'] ) ? $s['widget'] : array();
		$cut    = $paired && isset( $s['status'] ) && 'disconnected' === $s['status'];
		$post   = admin_url( 'admin-post.php' );

		if ( ! $paired ) {
			$pill = array( 'is-off', 'ยังไม่เชื่อมต่อ' );
		} elseif ( $cut ) {
			$pill = array( 'is-bad', 'ถูกตัดการเชื่อมต่อ' );
		} elseif ( ! empty( $s['last_error'] ) && ( empty( $s['last_ok'] ) || ( isset( $s['last_error_at'] ) && $s['last_error_at'] > $s['last_ok'] ) ) ) {
			$pill = array( 'is-bad', 'ส่งข้อมูลไม่สำเร็จ' );
		} else {
			$pill = array( 'is-ok', 'เชื่อมต่อแล้ว' );
		}
		?>
		<div class="wrap dac-wrap">
			<h1 class="screen-reader-text">Do Action: Care</h1>
			<div class="dac-head">
				<div class="dac-brand">
					<img src="<?php echo esc_url( plugins_url( 'assets/logo.svg', DOACTION_CARE_FILE ) ); ?>" alt="do action">
					<span class="dac-tag">Care</span>
					<span class="dac-ver">v<?php echo esc_html( DOACTION_CARE_VERSION ); ?></span>
				</div>
				<span class="dac-pill <?php echo esc_attr( $pill[0] ); ?>"><?php echo esc_html( $pill[1] ); ?></span>
			</div>

			<?php if ( is_array( $notice ) ) : ?>
				<div class="dac-notice is-<?php echo esc_attr( 'error' === $notice['type'] ? 'error' : 'success' ); ?>"><?php echo esc_html( $notice['msg'] ); ?></div>
			<?php endif; ?>

			<?php if ( $paired ) : ?>
				<?php self::render_paired( $s, $w, $cut, $fmt, $post ); ?>
			<?php else : ?>
				<div class="dac-card dac-pair">
					<h2>เชื่อมต่อเว็บไซต์กับ do action</h2>
					<ol class="dac-steps">
						<li>ขอรหัสจับคู่จากทีม do action (ใช้ได้ครั้งเดียว ภายใน 15 นาที)</li>
						<li>ใส่รหัสด้านล่าง แล้วกด “เชื่อมต่อ”</li>
					</ol>
					<form method="post" action="<?php echo esc_url( $post ); ?>">
						<input type="hidden" name="action" value="doaction_care_pair">
						<?php wp_nonce_field( 'doaction_care_pair' ); ?>
						<label class="dac-field"><span>รหัสจับคู่</span>
							<input class="dac-code" name="pair_code" type="text" required autocomplete="off" maxlength="32" placeholder="XXXX-XXXX">
						</label>
						<button type="submit" class="dac-btn is-primary">เชื่อมต่อ</button>
					</form>
				</div>
			<?php endif; ?>

			<p class="dac-foot">
				Do Action: Care ส่งข้อมูลเวอร์ชันและรายการปลั๊กอิน/ธีมให้ทีม do action และรับงานได้เฉพาะ “อัปเดตปลั๊กอิน ธีม หรือ WordPress” ที่ทีมสั่งเท่านั้น
				ทุกครั้งจะสำรองไฟล์เดิม ตรวจหน้าเว็บ และย้อนกลับอัตโนมัติถ้าเว็บมีปัญหา ไม่รับคำสั่งอื่นใดจากภายนอก
			</p>
		</div>
		<?php
	}

	/**
	 * @param array<string,mixed> $s
	 * @param array<string,mixed> $w
	 */
	private static function render_paired( array $s, array $w, $cut, $fmt, $post ) {
		$support  = DoAction_Care_Widget::support_status( $w );
		$expired  = $support['expired'];
		$soon     = $support['soon'];
		$contract = ! empty( $w['contract_end'] ) ? date_i18n( get_option( 'date_format' ), strtotime( (string) $w['contract_end'] ) ) . ( $expired ? ' (หมดแล้ว)' : ( $soon ? ' (อีก ' . $support['days'] . ' วัน)' : '' ) ) : 'ไม่มีกำหนด';
		$age    = DoAction_Care_Runner::latest_backup_age();
		$backup = null === $age ? 'ไม่พบ' : ( $age < 3600 ? '< 1 ชม.' : round( $age / 3600 ) . ' ชม.' );
		$uptime = isset( $w['uptime30'] ) && is_numeric( $w['uptime30'] ) ? number_format( (float) $w['uptime30'], 2 ) . '%' : '—';
		$portal = isset( $w['portal_url'] ) ? (string) $w['portal_url'] : (string) $s['portal_url'];
		$stats  = array(
			array( 'ซัพพอร์ตถึง', $contract, $expired || $soon ),
			array( 'อัปเดตเดือนนี้', ( isset( $w['updates_this_month'] ) ? (int) $w['updates_this_month'] : 0 ) . ' รายการ', false ),
			array( 'Uptime 30 วัน', $uptime, false ),
			array( 'เรื่องที่ดำเนินการ', ( isset( $w['open_tickets'] ) ? (int) $w['open_tickets'] : 0 ) . ' เรื่อง', false ),
			array( 'Backup ล่าสุด', $backup, null === $age || $age > DAY_IN_SECONDS ),
		);
		$mods   = ! ( defined( 'DISALLOW_FILE_MODS' ) && DISALLOW_FILE_MODS ) && ( ! defined( 'FS_METHOD' ) || 'direct' === FS_METHOD );
		?>
		<?php if ( $expired ) : ?>
			<div class="dac-err">สัญญาดูแลเว็บไซต์หมดอายุแล้ว — ปิดการอัปเดตจากระยะไกลและการแจ้งปัญหา เว็บไซต์ยังทำงานตามปกติ ติดต่อทีม do action เพื่อต่ออายุ</div>
		<?php endif; ?>
		<?php if ( $cut ) : ?>
			<div class="dac-err">Portal ไม่รับการเชื่อมต่อนี้แล้ว (ถูกตัดการเชื่อมต่อหรือจับคู่ใหม่ที่อื่น) — ยกเลิกการเชื่อมต่อด้านล่าง แล้วขอรหัสจับคู่ใหม่จาก do action</div>
		<?php endif; ?>
		<div class="dac-card" style="margin-top:16px">
			<h2>สรุปการดูแล</h2>
			<div class="dac-stats">
				<?php foreach ( $stats as $st ) : ?>
					<div class="dac-stat"><div class="dac-k"><?php echo esc_html( $st[0] ); ?></div><div class="dac-v<?php echo $st[2] ? ' is-bad' : ''; ?>"><?php echo esc_html( $st[1] ); ?></div></div>
				<?php endforeach; ?>
			</div>
		</div>
		<div class="dac-grid">
			<div class="dac-card">
				<h2>การเชื่อมต่อ</h2>
				<dl class="dac-rows">
					<div><dt>Portal</dt><dd><?php echo esc_html( preg_replace( '#^https?://#', '', (string) $s['portal_url'] ) ); ?></dd></div>
					<div><dt>ส่งข้อมูลล่าสุด</dt><dd><?php echo ! empty( $s['last_ok'] ) ? esc_html( wp_date( $fmt, (int) $s['last_ok'] ) ) : '—'; ?></dd></div>
					<?php if ( ! empty( $s['last_error'] ) ) : ?>
						<div><dt>ข้อผิดพลาดล่าสุด</dt><dd style="color:#b4541a"><?php echo esc_html( $s['last_error'] ); ?></dd></div>
					<?php endif; ?>
				</dl>
				<div class="dac-actions">
					<form method="post" action="<?php echo esc_url( $post ); ?>">
						<input type="hidden" name="action" value="doaction_care_send">
						<?php wp_nonce_field( 'doaction_care_send' ); ?>
						<button type="submit" class="dac-btn is-primary">ส่งข้อมูลและรับงานอัปเดต</button>
					</form>
					<a class="dac-btn is-yellow" href="<?php echo esc_url( $portal ); ?>" target="_blank" rel="noopener">เปิดพอร์ทัล</a>
				</div>
			</div>
			<div class="dac-card">
				<h2>เว็บไซต์นี้</h2>
				<dl class="dac-rows">
					<div><dt>WordPress</dt><dd><?php echo esc_html( get_bloginfo( 'version' ) ); ?></dd></div>
					<div><dt>PHP</dt><dd><?php echo esc_html( PHP_VERSION ); ?></dd></div>
					<div><dt>อัปเดตจากระยะไกล</dt><dd><?php echo $mods ? 'พร้อม' : '<span style="color:#b4541a">ปิดการแก้ไขไฟล์อยู่</span>'; ?></dd></div>
					<div><dt>อัปเดตปลั๊กอินนี้</dt><dd>อัตโนมัติ (ตรวจลายเซ็นทุกครั้ง)</dd></div>
				</dl>
				<div class="dac-actions">
					<form method="post" action="<?php echo esc_url( $post ); ?>" onsubmit="return confirm('ยกเลิกการเชื่อมต่อกับ do action Portal?');">
						<input type="hidden" name="action" value="doaction_care_disconnect">
						<?php wp_nonce_field( 'doaction_care_disconnect' ); ?>
						<button type="submit" class="dac-link-danger">ยกเลิกการเชื่อมต่อ</button>
					</form>
				</div>
			</div>
		</div>
		<?php
	}
}
