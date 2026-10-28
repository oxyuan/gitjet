/** The ways to name one file, the way an IDE's "Copy Path/Reference" dialog
 *  offers them: absolute, relative to the repository, the file name alone,
 *  each optionally with a line, plus the absolute path quoted for a shell.
 *
 *  Git hands out `/`-separated paths on every platform, and the repository
 *  root is the one string that says how this machine spells a path, so the
 *  separator and the line join are decided from it. */

export type PathChoiceKey =
  | "absolute"
  | "absoluteLine"
  | "relative"
  | "relativeLine"
  | "name"
  | "nameLine"
  | "quoted";

export interface PathChoice {
  key: PathChoiceKey;
  value: string;
}

/** True for `C:\…` and `C:/…` roots. */
export function isWindowsRoot(root: string): boolean {
  return /^[A-Za-z]:[\\/]/.test(root) || root.includes("\\");
}

/** `root` + `path`, with the separator this machine uses. */
export function joinRoot(root: string, path: string): string {
  const sep = isWindowsRoot(root) ? "\\" : "/";
  const base = root.replace(/[\\/]+$/, "").replace(/[\\/]/g, sep);
  return `${base}${sep}${path.replace(/^\/+/, "").split("/").join(sep)}`;
}

/** Last segment of a git path (`src/diff.ts` -> `diff.ts`). */
export function baseName(path: string): string {
  const cut = path.lastIndexOf("/");
  return cut === -1 ? path : path.slice(cut + 1);
}

/** A path a shell takes as one word: single quotes, with embedded quotes
 *  closed and reopened the POSIX way. */
export function quoteForShell(path: string): string {
  if (path !== "" && !/[\s'"\\$`!*?()[\]{}&|;<>#~]/.test(path)) return path;
  return `'${path.replace(/'/g, `'\\''`)}'`;
}

/**
 * The choices, in the order an IDE lists them: the absolute path first
 * because it is what other programs want, then the repository-relative one,
 * then the bare name. Line variants follow their base entry and only exist
 * when a line is known.
 */
export function pathChoices(input: { path: string; root: string; line?: number }): PathChoice[] {
  const absolute = input.root ? joinRoot(input.root, input.path) : input.path;
  const name = baseName(input.path);
  const line = input.line && input.line > 0 ? input.line : 0;
  const out: PathChoice[] = [
    { key: "absolute", value: absolute },
    { key: "relative", value: input.path },
  ];
  if (line) {
    out.splice(1, 0, { key: "absoluteLine", value: `${absolute}:${line}` });
    out.push({ key: "relativeLine", value: `${input.path}:${line}` });
  }
  out.push({ key: "name", value: name });
  if (line) out.push({ key: "nameLine", value: `${name}:${line}` });
  out.push({ key: "quoted", value: quoteForShell(absolute) });
  return out;
}
