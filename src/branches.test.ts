import { describe, expect, it } from "bun:test";
import {
  buildBranchSections,
  describeBranch,
  favoriteLeaves,
  flattenSections,
  searchSections,
  splitRefName,
  type BranchLeaf,
} from "./branches";
import type { RefsSnapshot, RepoRef } from "./mygo";

function ref(name: string, extra: Partial<RepoRef> = {}): RepoRef {
  const remote = name.includes("/") && name.startsWith("origin/") ? "origin" : "";
  const full = remote ? `refs/remotes/${name}` : `refs/heads/${name}`;
  return {
    name,
    fullName: full,
    type: remote ? "remote" : "local",
    hash: "0".repeat(40),
    short: "00000000",
    subject: "",
    time: 0,
    upstream: "",
    ahead: 0,
    behind: 0,
    head: false,
    symbolic: false,
    remote,
    ...extra,
  };
}

const snapshot: RefsSnapshot = {
  local: [
    ref("master"),
    ref("feat/50554795/pay_acct_set_zc_fmt"),
    ref("feat/50556141/pay_process_audit_config"),
    ref("fix/yuanliyuan002_issus", { head: true }),
    ref("topic"),
  ],
  remote: [
    ref("origin/HEAD", { symbolic: true }),
    ref("origin/feat/50514615/assembleSettlement"),
    ref("origin/bugfix/20260316"),
    ref("origin/20260805JIAFUtest"),
  ],
  tags: [],
  current: "fix/yuanliyuan002_issus",
  detached: false,
  head: "0".repeat(40),
};

describe("describeBranch", () => {
  it("uses the first segment as the group and the rest as the label", () => {
    expect(describeBranch("feat/50554795/pay_acct_set_zc_fmt")).toEqual({
      group: "feat",
      label: "50554795/pay_acct_set_zc_fmt",
      tone: "feat",
    });
  });

  it("gives both fix and bugfix the orange tone but keeps their own groups", () => {
    expect(describeBranch("bugfix/20260316")).toEqual({ group: "bugfix", label: "20260316", tone: "fix" });
    expect(describeBranch("fix/login")).toEqual({ group: "fix", label: "login", tone: "fix" });
  });

  it("gathers one-segment protected names and unknown names", () => {
    expect(describeBranch("master")).toEqual({ group: "protected", label: "master", tone: "protected" });
    expect(describeBranch("test")).toEqual({ group: "protected", label: "test", tone: "protected" });
    expect(describeBranch("topic")).toEqual({ group: "others", label: "topic", tone: "other" });
    expect(describeBranch("release/1.0")).toEqual({ group: "release", label: "1.0", tone: "other" });
  });
});

describe("splitRefName", () => {
  it("removes the remote from a remote branch and leaves local names alone", () => {
    expect(splitRefName("origin/feat/x", "origin")).toEqual({ path: "feat/x", remote: "origin" });
    expect(splitRefName("origin/feat/x", "")).toEqual({ path: "origin/feat/x", remote: "" });
    expect(splitRefName("feat/x", "")).toEqual({ path: "feat/x", remote: "" });
  });
});

describe("buildBranchSections", () => {
  const sections = buildBranchSections(snapshot, snapshot.current);

  it("orders local groups feat, fix, protected, others", () => {
    const local = sections.find((s) => s.key === "local")!;
    expect(local.groups.map((g) => g.name)).toEqual(["feat", "fix", "protected", "others"]);
  });

  it("keeps the branch remainder as the leaf label", () => {
    const feat = sections[0]!.groups[0]!;
    expect(feat.branches.map((b) => b.label)).toEqual([
      "50554795/pay_acct_set_zc_fmt",
      "50556141/pay_process_audit_config",
    ]);
    expect(feat.branches[0]!.name).toBe("feat/50554795/pay_acct_set_zc_fmt");
  });

  it("marks the checked out branch", () => {
    const leaves = flattenSections(sections);
    expect(leaves.filter((leaf) => leaf.current).map((leaf) => leaf.name)).toEqual(["fix/yuanliyuan002_issus"]);
  });

  it("skips origin/HEAD and strips the remote prefix from remote leaves", () => {
    const remote = sections.find((s) => s.key === "remote:origin")!;
    const leaves = remote.groups.flatMap((g) => g.branches);
    expect(leaves.some((leaf) => leaf.name === "origin/HEAD")).toBe(false);
    expect(leaves.find((leaf) => leaf.group === "feat")!.label).toBe("50514615/assembleSettlement");
    expect(leaves.find((leaf) => leaf.group === "others")!.label).toBe("20260805JIAFUtest");
  });

  it("gives local sections no remote and origin the remote name", () => {
    expect(sections[0]!.remote).toBe("");
    expect(sections[1]!.remote).toBe("origin");
  });
});

describe("searchSections", () => {
  const sections = buildBranchSections(snapshot, snapshot.current);

  it("returns everything for an empty query", () => {
    expect(searchSections(sections, "  ")).toBe(sections);
  });

  it("keeps a whole group when the query names it", () => {
    const found = searchSections(sections, "feat");
    const local = found.find((s) => s.key === "local")!;
    expect(local.groups.map((g) => g.name)).toEqual(["feat"]);
    expect(local.groups[0]!.branches).toHaveLength(2);
    expect(found.map((s) => s.key)).toEqual(["local", "remote:origin"]);
  });

  it("matches the short label and the full branch name", () => {
    const byLabel = searchSections(sections, "issus");
    expect(flattenSections(byLabel).map((leaf) => leaf.name)).toEqual(["fix/yuanliyuan002_issus"]);

    const byFullName = searchSections(sections, "origin/bugfix");
    expect(flattenSections(byFullName).map((leaf) => leaf.name)).toEqual(["origin/bugfix/20260316"]);
  });

  it("drops groups and sections without a match", () => {
    expect(searchSections(sections, "nothing-here")).toEqual([]);
  });
});

describe("favoriteLeaves", () => {
  it("lists only starred branches, in tree order", () => {
    const sections = buildBranchSections(snapshot, snapshot.current);
    const stars = favoriteLeaves(sections, [
      "refs/remotes/origin/feat/50514615/assembleSettlement",
      "refs/heads/master",
    ]);
    expect(stars.map((leaf: BranchLeaf) => leaf.name)).toEqual([
      "master",
      "origin/feat/50514615/assembleSettlement",
    ]);
  });

  it("ignores favourites that no longer exist", () => {
    const sections = buildBranchSections(snapshot, snapshot.current);
    expect(favoriteLeaves(sections, ["refs/heads/deleted"])).toEqual([]);
  });
});
