import type { SiteInventory } from "./inventory";

export type UpdateLevel = "major" | "minor" | "patch";

function parts(v: string): number[] {
  return v.split(/[.\-+]/).map((p) => Number.parseInt(p, 10)).map((n) => (Number.isNaN(n) ? 0 : n));
}

/**
 * How big an update is. Plugins and themes follow semver (x changes =
 * major). WordPress core treats x.y as the major release (6.6 → 6.7), so a
 * change in either of the first two numbers is major there.
 */
export function updateLevel(kind: "plugin" | "theme" | "core", from: string, to: string): UpdateLevel {
  const a = parts(from);
  const b = parts(to);
  if ((a[0] ?? 0) !== (b[0] ?? 0)) return "major";
  if ((a[1] ?? 0) !== (b[1] ?? 0)) return kind === "core" ? "major" : "minor";
  return "patch";
}

export type PendingUpdate = { kind: "plugin" | "theme" | "core"; slug: string; name: string; from: string; to: string; level: UpdateLevel };

/** Every update a site is offered, with its level. */
export function pendingUpdates(inv: Pick<SiteInventory, "plugins" | "themes" | "core_update" | "wp_version">): PendingUpdate[] {
  const out: PendingUpdate[] = [];
  if (inv.core_update) out.push({ kind: "core", slug: "wordpress", name: "WordPress", from: inv.wp_version, to: inv.core_update, level: updateLevel("core", inv.wp_version, inv.core_update) });
  for (const p of inv.plugins) if (p.update_version) out.push({ kind: "plugin", slug: p.slug, name: p.name, from: p.version, to: p.update_version, level: updateLevel("plugin", p.version, p.update_version) });
  for (const t of inv.themes) if (t.update_version) out.push({ kind: "theme", slug: t.slug, name: t.name, from: t.version, to: t.update_version, level: updateLevel("theme", t.version, t.update_version) });
  return out;
}
