import { useMemo, useState } from "react";
import type { SourceFile } from "./mygo";
import { highlightLine } from "./highlight";
import { Icon } from "./icons";
import { cx, IconButton } from "./ui";

function revisionLabel(revision: string): string {
  if (revision === "") return "Working Tree";
  if (revision === "INDEX") return "Index";
  if (/^[0-9a-f]{7,40}$/i.test(revision)) return revision.slice(0, 8);
  return revision;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** SourceView shows a file's actual contents, not a diff, so a review can
 *  read the code as it is. */
export function SourceView({
  file,
  onShowDiff,
  onBlame,
  onOpenWorkingTree,
  onOpenRevision,
  onCopyPath,
  onReveal,
}: {
  file: SourceFile;
  onShowDiff?: () => void;
  onBlame?: () => void;
  onOpenWorkingTree?: () => void;
  onOpenRevision?: () => void;
  onCopyPath: () => void;
  onReveal?: () => void;
}) {
  const [wrap, setWrap] = useState(false);
  const lines = useMemo(() => {
    if (file.text === "") return [];
    const normalized = file.text.replace(/\r\n/g, "\n");
    const split = normalized.split("\n");
    if (split.length > 0 && split[split.length - 1] === "") split.pop();
    return split;
  }, [file.text]);

  const highlighted = useMemo(() => {
    if (file.binary || lines.length === 0) return [];
    if (lines.length > 4000 || file.text.length > 600_000) {
      return lines.map((line) => line.replace(/[&<>]/g, (c) => (c === "&" ? "&amp;" : c === "<" ? "&lt;" : "&gt;")));
    }
    return lines.map((line) => highlightLine(line, file.language));
  }, [file.binary, file.language, file.text.length, lines]);

  const dir = file.path.includes("/") ? file.path.slice(0, file.path.lastIndexOf("/") + 1) : "";
  const name = file.path.slice(dir.length);
  const revision = revisionLabel(file.revision);

  return (
    <div className="source-view">
      <div className="diff-header source-header">
        <div className="diff-title-row">
          <span className={cx("source-kind", file.exists ? "" : "deleted")}>
            <Icon name="file" />
          </span>
          <span className="diff-path source-path">
            <span className="path-dir">{dir}</span>
            <span className="path-name">{name}</span>
          </span>
          <span className={cx("revision-chip", file.revision === "" ? "working" : "")}>{revision}</span>
          {!file.exists && <span className="deleted-badge">deleted in working tree</span>}
          <span className="muted source-meta">
            {file.language} · {lines.length} lines · {formatSize(file.size)}
          </span>
          <span className="spacer" />
          {file.revision === "" && onOpenRevision && (
            <button className="toolbar-text-btn" onClick={onOpenRevision} title="Open the HEAD version">
              <Icon name="hash" /> HEAD
            </button>
          )}
          {file.revision !== "" && onOpenWorkingTree && (
            <button className="toolbar-text-btn" onClick={onOpenWorkingTree} title="Open the working tree version">
              <Icon name="edit" /> Working Tree
            </button>
          )}
          {onShowDiff && (
            <button className="toolbar-text-btn" onClick={onShowDiff} title="Show this file as a diff">
              <Icon name="diff" /> Diff
            </button>
          )}
          {onBlame && file.revision === "" && (
            <button className="toolbar-text-btn" onClick={onBlame} title="Annotate this file">
              <Icon name="user" /> Annotate
            </button>
          )}
          <IconButton icon="copy" title="Copy path" small onClick={onCopyPath} />
          {onReveal && <IconButton icon="external" title="Reveal in file manager" small onClick={onReveal} />}
        </div>
        <div className="diff-toolbar source-toolbar">
          <button className={cx("toolbar-text-btn", wrap && "active")} onClick={() => setWrap((v) => !v)}>
            <Icon name="rows" /> Wrap
          </button>
          <span className="toolbar-sep" />
          <span className="muted">UTF-8</span>
          <span className="spacer" />
          {file.truncated && <span className="source-warning">File truncated at 8 MB</span>}
        </div>
      </div>
      {file.binary ? (
        <div className="diff-empty">
          <Icon name="file" size={24} />
          <div>Binary file — no text to show</div>
          <div className="muted">{formatSize(file.size)}</div>
        </div>
      ) : lines.length === 0 ? (
        <div className="diff-empty">
          <Icon name="file" size={20} />
          <div>{file.exists ? "Empty file" : "File does not exist in this revision"}</div>
        </div>
      ) : (
        <div className={cx("source-body", wrap && "wrap")}>
          <div className="source-rows">
            {highlighted.map((html, i) => (
              <div className="source-row" key={i}>
                <span className="source-no">{i + 1}</span>
                <code className="source-code" dangerouslySetInnerHTML={{ __html: html || " " }} />
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
