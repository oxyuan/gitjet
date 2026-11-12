import { useEffect, useRef, useState } from "react";
import { Git, type BlameLine, type DiffOptions, type SourceFile } from "./mygo";
import { SourceEditor as Editor } from "./editor";
import { annotateDate, changeRanges, type ChangeRange } from "./annotate";
import { gutterDiffOptions } from "./gutter";
import { connectLSP, lspServes, registerView, unregisterView, toUri } from "./lsp";
import type { EditorNavigationRequest, NavigationPoint } from "./navigation";
import { isAbsolutePath, joinRoot } from "./paths";
import { blameMenuItems } from "./blameMenu";
import { ContextMenu, useStoredState, type ContextItem } from "./ui";
import { useLang, useT } from "./i18n";
import { withLineEnding, type LineEnding } from "./editorText";

const T = {
  en: {
    lineHistory: "Show history of this line",
    commitFileDiff: "Show all changes of this commit in this file",
    copyHash: "Copy commit hash",
    uncommitted: "Uncommitted changes",
    annotateWithBlame: "Annotate with Git Blame",
    ignoreWhitespaceBlame: "Ignore whitespace changes",
    keepWhitespaceBlame: "Attribute whitespace changes",
    closeAnnotations: "Close Annotations",
    annotateLocal: "local",
    goToDeclaration: "Go to Declaration or Usages",
    goToImplementation: "Go to Implementation(s)",
    goToTypeDeclaration: "Go to Type Declaration",
    findUsages: "Find Usages",
  },
  zh: {
    lineHistory: "查看该行的历史",
    commitFileDiff: "查看该提交在此文件中的全部差异",
    copyHash: "复制提交哈希",
    uncommitted: "未提交的更改",
    annotateWithBlame: "使用 Git Blame 标注",
    ignoreWhitespaceBlame: "忽略空白改动",
    keepWhitespaceBlame: "归属空白改动",
    closeAnnotations: "关闭 Blame",
    annotateLocal: "本地",
    goToDeclaration: "跳到声明或引用",
    goToImplementation: "跳到实现",
    goToTypeDeclaration: "跳到类型声明",
    findUsages: "查找引用",
  },
} as const;


/** The text itself, in a real editor: highlighting, a change gutter, the
 *  blame of the current line, and jumps. The header and toolbar stay in
 *  SourceView, which owns the document's chrome. */
export function SourceEditor({
  file,
  root,
  line,
  column,
  reveal,
  wrap,
  editable = false,
  lineEnding = "\n",
  draft,
  labels,
  blameFormat,
  onRollbackHunk,
  onRollbackLine,
  onNavigate,
  onNavigated,
  onHistory,
  onCaret,
  onLineHistory,
  onCommitDiff,
  onCopy,
  onDirtyChange,
  onSave,
  onDraftChange,
  saveRef,
  navRef,
}: {
  file: SourceFile;
  /** Absolute path of the repository, for the file's URI and external paths. */
  root: string;
  line?: number;
  /** 1-based column beside `line`, for a jump that remembers the caret. */
  column?: number;
  /** Changes on every jump, so a repeated jump to the same line re-reveals. */
  reveal?: number;
  wrap: boolean;
  /** Working-tree files take edits; the index and commits do not. */
  editable?: boolean;
  /** The separator the file used on disk, restored when saving. */
  lineEnding?: LineEnding;
  /** Text restored after switching away with unsaved edits. */
  draft?: string;
  labels?: { addedHere: string; deletedHere: string; modifiedHere: string };
  blameFormat?: (line: BlameLine) => string;
  onRollbackHunk?: (hunk: number) => void;
  onRollbackLine?: (line: number) => void;
  onNavigate?: (request: EditorNavigationRequest) => void;
  onNavigated?: (from: NavigationPoint, to: NavigationPoint) => void;
  onHistory?: (delta: -1 | 1) => void;
  onCaret?: (line: number) => void;
  /** Show the history of one line of this file. */
  onLineHistory?: (line: number) => void;
  /** Show the diff the blame commit made to this file. */
  onCommitDiff?: (hash: string) => void;
  onCopy?: (text: string) => void;
  onDirtyChange?: (dirty: boolean) => void;
  /** Writes the text to disk; resolves true when it succeeded. `quiet` is
   *  an automatic save, which must not toast. */
  onSave?: (text: string, quiet?: boolean) => Promise<boolean>;
  /** Preserves a draft while the tab is not the active one. */
  onDraftChange?: (text: string) => void;
  /** Lets the header's Save button invoke the same write as Ctrl/Cmd-S. */
  saveRef?: { current: (() => Promise<boolean>) | null };
  /** Lets the header's change arrows step through the gutter's ranges. */
  navRef?: { current: ((delta: number) => void) | null };
}) {
  const t = useT(T);
  const lang = useLang();
  const host = useRef<HTMLDivElement | null>(null);
  const editor = useRef<Editor | null>(null);
  const actions = useRef({
    onRollbackHunk,
    onRollbackLine,
    onNavigate,
    onNavigated,
    onHistory,
    onCaret,
    onLineHistory,
    onCommitDiff,
    onCopy,
    editable,
    lineEnding,
    onDirtyChange,
    onSave,
    onDraftChange,
  });
  actions.current = {
    onRollbackHunk,
    onRollbackLine,
    onNavigate,
    onNavigated,
    onHistory,
    onCaret,
    onLineHistory,
    onCommitDiff,
    onCopy,
    editable,
    lineEnding,
    onDirtyChange,
    onSave,
    onDraftChange,
  };
  const saving = useRef(false);
  const caretLine = useRef(1);
  // IDEA writes an edited file by itself: after a pause in typing and when
  // the window loses focus, so a repository never holds a buffer the disk
  // does not have. The write is silent; the tab's dot is the feedback.
  const AUTO_SAVE_DELAY = 1000;
  const autoTimer = useRef<number | null>(null);
  const save = async (quiet = false): Promise<boolean> => {
    const current = editor.current;
    const write = actions.current.onSave;
    if (!current || !actions.current.editable || !write || saving.current) return false;
    saving.current = true;
    try {
      const doc = current.getDoc();
      const ok = await write(withLineEnding(doc, actions.current.lineEnding), quiet);
      if (ok) {
        current.markSaved(doc);
        // Typing during the write leaves newer text behind; that buffer is
        // still dirty and deserves its own save.
        if (current.isDirty()) scheduleAutoSave();
        else if (!quiet) current.view.focus();
      }
      return ok;
    } catch {
      return false;
    } finally {
      saving.current = false;
    }
  };
  const saveLatest = useRef(save);
  saveLatest.current = save;
  const cancelAutoSave = () => {
    if (autoTimer.current === null) return;
    window.clearTimeout(autoTimer.current);
    autoTimer.current = null;
  };
  const scheduleAutoSave = () => {
    if (!actions.current.editable || !actions.current.onSave) return;
    cancelAutoSave();
    autoTimer.current = window.setTimeout(() => {
      autoTimer.current = null;
      if (editor.current?.isDirty()) void saveLatest.current(true);
    }, AUTO_SAVE_DELAY);
  };

  useEffect(() => {
    if (!saveRef) return;
    saveRef.current = () => saveLatest.current();
    return () => {
      saveRef.current = null;
    };
  }, [saveRef]);
  const [changes, setChanges] = useState<ChangeRange[]>([]);
  // The header's prev/next change buttons reach the ranges this pane drew.
  const changeNav = useRef<(delta: number) => void>(() => {});
  changeNav.current = (delta: number) => {
    if (changes.length === 0) return;
    const sorted = [...changes].sort((a, b) => a.start - b.start);
    const here = caretLine.current;
    const target =
      delta > 0
        ? sorted.find((range) => range.start > here) ?? sorted[0]
        : [...sorted].reverse().find((range) => range.start < here) ?? sorted[sorted.length - 1];
    if (target) editor.current?.revealLine(target.start);
  };
  useEffect(() => {
    if (!navRef) return;
    navRef.current = (delta: number) => changeNav.current(delta);
    return () => {
      navRef.current = null;
    };
  }, [navRef]);
  const [blame, setBlame] = useState<BlameLine[] | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; line: number } | null>(null);
  // The code area's own menu: IDEA offers the navigation commands here, not
  // only as keys and modified clicks.
  const [symbolMenu, setSymbolMenu] = useState<{ x: number; y: number; pos: number } | null>(null);
  const [annotate, setAnnotate] = useStoredState<boolean>("gitjet.annotate", false);
  const [ignoreWs, setIgnoreWs] = useStoredState<boolean>("gitjet.blameIgnoreWhitespace", false);
  // Change bars belong to the working tree; blame belongs to whichever
  // version of the file this pane shows. A library file outside the
  // repository has neither.
  const workingTree = file.revision === "" && !file.external;
  const absolutePath = isAbsolutePath(file.path) ? file.path : joinRoot(root, file.path);

  // One editor per mounted document; the document itself is swapped in place
  // so scroll position and the gutter survive a reload.
  useEffect(() => {
    if (!host.current) return;
    const created = new Editor(host.current, {
      doc: draft ?? file.text,
      baseline: file.text,
      language: file.language,
      wrap,
      editable,
      lang,
      labels,
      blameFormat,
      onDirtyChange: (dirty) => {
        actions.current.onDirtyChange?.(dirty);
        if (dirty) scheduleAutoSave();
        else cancelAutoSave();
      },
      onSaveRequest: editable ? () => void saveLatest.current() : undefined,
      onRollbackHunk: (hunk) => actions.current.onRollbackHunk?.(hunk),
      onRollbackLine: (line) => actions.current.onRollbackLine?.(line),
      path: file.path,
      revision: file.revision,
      onNavigate: (request) => actions.current.onNavigate?.(request),
      onNavigated: (from, to) => actions.current.onNavigated?.(from, to),
      onHistory: (delta) => actions.current.onHistory?.(delta),
      onCaret: (n) => {
        caretLine.current = n;
        actions.current.onCaret?.(n);
      },
      onGutterContext: (n, x, y) => setMenu({ x, y, line: n }),
      annotate,
      annotateFormat: (blame) =>
        blame.uncommitted
          ? { date: "", author: t("annotateLocal") }
          : { date: annotateDate(blame.time), author: blame.author },
    });
    editor.current = created;
    // Switching to another application is IDEA's other save trigger: the
    // file on disk must already hold what the reader typed.
    const flush = () => {
      if (created.isDirty()) void saveLatest.current(true);
    };
    window.addEventListener("blur", flush);
    // The language server speaks absolute file URIs; registering a
    // repository-relative path made every server answer look like a
    // different file, so a jump opened a tab that could not load.
    const uri = toUri(absolutePath);
    registerView(uri, created.view, file.revision);
    return () => {
      window.removeEventListener("blur", flush);
      cancelAutoSave();
      if (actions.current.editable && created.isDirty()) {
        actions.current.onDraftChange?.(created.getDoc());
      }
      unregisterView(uri, created.view);
      created.destroy();
      editor.current = null;
    };
    // The editor exists for as long as the pane does; documents arrive below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    editor.current?.setDoc(file.text, file.language);
  }, [file.text, file.language]);

  useEffect(() => {
    editor.current?.setWrap(wrap);
  }, [wrap]);

  useEffect(() => {
    if (!line) return;
    // The pane has to have its height before the editor can scroll to a line,
    // and on the first frame after mount it does not.
    const frame = requestAnimationFrame(() => editor.current?.revealLine(line, column ?? 1));
    return () => cancelAnimationFrame(frame);
  }, [line, column, reveal, file.text]);

  // Change bars describe uncommitted work; blame answers for the revision
  // this pane shows, so both the working tree and an old commit have one.
  useEffect(() => {
    let cancelled = false;
    if (file.binary || !file.exists || file.external) {
      setChanges([]);
      setBlame(null);
      return;
    }
    if (workingTree) {
      const opts: DiffOptions = gutterDiffOptions(file.path);
      Git.diff(opts)
        .then((diff) => {
          if (!cancelled) setChanges(changeRanges(diff));
        })
        .catch(() => {});
    } else {
      setChanges([]);
    }
    Git.blame(file.path, file.revision, { ignoreWhitespace: ignoreWs, ignoreRevsFile: "" })
      .then((result) => {
        if (!cancelled) setBlame(result.lines);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [workingTree, file.binary, file.exists, file.path, file.revision, file.text, ignoreWs]);

  useEffect(() => {
    editor.current?.setChanges(changes);
  }, [changes]);

  useEffect(() => {
    editor.current?.setBlame(blame);
  }, [blame]);

  useEffect(() => {
    editor.current?.setAnnotate(annotate);
  }, [annotate]);

  // A language server, when the repository has one installed.
  useEffect(() => {
    let cancelled = false;
    void connectLSP().then((client) => {
      // The probe decides which language the server speaks, so the file is
      // checked only once a session exists. A historical revision must not
      // register its text under the working-tree URI: the server would then
      // answer about a document that is not on disk.
      if (cancelled || !client || !editor.current || (!file.external && file.revision !== "") || !lspServes(file.language)) return;
      const languageId = file.language === "tsx" ? "typescriptreact" : file.language === "jsx" ? "javascriptreact" : file.language;
      editor.current.withExtension(client.plugin(toUri(absolutePath), languageId));
    });
    return () => {
      cancelled = true;
    };
    // The plugin is attached once per mount; a different file in the same
    // pane is a different document, and the old plugin is harmless.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The menu is about one line: its blame is the "Git information", and the
  // commit or its history is where the diff lives.
  const menuItems: ContextItem[] = menu
    ? blameMenuItems({
        blame: blame?.find((l) => l.line === menu.line),
        line: menu.line,
        labels: {
          uncommitted: t("uncommitted"),
          lineHistory: t("lineHistory"),
          commitFileDiff: t("commitFileDiff"),
          copyHash: t("copyHash"),
          annotate: t("annotateWithBlame"),
          closeAnnotations: t("closeAnnotations"),
          ignoreWhitespace: t("ignoreWhitespaceBlame"),
          keepWhitespace: t("keepWhitespaceBlame"),
        },
        annotate,
        onToggleAnnotate: () => setAnnotate(!annotate),
        ignoreWhitespace: ignoreWs,
        onToggleIgnoreWhitespace: () => setIgnoreWs(!ignoreWs),
        onLineHistory,
        onCommitDiff,
        onCopy,
      })
    : [];

  const symbolMenuItems: ContextItem[] = [];
  if (symbolMenu) {
    const pos = symbolMenu.pos;
    symbolMenuItems.push(
      {
        label: t("goToDeclaration"),
        shortcut: "⌘/Ctrl+B",
        onClick: () => editor.current?.navigateAt(pos, "definition"),
      },
      {
        label: t("goToImplementation"),
        shortcut: "⌘/Ctrl+Alt+B",
        onClick: () => editor.current?.navigateAt(pos, "implementation"),
      },
      {
        label: t("goToTypeDeclaration"),
        shortcut: "Ctrl+Shift+B",
        onClick: () => editor.current?.navigateAt(pos, "typeDefinition"),
      },
      { separator: true },
      {
        label: t("findUsages"),
        shortcut: "⌥/Alt+F7",
        onClick: () => editor.current?.navigateAt(pos, "usages"),
      },
    );
  }

  return (
    <div
      className="source-editor"
      ref={host}
      onContextMenu={(event) => {
        event.stopPropagation();
        // The gutter owns its own menu (blame, history, copy hash), and the
        // find bar keeps the text field's menu.
        if (event.target instanceof Element && event.target.closest(".cm-gutters, .cm-panels")) return;
        const pos = editor.current?.posAtClient(event.clientX, event.clientY);
        if (pos == null) return;
        event.preventDefault();
        editor.current?.placeCaret(pos);
        setSymbolMenu({ x: event.clientX, y: event.clientY, pos });
      }}
    >
      {menu && <ContextMenu x={menu.x} y={menu.y} items={menuItems} onClose={() => setMenu(null)} />}
      {symbolMenu && (
        <ContextMenu
          x={symbolMenu.x}
          y={symbolMenu.y}
          items={symbolMenuItems}
          onClose={() => setSymbolMenu(null)}
        />
      )}
    </div>
  );
}
