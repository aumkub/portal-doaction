/**
 * Plugin families: a main plugin and its add-ons (GreenShift + GreenShift Query,
 * Fluent Forms + Fluent Forms Pro, Elementor + Elementor Pro, EDD + edd-*).
 * Updating only one side can break the site, so the runner updates a family
 * together, parent first, and checks the site once at the end.
 */

/** Folder of a plugin file, e.g. "greenshiftquery/greenshiftquery.php" -> "greenshiftquery". */
function folder(slug: string): string {
  return slug.includes("/") ? slug.slice(0, slug.indexOf("/")) : slug.replace(/\.php$/, "");
}

const squash = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

/** Add-ons whose folder doesn't start with the parent's name. */
const KNOWN_PREFIXES: Record<string, string[]> = {
  "easy-digital-downloads": ["edd"],
  woocommerce: ["wc", "woocommerce"],
};

export function isAddonOf(addon: string, parent: string): boolean {
  const pd = folder(parent);
  const ad = folder(addon);
  if (ad === pd) return false;
  const a = squash(ad);
  const longer = (p: string) => a.startsWith(p) && a.length > p.length;
  // "elementor" -> "elementor-pro", "affiliate-wp" -> "affiliatewp-direct-link-tracking".
  if (longer(squash(pd))) return true;
  // "greenshift-animation-and-page-builder-blocks" -> "greenshiftquery". Only when the
  // add-on glues onto the word: "contact-form-cfdb7" is a sibling of "contact-form-7",
  // not its add-on. Short words ("all", "wp") are too generic.
  const first = pd.split("-")[0];
  if (first.length >= 6 && longer(first) && !ad.startsWith(`${first}-`)) return true;
  return (KNOWN_PREFIXES[pd.replace(/-pro$/, "")] ?? []).some((p) => ad.startsWith(`${p}-`));
}

/**
 * The family root of `slug` among `slugs`: the plugin it is an add-on of, or itself.
 * The shortest matching parent wins, so "fluentformpro" maps to "fluentform".
 */
export function familyRoot(slug: string, slugs: string[]): string {
  const parents = slugs.filter((p) => isAddonOf(slug, p));
  if (parents.length === 0) return slug;
  parents.sort((a, b) => folder(a).length - folder(b).length);
  return familyRoot(parents[0], slugs.filter((s) => s !== slug));
}
