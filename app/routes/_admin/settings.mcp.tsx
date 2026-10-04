import { Form, useActionData, useLoaderData, useNavigation } from "react-router";
import { FaPlug, FaKey, FaTrash, FaCopy } from "react-icons/fa6";
import { requireAdmin } from "~/lib/auth.server";
import { createMcpToken, listMcpTokens, revokeMcpToken } from "~/lib/mcp/tokens.server";
import { formatDate } from "~/lib/utils";
import { useT } from "~/lib/i18n";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";

export function meta() {
  return [{ title: "MCP — Admin" }];
}

export async function loader({ request, context }: any) {
  const env = context.cloudflare.env;
  const admin = await requireAdmin(request, env.DB, env.SESSIONPORTAL);
  const origin = String(env.APP_URL || new URL(request.url).origin).replace(/\/$/, "");
  return {
    endpoint: `${origin}/mcp`,
    tokens: await listMcpTokens(env.SESSIONPORTAL, admin.id),
  };
}

export async function action({ request, context }: any) {
  const env = context.cloudflare.env;
  const admin = await requireAdmin(request, env.DB, env.SESSIONPORTAL);
  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "create") {
    const label = String(formData.get("label") ?? "").trim().slice(0, 60);
    const token = await createMcpToken(env.SESSIONPORTAL, admin.id, label);
    return { token };
  }
  if (intent === "revoke") {
    await revokeMcpToken(env.SESSIONPORTAL, admin.id, String(formData.get("id") ?? ""));
    return { revoked: true };
  }
  return { error: "Invalid action" };
}

function CopyBlock({ text }: { text: string }) {
  return (
    <div className="relative">
      <pre className="rounded-[14px] bg-ink text-white/90 text-xs p-4 pr-12 overflow-x-auto whitespace-pre">{text}</pre>
      <button
        type="button"
        onClick={() => navigator.clipboard?.writeText(text)}
        className="absolute top-2 right-2 rounded-md p-2 text-slate-300 hover:bg-white/10"
        aria-label="Copy"
      >
        <FaCopy />
      </button>
    </div>
  );
}

export default function McpSettingsPage() {
  const { endpoint, tokens } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const { lang } = useT();
  const newToken = actionData && "token" in actionData ? actionData.token : null;
  const shownToken = newToken ?? "pmcp_YOUR_TOKEN";

  return (
    <div className="space-y-6 max-w-3xl">
      <div className="flex items-center gap-3">
        <span className="flex h-10 w-10 items-center justify-center rounded-[12px] bg-ink text-brand-yellow">
          <FaPlug className="text-lg" />
        </span>
        <div>
          <h1 className="text-[28px] md:text-[32px] font-bold tracking-[-0.02em] text-ink">MCP Server</h1>
          <p className="text-sm text-muted-ink mt-0.5">
            เชื่อม Claude (Desktop / Code / claude.ai) เข้ากับ portal เพื่ออ่านและจัดการ ticket, รายงาน และลูกค้า
          </p>
        </div>
      </div>

      <div className="bg-white rounded-[20px] border border-line p-6 space-y-4">
        <h2 className="text-[16px] font-semibold text-ink flex items-center gap-2">
          <FaKey className="text-faint-ink" /> Access tokens
        </h2>

        <Form method="post" className="flex flex-col sm:flex-row gap-2">
          <input type="hidden" name="intent" value="create" />
          <Input name="label" placeholder="ชื่อ token เช่น Claude Desktop (MacBook)" className="flex-1" />
          <Button type="submit" disabled={navigation.state === "submitting"}>
            สร้าง token
          </Button>
        </Form>

        {newToken && (
          <div className="rounded-[14px] border border-amber-200 bg-amber-50 p-4 space-y-2">
            <p className="text-sm font-medium text-amber-900">
              คัดลอก token นี้เก็บไว้ — จะแสดงแค่ครั้งเดียว
            </p>
            <CopyBlock text={newToken} />
          </div>
        )}

        {tokens.length === 0 ? (
          <p className="text-sm text-muted-ink">ยังไม่มี token</p>
        ) : (
          <ul className="divide-y divide-line-soft rounded-[14px] border border-line">
            {tokens.map((tk) => (
              <li key={tk.id} className="flex items-center justify-between gap-3 px-4 py-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-ink truncate">{tk.label}</p>
                  <p className="text-xs text-muted-ink">
                    {tk.hint}… · {formatDate(tk.created_at, lang)}
                  </p>
                </div>
                <Form method="post">
                  <input type="hidden" name="intent" value="revoke" />
                  <input type="hidden" name="id" value={tk.id} />
                  <Button type="submit" variant="outline" size="sm" className="text-rose-600">
                    <FaTrash /> ยกเลิก
                  </Button>
                </Form>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="bg-white rounded-[20px] border border-line p-6 space-y-4">
        <h2 className="text-[16px] font-semibold text-ink">วิธีเชื่อมต่อ</h2>
        <p className="text-sm text-ink-soft">Endpoint: <code className="rounded bg-paper px-1.5 py-0.5 font-mono text-[13px] text-ink">{endpoint}</code></p>

        <p className="text-sm font-medium text-ink">Claude Code</p>
        <CopyBlock
          text={`claude mcp add --transport http doaction-portal ${endpoint} --header "Authorization: Bearer ${shownToken}"`}
        />

        <p className="text-sm font-medium text-ink">Claude Desktop (claude_desktop_config.json)</p>
        <CopyBlock
          text={JSON.stringify(
            {
              mcpServers: {
                "doaction-portal": {
                  command: "npx",
                  args: ["-y", "mcp-remote", endpoint, "--header", `Authorization: Bearer ${shownToken}`],
                },
              },
            },
            null,
            2
          )}
        />
      </div>
    </div>
  );
}
