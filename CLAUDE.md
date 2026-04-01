# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev          # Start dev server with HMR at localhost:5173
npm run build        # Production build
npm run check        # Full check: tsc + build + wrangler dry-run deploy
npm run typecheck    # Regenerate types then run tsc
npm run cf-typegen   # Regenerate Cloudflare binding types + React Router types
npm run deploy       # Deploy to Cloudflare Workers

# Database
npm run db:init:local   # Apply migrations to local D1
npm run db:init:remote  # Apply migrations to production D1
```

There are no tests. Use `npm run check` to validate TypeScript and build integrity before committing.

## Architecture

**Stack:** React Router 7 (SSR) + Cloudflare Workers + D1 (SQLite) + KV (sessions)

### Infrastructure bindings (`wrangler.toml`)
- `DB` → Cloudflare D1 (all app data)
- `SESSIONPORTAL` → Cloudflare KV (session tokens via Lucia)
- `SMTP2GO_API_KEY`, `APP_URL`, `SESSION_SECRET` → env vars

### Route layout (`app/routes.ts`)
Routes are defined explicitly (not file-based) in `app/routes.ts`. Three layout groups:
- `_auth/layout.tsx` — unauthenticated (login, magic-link)
- `_client/layout.tsx` — authenticated clients (dashboard, reports, tickets, documents, settings)
- `_admin/layout.tsx` — admin-only (`/admin/*`: clients, reports, tickets, settings)
- `routes/api/*` — action-only routes (logout, notifications, impersonation, uptime)

### Authentication (`app/lib/auth.server.ts`)
- Passwordless magic-link login via SMTP2GO email
- Sessions stored in Cloudflare KV with `session:{id}` keys, 30-day TTL
- Lucia v3 with a custom KV adapter
- `requireUser(request, env.DB, env.SESSIONPORTAL)` — redirects to `/login` if unauthenticated
- `requireAdmin(...)` — throws 403 if not admin role
- Admin impersonation: admin can view the app as a specific client; stopped via `/api/impersonation/stop`

### Database (`app/lib/db.server.ts`)
`createDB(d1)` returns a typed query object (no ORM). All queries are raw D1 prepared statements. Schema is in `migrations/0001_init.sql`. Tables: `users`, `sessions`, `magic_link_tokens`, `clients`, `monthly_reports`, `report_tasks`, `support_tickets`, `ticket_messages`, `notifications`.

### Data model highlights (`app/types/index.ts`)
- `User` has `role: "admin" | "client"`
- Each `Client` has one `user_id` linking it to a `User`
- `MonthlyReport` → many `ReportTask` (category: maintenance/development/security/seo/performance/other)
- `SupportTicket` status flow: `open` → `in_progress` → `waiting` → `resolved` → `closed`
- `TicketMessage.is_internal` (0/1) — internal notes hidden from clients
- All timestamps are Unix epoch integers

### i18n (`app/lib/i18n.tsx`, `app/lib/translations.ts`)
- `I18nProvider` wraps the entire app in `app/root.tsx`
- `useT()` returns `{ t, lang, setLang }` — use in any component
- Language preference stored in `localStorage` under key `portal_lang`, defaults to `"th"`
- All translation strings live in `app/lib/translations.ts` as a flat key-value map
- `formatDate(unix, locale)` and `formatRelativeTime(unix, locale)` in `app/lib/utils.ts` accept `"th" | "en"`
- Reports page uses Buddhist era year (`year + 543`) for Thai, Gregorian for English

### Cloudflare-specific constraints
- No Node.js APIs — use Web Crypto (`crypto.subtle`, `crypto.getRandomValues`)
- `generateId()` in `app/lib/utils.ts` uses Web Crypto for URL-safe random IDs
- Env bindings are accessed via `context.cloudflare.env` in loaders/actions
- Do not add `.claude/worktrees/` paths to git — they are gitignored and will break deploys if committed as gitlinks
