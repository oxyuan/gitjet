/** Protected-branch patterns: a bare name, or a `*` wildcard. */
export function isProtectedBranch(branch: string, patterns: string[]): boolean {
  if (branch === "") return false;
  return patterns.some((pattern) => {
    const trimmed = pattern.trim();
    if (trimmed === "") return false;
    if (!trimmed.includes("*")) return trimmed === branch;
    const regex = new RegExp("^" + trimmed.split("*").map(escapeRegExp).join(".*") + "$");
    return regex.test(branch);
  });
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
