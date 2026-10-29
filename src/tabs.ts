/** The left dock's four tool windows are a user-ordered strip: the stored
 *  order is the only thing that says which comes first, so it has to be
 *  repaired rather than trusted — a stored value may predate a tab, name one
 *  twice, or carry a name that no longer exists. */

import type { IconName } from "./icons";

export type ToolTab = "commit" | "branch" | "files" | "console";

export const TOOL_TABS: ToolTab[] = ["commit", "branch", "files", "console"];

/** The glyph each tab wears, shared by the strip and the settings list. */
export const TOOL_TAB_ICONS: Record<ToolTab, IconName> = {
  commit: "commit",
  branch: "branch",
  files: "folder",
  console: "console",
};

/** A complete permutation of `TOOL_TABS`: known names only, no repeats, in the
 *  stored order, with anything missing appended. */
export function normalizeTabOrder(value: unknown): ToolTab[] {
  const seen = new Set<ToolTab>();
  const out: ToolTab[] = [];
  if (Array.isArray(value)) {
    for (const item of value) {
      if (typeof item !== "string") continue;
      const tab = item as ToolTab;
      if (!TOOL_TABS.includes(tab) || seen.has(tab)) continue;
      seen.add(tab);
      out.push(tab);
    }
  }
  for (const tab of TOOL_TABS) if (!seen.has(tab)) out.push(tab);
  return out;
}

/** `list` with the item at `from` moved to `to`; both are clamped, so a drag
 *  past either end lands on that end. */
export function moveItem<T>(list: T[], from: number, to: number): T[] {
  const start = Math.max(0, Math.min(list.length - 1, from));
  const end = Math.max(0, Math.min(list.length - 1, to));
  const out = list.slice();
  const [item] = out.splice(start, 1);
  out.splice(end, 0, item as T);
  return out;
}
