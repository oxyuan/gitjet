import { Git } from "./mygo";
import { detectLineEnding, withLineEnding } from "./editorText";

/** mergeConflictInMemory asks the repository for the three-way merge of one
 *  conflicted path and writes it back: staged when nothing conflicts, saved
 *  with markers when something does. The merge itself is computed from the
 *  index stages, so it never depends on what the working file happens to
 *  hold. */
export async function mergeConflictInMemory(
  path: string,
  ours: string,
  theirs: string,
  /** Text whose line endings the result should keep. */
  endingSource: string,
): Promise<{ conflicts: number; clean: boolean }> {
  const preview = await Git.mergePreview({ path, ours, base: "", theirs });
  const content = withLineEnding(preview.content, detectLineEnding(endingSource));
  const clean = preview.conflicts === 0;
  await Git.saveResolution(path, content, clean);
  return { conflicts: preview.conflicts, clean };
}
