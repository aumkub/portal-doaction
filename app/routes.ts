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
    route("tickets", "routes/_client/tickets.tsx"),
  ]),

  // ── Admin routes ─────────────────────────────────────────────────────────────
  ...prefix("admin", [
    layout("routes/_admin/layout.tsx", [
      route("clients", "routes/_admin/clients.tsx"),
      route("reports", "routes/_admin/reports.tsx"),
      route("reports/new", "routes/_admin/reports-new.tsx"),
      route("reports/:reportId", "routes/_admin/reports-detail.tsx"),
    ]),
  ]),

  // ── API / Action routes ───────────────────────────────────────────────────────
  route("logout", "routes/api/logout.ts"),
] satisfies RouteConfig;
