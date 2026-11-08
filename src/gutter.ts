import type { DiffOptions } from "./mygo";

/** One diff, two users: the change bars the source editor draws and the
 *  patch a bar rolls back. They have to describe the same hunks, so the
 *  options live here — the viewer's "whole file" setting would collapse
 *  every change of a file into hunk 0 and roll the file back instead. */
export const GUTTER_CONTEXT = 3;

export function gutterDiffOptions(path: string): DiffOptions {
  return {
    path,
    target: "worktree",
    revision: "",
    from: "",
    context: GUTTER_CONTEXT,
    ignoreWhitespace: false,
    ignoreWhitespaceEol: false,
    noText: true,
  };
}
