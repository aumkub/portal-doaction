import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from "@simplewebauthn/server";
import type {
  AuthenticationResponseJSON,
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
  RegistrationResponseJSON,
} from "@simplewebauthn/server";
import { isoBase64URL } from "@simplewebauthn/server/helpers";
import type { User, UserPasskey } from "~/types";

const CHALLENGE_TTL = 300;
const RP_NAME = "do action portal";

/**
 * Relying party: APP_URL's host/origin in production. A request served from
 * localhost/127.0.0.1 uses its own host so passkeys can be tried locally.
 */
export function relyingParty(request: Request, env: CloudflareEnv) {
  const req = new URL(request.url);
  if (req.hostname === "localhost" || req.hostname === "127.0.0.1") {
    return { rpID: req.hostname, origin: req.origin };
  }
  const app = new URL(env.APP_URL);
  return { rpID: app.hostname, origin: app.origin };
}

export async function listPasskeys(d1: D1Database, userId: string): Promise<UserPasskey[]> {
  const res = await d1
    .prepare("SELECT * FROM user_passkeys WHERE user_id = ? ORDER BY created_at ASC")
    .bind(userId)
    .all<UserPasskey>();
  return res.results ?? [];
}

function transportsOf(pk: UserPasskey): AuthenticatorTransport[] | undefined {
  try {
    return pk.transports ? (JSON.parse(pk.transports) as AuthenticatorTransport[]) : undefined;
  } catch {
    return undefined;
  }
}

// ─── Registration (user from session) ───────────────────────────────────────

export async function startPasskeyRegistration(
  request: Request,
  env: CloudflareEnv,
  user: Pick<User, "id" | "email" | "name">
): Promise<PublicKeyCredentialCreationOptionsJSON> {
  const { rpID } = relyingParty(request, env);
  const existing = await listPasskeys(env.DB, user.id);
  const options = await generateRegistrationOptions({
    rpName: RP_NAME,
    rpID,
    userName: user.email,
    userDisplayName: user.name || user.email,
    userID: new TextEncoder().encode(user.id),
    attestationType: "none",
    excludeCredentials: existing.map((pk) => ({ id: pk.id, transports: transportsOf(pk) })),
    authenticatorSelection: { residentKey: "preferred", userVerification: "preferred" },
  });
  await env.SESSIONPORTAL.put(`pk-reg:${user.id}`, options.challenge, { expirationTtl: CHALLENGE_TTL });
  return options;
}

/** Verifies and stores a new passkey. Returns false on any failure. */
export async function finishPasskeyRegistration(
  request: Request,
  env: CloudflareEnv,
  userId: string,
  responseJson: string,
  name: string
): Promise<boolean> {
  const key = `pk-reg:${userId}`;
  const expectedChallenge = await env.SESSIONPORTAL.get(key);
  if (!expectedChallenge) return false;
  await env.SESSIONPORTAL.delete(key);
  const { rpID, origin } = relyingParty(request, env);
  try {
    const response = JSON.parse(responseJson) as RegistrationResponseJSON;
    const result = await verifyRegistrationResponse({
      response,
      expectedChallenge,
      expectedOrigin: origin,
      expectedRPID: rpID,
      requireUserVerification: false,
    });
    if (!result.verified || !result.registrationInfo) return false;
    const { credential } = result.registrationInfo;
    await env.DB.prepare(
      "INSERT INTO user_passkeys (id, user_id, public_key, counter, transports, name, created_at) VALUES (?, ?, ?, ?, ?, ?, unixepoch())"
    )
      .bind(
        credential.id,
        userId,
        isoBase64URL.fromBuffer(credential.publicKey),
        credential.counter,
        JSON.stringify(credential.transports ?? response.response.transports ?? []),
        name.slice(0, 60) || null
      )
      .run();
    return true;
  } catch {
    return false;
  }
}

// ─── Authentication (user from session or from the login challenge) ────────

export async function startPasskeyAuthentication(
  request: Request,
  env: CloudflareEnv,
  userId: string,
  challengeKey: string
): Promise<PublicKeyCredentialRequestOptionsJSON | null> {
  const passkeys = await listPasskeys(env.DB, userId);
  if (passkeys.length === 0) return null;
  const { rpID } = relyingParty(request, env);
  const options = await generateAuthenticationOptions({
    rpID,
    userVerification: "preferred",
    allowCredentials: passkeys.map((pk) => ({ id: pk.id, transports: transportsOf(pk) })),
  });
  await env.SESSIONPORTAL.put(challengeKey, options.challenge, { expirationTtl: CHALLENGE_TTL });
  return options;
}

/** Verifies an assertion for `userId`; challenge is single-use. */
export async function verifyPasskeyAssertion(
  request: Request,
  env: CloudflareEnv,
  userId: string,
  challengeKey: string,
  responseJson: string
): Promise<boolean> {
  const expectedChallenge = await env.SESSIONPORTAL.get(challengeKey);
  if (!expectedChallenge) return false;
  await env.SESSIONPORTAL.delete(challengeKey);
  try {
    const response = JSON.parse(responseJson) as AuthenticationResponseJSON;
    const pk = await env.DB.prepare("SELECT * FROM user_passkeys WHERE id = ? AND user_id = ?")
      .bind(response.id, userId)
      .first<UserPasskey>();
    if (!pk) return false;
    const { rpID, origin } = relyingParty(request, env);
    const result = await verifyAuthenticationResponse({
      response,
      expectedChallenge,
      expectedOrigin: origin,
      expectedRPID: rpID,
      requireUserVerification: false,
      credential: {
        id: pk.id,
        publicKey: isoBase64URL.toBuffer(pk.public_key),
        counter: pk.counter,
        transports: transportsOf(pk),
      },
    });
    if (!result.verified) return false;
    // Conditional on the old counter so a replayed assertion racing this one loses.
    const res = await env.DB.prepare(
      "UPDATE user_passkeys SET counter = ?, last_used_at = unixepoch() WHERE id = ? AND counter = ?"
    )
      .bind(result.authenticationInfo.newCounter, pk.id, pk.counter)
      .run();
    return Boolean(res.meta.changes);
  } catch {
    return false;
  }
}
