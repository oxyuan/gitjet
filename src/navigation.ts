import type { LineText, SymbolHit } from "./mygo";
import { classifyHits } from "./symbols";

/** The declarations a language server can ask for. Each name maps to a
 *  protocol method and the capability that announces it. */
export type TargetKind = "definition" | "implementation" | "typeDefinition";

/** A place navigation can return to: a working-tree file and a 1-based
 *  position in it. */
export type NavigationPoint = {
  path: string;
  line: number;
  column: number;
  /** The revision the editor was showing; absent means the working tree. */
  revision?: string;
};

/** One answer to a definition, implementation or reference request, already
 *  translated out of the protocol's 0-based positions. */
export type NavigationTarget = {
  uri: string;
  path: string;
  line: number;
  column: number;
  endLine: number;
  endColumn: number;
};

/** The page asks the app to act on what a language server answered. */
export type EditorNavigationRequest =
  | {
      kind: "text";
      word: string;
      language: string;
      origin: NavigationPoint;
      action: "jump" | "list";
      anchor?: { x: number; y: number };
    }
  | {
      kind: "targets";
      word: string;
      targetKind: TargetKind;
      targets: NavigationTarget[];
      origin: NavigationPoint;
      anchor?: { x: number; y: number };
    }
  | {
      kind: "usages";
      word: string;
      targets: NavigationTarget[];
      definitions: NavigationTarget[];
      origin: NavigationPoint;
    }
  | { kind: "notice"; message: string };

export type TargetRequest = Extract<EditorNavigationRequest, { kind: "targets" }>;
export type UsageRequest = Extract<EditorNavigationRequest, { kind: "usages" }>;

type Position = { line: number; character: number };
type Range = { start: Position; end: Position };
type Location = { uri: string; range: Range };
type LocationLink = {
  targetUri: string;
  targetRange: Range;
  targetSelectionRange?: Range;
};

const MAX_TARGETS = 2000;

function isPosition(value: unknown): value is Position {
  if (typeof value !== "object" || value === null) return false;
  const pos = value as Record<string, unknown>;
  return typeof pos.line === "number" && typeof pos.character === "number";
}

function isRange(value: unknown): value is Range {
  if (typeof value !== "object" || value === null) return false;
  const range = value as Record<string, unknown>;
  return isPosition(range.start) && isPosition(range.end);
}

function isLocation(value: unknown): value is Location {
  if (typeof value !== "object" || value === null) return false;
  const location = value as Record<string, unknown>;
  return typeof location.uri === "string" && isRange(location.range);
}

function isLocationLink(value: unknown): value is LocationLink {
  if (typeof value !== "object" || value === null) return false;
  const link = value as Record<string, unknown>;
  return (
    typeof link.targetUri === "string" &&
    isRange(link.targetRange) &&
    (link.targetSelectionRange === undefined || isRange(link.targetSelectionRange))
  );
}

/** Turns `textDocument/definition` and friends into places the app can open.
 *  The protocol answers with a Location, a LocationLink, an array of either,
 *  or null; positions are 0-based and the app's are 1-based. */
export function normalizeTargets(result: unknown, fromUri: (uri: string) => string): NavigationTarget[] {
  const items = Array.isArray(result) ? result : [result];
  const targets: NavigationTarget[] = [];
  const seen = new Set<string>();
  for (const item of items) {
    let uri: string;
    let range: Range;
    if (isLocationLink(item)) {
      uri = item.targetUri;
      range = item.targetSelectionRange ?? item.targetRange;
    } else if (isLocation(item)) {
      uri = item.uri;
      range = item.range;
    } else {
      continue;
    }
    if (!/^file:/i.test(uri)) continue;
    const start = range.start;
    const end = range.end;
    const key = [uri, start.line, start.character, end.line, end.character].join(":");
    if (seen.has(key)) continue;
    seen.add(key);
    targets.push({
      uri,
      path: fromUri(uri),
      line: start.line + 1,
      column: start.character + 1,
      endLine: end.line + 1,
      endColumn: end.character + 1,
    });
    if (targets.length >= MAX_TARGETS) break;
  }
  return targets.sort((a, b) =>
    a.path === b.path ? a.line - b.line || a.column - b.column : a.path < b.path ? -1 : 1,
  );
}

/** The point a target stands for, for history and for opening. */
export function targetPoint(target: NavigationTarget): NavigationPoint {
  return { path: target.path, line: target.line, column: target.column };
}

/** The row key a usage list uses to mark the declarations among the uses. */
export function targetKey(target: { path: string; line: number }): string {
  return `${target.path}:${target.line}`;
}

/** The target whose range covers a 1-based position in a document. A server
 *  answers a request made on a declaration's own name with the declaration
 *  itself; IDEA reads that as "the reader is on a declaration" and shows its
 *  usages instead of navigating to the line already on screen. */
export function targetAtPosition(
  targets: NavigationTarget[],
  path: string,
  line: number,
  column: number,
): NavigationTarget | undefined {
  return targets.find((target) => {
    if (target.path !== path) return false;
    if (line < target.line || line > target.endLine) return false;
    if (line === target.line && column < target.column) return false;
    // Protocol ranges are end-exclusive; `endColumn` is the first column
    // past the name, so a caret there belongs to the next symbol.
    if (line === target.endLine && column >= target.endColumn) return false;
    return true;
  });
}

/** Whether a declaration request landed on a declaration itself, which is
 *  when IDEA's Go to Declaration or Usages shows the usages instead. HEAD and
 *  index panes are snapshots the server's positions do not describe; the
 *  working tree and an external file are real documents. */
export function declarationUnderCaret(
  kind: TargetKind,
  revision: string,
  targets: NavigationTarget[],
  path: string,
  line: number,
  column: number,
): boolean {
  if (kind !== "definition" || (revision !== "" && revision !== "EXTERNAL")) return false;
  return targets.some((target) => targetAtPosition([target], path, line, column) !== undefined);
}

/** The references that are not the declarations themselves. `references`
 *  with `includeDeclaration` on may repeat the declaration, and IDEA's usage
 *  count and single-usage shortcut cover references only. */
export function usageTargets(
  definitions: NavigationTarget[],
  references: NavigationTarget[],
): NavigationTarget[] {
  return references.filter(
    (reference) =>
      !definitions.some(
        (declaration) =>
          declaration.uri === reference.uri &&
          declaration.line === reference.line &&
          declaration.column === reference.column &&
          declaration.endLine === reference.endLine &&
          declaration.endColumn === reference.endColumn,
      ),
  );
}

/** What a text search should do with a click, decided the way a language
 *  server's answer is read: on a declaration the reader wants its usages,
 *  and on any other mention the one declaration it names. A snapshot
 *  revision or an external file keeps the plain list, because the search
 *  describes the working tree and its line numbers need not match. */
export type TextJump =
  | { kind: "list" }
  | { kind: "declaration" }
  | { kind: "target"; hit: SymbolHit }
  | { kind: "choose"; hits: SymbolHit[] };

export function planTextJump(
  word: string,
  language: string,
  origin: NavigationPoint,
  hits: SymbolHit[],
): TextJump {
  if ((origin.revision ?? "") !== "") return { kind: "list" };
  const { definitions } = classifyHits(hits, word, language);
  if (definitions.length === 0) return { kind: "list" };
  if (definitions.some((hit) => hit.path === origin.path && hit.line === origin.line)) {
    return { kind: "declaration" };
  }
  if (definitions.length === 1) return { kind: "target", hit: definitions[0]! };
  return { kind: "choose", hits: definitions };
}

/** Declarations first, then the references that are not already one. A
 *  language server may or may not include the declaration among the
 *  references, depending on how it reads `includeDeclaration`. */
export function mergeNavigationTargets(
  definitions: NavigationTarget[],
  references: NavigationTarget[],
): NavigationTarget[] {
  const seen = new Set<string>();
  const merged: NavigationTarget[] = [];
  for (const target of [...definitions, ...references]) {
    const key = [target.uri, target.line, target.column, target.endLine, target.endColumn].join(":");
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(target);
  }
  return merged.sort((a, b) =>
    a.path === b.path ? a.line - b.line || a.column - b.column : a.path < b.path ? -1 : 1,
  );
}

/** Lays the working-tree text the backend read onto the targets, so a usage
 *  row can show its line. A line that could not be read keeps empty text. */
export function targetsToHits(targets: NavigationTarget[], texts: LineText[]): SymbolHit[] {
  const lines = new Map(texts.map((line) => [`${line.path}:${line.line}`, line.text]));
  return targets.map((target) => ({
    path: target.path,
    line: target.line,
    column: target.column,
    text: lines.get(`${target.path}:${target.line}`) ?? "",
  }));
}

/** A navigation history, newest at `index`; entries after it are the forward
 *  branch and are dropped by the next new jump, as a browser does. */
export type NavigationHistory = {
  entries: NavigationPoint[];
  index: number;
};

export const MAX_HISTORY = 100;

export function emptyHistory(): NavigationHistory {
  return { entries: [], index: -1 };
}

function samePoint(a: NavigationPoint, b: NavigationPoint): boolean {
  return (
    a.path === b.path &&
    a.line === b.line &&
    a.column === b.column &&
    (a.revision ?? "") === (b.revision ?? "")
  );
}

/** Records a place the reader was at. Repeating the current point does
 *  nothing, so two jumps from one line do not fill the history. */
export function recordPoint(history: NavigationHistory, point: NavigationPoint): NavigationHistory {
  const current = history.entries[history.index];
  if (current && samePoint(current, point)) return history;
  let entries = history.entries.slice(0, history.index + 1);
  entries.push(point);
  if (entries.length > MAX_HISTORY) entries = entries.slice(entries.length - MAX_HISTORY);
  return { entries, index: entries.length - 1 };
}

/** Moves one step back (-1) or forward (1), or returns null at an end. */
export function stepHistory(history: NavigationHistory, delta: number): NavigationHistory | null {
  const index = history.index + delta;
  if (index < 0 || index >= history.entries.length) return null;
  return { entries: history.entries, index };
}

export function currentPoint(history: NavigationHistory): NavigationPoint | null {
  return history.entries[history.index] ?? null;
}

export function canStep(history: NavigationHistory, delta: number): boolean {
  const index = history.index + delta;
  return index >= 0 && index < history.entries.length;
}
