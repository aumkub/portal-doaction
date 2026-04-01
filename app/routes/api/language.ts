import type { Route } from "./+types/language";
import { createAuth, evictSessionUserCache, requireUser } from "~/lib/auth.server";
import { createDB } from "~/lib/db.server";
import { createLanguageCookie, resolveLanguage } from "~/lib/i18n";

/** POST /api/language — update current user's language preference */
export async function action({ request, context }: Route.ActionArgs) {
  const env = context.cloudflare.env;
  const user = await requireUser(request, env.DB, env.SESSIONPORTAL);
  const formData = await request.formData();
  const language = resolveLanguage(formData.get("language"));

  const db = createDB(env.DB);
  try {
    await db.updateUser(user.id, { language });
  } catch (error) {
    // Keep language switching working even before DB migrations are applied.
    console.warn("[language] failed to persist language in DB:", error);
  }

  const { lucia } = createAuth(env.DB, env.SESSIONPORTAL);
  const sessionId = lucia.readSessionCookie(request.headers.get("Cookie") ?? "");
  if (sessionId) evictSessionUserCache(sessionId);

  return Response.json(
    { ok: true, language },
    { headers: { "Set-Cookie": createLanguageCookie(language) } }
  );
}
