import { z } from "zod";
import { createDB } from "~/lib/db.server";
import { verifyMcpToken } from "~/lib/mcp/tokens.server";
import { tools, ToolError, type ToolContext } from "~/lib/mcp/tools.server";

/**
 * Minimal stateless MCP server (Streamable HTTP transport, JSON responses).
 * Every request is a JSON-RPC POST to /mcp authenticated with
 * `Authorization: Bearer pmcp_...`; no sessions or SSE streams are kept.
 */

const PROTOCOL_VERSIONS = ["2025-06-18", "2025-03-26", "2024-11-05"];

const INSTRUCTIONS = `do action client portal (website maintenance clients of do action).
Data: clients, support tickets (status open → in_progress → waiting → resolved → closed), monthly reports with tasks, email logs.
Timestamps are Unix seconds. Report years are Gregorian.
Anything that emails a client (send_email=true, send_report_to_client) must be confirmed by the user first.`;

type JsonRpcId = string | number | null;

interface JsonRpcRequest {
  jsonrpc: "2.0";
  id?: JsonRpcId;
  method: string;
  params?: Record<string, unknown>;
}

const toolList = tools.map((t) => ({
  name: t.name,
  title: t.title,
  description: t.description,
  inputSchema: z.toJSONSchema(t.input, { io: "input" }),
  annotations: {
    title: t.title,
    readOnlyHint: !!t.readOnly,
    destructiveHint: !!t.destructive,
    openWorldHint: false,
  },
}));

function rpcResult(id: JsonRpcId, result: unknown) {
  return { jsonrpc: "2.0", id, result };
}

function rpcError(id: JsonRpcId, code: number, message: string) {
  return { jsonrpc: "2.0", id, error: { code, message } };
}

async function callTool(params: Record<string, unknown> | undefined, ctx: ToolContext) {
  const t = tools.find((x) => x.name === params?.name);
  if (!t) return { isError: true, content: [{ type: "text", text: `Unknown tool: ${String(params?.name)}` }] };

  const parsed = t.input.safeParse(params?.arguments ?? {});
  if (!parsed.success) {
    return { isError: true, content: [{ type: "text", text: `Invalid arguments: ${z.prettifyError(parsed.error)}` }] };
  }
  try {
    // Each tool's run() is typed against its own schema; the array erases that.
    const result = await (t.run as (a: unknown, c: ToolContext) => Promise<unknown>)(parsed.data, ctx);
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  } catch (e) {
    if (!(e instanceof ToolError)) console.error(`[mcp] ${t.name}`, e);
    return { isError: true, content: [{ type: "text", text: e instanceof Error ? e.message : String(e) }] };
  }
}

async function handleMessage(msg: JsonRpcRequest, ctx: ToolContext) {
  const id = msg.id ?? null;
  switch (msg.method) {
    case "initialize": {
      const requested = String(msg.params?.protocolVersion ?? "");
      return rpcResult(id, {
        protocolVersion: PROTOCOL_VERSIONS.includes(requested) ? requested : PROTOCOL_VERSIONS[0],
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "doaction-portal", title: "do action Portal", version: "1.0.0" },
        instructions: INSTRUCTIONS,
      });
    }
    case "ping":
      return rpcResult(id, {});
    case "tools/list":
      return rpcResult(id, { tools: toolList });
    case "tools/call":
      return rpcResult(id, await callTool(msg.params, ctx));
    default:
      return rpcError(id, -32601, `Method not found: ${msg.method}`);
  }
}

export async function handleMcpRequest(request: Request, env: CloudflareEnv): Promise<Response> {
  if (request.method !== "POST") {
    // No server-initiated streams in stateless mode.
    return new Response("Method Not Allowed", { status: 405, headers: { Allow: "POST" } });
  }

  const token = request.headers.get("Authorization")?.match(/^Bearer\s+(\S+)$/i)?.[1];
  const record = token ? await verifyMcpToken(env.SESSIONPORTAL, token) : null;
  const db = createDB(env.DB);
  const user = record ? await db.getUserById(record.user_id) : null;
  if (!user || user.role !== "admin") {
    return Response.json(rpcError(null, -32001, "Unauthorized: invalid or revoked MCP token"), {
      status: 401,
      headers: { "WWW-Authenticate": 'Bearer realm="mcp"' },
    });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json(rpcError(null, -32700, "Parse error"), { status: 400 });
  }

  const ctx: ToolContext = { env, db, user, origin: new URL(request.url).origin };
  const batch = Array.isArray(body);
  const messages = (batch ? body : [body]) as JsonRpcRequest[];

  const responses = [];
  for (const msg of messages) {
    if (!msg || msg.jsonrpc !== "2.0" || typeof msg.method !== "string") {
      responses.push(rpcError(null, -32600, "Invalid Request"));
      continue;
    }
    // Notifications (no id) get no response.
    if (msg.id === undefined) continue;
    responses.push(await handleMessage(msg, ctx));
  }

  if (responses.length === 0) return new Response(null, { status: 202 });
  return Response.json(batch ? responses : responses[0]);
}
