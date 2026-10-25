import { useMemo, useState } from "react";
import type { ChangesSnapshot, Settings } from "./mygo";
import { Icon } from "./icons";
import {
  Checkbox,
  ContextMenu,
  cx,
  IconButton,
  type ContextItem,
  StatusMark,
} from "./ui";

export interface FileEntry {
  path: string;
  kind: string;
  staged: boolean;
  additions: number;
  deletions: number;
  binary: boolean;
  unmerged: boolean;
  conflictCode?: string;
  ignored?: boolean;
}

interface TreeNode {
  name: string;
  path: string;
  isDir: boolean;
  children: TreeNode[];
  entry?: FileEntry;
}

export interface CommitForm {
  message: string;
  amend: boolean;
  signOff: boolean;
  noVerify: boolean;
  authorName: string;
  authorEmail: string;
}

export interface CommitActions {
  onRefresh: () => void;
  onShowDiff: (entry: FileEntry) => void;
  onShowConflict: (path: string) => void;
  onShowHistory: (path: string) => void;
  onStage: (paths: string[]) => void;
  onUnstage: (paths: string[]) => void;
  onRollback: (paths: string[]) => void;
  onDelete: (paths: string[]) => void;
  onIgnore: (paths: string[]) => void;
  onReveal: (path: string) => void;
  onCopyPath: (path: string) => void;
  onMoveToChangelist: (paths: string[], id: string) => void;
  onCreateChangelist: () => void;
  onRenameChangelist: (id: string) => void;
  onDeleteChangelist: (id: string) => void;
  onSetActiveChangelist: (id: string) => void;
  onTakeSide: (path: string, side: "ours" | "theirs") => void;
  onMarkResolved: (paths: string[]) => void;
  onCommit: (push: boolean) => void;
  onToggleAmend: (amend: boolean) => void;
  onCommitFormChange: (form: CommitForm) => void;
  onRequestPush: () => void;
  onShowStash: (index: number) => void;
  onStashPush: () => void;
  onStashApply: (index: number, pop: boolean) => void;
  onStashDrop: (index: number) => void;
}

export function entriesFor(snapshot: ChangesSnapshot): FileEntry[] {
  const out: FileEntry[] = [];
  const seen = new Set<string>();
  for (const c of snapshot.changes) {
    const key = `${c.path}:${c.staged ? "s" : c.unmerged ? "u" : "w"}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      path: c.path,
      kind: c.kind,
      staged: c.staged,
      additions: c.additions,
      deletions: c.deletions,
      binary: c.binary,
      unmerged: c.unmerged,
      conflictCode: c.conflictCode,
      ignored: c.kind === "ignored",
    });
  }
  for (const cf of snapshot.conflicts) {
    if (!out.some((e) => e.path === cf.path && e.unmerged)) {
      out.push({
        path: cf.path,
        kind: "conflict",
        staged: false,
        additions: 0,
        deletions: 0,
        binary: false,
        unmerged: true,
        conflictCode: cf.code,
      });
    }
  }
  return out;
}

function buildTree(entries: FileEntry[]): TreeNode[] {
  const root: TreeNode = { name: "", path: "", isDir: true, children: [] };
  const dirs = new Map<string, TreeNode>([["", root]]);
  for (const entry of entries) {
    const parts = entry.path.split("/");
    let parent = root;
    let prefix = "";
    for (let i = 0; i < parts.length - 1; i++) {
      prefix = prefix ? prefix + "/" + parts[i] : parts[i]!;
      let dir = dirs.get(prefix);
      if (!dir) {
        dir = { name: parts[i]!, path: prefix, isDir: true, children: [] };
        dirs.set(prefix, dir);
        parent.children.push(dir);
      }
      parent = dir;
    }
    parent.children.push({
      name: parts[parts.length - 1]!,
      path: entry.path,
      isDir: false,
      children: [],
      entry,
    });
  }
  const sort = (node: TreeNode) => {
    node.children.sort((a, b) => {
      if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
      return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
    });
    node.children.forEach(sort);
  };
  sort(root);
  return root.children;
}

function leaves(node: TreeNode): FileEntry[] {
  if (node.entry) return [node.entry];
  return node.children.flatMap(leaves);
}

export function CommitPanel({
  snapshot,
  settings,
  checked,
  setChecked,
  form,
  actions,
  busy,
  history,
}: {
  snapshot: ChangesSnapshot;
  settings: Settings;
  checked: Set<string>;
  setChecked: (next: Set<string>) => void;
  form: CommitForm;
  actions: CommitActions;
  busy: boolean;
  history: string[];
}) {
  const entries = useMemo(() => entriesFor(snapshot), [snapshot]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [menu, setMenu] = useState<{ x: number; y: number; items: ContextItem[] } | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [showOptions, setShowOptions] = useState(false);
  const [showHistory, setShowHistory] = useState(false);

  const staged = entries.filter((e) => e.staged);
  const conflicts = entries.filter((e) => e.unmerged && !e.staged);
  const ignored = entries.filter((e) => e.ignored);
  const changelists = snapshot.changelists;

  const entriesByPath = useMemo(() => {
    const map = new Map<string, FileEntry[]>();
    for (const e of entries) {
      const list = map.get(e.path) ?? [];
      list.push(e);
      map.set(e.path, list);
    }
    return map;
  }, [entries]);

  const allPaths = entries.filter((e) => !e.unmerged && !e.ignored).map((e) => e.path);
  const uniqueChecked = [...new Set(allPaths)].filter((p) => checked.has(p));

  const toggle = (paths: string[], value: boolean) => {
    const next = new Set(checked);
    for (const p of paths) {
      if (value) next.add(p);
      else next.delete(p);
    }
    setChecked(next);
  };

  const checkState = (paths: string[]): boolean | "mixed" => {
    const uniq = [...new Set(paths)];
    const on = uniq.filter((p) => checked.has(p)).length;
    if (on === 0) return false;
    if (on === uniq.length) return true;
    return "mixed";
  };

  const selectRow = (e: React.MouseEvent, entry: FileEntry) => {
    const next = new Set<string>();
    if (e.metaKey || e.ctrlKey) {
      for (const p of selected) next.add(p);
      if (next.has(entry.path)) next.delete(entry.path);
      else next.add(entry.path);
    } else if (e.shiftKey && selected.size > 0) {
      const paths = entries.map((x) => x.path);
      const first = paths.indexOf([...selected][0]!);
      const last = paths.indexOf(entry.path);
      for (let i = Math.min(first, last); i <= Math.max(first, last); i++) next.add(paths[i]!);
    } else {
      next.add(entry.path);
    }
    setSelected(next);
    if (entry.unmerged) actions.onShowConflict(entry.path);
    else actions.onShowDiff(entry);
  };

  const menuFor = (entry: FileEntry, x: number, y: number) => {
    const chosen = selected.has(entry.path) && selected.size > 1 ? [...selected] : [entry.path];
    const items: ContextItem[] = [
      { label: "Show Diff", icon: "diff", onClick: () => actions.onShowDiff(entry) },
      { label: "Show History", icon: "log", onClick: () => actions.onShowHistory(entry.path) },
      { separator: true },
    ];
    if (entry.unmerged) {
      items.push(
        { label: "Resolve Conflict…", icon: "merge", onClick: () => actions.onShowConflict(entry.path) },
        { label: "Accept Ours", icon: "ours", onClick: () => actions.onTakeSide(entry.path, "ours") },
        { label: "Accept Theirs", icon: "theirs", onClick: () => actions.onTakeSide(entry.path, "theirs") },
        { label: "Mark Resolved", icon: "check", onClick: () => actions.onMarkResolved(chosen) },
      );
    } else if (entry.staged) {
      items.push(
        { label: "Unstage", icon: "unstage", onClick: () => actions.onUnstage(chosen) },
        { label: "Rollback…", icon: "undo", danger: true, onClick: () => actions.onRollback(chosen) },
      );
    } else {
      if (entry.kind === "untracked") {
        items.push(
          { label: "Add to VCS", icon: "stage", onClick: () => actions.onStage(chosen) },
          { label: "Delete…", icon: "trash", danger: true, onClick: () => actions.onDelete(chosen) },
          { label: "Add to .gitignore", icon: "eye", onClick: () => actions.onIgnore(chosen) },
        );
      } else {
        items.push(
          { label: "Stage", icon: "stage", onClick: () => actions.onStage(chosen) },
          { label: "Rollback…", icon: "undo", danger: true, onClick: () => actions.onRollback(chosen) },
        );
      }
      const clItems = changelists.items
        .map<ContextItem>((cl) => ({
          label: cl.name,
          onClick: () => actions.onMoveToChangelist(chosen, cl.id),
        }));
      if (clItems.length > 0) {
        items.push({ separator: true }, ...clItems);
      }
    }
    items.push(
      { separator: true },
      { label: "Copy Path", icon: "copy", onClick: () => actions.onCopyPath(entry.path) },
      { label: "Reveal in File Manager", icon: "external", onClick: () => actions.onReveal(entry.path) },
    );
    setMenu({ x, y, items });
  };

  const renderRow = (node: TreeNode, depth: number): React.ReactNode => {
    if (node.isDir) {
      const key = "dir:" + node.path;
      const isCollapsed = collapsed.has(key);
      const files = leaves(node).filter((e) => !e.unmerged && !e.ignored);
      const state = checkState(files.map((f) => f.path));
      return (
        <div key={key}>
          <div className="tree-row dir" style={{ paddingLeft: 6 + depth * 12 }}>
            <button
              className="tree-chevron"
              onClick={() => {
                const next = new Set(collapsed);
                if (isCollapsed) next.delete(key);
                else next.add(key);
                setCollapsed(next);
              }}
            >
              <Icon name={isCollapsed ? "chevronRight" : "chevronDown"} size={12} />
            </button>
            <Checkbox
              checked={state === true}
              indeterminate={state === "mixed"}
              onChange={(v) => toggle(files.map((f) => f.path), v)}
              disabled={files.length === 0}
            />
            <Icon name="folder" />
            <span className="tree-name">{node.name}</span>
            <span className="tree-count">{leaves(node).length}</span>
          </div>
          {!isCollapsed && node.children.map((child) => renderRow(child, depth + 1))}
        </div>
      );
    }
    const entry = node.entry!;
    const isSelected = selected.has(entry.path);
    return (
      <div
        key={"file:" + entry.path + (entry.staged ? ":s" : "")}
        className={cx("tree-row file", isSelected && "selected")}
        style={{ paddingLeft: 6 + depth * 12 }}
        onClick={(e) => selectRow(e, entry)}
        onContextMenu={(e) => {
          e.preventDefault();
          menuFor(entry, e.clientX, e.clientY);
        }}
        title={entry.path}
      >
        <span className="tree-chevron-spacer" />
        {entry.unmerged || entry.ignored ? (
          <span className="checkbox-spacer" />
        ) : (
          <Checkbox checked={checked.has(entry.path)} onChange={(v) => toggle([entry.path], v)} />
        )}
        {entry.staged && <span className="staged-dot" title="Staged" />}
        <StatusMark kind={entry.kind} staged={entry.staged} />
        <span className="tree-name">{node.name}</span>
        <span className="tree-stats">
          {entry.additions > 0 && <span className="add-count">+{entry.additions}</span>}
          {entry.deletions > 0 && <span className="del-count">−{entry.deletions}</span>}
        </span>
      </div>
    );
  };

  const section = (key: string, title: string, icon: React.ReactNode, count: number, children: React.ReactNode, extra?: React.ReactNode) => {
    const isCollapsed = collapsed.has(key);
    return (
      <div className="change-section">
        <div
          className="section-header"
          onClick={() => {
            const next = new Set(collapsed);
            if (isCollapsed) next.delete(key);
            else next.add(key);
            setCollapsed(next);
          }}
        >
          <Icon name={isCollapsed ? "chevronRight" : "chevronDown"} size={12} />
          {icon}
          <span className="section-title">{title}</span>
          <span className="section-count">{count}</span>
          {extra && (
            <span className="section-extra" onClick={(e) => e.stopPropagation()}>
              {extra}
            </span>
          )}
        </div>
        {!isCollapsed && children}
      </div>
    );
  };

  const changelistNodes = changelists.items.map((cl) => {
    const paths = new Set(cl.paths);
    const list = entries.filter(
      (e) => !e.staged && !e.unmerged && !e.ignored && paths.has(e.path),
    );
    const isActive = cl.id === changelists.active;
    const extra = (
      <>
        <IconButton
          icon="plus"
          title="New changelist"
          small
          onClick={actions.onCreateChangelist}
        />
        <IconButton
          icon="more"
          title="Changelist actions"
          small
          onClick={(e) => {
            const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
            setMenu({
              x: rect.left,
              y: rect.bottom,
              items: [
                { label: "New Changelist…", icon: "plus", onClick: actions.onCreateChangelist },
                { label: "Rename…", icon: "edit", onClick: () => actions.onRenameChangelist(cl.id) },
                { label: "Set Active", icon: "check", checked: isActive, onClick: () => actions.onSetActiveChangelist(cl.id) },
                { separator: true },
                {
                  label: "Delete…",
                  icon: "trash",
                  danger: true,
                  disabled: cl.default,
                  onClick: () => actions.onDeleteChangelist(cl.id),
                },
              ],
            });
          }}
        />
      </>
    );
    return (
      <div key={cl.id}>
        {section(
          "cl:" + cl.id,
          cl.name + (isActive ? " (active)" : ""),
          <Icon name={isActive ? "check" : "list"} />,
          list.length,
          list.length === 0 ? (
            <div className="empty-section">No changes</div>
          ) : (
            buildTree(list).map((n) => renderRow(n, 1))
          ),
          extra,
        )}
      </div>
    );
  });

  const canCommit = uniqueChecked.length > 0 || form.amend || [...checked].length > 0;

  return (
    <div className="commit-panel">
      <div className="panel-toolbar">
        <IconButton icon="refresh" title="Refresh" onClick={actions.onRefresh} spinner={busy} />
        <span className="toolbar-sep" />
        <IconButton
          icon="stage"
          title="Stage selected"
          disabled={selected.size === 0}
          onClick={() => actions.onStage([...selected])}
        />
        <IconButton
          icon="unstage"
          title="Unstage selected"
          disabled={selected.size === 0}
          onClick={() => actions.onUnstage([...selected])}
        />
        <IconButton
          icon="undo"
          title="Rollback selected"
          disabled={selected.size === 0}
          onClick={() => actions.onRollback([...selected])}
        />
        <IconButton
          icon="diff"
          title="Show diff"
          disabled={selected.size !== 1}
          onClick={() => {
            const p = [...selected][0]!;
            const list = entriesByPath.get(p) ?? [];
            const entry = list.find((e) => !e.staged) ?? list[0];
            if (entry) {
              if (entry.unmerged) actions.onShowConflict(p);
              else actions.onShowDiff(entry);
            }
          }}
        />
        <span className="spacer" />
        <IconButton
          icon="stash"
          title="Stash changes"
          onClick={actions.onStashPush}
          disabled={entries.length === 0}
        />
        <IconButton
          icon="expand"
          title="Expand all"
          onClick={() => setCollapsed(new Set())}
        />
        <IconButton
          icon="collapse"
          title="Collapse all"
          onClick={() => {
            const next = new Set<string>();
            for (const cl of changelists.items) next.add("cl:" + cl.id);
            next.add("staged");
            next.add("conflicts");
            next.add("ignored");
            setCollapsed(next);
          }}
        />
      </div>

      <div className="changes-scroll">
        {staged.length > 0 &&
          section(
            "staged",
            "Staged Changes",
            <Icon name="stage" />,
            staged.length,
            buildTree(staged).map((n) => renderRow(n, 0)),
            <IconButton
              icon="unstage"
              title="Unstage all"
              small
              onClick={() => actions.onUnstage(staged.map((e) => e.path))}
            />,
          )}
        {conflicts.length > 0 &&
          section(
            "conflicts",
            "Merge Conflicts",
            <Icon name="warning" />,
            conflicts.length,
            buildTree(conflicts).map((n) => renderRow(n, 0)),
          )}
        {changelistNodes}
        {snapshot.stashes.length > 0 && (
          <div className="stash-section">
            <div className="section-header static">
              <Icon name="stash" />
              <span className="section-title">Stashes</span>
              <span className="section-count">{snapshot.stashes.length}</span>
              <span className="spacer" />
              <IconButton icon="plus" title="Stash changes" small onClick={actions.onStashPush} />
            </div>
            {snapshot.stashes.map((s) => (
              <div
                className="tree-row stash-row"
                key={s.ref}
                onDoubleClick={() => actions.onShowStash(s.index)}
                title={s.message}
              >
                <span className="stash-ref">stash@{"{" + s.index + "}"}</span>
                <span className="tree-name">{s.message}</span>
                <span className="stash-actions" onClick={(e) => e.stopPropagation()}>
                  <button className="mini-btn" onClick={() => actions.onStashApply(s.index, true)} title="Pop stash">
                    Pop
                  </button>
                  <button className="mini-btn" onClick={() => actions.onStashApply(s.index, false)} title="Apply stash">
                    Apply
                  </button>
                  <button className="mini-btn danger" onClick={() => actions.onStashDrop(s.index)} title="Drop stash">
                    Drop
                  </button>
                </span>
              </div>
            ))}
          </div>
        )}
        {settings.showIgnored && ignored.length > 0 &&
          section(
            "ignored",
            "Ignored Files",
            <Icon name="eye" />,
            ignored.length,
            buildTree(ignored).map((n) => renderRow(n, 0)),
          )}
        {entries.length === 0 && (
          <div className="changes-empty">
            <Icon name="check" size={20} />
            <span>No local changes</span>
            <span className="muted">The working tree is clean.</span>
          </div>
        )}
      </div>

      <div className="commit-box">
        <div className="commit-message-wrap">
          <textarea
            className="commit-message"
            placeholder="Commit message"
            value={form.message}
            spellCheck
            onChange={(e) => actions.onCommitFormChange({ ...form, message: e.target.value })}
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && !busy) {
                e.preventDefault();
                actions.onCommit(false);
              }
            }}
          />
          <div className="commit-message-tools">
            <button
              className="mini-icon"
              title="Recent messages"
              onClick={() => setShowHistory((v) => !v)}
            >
              <Icon name="clock" size={13} />
            </button>
            {showHistory && history.length > 0 && (
              <div className="message-history" onMouseLeave={() => setShowHistory(false)}>
                {history.map((m, i) => (
                  <button
                    key={i}
                    className="message-history-item"
                    onClick={() => {
                      actions.onCommitFormChange({ ...form, message: m });
                      setShowHistory(false);
                    }}
                  >
                    {m.split("\n")[0]}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
        <div className="commit-options">
          <Checkbox
            checked={form.amend}
            onChange={actions.onToggleAmend}
            label="Amend"
          />
          <span className="spacer" />
          <button className="commit-options-btn" onClick={() => setShowOptions((v) => !v)} title="Commit options">
            <Icon name="settings" size={13} />
            Options
            {(form.signOff || form.noVerify || form.authorName) && <span className="dot-badge" />}
          </button>
          {showOptions && (
            <div className="options-popover" onMouseLeave={() => setShowOptions(false)}>
              <Checkbox
                checked={form.signOff}
                onChange={(v) => actions.onCommitFormChange({ ...form, signOff: v })}
                label="Sign-off commit"
              />
              <Checkbox
                checked={form.noVerify}
                onChange={(v) => actions.onCommitFormChange({ ...form, noVerify: v })}
                label="Skip hooks (--no-verify)"
              />
              <label className="field field-inline">
                <span className="field-label">Author</span>
                <input
                  className="text-input"
                  placeholder="Name (optional)"
                  value={form.authorName}
                  onChange={(e) => actions.onCommitFormChange({ ...form, authorName: e.target.value })}
                />
              </label>
              <label className="field field-inline">
                <span className="field-label">Email</span>
                <input
                  className="text-input"
                  placeholder="email@example.com"
                  value={form.authorEmail}
                  onChange={(e) => actions.onCommitFormChange({ ...form, authorEmail: e.target.value })}
                />
              </label>
            </div>
          )}
        </div>
        <div className="commit-buttons">
          <button
            className="btn btn-primary commit-btn"
            onClick={() => actions.onCommit(false)}
            disabled={busy || !canCommit}
            title="Commit (⌘/Ctrl+Enter)"
          >
            <Icon name="commit" />
            Commit {uniqueChecked.length > 0 ? `(${uniqueChecked.length})` : ""}
          </button>
          <button
            className="btn btn-primary split-arrow"
            onClick={() => actions.onRequestPush()}
            disabled={busy || !canCommit}
            title="Commit and Push…"
          >
            <Icon name="chevronUp" size={12} />
          </button>
        </div>
      </div>
      {menu && <ContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={() => setMenu(null)} />}
    </div>
  );
}
