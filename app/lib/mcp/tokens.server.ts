import { generateId } from "~/lib/utils";

/**
 * MCP access tokens. Only the SHA-256 of a token is stored, in KV under
 * `mcp_token:{hash}`, so a leaked KV dump cannot be replayed.
 */

const PREFIX = "mcp_token:";

export interface McpTokenRecord {
  user_id: string;
  label: string;
  /** First characters of the token, shown in the UI to tell tokens apart. */
  hint: string;
  created_at: number;
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Create a token for a user. The plain token is returned once and never stored. */
export async function createMcpToken(
  kv: KVNamespace,
  userId: string,
  label: string
): Promise<string> {
  const token = `pmcp_${generateId(40)}`;
  const record: McpTokenRecord = {
    user_id: userId,
    label: label || "MCP",
    hint: token.slice(0, 10),
    created_at: Math.floor(Date.now() / 1000),
  };
  await kv.put(PREFIX + (await sha256Hex(token)), JSON.stringify(record), {
    metadata: record,
  });
  return token;
}

export async function verifyMcpToken(
  kv: KVNamespace,
  token: string
): Promise<McpTokenRecord | null> {
  if (!token.startsWith("pmcp_")) return null;
  const raw = await kv.get(PREFIX + (await sha256Hex(token)));
  return raw ? (JSON.parse(raw) as McpTokenRecord) : null;
}

export async function listMcpTokens(
  kv: KVNamespace,
  userId: string
): Promise<(McpTokenRecord & { id: string })[]> {
  const { keys } = await kv.list<McpTokenRecord>({ prefix: PREFIX });
  return keys
    .filter((k) => k.metadata?.user_id === userId)
    .map((k) => ({ ...(k.metadata as McpTokenRecord), id: k.name.slice(PREFIX.length) }))
    .sort((a, b) => b.created_at - a.created_at);
}

/** Revoke by the stored hash id (as returned from `listMcpTokens`). */
export async function revokeMcpToken(
  kv: KVNamespace,
  userId: string,
  id: string
): Promise<void> {
  const raw = await kv.get(PREFIX + id);
  if (!raw) return;
  if ((JSON.parse(raw) as McpTokenRecord).user_id !== userId) return;
  await kv.delete(PREFIX + id);
}
