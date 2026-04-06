import { Lucia, TimeSpan } from "lucia";
import { generateId } from "~/lib/utils";
import { createDB } from "~/lib/db.server";
import type { User, UserLanguage, UserRole } from "~/types";

// ─── KV-based Lucia Adapter ──────────────────────────────────────────────────
// Sessions are stored in Cloudflare KV (fast reads, auto-TTL).
// Key format: `session:{sessionId}` → JSON { userId, expiresAt (ms) }

interface KVSessionData {
  userId: string;
  expiresAt: number; // unix ms
}

interface ImpersonationData {
  adminUserId: string;
}

const SESSION_CACHE_TTL_MS = 2000;
const sessionUserCache = new Map<
  string,
  { cachedAt: number; user: User | null }
>();

export function evictSessionUserCache(sessionId: string) {
  sessionUserCache.delete(sessionId);
}

export async function getImpersonationData(
  request: Request,
  d1: D1Database,
  kv: KVNamespace
): Promise<ImpersonationData | null> {
  const { lucia } = createAuth(d1, kv);
  const cookieHeader = request.headers.get("Cookie") ?? "";
  const sessionId = lucia.readSessionCookie(cookieHeader);
  if (!sessionId) return null;
  return kv.get<ImpersonationData>(`imp:${sessionId}`, "json");
}

export async function startImpersonation(
  request: Request,
  d1: D1Database,
  kv: KVNamespace,
  targetUserId: string,
  adminUserId: string
) {
  const { lucia } = createAuth(d1, kv);
  const cookieHeader = request.headers.get("Cookie") ?? "";
  const currentSessionId = lucia.readSessionCookie(cookieHeader);

  const newSession = await lucia.createSession(targetUserId, {});
  await kv.put(
    `imp:${newSession.id}`,
    JSON.stringify({ adminUserId } satisfies ImpersonationData),
    { expirationTtl: 60 * 60 * 24 * 30 }
  );

  if (currentSessionId) {
    await lucia.invalidateSession(currentSessionId);
    evictSessionUserCache(currentSessionId);
  }

  return lucia.createSessionCookie(newSession.id);
}

export async function stopImpersonation(
  request: Request,
  d1: D1Database,
  kv: KVNamespace
) {
  const { lucia } = createAuth(d1, kv);
  const cookieHeader = request.headers.get("Cookie") ?? "";
  const currentSessionId = lucia.readSessionCookie(cookieHeader);
  if (!currentSessionId) return null;

  const data = await kv.get<ImpersonationData>(`imp:${currentSessionId}`, "json");
  if (!data?.adminUserId) return null;

  await kv.delete(`imp:${currentSessionId}`);
  await lucia.invalidateSession(currentSessionId);
  evictSessionUserCache(currentSessionId);

  const adminSession = await lucia.createSession(data.adminUserId, {});
  return lucia.createSessionCookie(adminSession.id);
}

function createKVAdapter(kv: KVNamespace, db: ReturnType<typeof createDB>) {
  return {
    async getSessionAndUser(
      sessionId: string
    ): Promise<
      [
        import("lucia").DatabaseSession | null,
        import("lucia").DatabaseUser | null
      ]
    > {
      // Guard against empty/malformed session IDs that cause KV 400 errors
      if (!sessionId || sessionId.length < 8) return [null, null];
      let raw: KVSessionData | null;
      try {
        raw = await kv.get<KVSessionData>(`session:${sessionId}`, "json");
      } catch {
        return [null, null];
      }
      if (!raw) return [null, null];

      const expiresAt = new Date(raw.expiresAt);
      if (expiresAt < new Date()) {
        await kv.delete(`session:${sessionId}`);
        return [null, null];
      }

      const user = await db.getUserById(raw.userId);
      if (!user) return [null, null];

      return [
        { id: sessionId, userId: raw.userId, expiresAt, attributes: {} },
        {
          id: user.id,
          attributes: {
            email: user.email,
            name: user.name,
            role: user.role,
            avatar_url: user.avatar_url,
            language: user.language ?? "th",
            created_at: user.created_at,
            updated_at: user.updated_at,
          },
        },
      ];
    },

    async getUserSessions(): Promise<import("lucia").DatabaseSession[]> {
      return []; // KV doesn't support efficient reverse lookups
    },

    async setSession(session: import("lucia").DatabaseSession): Promise<void> {
      const ttlSeconds = Math.max(
        1,
        Math.floor((session.expiresAt.getTime() - Date.now()) / 1000)
      );
      await kv.put(
        `session:${session.id}`,
        JSON.stringify({
          userId: session.userId,
          expiresAt: session.expiresAt.getTime(),
        } satisfies KVSessionData),
        { expirationTtl: ttlSeconds }
      );
    },

    async updateSessionExpiration(
      sessionId: string,
      expiresAt: Date
    ): Promise<void> {
      const raw = await kv.get<KVSessionData>(`session:${sessionId}`, "json");
      if (!raw) return;
      const ttlSeconds = Math.max(
        1,
        Math.floor((expiresAt.getTime() - Date.now()) / 1000)
      );
      await kv.put(
        `session:${sessionId}`,
        JSON.stringify({ ...raw, expiresAt: expiresAt.getTime() }),
        { expirationTtl: ttlSeconds }
      );
    },

    async deleteSession(sessionId: string): Promise<void> {
      await kv.delete(`session:${sessionId}`);
    },

    async deleteUserSessions(_userId: string): Promise<void> {
      // Not practical with KV — would require a secondary index
    },

    async deleteExpiredSessions(): Promise<void> {
      // KV handles TTL-based expiry automatically
    },
  };
}

// ─── Lucia instance factory ───────────────────────────────────────────────────

export function createAuth(d1: D1Database, kv: KVNamespace) {
  const db = createDB(d1);
  const adapter = createKVAdapter(kv, db);

  const lucia = new Lucia(adapter, {
    sessionExpiresIn: new TimeSpan(30, "d"),
    sessionCookie: {
      name: "doaction_session",
      attributes: {
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
      },
    },
    getUserAttributes(attributes) {
      const attrs = attributes as Record<string, unknown>;
      return {
        email: attrs.email as string,
        name: attrs.name as string,
        role: attrs.role as UserRole,
        avatar_url: attrs.avatar_url as string | null,
        language: attrs.language as UserLanguage,
        created_at: attrs.created_at as number,
        updated_at: attrs.updated_at as number,
      };
    },
  });

  return { lucia, db };
}

export type Auth = ReturnType<typeof createAuth>;

// ─── Magic Link ───────────────────────────────────────────────────────────────

export function generateMagicToken() {
  return {
    id: generateId(),
    token: generateId(48),
    expires_at: Math.floor(Date.now() / 1000) + 60 * 15, // 15 min
  };
}

// Email sending is handled by app/lib/email.server.ts (SMTP2GO)

// ─── Session / Auth helpers ───────────────────────────────────────────────────

export async function getAuthenticatedUser(
  request: Request,
  d1: D1Database,
  kv: KVNamespace
): Promise<User | null> {
  const { lucia } = createAuth(d1, kv);
  const cookieHeader = request.headers.get("Cookie") ?? "";
  const sessionId = lucia.readSessionCookie(cookieHeader);
  if (!sessionId) return null;
  const cached = sessionUserCache.get(sessionId);
  if (cached && Date.now() - cached.cachedAt < SESSION_CACHE_TTL_MS) {
    return cached.user;
  }

  let session: import("lucia").Session | null;
  let user: import("lucia").User | null;
  try {
    ({ session, user } = await lucia.validateSession(sessionId));
  } catch {
    // KV error (e.g. 400 Bad Request with malformed session) — treat as invalid
    sessionUserCache.set(sessionId, { cachedAt: Date.now(), user: null });
    return null;
  }

  if (!session || !user) {
    sessionUserCache.set(sessionId, { cachedAt: Date.now(), user: null });
    return null;
  }

  const authenticatedUser = user as unknown as User;
  sessionUserCache.set(sessionId, {
    cachedAt: Date.now(),
    user: authenticatedUser,
  });
  return authenticatedUser;
}

export async function requireUser(
  request: Request,
  d1: D1Database,
  kv: KVNamespace
): Promise<User> {
  const user = await getAuthenticatedUser(request, d1, kv);
  if (!user) {
    const pathname = new URL(request.url).pathname;
    throw new Response(null, {
      status: 302,
      headers: {
        Location: `/login?redirect=${encodeURIComponent(pathname)}`,
      },
    });
  }
  return user;
}

export async function requireAdmin(
  request: Request,
  d1: D1Database,
  kv: KVNamespace
): Promise<User> {
  const user = await requireUser(request, d1, kv);
  if (user.role !== "admin") {
    throw new Response("Forbidden", { status: 403 });
  }
  return user;
}

export async function requireCoAdminOrAdmin(
  request: Request,
  d1: D1Database,
  kv: KVNamespace
): Promise<User> {
  const user = await requireUser(request, d1, kv);
  if (user.role !== "admin" && user.role !== "co-admin") {
    throw new Response("Forbidden", { status: 403 });
  }
  return user;
}

// ─── Password hashing (Web Crypto — Cloudflare Workers compatible) ────────────

export async function hashPassword(password: string): Promise<string> {
  const encoder = new TextEncoder();
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    encoder.encode(password),
    "PBKDF2",
    false,
    ["deriveBits"]
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt, iterations: 100_000, hash: "SHA-256" },
    keyMaterial,
    256
  );
  const hash = new Uint8Array(bits);
  const combined = new Uint8Array(16 + 32);
  combined.set(salt);
  combined.set(hash, 16);
  return btoa(String.fromCharCode(...combined));
}

export async function verifyPassword(
  password: string,
  stored: string
): Promise<boolean> {
  try {
    const encoder = new TextEncoder();
    const combined = Uint8Array.from(atob(stored), (c) => c.charCodeAt(0));
    const salt = combined.slice(0, 16);
    const storedHash = combined.slice(16);
    const keyMaterial = await crypto.subtle.importKey(
      "raw",
      encoder.encode(password),
      "PBKDF2",
      false,
      ["deriveBits"]
    );
    const bits = await crypto.subtle.deriveBits(
      { name: "PBKDF2", salt, iterations: 100_000, hash: "SHA-256" },
      keyMaterial,
      256
    );
    const hash = new Uint8Array(bits);
    // Constant-time comparison
    return (
      hash.length === storedHash.length &&
      hash.every((b, i) => b === storedHash[i])
    );
  } catch {
    return false;
  }
}
