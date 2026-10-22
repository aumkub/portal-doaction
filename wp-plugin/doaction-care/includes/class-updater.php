<?php
/**
 * Self-update from the do action portal. The portal only advertises a
 * release; the zip is installed only if its Ed25519 signature matches the
 * public key shipped in this plugin, so neither the portal nor the network
 * can push code we did not sign on the release machine.
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class DoAction_Care_Updater {

	const PLUGIN = 'doaction-care/doaction-care.php';

	public static function init() {
		add_filter( 'site_transient_update_plugins', array( __CLASS__, 'offer' ) );
		add_filter( 'upgrader_pre_download', array( __CLASS__, 'verified_download' ), 10, 3 );
	}

	/** @return array<string,mixed>|null */
	private static function release() {
		$s = DoAction_Care_Api_Client::get_settings();
		$r = isset( $s['plugin_release'] ) && is_array( $s['plugin_release'] ) ? $s['plugin_release'] : null;
		if ( ! $r || empty( $r['version'] ) || empty( $r['package'] ) || empty( $r['signature'] ) ) {
			return null;
		}
		if ( ! preg_match( '/^\d+\.\d+\.\d+$/', (string) $r['version'] ) ) {
			return null;
		}
		$portal = isset( $s['portal_url'] ) ? untrailingslashit( (string) $s['portal_url'] ) : '';
		if ( '' === $portal || 0 !== strpos( (string) $r['package'], $portal . '/agent/v1/plugin/' ) ) {
			return null;
		}
		return $r;
	}

	/**
	 * @param mixed $transient
	 * @return mixed
	 */
	public static function offer( $transient ) {
		$r = self::release();
		if ( ! $r || ! version_compare( (string) $r['version'], DOACTION_CARE_VERSION, '>' ) ) {
			return $transient;
		}
		if ( ! is_object( $transient ) ) {
			$transient = new stdClass();
		}
		if ( ! isset( $transient->response ) || ! is_array( $transient->response ) ) {
			$transient->response = array();
		}
		$transient->response[ self::PLUGIN ] = (object) array(
			'slug'         => 'doaction-care',
			'plugin'       => self::PLUGIN,
			'new_version'  => (string) $r['version'],
			'package'      => (string) $r['package'],
			'url'          => 'https://doaction.co.th',
			'requires'     => isset( $r['requires_wp'] ) ? (string) $r['requires_wp'] : '',
			'requires_php' => isset( $r['requires_php'] ) ? (string) $r['requires_php'] : '',
		);
		return $transient;
	}

	/**
	 * @param mixed  $reply
	 * @param string $package
	 * @return mixed
	 */
	public static function verified_download( $reply, $package, $upgrader = null ) {
		$s      = DoAction_Care_Api_Client::get_settings();
		$portal = isset( $s['portal_url'] ) ? untrailingslashit( (string) $s['portal_url'] ) : '';
		if ( false !== $reply || '' === $portal || 0 !== strpos( (string) $package, $portal . '/agent/v1/plugin/' ) ) {
			return $reply;
		}
		$r = self::release();
		if ( ! $r || $r['package'] !== $package ) {
			return new WP_Error( 'doaction_care_release', 'ไม่พบข้อมูลรุ่นที่เซ็นแล้วสำหรับแพ็กเกจนี้' );
		}
		if ( ! function_exists( 'download_url' ) ) {
			require_once ABSPATH . 'wp-admin/includes/file.php';
		}
		$tmp = download_url( $package, 120 );
		if ( is_wp_error( $tmp ) ) {
			return $tmp;
		}
		$zip = (string) file_get_contents( $tmp ); // phpcs:ignore WordPress.WP.AlternativeFunctions.file_get_contents_file_get_contents
		$sig = base64_decode( (string) $r['signature'], true ); // phpcs:ignore WordPress.PHP.DiscouragedPHPFunctions.obfuscation_base64_decode
		$key = base64_decode( DOACTION_CARE_PUBKEY, true ); // phpcs:ignore WordPress.PHP.DiscouragedPHPFunctions.obfuscation_base64_decode
		$ok  = false;
		if ( false !== $sig && false !== $key && 64 === strlen( $sig ) && 32 === strlen( $key ) && function_exists( 'sodium_crypto_sign_verify_detached' ) ) {
			try {
				$ok = sodium_crypto_sign_verify_detached( $sig, $zip, $key );
			} catch ( Throwable $e ) {
				$ok = false;
			}
		}
		if ( ! $ok ) {
			wp_delete_file( $tmp );
			return new WP_Error( 'doaction_care_signature', 'ลายเซ็นของไฟล์อัปเดต Do Action: Care ไม่ถูกต้อง — ไม่ติดตั้ง' );
		}
		return $tmp;
	}
}
