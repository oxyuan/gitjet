import { useCallback, useEffect, useRef, useState } from "react";
import { Channel } from "mygo-runtime";
import {
  Git,
  Workspace,
  events,
  type Bootstrap,
  type ChangesSnapshot,
  type CommitFile,
  type Commit,
  type CommitDetail,
  type ConflictContent,
  type DiffOptions,
  type FetchOptions,
  type FileDiff,
  type LogResult,
  type PushOptions,
  type RefsSnapshot,
  type Remote,
  type RepoState,
  type Settings,
  type SourceFile,
} from "./mygo";
import { CommitPanel, type CommitActions, type CommitForm, type FileEntry } from "./CommitPanel";
import { ConflictView } from "./ConflictView";
import { ConsolePanel } from "./ConsolePanel";
import { DiffView, BlameView } from "./DiffView";
import {
  ChangelistDialog,
  MergeDialog,
  NewBranchDialog,
  PullDialog,
  PushDialog,
  ResetDialog,
  SettingsDialog,
  StashDialog,
  TagDialog,
} from "./Dialogs";
import { Icon } from "./icons";
import { LangProvider, count, resolveLang, useT, type Lang } from "./i18n";
import { LogDock } from "./LogDock";
import { FileTree, type ChangeView } from "./FileTree";
import { BranchList } from "./BranchList";
import type { AuthorOption } from "./AuthorPicker";
import { OperationDock, type OperationState } from "./OperationDock";
import { QuickOpen } from "./QuickOpen";
import { SourceView } from "./SourceView";
import {
  Button,
  ConfirmDialog,
  ContextMenu,
  cx,
  formatStamp,
  IconButton,
  Spinner,
  Splitter,
  StatusMark,
  Toast,
  useStoredState,
} from "./ui";
import type { BlameResult } from "./mygo";

const T = {
  en: {
    starting: "Starting GitJet",
    openRepo: "Open Repository (⌘/Ctrl+O)",
    refresh: "Refresh (⌘/Ctrl+R)",
    fetchTooltip: "Fetch (right-click for options)",
    updateProject: "Update Project (⌘/Ctrl+T)",
    pushTip: "Push (⌘/Ctrl+Shift+K)",
    branches: "Branches",
    detachedAt: "detached at {ref}",
    noCommitsParen: "(no commits)",
    noRepository: "No repository",
    quickOpenTip: "Quick Open (⌘/Ctrl+P)",
    searchFiles: "Search files",
    settingsTip: "Settings (⌘/Ctrl+,)",
    commitTab: "Commit",
    branchTab: "Branch",
    consoleTab: "Console",
    historyOf: "History of {path}",
    clear: "Clear",
    detachedHead: "Detached HEAD",
    noCommitsYet: "No commits yet",
    pushOne: "Push {n} commit",
    pushOther: "Push {n} commits",
    pullOne: "Pull {n} commit from the remote",
    pullOther: "Pull {n} commits from the remote",
    conflictOne: "{n} conflict",
    conflictOther: "{n} conflicts",
    changed: "{n} changed",
    staged: "{n} staged",
    untracked: "{n} untracked",
    continueOp: "Continue",
    abort: "Abort",
    merging: "Merging",
    rebasing: "Rebasing",
    interactiveRebase: "Interactive rebase",
    cherryPicking: "Cherry-picking",
    reverting: "Reverting",
    applyingPatches: "Applying patches",
    bisecting: "Bisecting",
    readLog: "Could not read the log",
    readCommit: "Could not read the commit",
    refreshRepo: "Could not refresh the repository",
    reopenRepo: "Could not reopen the last repository",
    startFailed: "GitJet could not start",
    openRepoFailed: "Could not open the repository",
    showDiffFailed: "Could not show the diff",
    openFileFailed: "Could not open the file",
    openConflictFailed: "Could not open the conflict",
    readStash: "Could not read the stash",
    annotateFailed: "Could not annotate the file",
    copyFailed: "Could not copy",
    gitFailed: "Git command failed",
    deleteBranchFailed: "Could not delete the branch",
    revealFailed: "Could not reveal the file",
    saveSettingsFailed: "Could not save settings",
    lastCommitMessage: "Could not read the last commit message",
    done: "Done",
    conflictDoc: "Conflict: {path}",
    stashDoc: "Stash: {subject}",
    annotationsDoc: "Annotations: {path}",
    closeRepoTitle: "Close Repository",
    closeRepoMessage: "Close this repository and return to the welcome screen?",
    close: "Close",
    rollbackChangesTitle: "Rollback Changes",
    rollbackFilesOne: "Discard local changes to {n} file?",
    rollbackFilesOther: "Discard local changes to {n} files?",
    rollbackChangesDetail: "The files are restored from HEAD. This cannot be undone.",
    rollback: "Rollback",
    deleteFilesTitle: "Delete Files",
    deleteFilesOne: "Delete {n} untracked file?",
    deleteFilesOther: "Delete {n} untracked files?",
    deleteFilesDetail: "The files are removed from disk. This cannot be undone.",
    delete: "Delete",
    rollbackFileTitle: "Rollback File",
    rollbackFileMessage: "Discard all changes to {path}?",
    forcePushTitle: "Force Push",
    forcePushMessage: "Force push rewrites the remote branch. Continue?",
    forcePushDetail: "{ref} will be updated with --force-with-lease.",
    currentBranch: "current branch",
    deleteBranchTitle: "Delete Branch",
    deleteBranchCurrentTitle: "Delete Current Branch",
    deleteBranchMessage: "Delete branch “{name}”?",
    deleteBranchCurrentDetail: "You are on this branch. Git will refuse to delete the checked out branch.",
    branchNotMergedTitle: "Branch Not Merged",
    branchNotMergedMessage: "“{name}” has commits that are not merged. Delete it anyway?",
    forceDelete: "Force Delete",
    hardResetTitle: "Hard Reset",
    hardResetMessage: "Discard every local change and move the branch?",
    cannotUndo: "This cannot be undone.",
    resetHard: "Reset Hard",
    rebaseTitle: "Rebase Branch",
    rebaseMessage: "Rebase “{branch}” onto “{onto}”?",
    rebaseDetail: "Local commits are replayed on top of that branch.",
    rebase: "Rebase",
    revertTitle: "Revert Commit",
    revertMessage: "Create a commit that undoes {hash}?",
    revert: "Revert",
    dropStashTitle: "Drop Stash",
    dropStashMessage: "Delete stash@{index}?",
    drop: "Drop",
    abortTitle: "Abort Operation",
    abortMessage: "Abort the {op} operation and restore the previous state?",
    abortMessageCurrent: "Abort the current operation and restore the previous state?",
    deleteChangelistTitle: "Delete Changelist",
    deleteChangelistMessage: "Delete “{name}”? Its files move to the default changelist.",
    addedToGitignore: "Added to .gitignore",
    nothingToCommit: "Nothing to commit",
    nothingToCommitMessage: "Check at least one file in the commit panel.",
    commitNeedsMessage: "A commit needs a message",
    commitFailed: "Commit failed",
    committed: "Committed {hash}",
    checkedOut: "Checked out",
    branchDeleted: "Branch deleted",
    branchReset: "Branch reset ({mode})",
    merged: "Merged",
    rebaseFinished: "Rebase finished",
    cherryPicked: "Cherry-picked",
    reverted: "Reverted",
    tagCreated: "Tag created",
    changesStashed: "Changes stashed",
    stashPopped: "Stash popped",
    stashApplied: "Stash applied",
    operationContinued: "Operation continued",
    operationAborted: "Operation aborted",
    tookOurs: "Took ours",
    tookTheirs: "Took theirs",
    settingsSaved: "Settings saved",
    conflictResolved: "Conflict resolved",
    markedResolved: "Marked resolved",
    branchCreated: "Branch created",
    fetchAllRemotes: "Fetch all remotes",
    fetchOrigin: "Fetch origin",
    pruneBranches: "Prune deleted branches",
    fetchTags: "Fetch tags",
    operationPush: "Push",
    operationPull: "Update Project",
    operationFetch: "Fetch",
    noRepoMessage: "Open a Git repository to get started.",
    openRepoEllipsis: "Open Repository…",
    welcomeHeadline: "Git, with a clearer view.",
    welcomeTagline:
      "Review changes, follow every branch, and resolve conflicts line by line — then land a clean commit without leaving the window.",
    openRepository: "Open repository",
    recentRepositories: "Recent repositories",
    removeFromRecent: "Remove from recent",
    hintOpen: "Open",
    hintQuickOpen: "Quick open",
    hintCommit: "Commit",
    hintPush: "Push",
    hintUpdate: "Update",
    noFileOpen: "No file open",
    emptyOpen: "Pick a change on the left to see its diff, or a commit below to read its details.",
    emptyQuickOpen: "Search every file with",
    kindDiff: "Diff",
    kindSource: "Source",
    kindMerge: "Merge",
    kindBlame: "Blame",
    kindCommit: "Commit",
    mergeTab: "Merge: {name}",
    blameTab: "Blame: {name}",
    copyHash: "Copy hash",
    filesChanged: "{n} files changed",
    openSourceAtCommit: "Open the source file at this commit",
    showFileHistory: "Show file history",
    title: "{name} – GitJet",
    repoFallback: "Repository",
  },
  zh: {
    starting: "正在启动 GitJet",
    openRepo: "打开仓库 (⌘/Ctrl+O)",
    refresh: "刷新 (⌘/Ctrl+R)",
    fetchTooltip: "获取（右键查看选项）",
    updateProject: "更新项目 (⌘/Ctrl+T)",
    pushTip: "推送 (⌘/Ctrl+Shift+K)",
    branches: "分支",
    detachedAt: "分离于 {ref}",
    noCommitsParen: "（无提交）",
    noRepository: "未打开仓库",
    quickOpenTip: "快速打开 (⌘/Ctrl+P)",
    searchFiles: "搜索文件",
    settingsTip: "设置 (⌘/Ctrl+,)",
    commitTab: "提交",
    branchTab: "分支",
    consoleTab: "控制台",
    historyOf: "{path} 的历史",
    clear: "清除",
    detachedHead: "分离的 HEAD",
    noCommitsYet: "暂无提交",
    pushOne: "推送 {n} 个提交",
    pushOther: "推送 {n} 个提交",
    pullOne: "从远程拉取 {n} 个提交",
    pullOther: "从远程拉取 {n} 个提交",
    conflictOne: "{n} 个冲突",
    conflictOther: "{n} 个冲突",
    changed: "{n} 项更改",
    staged: "{n} 项已暂存",
    untracked: "{n} 个未跟踪文件",
    continueOp: "继续",
    abort: "中止",
    merging: "合并中",
    rebasing: "变基中",
    interactiveRebase: "交互式变基",
    cherryPicking: "拣选提交中",
    reverting: "还原中",
    applyingPatches: "应用补丁中",
    bisecting: "二分查找中",
    readLog: "无法读取日志",
    readCommit: "无法读取提交",
    refreshRepo: "无法刷新仓库",
    reopenRepo: "无法重新打开上次的仓库",
    startFailed: "GitJet 无法启动",
    openRepoFailed: "无法打开仓库",
    showDiffFailed: "无法显示差异",
    openFileFailed: "无法打开文件",
    openConflictFailed: "无法打开冲突文件",
    readStash: "无法读取贮藏",
    annotateFailed: "无法查看文件注解",
    copyFailed: "无法复制",
    gitFailed: "Git 命令失败",
    deleteBranchFailed: "无法删除分支",
    revealFailed: "无法在文件管理器中显示该文件",
    saveSettingsFailed: "无法保存设置",
    lastCommitMessage: "无法读取上一条提交信息",
    done: "完成",
    conflictDoc: "冲突：{path}",
    stashDoc: "贮藏：{subject}",
    annotationsDoc: "注解：{path}",
    closeRepoTitle: "关闭仓库",
    closeRepoMessage: "关闭此仓库并返回欢迎界面？",
    close: "关闭",
    rollbackChangesTitle: "回滚更改",
    rollbackFilesOne: "放弃对 {n} 个文件的本地更改？",
    rollbackFilesOther: "放弃对 {n} 个文件的本地更改？",
    rollbackChangesDetail: "文件将从 HEAD 恢复。此操作无法撤销。",
    rollback: "回滚",
    deleteFilesTitle: "删除文件",
    deleteFilesOne: "删除 {n} 个未跟踪文件？",
    deleteFilesOther: "删除 {n} 个未跟踪文件？",
    deleteFilesDetail: "文件将从磁盘删除。此操作无法撤销。",
    delete: "删除",
    rollbackFileTitle: "回滚文件",
    rollbackFileMessage: "放弃对 {path} 的所有更改？",
    forcePushTitle: "强制推送",
    forcePushMessage: "强制推送会重写远程分支。是否继续？",
    forcePushDetail: "{ref} 将使用 --force-with-lease 更新。",
    currentBranch: "当前分支",
    deleteBranchTitle: "删除分支",
    deleteBranchCurrentTitle: "删除当前分支",
    deleteBranchMessage: "删除分支“{name}”？",
    deleteBranchCurrentDetail: "你当前位于该分支。Git 将拒绝删除已检出的分支。",
    branchNotMergedTitle: "分支未合并",
    branchNotMergedMessage: "“{name}”包含尚未合并的提交。仍要删除吗？",
    forceDelete: "强制删除",
    hardResetTitle: "硬重置",
    hardResetMessage: "放弃所有本地更改并移动分支？",
    cannotUndo: "此操作无法撤销。",
    resetHard: "硬重置",
    rebaseTitle: "变基分支",
    rebaseMessage: "将“{branch}”变基到“{onto}”上？",
    rebaseDetail: "本地提交将重放到该分支之上。",
    rebase: "变基",
    revertTitle: "还原提交",
    revertMessage: "创建一个撤销 {hash} 的提交？",
    revert: "还原",
    dropStashTitle: "删除贮藏",
    dropStashMessage: "删除 stash@{index}？",
    drop: "删除",
    abortTitle: "中止操作",
    abortMessage: "中止 {op} 操作并恢复之前的状态？",
    abortMessageCurrent: "中止当前操作并恢复之前的状态？",
    deleteChangelistTitle: "删除变更列表",
    deleteChangelistMessage: "删除“{name}”？其中的文件将移至默认变更列表。",
    addedToGitignore: "已添加到 .gitignore",
    nothingToCommit: "没有可提交的内容",
    nothingToCommitMessage: "请在提交面板中至少勾选一个文件。",
    commitNeedsMessage: "提交需要填写提交信息",
    commitFailed: "提交失败",
    committed: "已提交 {hash}",
    checkedOut: "已检出",
    branchDeleted: "分支已删除",
    branchReset: "分支已重置（{mode}）",
    merged: "已合并",
    rebaseFinished: "变基完成",
    cherryPicked: "已拣选提交",
    reverted: "已还原",
    tagCreated: "标签已创建",
    changesStashed: "更改已贮藏",
    stashPopped: "已恢复贮藏（pop）",
    stashApplied: "已应用贮藏",
    operationContinued: "操作已继续",
    operationAborted: "操作已中止",
    tookOurs: "已采用我方",
    tookTheirs: "已采用对方",
    settingsSaved: "设置已保存",
    conflictResolved: "冲突已解决",
    markedResolved: "已标记为已解决",
    branchCreated: "分支已创建",
    fetchAllRemotes: "获取所有远程",
    fetchOrigin: "获取 origin",
    pruneBranches: "清理已删除的分支",
    fetchTags: "获取标签",
    operationPush: "推送",
    operationPull: "更新项目",
    operationFetch: "获取",
    noRepoMessage: "打开一个 Git 仓库以开始使用。",
    openRepoEllipsis: "打开仓库…",
    welcomeHeadline: "Git，看得更清楚。",
    welcomeTagline: "审查更改、跟踪每个分支、逐行解决冲突，然后不离开窗口就能完成一次干净的提交。",
    openRepository: "打开仓库",
    recentRepositories: "最近的仓库",
    removeFromRecent: "从最近列表中移除",
    hintOpen: "打开",
    hintQuickOpen: "快速打开",
    hintCommit: "提交",
    hintPush: "推送",
    hintUpdate: "更新",
    noFileOpen: "没有打开的文件",
    emptyOpen: "在左侧选择一项变更查看差异，或在下方选择提交查看详情。",
    emptyQuickOpen: "搜索任意文件",
    kindDiff: "差异",
    kindSource: "源码",
    kindMerge: "合并",
    kindBlame: "注解",
    kindCommit: "提交",
    mergeTab: "合并：{name}",
    blameTab: "注解：{name}",
    copyHash: "复制哈希",
    filesChanged: "{n} 个文件已更改",
    openSourceAtCommit: "打开该提交下的源文件",
    showFileHistory: "查看文件历史",
    title: "{name} – GitJet",
    repoFallback: "仓库",
  },
} as const;

type TKey = keyof typeof T["en"];
type Translate = (key: TKey, vars?: Record<string, string | number>) => string;

type Tab = "commit" | "branch" | "console";

/** "all", "current", or the name of a branch. */

type Doc = { id: string; title: string } & (
  | { kind: "diff"; diff: FileDiff; opts: DiffOptions }
  | { kind: "file"; file: SourceFile; revision: string }
  | { kind: "conflict"; path: string; content: ConflictContent }
  | { kind: "blame"; path: string; data: BlameResult }
  | { kind: "commit"; detail: CommitDetail }
);

type Dialog =
  | { kind: "settings" }
  | { kind: "newBranch"; start: string }
  | { kind: "renameBranch"; name: string }
  | { kind: "push"; setUpstream: boolean }
  | { kind: "pull" }
  | { kind: "reset"; hash: string; subject: string }
  | { kind: "tag"; start: string }
  | { kind: "stash" }
  | { kind: "changelist"; mode: "new" | "rename"; id?: string; name?: string; comment?: string }
  | { kind: "merge"; refs: string[] };

interface ConfirmState {
  title: string;
  message: string;
  detail?: string;
  confirmLabel?: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

const emptyForm: CommitForm = {
  message: "",
  amend: false,
  signOff: false,
  noVerify: false,
  authorName: "",
  authorEmail: "",
};

export default function App() {
  const [lang, setLang] = useState<Lang>(() => resolveLang("system"));
  return (
    <LangProvider lang={lang}>
      <AppShell onLangChange={setLang} />
    </LangProvider>
  );
}

function AppShell({ onLangChange }: { onLangChange: (lang: Lang) => void }) {
  const t = useT(T);
  const [boot, setBoot] = useState<Bootstrap | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [snapshot, setSnapshot] = useState<ChangesSnapshot | null>(null);
  const [refs, setRefs] = useState<RefsSnapshot | null>(null);
  const [remotes, setRemotes] = useState<Remote[]>([]);
  // Tabs were renamed once; keep an old stored "log" pointing at the branch page.
  const [storedTab, setStoredTab] = useStoredState<Tab | "log">("gitjet.tab", "commit");
  const tab: Tab = storedTab === "log" ? "branch" : storedTab;
  const setTab = (next: Tab) => setStoredTab(next);
  const [docs, setDocs] = useState<Doc[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [quickOpen, setQuickOpen] = useState(false);
  const [busy, setBusy] = useState(0);
  const [toast, setToast] = useState<{ kind: "info" | "success" | "error"; title: string; message?: string } | null>(null);
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [op, setOp] = useState<OperationState | null>(null);
  const [opOpen, setOpOpen] = useState(false);
  const [fetchMenu, setFetchMenu] = useState<{ x: number; y: number } | null>(null);
  const [fetchOptions, setFetchOptions] = useStoredState("gitjet.fetchOptions", { prune: true, tags: true });
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);
  const [splitWidth, setSplitWidth] = useStoredState<number>("gitjet.split", 430);
  const [diffMode, setDiffMode] = useStoredState<"split" | "unified">("gitjet.diffMode", "split");
  const [diffWrap, setDiffWrap] = useStoredState<boolean>("gitjet.diffWrap", true);
  const [ignoreWhitespace, setIgnoreWhitespace] = useState(false);
  const [form, setForm] = useState<CommitForm>(emptyForm);
  const [history, setHistory] = useState<string[]>([]);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [searchInput, setSearchInput] = useState("");
  const [logSearch, setLogSearch] = useState("");
  const [logAuthor, setLogAuthor] = useState("");
  const [authors, setAuthors] = useState<AuthorOption[]>([]);
  const [favorites, setFavorites] = useState<string[]>([]);
  const [logDetail, setLogDetail] = useState<CommitDetail | null>(null);
  const [logFile, setLogFile] = useState<string | null>(null);
  const [logDockHeight, setLogDockHeight] = useStoredState<number>("gitjet.logDock", 300);
  const [logInfoRatio, setLogInfoRatio] = useStoredState<number>("gitjet.logInfoRatio", 0.52);
  const [logDockFolded, setLogDockFolded] = useStoredState<boolean>("gitjet.logDockFolded", false);
  // The changelist and the commit details are read at different times, so
  // each keeps its own view.
  const [changeView, setChangeView] = useStoredState<ChangeView>("gitjet.changeView", "tree");
  const [detailView, setDetailView] = useStoredState<ChangeView>("gitjet.detailView", "tree");
  const [showStaged, setShowStaged] = useStoredState<boolean>("gitjet.showStaged", false);
  const [showStashes, setShowStashes] = useStoredState<boolean>("gitjet.showStashes", false);
  const [logPath, setLogPath] = useState("");
  // Branch whose history is listed; "" follows the checked out branch.
  const [logRef, setLogRef] = useState("");
  const [logResult, setLogResult] = useState<LogResult | null>(null);
  const [logLoading, setLogLoading] = useState(false);
  const [selectedCommit, setSelectedCommit] = useState<string | null>(null);
  const [diffBusy, setDiffBusy] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  const knownPaths = useRef<Set<string>>(new Set());
  const settingsRef = useRef<Settings | null>(null);
  const snapshotRef = useRef<ChangesSnapshot | null>(null);
  const docsRef = useRef<Doc[]>([]);
  const activeIdRef = useRef<string | null>(null);
  const repoOpenRef = useRef(false);
  const refreshRef = useRef<(() => void) | null>(null);
  const amendBackup = useRef("");
  const logReq = useRef(0);
  // Author counts come from the unfiltered list so the menu stays complete
  // while a filter is applied.
  const authorCache = useRef<Map<string, AuthorOption>>(new Map());
  const opLines = useRef<string[]>([]);
  const tRef = useRef(t);
  tRef.current = t;

  const repoOpen = !!snapshot;
  const branch = snapshot?.state.branch ?? "";
  const state = snapshot?.state;

  settingsRef.current = settings;
  snapshotRef.current = snapshot;
  docsRef.current = docs;
  activeIdRef.current = activeId;
  const activeDoc = docs.find((d) => d.id === activeId) ?? null;

  const notify = useCallback((kind: "info" | "success" | "error", title: string, message?: string) => {
    setToast({ kind, title, message });
  }, []);

  const fail = useCallback(
    (title: string, err: unknown) => {
      notify("error", title, err instanceof Error ? err.message : String(err));
    },
    [notify],
  );

  const ask = (opts: Omit<ConfirmState, "onConfirm" | "onCancel">) =>
    new Promise<boolean>((resolve) => {
      setConfirm({
        ...opts,
        onConfirm: () => {
          setConfirm(null);
          resolve(true);
        },
        onCancel: () => {
          setConfirm(null);
          resolve(false);
        },
      });
    });

  const applyCheckedDefaults = useCallback((snap: ChangesSnapshot) => {
    const eligible = new Set<string>();
    for (const c of snap.changes) {
      if (c.unmerged || c.kind === "ignored" || c.kind === "conflict") continue;
      eligible.add(c.path);
    }
    const known = knownPaths.current;
    setChecked((prev) => {
      const next = new Set<string>();
      for (const p of eligible) {
        if (!known.has(p) || prev.has(p)) next.add(p);
      }
      return next;
    });
    knownPaths.current = eligible;
  }, []);

  const loadLog = useCallback(
    async (reset: boolean, append = false) => {
      if (!repoOpenRef.current) return;
      const current = snapshotRef.current;
      if (!current) return;
      const req = ++logReq.current;
      setLogLoading(true);
      try {
        const s = settingsRef.current;
        const opts = {
          // No filter means every local and remote branch, not just HEAD.
          all: !logRef,
          refs: logRef ? [logRef] : [],
          path: logPath,
          search: logSearch,
          author: logAuthor,
          since: 0,
          limit: 300,
          skip: reset ? 0 : logResult?.commits.length ?? 0,
          firstParent: false,
        };
        const result = await Git.log(opts);
        if (req !== logReq.current) return;
        setLogResult((prev) =>
          append && !reset && prev ? { ...result, commits: [...prev.commits, ...result.commits] } : result,
        );
        if (logAuthor === "" || reset) {
          const seen = new Map<string, AuthorOption>();
          for (const c of result.commits) {
            const key = c.author + "\u0000" + c.authorEmail;
            const hit = seen.get(key);
            seen.set(key, { name: c.author, email: c.authorEmail, count: (hit?.count ?? 0) + 1 });
          }
          for (const author of authorCache.current.values()) {
            const key = author.name + "\u0000" + author.email;
            if (!seen.has(key)) seen.set(key, author);
          }
          authorCache.current = seen;
          setAuthors(
            [...seen.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)),
          );
        }
        if (reset && !append) setSelectedCommit(null);
        if (s) void s;
      } catch (err) {
        fail(t("readLog"), err);
      } finally {
        if (req === logReq.current) setLogLoading(false);
      }
    },
    [fail, logAuthor, logPath, logRef, logSearch, logResult?.commits.length, t],
  );

  const openDoc = useCallback((doc: Doc) => {
    setDocs((prev) => {
      const index = prev.findIndex((d) => d.id === doc.id);
      if (index === -1) return [...prev, doc];
      const next = [...prev];
      next[index] = doc;
      return next;
    });
    setActiveId(doc.id);
  }, []);

  const closeDoc = useCallback((id: string) => {
    setDocs((prev) => {
      const index = prev.findIndex((d) => d.id === id);
      if (index === -1) return prev;
      const next = prev.filter((d) => d.id !== id);
      if (activeIdRef.current === id) {
        const fallback = next[Math.min(index, next.length - 1)];
        setActiveId(fallback ? fallback.id : null);
      }
      return next;
    });
  }, []);

  /** One editor tab per commit: arrow keys switch the file inside it. */
  const openCommitFile = useCallback(
    async (hash: string, file: CommitFile) => {
      const opts: DiffOptions = {
        path: file.path,
        oldPath: file.oldPath ?? "",
        target: "commit",
        revision: hash,
        from: "",
        context: settingsRef.current?.diffContext ?? 3,
        ignoreWhitespace: false,
        ignoreWhitespaceEol: false,
        noText: false,
      };
      setLogFile(file.path);
      setDiffBusy(true);
      try {
        const diff = await Git.diff(opts);
        openDoc({ id: `commitfile:${hash}`, title: file.path, kind: "diff", diff, opts });
      } catch (err) {
        fail(t("showDiffFailed"), err);
      } finally {
        setDiffBusy(false);
      }
    },
    [fail, openDoc, t],
  );

  const stepCommitFile = (delta: number) => {
    const files = logDetail?.files ?? [];
    if (!logDetail || files.length === 0) return;
    const index = files.findIndex((f) => f.path === logFile);
    const at = (index < 0 ? 0 : index) + delta;
    const next = files[Math.min(files.length - 1, Math.max(0, at))];
    if (next && next.path !== logFile) void openCommitFile(logDetail.hash, next);
  };

  const reload = useCallback(
    async (spinner = true) => {
      if (!repoOpenRef.current) return;
      if (spinner) setBusy((n) => n + 1);
      try {
        const s = settingsRef.current;
        const [snap, r, rem] = await Promise.all([
          Git.changes(s?.showIgnored ?? false),
          Git.refs(),
          Git.remotes(),
        ]);
        setSnapshot(snap);
        snapshotRef.current = snap;
        setRefs(r);
        setRemotes(rem);
        applyCheckedDefaults(snap);
        const active = docsRef.current.find((d) => d.id === activeIdRef.current);
        if (active?.kind === "diff" && (active.opts.target === "worktree" || active.opts.target === "staged")) {
          setDiffBusy(true);
          Git.diff(active.opts)
            .then((diff) => setDocs((prev) => prev.map((d) => (d.id === active.id ? { ...d, diff } : d))))
            .catch(() => {})
            .finally(() => setDiffBusy(false));
        }
        if (active?.kind === "file" && active.revision === "") {
          Git.file(active.file.path, "")
            .then((file) => setDocs((prev) => prev.map((d) => (d.id === active.id ? { ...d, file } : d))))
            .catch(() => {});
        }
        setReloadKey((k) => k + 1);
      } catch (err) {
        fail(t("refreshRepo"), err);
      } finally {
        if (spinner) setBusy((n) => n - 1);
      }
    },
    [applyCheckedDefaults, fail],
  );

  refreshRef.current = () => {
    void reload(false);
  };

  // Boot: reopen the last repository and restore the tool window.
  useEffect(() => {
    Workspace.bootstrap()
      .then(async (b) => {
        setBoot(b);
        setSettings(b.settings);
        applyTheme(b.settings);
        if (b.repo) {
          setSnapshot(b.repo);
          snapshotRef.current = b.repo;
          repoOpenRef.current = true;
          setChecked(new Set());
          knownPaths.current = new Set();
          applyCheckedDefaults(b.repo);
          setHistory(await Git.messageHistory().catch(() => []));
          void reload(false);
        }
        if (b.error) notify("error", tRef.current("reopenRepo"), b.error);
      })
      .catch((err) => {
        setBoot({ settings: { gitPath: "", language: "system", theme: "system", diffContext: 3, ignoreWhitespace: false, showIgnored: false, autoFetch: false, autoFetchMinutes: 15, updateMethod: "merge", confirmForcePush: true, confirmRollback: true, openInNewWindow: false, uiScale: 100, recent: [] }, repo: null, error: String(err), version: "", platform: "" });
        notify("error", tRef.current("startFailed"), err instanceof Error ? err.message : String(err));
      });
  }, [applyCheckedDefaults, notify, reload]);

  // Changes made outside the app: git was run in a terminal, an editor
  // saved a file, or a hook rewrote the index.
  useEffect(() => {
    let timer: number | undefined;
    const off = events.repoChanged.on(() => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => refreshRef.current?.(), 120);
    });
    return () => {
      window.clearTimeout(timer);
      off();
    };
  }, []);

  // A tab opened earlier may be stale: refresh it when it becomes active.
  useEffect(() => {
    if (!activeId || !repoOpenRef.current) return;
    const doc = docsRef.current.find((d) => d.id === activeId);
    if (!doc) return;
    if (doc.kind === "diff" && (doc.opts.target === "worktree" || doc.opts.target === "staged")) {
      Git.diff(doc.opts)
        .then((diff) => setDocs((prev) => prev.map((d) => (d.id === doc.id ? { ...d, diff } : d))))
        .catch(() => {});
    } else if (doc.kind === "file" && doc.revision === "") {
      Git.file(doc.file.path, "")
        .then((file) => setDocs((prev) => prev.map((d) => (d.id === doc.id ? { ...d, file } : d))))
        .catch(() => {});
    }
  }, [activeId]);

  // Favourites live with the repository: the same branch name means something
  // else in another clone.
  const favoritesKey = snapshot ? `gitjet.branchFavorites:${snapshot.state.root}` : "";
  useEffect(() => {
    if (!favoritesKey) {
      setFavorites([]);
      return;
    }
    try {
      const raw = localStorage.getItem(favoritesKey);
      setFavorites(raw ? (JSON.parse(raw) as string[]) : []);
    } catch {
      setFavorites([]);
    }
  }, [favoritesKey]);

  const toggleFavorite = (key: string) => {
    setFavorites((prev) => {
      const next = prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key];
      try {
        if (favoritesKey) localStorage.setItem(favoritesKey, JSON.stringify(next));
      } catch {
        // Storage can be unavailable; the list still lives in memory.
      }
      return next;
    });
  };

  // Up and down walk the changed files of the selected commit; inside the
  // editor they keep scrolling, and on other tabs they only work while the
  // dock itself has focus.
  useEffect(() => {
    if (!logDetail) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
      if (e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return;
      const active = document.activeElement;
      if (active && active !== document.body && !active.closest(".log-dock")) return;
      if (tab !== "branch" && (!active || active === document.body)) return;
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) return;
      e.preventDefault();
      stepCommitFile(e.key === "ArrowDown" ? 1 : -1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [tab, logDetail, logFile, stepCommitFile]);

  // Debounce the log's search box.
  useEffect(() => {
    const timer = window.setTimeout(() => setLogSearch(searchInput), 250);
    return () => window.clearTimeout(timer);
  }, [searchInput]);

  // The log loads with the repository and reloads when its filters change;
  // its dock stays on screen on every tab.
  useEffect(() => {
    if (!snapshot) return;
    void loadLog(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [logAuthor, logSearch, logPath, logRef, snapshot?.state.head]);

  useEffect(() => {
    if (!snapshot) return;
    document.title = t("title", { name: snapshot.state.name || t("repoFallback") });
  }, [snapshot?.state.name, t]);

  function applyTheme(s: Settings) {
    document.documentElement.dataset.theme = s.theme;
    // One scale for the whole window, so code, tables and labels keep their
    // proportions instead of drifting apart.
    document.documentElement.style.zoom = `${(s.uiScale || 100) / 100}`;
    document.documentElement.lang = resolveLang(s.language);
    onLangChange(resolveLang(s.language));
    // A toast created before the switch would keep the old language.
    setToast(null);
    setIgnoreWhitespace(s.ignoreWhitespace);
  }

  const selectedCommitRef = useRef(selectedCommit);
  selectedCommitRef.current = selectedCommit;

  const openRepo = async (path?: string) => {
    // The picker can stay open for a while; spinning the toolbar meanwhile
    // says the app is working when it is only waiting for a folder.
    let chosen = path && path.trim() !== "" ? path.trim() : await Workspace.chooseFolder();
    if (!chosen) return;
    if (settingsRef.current?.openInNewWindow) {
      try {
        await Workspace.openInWindow(chosen);
      } catch (err) {
        fail(t("openRepoFailed"), err);
      }
      return;
    }
    setBusy((n) => n + 1);
    try {
      const snap = await Workspace.open(chosen);
      const freshSettings = await Workspace.settings();
      knownPaths.current = new Set();
      setChecked(new Set());
      setSnapshot(snap);
      snapshotRef.current = snap;
      repoOpenRef.current = true;
      settingsRef.current = freshSettings;
      applyCheckedDefaults(snap);
      setSettings(freshSettings);
      setTab("commit");
      setDocs([]);
      setActiveId(null);
      setForm(emptyForm);
      setLogResult(null);
      setSelectedCommit(null);
      setLogDetail(null);
      setLogFile(null);
      setLogPath("");
      setLogRef("");
      setSearchInput("");
      setLogSearch("");
      setLogAuthor("");
      authorCache.current = new Map();
      setHistory(await Git.messageHistory().catch(() => []));
      void reload(false);
      void loadLog(true);
    } catch (err) {
      fail(t("openRepoFailed"), err);
    } finally {
      setBusy((n) => n - 1);
    }
  };

  const closeRepo = async () => {
    const ok = await ask({
      title: t("closeRepoTitle"),
      message: t("closeRepoMessage"),
      confirmLabel: t("close"),
    });
    if (!ok) return;
    await Workspace.close();
    repoOpenRef.current = false;
    snapshotRef.current = null;
    setSnapshot(null);
    setRefs(null);
    setDocs([]);
    setActiveId(null);
    knownPaths.current = new Set();
    setChecked(new Set());
    document.title = "GitJet";
  };

  const showDiff = async (opts: DiffOptions, title: string) => {
    setDiffBusy(true);
    const id = `diff:${opts.target}:${opts.revision}:${opts.path}`;
    try {
      const diff = await Git.diff(opts);
      openDoc({ id, title, kind: "diff", diff, opts });
    } catch (err) {
      fail(t("showDiffFailed"), err);
    } finally {
      setDiffBusy(false);
    }
  };

  const showFile = async (path: string, revision = "") => {
    try {
      const file = await Git.file(path, revision);
      openDoc({
        id: `file:${revision || "worktree"}:${path}`,
        title: path,
        kind: "file",
        file,
        revision,
      });
    } catch (err) {
      fail(t("openFileFailed"), err);
    }
  };

  const diffOptionsForEntry = (entry: FileEntry): DiffOptions => ({
    path: entry.path,
    target: entry.staged ? "staged" : "worktree",
    revision: "",
    from: "",
    context: settings?.diffContext ?? 3,
    ignoreWhitespace,
    ignoreWhitespaceEol: false,
    noText: false,
  });

  const openEntryDiff = (entry: FileEntry) => {
    if (entry.unmerged) {
      void openConflict(entry.path);
      return;
    }
    void showDiff(diffOptionsForEntry(entry), entry.path);
  };

  const showFileDiff = async (path: string, revision: string) => {
    const context = settingsRef.current?.diffContext ?? 3;
    const base: DiffOptions = {
      path,
      target: "worktree",
      revision: "",
      from: "",
      context,
      ignoreWhitespace,
      ignoreWhitespaceEol: false,
      noText: false,
    };
    if (revision === "" || revision === "WORKTREE" || revision === "HEAD") {
      await showDiff({ ...base, target: "worktree" }, path);
    } else if (revision === "INDEX") {
      await showDiff({ ...base, target: "staged" }, path);
    } else {
      await showDiff({ ...base, target: "commit", revision }, path);
    }
  };

  const openConflict = async (path: string) => {
    try {
      const content = await Git.conflict(path);
      openDoc({ id: `conflict:${path}`, title: t("conflictDoc", { path }), kind: "conflict", path, content });
    } catch (err) {
      fail(t("openConflictFailed"), err);
    }
  };

  const openNextConflict = () => {
    const remaining = snapshotRef.current?.conflicts ?? [];
    if (remaining[0]) void openConflict(remaining[0].path);
  };

  const openStash = async (index: number) => {
    try {
      const detail = await Git.showCommit(`stash@{${index}}`);
      openDoc({ id: `commit:${detail.hash}`, title: t("stashDoc", { subject: detail.subject }), kind: "commit", detail });
    } catch (err) {
      fail(t("readStash"), err);
    }
  };

  const openBlame = async (path: string) => {
    try {
      const data = await Git.blame(path);
      openDoc({ id: `blame:${path}`, title: t("annotationsDoc", { path }), kind: "blame", path, data });
    } catch (err) {
      fail(t("annotateFailed"), err);
    }
  };

  const toggleWhitespace = () => {
    const next = !ignoreWhitespace;
    setIgnoreWhitespace(next);
    const active = docsRef.current.find((d) => d.id === activeIdRef.current);
    if (active?.kind === "diff") {
      void showDiff({ ...active.opts, ignoreWhitespace: next }, active.title);
    }
  };

  const copyText = (text: string) => {
    void Workspace.copy(text).catch((err) => fail(t("copyFailed"), err));
  };

  const withBusy = async <T,>(fn: () => Promise<T>, label = t("gitFailed")): Promise<T | undefined> => {
    setBusy((n) => n + 1);
    try {
      return await fn();
    } catch (err) {
      fail(label, err);
      return undefined;
    } finally {
      setBusy((n) => n - 1);
    }
  };

  const stage = (paths: string[]) =>
    withBusy(async () => {
      await Git.stage(paths);
      await reload(false);
    });

  const unstage = (paths: string[]) =>
    withBusy(async () => {
      await Git.unstage(paths);
      await reload(false);
    });

  const rollback = async (paths: string[]) => {
    if (settings?.confirmRollback) {
      const ok = await ask({
        title: t("rollbackChangesTitle"),
        message: count(paths.length, t("rollbackFilesOne", { n: paths.length }), t("rollbackFilesOther", { n: paths.length })),
        detail: t("rollbackChangesDetail"),
        confirmLabel: t("rollback"),
        danger: true,
      });
      if (!ok) return;
    }
    await withBusy(async () => {
      await Git.rollback(paths);
      await reload(false);
    });
  };

  const deleteUntracked = async (paths: string[]) => {
    const ok = await ask({
      title: t("deleteFilesTitle"),
      message: count(paths.length, t("deleteFilesOne", { n: paths.length }), t("deleteFilesOther", { n: paths.length })),
      detail: t("deleteFilesDetail"),
      confirmLabel: t("delete"),
      danger: true,
    });
    if (!ok) return;
    await withBusy(async () => {
      await Git.deleteUntracked(paths);
      await reload(false);
    });
  };

  const ignorePaths = (paths: string[]) =>
    withBusy(async () => {
      const file = await Git.ignore(paths);
      notify("success", t("addedToGitignore"), file);
      await reload(false);
    });

  const applyHunk = (opts: DiffOptions, hunk: number, action: "stage" | "unstage" | "rollback") =>
    withBusy(async () => {
      await Git.applyHunk(opts, hunk, action);
      await reload(false);
      const diff = await Git.diff(opts);
      openDoc({ id: `diff:${opts.target}:${opts.revision}:${opts.path}`, title: opts.path, kind: "diff", diff, opts });
    });

  const applyFile = async (opts: DiffOptions, action: "stage" | "unstage" | "rollback") => {
    if (action === "rollback") {
      const ok = await ask({
        title: t("rollbackFileTitle"),
        message: t("rollbackFileMessage", { path: opts.path }),
        confirmLabel: t("rollback"),
        danger: true,
      });
      if (!ok) return;
    }
    await withBusy(async () => {
      await Git.applyFile(opts, action);
      await reload(false);
      try {
        const diff = await Git.diff(opts);
        openDoc({ id: `diff:${opts.target}:${opts.revision}:${opts.path}`, title: opts.path, kind: "diff", diff, opts });
      } catch {
        closeDoc(`diff:${opts.target}:${opts.revision}:${opts.path}`);
      }
    });
  };

  const commit = async (pushAfter: boolean) => {
    if (!snapshot) return;
    const eligible = new Set<string>();
    for (const c of snapshot.changes) {
      if (c.unmerged || c.kind === "ignored" || c.kind === "conflict") continue;
      eligible.add(c.path);
    }
    const paths = [...checked].filter((p) => eligible.has(p));
    if (paths.length === 0 && !form.amend) {
      notify("error", t("nothingToCommit"), t("nothingToCommitMessage"));
      return;
    }
    if (form.message.trim() === "" && !form.amend) {
      notify("error", t("commitNeedsMessage"));
      return;
    }
    const ok = await withBusy(async () => {
      const result = await Git.commit({
        message: form.message,
        paths,
        amend: form.amend,
        signOff: form.signOff,
        noVerify: form.noVerify,
        authorName: form.authorName,
        authorEmail: form.authorEmail,
      });
      return result;
    }, t("commitFailed"));
    if (!ok) return;
    notify("success", t("committed", { hash: ok.short }), ok.subject);
    setForm((f) => ({ ...f, message: "", amend: false }));
    amendBackup.current = "";
    setHistory(await Git.messageHistory().catch(() => []));
    await reload(false);
    void loadLog(true);
    if (pushAfter) {
      setDialog({ kind: "push", setUpstream: !snapshot.state.upstream });
    }
  };

  const toggleAmend = async (amend: boolean) => {
    if (amend && !form.amend) {
      amendBackup.current = form.message;
      try {
        const message = await Git.lastCommitMessage();
        setForm((f) => ({ ...f, amend: true, message }));
      } catch (err) {
        fail(t("lastCommitMessage"), err);
        setForm((f) => ({ ...f, amend: true }));
      }
    } else if (!amend) {
      setForm((f) => ({ ...f, amend: false, message: amendBackup.current || f.message }));
    }
  };

  const runOperation = async (
    title: string,
    icon: OperationState["icon"],
    fn: (channel: Channel<string>) => Promise<string>,
  ) => {
    opLines.current = [];
    setOp({ title, icon, lines: [], running: true });
    setOpOpen(false);
    const update = (patch: Partial<OperationState>) => {
      setOp((prev) => (prev ? { ...prev, ...patch, lines: [...opLines.current] } : prev));
    };
    const channel = new Channel<string>();
    try {
      const promise = fn(channel);
      for await (const line of channel) {
        opLines.current.push(line);
        if (opLines.current.length > 2000) opLines.current.splice(0, opLines.current.length - 2000);
        update({});
      }
      const out = await promise;
      const first = out
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean)
        .pop();
      update({ running: false, success: first || t("done") });
    } catch (err) {
      update({ running: false, error: err instanceof Error ? err.message : String(err) });
    }
    await reload(false);
    void loadLog(true);
  };

  const push = async (opts: PushOptions) => {
    if (opts.forceWithLease && (settingsRef.current?.confirmForcePush ?? true)) {
      const ok = await ask({
        title: t("forcePushTitle"),
        message: t("forcePushMessage"),
        detail: t("forcePushDetail", {
          ref: `${opts.remote || "origin"}/${opts.branch || t("currentBranch")}`,
        }),
        confirmLabel: t("forcePushTitle"),
        danger: true,
      });
      if (!ok) return;
    }
    setDialog(null);
    void runOperation(t("operationPush"), "push", (ch) => Git.push(opts, ch));
  };

  const pull = (opts: Parameters<typeof Git.pull>[0]) => {
    setDialog(null);
    void runOperation(t("operationPull"), "pull", (ch) => Git.pull(opts, ch)).then(openNextConflict);
  };

  // Fetch has no dialog: the toolbar fetches at once and keeps the options,
  // which a right click cycles through, in the background.
  const fetch = (opts?: FetchOptions) => {
    setFetchMenu(null);
    void runOperation(t("operationFetch"), "fetch", (ch) =>
      Git.fetch(
        opts ?? { all: true, remote: "", prune: fetchOptions.prune, tags: fetchOptions.tags },
        ch,
      ),
    );
  };

  const checkout = async (ref: string) => {
    const out = await withBusy(() => Git.checkout(ref));
    if (out !== undefined) {
      notify("success", t("checkedOut"), ref);
      setLogRef("");
      await reload(false);
      void loadLog(true);
    }
  };

  // Both act on the branch the user pointed at: a pull takes the checked out
  // branch and its upstream, a push names the branch explicitly.
  const branchRemote = (upstream: string) => (upstream.includes("/") ? upstream.slice(0, upstream.indexOf("/")) : "origin");

  const pullBranch = (leaf: { name: string; upstream: string }) => {
    const remote = branchRemote(leaf.upstream);
    const branch = leaf.upstream.startsWith(remote + "/") ? leaf.upstream.slice(remote.length + 1) : leaf.upstream;
    pull({
      remote,
      branch: branch || leaf.name,
      rebase: settingsRef.current?.updateMethod === "rebase",
      autostash: true,
      prune: false,
      tags: false,
    });
  };

  const pushBranch = (leaf: { name: string; upstream: string }) => {
    push({
      remote: branchRemote(leaf.upstream),
      branch: leaf.name,
      setUpstream: leaf.upstream === "",
      forceWithLease: false,
      tags: false,
      dryRun: false,
    });
  };

  const deleteBranch = async (name: string) => {
    const isCurrent = name === branch;
    const ok = await ask({
      title: isCurrent ? t("deleteBranchCurrentTitle") : t("deleteBranchTitle"),
      message: t("deleteBranchMessage", { name }),
      detail: isCurrent ? t("deleteBranchCurrentDetail") : undefined,
      confirmLabel: t("delete"),
      danger: true,
    });
    if (!ok) return;
    try {
      await Git.deleteBranch(name, false);
      notify("success", t("branchDeleted"), name);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (/not fully merged/i.test(message)) {
        const force = await ask({
          title: t("branchNotMergedTitle"),
          message: t("branchNotMergedMessage", { name }),
          detail: message,
          confirmLabel: t("forceDelete"),
          danger: true,
        });
        if (!force) return;
        await withBusy(() => Git.deleteBranch(name, true));
      } else {
        fail(t("deleteBranchFailed"), err);
        return;
      }
    }
    await reload(false);
    void loadLog(true);
  };

  const reset = async (hash: string, mode: "soft" | "mixed" | "hard") => {
    setDialog(null);
    if (mode === "hard") {
      const ok = await ask({
        title: t("hardResetTitle"),
        message: t("hardResetMessage"),
        detail: t("cannotUndo"),
        confirmLabel: t("resetHard"),
        danger: true,
      });
      if (!ok) return;
    }
    await withBusy(async () => {
      await Git.reset(hash, mode);
      notify("success", t("branchReset", { mode }));
      await reload(false);
      void loadLog(true);
    });
  };

  const merge = async (ref: string, opts: Parameters<typeof Git.merge>[1]) => {
    setDialog(null);
    await withBusy(async () => {
      const out = await Git.merge(ref, opts);
      notify("success", t("merged"), out.split("\n")[0]);
      await reload(false);
      openNextConflict();
      void loadLog(true);
    });
  };

  const rebase = async (onto: string) => {
    const ok = await ask({
      title: t("rebaseTitle"),
      message: t("rebaseMessage", { branch: branch || "HEAD", onto }),
      detail: t("rebaseDetail"),
      confirmLabel: t("rebase"),
    });
    if (!ok) return;
    await withBusy(async () => {
      await Git.rebase(onto, true);
      notify("success", t("rebaseFinished"));
      await reload(false);
      openNextConflict();
      void loadLog(true);
    });
  };

  const cherryPick = async (hash: string) => {
    await withBusy(async () => {
      const out = await Git.cherryPick(hash, false);
      notify("success", t("cherryPicked"), out.split("\n")[0]);
      await reload(false);
      openNextConflict();
      void loadLog(true);
    });
  };

  const revert = async (hash: string) => {
    const ok = await ask({
      title: t("revertTitle"),
      message: t("revertMessage", { hash: hash.slice(0, 8) }),
      confirmLabel: t("revert"),
    });
    if (!ok) return;
    await withBusy(async () => {
      await Git.revert(hash);
      notify("success", t("reverted"), hash.slice(0, 8));
      await reload(false);
      openNextConflict();
      void loadLog(true);
    });
  };

  const createTag = async (opts: { name: string; message: string; revision: string; force: boolean }) => {
    setDialog(null);
    await withBusy(async () => {
      await Git.createTag(opts);
      notify("success", t("tagCreated"), opts.name);
      await reload(false);
    });
  };

  const stashPush = (opts: { message: string; includeUntracked: boolean; keepIndex: boolean }) => {
    setDialog(null);
    void withBusy(async () => {
      await Git.stashPush({ ...opts, paths: [] });
      notify("success", t("changesStashed"));
      await reload(false);
    });
  };

  const stashApply = async (index: number, pop: boolean) => {
    await withBusy(async () => {
      await Git.stashApply(index, pop);
      notify("success", pop ? t("stashPopped") : t("stashApplied"));
      await reload(false);
    });
  };

  const stashDrop = async (index: number) => {
    const ok = await ask({
      title: t("dropStashTitle"),
      message: t("dropStashMessage", { index }),
      confirmLabel: t("drop"),
      danger: true,
    });
    if (!ok) return;
    await withBusy(async () => {
      await Git.stashDrop(index);
      await reload(false);
    });
  };

  const changelistSubmit = async (name: string, comment: string) => {
    if (!dialog || dialog.kind !== "changelist") return;
    const current = dialog;
    setDialog(null);
    await withBusy(async () => {
      if (current.mode === "new") await Git.createChangelist(name, comment);
      else if (current.id) await Git.renameChangelist(current.id, name, comment);
      await reload(false);
    });
  };

  const moveToChangelist = (paths: string[], id: string) =>
    withBusy(async () => {
      await Git.moveToChangelist(paths, id);
      await reload(false);
    });

  const continueOperation = async () => {
    await withBusy(async () => {
      const out = await Git.continueOperation();
      notify("success", t("operationContinued"), out.split("\n")[0]);
      await reload(false);
    });
  };

  const abortOperation = async () => {
    const operation = state?.operation ?? "";
    const ok = await ask({
      title: t("abortTitle"),
      message: operation === "" ? t("abortMessageCurrent") : t("abortMessage", { op: operation }),
      confirmLabel: t("abort"),
      danger: true,
    });
    if (!ok) return;
    await withBusy(async () => {
      await Git.abortOperation();
      notify("success", t("operationAborted"));
      await reload(false);
    });
  };

  const handleCommand = useCallback(
    (cmd: string) => {
      switch (cmd) {
        case "open":
          void openRepo();
          break;
        case "quickopen":
          if (repoOpenRef.current) setQuickOpen(true);
          break;
        case "closetab":
          if (activeIdRef.current) closeDoc(activeIdRef.current);
          break;
        case "close":
          void closeRepo();
          break;
        case "refresh":
          void reload(true);
          void loadLog(true);
          break;
        case "settings":
          setDialog({ kind: "settings" });
          break;
        case "commit":
          setTab("commit");
          document.querySelector<HTMLTextAreaElement>(".commit-message")?.focus();
          break;
        case "push":
          if (repoOpen) setDialog({ kind: "push", setUpstream: !snapshot?.state.upstream });
          break;
        case "pull":
          if (repoOpen) setDialog({ kind: "pull" });
          break;
        case "fetch":
          if (repoOpen) fetch();
          break;
        case "stash":
          if (repoOpen) setDialog({ kind: "stash" });
          break;
        case "branches":
          setTab("branch");
          break;
        case "tab:commit":
          setTab("commit");
          break;
        case "tab:branch":
          setTab("branch");
          break;
        case "tab:console":
          setTab("console");
          break;
      }
    },
    // The handler closes over current state through the functions above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [repoOpen, snapshot, tab, reload, loadLog],
  );

  useEffect(() => {
    const off = events.appCommand.on((cmd) => handleCommand(cmd));
    return off;
  }, [handleCommand]);

  const selectCommit = (commit: Commit) => {
    setSelectedCommit(commit.hash);
    setLogDetail(null);
    setLogFile(null);
    Git.showCommit(commit.hash)
      .then((detail) => {
        setLogDetail(detail);
      })
      .catch((err) => fail(t("readCommit"), err));
  };

  // A merge lists its parents; opening one selects it in the history when it
  // is loaded, and otherwise just shows its details.
  const openCommit = (hash: string) => {
    const known = logResult?.commits.find((c) => c.hash === hash || c.hash.startsWith(hash));
    if (known) {
      selectCommit(known);
      return;
    }
    setSelectedCommit(hash);
    setLogDetail(null);
    setLogFile(null);
    Git.showCommit(hash)
      .then((detail) => setLogDetail(detail))
      .catch((err) => fail(t("readCommit"), err));
  };

  const showFileHistory = (path: string) => {
    setLogPath(path);
    setTab("branch");
    setSelectedCommit(null);
    setLogDetail(null);
    setLogFile(null);
  };

  const actions: CommitActions = {
    onRefresh: () => void reload(true),
    onShowDiff: openEntryDiff,
    onShowConflict: (path) => void openConflict(path),
    onOpenSource: (path, revision) => void showFile(path, revision),
    onShowHistory: showFileHistory,
    onStage: (paths) => void stage(paths),
    onUnstage: (paths) => void unstage(paths),
    onRollback: (paths) => void rollback(paths),
    onDelete: (paths) => void deleteUntracked(paths),
    onIgnore: (paths) => void ignorePaths(paths),
    onReveal: (path) => void Workspace.reveal(path).catch((err) => fail(t("revealFailed"), err)),
    onCopyPath: copyText,
    onMoveToChangelist: (paths, id) => void moveToChangelist(paths, id),
    onCreateChangelist: () => setDialog({ kind: "changelist", mode: "new" }),
    onRenameChangelist: (id) => {
      const cl = snapshot?.changelists.items.find((c) => c.id === id);
      setDialog({ kind: "changelist", mode: "rename", id, name: cl?.name, comment: cl?.comment });
    },
    onDeleteChangelist: async (id) => {
      const cl = snapshot?.changelists.items.find((c) => c.id === id);
      const ok = await ask({
        title: t("deleteChangelistTitle"),
        message: t("deleteChangelistMessage", { name: cl?.name ?? id }),
        confirmLabel: t("delete"),
        danger: true,
      });
      if (!ok) return;
      await withBusy(async () => {
        await Git.deleteChangelist(id);
        await reload(false);
      });
    },
    onSetActiveChangelist: (id) => void withBusy(async () => {
      await Git.setActiveChangelist(id);
      await reload(false);
    }),
    onTakeSide: (path, side) =>
      void withBusy(async () => {
        await Git.takeSide(path, side);
        notify("success", side === "ours" ? t("tookOurs") : t("tookTheirs"), path);
        closeDoc(`conflict:${path}`);
        await reload(false);
      }),
    onMarkResolved: (paths) =>
      void withBusy(async () => {
        await Git.markResolved(paths);
        await reload(false);
      }),
    onCommit: (pushAfter) => void commit(pushAfter),
    onToggleAmend: (amend) => void toggleAmend(amend),
    onCommitFormChange: setForm,
    onRequestPush: () => void commit(true),
    onShowStash: (index) => void openStash(index),
    onStashPush: () => setDialog({ kind: "stash" }),
    onStashApply: (index, pop) => void stashApply(index, pop),
    onStashDrop: (index) => void stashDrop(index),
  };

  const saveSettings = async (next: Settings) => {
    try {
      const saved = await Workspace.saveSettings(next);
      settingsRef.current = saved;
      setSettings(saved);
      applyTheme(saved);
      setDialog(null);
      notify("success", t("settingsSaved"));
      await reload(false);
    } catch (err) {
      fail(t("saveSettingsFailed"), err);
    }
  };

  if (!boot || !settings) {
    return (
      <div className="boot-screen">
        <Icon name="git" size={28} />
        <Spinner label={t("starting")} />
      </div>
    );
  }

  const tabHeader = (
    <div className="toolwindow-tabs">
      <button className={cx("toolwindow-tab", tab === "commit" && "active")} onClick={() => setTab("commit")}>
        <Icon name="commit" />
        {t("commitTab")}
        {snapshot && snapshot.state.changed + snapshot.state.untracked + snapshot.state.conflicts > 0 && (
          <span className="tab-count">{snapshot.state.changed + snapshot.state.untracked + snapshot.state.conflicts}</span>
        )}
      </button>
      <button className={cx("toolwindow-tab", tab === "branch" && "active")} onClick={() => setTab("branch")}>
        <Icon name="branch" />
        {t("branchTab")}
      </button>
      <button className={cx("toolwindow-tab", tab === "console" && "active")} onClick={() => setTab("console")}>
        <Icon name="console" />
        {t("consoleTab")}
      </button>
    </div>
  );

  return (
    <div className="app" style={{ "--op-dock-left": `${splitWidth + 10}px` } as React.CSSProperties}>
      <header className="titlebar">
        <div className="titlebar-brand">
          <span className="brand-mark">
            <Icon name="git" size={17} />
          </span>
          <span className="brand-name">GitJet</span>
          {snapshot && (
            <>
              <span className="titlebar-sep">/</span>
              <span className="titlebar-repo" title={snapshot.state.root}>
                {snapshot.state.name}
              </span>
            </>
          )}
        </div>
        <div className="titlebar-actions">
          <IconButton icon="open" title={t("openRepo")} onClick={() => void openRepo()} />
          <span className="toolbar-sep" />
          <IconButton icon="refresh" title={t("refresh")} onClick={() => void reload(true)} spinner={busy > 0} />
          <span
            className="icon-slot"
            onContextMenu={(e) => {
              if (!repoOpen) return;
              e.preventDefault();
              setFetchMenu({ x: e.clientX, y: e.clientY });
            }}
          >
            <IconButton
              icon="fetch"
              title={t("fetchTooltip")}
              onClick={() => fetch()}
              spinner={!!op?.running && op.icon === "fetch"}
              disabled={!repoOpen}
            />
          </span>
          <span className="icon-slot">
            <IconButton icon="pull" title={t("updateProject")} onClick={() => setDialog({ kind: "pull" })} disabled={!repoOpen} />
            {state && state.behind > 0 && <span className="icon-dot" />}
          </span>
          <IconButton icon="push" title={t("pushTip")} onClick={() => setDialog({ kind: "push", setUpstream: !snapshot?.state.upstream })} disabled={!repoOpen} />
          <span className="spacer" />
          <button className="quick-trigger" onClick={() => setQuickOpen(true)} title={t("quickOpenTip")} disabled={!repoOpen}>
            <Icon name="search" />
            <span>{t("searchFiles")}</span>
            <kbd>⌘P</kbd>
          </button>
          <span className="spacer" />
          <IconButton icon="settings" title={t("settingsTip")} onClick={() => setDialog({ kind: "settings" })} />
        </div>
      </header>
      <div className="workspace">
        <aside className="toolwindow" style={{ width: splitWidth }}>
          {tabHeader}
          <div className="toolwindow-content">
            {tab === "commit" &&
              (snapshot ? (
                <CommitPanel
                  snapshot={snapshot}
                  settings={settings}
                  checked={checked}
                  setChecked={setChecked}
                  form={form}
                  actions={actions}
                  busy={busy > 0}
                  history={history}
              viewMode={changeView}
              onViewMode={setChangeView}
              showStaged={showStaged}
              onToggleStaged={() => setShowStaged(!showStaged)}
              showStashes={showStashes}
              onToggleStashes={() => setShowStashes(!showStashes)}
                />
              ) : (
                <NoRepo onOpen={() => void openRepo()} />
              ))}
            {tab === "branch" &&
              (snapshot ? (
                <BranchList
                  refs={refs}
                  current={state?.branch ?? ""}
                  favorites={favorites}
                  selected={logRef}
                  onSelect={(name) => {
                    setLogRef(name);
                    setSelectedCommit(null);
                    setLogDetail(null);
                    setLogFile(null);
                  }}
                  onCheckout={(name) => void checkout(name)}
                  onToggleFavorite={toggleFavorite}
                  onNewBranch={(start) => setDialog({ kind: "newBranch", start })}
                  onMerge={(name) => setDialog({ kind: "merge", refs: [name] })}
                  onRebase={(name) => void rebase(name)}
                  onDelete={(name) => void deleteBranch(name)}
                  onCopy={copyText}
                  onPull={(leaf) => pullBranch(leaf)}
                  onPush={(leaf) => pushBranch(leaf)}
                />
              ) : (
                <NoRepo onOpen={() => void openRepo()} />
              ))}
            {tab === "console" && <ConsolePanel onCommandDone={() => void reload(false)} repoOpen={repoOpen} />}
          </div>
          {logPath && tab === "branch" && (
            <div className="history-banner">
              <Icon name="log" />
              <span>{t("historyOf", { path: logPath })}</span>
              <button
                className="mini-btn"
                onClick={() => {
                  setLogPath("");
                  setSelectedCommit(null);
                }}
              >
                {t("clear")}
              </button>
            </div>
          )}
        </aside>
        <Splitter width={splitWidth} setWidth={setSplitWidth} />
        <div className="workspace-right">
        <RightPane
            commitView={detailView}
            diffMode={diffMode}
            setDiffMode={setDiffMode}
            ignoreWhitespace={ignoreWhitespace}
            onToggleWhitespace={toggleWhitespace}
            docs={docs}
            activeId={activeId}
            onActivate={setActiveId}
            onCloseDoc={closeDoc}
            diffWrap={diffWrap}
            onToggleWrap={() => setDiffWrap(!diffWrap)}
            onApplyHunk={(hunk, action) => {
              const active = docsRef.current.find((d) => d.id === activeIdRef.current);
              if (active?.kind === "diff") void applyHunk(active.opts, hunk, action);
            }}
            onApplyFile={(action) => {
              const active = docsRef.current.find((d) => d.id === activeIdRef.current);
              if (active?.kind === "diff") void applyFile(active.opts, action);
            }}
            onBlame={(path) => void openBlame(path)}
            onOpenFile={(path, revision) => void showFile(path, revision)}
            onOpenDiff={(path, revision) => void showFileDiff(path, revision)}
            onCopyPath={copyText}
            onReveal={(path) => void Workspace.reveal(path).catch((err) => fail(t("revealFailed"), err))}
            busy={diffBusy}
            reloadKey={reloadKey}
            onShowFileHistory={showFileHistory}
            onSaveConflict={async (path, content) => {
              await withBusy(async () => {
                await Git.saveResolution(path, content);
                notify("success", t("conflictResolved"), path);
                closeDoc(`conflict:${path}`);
                await reload(false);
                openNextConflict();
              });
            }}
            onTakeSide={async (path, side) => {
              await withBusy(async () => {
                await Git.takeSide(path, side);
                notify("success", side === "ours" ? t("tookOurs") : t("tookTheirs"), path);
                closeDoc(`conflict:${path}`);
                await reload(false);
                openNextConflict();
              });
            }}
            onMarkResolved={async (path) => {
              await withBusy(async () => {
                await Git.markResolved([path]);
                notify("success", t("markedResolved"), path);
                closeDoc(`conflict:${path}`);
                await reload(false);
                openNextConflict();
              });
            }}
            onOpenRecent={(path) => void openRepo(path)}
            onRemoveRecent={async (path) => {
              await Workspace.removeRecent(path);
              const next = { ...settings, recent: settings.recent.filter((r) => r.path !== path) };
              setSettings(next);
              setBoot({ ...boot, settings: next });
            }}
            recent={settings.recent}
            repoOpen={repoOpen}
          />
        {snapshot && (
          <LogDock
            result={logResult}
            detail={logDetail}
            loading={logLoading}
            selected={selectedCommit}
            selectedFile={logFile}
            search={searchInput}
            author={logAuthor}
            authors={authors}
            scope={logRef}
            onClearScope={() => setLogRef("")}
            height={logDockHeight}
            viewMode={detailView}
            onViewMode={setDetailView}
            infoRatio={logInfoRatio}
            onInfoResize={setLogInfoRatio}
            collapsed={logDockFolded}
            onToggleCollapsed={() => setLogDockFolded(!logDockFolded)}
            onResize={setLogDockHeight}
            onSelect={selectCommit}
            onOpenCommit={openCommit}
            onSelectFile={(file) => {
              if (logDetail) void openCommitFile(logDetail.hash, file);
            }}
            onStepFile={stepCommitFile}
            onSearch={setSearchInput}
            onAuthor={(name) => {
              setLogAuthor(name);
              setSelectedCommit(null);
              setLogDetail(null);
              setLogFile(null);
            }}
            onRefresh={() => void loadLog(true)}
            onFetch={() => fetch()}
            onLoadMore={() => void loadLog(false, true)}
            onCopy={copyText}
            onOpenSource={(path, revision) => void showFile(path, revision)}
            onShowHistory={showFileHistory}
            onCheckout={(ref) => void checkout(ref)}
            onNewBranch={(start) => setDialog({ kind: "newBranch", start })}
            onNewTag={(start) => setDialog({ kind: "tag", start })}
            onCherryPick={(hash) => void cherryPick(hash)}
            onRevert={(hash) => void revert(hash)}
            onReset={(hash) => {
              const commit = logResult?.commits.find((c) => c.hash === hash);
              setDialog({ kind: "reset", hash, subject: commit?.subject ?? "" });
            }}
          />
        )}
        </div>
      </div>
      <footer className="statusbar">
        <button className="status-branch" onClick={() => setTab("branch")} disabled={!repoOpen}>
          <Icon name="branch" size={13} />
          <span>{state ? (state.detached ? t("detachedHead") : state.unborn ? t("noCommitsYet") : state.branch) : t("noRepository")}</span>
          {state && state.upstream && <span className="status-upstream">{state.upstream}</span>}
        </button>
        {state && (state.ahead > 0 || state.behind > 0) && (
          <span className="status-sync">
            {state.ahead > 0 && (
              <button
                className="status-sync-btn ahead"
                title={count(state.ahead, t("pushOne", { n: state.ahead }), t("pushOther", { n: state.ahead }))}
                onClick={() => setDialog({ kind: "push", setUpstream: !state.upstream })}
              >
                ↑ {state.ahead}
              </button>
            )}
            {state.behind > 0 && (
              <button
                className="status-sync-btn behind"
                title={count(state.behind, t("pullOne", { n: state.behind }), t("pullOther", { n: state.behind }))}
                onClick={() => setDialog({ kind: "pull" })}
              >
                ↓ {state.behind}
              </button>
            )}
          </span>
        )}
        {state?.operation && (
          <span className="status-operation">
            <Icon name="warning" size={12} />
            <span className="op-name">{operationLabel(state.operation, t)}</span>
            {state.opProgress && <span className="op-progress">{state.opProgress}</span>}
            {state.opDetail && <span className="op-detail">{state.opDetail}</span>}
            <button className="mini-btn" onClick={() => void continueOperation()}>
              {t("continueOp")}
            </button>
            <button className="mini-btn danger" onClick={() => void abortOperation()}>
              {t("abort")}
            </button>
          </span>
        )}
        {state?.conflicts ? (
          <span className="status-conflicts">
            <Icon name="warning" size={12} />{" "}
            {count(state.conflicts, t("conflictOne", { n: state.conflicts }), t("conflictOther", { n: state.conflicts }))}
          </span>
        ) : null}
        <span className="spacer" />
        {snapshot && (
          <>
            <span className="status-item">{t("changed", { n: snapshot.state.changed })}</span>
            {snapshot.state.staged > 0 && <span className="status-item">{t("staged", { n: snapshot.state.staged })}</span>}
            {snapshot.state.untracked > 0 && <span className="status-item">{t("untracked", { n: snapshot.state.untracked })}</span>}
            <span className="status-item status-path" title={snapshot.state.root}>
              {snapshot.state.root}
            </span>
          </>
        )}
        <span className="status-item">git {snapshot?.state.gitVersion || boot.version}</span>
      </footer>

      {quickOpen && (
        <QuickOpen
          onClose={() => setQuickOpen(false)}
          onOpen={(path) => void showFile(path, "")}
        />
      )}

      {dialog?.kind === "settings" && (
        <SettingsDialog
          settings={settings}
          onSave={(next) => void saveSettings(next)}
          onClose={() => setDialog(null)}
          onValidate={(path) => Workspace.validateGit(path)}
        />
      )}
      {dialog?.kind === "newBranch" && (
        <NewBranchDialog
          mode="new"
          refs={[refs?.current ?? "", ...(refs?.local ?? []).map((r) => r.name), ...(refs?.remote ?? []).map((r) => r.name), ...(refs?.tags ?? []).map((r) => r.name)]}
          current={refs?.current ?? state?.branch ?? ""}
          start={dialog.start}
          onClose={() => setDialog(null)}
          onSubmit={(name, start, checkoutNow) => {
            setDialog(null);
            void withBusy(async () => {
              await Git.createBranch(name, start, checkoutNow);
              notify("success", t("branchCreated"), name);
              await reload(false);
              void loadLog(true);
            });
          }}
        />
      )}
      {dialog?.kind === "push" && (
        <PushDialog
          remotes={remotes}
          current={state?.branch ?? ""}
          setUpstream={dialog.setUpstream}
          onClose={() => setDialog(null)}
          onSubmit={(opts) => void push(opts)}
        />
      )}
      {dialog?.kind === "pull" && (
        <PullDialog
          remotes={remotes}
          updateMethod={settings.updateMethod}
          onClose={() => setDialog(null)}
          onSubmit={pull}
        />
      )}
      {dialog?.kind === "reset" && (
        <ResetDialog
          hash={dialog.hash}
          subject={dialog.subject}
          onClose={() => setDialog(null)}
          onSubmit={(mode) => void reset(dialog.hash, mode)}
        />
      )}
      {dialog?.kind === "tag" && (
        <TagDialog start={dialog.start} onClose={() => setDialog(null)} onSubmit={(opts) => void createTag(opts)} />
      )}
      {dialog?.kind === "stash" && (
        <StashDialog onClose={() => setDialog(null)} onSubmit={(opts) => stashPush(opts)} />
      )}
      {dialog?.kind === "changelist" && (
        <ChangelistDialog
          mode={dialog.mode}
          initialName={dialog.name}
          initialComment={dialog.comment}
          onClose={() => setDialog(null)}
          onSubmit={(name, comment) => void changelistSubmit(name, comment)}
        />
      )}
      {dialog?.kind === "merge" && (
        <MergeDialog
          refs={[
            dialog.refs[0] ?? "",
            ...(refs?.local ?? []).map((r) => r.name).filter((n) => n !== dialog.refs[0]),
            ...(refs?.remote ?? []).map((r) => r.name).filter((n) => n !== dialog.refs[0]),
          ].filter(Boolean)}
          current={state?.branch ?? ""}
          onClose={() => setDialog(null)}
          onSubmit={(ref, opts) => void merge(ref, opts)}
        />
      )}
      {confirm && (
        <ConfirmDialog
          title={confirm.title}
          message={confirm.message}
          detail={confirm.detail}
          confirmLabel={confirm.confirmLabel}
          danger={confirm.danger}
          onConfirm={confirm.onConfirm}
          onCancel={confirm.onCancel}
        />
      )}
      {op && (
        <OperationDock op={op} open={opOpen} onToggle={() => setOpOpen((v) => !v)} onClose={() => setOp(null)} />
      )}
      {fetchMenu && (
        <ContextMenu
          x={fetchMenu.x}
          y={fetchMenu.y}
          onClose={() => setFetchMenu(null)}
          items={[
            {
              label: t("fetchAllRemotes"),
              icon: "fetch",
              onClick: () => fetch({ all: true, remote: "", prune: fetchOptions.prune, tags: fetchOptions.tags }),
            },
            ...(remotes.some((r) => r.name === "origin")
              ? [
                  {
                    label: t("fetchOrigin"),
                    icon: "download" as const,
                    onClick: () =>
                      fetch({ all: false, remote: "origin", prune: fetchOptions.prune, tags: fetchOptions.tags }),
                  },
                ]
              : []),
            { separator: true as const },
            {
              label: t("pruneBranches"),
              checked: fetchOptions.prune,
              onClick: () => setFetchOptions({ ...fetchOptions, prune: !fetchOptions.prune }),
            },
            {
              label: t("fetchTags"),
              checked: fetchOptions.tags,
              onClick: () => setFetchOptions({ ...fetchOptions, tags: !fetchOptions.tags }),
            },
          ]}
        />
      )}
      {toast && <Toast kind={toast.kind} title={toast.title} message={toast.message} onClose={() => setToast(null)} />}
    </div>
  );
}

function operationLabel(op: string, t: Translate): string {
  switch (op) {
    case "merge":
      return t("merging");
    case "rebase":
      return t("rebasing");
    case "rebase-interactive":
      return t("interactiveRebase");
    case "cherry-pick":
      return t("cherryPicking");
    case "revert":
      return t("reverting");
    case "am":
      return t("applyingPatches");
    case "bisect":
      return t("bisecting");
    default:
      return op;
  }
}

function NoRepo({ onOpen }: { onOpen: () => void }) {
  const t = useT(T);
  return (
    <div className="no-repo">
      <Icon name="git" size={26} />
      <div>{t("noRepoMessage")}</div>
      <Button variant="primary" onClick={onOpen}>
        {t("openRepoEllipsis")}
      </Button>
    </div>
  );
}

function docIcon(doc: Doc): "diff" | "file" | "merge" | "user" | "commit" {
  switch (doc.kind) {
    case "diff":
      return "diff";
    case "file":
      return "file";
    case "conflict":
      return "merge";
    case "blame":
      return "user";
    case "commit":
      return "commit";
  }
}

function baseName(path: string): string {
  const slash = path.lastIndexOf("/");
  return slash >= 0 ? path.slice(slash + 1) : path;
}

function tabTitle(doc: Doc, t: Translate): string {
  switch (doc.kind) {
    case "diff":
      return baseName(doc.opts.path);
    case "file":
      return baseName(doc.file.path);
    case "conflict":
      return t("mergeTab", { name: baseName(doc.path) });
    case "blame":
      return t("blameTab", { name: baseName(doc.path) });
    case "commit":
      return doc.detail.short;
  }
}

function RightPane({
  repoOpen,
  docs,
  activeId,
  onActivate,
  onCloseDoc,
  diffMode,
  diffWrap,
  onToggleWrap,
  setDiffMode,
  ignoreWhitespace,
  onToggleWhitespace,
  onApplyHunk,
  onApplyFile,
  onBlame,
  onOpenFile,
  onOpenDiff,
  onCopyPath,
  onReveal,
  busy,
  reloadKey,
  onShowFileHistory,
  onSaveConflict,
  onTakeSide,
  onMarkResolved,
  onOpenRecent,
  onRemoveRecent,
  recent,
  commitView,
}: {
  commitView: ChangeView;
  repoOpen: boolean;
  docs: Doc[];
  activeId: string | null;
  onActivate: (id: string) => void;
  onCloseDoc: (id: string) => void;
  diffWrap: boolean;
  onToggleWrap: () => void;
  diffMode: "split" | "unified";
  setDiffMode: (m: "split" | "unified") => void;
  ignoreWhitespace: boolean;
  onToggleWhitespace: () => void;
  onApplyHunk: (hunk: number, action: "stage" | "unstage" | "rollback") => void;
  onApplyFile: (action: "stage" | "unstage" | "rollback") => void;
  onBlame: (path: string) => void;
  onOpenFile: (path: string, revision: string) => void;
  onOpenDiff: (path: string, revision: string) => void;
  onCopyPath: (text: string) => void;
  onReveal: (path: string) => void;
  busy: boolean;
  reloadKey: number;
  onShowFileHistory: (path: string) => void;
  onSaveConflict: (path: string, content: string) => Promise<void>;
  onTakeSide: (path: string, side: "ours" | "theirs") => Promise<void>;
  onMarkResolved: (path: string) => Promise<void>;
  onOpenRecent: (path: string) => void;
  onRemoveRecent: (path: string) => Promise<void>;
  recent: Settings["recent"];
}) {
  const active = docs.find((d) => d.id === activeId) ?? docs[0] ?? null;
  const t = useT(T);
  // Each open commit keeps its own expanded directories.
  const [commitDirs, setCommitDirs] = useState<Map<string, Set<string>>>(new Map());

  const welcome = (
    <div className="welcome">
      <div className="welcome-inner">
        <div className="welcome-logo">
          <Icon name="git" size={36} />
        </div>
        <h1>{repoOpen ? t("noFileOpen") : t("welcomeHeadline")}</h1>
        <p className="welcome-tagline">{repoOpen ? t("emptyOpen") : t("welcomeTagline")}</p>
        {repoOpen && (
          <span className="welcome-key">
            {t("emptyQuickOpen")}
            <kbd>⌘/Ctrl</kbd>
            <kbd>P</kbd>
          </span>
        )}
        <div className="welcome-actions">
          <Button variant="primary" onClick={() => onOpenRecent("")}>
            <Icon name="open" /> {t("openRepository")}
          </Button>
        </div>
        {recent.length > 0 && (
          <div className="recent-list">
            <div className="recent-head">
              <span className="recent-title">{t("recentRepositories")}</span>
              <span className="recent-count">{recent.length}</span>
            </div>
            <div className="recent-grid">
              {recent.map((r) => (
                <div className="recent-card" key={r.path} onClick={() => onOpenRecent(r.path)} title={r.path}>
                  <span className="recent-icon"><Icon name="folder" size={17} /></span>
                  <span className="recent-text">
                    <span className="recent-name">{r.name || r.path}</span>
                    <span className="recent-path">{r.path}</span>
                  </span>
                  <Icon name="chevronRight" size={14} className="recent-arrow" />
                  <button
                    className="recent-remove"
                    title={t("removeFromRecent")}
                    onClick={(e) => {
                      e.stopPropagation();
                      void onRemoveRecent(r.path);
                    }}
                  >
                    <Icon name="close" size={12} />
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
        <div className="welcome-hints">
          <span><kbd>⌘/Ctrl</kbd><kbd>O</kbd>{t("hintOpen")}</span>
          <span><kbd>⌘/Ctrl</kbd><kbd>P</kbd>{t("hintQuickOpen")}</span>
          <span><kbd>⌘/Ctrl</kbd><kbd>K</kbd>{t("hintCommit")}</span>
          <span><kbd>⌘/Ctrl</kbd><kbd>Shift</kbd><kbd>K</kbd>{t("hintPush")}</span>
          <span><kbd>⌘/Ctrl</kbd><kbd>T</kbd>{t("hintUpdate")}</span>
        </div>
      </div>
    </div>
  );

  if (!active) {
    return <main className="editor-area">{welcome}</main>;
  }

  return (
    <main className="editor-area">
      <div className="editor-tabs" role="tablist">
        {docs.map((doc) => (
          <div
            key={doc.id}
            role="tab"
            aria-selected={doc.id === active.id}
            className={cx("editor-tab", doc.id === active.id && "active")}
            onClick={() => onActivate(doc.id)}
            onAuxClick={(e) => {
              if (e.button === 1) onCloseDoc(doc.id);
            }}
            title={doc.kind === "diff" ? doc.opts.path : doc.kind === "file" ? doc.file.path : doc.title}
          >
            <Icon name={docIcon(doc)} size={14} />
            <span className="editor-tab-title">{tabTitle(doc, t)}</span>
            <span className="editor-tab-kind">
              {doc.kind === "diff" ? t("kindDiff") : doc.kind === "file" ? t("kindSource") : doc.kind === "conflict" ? t("kindMerge") : doc.kind === "blame" ? t("kindBlame") : t("kindCommit")}
            </span>
            {doc.kind === "diff" && (
              <span className={cx("tab-status", `st-${doc.diff.status === "modified" ? "modified" : doc.diff.status === "added" ? "added" : "deleted"}`)}>
                {doc.diff.status === "added" ? "A" : doc.diff.status === "deleted" ? "D" : doc.diff.status === "renamed" ? "R" : "M"}
              </span>
            )}
            <button
              className="editor-tab-close"
              title={t("close")}
              onClick={(e) => {
                e.stopPropagation();
                onCloseDoc(doc.id);
              }}
            >
              <Icon name="close" size={11} />
            </button>
          </div>
        ))}
        <span className="spacer" />
      </div>
      <div className="editor-content">
        {active.kind === "conflict" && (
          <ConflictView
            path={active.path}
            conflict={active.content}
            busy={busy}
            onSave={(content) => void onSaveConflict(active.path, content)}
            onTakeSide={(side) => void onTakeSide(active.path, side)}
            onMarkResolved={() => void onMarkResolved(active.path)}
            onClose={() => onCloseDoc(active.id)}
          />
        )}
        {active.kind === "blame" && (
          <BlameView
            path={active.path}
            lines={active.data.lines}
            onClose={() => onCloseDoc(active.id)}
            onCopy={onCopyPath}
          />
        )}
        {active.kind === "file" && (
          <SourceView
            file={active.file}
            onShowDiff={() => onOpenDiff(active.file.path, active.revision)}
            onBlame={() => onBlame(active.file.path)}
            onOpenWorkingTree={() => onOpenFile(active.file.path, "")}
            onOpenRevision={
              active.revision === ""
                ? () => onOpenFile(active.file.path, "HEAD")
                : undefined
            }
            onCopyPath={() => onCopyPath(active.file.path)}
            onReveal={() => onReveal(active.file.path)}
          />
        )}
        {active.kind === "commit" && (
          <div className="commit-view">
            <div className="diff-header">
              <div className="diff-title-row">
                <Icon name="commit" />
                <span className="diff-path">{active.detail.short}</span>
                <span className="muted">{formatStamp(active.detail.authorTime)}</span>
                <span className="spacer" />
                <button className="toolbar-text-btn" onClick={() => onCopyPath(active.detail.hash)}>
                  <Icon name="copy" /> {t("copyHash")}
                </button>
                <IconButton icon="close" title={t("close")} small onClick={() => onCloseDoc(active.id)} />
              </div>
              <div className="diff-toolbar">
                <span className="muted">
                  {active.detail.author} &lt;{active.detail.authorEmail}&gt;
                </span>
              </div>
            </div>
            <div className="details-scroll">
              <div className="details-subject commit-view-subject">{active.detail.subject}</div>
              {active.detail.body && <pre className="details-body">{active.detail.body}</pre>}
              <div className="details-stats">
                {t("filesChanged", { n: active.detail.stats.files })}
                {active.detail.stats.additions > 0 && <span className="add-count"> +{active.detail.stats.additions}</span>}
                {active.detail.stats.deletions > 0 && <span className="del-count"> −{active.detail.stats.deletions}</span>}
              </div>
              <FileTree
                files={active.detail.files}
                view={commitView}
                expanded={commitDirs.has(active.id) ? commitDirs.get(active.id)! : new Set()}
                onToggleDir={(key) => {
                  const current = new Set(commitDirs.get(active.id) ?? []);
                  if (current.has(key)) current.delete(key);
                  else current.add(key);
                  setCommitDirs(new Map(commitDirs).set(active.id, current));
                }}
                indent={4}
                renderFile={(file, depth, flat) => (
                <div
                  className="details-file"
                  style={{ marginLeft: depth * 12 }}
                  onClick={() => onOpenDiff(file.path, active.detail.hash)}
                  title={file.path}
                >
                  <StatusMark kind={file.status} />
                  <span className="details-file-path">
                    <span className="file-base">{file.path.slice(file.path.lastIndexOf("/") + 1)}</span>
                    {flat && file.path.includes("/") && (
                      <span className="file-dir">{file.path.slice(0, file.path.lastIndexOf("/") + 1)}</span>
                    )}
                  </span>
                  <button
                    className="mini-icon"
                    title={t("openSourceAtCommit")}
                    onClick={(e) => {
                      e.stopPropagation();
                      onOpenFile(file.path, active.detail.hash);
                    }}
                  >
                    <Icon name="file" size={12} />
                  </button>
                  <button
                    className="mini-icon"
                    title={t("showFileHistory")}
                    onClick={(e) => {
                      e.stopPropagation();
                      onShowFileHistory(file.path);
                    }}
                  >
                    <Icon name="log" size={12} />
                  </button>
                  <span className="tree-stats">
                    {file.additions > 0 && <span className="add-count">+{file.additions}</span>}
                    {file.deletions > 0 && <span className="del-count">−{file.deletions}</span>}
                  </span>
                </div>
                )}
              />
            </div>
          </div>
        )}
        {active.kind === "diff" && (
          <DiffView
            diff={active.diff}
            opts={active.opts}
            mode={diffMode}
            setMode={setDiffMode}
            ignoreWhitespace={ignoreWhitespace}
            onToggleWhitespace={onToggleWhitespace}
            onApply={onApplyHunk}
            onApplyFile={onApplyFile}
            onBlame={active.opts.target === "worktree" ? () => onBlame(active.opts.path) : undefined}
            onOpenFile={() =>
              onOpenFile(
                active.opts.path,
                active.opts.target === "commit" ? active.opts.revision : active.opts.target === "staged" ? "INDEX" : "",
              )
            }
            onCopyPath={() => onCopyPath(active.opts.path)}
            busy={busy}
            reloadKey={reloadKey}
            wrap={diffWrap}
            onToggleWrap={onToggleWrap}
          />
        )}
      </div>
    </main>
  );
}
