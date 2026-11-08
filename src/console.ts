/**
 * The programs the console can put in front of a typed line. git is the
 * default because the panel is part of a git client, but a line like
 * "clean install" means `mvn clean install` once mvn is selected.
 */
export const CONSOLE_PROGRAMS = [
  "git",
  "mvn",
  "gradle",
  "java",
  "go",
  "npm",
  "pnpm",
  "bun",
  "node",
  "python",
  "cargo",
  "dotnet",
  "docker",
  "make",
  "kubectl",
  "terraform",
] as const;

const KNOWN = new Set<string>(CONSOLE_PROGRAMS);

/** firstWord is the command a line names, or "" for a blank line. */
export function firstWord(line: string): string {
  const trimmed = line.trim();
  if (trimmed === "") return "";
  const end = trimmed.search(/\s/);
  return end < 0 ? trimmed : trimmed.slice(0, end);
}

/**
 * commandLine turns what was typed into the line that runs.
 *
 * "!..." opts out and runs as typed. A line that already names a known
 * program is left alone, so selecting git does not turn `mvn test` into
 * `git mvn test`. Anything else gets the selected program prepended.
 */
export function commandLine(typed: string, program: string): string {
  const line = typed.trim();
  if (line === "") return "";
  if (line.startsWith("!")) return line.slice(1).trim();
  const programName = program.trim();
  const head = firstWord(line);
  if (programName === "" || head === programName || KNOWN.has(head)) return line;
  return `${programName} ${line}`;
}

/**
 * completionPrefix is the text the back end should complete. It includes the
 * program that will actually run, so "st" completes to `git status` while
 * `mvn cl` completes to `mvn clean`.
 */
export function completionPrefix(typed: string, program: string): string {
  const line = typed.trimStart();
  if (line.startsWith("!")) return line.slice(1).trimStart();
  const programName = program.trim();
  if (line === "") return programName;
  const head = firstWord(line);
  if (programName === "" || head === programName || KNOWN.has(head)) return line;
  return `${programName} ${line}`;
}

/**
 * rememberLine records a line in the selected program's own history: `mvn
 * clean` must not be recalled as `git clean` after switching back.
 */
export function rememberLine(
  historyByProgram: Readonly<Record<string, string[]>>,
  program: string,
  line: string,
): Record<string, string[]> {
  const lines = [line, ...(historyByProgram[program] ?? []).filter((h) => h !== line)].slice(0, 100);
  return { ...historyByProgram, [program]: lines };
}

/** splitCommand separates the program from its arguments for display. */
export function splitCommand(command: string): { head: string; rest: string } {
  const line = command.trim();
  const head = firstWord(line);
  return { head, rest: line.slice(head.length).trimStart() };
}
