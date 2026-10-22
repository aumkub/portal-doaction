<?php
/**
 * wp-admin dashboard widget for the client: contract, updates this month,
 * open tickets, last backup, and a "report a problem" form that opens a
 * ticket in the portal. Data comes from the last heartbeat reply.
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class DoAction_Care_Widget {

	const CAP = 'edit_pages';

	public static function init() {
		add_action( 'wp_dashboard_setup', array( __CLASS__, 'register' ) );
		add_action( 'admin_enqueue_scripts', array( __CLASS__, 'assets' ) );
		add_action( 'admin_post_doaction_care_ticket', array( __CLASS__, 'handle_ticket' ) );
	}

	public static function assets( $hook ) {
		if ( 'index.php' === $hook && DoAction_Care_Api_Client::is_paired() ) {
			wp_enqueue_style( 'doaction-care-admin', plugins_url( 'assets/admin.css', DOACTION_CARE_FILE ), array(), DOACTION_CARE_VERSION );
		}
	}

	public static function register() {
		if ( ! current_user_can( self::CAP ) || ! DoAction_Care_Api_Client::is_paired() ) {
			return;
		}
		wp_add_dashboard_widget( 'doaction_care_widget', 'do action Care', array( __CLASS__, 'render' ) );
	}

	public static function render() {
		$s = DoAction_Care_Api_Client::get_settings();
		$w = isset( $s['widget'] ) && is_array( $s['widget'] ) ? $s['widget'] : array();

		$contract = '—';
		$expired  = false;
		if ( ! empty( $w['contract_end'] ) ) {
			$end      = strtotime( (string) $w['contract_end'] . ' 23:59:59' );
			$expired  = $end && $end < time();
			$contract = $end ? date_i18n( 'j M Y', $end ) : '—';
		}
		$age    = DoAction_Care_Runner::latest_backup_age();
		$backup = null === $age ? 'ไม่พบ' : ( $age < 3600 ? '< 1 ชม.' : ( $age >= 2 * DAY_IN_SECONDS ? floor( $age / DAY_IN_SECONDS ) . ' วัน' : round( $age / 3600 ) . ' ชม.' ) );
		$uptime = isset( $w['uptime30'] ) && is_numeric( $w['uptime30'] ) ? number_format( (float) $w['uptime30'], 2 ) . '%' : '—';
		$portal = ! empty( $w['portal_url'] ) ? (string) $w['portal_url'] : DOACTION_CARE_PORTAL;
		$notice = isset( $_GET['doaction_care_ticket'] ) ? sanitize_key( wp_unslash( $_GET['doaction_care_ticket'] ) ) : ''; // phpcs:ignore WordPress.Security.NonceVerification.Recommended
		$stats  = array(
			array( 'Uptime 30 วัน', $uptime, false ),
			array( 'อัปเดตเดือนนี้', ( isset( $w['updates_this_month'] ) ? (int) $w['updates_this_month'] : 0 ) . ' รายการ', false ),
			array( 'Backup ล่าสุด', $backup, null === $age || $age > 36 * HOUR_IN_SECONDS ),
			array( 'เรื่องที่ดำเนินการ', ( isset( $w['open_tickets'] ) ? (int) $w['open_tickets'] : 0 ) . ' เรื่อง', false ),
		);
		?>
		<div class="dac-wrap dac-widget">
			<div class="dac-whead">
				<img src="<?php echo esc_url( plugins_url( 'assets/logo.svg', DOACTION_CARE_FILE ) ); ?>" alt="do action">
				<span class="dac-tag">Care</span>
				<?php if ( ! empty( $w['contract_end'] ) ) : ?>
					<span class="dac-wcontract<?php echo $expired ? ' is-bad' : ''; ?>"><?php echo esc_html( ( $expired ? 'สัญญาหมดแล้ว ' : 'ดูแลถึง ' ) . $contract ); ?></span>
				<?php endif; ?>
			</div>

			<?php if ( 'ok' === $notice ) : ?>
				<div class="dac-notice is-success">ส่งเรื่องถึงทีม do action แล้ว ติดตามได้ในพอร์ทัล</div>
			<?php elseif ( 'error' === $notice ) : ?>
				<div class="dac-notice is-error">ส่งเรื่องไม่สำเร็จ ลองใหม่ หรือแจ้งผ่านพอร์ทัล</div>
			<?php endif; ?>

			<div class="dac-stats dac-wstats">
				<?php foreach ( $stats as $st ) : ?>
					<div class="dac-stat"><div class="dac-k"><?php echo esc_html( $st[0] ); ?></div><div class="dac-v<?php echo $st[2] ? ' is-bad' : ''; ?>"><?php echo esc_html( $st[1] ); ?></div></div>
				<?php endforeach; ?>
			</div>

			<form class="dac-wform" method="post" action="<?php echo esc_url( admin_url( 'admin-post.php' ) ); ?>">
				<input type="hidden" name="action" value="doaction_care_ticket">
				<?php wp_nonce_field( 'doaction_care_ticket' ); ?>
				<p class="dac-wtitle">แจ้งปัญหาถึงทีม do action</p>
				<label class="dac-field"><input type="text" name="title" maxlength="200" required placeholder="หัวข้อ เช่น ฟอร์มติดต่อส่งไม่ได้"></label>
				<label class="dac-field"><textarea name="description" rows="3" maxlength="5000" required placeholder="รายละเอียด"></textarea></label>
				<div class="dac-actions">
					<button type="submit" class="dac-btn is-primary">ส่งเรื่อง</button>
					<a class="dac-btn is-yellow" href="<?php echo esc_url( $portal ); ?>" target="_blank" rel="noopener">เปิดพอร์ทัล</a>
				</div>
			</form>
		</div>
		<?php
	}

	public static function handle_ticket() {
		if ( ! current_user_can( self::CAP ) ) {
			wp_die( 'forbidden', 403 );
		}
		check_admin_referer( 'doaction_care_ticket' );
		$title = sanitize_text_field( wp_unslash( isset( $_POST['title'] ) ? $_POST['title'] : '' ) );
		$desc  = sanitize_textarea_field( wp_unslash( isset( $_POST['description'] ) ? $_POST['description'] : '' ) );
		$user  = wp_get_current_user();
		$ok    = false;
		if ( '' !== $title && '' !== $desc ) {
			$res = DoAction_Care_Api_Client::signed_post(
				'ticket',
				array(
					'title'       => $title,
					'description' => $desc,
					'reporter'    => $user->display_name . ' <' . $user->user_email . '>',
				)
			);
			$ok  = ! is_wp_error( $res ) && 200 === $res['status'];
		}
		wp_safe_redirect( add_query_arg( 'doaction_care_ticket', $ok ? 'ok' : 'error', admin_url( 'index.php' ) ) );
		exit;
	}
}
