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
		add_action( 'admin_post_doaction_care_ticket', array( __CLASS__, 'handle_ticket' ) );
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
			$contract = ( $expired ? 'หมดอายุแล้ว ' : 'ถึง ' ) . date_i18n( get_option( 'date_format' ), $end );
		}
		$age    = DoAction_Care_Runner::latest_backup_age();
		$backup = null === $age ? 'ไม่พบข้อมูล' : ( $age < 3600 ? 'ไม่ถึง 1 ชม.ที่แล้ว' : round( $age / 3600 ) . ' ชม.ที่แล้ว' );
		$portal = ! empty( $w['portal_url'] ) ? esc_url( (string) $w['portal_url'] ) : '';
		$notice = isset( $_GET['doaction_care_ticket'] ) ? sanitize_key( wp_unslash( $_GET['doaction_care_ticket'] ) ) : ''; // phpcs:ignore WordPress.Security.NonceVerification.Recommended
		?>
		<?php if ( 'ok' === $notice ) : ?>
			<div class="notice notice-success inline"><p>ส่งเรื่องถึงทีม do action แล้ว ติดตามได้ในพอร์ทัล</p></div>
		<?php elseif ( 'error' === $notice ) : ?>
			<div class="notice notice-error inline"><p>ส่งเรื่องไม่สำเร็จ ลองใหม่ หรือแจ้งทางพอร์ทัล</p></div>
		<?php endif; ?>
		<table class="widefat striped" style="border:0">
			<tbody>
				<tr><td>สัญญาดูแล</td><td style="<?php echo $expired ? 'color:#b32d2e' : ''; ?>"><?php echo esc_html( $contract ); ?></td></tr>
				<tr><td>Uptime 30 วัน</td><td><?php echo esc_html( isset( $w['uptime30'] ) && is_numeric( $w['uptime30'] ) ? number_format( (float) $w['uptime30'], 2 ) . '%' : '—' ); ?></td></tr>
				<tr><td>อัปเดตเดือนนี้</td><td><?php echo esc_html( (string) ( isset( $w['updates_this_month'] ) ? (int) $w['updates_this_month'] : 0 ) ); ?> รายการ</td></tr>
				<tr><td>เรื่องที่กำลังดำเนินการ</td><td><?php echo esc_html( (string) ( isset( $w['open_tickets'] ) ? (int) $w['open_tickets'] : 0 ) ); ?> เรื่อง</td></tr>
				<tr><td>Backup ล่าสุด</td><td><?php echo esc_html( $backup ); ?></td></tr>
			</tbody>
		</table>
		<form method="post" action="<?php echo esc_url( admin_url( 'admin-post.php' ) ); ?>" style="margin-top:12px">
			<input type="hidden" name="action" value="doaction_care_ticket">
			<?php wp_nonce_field( 'doaction_care_ticket' ); ?>
			<p><strong>แจ้งปัญหาถึงทีม do action</strong></p>
			<p><input type="text" name="title" class="widefat" maxlength="200" required placeholder="หัวข้อ"></p>
			<p><textarea name="description" class="widefat" rows="3" maxlength="5000" required placeholder="รายละเอียด"></textarea></p>
			<p style="display:flex;gap:8px;align-items:center">
				<button type="submit" class="button button-primary">ส่งเรื่อง</button>
				<?php if ( $portal ) : ?>
					<a href="<?php echo esc_url( $portal ); ?>" target="_blank" rel="noopener">เปิดพอร์ทัล</a>
				<?php endif; ?>
			</p>
		</form>
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
