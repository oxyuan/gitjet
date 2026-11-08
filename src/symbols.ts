import type { SymbolHit } from "./mygo";

/** Where the word under the cursor starts and ends. */
export function wordAt(text: string, offset: number): { word: string; from: number; to: number } | null {
  const isWord = (ch: string | undefined) => ch !== undefined && /[\w$]/.test(ch);
  let from = Math.min(Math.max(offset, 0), text.length);
  let to = from;
  while (from > 0 && isWord(text[from - 1])) from--;
  while (to < text.length && isWord(text[to])) to++;
  const word = text.slice(from, to);
  if (word === "" || /^\d+$/.test(word)) return null;
  return { word, from, to };
}

/** Groups search hits into the declarations of a word and its uses.
 *
 *  This is a text-level guess, not name resolution: it exists so that jumping
 *  works in every language without a server. When a language server answers,
 *  its answer wins and this is never consulted. */
export function classifyHits(hits: SymbolHit[], word: string, language: string): { definitions: SymbolHit[]; references: SymbolHit[] } {
  const source = patterns(language).map((pattern) => new RegExp(pattern.replaceAll("%w", escape(word))));
  const definitions: SymbolHit[] = [];
  const references: SymbolHit[] = [];
  for (const hit of hits) {
    if (source.some((pattern) => pattern.test(hit.text))) definitions.push(hit);
    else references.push(hit);
  }
  return { definitions, references };
}

const goPatterns = [
  "^\\s*func\\s+(\\([^)]*\\)\\s*)?%w\\b",
  "^\\s*type\\s+%w\\b",
  "^\\s*(const|var)\\s+%w\\b",
  "^\\s*%w\\s+[\\w\\[\\].*]+\\s*$",
  "^\\s*%w\\s+=",
];

const scriptPatterns = [
  "^\\s*(export\\s+)?(default\\s+)?(async\\s+)?(function|class|interface|type|enum|const|let|var)\\s+%w\\b",
  "^\\s*%w\\s*[:=]\\s*(async\\s*)?(\\(|function)",
  "^\\s*%w\\s*\\([^)]*\\)\\s*[:{]",
  "^\\s*(public|private|protected|static|readonly|async|get|set)\\s+%w\\b",
];

const jvmPatterns = [
  "^\\s*(public|private|protected)?\\s*(static\\s+)?(final\\s+)?(abstract\\s+)?(class|interface|enum|record)\\s+%w\\b",
  "^\\s*(public|private|protected|static|final|synchronized|abstract|override|suspend)\\s+[\\w<>\\[\\],.?\\s]+\\s+%w\\s*\\(",
  "^\\s*(fun|val|var|def)\\s+%w\\b",
];

const pythonPatterns = ["^\\s*(async\\s+)?def\\s+%w\\b", "^\\s*class\\s+%w\\b", "^\\s*%w\\s*="];

const rustPatterns = ["^\\s*(pub\\s+)?(async\\s+)?(fn|struct|enum|trait|const|static|mod|type)\\s+%w\\b", "^\\s*impl\\s+%w\\b"];

const genericPatterns = [
  "^\\s*(pub\\s+)?(export\\s+)?(function|func|def|fn|class|struct|interface|trait|type|enum|module|namespace|macro)\\s+%w\\b",
  "^\\s*%w\\s*(=|\\(|:)",
];

function patterns(language: string): string[] {
  switch (language) {
    case "go":
      return goPatterns;
    case "typescript":
    case "tsx":
    case "javascript":
    case "jsx":
      return scriptPatterns;
    case "java":
    case "kotlin":
      return jvmPatterns;
    case "python":
      return pythonPatterns;
    case "rust":
      return rustPatterns;
    default:
      return genericPatterns;
  }
}

function escape(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** The hit's own line, trimmed for display. */
export function hitText(hit: SymbolHit): string {
  const text = hit.text.trim();
  return text.length > 160 ? text.slice(0, 157) + "..." : text;
}
