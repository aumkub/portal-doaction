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
		add_action( 'admin_post_doaction_care_sso', array( __CLASS__, 'handle_sso' ) );
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
		wp_add_dashboard_widget( 'doaction_care_widget', 'Do Action: Care', array( __CLASS__, 'render' ) );

		// First box of the first column. A user who drags it elsewhere keeps their own order.
		global $wp_meta_boxes;
		$normal = isset( $wp_meta_boxes['dashboard']['normal']['core'] ) ? $wp_meta_boxes['dashboard']['normal']['core'] : array();
		if ( isset( $normal['doaction_care_widget'] ) ) {
			$ours = array( 'doaction_care_widget' => $normal['doaction_care_widget'] );
			unset( $normal['doaction_care_widget'] );
			$wp_meta_boxes['dashboard']['normal']['high'] = array_merge( $ours, isset( $wp_meta_boxes['dashboard']['normal']['high'] ) ? $wp_meta_boxes['dashboard']['normal']['high'] : array() );
			$wp_meta_boxes['dashboard']['normal']['core'] = $normal;
		}
	}

	/**
	 * Support contract state from the last heartbeat reply. The portal decides
	 * (support_expired); the date only drives the label and the 30-day warning.
	 *
	 * @param array<string,mixed> $w
	 * @return array{expired:bool,soon:bool,days:int|null,label:string}
	 */
	public static function support_status( array $w ) {
		$expired = ! empty( $w['support_expired'] );
		$end     = ! empty( $w['contract_end'] ) ? strtotime( (string) $w['contract_end'] . ' 23:59:59' ) : false;
		$days    = $end ? (int) ceil( ( $end - time() ) / DAY_IN_SECONDS ) : null;
		$label   = '';
		if ( $end ) {
			$label = ( $expired ? 'สัญญาหมดเมื่อ ' : 'ซัพพอร์ตถึง ' ) . date_i18n( 'j M Y', $end );
		}
		return array(
			'expired' => $expired,
			'soon'    => ! $expired && null !== $days && $days <= 30,
			'days'    => $days,
			'label'   => $label,
		);
	}

	public static function render() {
		$s = DoAction_Care_Api_Client::get_settings();
		$w = isset( $s['widget'] ) && is_array( $s['widget'] ) ? $s['widget'] : array();

		$support  = self::support_status( $w );
		$expired  = $support['expired'];
		$contract = $support['label'];
		$age    = DoAction_Care_Runner::latest_backup_age();
		$backup = null === $age ? 'ไม่พบ' : ( $age < 3600 ? '< 1 ชม.' : ( $age >= 2 * DAY_IN_SECONDS ? floor( $age / DAY_IN_SECONDS ) . ' วัน' : round( $age / 3600 ) . ' ชม.' ) );
		$uptime = isset( $w['uptime30'] ) && is_numeric( $w['uptime30'] ) ? number_format( (float) $w['uptime30'], 2 ) . '%' : '—';
		$portal = ! empty( $w['portal_url'] ) ? (string) $w['portal_url'] : DOACTION_CARE_PORTAL;
		$notice = isset( $_GET['doaction_care_ticket'] ) ? sanitize_key( wp_unslash( $_GET['doaction_care_ticket'] ) ) : ''; // phpcs:ignore WordPress.Security.NonceVerification.Recommended
		$open   = isset( $_GET['doaction_care_open'] ) ? (string) wp_unslash( $_GET['doaction_care_open'] ) : ''; // phpcs:ignore WordPress.Security.NonceVerification.Recommended, WordPress.Security.ValidatedSanitizedInput.InputNotSanitized
		$open   = preg_match( '/^[A-Za-z0-9_-]{8,64}$/', $open ) ? $open : '';
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
				<?php if ( $contract ) : ?>
					<span class="dac-wcontract<?php echo $expired || $support['soon'] ? ' is-bad' : ''; ?>"><?php echo esc_html( $contract ); ?></span>
				<?php endif; ?>
			</div>

			<?php if ( $expired ) : ?>
				<div class="dac-expired">
					<strong>สัญญาดูแลเว็บไซต์หมดอายุแล้ว</strong>
					<span>ปิดการอัปเดตจากระยะไกลและการแจ้งปัญหาแล้ว เว็บไซต์ของคุณยังทำงานตามปกติ ติดต่อทีม do action เพื่อต่ออายุ</span>
					<form method="post" action="<?php echo esc_url( admin_url( 'admin-post.php' ) ); ?>">
						<input type="hidden" name="action" value="doaction_care_ticket">
						<input type="hidden" name="renewal" value="1">
						<?php wp_nonce_field( 'doaction_care_ticket' ); ?>
						<button type="submit" class="dac-btn is-primary">ขอต่ออายุสัญญา</button>
					</form>
				</div>
			<?php elseif ( $support['soon'] ) : ?>
				<div class="dac-notice is-error">สัญญาดูแลจะหมดใน <?php echo esc_html( (string) $support['days'] ); ?> วัน — ติดต่อทีม do action เพื่อต่ออายุ</div>
			<?php endif; ?>

			<?php if ( 'ok' === $notice ) : ?>
				<div class="dac-notice is-success">
					ส่งเรื่องถึงทีม do action แล้ว
					<?php if ( $open ) : ?>
						<form method="post" action="<?php echo esc_url( admin_url( 'admin-post.php' ) ); ?>" style="margin-top:8px">
							<input type="hidden" name="action" value="doaction_care_sso">
							<input type="hidden" name="path" value="<?php echo esc_attr( '/tickets/' . $open ); ?>">
							<?php wp_nonce_field( 'doaction_care_sso' ); ?>
							<button type="submit" class="dac-btn is-primary">ดู ticket นี้ในพอร์ทัล</button>
						</form>
					<?php else : ?>
						— ทีมจะติดต่อกลับผ่านบัญชีลูกค้าของเว็บไซต์นี้
					<?php endif; ?>
				</div>
			<?php elseif ( 'renewal' === $notice ) : ?>
				<div class="dac-notice is-success">ส่งคำขอต่ออายุถึงทีม do action แล้ว ทีมจะติดต่อกลับโดยเร็ว</div>
			<?php elseif ( 'expired' === $notice ) : ?>
				<div class="dac-notice is-error">สัญญาดูแลหมดอายุแล้ว กด “ขอต่ออายุสัญญา” เพื่อติดต่อทีม</div>
			<?php elseif ( 'blocked' === $notice ) : ?>
				<div class="dac-notice is-error">การแจ้งปัญหาจากเว็บไซต์นี้ถูกระงับชั่วคราว กรุณาติดต่อทีม do action ทางอื่น</div>
			<?php elseif ( 'rate' === $notice ) : ?>
				<div class="dac-notice is-error">แจ้งเรื่องถี่เกินไป (ไม่เกิน 5 เรื่องต่อชั่วโมง) กรุณาเพิ่มรายละเอียดในเรื่องเดิมผ่านพอร์ทัล</div>
			<?php elseif ( 'error' === $notice ) : ?>
				<div class="dac-notice is-error">ส่งเรื่องไม่สำเร็จ ลองใหม่ หรือแจ้งผ่านพอร์ทัล</div>
			<?php endif; ?>

			<?php if ( ! $expired ) : ?>
			<form class="dac-wsso" method="post" action="<?php echo esc_url( admin_url( 'admin-post.php' ) ); ?>">
				<input type="hidden" name="action" value="doaction_care_sso">
				<?php wp_nonce_field( 'doaction_care_sso' ); ?>
				<button type="submit" class="dac-btn is-yellow dac-wide">เข้าพอร์ทัลและเปิด ticket</button>
			</form>
			<?php if ( 'mismatch' === $notice ) : ?>
				<div class="dac-notice is-error">อีเมลของบัญชี WordPress นี้ไม่ตรงกับบัญชีลูกค้าในพอร์ทัล — เข้าสู่ระบบด้วยอีเมลตามปกติ หรือส่งเรื่องจากฟอร์มด้านล่าง</div>
			<?php elseif ( 'verify_sent' === $notice ) : ?>
				<div class="dac-notice is-success">ครั้งแรกจากเว็บนี้: ส่งอีเมลยืนยันไปที่ <?php echo esc_html( wp_get_current_user()->user_email ); ?> แล้ว เปิดลิงก์ในอีเมลเพื่อเข้าสู่ระบบ ครั้งต่อไปกดปุ่มนี้ได้เลย</div>
			<?php elseif ( 'sso_error' === $notice ) : ?>
				<div class="dac-notice is-error">เปิดพอร์ทัลอัตโนมัติไม่ได้ในตอนนี้ ลองใหม่ หรือเข้าสู่ระบบตามปกติ</div>
			<?php endif; ?>
			<?php endif; ?>

			<div class="dac-stats dac-wstats">
				<?php foreach ( $stats as $st ) : ?>
					<div class="dac-stat"><div class="dac-k"><?php echo esc_html( $st[0] ); ?></div><div class="dac-v<?php echo $st[2] ? ' is-bad' : ''; ?>"><?php echo esc_html( $st[1] ); ?></div></div>
				<?php endforeach; ?>
			</div>

			<?php if ( ! $expired ) : ?>
			<form class="dac-wform" method="post" action="<?php echo esc_url( admin_url( 'admin-post.php' ) ); ?>">
				<input type="hidden" name="action" value="doaction_care_ticket">
				<?php wp_nonce_field( 'doaction_care_ticket' ); ?>
				<p class="dac-wtitle">แจ้งปัญหาถึงทีม do action</p>
				<label class="dac-field"><input type="text" name="title" maxlength="200" required placeholder="หัวข้อ เช่น ฟอร์มติดต่อส่งไม่ได้"></label>
				<label class="dac-field"><textarea name="description" rows="3" maxlength="5000" required placeholder="รายละเอียด"></textarea></label>
				<div class="dac-actions">
					<button type="submit" class="dac-btn is-primary">ส่งเรื่อง</button>
				</div>
			</form>
			<?php endif; ?>
		</div>
		<?php
	}

	/**
	 * One click into the portal. The portal issues a single-use 60-second
	 * token only if this WordPress user's email is the client's account or
	 * CC email; the token goes to the portal in a POST body, never a URL.
	 */
	public static function handle_sso() {
		if ( ! current_user_can( self::CAP ) ) {
			wp_die( 'forbidden', 403 );
		}
		check_admin_referer( 'doaction_care_sso' );
		$user = wp_get_current_user();
		$path = isset( $_POST['path'] ) ? sanitize_text_field( wp_unslash( $_POST['path'] ) ) : '/tickets/new';
		if ( ! preg_match( '#^/tickets/(new|[A-Za-z0-9_-]{8,64})$#', $path ) ) {
			$path = '/tickets/new';
		}
		$res = DoAction_Care_Api_Client::signed_post(
			'sso',
			array(
				'email'   => (string) $user->user_email,
				'wp_user' => (string) $user->user_login,
				'path'    => $path,
			)
		);
		$back = admin_url( 'index.php' );
		if ( is_wp_error( $res ) || 200 !== $res['status'] || ! is_array( $res['data'] ) ) {
			wp_safe_redirect( add_query_arg( 'doaction_care_ticket', 'sso_error', $back ) );
			exit;
		}
		$data = $res['data'];
		if ( empty( $data['ok'] ) || empty( $data['token'] ) || empty( $data['url'] ) ) {
			$reason = isset( $data['reason'] ) && 'email_mismatch' === $data['reason'] ? 'mismatch' : ( isset( $data['reason'] ) && 'verify_sent' === $data['reason'] ? 'verify_sent' : 'sso_error' );
			wp_safe_redirect( add_query_arg( 'doaction_care_ticket', $reason, $back ) );
			exit;
		}
		$url = (string) $data['url'];
		if ( 0 !== strpos( $url, untrailingslashit( DOACTION_CARE_PORTAL ) . '/' ) || ! preg_match( '/^[0-9a-f]{64}$/', (string) $data['token'] ) ) {
			wp_safe_redirect( add_query_arg( 'doaction_care_ticket', 'sso_error', $back ) );
			exit;
		}
		nocache_headers();
		header( 'Referrer-Policy: no-referrer' );
		header( 'Content-Type: text/html; charset=utf-8' );
		?>
<!doctype html>
<html><head><meta charset="utf-8"><meta name="robots" content="noindex"><title>do action Portal</title></head>
<body style="font-family:system-ui,sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;background:#f6f5f1;color:#111">
<form id="dac-sso" method="post" action="<?php echo esc_url( $url ); ?>">
	<input type="hidden" name="token" value="<?php echo esc_attr( (string) $data['token'] ); ?>">
	<p>กำลังเปิดพอร์ทัล…</p>
	<noscript><button type="submit">ไปที่พอร์ทัล</button></noscript>
</form>
<script>document.getElementById('dac-sso').submit();</script>
</body></html>
		<?php
		exit;
	}

	public static function handle_ticket() {
		if ( ! current_user_can( self::CAP ) ) {
			wp_die( 'forbidden', 403 );
		}
		check_admin_referer( 'doaction_care_ticket' );
		$renewal = ! empty( $_POST['renewal'] );
		$title   = $renewal ? 'renewal' : sanitize_text_field( wp_unslash( isset( $_POST['title'] ) ? $_POST['title'] : '' ) );
		$desc    = $renewal ? 'ลูกค้าขอต่ออายุสัญญาดูแลจากหน้า wp-admin' : sanitize_textarea_field( wp_unslash( isset( $_POST['description'] ) ? $_POST['description'] : '' ) );
		$user  = wp_get_current_user();
		$ok    = false;
		$res   = null;
		if ( '' !== $title && '' !== $desc ) {
			$res = DoAction_Care_Api_Client::signed_post(
				'ticket',
				array(
					'title'       => $title,
					'description' => $desc,
					'renewal'        => $renewal,
					'reporter_name'  => (string) $user->display_name,
					'reporter_email' => (string) $user->user_email,
				)
			);
			$ok  = ! is_wp_error( $res ) && 200 === $res['status'];
		}
		$args = array( 'doaction_care_ticket' => $ok ? ( $renewal ? 'renewal' : 'ok' ) : 'error' );
		if ( ! $ok && ! is_wp_error( $res ) && is_array( $res ) && in_array( $res['status'], array( 403, 429 ), true ) && is_array( $res['data'] ) ) {
			$err = isset( $res['data']['error'] ) ? (string) $res['data']['error'] : '';
			$args['doaction_care_ticket'] = in_array( $err, array( 'blocked', 'expired' ), true ) ? $err : 'rate';
		}
		if ( $ok && is_array( $res['data'] ) && ! empty( $res['data']['can_open'] ) && preg_match( '/^[A-Za-z0-9_-]{8,64}$/', (string) $res['data']['ticket_id'] ) ) {
			$args['doaction_care_open'] = (string) $res['data']['ticket_id'];
		}
		wp_safe_redirect( add_query_arg( $args, admin_url( 'index.php' ) ) );
		exit;
	}
}
