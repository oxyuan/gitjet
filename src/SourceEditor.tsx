import { useEffect, useRef, useState } from "react";
import { Git, type BlameLine, type DiffOptions, type SourceFile } from "./mygo";
import { SourceEditor as Editor } from "./editor";
import { annotateDate, changeRanges, type ChangeRange } from "./annotate";
import { connectLSP, lspServes, registerView, unregisterView, toUri } from "./lsp";
import { ContextMenu, formatWhen, useStoredState, type ContextItem } from "./ui";
import { useT } from "./i18n";

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
}: {
  file: SourceFile;
  line?: number;
  wrap: boolean;
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
}) {
  const t = useT(T);
  const host = useRef<HTMLDivElement | null>(null);
  const editor = useRef<Editor | null>(null);
  const actions = useRef({ onRollbackHunk, onSymbol, onJump, onReferences, onCaret, onLineHistory, onCommitDiff, onCopy });
  actions.current = { onRollbackHunk, onSymbol, onJump, onReferences, onCaret, onLineHistory, onCommitDiff, onCopy };
  const [changes, setChanges] = useState<ChangeRange[]>([]);
  const [blame, setBlame] = useState<BlameLine[] | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; line: number } | null>(null);
  const [annotate, setAnnotate] = useStoredState<boolean>("gitjet.annotate", false);
  // The gutter's Git actions describe the working-tree file; line numbers of
  // an old revision are not the working tree's, so they stay off there.
  const workingTree = file.revision === "";

  // One editor per mounted document; the document itself is swapped in place
  // so scroll position and the gutter survive a reload.
  useEffect(() => {
    if (!host.current) return;
    const created = new Editor(host.current, {
      doc: file.text,
      language: file.language,
      wrap,
      labels,
      blameFormat,
      onRollbackHunk: (hunk) => actions.current.onRollbackHunk?.(hunk),
      onSymbol: (word) => (actions.current.onSymbol ?? actions.current.onJump)?.(word),
      onJump: (word) => actions.current.onJump?.(word),
      onReferences: (word) => actions.current.onReferences?.(word),
      onCaret: (n) => actions.current.onCaret?.(n),
      onGutterContext: workingTree ? (n, x, y) => setMenu({ x, y, line: n }) : undefined,
      annotate: workingTree && annotate,
      annotateFormat: (blame) =>
        blame.uncommitted
          ? { date: "", author: t("annotateLocal") }
          : { date: annotateDate(blame.time), author: blame.author },
    });
    editor.current = created;
    const uri = toUri(file.path);
    registerView(uri, created.view);
    return () => {
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

  // Change bars and blame only make sense against the working tree.
  useEffect(() => {
    let cancelled = false;
    if (!workingTree || file.binary || !file.exists) {
      setChanges([]);
      setBlame(null);
      return;
    }
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
    Git.blame(file.path)
      .then((result) => {
        if (!cancelled) setBlame(result.lines);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [workingTree, file.binary, file.exists, file.path, file.text]);

  useEffect(() => {
    editor.current?.setChanges(changes);
  }, [changes]);

  useEffect(() => {
    editor.current?.setBlame(blame);
  }, [blame]);

  useEffect(() => {
    editor.current?.setAnnotate(workingTree && annotate);
  }, [annotate, workingTree]);

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
  const menuItems: ContextItem[] = [];
  if (menu) {
    const blamed = blame?.find((l) => l.line === menu.line);
    const hash = blamed && !blamed.uncommitted ? blamed.commit : "";
    if (blamed) {
      menuItems.push(
        blamed.uncommitted
          ? { header: true, label: t("uncommitted") }
          : { header: true, label: `${blamed.short} · ${blamed.author} · ${formatWhen(blamed.time)}` },
      );
      if (blamed.summary) menuItems.push({ header: true, label: blamed.summary });
      menuItems.push({ separator: true });
    }
    if (hash) {
      menuItems.push({
        label: t("commitFileDiff"),
        icon: "diff",
        disabled: !onCommitDiff,
        onClick: () => onCommitDiff?.(hash),
      });
    }
    menuItems.push({
      label: t("lineHistory"),
      icon: "log",
      disabled: !onLineHistory,
      onClick: () => onLineHistory?.(menu.line),
    });
    if (hash) {
      menuItems.push({
        label: t("copyHash"),
        icon: "copy",
        disabled: !onCopy,
        onClick: () => onCopy?.(hash),
      });
    }
    menuItems.push({ separator: true });
    menuItems.push({
      label: annotate ? t("closeAnnotations") : t("annotateWithBlame"),
      icon: "user",
      onClick: () => setAnnotate(!annotate),
    });
  }

  return (
    <div className="source-editor" ref={host} onContextMenu={(event) => event.stopPropagation()}>
      {menu && <ContextMenu x={menu.x} y={menu.y} items={menuItems} onClose={() => setMenu(null)} />}
    </div>
  );
}
