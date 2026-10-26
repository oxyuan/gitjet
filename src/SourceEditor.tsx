import { useEffect, useRef, useState } from "react";
import { Git, type BlameLine, type DiffOptions, type SourceFile } from "./mygo";
import { SourceEditor as Editor } from "./editor";
import { changeRanges, type ChangeRange } from "./annotate";
import { connectLSP, lspServes, registerView, unregisterView, toUri } from "./lsp";


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
}) {
  const host = useRef<HTMLDivElement | null>(null);
  const editor = useRef<Editor | null>(null);
  const actions = useRef({ onRollbackHunk, onSymbol, onJump, onReferences });
  actions.current = { onRollbackHunk, onSymbol, onJump, onReferences };
  const [changes, setChanges] = useState<ChangeRange[]>([]);
  const [blame, setBlame] = useState<BlameLine[] | null>(null);

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
  const workingTree = file.revision === "";
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

  return <div className="source-editor" ref={host} onContextMenu={(event) => event.stopPropagation()} />;
}
