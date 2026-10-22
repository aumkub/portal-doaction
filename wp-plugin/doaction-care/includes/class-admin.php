<?php
/**
 * Settings → do action Care.
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
	}

	public static function menu() {
		add_options_page( 'do action Care', 'do action Care', 'manage_options', self::PAGE, array( __CLASS__, 'render' ) );
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
		$url  = isset( $_POST['portal_url'] ) ? esc_url_raw( wp_unslash( $_POST['portal_url'] ) ) : '';
		$code = isset( $_POST['pair_code'] ) ? strtoupper( preg_replace( '/[^A-Za-z0-9]/', '', sanitize_text_field( wp_unslash( $_POST['pair_code'] ) ) ) ) : '';
		if ( '' === $url || strlen( $code ) < 8 ) {
			self::back( 'กรุณากรอก Portal URL และรหัสจับคู่ให้ครบ', 'error' );
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
		self::back( is_wp_error( $hb ) ? $hb->get_error_message() : 'ส่งข้อมูลเรียบร้อย', is_wp_error( $hb ) ? 'error' : 'success' );
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
		$fmt = get_option( 'date_format' ) . ' ' . get_option( 'time_format' );
		?>
		<div class="wrap">
			<h1>do action Care</h1>
			<?php if ( is_array( $notice ) ) : ?>
				<div class="notice notice-<?php echo esc_attr( 'error' === $notice['type'] ? 'error' : 'success' ); ?> is-dismissible"><p><?php echo esc_html( $notice['msg'] ); ?></p></div>
			<?php endif; ?>

			<?php if ( $paired ) : ?>
				<table class="form-table" role="presentation">
					<tr><th>Portal</th><td><code><?php echo esc_html( $s['portal_url'] ); ?></code></td></tr>
					<tr><th>สถานะ</th><td>
						<?php if ( isset( $s['status'] ) && 'disconnected' === $s['status'] ) : ?>
							<strong style="color:#b32d2e">ถูกตัดการเชื่อมต่อ</strong> — กรุณาขอรหัสจับคู่ใหม่จาก do action
						<?php else : ?>
							<strong style="color:#008a20">เชื่อมต่อแล้ว</strong>
						<?php endif; ?>
					</td></tr>
					<tr><th>ส่งข้อมูลสำเร็จล่าสุด</th><td><?php echo ! empty( $s['last_ok'] ) ? esc_html( wp_date( $fmt, (int) $s['last_ok'] ) ) : '—'; ?></td></tr>
					<?php if ( ! empty( $s['last_error'] ) ) : ?>
						<tr><th>ข้อผิดพลาดล่าสุด</th><td><?php echo esc_html( $s['last_error'] ); ?></td></tr>
					<?php endif; ?>
				</table>
				<form method="post" action="<?php echo esc_url( admin_url( 'admin-post.php' ) ); ?>" style="display:inline-block;margin-right:8px">
					<input type="hidden" name="action" value="doaction_care_send" />
					<?php wp_nonce_field( 'doaction_care_send' ); ?>
					<?php submit_button( 'ส่งข้อมูลตอนนี้', 'primary', 'submit', false ); ?>
				</form>
				<form method="post" action="<?php echo esc_url( admin_url( 'admin-post.php' ) ); ?>" style="display:inline-block" onsubmit="return confirm('ยกเลิกการเชื่อมต่อกับ do action Portal?');">
					<input type="hidden" name="action" value="doaction_care_disconnect" />
					<?php wp_nonce_field( 'doaction_care_disconnect' ); ?>
					<?php submit_button( 'ยกเลิกการเชื่อมต่อ', 'secondary', 'submit', false ); ?>
				</form>
			<?php else : ?>
				<p>ใส่ Portal URL และรหัสจับคู่ที่ได้รับจาก do action (รหัสใช้ได้ครั้งเดียว ภายใน 15 นาที)</p>
				<form method="post" action="<?php echo esc_url( admin_url( 'admin-post.php' ) ); ?>">
					<input type="hidden" name="action" value="doaction_care_pair" />
					<?php wp_nonce_field( 'doaction_care_pair' ); ?>
					<table class="form-table" role="presentation">
						<tr><th><label for="dac-url">Portal URL</label></th>
							<td><input id="dac-url" name="portal_url" type="url" class="regular-text" required placeholder="https://portal.doaction.co.th" value="<?php echo esc_attr( isset( $s['portal_url'] ) ? $s['portal_url'] : '' ); ?>" /></td></tr>
						<tr><th><label for="dac-code">รหัสจับคู่</label></th>
							<td><input id="dac-code" name="pair_code" type="text" class="regular-text" required autocomplete="off" maxlength="32" /></td></tr>
					</table>
					<?php submit_button( 'เชื่อมต่อ' ); ?>
				</form>
			<?php endif; ?>
			<p class="description">ปลั๊กอินนี้ส่งเฉพาะข้อมูลเวอร์ชันและรายการปลั๊กอิน/ธีม ไม่รับคำสั่งใดๆ จากภายนอก</p>
		</div>
		<?php
	}
}
