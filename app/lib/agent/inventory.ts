import { z } from "zod";

const str = (max = 200) => z.string().trim().max(max);
const ver = str(64);

export const PluginItem = z.object({
  slug: str(200), name: str(300), version: ver,
  active: z.boolean(),
  update_version: ver.nullable().default(null),
  /** Why the offered update cannot run here (PHP/WordPress too old), from the plugin. */
  update_blocked: str(300).nullable().default(null),
  auto_update: z.boolean().default(false),
});

export const ThemeItem = z.object({
  slug: str(200), name: str(300), version: ver,
  active: z.boolean(),
  update_version: ver.nullable().default(null),
  update_blocked: str(300).nullable().default(null),
});

const BackupSource = z.object({
  tool: z.enum(["updraftplus", "ai1wm"]),
  last_at: z.number().int().nonnegative(),
  ok: z.boolean().nullable(),
  remote: z.array(str(40)).max(10),
  files: z.array(z.object({ name: str(200), size: z.number().int().nonnegative(), at: z.number().int() })).max(5),
  events: z.array(z.object({
    title: str(200), storage: str(40), enabled: z.boolean(), interval: str(40), last_status: str(20),
    last_success_at: z.number().int().nullable(), last_failed_at: z.number().int().nullable(),
    last_error: z.string().max(400).nullable(),
  })).max(10).default([]),
  drive_linked: z.boolean().default(false),
});

export const InventorySchema = z.object({
  plugin_version: ver,
  wp_version: ver,
  php_version: ver,
  mysql_version: ver.nullable().default(null),
  site_url: z.string().url().max(500),
  home_url: z.string().url().max(500),
  is_multisite: z.boolean(),
  plugins: z.array(PluginItem).max(1000),
  themes: z.array(ThemeItem).max(300),
  core_update: ver.nullable().default(null),
  core_update_blocked: str(300).nullable().default(null),
  disk_free_mb: z.number().finite().nonnegative().nullable().default(null),
  db_size_mb: z.number().finite().nonnegative().nullable().default(null),
  file_mods_allowed: z.boolean(),
  site_health: z.object({
    good: z.number().int().nonnegative(),
    recommended: z.number().int().nonnegative(),
    critical: z.number().int().nonnegative(),
  }).nullable().default(null),
  backup: z.object({
    last_at: z.number().int().nullable(),
    sources: z.array(BackupSource).max(5),
  }).nullable().default(null),
});

export type SiteInventory = z.infer<typeof InventorySchema>;

export const PairSchema = z.object({
  code: str(64),
  site_url: z.string().url().max(500),
  wp_version: ver,
  plugin_version: ver,
});

export const JobReportSchema = z.object({
  job_id: str(64),
  status: z.enum(["succeeded", "rolled_back", "failed"]),
  result_version: ver.nullable().default(null),
  log: z.string().max(8000),
});

export const WidgetTicketSchema = z.object({
  /** Renewal request: allowed after support expired; the server sets the title. */
  renewal: z.boolean().default(false),
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().min(1).max(5000),
  reporter: str(200).nullable().default(null),
  reporter_name: str(200).nullable().default(null),
  reporter_email: z.string().trim().toLowerCase().email().max(200).nullable().catch(null).default(null),
});

export const SsoRequestSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(200),
  wp_user: str(200).nullable().default(null),
  /** Where to land after sign-in; only a ticket page or the new-ticket form. */
  path: z.string().regex(/^\/tickets\/(new|[A-Za-z0-9_-]{8,64})$/).catch("/tickets/new").default("/tickets/new"),
});
