/** A match of a symbol in a slice of text, in that slice's offsets. */
export type Occurrence = { from: number; to: number };

const isWordBoundary = (ch: string | undefined): boolean => ch === undefined || !/[\w$]/.test(ch);

/** Every whole-word match of `word` in `text`, bounded by `limit`. The
 *  boundary test is explicit rather than `\b`, which would treat `$` as a
 *  non-word character and split JavaScript identifiers such as `$scope`. */
export function occurrencesIn(text: string, word: string, limit = 1000): Occurrence[] {
  const found: Occurrence[] = [];
  if (!word) return found;
  let index = text.indexOf(word);
  while (index >= 0 && found.length < limit) {
    if (isWordBoundary(text[index - 1]) && isWordBoundary(text[index + word.length])) {
      found.push({ from: index, to: index + word.length });
    }
    index = text.indexOf(word, index + word.length);
  }
  return found;
}
