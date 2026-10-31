/** CodeMirror stores every document with `\n`; a file that came from disk may
 *  use CRLF, and saving must not rewrite every line just because it was
 *  opened. These helpers keep that conversion in one place. */
export type LineEnding = "\n" | "\r\n";

/** The separator a file already uses. Mixed files keep Windows endings. */
export function detectLineEnding(text: string): LineEnding {
  return text.includes("\r\n") ? "\r\n" : "\n";
}

/** The form CodeMirror holds and compares, independent of the file's on-disk
 *  separator. */
export function normalizeText(text: string): string {
  return text.replace(/\r\n?/g, "\n");
}

/** The form to write back, using the file's original separator. */
export function withLineEnding(text: string, ending: LineEnding): string {
  const normalized = normalizeText(text);
  return ending === "\r\n" ? normalized.replace(/\n/g, "\r\n") : normalized;
}
