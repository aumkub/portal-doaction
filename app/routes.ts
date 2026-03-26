import {
  type RouteConfig,
  index,
  layout,
  route,
  prefix,
} from "@react-router/dev/routes";

export default [
  // Root redirect
  index("routes/home.tsx"),

  // ── Auth routes ─────────────────────────────────────────────────────────────
  layout("routes/_auth/layout.tsx", [
    route("login", "routes/_auth/login.tsx"),
    route("magic-link", "routes/_auth/magic-link.tsx"),
  ]),

  // ── Client routes ────────────────────────────────────────────────────────────
  layout("routes/_client/layout.tsx", [
    route("dashboard", "routes/_client/dashboard.tsx"),
    route("reports", "routes/_client/reports-list.tsx"),
    route("reports/:reportId", "routes/_client/reports-detail.tsx"),
    route("tickets", "routes/_client/tickets._index.tsx"),
    route("tickets/new", "routes/_client/tickets.new.tsx"),
    route("tickets/:ticketId", "routes/_client/tickets.$ticketId.tsx"),
    route("documents", "routes/_client/documents.tsx"),
    route("settings", "routes/_client/settings.tsx"),
  ]),

  // ── Admin routes ─────────────────────────────────────────────────────────────
  ...prefix("admin", [
    layout("routes/_admin/layout.tsx", [
      index("routes/_admin/index.tsx"),
      route("clients", "routes/_admin/clients.tsx"),
      route("clients/new", "routes/_admin/clients-new.tsx"),
      route("clients/:clientId", "routes/_admin/client-detail.tsx"),
      route("tickets", "routes/_admin/tickets.tsx"),
      route("tickets/:ticketId", "routes/_admin/tickets.$ticketId.tsx"),
      route("reports", "routes/_admin/reports.tsx"),
      route("reports/new", "routes/_admin/reports-new.tsx"),
      route("reports/:reportId", "routes/_admin/reports-detail.tsx"),
      route("settings", "routes/_admin/settings.tsx"),
    ]),
  ]),

  // ── API / Action routes ───────────────────────────────────────────────────────
  route("logout", "routes/api/logout.ts"),
  route("api/send-magic-link", "routes/api/send-magic-link.ts"),
  route("api/notifications/read", "routes/api/notifications-read.ts"),
  route("api/impersonation/stop", "routes/api/impersonation-stop.ts"),
  route("api/uptime", "routes/api/uptime.ts"),
] satisfies RouteConfig;
