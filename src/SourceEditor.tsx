import { useEffect, useRef, useState } from "react";
import { Git, type BlameLine, type DiffOptions, type SourceFile } from "./mygo";
import { SourceEditor as Editor } from "./editor";
import { annotateDate, changeRanges, type ChangeRange } from "./annotate";
import { connectLSP, lspServes, registerView, unregisterView, toUri } from "./lsp";
import { blameMenuItems } from "./blameMenu";
import { ContextMenu, useStoredState, type ContextItem } from "./ui";
import { useT } from "./i18n";
import { withLineEnding, type LineEnding } from "./editorText";

const T = {
  en: {
    lineHistory: "Show history of this line",
    commitFileDiff: "Show all changes of this commit in this file",
    copyHash: "Copy commit hash",
    uncommitted: "Uncommitted changes",
    annotateWithBlame: "Annotate with Git Blame",
    closeAnnotations: "Close Annotations",
    annotateLocal: "local",
  },
  zh: {
    lineHistory: "查看该行的历史",
    commitFileDiff: "查看该提交在此文件中的全部差异",
    copyHash: "复制提交哈希",
    uncommitted: "未提交的更改",
    annotateWithBlame: "使用 Git Blame 标注",
    closeAnnotations: "关闭 Blame",
    annotateLocal: "本地",
  },
} as const;


/** The text itself, in a real editor: highlighting, a change gutter, the
 *  blame of the current line, and jumps. The header and toolbar stay in
 *  SourceView, which owns the document's chrome. */
export function SourceEditor({
  file,
  line,
  wrap,
  editable = false,
  lineEnding = "\n",
  draft,
  labels,
  blameFormat,
  onRollbackHunk,
  onSymbol,
  onJump,
  onReferences,
  onCaret,
  onLineHistory,
  onCommitDiff,
  onCopy,
  onDirtyChange,
  onSave,
  onDraftChange,
  saveRef,
}: {
  file: SourceFile;
  line?: number;
  wrap: boolean;
  /** Working-tree files take edits; the index and commits do not. */
  editable?: boolean;
  /** The separator the file used on disk, restored when saving. */
  lineEnding?: LineEnding;
  /** Text restored after switching away with unsaved edits. */
  draft?: string;
  labels?: { addedHere: string; deletedHere: string };
  blameFormat?: (line: BlameLine) => string;
  onRollbackHunk?: (hunk: number) => void;
  onSymbol?: (word: string) => void;
  onJump?: (word: string) => void;
  onReferences?: (word: string) => void;
  onCaret?: (line: number) => void;
  /** Show the history of one line of this file. */
  onLineHistory?: (line: number) => void;
  /** Show the diff the blame commit made to this file. */
  onCommitDiff?: (hash: string) => void;
  onCopy?: (text: string) => void;
  onDirtyChange?: (dirty: boolean) => void;
  /** Writes the text to disk; resolves true when it succeeded. */
  onSave?: (text: string) => Promise<boolean>;
  /** Preserves a draft while the tab is not the active one. */
  onDraftChange?: (text: string) => void;
  /** Lets the header's Save button invoke the same write as Ctrl/Cmd-S. */
  saveRef?: { current: (() => Promise<boolean>) | null };
}) {
  const t = useT(T);
  const host = useRef<HTMLDivElement | null>(null);
  const editor = useRef<Editor | null>(null);
  const actions = useRef({
    onRollbackHunk,
    onSymbol,
    onJump,
    onReferences,
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
    onSymbol,
    onJump,
    onReferences,
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
  const save = async (): Promise<boolean> => {
    const current = editor.current;
    const write = actions.current.onSave;
    if (!current || !actions.current.editable || !write || saving.current) return false;
    saving.current = true;
    try {
      const doc = current.getDoc();
      const ok = await write(withLineEnding(doc, actions.current.lineEnding));
      if (ok) {
        current.markSaved(doc);
        current.view.focus();
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

  useEffect(() => {
    if (!saveRef) return;
    saveRef.current = () => saveLatest.current();
    return () => {
      saveRef.current = null;
    };
  }, [saveRef]);
  const [changes, setChanges] = useState<ChangeRange[]>([]);
  const [blame, setBlame] = useState<BlameLine[] | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; line: number } | null>(null);
  const [annotate, setAnnotate] = useStoredState<boolean>("gitjet.annotate", false);
  // Change bars belong to the working tree; blame belongs to whichever
  // version of the file this pane shows.
  const workingTree = file.revision === "";

  // One editor per mounted document; the document itself is swapped in place
  // so scroll position and the gutter survive a reload.
  useEffect(() => {
    if (!host.current) return;
    const created = new Editor(host.current, {
      doc: draft ?? file.text,
      language: file.language,
      wrap,
      editable,
      labels,
      blameFormat,
      onDirtyChange: (dirty) => actions.current.onDirtyChange?.(dirty),
      onSaveRequest: editable ? () => void saveLatest.current() : undefined,
      onRollbackHunk: (hunk) => actions.current.onRollbackHunk?.(hunk),
      onSymbol: (word) => (actions.current.onSymbol ?? actions.current.onJump)?.(word),
      onJump: (word) => actions.current.onJump?.(word),
      onReferences: (word) => actions.current.onReferences?.(word),
      onCaret: (n) => actions.current.onCaret?.(n),
      onGutterContext: (n, x, y) => setMenu({ x, y, line: n }),
      annotate,
      annotateFormat: (blame) =>
        blame.uncommitted
          ? { date: "", author: t("annotateLocal") }
          : { date: annotateDate(blame.time), author: blame.author },
    });
    editor.current = created;
    const uri = toUri(file.path);
    registerView(uri, created.view);
    return () => {
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
    const frame = requestAnimationFrame(() => editor.current?.revealLine(line));
    return () => cancelAnimationFrame(frame);
  }, [line, file.text]);

  // Change bars describe uncommitted work; blame answers for the revision
  // this pane shows, so both the working tree and an old commit have one.
  useEffect(() => {
    let cancelled = false;
    if (file.binary || !file.exists) {
      setChanges([]);
      setBlame(null);
      return;
    }
    if (workingTree) {
      const opts: DiffOptions = {
        path: file.path,
        target: "worktree",
        revision: "",
        from: "",
        context: 3,
        ignoreWhitespace: false,
        ignoreWhitespaceEol: false,
        noText: true,
      };
      Git.diff(opts)
        .then((diff) => {
          if (!cancelled) setChanges(changeRanges(diff));
        })
        .catch(() => {});
    } else {
      setChanges([]);
    }
    Git.blame(file.path, file.revision)
      .then((result) => {
        if (!cancelled) setBlame(result.lines);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [workingTree, file.binary, file.exists, file.path, file.revision, file.text]);

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
      // checked only once a session exists.
      if (cancelled || !client || !editor.current || !lspServes(file.language)) return;
      const languageId = file.language === "tsx" ? "typescriptreact" : file.language === "jsx" ? "javascriptreact" : file.language;
      editor.current.withExtension(client.plugin(toUri(file.path), languageId));
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
        },
        annotate,
        onToggleAnnotate: () => setAnnotate(!annotate),
        onLineHistory,
        onCommitDiff,
        onCopy,
      })
    : [];

  return (
    <div className="source-editor" ref={host} onContextMenu={(event) => event.stopPropagation()}>
      {menu && <ContextMenu x={menu.x} y={menu.y} items={menuItems} onClose={() => setMenu(null)} />}
    </div>
  );
}
