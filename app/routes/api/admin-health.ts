import type { Route } from "./+types/admin-health";
import { requireAdmin } from "~/lib/auth.server";
import { HEALTH_CHECK_IDS, isHealthCheckId, runHealthCheck } from "~/lib/health.server";

/**
 * POST /api/admin/health — run one connection check (`check=<id>`) or all of
 * them (`check=all`). Admin only; every check is read-only.
 */
export async function action({ request, context }: Route.ActionArgs) {
  const env = context.cloudflare.env;
  await requireAdmin(request, env.DB, env.SESSIONPORTAL);
  const form = await request.formData();
  const check = String(form.get("check") ?? "all");
  const ids = check === "all" ? HEALTH_CHECK_IDS : isHealthCheckId(check) ? [check] : [];
  const results = await Promise.all(ids.map((id) => runHealthCheck(env, id)));
  return { results, checkedAt: Math.floor(Date.now() / 1000) };
}
