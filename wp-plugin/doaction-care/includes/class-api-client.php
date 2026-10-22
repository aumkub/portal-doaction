<?php
/**
 * Signed HTTP client for the do action portal.
 *
 * Signature = hex HMAC-SHA256(secret, "{timestamp}\n{nonce}\n{sha256hex(body)}")
 * sent as X-DA-Site / X-DA-Timestamp / X-DA-Nonce / X-DA-Signature.
 * Portal responses carry the same headers and are verified before use.
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class DoAction_Care_Api_Client {

	const MAX_SKEW = 300;

	/** @return array<string,mixed> */
	public static function get_settings() {
		$s = get_option( DOACTION_CARE_OPTION, array() );
		return is_array( $s ) ? $s : array();
	}

	/** @param array<string,mixed> $s */
	public static function save_settings( array $s ) {
		update_option( DOACTION_CARE_OPTION, $s, false );
	}

	public static function is_paired() {
		$s = self::get_settings();
		return ! empty( $s['site_id'] ) && ! empty( $s['secret_enc'] ) && ! empty( $s['portal_url'] );
	}

	// ── Secret storage ────────────────────────────────────────────────────────

	private static function storage_key() {
		return hash( 'sha256', 'doaction-care|' . wp_salt( 'auth' ), true );
	}

	public static function encrypt_secret( $plain ) {
		if ( function_exists( 'openssl_encrypt' ) && in_array( 'aes-256-gcm', openssl_get_cipher_methods(), true ) ) {
			$iv  = random_bytes( 12 );
			$tag = '';
			$ct  = openssl_encrypt( $plain, 'aes-256-gcm', self::storage_key(), OPENSSL_RAW_DATA, $iv, $tag );
			if ( false !== $ct ) {
				return 'gcm:' . base64_encode( $iv . $tag . $ct ); // phpcs:ignore WordPress.PHP.DiscouragedPHPFunctions.obfuscation_base64_encode
			}
		}
		// Fallback: stored as-is (still protected by DB access controls).
		return 'raw:' . $plain;
	}

	public static function decrypt_secret( $stored ) {
		if ( ! is_string( $stored ) ) {
			return null;
		}
		if ( 0 === strpos( $stored, 'raw:' ) ) {
			return substr( $stored, 4 );
		}
		if ( 0 === strpos( $stored, 'gcm:' ) && function_exists( 'openssl_decrypt' ) ) {
			$raw = base64_decode( substr( $stored, 4 ), true ); // phpcs:ignore WordPress.PHP.DiscouragedPHPFunctions.obfuscation_base64_decode
			if ( false === $raw || strlen( $raw ) < 29 ) {
				return null;
			}
			$pt = openssl_decrypt( substr( $raw, 28 ), 'aes-256-gcm', self::storage_key(), OPENSSL_RAW_DATA, substr( $raw, 0, 12 ), substr( $raw, 12, 16 ) );
			return false === $pt ? null : $pt;
		}
		return null;
	}

	// ── Signing ───────────────────────────────────────────────────────────────

	public static function sign( $secret, $timestamp, $nonce, $body ) {
		return hash_hmac( 'sha256', $timestamp . "\n" . $nonce . "\n" . hash( 'sha256', $body ), $secret );
	}

	/**
	 * @param array|WP_Error $response
	 */
	private static function verify_response( $secret, $response ) {
		$ts    = (string) wp_remote_retrieve_header( $response, 'x-da-timestamp' );
		$nonce = (string) wp_remote_retrieve_header( $response, 'x-da-nonce' );
		$sig   = strtolower( (string) wp_remote_retrieve_header( $response, 'x-da-signature' ) );
		if ( ! ctype_digit( $ts ) || '' === $nonce || '' === $sig ) {
			return false;
		}
		if ( abs( time() - (int) $ts ) > self::MAX_SKEW ) {
			return false;
		}
		return hash_equals( self::sign( $secret, $ts, $nonce, wp_remote_retrieve_body( $response ) ), $sig );
	}

	private static function endpoint( $portal_url, $path ) {
		return untrailingslashit( $portal_url ) . '/agent/v1/' . $path;
	}

	private static function http_args( $body, array $headers = array() ) {
		return array(
			'timeout'     => 20,
			'redirection' => 0,
			'sslverify'   => true,
			'headers'     => array_merge( array( 'Content-Type' => 'application/json' ), $headers ),
			'body'        => $body,
		);
	}

	// ── Pairing ───────────────────────────────────────────────────────────────

	/** @return true|WP_Error */
	public static function pair( $portal_url, $code ) {
		$portal_url = esc_url_raw( trim( $portal_url ) );
		if ( 0 !== strpos( $portal_url, 'https://' ) && ! ( defined( 'WP_DEBUG' ) && WP_DEBUG ) ) {
			return new WP_Error( 'doaction_care_https', 'Portal URL ต้องเป็น https://' );
		}
		$body = wp_json_encode(
			array(
				'code'           => $code,
				'site_url'       => site_url(),
				'wp_version'     => get_bloginfo( 'version' ),
				'plugin_version' => DOACTION_CARE_VERSION,
			)
		);
		$res = wp_remote_post( self::endpoint( $portal_url, 'pair' ), self::http_args( $body ) );
		if ( is_wp_error( $res ) ) {
			return $res;
		}
		$status = (int) wp_remote_retrieve_response_code( $res );
		$data   = json_decode( wp_remote_retrieve_body( $res ), true );
		if ( 200 !== $status || ! is_array( $data ) || empty( $data['site_id'] ) || empty( $data['secret'] ) ) {
			return new WP_Error( 'doaction_care_pair', 'จับคู่ไม่สำเร็จ (HTTP ' . $status . ')' );
		}
		$secret = (string) $data['secret'];
		if ( ! preg_match( '/^[0-9a-f]{64}$/', $secret ) || ! self::verify_response( $secret, $res ) ) {
			return new WP_Error( 'doaction_care_pair', 'ลายเซ็นตอบกลับจาก Portal ไม่ถูกต้อง' );
		}
		self::save_settings(
			array(
				'portal_url' => $portal_url,
				'site_id'    => sanitize_text_field( (string) $data['site_id'] ),
				'secret_enc' => self::encrypt_secret( $secret ),
				'status'     => 'connected',
				'last_ok'    => 0,
				'last_error' => '',
			)
		);
		if ( ! wp_next_scheduled( DOACTION_CARE_CRON_HOOK ) ) {
			wp_schedule_event( time() + 60, 'doaction_care_15min', DOACTION_CARE_CRON_HOOK );
		}
		return true;
	}

	public static function disconnect() {
		delete_option( DOACTION_CARE_OPTION );
	}

	// ── Heartbeat ─────────────────────────────────────────────────────────────

	/** @return true|WP_Error */
	public static function send_heartbeat() {
		if ( ! self::is_paired() ) {
			return new WP_Error( 'doaction_care_unpaired', 'ยังไม่ได้เชื่อมต่อ' );
		}
		$s      = self::get_settings();
		$secret = self::decrypt_secret( $s['secret_enc'] );
		if ( ! $secret ) {
			return self::record_error( $s, 'ถอดรหัส secret ไม่ได้ (salt เปลี่ยน?) — กรุณาเชื่อมต่อใหม่' );
		}

		$body  = wp_json_encode( DoAction_Care_Inventory::collect() );
		$ts    = (string) time();
		$nonce = bin2hex( random_bytes( 16 ) );
		$res   = wp_remote_post(
			self::endpoint( $s['portal_url'], 'heartbeat' ),
			self::http_args(
				$body,
				array(
					'X-DA-Site'      => $s['site_id'],
					'X-DA-Timestamp' => $ts,
					'X-DA-Nonce'     => $nonce,
					'X-DA-Signature' => self::sign( $secret, $ts, $nonce, $body ),
				)
			)
		);
		if ( is_wp_error( $res ) ) {
			return self::record_error( $s, $res->get_error_message() );
		}
		$status = (int) wp_remote_retrieve_response_code( $res );
		if ( 401 === $status ) {
			$s['status'] = 'disconnected';
			return self::record_error( $s, 'Portal ปฏิเสธการเชื่อมต่อ (ถูกตัดการเชื่อมต่อหรือ secret ไม่ถูกต้อง)' );
		}
		if ( ! self::verify_response( $secret, $res ) ) {
			return self::record_error( $s, 'ลายเซ็นตอบกลับจาก Portal ไม่ถูกต้อง (HTTP ' . $status . ')' );
		}
		if ( 429 === $status ) {
			return self::record_error( $s, 'ส่งถี่เกินไป ลองใหม่ในอีก 1 นาที' );
		}
		if ( 200 !== $status ) {
			return self::record_error( $s, 'HTTP ' . $status );
		}
		$s['status']     = 'connected';
		$s['last_ok']    = time();
		$s['last_error'] = '';
		self::save_settings( $s );
		return true;
	}

	private static function record_error( array $s, $message ) {
		$s['last_error']    = sanitize_text_field( $message );
		$s['last_error_at'] = time();
		self::save_settings( $s );
		return new WP_Error( 'doaction_care_heartbeat', $message );
	}
}
