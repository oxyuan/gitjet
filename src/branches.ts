import type { RefsSnapshot, RepoRef } from "./mygo";

/**
 * Branch trees for the branch page.
 *
 * A repository with a hundred branches is unreadable as a flat list, so the
 * picker groups branches by their leading path segment: `feat/…` sits under
 * "feat", `fix/…` under "fix", and one-segment names such as `master` are
 * gathered into "protected" or "others". Leaves show only what is left after
 * the group prefix; the tooltip keeps the whole name.
 */

export type BranchTone = "feat" | "fix" | "protected" | "other";

export interface BranchLeaf {
  /** Stable identity: refs/heads/… or refs/remotes/…. */
  key: string;
  /** Whole branch name, e.g. "fix/login" or "origin/feat/login". */
  name: string;
  /** Name without the remote and without the group prefix ("login"). */
  label: string;
  /** Group heading this leaf belongs to ("feat", "protected", …). */
  group: string;
  tone: BranchTone;
  /** Remote name for remote branches, "" for local ones. */
  remote: string;
  current: boolean;
  upstream: string;
  ahead: number;
  behind: number;
  time: number;
  subject: string;
}

export interface BranchGroup {
  name: string;
  tone: BranchTone;
  branches: BranchLeaf[];
}

export interface BranchSection {
  key: string;
  remote: string;
  groups: BranchGroup[];
}

const PROTECTED: Record<string, true> = {
  master: true,
  main: true,
  test: true,
  develop: true,
  development: true,
  stage: true,
  staging: true,
  preprod: true,
  prod: true,
  production: true,
};

const TONES: Record<string, BranchTone> = {
  feat: "feat",
  feature: "feat",
  fix: "fix",
  bugfix: "fix",
  hotfix: "fix",
  protected: "protected",
  others: "other",
};

const RANK: Record<string, number> = {
  feat: 0,
  feature: 0,
  fix: 1,
  bugfix: 2,
  hotfix: 3,
  protected: 4,
  others: 5,
};

/** Splits "origin/feat/login" into the remote and the branch path. */
export function splitRefName(name: string, remote: string): { path: string; remote: string } {
  if (remote && name.startsWith(remote + "/")) {
    return { path: name.slice(remote.length + 1), remote };
  }
  return { path: name, remote: "" };
}

/**
 * Which group a branch path belongs to, the label left after its prefix, and
 * the colour its group gets.
 */
export function describeBranch(path: string): { group: string; label: string; tone: BranchTone } {
  const slash = path.indexOf("/");
  if (slash < 0) {
    const group = PROTECTED[path] === true ? "protected" : "others";
    return { group, label: path, tone: TONES[group]! };
  }
  const head = path.slice(0, slash);
  return {
    group: head,
    label: path.slice(slash + 1),
    tone: TONES[head.toLowerCase()] ?? "other",
  };
}

function toLeaf(ref: RepoRef, current: string, remote: string): BranchLeaf {
  const { path } = splitRefName(ref.name, remote);
  const { group, label, tone } = describeBranch(path);
  return {
    key: ref.fullName,
    name: ref.name,
    label,
    group,
    tone,
    remote,
    current: ref.name === current && remote === "",
    upstream: ref.upstream,
    ahead: ref.ahead,
    behind: ref.behind,
    time: ref.time,
    subject: ref.subject,
  };
}

function groupLeaves(leaves: BranchLeaf[]): BranchGroup[] {
  const byGroup = new Map<string, BranchLeaf[]>();
  for (const leaf of leaves) {
    const list = byGroup.get(leaf.group);
    if (list) list.push(leaf);
    else byGroup.set(leaf.group, [leaf]);
  }
  const groups = [...byGroup].map(([name, branches]) => ({
    name,
    tone: TONES[name.toLowerCase()] ?? "other",
    branches: branches.sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true })),
  }));
  return groups.sort((a, b) => {
    const ra = RANK[a.name.toLowerCase()] ?? 6;
    const rb = RANK[b.name.toLowerCase()] ?? 6;
    if (ra !== rb) return ra - rb;
    return a.name.localeCompare(b.name);
  });
}

/** Local branches as one section, then one section per remote. */
export function buildBranchSections(snapshot: RefsSnapshot | null, current: string): BranchSection[] {
  if (!snapshot) return [];
  const sections: BranchSection[] = [];
  const local = snapshot.local.map((ref) => toLeaf(ref, current, ""));
  if (local.length > 0) sections.push({ key: "local", remote: "", groups: groupLeaves(local) });

  const remotes = new Map<string, RepoRef[]>();
  for (const ref of snapshot.remote) {
    if (ref.symbolic) continue; // origin/HEAD
    const name = ref.remote || ref.name.split("/")[0] || "";
    if (!name || !ref.name.startsWith(name + "/")) continue;
    const list = remotes.get(name);
    if (list) list.push(ref);
    else remotes.set(name, [ref]);
  }
  for (const [name, refs] of [...remotes].sort((a, b) => {
    if (a[0] === "origin") return -1;
    if (b[0] === "origin") return 1;
    return a[0].localeCompare(b[0]);
  })) {
    sections.push({
      key: `remote:${name}`,
      remote: name,
      groups: groupLeaves(refs.map((ref) => toLeaf(ref, current, name))),
    });
  }
  return sections;
}

function matches(leaf: BranchLeaf, query: string): boolean {
  if (!query) return true;
  return leaf.name.toLowerCase().includes(query) || leaf.label.toLowerCase().includes(query);
}

/**
 * Filters the tree for the search box: a query matching a group name keeps
 * every branch under it, so typing "fix" opens the fix group.
 */
export function searchSections(sections: BranchSection[], query: string): BranchSection[] {
  const q = query.trim().toLowerCase();
  if (!q) return sections;
  const out: BranchSection[] = [];
  for (const section of sections) {
    const groups: BranchGroup[] = [];
    for (const group of section.groups) {
      const byGroup = group.name.toLowerCase().includes(q);
      const branches = byGroup ? group.branches : group.branches.filter((leaf) => matches(leaf, q));
      if (branches.length > 0) groups.push({ ...group, branches });
    }
    if (groups.length > 0) out.push({ ...section, groups });
  }
  return out;
}

/** Every leaf keyed by identity, for favourite lookups. */
export function flattenSections(sections: BranchSection[]): BranchLeaf[] {
  return sections.flatMap((section) => section.groups.flatMap((group) => group.branches));
}

/** A tag as the branch page lists it: what it points at, not a branch tree. */
export interface TagLeaf {
  key: string;
  name: string;
  hash: string;
  short: string;
  subject: string;
  time: number;
}

/** Tags newest first; two tags made in the same second fall back to the name
 *  so a rebuild of the list never reorders them. */
export function buildTagLeaves(snapshot: RefsSnapshot | null): TagLeaf[] {
  if (!snapshot) return [];
  return snapshot.tags
    .map((ref) => ({
      key: ref.fullName,
      name: ref.name,
      hash: ref.hash,
      short: ref.short,
      subject: ref.subject,
      time: ref.time,
    }))
    .sort((a, b) => b.time - a.time || a.name.localeCompare(b.name, undefined, { numeric: true }));
}

/** Filters tags by name or the commit they point at. */
export function searchTags(tags: TagLeaf[], query: string): TagLeaf[] {
  const q = query.trim().toLowerCase();
  if (!q) return tags;
  return tags.filter(
    (tag) => tag.name.toLowerCase().includes(q) || tag.subject.toLowerCase().includes(q),
  );
}

/** Groups with more than this many branches start collapsed. */
export const COLLAPSE_THRESHOLD = 8;

/** Whether a group starts folded: big groups do, unless the user said
 *  otherwise with the section or the toolbar. */
export function groupStartsCollapsed(size: number): boolean {
  return size > COLLAPSE_THRESHOLD;
}
