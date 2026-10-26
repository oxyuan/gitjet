import { useMemo, useState } from "react";
import { buildChangeTree, directoryKeys, splitTracked, treeFiles } from "./changes";
import { FileTree, type ChangeView } from "./FileTree";
import { count, useT } from "./i18n";
import type { Changelist, ChangesSnapshot, Settings } from "./mygo";
import { Icon } from "./icons";
import {
  Checkbox,
  ContextMenu,
  cx,
  IconButton,
  type ContextItem,
  StatusMark,
} from "./ui";
import type { TreeNode } from "./changes";

const T = {
  en: {
    showDiff: "Show Diff",
    openSourceFile: "Open Source File",
    showHistory: "Show History",
    resolveConflict: "Resolve Conflict…",
    acceptOurs: "Accept Ours",
    acceptTheirs: "Accept Theirs",
    markResolved: "Mark Resolved",
    unstage: "Unstage",
    rollback: "Rollback…",
    addToVcs: "Add to VCS",
    delete: "Delete…",
    addToGitignore: "Add to .gitignore",
    stage: "Stage",
    copyPath: "Copy Path",
    revealInFileManager: "Reveal in File Manager",
    newChangelist: "New Changelist…",
    rename: "Rename…",
    setActive: "Set Active",
    newChangelistTitle: "New changelist",
    changelistActions: "Changelist actions",
    changelistActive: "{name} (active)",
    changedFiles: "Changed",
    untrackedFiles: "Unversioned Files",
    changedOne: "1 file",
    changedOther: "{n} files",
    viewTree: "Group by folder",
    viewFlat: "Plain file list",
    showStagedSection: "Show staged changes",
    hideStagedSection: "Hide staged changes",
    showStashes: "Show stashes",
    hideStashes: "Hide stashes",
    more: "More actions",
    noChanges: "No changes",
    refresh: "Refresh",
    stageSelected: "Stage selected",
    unstageSelected: "Unstage selected",
    rollbackSelected: "Rollback selected",
    openSourceFileTitle: "Open source file",
    showDiffTitle: "Show diff",
    stashChanges: "Stash changes",
    expandAll: "Expand all",
    collapseAll: "Collapse all",
    unstageAll: "Unstage all",
    stagedChanges: "Staged Changes",
    mergeConflicts: "Merge Conflicts",
    stashes: "Stashes",
    ignoredFiles: "Ignored Files",
    staged: "Staged",
    popStash: "Pop stash",
    applyStash: "Apply stash",
    dropStash: "Drop stash",
    resolveAll: "Resolve conflicts…",
    stashDetail: "Show the stash contents",
    pop: "Pop",
    apply: "Apply",
    drop: "Drop",
    noLocalChanges: "No local changes",
    workingTreeClean: "The working tree is clean.",
    commitMessage: "Commit message",
    recentMessages: "Recent messages",
    amend: "Amend",
    commitOptions: "Commit options",
    options: "Options",
    signOff: "Sign-off commit",
    skipHooks: "Skip hooks (--no-verify)",
    author: "Author",
    nameOptional: "Name (optional)",
    email: "Email",
    commitTooltip: "Commit (⌘/Ctrl+Enter)",
    commit: "Commit",
    commitCount: "Commit ({n})",
    commitAndPush: "Commit and Push…",
  },
  zh: {
    showDiff: "显示差异",
    openSourceFile: "打开源文件",
    showHistory: "显示历史",
    resolveConflict: "解决冲突…",
    acceptOurs: "采用我方版本",
    acceptTheirs: "采用对方版本",
    markResolved: "标记为已解决",
    unstage: "取消暂存",
    rollback: "回滚…",
    addToVcs: "添加到版本控制",
    delete: "删除…",
    addToGitignore: "添加到 .gitignore",
    stage: "暂存",
    copyPath: "复制路径",
    revealInFileManager: "在文件管理器中显示",
    newChangelist: "新建变更列表…",
    rename: "重命名…",
    setActive: "设为活动列表",
    newChangelistTitle: "新建变更列表",
    changelistActions: "变更列表操作",
    changelistActive: "{name}（活动）",
    changedFiles: "更改",
    untrackedFiles: "未进行版本管理的文件",
    changedOne: "1 个文件",
    changedOther: "{n} 个文件",
    viewTree: "按目录分组",
    viewFlat: "平铺文件列表",
    showStagedSection: "显示已暂存的更改",
    hideStagedSection: "隐藏已暂存的更改",
    showStashes: "显示贮藏",
    hideStashes: "隐藏贮藏",
    more: "更多操作",
    noChanges: "无更改",
    refresh: "刷新",
    stageSelected: "暂存选中项",
    unstageSelected: "取消暂存选中项",
    rollbackSelected: "回滚选中项",
    openSourceFileTitle: "打开源文件",
    showDiffTitle: "显示差异",
    stashChanges: "贮藏更改",
    expandAll: "全部展开",
    collapseAll: "全部折叠",
    unstageAll: "全部取消暂存",
    stagedChanges: "已暂存的更改",
    mergeConflicts: "合并冲突",
    stashes: "贮藏",
    ignoredFiles: "已忽略的文件",
    staged: "已暂存",
    popStash: "弹出贮藏",
    applyStash: "应用贮藏",
    dropStash: "删除贮藏",
    resolveAll: "解决冲突…",
    stashDetail: "查看贮藏内容",
    pop: "弹出",
    apply: "应用",
    drop: "删除",
    noLocalChanges: "没有本地更改",
    workingTreeClean: "工作区是干净的。",
    commitMessage: "提交信息",
    recentMessages: "最近的提交信息",
    amend: "修补提交",
    commitOptions: "提交选项",
    options: "选项",
    signOff: "签名提交（Signed-off-by）",
    skipHooks: "跳过钩子（--no-verify）",
    author: "作者",
    nameOptional: "姓名（可选）",
    email: "邮箱",
    commitTooltip: "提交（⌘/Ctrl+Enter）",
    commit: "提交",
    commitCount: "提交（{n}）",
    commitAndPush: "提交并推送…",
  },
} as const;

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
  onOpenSource: (path: string, revision: string) => void;
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
  onShowStashDetail: (index: number) => void;
  onResolveConflicts: () => void;
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

export function CommitPanel({
  snapshot,
  settings,
  checked,
  setChecked,
  form,
  actions,
  busy,
  history,
  viewMode,
  onViewMode,
  showStaged,
  onToggleStaged,
  showStashes,
  onToggleStashes,
}: {
  viewMode: ChangeView;
  onViewMode: (view: ChangeView) => void;
  showStaged: boolean;
  onToggleStaged: () => void;
  showStashes: boolean;
  onToggleStashes: () => void;
  snapshot: ChangesSnapshot;
  settings: Settings;
  checked: Set<string>;
  setChecked: (next: Set<string>) => void;
  form: CommitForm;
  actions: CommitActions;
  busy: boolean;
  history: string[];
}) {
  const t = useT(T);
  const entries = useMemo(() => entriesFor(snapshot), [snapshot]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [menu, setMenu] = useState<{ x: number; y: number; items: ContextItem[] } | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  // Directories start collapsed: the tree shows modules first, files on demand.
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
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
      { label: t("showDiff"), icon: "diff", onClick: () => actions.onShowDiff(entry) },
      { label: t("openSourceFile"), icon: "file", onClick: () => actions.onOpenSource(entry.path, entry.staged ? "INDEX" : "") },
      { label: t("showHistory"), icon: "log", onClick: () => actions.onShowHistory(entry.path) },
      { separator: true },
    ];
    if (entry.unmerged) {
      items.push(
        { label: t("resolveConflict"), icon: "merge", onClick: () => actions.onShowConflict(entry.path) },
        { label: t("acceptOurs"), icon: "ours", onClick: () => actions.onTakeSide(entry.path, "ours") },
        { label: t("acceptTheirs"), icon: "theirs", onClick: () => actions.onTakeSide(entry.path, "theirs") },
        { label: t("markResolved"), icon: "check", onClick: () => actions.onMarkResolved(chosen) },
      );
    } else if (entry.staged) {
      items.push(
        { label: t("unstage"), icon: "unstage", onClick: () => actions.onUnstage(chosen) },
        { label: t("rollback"), icon: "undo", danger: true, onClick: () => actions.onRollback(chosen) },
      );
    } else {
      if (entry.kind === "untracked") {
        items.push(
          { label: t("addToVcs"), icon: "stage", onClick: () => actions.onStage(chosen) },
          { label: t("delete"), icon: "trash", danger: true, onClick: () => actions.onDelete(chosen) },
          { label: t("addToGitignore"), icon: "eye", onClick: () => actions.onIgnore(chosen) },
        );
      } else {
        items.push(
          { label: t("stage"), icon: "stage", onClick: () => actions.onStage(chosen) },
          { label: t("rollback"), icon: "undo", danger: true, onClick: () => actions.onRollback(chosen) },
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
      { label: t("copyPath"), icon: "copy", onClick: () => actions.onCopyPath(entry.path) },
      { label: t("revealInFileManager"), icon: "external", onClick: () => actions.onReveal(entry.path) },
    );
    setMenu({ x, y, items });
  };

  const toggleDir = (key: string) => {
    const next = new Set(expanded);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setExpanded(next);
  };

  // A directory row carries the checkbox of everything beneath it.
  const renderDirLead = (node: TreeNode<FileEntry>) => {
    const files = treeFiles(node).filter((e) => !e.unmerged && !e.ignored);
    const state = checkState(files.map((f) => f.path));
    return (
      <span className="dir-check" onClick={(e) => e.stopPropagation()}>
        <Checkbox
          checked={state === true}
          indeterminate={state === "mixed"}
          onChange={(v) => toggle(files.map((f) => f.path), v)}
          disabled={files.length === 0}
        />
      </span>
    );
  };

  const renderFileRow = (entry: FileEntry, depth: number, flat: boolean) => {
    const isSelected = selected.has(entry.path);
    const slash = entry.path.lastIndexOf("/");
    const name = slash < 0 ? entry.path : entry.path.slice(slash + 1);
    const dir = slash < 0 ? "" : entry.path.slice(0, slash + 1);
    return (
      <div
        key={"file:" + entry.path + (entry.staged ? ":s" : "")}
        className={cx("tree-row file", flat && "flat", isSelected && "selected")}
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
        {entry.staged && <span className="staged-dot" title={t("staged")} />}
        <StatusMark kind={entry.kind} staged={entry.staged} />
        <span className="tree-name">
          <span className="file-base">{name}</span>
          {flat && dir !== "" && <span className="file-dir">{dir}</span>}
        </span>
        <span className="tree-stats">
          {entry.additions > 0 && <span className="add-count">+{entry.additions}</span>}
          {entry.deletions > 0 && <span className="del-count">−{entry.deletions}</span>}
        </span>
      </div>
    );
  };

  const renderList = (files: FileEntry[], indent = 6) => (
    <FileTree
      files={files}
      view={viewMode}
      expanded={expanded}
      onToggleDir={toggleDir}
      renderFile={renderFileRow}
      renderDirLead={renderDirLead}
      indent={indent}
    />
  );

  const allDirectories = () => {
    const groups = [staged, conflicts, ignored, ...changelists.items.map((cl) => filesOfChangelist(cl))];
    return new Set(groups.flatMap((files) => directoryKeys(buildChangeTree(files))));
  };

  const filesOfChangelist = (cl: Changelist) => {
    const paths = new Set(cl.paths);
    return entries.filter((e) => !e.staged && !e.unmerged && !e.ignored && paths.has(e.path));
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

  const countLabel = (n: number) => count(n, t("changedOne"), t("changedOther", { n }));

  // Untracked files are not part of the change yet, so they get their own
  // group instead of sitting between modified files.
  const renderChangelistBody = (list: FileEntry[]) => {
    const { tracked, untracked } = splitTracked(list);
    const split = tracked.length > 0 && untracked.length > 0;
    return (
      <>
        {tracked.length > 0 && (
          <>
            {split && (
              <div className="change-subgroup">
                {t("changedFiles")}
                <span className="subgroup-count">{countLabel(tracked.length)}</span>
              </div>
            )}
            {renderList(tracked, 18)}
          </>
        )}
        {untracked.length > 0 && (
          <>
            <div className="change-subgroup">
              {t("untrackedFiles")}
              <span className="subgroup-count">{countLabel(untracked.length)}</span>
            </div>
            {renderList(untracked, 18)}
          </>
        )}
      </>
    );
  };

  const changelistNodes = changelists.items.map((cl) => {
    const list = filesOfChangelist(cl);
    const isActive = cl.id === changelists.active;
    const extra = (
      <>
        <IconButton
          icon="plus"
          title={t("newChangelistTitle")}
          small
          onClick={actions.onCreateChangelist}
        />
        <IconButton
          icon="more"
          title={t("changelistActions")}
          small
          onClick={(e) => {
            const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
            setMenu({
              x: rect.left,
              y: rect.bottom,
              items: [
                { label: t("newChangelist"), icon: "plus", onClick: actions.onCreateChangelist },
                { label: t("rename"), icon: "edit", onClick: () => actions.onRenameChangelist(cl.id) },
                { label: t("setActive"), icon: "check", checked: isActive, onClick: () => actions.onSetActiveChangelist(cl.id) },
                { separator: true },
                {
                  label: t("delete"),
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
          isActive ? t("changelistActive", { name: cl.name }) : cl.name,
          <Icon name={isActive ? "check" : "list"} />,
          list.length,
          list.length === 0 ? (
            entries.length === 0 ? null : <div className="empty-section">{t("noChanges")}</div>
          ) : (
            renderChangelistBody(list)
          ),
          extra,
        )}
      </div>
    );
  });

  // Staged files are committed whether or not their section is on screen.
  const canCommit = uniqueChecked.length > 0 || staged.length > 0 || form.amend || [...checked].length > 0;

  return (
    <div className="commit-panel">
      <div className="panel-toolbar">
        <IconButton icon="refresh" title={t("refresh")} onClick={actions.onRefresh} spinner={busy} />
        <span className="toolbar-sep" />
        <IconButton
          icon="expand"
          title={t("expandAll")}
          onClick={() => {
            setCollapsed(new Set());
            setExpanded(allDirectories());
          }}
        />
        <IconButton
          icon="collapse"
          title={t("collapseAll")}
          onClick={() => {
            const next = new Set<string>();
            for (const cl of changelists.items) next.add("cl:" + cl.id);
            next.add("staged");
            next.add("conflicts");
            next.add("ignored");
            setCollapsed(next);
            setExpanded(new Set());
          }}
        />
        <span className="spacer" />
        <IconButton
          icon={viewMode === "tree" ? "list" : "folder"}
          title={viewMode === "tree" ? t("viewFlat") : t("viewTree")}
          onClick={() => onViewMode(viewMode === "tree" ? "flat" : "tree")}
        />
        <IconButton
          icon="more"
          title={t("more")}
          onClick={(e) => {
            const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
            const selectedPath = [...selected][0];
            const picked = selectedPath ? entriesByPath.get(selectedPath) ?? [] : [];
            const entry = picked.find((e) => !e.staged) ?? picked[0];
            setMenu({
              x: rect.right - 180,
              y: rect.bottom,
              items: [
                {
                  label: t("openSourceFileTitle"),
                  icon: "file",
                  disabled: selected.size !== 1,
                  onClick: () => entry && actions.onOpenSource(entry.path, entry.staged ? "INDEX" : ""),
                },
                {
                  label: t("showDiffTitle"),
                  icon: "diff",
                  disabled: selected.size !== 1,
                  onClick: () => {
                    if (!entry) return;
                    if (entry.unmerged) actions.onShowConflict(entry.path);
                    else actions.onShowDiff(entry);
                  },
                },
                { separator: true },
                {
                  label: t("stageSelected"),
                  icon: "stage",
                  disabled: selected.size === 0,
                  onClick: () => actions.onStage([...selected]),
                },
                {
                  label: t("unstageSelected"),
                  icon: "unstage",
                  disabled: selected.size === 0,
                  onClick: () => actions.onUnstage([...selected]),
                },
                {
                  label: t("rollbackSelected"),
                  icon: "undo",
                  danger: true,
                  disabled: selected.size === 0,
                  onClick: () => actions.onRollback([...selected]),
                },
                { separator: true },
                {
                  label: t("stashChanges"),
                  icon: "stash",
                  disabled: entries.length === 0,
                  onClick: actions.onStashPush,
                },
                {
                  label: showStashes ? t("hideStashes") : t("showStashes"),
                  icon: "stash",
                  checked: showStashes,
                  onClick: onToggleStashes,
                },
                {
                  label: showStaged ? t("hideStagedSection") : t("showStagedSection"),
                  icon: "stage",
                  checked: showStaged,
                  onClick: onToggleStaged,
                },
              ],
            });
          }}
        />
      </div>

      <div className="changes-scroll">
        {showStaged && staged.length > 0 &&
          section(
            "staged",
            t("stagedChanges"),
            <Icon name="stage" />,
            staged.length,
            renderList(staged),
            <IconButton
              icon="unstage"
              title={t("unstageAll")}
              small
              onClick={() => actions.onUnstage(staged.map((e) => e.path))}
            />,
          )}
        {conflicts.length > 0 &&
          section(
            "conflicts",
            t("mergeConflicts"),
            <Icon name="warning" />,
            conflicts.length,
            renderList(conflicts),
            <IconButton
              icon="merge"
              title={t("resolveAll")}
              small
              onClick={actions.onResolveConflicts}
            />,
          )}
        {changelistNodes}
        {showStashes && snapshot.stashes.length > 0 && (
          <div className="stash-section">
            <div className="section-header static">
              <Icon name="stash" />
              <span className="section-title">{t("stashes")}</span>
              <span className="section-count">{snapshot.stashes.length}</span>
              <span className="spacer" />
              <IconButton icon="plus" title={t("stashChanges")} small onClick={actions.onStashPush} />
            </div>
            {snapshot.stashes.map((s) => (
              <div
                className="tree-row stash-row"
                key={s.ref}
                onDoubleClick={() => actions.onShowStashDetail(s.index)}
                title={t("stashDetail")}
              >
                <span className="stash-ref">stash@{"{" + s.index + "}"}</span>
                <span className="tree-name">{s.message}</span>
                <span className="stash-actions" onClick={(e) => e.stopPropagation()}>
                  <button className="mini-btn" onClick={() => actions.onStashApply(s.index, true)} title={t("popStash")}>
                    {t("pop")}
                  </button>
                  <button className="mini-btn" onClick={() => actions.onStashApply(s.index, false)} title={t("applyStash")}>
                    {t("apply")}
                  </button>
                  <button className="mini-btn danger" onClick={() => actions.onStashDrop(s.index)} title={t("dropStash")}>
                    {t("drop")}
                  </button>
                </span>
              </div>
            ))}
          </div>
        )}
        {settings.showIgnored && ignored.length > 0 &&
          section(
            "ignored",
            t("ignoredFiles"),
            <Icon name="eye" />,
            ignored.length,
            renderList(ignored),
          )}
        {entries.length === 0 && (
          <div className="changes-empty">
            <Icon name="check" size={20} />
            <span>{t("noLocalChanges")}</span>
            <span className="muted">{t("workingTreeClean")}</span>
          </div>
        )}
      </div>

      <div className="commit-box">
        <div className="commit-message-wrap">
          <textarea
            className="commit-message"
            placeholder={t("commitMessage")}
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
              title={t("recentMessages")}
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
            label={t("amend")}
          />
          <span className="spacer" />
          <button className="commit-options-btn" onClick={() => setShowOptions((v) => !v)} title={t("commitOptions")}>
            <Icon name="settings" size={13} />
            {t("options")}
            {(form.signOff || form.noVerify || form.authorName) && <span className="dot-badge" />}
          </button>
          {showOptions && (
            <div className="options-popover" onMouseLeave={() => setShowOptions(false)}>
              <Checkbox
                checked={form.signOff}
                onChange={(v) => actions.onCommitFormChange({ ...form, signOff: v })}
                label={t("signOff")}
              />
              <Checkbox
                checked={form.noVerify}
                onChange={(v) => actions.onCommitFormChange({ ...form, noVerify: v })}
                label={t("skipHooks")}
              />
              <label className="field field-inline">
                <span className="field-label">{t("author")}</span>
                <input
                  className="text-input"
                  placeholder={t("nameOptional")}
                  value={form.authorName}
                  onChange={(e) => actions.onCommitFormChange({ ...form, authorName: e.target.value })}
                />
              </label>
              <label className="field field-inline">
                <span className="field-label">{t("email")}</span>
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
            title={t("commitTooltip")}
          >
            <Icon name="commit" />
            {uniqueChecked.length > 0 ? t("commitCount", { n: uniqueChecked.length }) : t("commit")}
          </button>
          <button
            className="btn btn-primary split-arrow"
            onClick={() => actions.onRequestPush()}
            disabled={busy || !canCommit}
            title={t("commitAndPush")}
          >
            <Icon name="chevronUp" size={12} />
          </button>
        </div>
      </div>
      {menu && <ContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={() => setMenu(null)} />}
    </div>
  );
}
