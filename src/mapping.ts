// Maps a Figma (collection, mode) pair to one of the six filenames the
// token-inspector loader recognizes. Multi-mode collections split by mode
// name (light/dark); single-mode collections map by collection name.
// Unknown collections fall back to a sanitized name and are surfaced as
// warnings rather than dropped.
//
// NOTE: the substring rules below assume the user's Figma collection names
// contain "color"/"dimension"/"typography"/"global". Confirm against the
// real file in Task 9 and adjust these constants if the names differ.

function sanitize(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

export function filenameFor(
  collectionName: string,
  modeName: string,
  modeCount: number,
): string {
  const c = collectionName.toLowerCase();
  const m = modeName.toLowerCase();

  // Theme-varying collections: split by mode name.
  if (modeCount > 1 || /semantic|theme/.test(c)) {
    if (m.includes("dark")) return "dark.tokens.json";
    if (m.includes("light")) return "light.tokens.json";
  }

  if (c.includes("typography")) return "typography.tokens.json";
  if (c.includes("dimension") || c.includes("spacing")) return "dimension.tokens.json";
  if (c.includes("color")) return "color.tokens.json";
  if (c.includes("global") || c.includes("component")) return "global.tokens.json";

  const base = sanitize(collectionName) || "tokens";
  return modeCount > 1
    ? `${base}-${sanitize(modeName)}.tokens.json`
    : `${base}.tokens.json`;
}
