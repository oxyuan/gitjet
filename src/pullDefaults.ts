/**
 * The branches a pull dialog offers for one remote: the remote's own branch
 * names, without the "origin/" prefix, sorted the way the menu shows them.
 */
export function pullBranchNames(remoteBranches: string[], remote: string): string[] {
  const prefix = remote + "/";
  return remoteBranches
    .filter((name) => name.startsWith(prefix))
    .map((name) => name.slice(prefix.length))
    .sort((a, b) => a.localeCompare(b));
}

/**
 * The branch a pull starts on, IDEA's GitPullDialog: the tracked branch of the
 * checked-out one, else the remote branch with the same name, else the first
 * branch the remote has. An empty answer means "let git use the upstream".
 */
export function pullBranchDefault({
  current,
  upstream,
  remote,
  names,
}: {
  current: string;
  upstream: string;
  remote: string;
  names: string[];
}): string {
  const prefix = remote + "/";
  const tracked = upstream.startsWith(prefix) ? upstream.slice(prefix.length) : "";
  if (tracked !== "") return tracked;
  if (names.includes(current)) return current;
  return names[0] ?? "";
}
