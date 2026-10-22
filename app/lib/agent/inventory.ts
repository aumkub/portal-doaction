import { z } from "zod";

const str = (max = 200) => z.string().trim().max(max);
const ver = str(64);

export const PluginItem = z.object({
  slug: str(200), name: str(300), version: ver,
  active: z.boolean(),
  update_version: ver.nullable().default(null),
  auto_update: z.boolean().default(false),
});

export const ThemeItem = z.object({
  slug: str(200), name: str(300), version: ver,
  active: z.boolean(),
  update_version: ver.nullable().default(null),
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
  disk_free_mb: z.number().finite().nonnegative().nullable().default(null),
  db_size_mb: z.number().finite().nonnegative().nullable().default(null),
  file_mods_allowed: z.boolean(),
  site_health: z.object({
    good: z.number().int().nonnegative(),
    recommended: z.number().int().nonnegative(),
    critical: z.number().int().nonnegative(),
  }).nullable().default(null),
});

export type SiteInventory = z.infer<typeof InventorySchema>;

export const PairSchema = z.object({
  code: str(64),
  site_url: z.string().url().max(500),
  wp_version: ver,
  plugin_version: ver,
});
