/**
 * Rewraps a commit message the way IDEA's "Reformat" does: the subject
 * stays on one line, a blank line separates it from the body, and body
 * paragraphs are wrapped at the given width without touching lines that
 * look like lists, trailers or quoted text.
 */
export function reformatCommitMessage(text: string, width = 72): string {
  const normalized = text.replace(/\r\n/g, "\n").replace(/[ \t]+$/gm, "");
  const lines = normalized.split("\n");
  const subjectIndex = lines.findIndex((line) => line.trim() !== "");
  if (subjectIndex === -1) return "";
  const subject = lines[subjectIndex]!.trim();
  const rest = lines.slice(subjectIndex + 1).join("\n").trim();
  if (rest === "") return subject;

  const paragraphs: string[] = [];
  let current: string[] = [];
  const flush = () => {
    if (current.length > 0) paragraphs.push(current.join(" "));
    current = [];
  };
  for (const raw of rest.split("\n")) {
    const line = raw.trimEnd();
    if (line.trim() === "") {
      flush();
      paragraphs.push("");
      continue;
    }
    if (isVerbatim(line) || current.length === 0) {
      flush();
      current.push(line);
      if (isVerbatim(line)) flush();
      continue;
    }
    current.push(line.trim());
  }
  flush();

  const out: string[] = [subject, ""];
  for (const paragraph of paragraphs) {
    if (paragraph === "") {
      if (out[out.length - 1] !== "") out.push("");
      continue;
    }
    if (isVerbatim(paragraph)) {
      out.push(paragraph);
      continue;
    }
    out.push(...wrap(paragraph, width));
  }
  while (out.length > 1 && out[out.length - 1] === "") out.pop();
  return out.join("\n");
}

/** Lines that keep their own shape: lists, trailers, quotes and patches. */
function isVerbatim(line: string): boolean {
  return (
    /^\s*([-*+]|\d+[.)])\s+/.test(line) ||
    /^[A-Za-z-]+:\s/.test(line) ||
    /^>/.test(line) ||
    /^\s{2,}\S/.test(line) ||
    line.startsWith("```")
  );
}

function wrap(text: string, width: number): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    if (line === "") {
      line = word;
    } else if (line.length + 1 + word.length <= width) {
      line += " " + word;
    } else {
      lines.push(line);
      line = word;
    }
  }
  if (line !== "") lines.push(line);
  return lines;
}

/** The word a completion would replace: the path-like token before the caret. */
export function messageToken(text: string, caret: number): string {
  const before = text.slice(0, caret);
  const match = before.match(/[\w./-]+$/);
  return match ? match[0] : "";
}

/** Changed files whose path contains the typed token, best matches first. */
export function completeFiles(paths: string[], query: string): string[] {
  const needle = query.toLowerCase();
  if (needle === "") return paths.slice(0, 12);
  const scored: { path: string; score: number }[] = [];
  for (const path of paths) {
    const lower = path.toLowerCase();
    const base = lower.slice(lower.lastIndexOf("/") + 1);
    if (base.startsWith(needle)) scored.push({ path, score: 0 });
    else if (base.includes(needle)) scored.push({ path, score: 1 });
    else if (lower.includes(needle)) scored.push({ path, score: 2 });
  }
  scored.sort((a, b) => a.score - b.score || a.path.localeCompare(b.path));
  return scored.map((entry) => entry.path);
}
