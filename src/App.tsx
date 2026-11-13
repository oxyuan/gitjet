import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  type DiffOptions,
  type FetchOptions,
  type FileDiff,
  type LogResult,
  type PlanStep,
  type PushOptions,
  type RefsSnapshot,
  type Remote,
  type RepoState,
  type Settings,
  type SourceFile,
  type SymbolHit,
  type ThreeWayDiff,
} from "./mygo";
import { CommitPanel, entriesFor, type CommitActions, type CommitForm, type FileEntry } from "./CommitPanel";
import { ConsolePanel } from "./ConsolePanel";
import { SourceTree } from "./SourceTree";
import { normalizeTabOrder, type ToolTab, TOOL_TABS, TOOL_TAB_ICONS } from "./tabs";
import { isProtectedBranch } from "./protected";
import { DiffView, ThreeWayView, diffRevisions } from "./DiffView";
import type { WhitespaceMode } from "./diff";
import {
  ChangelistDialog,
  MergeDialog,
  NewBranchDialog,
  PullDialog,
  PushDialog,
  RebaseDialog,
  PushCommitsDialog,
  ResetDialog,
  SettingsDialog,
  StashDialog,
  StashDetailDialog,
  CompareDialog,
  TagDialog,
  CleanupBranchesDialog,
  ConflictSummaryDialog,
  LocalHistoryDialog,
  ReviewDialog,
  RollbackDialog,
} from "./Dialogs";
import { EditHistoryDialog } from "./EditHistoryDialog";
import { CloneDialog, InitDialog, RemotesDialog } from "./RepoSetupDialogs";
import { RepoExtrasDialog } from "./RepoExtrasDialog";
import { FileIcon, Icon } from "./icons";
import { useFileMenu } from "./FileMenu";
import { LangProvider, count, resolveLang, useT, type Lang } from "./i18n";
import { computeMerge, conflictLabels, resolveSimpleConflicts } from "./merge";
import { detectLineEnding, normalizeText, withLineEnding } from "./editorText";
import type { EditorSaveHandle } from "./SourceEditor";
import { gutterDiffOptions } from "./gutter";
import { isAbsolutePath, joinRoot, resolveOpenPath } from "./paths";
import { mergeConflictInMemory } from "./conflictMerge";
import { LogDock, type LogFilters } from "./LogDock";
import { FileTree, type ChangeView } from "./FileTree";
import { BranchList } from "./BranchList";
import type { AuthorOption } from "./AuthorPicker";
import { OperationDock, type OperationState } from "./OperationDock";
import { QuickOpen } from "./QuickOpen";
import { SourceView } from "./SourceView";
import { SymbolPanel } from "./SymbolPanel";
import { TargetPopup } from "./TargetPopup";
import { NotificationCenter, type Notice } from "./NotificationCenter";
import { disconnectLSP, lspServerName, openNavigationTarget, setDocumentOpener, toUri } from "./lsp";
import {
  canStep,
  emptyHistory,
  mergeNavigationTargets,
  planTextJump,
  recordPoint,
  stepHistory,
  targetKey,
  targetPoint,
  targetsToHits,
  usageTargets,
  type EditorNavigationRequest,
  type NavigationHistory,
  type NavigationPoint,
  type NavigationTarget,
  type TargetRequest,
  type UsageRequest,
} from "./navigation";
import {
  Button,
  ConfirmDialog,
  ContextMenu,
  type ContextItem,
  cx,
  formatStamp,
  IconButton,
  Spinner,
  Splitter,
  StatusMark,
  Toast,
  useStoredState,
} from "./ui";
import type { BlameResult, RebaseOptions, RepoFile } from "./mygo";

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
    filesTab: "Files",
    branchTab: "Branch",
    consoleTab: "Console",
    detachedHead: "Detached HEAD",
    noCommitsYet: "No commits yet",
    pushOne: "Push {n} commit",
    pushOther: "Push {n} commits",
    pullOne: "Pull {n} commit from the remote",
    pullOther: "Pull {n} commits from the remote",
    fetchNewOne: "{n} new commit on the remote",
    fetchNewOther: "{n} new commits on the remote",
    pushUnpublished: "the branch has not been published",
    conflictOne: "{n} conflict",
    conflictOther: "{n} conflicts",
    stoppedOnConflicts: "Stopped on conflicts",
    changed: "{n} changed",
    staged: "{n} staged",
    untracked: "{n} untracked",
    continueOp: "Continue",
    skipOp: "Skip Commit",
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
    fileActionFailed: "Could not change the file",
    fileSaved: "File saved",
    filesSaved: "{n} files saved",
    saveFileFailed: "Could not save the file",
    symbolLookupFailed: "Could not search for that name",
    noUsages: "No usages of {name} were found.",
    onlyUsage: "Only one usage found — opened it.",
    rollbackHunkTitle: "Roll back this change",
    rollbackHunkMessage: "Discard this block of changes in {path}?",
    openConflictFailed: "Could not open the conflict",
    copyFailed: "Could not copy",
    copied: "Copied to the clipboard",
    gitFailed: "Git command failed",
    deleteBranchFailed: "Could not delete the branch",
    deleteTagFailed: "Could not delete the tag",
    deleteTagTitle: "Delete Tag",
    deleteTagMessage: "Delete tag “{name}”? Only the local tag is removed.",
    revealFailed: "Could not reveal the file",
    saveSettingsFailed: "Could not save settings",
    lastCommitMessage: "Could not read the last commit message",
    done: "Done",
    closeRepoTitle: "Close Repository",
    closeRepoMessage: "Close this repository and return to the welcome screen?",
    close: "Close",
    closeOthers: "Close Others",
    closeAllTabs: "Close All",
    closeUnmodifiedTabs: "Close Unmodified",
    closeLeftTabs: "Close to the Left",
    closeRightTabs: "Close to the Right",
    tabWorkingTree: "Working Tree",
    tabIndex: "Index",
    rollback: "Rollback",
    delete: "Delete",
    rollbackFileTitle: "Rollback File",
    rollbackFileMessage: "Discard all changes to {path}?",
    rollbackChangesDetail: "The files are restored from HEAD. This cannot be undone.",
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
    revertManyMessage: "Create commits that undo these {n} commits?",
    dropStashTitle: "Drop Stash",
    dropStashMessage: "Delete stash@{index}?",
    drop: "Drop",
    abortTitle: "Abort Operation",
    abortMessage: "Abort the {op} operation and restore the previous state?",
    abortMessageCurrent: "Abort the current operation and restore the previous state?",
    deleteChangelistTitle: "Delete Changelist",
    deleteChangelistMessage: "Delete “{name}”? Its files move to the default changelist.",
    ignoredPath: "Ignored",
    nothingToCommit: "Nothing to commit",
    nothingToCommitMessage: "Check at least one file in the commit panel.",
    commitNeedsMessage: "A commit needs a message",
    commitBlockedTitle: "Resolve the conflicts first",
    commitBlockedMessage: "{n} conflicted files are still in the index; git commits nothing until they are resolved.",
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
    tagDeleted: "Tag deleted",
    changesStashed: "Changes stashed",
    stashPopped: "Stash popped",
    stashApplied: "Stash applied",
    operationContinued: "Operation continued",
    operationAborted: "Operation aborted",
    tookOurs: "Took ours",
    tookTheirs: "Took theirs",
    settingsSaved: "Settings saved",
    conflictResolved: "Conflict resolved",
    conflictSaved: "Saved with unresolved conflicts",
    simpleResolved: "Simple conflicts resolved in {n} files",
    stillUnresolved: "{n} conflicts still need a decision",
    branchCreated: "Branch created",
    fetchAllRemotes: "Fetch all remotes",
    fetchOrigin: "Fetch origin",
    pruneBranches: "Prune deleted branches",
    fetchTags: "Fetch tags",
    operationPush: "Push",
    operationPull: "Update Project",
    operationFetch: "Fetch",
    operationClone: "Clone",
    commitChecksTitle: "Commit checks",
    commitSelectedNeedsFiles: "Check the files whose changes should be committed.",
    protectedCommitTitle: "Protected branch",
    protectedCommitMessage: "{branch} is protected. Commit to it anyway?",
    protectedForcePushTitle: "Protected branch",
    protectedForcePushMessage: "A force-push to the protected branch {branch} is refused.",
    pushRejectedTitle: "The push was rejected",
    pushRejectedMessage: "The remote has commits this branch does not. Update the branch and push again?",
    branchUpdated: "Branch updated",
    resetToRemoteTitle: "Reset to the remote branch",
    resetToRemoteMessage: "Move {branch} to its upstream and discard the commits only it has?",
    resetToRemote: "Reset to Remote",
    tagPushed: "Tag pushed",
    clearStashesTitle: "Clear all stashes",
    clearStashes: "Clear all stashes",
    clearStashesMessage: "Every stash entry of this repository is deleted. This cannot be undone.",
    patchSaved: "Patch saved",
    patchApplied: "Patch applied",
    externalDiffFailed: "The difftool could not be opened",
    commitChecksMessage: "{n} problems were found. Commit anyway?",
    commitAnyway: "Commit Anyway",
    amendSpecificTitle: "Amend into this commit",
    amendSpecificMessage: "Fold the staged changes into {hash} and replay the commits after it?",
    amendNeedsStaged: "Stage the changes to amend into this commit first.",
    fixupBySubject: "Fixup by subject",
    commitRebaseNoUpstream: "The branch has no upstream to rebase onto.",
    undoCommitTitle: "Undo the last commit",
    undoCommitMessage: "HEAD moves back one commit and its changes stay staged.",
    undoCommit: "Undo Commit",
    commitUndone: "Commit undone",
    operationInit: "Create Repository",
    removeRemoteTitle: "Remove remote",
    removeRemoteMessage: "Remove {name} and its remote-tracking refs?",
    remoteAdded: "Remote added",
    noRepoMessage: "Open a Git repository to get started.",
    openRepoEllipsis: "Open Repository…",
    cloneRepoEllipsis: "Clone…",
    createRepoEllipsis: "Create Repository…",
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
    emptyOpen: "Choose a file, a commit or a conflict to read it here.",
    kindDiff: "Diff",
    kindThree: "Three-sided diff",
    kindSource: "Source",
    kindMerge: "Merge",
    kindCommit: "Commit",
    kindTree: "Repository at a revision",
    treeAtRevision: "Repository at {rev}",
    treeFileOne: "{n} file",
    treeFileOther: "{n} files",
    copyHash: "Copy hash",
    filesChanged: "{n} files changed",
    openSourceAtCommit: "Open the source file at this commit",
    showFileHistory: "Show file history",
    title: "{name} – GitJet",
    repoFallback: "Repository",
    rewriteTitle: "Editing history",
    rewriteFinished: "History rewritten",
    rewriteRoot: "The root commit cannot be rewritten",
    resolveConflicts: "Resolve Conflicts…",
    cleanupDone: "Deleted {n} branches",
    cleanupForceMessage: "{n} branches still hold unmerged commits. Force delete them?",
    cleanupMenu: "Clean Up Branches…",
    repoTools: "Repository Tools…",
    worktreesMenu: "Worktrees…",
    submodulesMenu: "Submodules…",
    stashRestored: "The stash was restored on {branch}",
    readStashFiles: "Reading the stash failed",
    openNewWindow: "Opening a window failed",
  },
  zh: {
    starting: "正在启动 GitJet",
    openRepo: "打开仓库 (⌘/Ctrl+O)",
    refresh: "刷新 (⌘/Ctrl+R)",
    fetchTooltip: "Fetch（右键查看选项）",
    updateProject: "Pull (⌘/Ctrl+T)",
    pushTip: "Push (⌘/Ctrl+Shift+K)",
    branches: "分支",
    detachedAt: "分离于 {ref}",
    noCommitsParen: "（无提交）",
    noRepository: "未打开仓库",
    quickOpenTip: "快速打开 (⌘/Ctrl+P)",
    searchFiles: "搜索文件",
    settingsTip: "设置 (⌘/Ctrl+,)",
    commitTab: "提交",
    filesTab: "文件",
    branchTab: "分支",
    consoleTab: "控制台",
    detachedHead: "分离的 HEAD",
    noCommitsYet: "暂无提交",
    pushOne: "Push {n} 个提交",
    pushOther: "Push {n} 个提交",
    pullOne: "从远程 Pull {n} 个提交",
    pullOther: "从远程 Pull {n} 个提交",
    fetchNewOne: "远程有 {n} 个新提交",
    fetchNewOther: "远程有 {n} 个新提交",
    pushUnpublished: "分支尚未发布",
    conflictOne: "{n} 个冲突",
    conflictOther: "{n} 个冲突",
    stoppedOnConflicts: "停在冲突上",
    changed: "{n} 项更改",
    staged: "{n} 项已暂存",
    untracked: "{n} 个未跟踪文件",
    continueOp: "继续",
    skipOp: "跳过此提交",
    abort: "中止",
    merging: "Merge 中",
    rebasing: "Rebase 中",
    interactiveRebase: "交互式 Rebase",
    cherryPicking: "Cherry-pick 中",
    reverting: "Revert 中",
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
    fileActionFailed: "无法修改文件",
    fileSaved: "文件已保存",
    filesSaved: "已保存 {n} 个文件",
    saveFileFailed: "无法保存文件",
    symbolLookupFailed: "无法搜索该名称",
    noUsages: "没有找到 {name} 的引用。",
    onlyUsage: "只有一处引用，已打开。",
    rollbackHunkTitle: "回滚这段修改",
    rollbackHunkMessage: "要丢弃 {path} 里的这段修改吗?",
    openConflictFailed: "无法打开冲突文件",
    copyFailed: "无法复制",
    copied: "已复制到剪贴板",
    gitFailed: "Git 命令失败",
    deleteBranchFailed: "无法删除分支",
    deleteTagFailed: "无法删除标签",
    deleteTagTitle: "删除标签",
    deleteTagMessage: "删除标签“{name}”？只会删除本地标签。",
    revealFailed: "无法在文件管理器中显示该文件",
    saveSettingsFailed: "无法保存设置",
    lastCommitMessage: "无法读取上一条提交信息",
    done: "完成",
    closeRepoTitle: "关闭仓库",
    closeRepoMessage: "关闭此仓库并返回欢迎界面？",
    close: "关闭",
    closeOthers: "关闭其他标签页",
    closeAllTabs: "关闭所有标签页",
    closeUnmodifiedTabs: "关闭未修改标签页",
    closeLeftTabs: "关闭左侧标签页",
    closeRightTabs: "关闭右侧标签页",
    tabWorkingTree: "工作区",
    tabIndex: "暂存区",
    rollback: "回滚",
    delete: "删除",
    rollbackFileTitle: "回滚文件",
    rollbackFileMessage: "放弃对 {path} 的所有更改？",
    rollbackChangesDetail: "文件将从 HEAD 恢复。此操作无法撤销。",
    forcePushTitle: "Force Push",
    forcePushMessage: "Force Push 会重写远程分支。是否继续？",
    forcePushDetail: "{ref} 将使用 --force-with-lease 更新。",
    currentBranch: "当前分支",
    deleteBranchTitle: "删除分支",
    deleteBranchCurrentTitle: "删除当前分支",
    deleteBranchMessage: "删除分支“{name}”？",
    deleteBranchCurrentDetail: "你当前位于该分支。Git 将拒绝删除已 Checkout 的分支。",
    branchNotMergedTitle: "分支未 Merge",
    branchNotMergedMessage: "“{name}”包含尚未 Merge 的提交。仍要删除吗？",
    forceDelete: "强制删除",
    hardResetTitle: "Hard Reset",
    hardResetMessage: "放弃所有本地更改并移动分支？",
    cannotUndo: "此操作无法撤销。",
    resetHard: "Hard Reset",
    rebaseTitle: "Rebase 分支",
    rebaseMessage: "将“{branch}”Rebase 到“{onto}”上？",
    rebaseDetail: "本地提交将重放到该分支之上。",
    rebase: "Rebase",
    revertTitle: "Revert 提交",
    revertMessage: "创建一个 Revert {hash} 的提交？",
    revert: "Revert",
    revertManyMessage: "创建 {n} 个 Revert 提交？",
    dropStashTitle: "删除 Stash",
    dropStashMessage: "删除 stash@{index}？",
    drop: "删除",
    abortTitle: "中止操作",
    abortMessage: "中止 {op} 操作并恢复之前的状态？",
    abortMessageCurrent: "中止当前操作并恢复之前的状态？",
    deleteChangelistTitle: "删除变更列表",
    deleteChangelistMessage: "删除“{name}”？其中的文件将移至默认变更列表。",
    ignoredPath: "已忽略",
    nothingToCommit: "没有可提交的内容",
    nothingToCommitMessage: "请在提交面板中至少勾选一个文件。",
    commitNeedsMessage: "提交需要填写提交信息",
    commitBlockedTitle: "请先解决冲突",
    commitBlockedMessage: "索引里还有 {n} 个冲突文件，未解决前 git 不会提交任何内容。",
    commitFailed: "提交失败",
    committed: "已提交 {hash}",
    checkedOut: "已 Checkout",
    branchDeleted: "分支已删除",
    branchReset: "分支已 Reset（{mode}）",
    merged: "已 Merge",
    rebaseFinished: "Rebase 完成",
    cherryPicked: "Cherry-pick 完成",
    reverted: "Revert 完成",
    tagCreated: "标签已创建",
    tagDeleted: "标签已删除",
    changesStashed: "更改已 Stash",
    stashPopped: "Stash pop 完成",
    stashApplied: "已应用 Stash",
    operationContinued: "操作已继续",
    operationAborted: "操作已中止",
    tookOurs: "已采用我方",
    tookTheirs: "已采用对方",
    settingsSaved: "设置已保存",
    conflictResolved: "冲突已解决",
    conflictSaved: "已保存，仍有未解决的冲突",
    simpleResolved: "已在 {n} 个文件中解决简单冲突",
    stillUnresolved: "还有 {n} 处冲突需要选择",
    branchCreated: "分支已创建",
    fetchAllRemotes: "Fetch 所有远程",
    fetchOrigin: "Fetch origin",
    pruneBranches: "清理已删除的分支",
    fetchTags: "Fetch 标签",
    operationPush: "Push",
    operationPull: "Pull",
    operationFetch: "Fetch",
    operationClone: "克隆",
    commitChecksTitle: "提交检查",
    commitSelectedNeedsFiles: "请勾选要提交其更改的文件。",
    protectedCommitTitle: "受保护分支",
    protectedCommitMessage: "{branch} 是受保护分支，仍要提交吗？",
    protectedForcePushTitle: "受保护分支",
    protectedForcePushMessage: "拒绝对受保护分支 {branch} 的强制推送。",
    pushRejectedTitle: "Push 被拒绝",
    pushRejectedMessage: "远端有当前分支没有的提交。更新分支后再推送？",
    branchUpdated: "分支已更新",
    resetToRemoteTitle: "重置到远端分支",
    resetToRemoteMessage: "把 {branch} 移到其上游，并丢弃仅它拥有的提交？",
    resetToRemote: "重置到远端",
    tagPushed: "标签已推送",
    clearStashesTitle: "清空所有 Stash",
    clearStashes: "清空所有 Stash",
    clearStashesMessage: "该仓库的所有 Stash 条目都会被删除，且无法撤销。",
    patchSaved: "补丁已保存",
    patchApplied: "补丁已应用",
    externalDiffFailed: "无法打开差异工具",
    commitChecksMessage: "发现 {n} 个问题，仍要提交吗？",
    commitAnyway: "仍然提交",
    amendSpecificTitle: "并入此提交",
    amendSpecificMessage: "把暂存区的更改并入 {hash}，并重放它之后的提交？",
    amendNeedsStaged: "请先暂存要并入此提交的更改。",
    fixupBySubject: "按提交信息 Fixup",
    commitRebaseNoUpstream: "当前分支没有可 Rebase 的上游。",
    undoCommitTitle: "撤销上次提交",
    undoCommitMessage: "HEAD 回退一次提交，其更改保留在暂存区。",
    undoCommit: "撤销提交",
    commitUndone: "已撤销提交",
    operationInit: "新建仓库",
    removeRemoteTitle: "删除远端",
    removeRemoteMessage: "删除 {name} 及其远程跟踪引用？",
    remoteAdded: "远端已添加",
    noRepoMessage: "打开一个 Git 仓库以开始使用。",
    openRepoEllipsis: "打开仓库…",
    cloneRepoEllipsis: "克隆…",
    createRepoEllipsis: "新建仓库…",
    welcomeHeadline: "Git，看得更清楚。",
    welcomeTagline: "审查更改、跟踪每个分支、逐行解决冲突，然后不离开窗口就能完成一次干净的提交。",
    openRepository: "打开仓库",
    recentRepositories: "最近的仓库",
    removeFromRecent: "从最近列表中移除",
    hintOpen: "打开",
    hintQuickOpen: "快速打开",
    hintCommit: "Commit",
    hintPush: "Push",
    hintUpdate: "Pull",
    noFileOpen: "没有打开的文件",
    emptyOpen: "选择文件、提交或冲突，在这里查看详情。",
    kindDiff: "差异",
    kindThree: "三侧差异",
    kindSource: "源码",
    kindMerge: "Merge",
    kindCommit: "提交",
    kindTree: "某个版本的仓库",
    treeAtRevision: "{rev} 处的仓库",
    treeFileOne: "{n} 个文件",
    treeFileOther: "{n} 个文件",
    copyHash: "复制哈希",
    filesChanged: "{n} 个文件已更改",
    openSourceAtCommit: "打开该提交下的源文件",
    showFileHistory: "查看文件历史",
    title: "{name} – GitJet",
    repoFallback: "仓库",
    rewriteTitle: "正在编辑历史",
    rewriteFinished: "历史已重写",
    rewriteRoot: "根提交无法重写",
    resolveConflicts: "解决冲突…",
    cleanupDone: "已删除 {n} 个分支",
    cleanupForceMessage: "{n} 个分支仍含未合并提交。强制删除？",
    cleanupMenu: "清理分支…",
    repoTools: "仓库工具…",
    worktreesMenu: "工作树…",
    submodulesMenu: "子模块…",
    stashRestored: "Stash 已恢复到分支 {branch}",
    readStashFiles: "读取 Stash 内容失败",
    openNewWindow: "打开新窗口失败",
  },
} as const;

type TKey = keyof typeof T["en"];
type Translate = (key: TKey, vars?: Record<string, string | number>) => string;

/** The dock's four pages, in the order Settings holds. The strip itself is not
 *  reorderable: the order is a preference, and dragging a tab in a strip that
 *  switches pages on click was the wrong place to edit one. */
function ToolTabs({
  tab,
  onSelect,
  order,
  changed,
  labels,
}: {
  tab: ToolTab;
  onSelect: (tab: ToolTab) => void;
  order: ToolTab[];
  changed: number;
  labels: Record<ToolTab, string>;
}) {
  return (
    <div className="toolwindow-tabs">
      {order.map((id) => (
        <button
          key={id}
          className={cx("toolwindow-tab", tab === id && "active")}
          title={labels[id]}
          onClick={() => onSelect(id)}
        >
          <Icon name={TOOL_TAB_ICONS[id]} />
          {labels[id]}
          {id === "commit" && changed > 0 && <span className="tab-count">{changed}</span>}
        </button>
      ))}
    </div>
  );
}

/** "all", "current", or the name of a branch. */

type Doc = { id: string; title: string } & (
  | { kind: "diff"; diff: FileDiff; opts: DiffOptions }
  | { kind: "three"; three: ThreeWayDiff; opts: DiffOptions }
  | {
      kind: "file";
      file: SourceFile;
      revision: string;
      line?: number;
      /** 1-based caret column beside `line`. */
      column?: number;
      /** Changes on every jump so a repeat to the same line re-reveals it. */
      reveal?: number;
    }
  | { kind: "commit"; detail: CommitDetail }
  | { kind: "tree"; revision: string; files: RepoFile[] }
);

type Dialog =
  | { kind: "settings" }
  | { kind: "newBranch"; start: string }
  | { kind: "renameBranch"; name: string }
  | { kind: "push"; setUpstream: boolean; branch?: string; upstream?: string }
  | { kind: "pull" }
  | { kind: "reset"; hash: string; subject: string }
  | { kind: "tag"; start: string }
  | { kind: "stash" }
  | { kind: "changelist"; mode: "new" | "rename"; id?: string; name?: string; comment?: string }
  | { kind: "merge" }
  | { kind: "editHistory"; onto: string }
  | { kind: "stashDetail"; index: number; refName: string }
  | { kind: "repoTools"; tab: "worktrees" | "submodules" | "shelves" | "lfs" }
  | { kind: "cleanupBranches" }
  | { kind: "conflicts" }
  | { kind: "compare"; ref: string }
  | { kind: "clone" }
  | { kind: "init" }
  | { kind: "remotes" }
  | { kind: "rebase"; onto: string }
  | { kind: "localHistory"; path: string }
  | { kind: "review" }
  | { kind: "rollback"; paths: string[] }
  | { kind: "pushCommits"; hash: string };

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
  allowEmpty: false,
  sign: false,
  authorName: "",
  authorEmail: "",
  stagedOnly: false,
};

/** The branch popup merges on the spot, as the IDE's does: git's own defaults
 *  are the options, and the branch's configured merge behaviour still applies. */
const defaultMergeOptions: Parameters<typeof Git.merge>[1] = {
  noFF: false,
  ffOnly: false,
  squash: false,
  message: "",
  noCommit: false,
  noVerify: false,
  allowUnrelatedHistories: false,
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
  const [recentBranches, setRecentBranches] = useState<string[]>([]);
  // Tabs were renamed once; keep an old stored "log" pointing at the branch page.
  const [storedTab, setStoredTab] = useStoredState<ToolTab | "log">("gitjet.tab", "commit");
  const tab: ToolTab = storedTab === "log" ? "branch" : storedTab;
  const setTab = (next: ToolTab) => setStoredTab(next);
  // The strip's order, dragged by the user; repaired when the stored value is
  // older or broken.
  const [storedOrder, setStoredOrder] = useStoredState<unknown>("gitjet.toolTabs", TOOL_TABS);
  const tabOrder = useMemo(() => normalizeTabOrder(storedOrder), [storedOrder]);
  const setTabOrder = (next: ToolTab[]) => setStoredOrder(next);
  const [docs, setDocs] = useState<Doc[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [dirtyDocs, setDirtyDocs] = useState<Set<string>>(new Set());
  // The word a Cmd-click asked about, and where it turns up.
  const [symbol, setSymbol] = useState<{
    word: string;
    language: string;
    hits: SymbolHit[] | null;
    source: "lsp" | "text";
    definitions?: string[];
    server?: string;
    origin: NavigationPoint;
  } | null>(null);
  // A declaration with several answers waits for the reader to pick one.
  const [targetChoice, setTargetChoice] = useState<TargetRequest | null>(null);
  // Where jumps started, for the IDE's back and forward keys.
  const [navHistory, setNavHistory] = useState<NavigationHistory>(emptyHistory());
  const navHistoryRef = useRef<NavigationHistory>(emptyHistory());
  const symbolSeq = useRef(0);
  const setHistoryState = (next: NavigationHistory) => {
    navHistoryRef.current = next;
    setNavHistory(next);
  };
  const [quickOpen, setQuickOpen] = useState(false);
  const [busy, setBusy] = useState(0);
  const [toast, setToast] = useState<{ kind: "info" | "success" | "error"; title: string; message?: string } | null>(null);
  // The session's notification history, newest first; the bell in the status
  // bar opens it, and the toast above it is only the transient view.
  const [notices, setNotices] = useState<Notice[]>([]);
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [op, setOp] = useState<OperationState | null>(null);
  const [opOpen, setOpOpen] = useState(false);
  const [fetchMenu, setFetchMenu] = useState<{ x: number; y: number } | null>(null);
  const [fetchOptions, setFetchOptions] = useStoredState("gitjet.fetchOptions", { prune: true, tags: true });
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);
  const [splitWidth, setSplitWidth] = useStoredState<number>("gitjet.split", 430);
  const [diffMode, setDiffMode] = useStoredState<"split" | "unified">("gitjet.diffMode", "split");
  const [diffWrap, setDiffWrap] = useStoredState<boolean>("gitjet.diffWrap", true);
  const [whitespace, setWhitespace] = useState<WhitespaceMode>("none");
  const [form, setForm] = useState<CommitForm>(emptyForm);
  const [history, setHistory] = useState<string[]>([]);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [searchInput, setSearchInput] = useState("");
  const [logSearch, setLogSearch] = useState("");
  const [logFilters, setLogFilters] = useState<LogFilters>({ since: "", until: "", regex: false, caseSensitive: false });
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
  // A line of that file, when the history was asked for from the gutter.
  const [logLine, setLogLine] = useState(0);
  // Branches whose history is listed; empty follows every local and
  // remote branch.
  const [logRefs, setLogRefs] = useState<string[]>([]);
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
  const dirtyDocsRef = useRef<Set<string>>(new Set());
  // RightPane installs its Save All here: the menu, the status bar and the
  // deactivation save all reach the one implementation that owns the drafts.
  const saveAllRef = useRef<(quiet?: boolean) => Promise<string[]>>(async () => []);
  const repoOpenRef = useRef(false);
  const refreshRef = useRef<(() => void) | null>(null);
  const amendBackup = useRef("");
  const logReq = useRef(0);
  // Author counts come from the unfiltered list so the menu stays complete
  // while a filter is applied.
  const authorCache = useRef<Map<string, AuthorOption>>(new Map());
  const opLines = useRef<string[]>([]);
  const lastOperationError = useRef("");
  const noticeSeq = useRef(0);
  const tRef = useRef(t);
  tRef.current = t;

  const repoOpen = !!snapshot;
  const branch = snapshot?.state.branch ?? "";
  const state = snapshot?.state;
  // Each file's conflict count when the merge started; markers is what is
  // left, so the dialog can show "1/3" while the file is half resolved.
  const conflictTotalsRef = useRef<Record<string, number>>({});
  const conflictTotals = useMemo(() => {
    const next: Record<string, number> = {};
    for (const c of snapshot?.conflicts ?? []) {
      next[c.path] = Math.max(conflictTotalsRef.current[c.path] ?? 0, c.markers);
    }
    conflictTotalsRef.current = next;
    return next;
  }, [snapshot]);
  // A branch that has never been pushed has no upstream; every commit on it
  // is still local, so push has work to do exactly like an ahead branch.
  const pushTodo =
    !state || state.detached || state.unborn
      ? ""
      : state.ahead > 0
        ? count(state.ahead, t("pushOne", { n: state.ahead }), t("pushOther", { n: state.ahead }))
        : state.upstream === ""
          ? t("pushUnpublished")
          : "";

  settingsRef.current = settings;
  snapshotRef.current = snapshot;
  docsRef.current = docs;
  activeIdRef.current = activeId;
  dirtyDocsRef.current = dirtyDocs;
  const activeDoc = docs.find((d) => d.id === activeId) ?? null;

  const notify = useCallback((kind: "info" | "success" | "error", title: string, message?: string) => {
    const notice: Notice = { id: ++noticeSeq.current, kind, title, message, at: Date.now() };
    setNotices((prev) => [notice, ...prev].slice(0, 200));
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
          all: logRefs.length === 0 && !logLine,
          refs: logRefs,
          path: logPath,
          line: logLine,
          search: logSearch,
          author: logAuthor,
          since: dayStart(logFilters.since),
          until: dayEnd(logFilters.until),
          follow: logPath !== "",
          regex: logFilters.regex,
          caseSensitive: logFilters.caseSensitive,
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
    [fail, logAuthor, logFilters, logPath, logLine, logRefs, logSearch, logResult?.commits.length, t],
  );

  const showFileRef = useRef<(path: string, revision?: string, line?: number, column?: number) => Promise<void>>(async () => {});
  const showPathRef = useRef<(path: string, revision?: string, line?: number, column?: number) => Promise<void>>(async () => {});
  // Bumped for every reveal so React re-runs the scroll effect even when a
  // jump lands on the line and column already in the props.
  const revealSeq = useRef(0);

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

  const setDocDirty = useCallback((id: string, dirty: boolean) => {
    setDirtyDocs((prev) => {
      if (prev.has(id) === dirty) return prev;
      const next = new Set(prev);
      if (dirty) next.add(id);
      else next.delete(id);
      return next;
    });
  }, []);

  const closeDocs = useCallback((ids: string[]) => {
    if (ids.length === 0) return;
    const drop = new Set(ids);
    setDocs((prev) => {
      const next = prev.filter((d) => !drop.has(d.id));
      const active = activeIdRef.current;
      if (active && drop.has(active)) {
        const index = prev.findIndex((d) => d.id === active);
        const fallback = next[Math.min(index, next.length - 1)];
        setActiveId(fallback ? fallback.id : null);
      }
      return next;
    });
    setDirtyDocs((prev) => {
      let next: Set<string> | null = null;
      for (const id of ids) {
        if (!prev.has(id)) continue;
        next ??= new Set(prev);
        next.delete(id);
      }
      return next ?? prev;
    });
  }, []);

  const closeDoc = useCallback((id: string) => closeDocs([id]), [closeDocs]);

  /** A close the user asked for: edited tabs ask before they are dropped. */
  const requestCloseDocs = (ids: string[]) => {
    const dirty = ids.filter((id) => dirtyDocsRef.current.has(id));
    if (dirty.length === 0) {
      closeDocs(ids);
      return;
    }
    // Closing a tab is not a decision about saving: the edits go to disk
    // first, as IDEA keeps an edited document when its tab closes. A write
    // that failed keeps the tab open and its text in memory.
    void saveAllRef.current(true).then((still) => {
      if (dirty.some((id) => still.includes(id))) return;
      closeDocs(ids);
    });
  };

  const requestCloseDoc = (id: string) => requestCloseDocs([id]);

  /** One editor tab per commit: arrow keys switch the file inside it. */
  const openCommitFile = useCallback(
    async (hash: string, file: CommitFile) => {
      const opts: DiffOptions = {
        path: file.path,
        oldPath: file.oldPath ?? "",
        target: "commit",
        revision: hash,
        from: "",
        context: settingsRef.current?.diffContext ?? -1,
        whitespace: "none",
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

  const openRevisionTree = async (revision: string) => {
    try {
      const files = await Git.treeAtRevision(revision);
      openDoc({ id: `tree:${revision}`, title: `${revision.slice(0, 8)} @`, kind: "tree", revision, files });
    } catch (err) {
      fail(t("gitFailed"), err);
    }
  };

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
        setRecentBranches(await Git.recentBranches().catch(() => []));
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

  /** Writes one Save All pass, then refreshes the repository once. The saved
   *  text is put into the open documents immediately so a mounted tab does
   *  not wait for the refresh. Returns the ids that reached disk; a failure
   *  keeps its document dirty and is reported once, after the writes. */
  const saveFiles = useCallback(
    async (entries: { id: string; path: string; text: string }[], quiet: boolean) => {
      const saved: string[] = [];
      const written = new Map<string, string>();
      let failure: unknown = null;
      for (const entry of entries) {
        try {
          await Git.saveFile(entry.path, entry.text);
          saved.push(entry.id);
          written.set(entry.path, entry.text);
        } catch (err) {
          failure ??= err;
        }
      }
      if (saved.length > 0) {
        setDocs((prev) =>
          prev.map((d) => {
            if (d.kind !== "file" || d.revision !== "") return d;
            const text = written.get(d.file.path);
            if (text === undefined) return d;
            return { ...d, file: { ...d.file, text, size: new TextEncoder().encode(text).length } };
          }),
        );
        setDirtyDocs((prev) => {
          let next: Set<string> | null = null;
          for (const id of saved) {
            if (!prev.has(id)) continue;
            next ??= new Set(prev);
            next.delete(id);
          }
          return next ?? prev;
        });
        await reload(false);
        // An automatic save is silent: a toast per pause in typing would be
        // noise, while the tab's dot already reports the state.
        if (!quiet) {
          const paths = entries.filter((entry) => saved.includes(entry.id)).map((entry) => entry.path);
          if (paths.length === 1) notify("success", t("fileSaved"), paths[0]);
          else notify("success", t("filesSaved", { n: paths.length }));
        }
      }
      if (failure) fail(t("saveFileFailed"), failure);
      return saved;
    },
    [fail, notify, reload, t],
  );

  // IDEA's "Save files on frame deactivation": every unsaved tab is written,
  // not only the one whose editor is mounted. The setting is IDEA's own
  // GeneralSettings.isSaveOnFrameDeactivation.
  useEffect(() => {
    if (!settings?.saveOnDeactivation) return;
    const flush = () => void saveAllRef.current(true);
    window.addEventListener("blur", flush);
    return () => window.removeEventListener("blur", flush);
  }, [settings?.saveOnDeactivation]);

  // A window close or an app quit with edited tabs is deferred by the host
  // until this page has written them; the count is what the host checks.
  useEffect(() => {
    void Workspace.setUnsaved(dirtyDocs.size);
  }, [dirtyDocs.size]);

  // A definition jump opens the file it lands in, through the same dock tab
  // the reader would have opened by hand.
  useEffect(() => {
    setDocumentOpener(async (path) => {
      await showPathRef.current(path, "");
    });
    return () => setDocumentOpener(null);
  }, []);

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
        setBoot({ settings: { version: 2, gitPath: "", sshCommand: "", fetchTagsMode: "auto", language: "system", theme: "system", diffContext: -1, saveOnDeactivation: true, autoSaveIdle: false, autoSaveIdleSeconds: 15, ignoreWhitespace: false, showIgnored: false, autoFetch: false, autoFetchMinutes: 15, updateMethod: "merge", confirmForcePush: true, confirmRollback: true, rollbackDeleteAdded: false, commitCheckCrlf: true, commitCheckLargeMB: 10, commitCheckNames: true, commitCheckHead: true, commitTemplate: "", protectedBranches: [], autoUpdateOnReject: true, openInNewWindow: false, uiScale: 100, recent: [] }, repo: null, error: String(err), version: "", platform: "" });
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
  }, [logAuthor, logSearch, logPath, logLine, logRefs, logFilters, snapshot?.state.head]);

  useEffect(() => {
    if (!snapshot) return;
    document.title = t("title", { name: snapshot.state.name || t("repoFallback") });
  }, [snapshot?.state.name, t]);

  // Dialogs are sized against the window, and a viewport unit is not the
  // window when the root is zoomed; publish the real height instead.
  useEffect(() => {
    const sync = () => document.documentElement.style.setProperty("--window-h", `${window.innerHeight}px`);
    sync();
    window.addEventListener("resize", sync);
    return () => window.removeEventListener("resize", sync);
  }, []);

  function applyTheme(s: Settings) {
    document.documentElement.dataset.theme = s.theme;
    // One scale for the whole window, so code, tables and labels keep their
    // proportions instead of drifting apart.
    document.documentElement.style.zoom = `${(s.uiScale || 100) / 100}`;
    document.documentElement.lang = resolveLang(s.language);
    onLangChange(resolveLang(s.language));
    // A toast created before the switch would keep the old language.
    setToast(null);
    setWhitespace(s.ignoreWhitespace ? "whitespace" : "none");
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
    if (dirtyDocsRef.current.size > 0) {
      const dirty = [...dirtyDocsRef.current];
      const still = await saveAllRef.current(true);
      if (dirty.some((id) => still.includes(id))) return;
    }
    setBusy((n) => n + 1);
    try {
      const snap = await Workspace.open(chosen);
      // The previous repository's language server died with it.
      void disconnectLSP();
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
      setDirtyDocs(new Set());
      setForm({ ...emptyForm, message: freshSettings.commitTemplate });
      setLogResult(null);
      setSelectedCommit(null);
      setLogDetail(null);
      setLogFile(null);
      setLogPath("");
      setLogLine(0);
      setLogRefs([]);
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

  // openNewRepo shows a repository the app just created: another window
  // when one is already open, so nothing unsaved here is dropped.
  const openNewRepo = async (dir: string) => {
    if (repoOpenRef.current) {
      try {
        await Workspace.openInWindow(dir);
      } catch (err) {
        fail(t("openRepoFailed"), err);
      }
      return;
    }
    await openRepo(dir);
  };

  const cloneRepo = async (url: string, dir: string) => {
    setDialog(null);
    const ok = await runOperation(t("operationClone"), "fetch", (channel) => Workspace.clone(url, dir, channel));
    if (ok) await openNewRepo(dir);
  };

  const initRepo = async (dir: string, branch: string) => {
    setDialog(null);
    const ok = await runOperation(t("operationInit"), "commit", () => Workspace.init(dir, branch));
    if (ok) await openNewRepo(dir);
  };

  const addRemote = async (name: string, url: string) =>
    withBusy(async () => {
      await Git.addRemote(name, url);
      notify("success", t("remoteAdded"), name);
      await reload(false);
    });

  const saveRemoteURL = async (name: string, url: string) =>
    withBusy(async () => {
      await Git.setRemoteURL(name, url);
      await reload(false);
    });

  const renameRemote = async (oldName: string, newName: string) =>
    withBusy(async () => {
      await Git.renameRemote(oldName, newName);
      await reload(false);
    });

  const removeRemote = async (name: string) => {
    const ok = await ask({
      title: t("removeRemoteTitle"),
      message: t("removeRemoteMessage", { name }),
      confirmLabel: t("removeRemoteTitle"),
      danger: true,
    });
    if (!ok) return;
    await withBusy(async () => {
      await Git.removeRemote(name);
      await reload(false);
    });
  };

  const closeRepo = async () => {
    const dirty = [...dirtyDocsRef.current];
    const ok = await ask({
      title: t("closeRepoTitle"),
      message: t("closeRepoMessage"),
      confirmLabel: t("close"),
    });
    if (!ok) return;
    if (dirty.length > 0) {
      const still = await saveAllRef.current(true);
      if (dirty.some((id) => still.includes(id))) return;
    }
    await Workspace.close();
    void disconnectLSP();
    repoOpenRef.current = false;
    snapshotRef.current = null;
    setSnapshot(null);
    setRefs(null);
    setDocs([]);
    setActiveId(null);
    setDirtyDocs(new Set());
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

  const showFile = async (path: string, revision = "", line?: number, column?: number) => {
    try {
      const same = docsRef.current.find(
        (doc): doc is Extract<Doc, { kind: "file" }> =>
          doc.kind === "file" && doc.file.path === path && doc.revision === revision,
      );
      if (same) {
        if (line !== undefined) openDoc({ ...same, line, column, reveal: ++revealSeq.current });
        else setActiveId(same.id);
        return;
      }
      // The working tree and HEAD are two states of one file, so they share
      // one editor tab; a dirty buffer keeps its own tab, and the index or a
      // historical revision opens beside it rather than replacing it. The
      // lookup is by path and state, not by a fixed id, so a tab opened
      // before the pair was unified is adopted instead of duplicated.
      const sharedId = `file:${path}`;
      const shared = revision === "" || revision === "HEAD";
      const current = docsRef.current.find(
        (doc): doc is Extract<Doc, { kind: "file" }> =>
          doc.kind === "file" &&
          doc.file.path === path &&
          (doc.revision === "" || doc.revision === "HEAD"),
      );
      const reuse = shared && current !== undefined && !dirtyDocsRef.current.has(current.id);
      const id = reuse ? current.id : shared ? `${sharedId}@${revision || "worktree"}` : `${sharedId}@${revision}`;
      const file = await Git.file(path, revision);
      openDoc({
        id,
        title: path,
        kind: "file",
        file,
        revision,
        line,
        column,
        reveal: line !== undefined ? ++revealSeq.current : undefined,
      });
    } catch (err) {
      fail(t("openFileFailed"), err);
    }
  };
  showFileRef.current = showFile;

  /** A file the language server named outside the repository, such as a
   *  standard-library source. It opens read-only, beside the repository
   *  files, and never goes through git. */
  const showExternal = async (path: string, line?: number, column?: number) => {
    try {
      const same = docsRef.current.find(
        (doc): doc is Extract<Doc, { kind: "file" }> =>
          doc.kind === "file" && doc.file.path === path && doc.revision === "EXTERNAL",
      );
      if (same) {
        if (line !== undefined) openDoc({ ...same, line, column, reveal: ++revealSeq.current });
        else setActiveId(same.id);
        return;
      }
      const file = await Git.externalFile(path);
      openDoc({
        id: `external:${path}`,
        title: baseName(path),
        kind: "file",
        file,
        revision: "EXTERNAL",
        line,
        column,
        reveal: line !== undefined ? ++revealSeq.current : undefined,
      });
    } catch (err) {
      fail(t("openFileFailed"), err);
    }
  };

  /** Opens a path from a jump: a file URI arrives absolute, while every
   *  ordinary dock action already speaks git paths. */
  const showPath = async (path: string, revision = "", line?: number, column?: number) => {
    if (revision === "EXTERNAL") {
      await showExternal(path, line, column);
      return;
    }
    const target = resolveOpenPath(snapshotRef.current?.state.root ?? "", path);
    if (target.scope === "repo") {
      await showFile(target.path, revision, line, column);
      return;
    }
    await showExternal(target.path, line, column);
  };
  showPathRef.current = showPath;

  /** The absolute path a git path names, for a URI the page builds itself. */
  const absolutePathFor = (path: string): string => {
    const root = snapshotRef.current?.state.root ?? "";
    return isAbsolutePath(path) || root === "" ? path : joinRoot(root, path);
  };

  const diffOptionsForEntry = (entry: FileEntry): DiffOptions => ({
    path: entry.path,
    target: entry.staged ? "staged" : "worktree",
    revision: "",
    from: "",
    context: settings?.diffContext ?? -1,
    whitespace,
    noText: false,
  });

  const openEntryDiff = (entry: FileEntry) => {
    if (entry.unmerged) {
      void openConflict(entry.path);
      return;
    }
    void showDiff(diffOptionsForEntry(entry), entry.path);
  };

  const showThreeWay = async (entry: FileEntry) => {
    if (entry.unmerged) {
      void openConflict(entry.path);
      return;
    }
    const opts = diffOptionsForEntry(entry);
    setDiffBusy(true);
    try {
      const three = await Git.threeWay(opts);
      openDoc({ id: `three:${entry.path}`, title: entry.path, kind: "three", three, opts });
    } catch (err) {
      fail(t("showDiffFailed"), err);
    } finally {
      setDiffBusy(false);
    }
  };

  const showFileDiff = async (path: string, revision: string) => {
    const context = settingsRef.current?.diffContext ?? -1;
    const base: DiffOptions = {
      path,
      target: "worktree",
      revision: "",
      from: "",
      context,
      whitespace,
      noText: false,
    };
    if (revision === "" || revision === "WORKTREE") {
      await showDiff({ ...base, target: "worktree" }, path);
    } else if (revision === "HEAD") {
      // A HEAD view shows the commit against what is on disk, not the index:
      // the index has its own transition in the Changes list.
      await showDiff({ ...base, target: "head" }, path);
    } else if (revision === "INDEX") {
      await showDiff({ ...base, target: "staged" }, path);
    } else {
      await showDiff({ ...base, target: "commit", revision }, path);
    }
  };

  /** F7 past the last change of a working-tree diff opens the next changed
   *  file in the same tab, the way IDEA walks a change set. */
  const nextDiffFile = (path: string, revision: string, delta: 1 | -1) => {
    const list = (snapshotRef.current?.changes ?? []).map((change) => change.path);
    if (list.length === 0) return;
    const at = list.indexOf(path);
    const next =
      at < 0 ? (delta > 0 ? list[0] : list[list.length - 1]) : list[(at + delta + list.length) % list.length];
    if (!next || next === path) return;
    const from = activeIdRef.current;
    void showFileDiff(next, revision).then(() => {
      if (from) closeDoc(from);
    });
  };

  // Every merge editor is its own window: the repository window keeps its
  // docks and tabs, exactly as IDEA leaves them.
  const openConflict = async (path: string) => {
    try {
      await Workspace.openMergeWindow(path);
    } catch (err) {
      fail(t("openConflictFailed"), err);
    }
  };

  const openConflictSummary = () => {
    if ((snapshotRef.current?.conflicts ?? []).length === 0) return false;
    setDialog({ kind: "conflicts" });
    return true;
  };

  const chooseWhitespace = (mode: WhitespaceMode) => {
    setWhitespace(mode);
    const active = docsRef.current.find((d) => d.id === activeIdRef.current);
    if (active?.kind === "diff") {
      void showDiff({ ...active.opts, whitespace: mode }, active.title);
    }
  };

  const copyText = (text: string) => {
    void Workspace.copy(text).then(
      () => notify("info", t("copied")),
      (err) => fail(t("copyFailed"), err),
    );
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

  // git leaves a stopped operation behind with the paths it could not merge:
  // the merge/rebase/cherry-pick/revert is in progress and those paths are
  // listed as conflicts. That is a state to work in, not a failed command.
  const stoppedOnConflicts = () => {
    const snap = snapshotRef.current;
    return (snap?.conflicts.length ?? 0) > 0 && (snap?.state.operation ?? "") !== "";
  };

  const conflictSummary = () => {
    const n = snapshotRef.current?.conflicts.length ?? 0;
    return count(n, t("conflictOne", { n }), t("conflictOther", { n }));
  };

  // withConflicts is withBusy for the commands that can stop on a conflict:
  // a failure is reloaded and, when the operation stopped with conflicts
  // left, reported as that stop and handed to the first conflicted file.
  const withConflicts = async <T,>(fn: () => Promise<T>): Promise<T | undefined> => {
    setBusy((n) => n + 1);
    try {
      return await fn();
    } catch (err) {
      await reload(false);
      if (stoppedOnConflicts()) {
        notify("info", t("stoppedOnConflicts"), conflictSummary());
        openConflictSummary();
        void loadLog(true);
      } else {
        fail(t("gitFailed"), err);
      }
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

  const runRollback = async (paths: string[], deleteAdded: boolean) => {
    await withBusy(async () => {
      await Git.rollback(paths, deleteAdded);
      await reload(false);
    });
  };

  // IDEA's rollback: the action covers the selection, or every local change
  // when nothing is selected, and the dialog decides whether added files
  // keep their local copy. With confirmation off the saved choice applies.
  const rollback = (paths: string[]) => {
    const snap = snapshotRef.current;
    if (!snap) return;
    const eligible = [
      ...new Set(
        snap.changes
          .filter((c) => !c.unmerged && c.kind !== "ignored" && c.kind !== "conflict")
          .map((c) => c.path),
      ),
    ];
    const picked = paths.filter((p) => eligible.includes(p));
    const targets = picked.length > 0 ? picked : eligible;
    if (targets.length === 0) return;
    const current = settingsRef.current;
    if (!current || !current.confirmRollback) {
      void runRollback(targets, current?.rollbackDeleteAdded ?? false);
      return;
    }
    setDialog({ kind: "rollback", paths: targets });
  };

  // The checkbox is a remembered preference, as IDEA's PropertiesComponent
  // value is: toggling it writes the setting, confirming the dialog does not.
  const rememberRollbackDeleteAdded = async (deleteAdded: boolean) => {
    const current = settingsRef.current;
    if (!current || current.rollbackDeleteAdded === deleteAdded) return;
    try {
      const saved = await Workspace.saveSettings({ ...current, rollbackDeleteAdded: deleteAdded });
      settingsRef.current = saved;
      setSettings(saved);
    } catch (err) {
      fail(t("saveSettingsFailed"), err);
    }
  };

  const ignorePaths = (paths: string[]) =>
    withBusy(async () => {
      const file = await Git.ignore(paths);
      notify("success", t("ignoredPath"), file);
      await reload(false);
    });

  const applyHunk = (opts: DiffOptions, hunk: number, action: "stage" | "unstage" | "rollback") =>
    withBusy(async () => {
      await Git.applyHunk(opts, hunk, action);
      await reload(false);
      const diff = await Git.diff(opts);
      openDoc({ id: `diff:${opts.target}:${opts.revision}:${opts.path}`, title: opts.path, kind: "diff", diff, opts });
    });

  /** Fold the index into an older commit, then replay its descendants. */
  const amendSpecific = async (hash: string) => {
    const snap = snapshotRef.current;
    if (!snap?.changes.some((c) => c.staged)) {
      notify("error", t("amendSpecificTitle"), t("amendNeedsStaged"));
      return;
    }
    const commit = logResult?.commits.find((c) => c.hash === hash);
    const ok = await ask({
      title: t("amendSpecificTitle"),
      message: t("amendSpecificMessage", { hash: commit?.short ?? hash.slice(0, 7) }),
      confirmLabel: t("amendSpecificTitle"),
    });
    if (!ok) return;
    await withBusy(async () => {
      const result = await Git.amendCommit(hash, "");
      notify("success", t("committed", { hash: result.short }), result.subject);
      await reload(false);
      void loadLog(true);
    });
  };

  /** A fixup! commit aimed at the commit whose subject was picked. */
  const fixupBySubject = async (subject: string) => {
    await withBusy(async () => {
      const result = await Git.commitFixupBySubject(subject, false);
      notify("success", t("committed", { hash: result.short }), result.subject);
      await reload(false);
      void loadLog(true);
    });
  };

  /** A fixup! or squash! commit for hash, folded in by an autosquash rebase. */
  const commitFixup = async (hash: string, squash: boolean) => {
    await withBusy(async () => {
      const result = await Git.commitFixup(hash, squash);
      notify("success", t("committed", { hash: result.short }), result.subject);
      await reload(false);
      void loadLog(true);
    });
  };

  /** Undo Commit: HEAD moves back one commit and its changes stay staged. */
  const undoCommit = async () => {
    const ok = await ask({
      title: t("undoCommitTitle"),
      message: t("undoCommitMessage"),
      confirmLabel: t("undoCommit"),
    });
    if (!ok) return;
    await withBusy(async () => {
      const result = await Git.undoCommit();
      setForm((f) => ({ ...f, message: result.output || f.message, amend: false }));
      setHistory(await Git.messageHistory().catch(() => []));
      notify("success", t("commitUndone"), result.subject);
      await reload(false);
      void loadLog(true);
    });
  };

  /** Stage, unstage or roll back only the lines picked in the diff. */
  const applyLines = (opts: DiffOptions, lines: number[], action: "stage" | "unstage" | "rollback") =>
    withBusy(async () => {
      await Git.applyLines(opts, lines, action);
      await reload(false);
      try {
        const diff = await Git.diff(opts);
        openDoc({ id: `diff:${opts.target}:${opts.revision}:${opts.path}`, title: opts.path, kind: "diff", diff, opts });
      } catch {
        closeDoc(`diff:${opts.target}:${opts.revision}:${opts.path}`);
      }
    });

  const threeSideOpts = (doc: Extract<Doc, { kind: "three" }>, side: "staged" | "unstaged"): DiffOptions => ({
    ...doc.opts,
    target: side === "staged" ? "staged" : "worktree",
    revision: "",
    from: "",
  });

  const refreshThree = async (doc: Extract<Doc, { kind: "three" }>) => {
    try {
      const three = await Git.threeWay(doc.opts);
      openDoc({ ...doc, three });
    } catch {
      closeDoc(doc.id);
    }
  };

  const applyThreeHunk = (
    side: "staged" | "unstaged",
    hunk: number,
    action: "stage" | "unstage" | "rollback",
  ) =>
    withBusy(async () => {
      const active = docsRef.current.find((d) => d.id === activeIdRef.current);
      if (active?.kind !== "three") return;
      await Git.applyHunk(threeSideOpts(active, side), hunk, action);
      await reload(false);
      await refreshThree(active);
    });

  const applyThreeFile = (side: "staged" | "unstaged", action: "stage" | "unstage" | "rollback") => {
    const active = docsRef.current.find((d) => d.id === activeIdRef.current);
    if (active?.kind !== "three") return;
    const run = () =>
      withBusy(async () => {
        await Git.applyFile(threeSideOpts(active, side), action);
        await reload(false);
        await refreshThree(active);
      });
    if (action === "rollback") {
      void ask({
        title: t("rollbackFileTitle"),
        message: t("rollbackFileMessage", { path: active.opts.path }),
        confirmLabel: t("rollback"),
        danger: true,
      }).then((ok) => {
        if (ok) void run();
      });
      return;
    }
    void run();
  };

  /** Alt-click on a change bar: roll back only that line. */
  const rollbackEditorLine = async (path: string, line: number) => {
    // The bars and their line numbers come from the editor's own diff, so
    // the patch is built from the same options.
    const opts = gutterDiffOptions(path);
    await withBusy(async () => {
      await Git.applyLines(opts, [line], "rollback");
      await reload(false);
    });
  };

  /** Records both ends of a jump. Repeating the point already at the top of
   *  the history does nothing, so opening a usage from the file it is in does
   *  not fill the list. */
  const recordJump = (from: NavigationPoint, to: NavigationPoint) => {
    let next = recordPoint(navHistoryRef.current, from);
    next = recordPoint(next, to);
    setHistoryState(next);
  };

  /** Cmd/Ctrl+Alt+Left and the toolbar arrows: IDEA's navigation history. */
  const navigateHistory = (delta: -1 | 1) => {
    const next = stepHistory(navHistoryRef.current, delta);
    if (!next) return;
    const point = next.entries[next.index];
    if (!point) return;
    setHistoryState(next);
    void showPath(point.path, point.revision ?? "", point.line, point.column);
  };

  /** Cmd-click or F12 on a word without a language server: search the
   *  working tree, then read the result the way the server path reads its
   *  answer. A click on a usage jumps to the one declaration the search
   *  found; a click on the declaration itself lists its uses instead of
   *  navigating to the line already on screen. */
  const lookUpSymbol = async (
    word: string,
    language: string,
    origin: NavigationPoint,
    action: "jump" | "list",
    anchor?: { x: number; y: number },
  ) => {
    const seq = ++symbolSeq.current;
    let hits: SymbolHit[];
    try {
      hits = (await Git.searchSymbol(word, 300)).hits;
    } catch (err) {
      if (seq !== symbolSeq.current) return;
      fail(t("symbolLookupFailed"), err);
      return;
    }
    if (seq !== symbolSeq.current) return;
    if (action === "list") {
      setSymbol({ word, language, hits, source: "text", origin });
      return;
    }
    const plan = planTextJump(word, language, origin, hits);
    if (plan.kind === "target" || plan.kind === "choose") {
      const found = plan.kind === "target" ? [plan.hit] : plan.hits;
      const targets: NavigationTarget[] = found.map((hit) => {
        const column = Math.max(hit.column, 1);
        return {
          uri: toUri(absolutePathFor(hit.path)),
          path: hit.path,
          line: hit.line,
          column,
          endLine: hit.line,
          endColumn: column + word.length,
        };
      });
      if (plan.kind === "target") {
        const target = targets[0]!;
        if (await openNavigationTarget(target)) {
          recordJump(origin, targetPoint(target));
        } else {
          notify("error", t("openFileFailed"), target.path);
        }
        return;
      }
      setTargetChoice({ kind: "targets", word, targetKind: "definition", targets, origin, anchor });
      return;
    }
    setSymbol({ word, language, hits, source: "text", origin });
  };

  /** Fill a language server's answer with the working-tree text of each
   *  line, so the usage list reads like IDEA's instead of path:line only. A
   *  single usage opens at once, and no usage is a hint rather than an empty
   *  list, both as IDEA's Show Usages does. */
  const showUsages = async (request: UsageRequest) => {
    const uses = usageTargets(request.definitions, request.targets);
    if (uses.length === 0) {
      notify("info", t("noUsages", { name: request.word }));
      return;
    }
    if (uses.length === 1) {
      const target = uses[0]!;
      if (!(await openNavigationTarget(target))) {
        notify("error", t("openFileFailed"), target.path);
        return;
      }
      recordJump(request.origin, targetPoint(target));
      notify("info", t("onlyUsage"));
      return;
    }
    const seq = ++symbolSeq.current;
    const merged = mergeNavigationTargets(request.definitions, request.targets);
    const definitions = request.definitions.map(targetKey);
    const server = lspServerName();
    setSymbol({
      word: request.word,
      language: "",
      hits: null,
      source: "lsp",
      definitions,
      server,
      origin: request.origin,
    });
    try {
      const texts = merged.length
        ? await Git.lineTexts(merged.map((target) => ({ path: target.path, line: target.line })))
        : [];
      if (seq !== symbolSeq.current) return;
      setSymbol((current) => (current ? { ...current, hits: targetsToHits(merged, texts) } : current));
    } catch {
      if (seq !== symbolSeq.current) return;
      setSymbol((current) => (current ? { ...current, hits: [] } : current));
    }
  };

  /** A declaration chooser was answered: open it and remember the trip. */
  const chooseTarget = (target: NavigationTarget) => {
    const request = targetChoice;
    if (!request) return;
    setTargetChoice(null);
    void (async () => {
      if (!(await openNavigationTarget(target))) {
        notify("error", t("openFileFailed"), target.path);
        return;
      }
      recordJump(request.origin, targetPoint(target));
    })();
  };

  /** The editor asks the app to show what a language server answered. */
  const handleEditorNavigation = (request: EditorNavigationRequest) => {
    switch (request.kind) {
      case "text":
        void lookUpSymbol(request.word, request.language, request.origin, request.action, request.anchor);
        break;
      case "targets":
        setTargetChoice(request);
        break;
      case "usages":
        void showUsages(request);
        break;
      case "notice":
        notify("info", request.message);
        break;
    }
  };

  /** Roll back the hunk under a change bar in the source editor. A hunk
   * index only means something for the patch the bars were built from, so
   * this uses the editor's context and not the viewer's "whole file". */
  const rollbackEditorHunk = async (path: string, hunk: number) => {
    const opts = gutterDiffOptions(path);
    if (settingsRef.current?.confirmRollback) {
      const ok = await ask({
        title: t("rollbackHunkTitle"),
        message: t("rollbackHunkMessage", { path }),
        detail: t("rollbackChangesDetail"),
        confirmLabel: t("rollback"),
        danger: true,
      });
      if (!ok) return;
    }
    await withBusy(async () => {
      await Git.applyHunk(opts, hunk, "rollback");
      await reload(false);
    });
  };

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

  const commit = async (pushAfter: boolean, rebaseAfter = false, selectedOnly = false, allChanges = false) => {
    if (!snapshot) return;
    // Every commit is refused while the index holds unmerged entries, so say
    // what blocks it and show the files instead of surfacing git's error.
    if (snapshot.conflicts.length > 0) {
      notify("error", t("commitBlockedTitle"), t("commitBlockedMessage", { n: snapshot.conflicts.length }));
      openConflictSummary();
      return;
    }
    const eligible = new Set<string>();
    const stagedEligible = new Set<string>();
    for (const c of snapshot.changes) {
      if (c.unmerged || c.kind === "ignored" || c.kind === "conflict") continue;
      eligible.add(c.path);
      if (c.staged) stagedEligible.add(c.path);
    }
    const paths = allChanges || form.stagedOnly ? [...eligible] : [...checked].filter((p) => eligible.has(p));
    const stagedPaths = allChanges ? [...stagedEligible] : [...checked].filter((p) => stagedEligible.has(p));
    const count = form.stagedOnly ? stagedEligible.size : paths.length;
    if (count === 0 && !form.amend && !form.allowEmpty) {
      notify("error", t("nothingToCommit"), t("nothingToCommitMessage"));
      return;
    }
    if (form.message.trim() === "" && !form.amend) {
      notify("error", t("commitNeedsMessage"));
      return;
    }
    if (isProtectedBranch(branch, settingsRef.current?.protectedBranches ?? [])) {
      const ok = await ask({
        title: t("protectedCommitTitle"),
        message: t("protectedCommitMessage", { branch }),
        confirmLabel: t("commitAnyway"),
      });
      if (!ok) return;
    }
    const checkPaths = form.stagedOnly ? stagedPaths : paths;
    const warnings = await Git.commitChecks(checkPaths).catch(() => []);
    if (warnings.length > 0) {
      const ok = await ask({
        title: t("commitChecksTitle"),
        message: t("commitChecksMessage", { n: warnings.length }),
        detail: warnings
          .map((w) => (w.path ? `${w.path}: ${w.message}` : w.message))
          .join("\n"),
        confirmLabel: t("commitAnyway"),
      });
      if (!ok) return;
    }
    const options = {
      message: form.message,
      paths,
      amend: form.amend,
      signOff: form.signOff,
      noVerify: form.noVerify,
      allowEmpty: form.allowEmpty,
      sign: form.sign,
      authorName: form.authorName,
      authorEmail: form.authorEmail,
      stagedOnly: selectedOnly || allChanges ? false : form.stagedOnly,
    };
    if (selectedOnly && paths.length === 0) {
      notify("error", t("nothingToCommit"), t("commitSelectedNeedsFiles"));
      return;
    }
    const ok = await withBusy(async () => {
      if (allChanges) return Git.commitAll(options);
      if (selectedOnly) return Git.commitSelected(options);
      return Git.commit(options);
    }, t("commitFailed"));
    if (!ok) return;
    notify("success", t("committed", { hash: ok.short }), ok.subject);
    setForm((f) => ({ ...f, message: settingsRef.current?.commitTemplate ?? "", amend: false }));
    amendBackup.current = "";
    setHistory(await Git.messageHistory().catch(() => []));
    await reload(false);
    void loadLog(true);
    if (rebaseAfter) {
      const upstream = snapshotRef.current?.state.upstream ?? "";
      if (upstream === "") {
        notify("error", t("rebaseFinished"), t("commitRebaseNoUpstream"));
        return;
      }
      await withConflicts(async () => {
        await Git.rebase({ onto: upstream, branch: "", autostash: true, updateRefs: false, rebaseMerges: false, empty: "", root: false, autoSquash: "" });
        notify("success", t("rebaseFinished"));
        await reload(false);
      });
      return;
    }
    if (pushAfter) {
      setDialog({ kind: "push", setUpstream: !snapshot.state.upstream, upstream: snapshot.state.upstream });
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
  ): Promise<boolean> => {
    opLines.current = [];
    setOp({ title, icon, lines: [], running: true, startedAt: Date.now() });
    setOpOpen(false);
    const update = (patch: Partial<OperationState>) => {
      setOp((prev) => (prev ? { ...prev, ...patch, lines: [...opLines.current] } : prev));
    };
    const channel = new Channel<string>();
    let failed: string | undefined;
    lastOperationError.current = "";
    try {
      const promise = fn(channel);
      for await (const line of channel) {
        opLines.current.push(line);
        if (opLines.current.length > 2000) opLines.current.splice(0, opLines.current.length - 2000);
        update({});
      }
      const out = await promise;
      const tail = out.split("\n").map((l) => l.trim()).filter(Boolean);
      const commands = tail.filter((l) => l.startsWith("$ "));
      // The streamed command is already the first line.
      const unseen = commands.filter((l) => !opLines.current.includes(l));
      if (unseen.length > 0) {
        opLines.current.push(...unseen);
      }
      // The collapsed dock shows the command the operation ran, so the
      // user can see (and copy from the expanded log) what git was asked.
      const command = commands[commands.length - 1];
      const first = [...tail].reverse().find((l) => !l.startsWith("$ "));
      update({ running: false, success: command ?? (first || t("done")) });
    } catch (err) {
      failed = err instanceof Error ? err.message : String(err);
      lastOperationError.current = failed;
    }
    await reload(false);
    // A pull that stops on a conflict is the start of the resolution, not a
    // failed command: the refreshed conflict list already says what is left.
    if (failed !== undefined) {
      if (stoppedOnConflicts()) {
        update({ running: false, success: t("stoppedOnConflicts") });
        notify("info", t("stoppedOnConflicts"), conflictSummary());
      } else {
        update({ running: false, error: failed });
      }
    }
    void loadLog(true);
    return failed === undefined;
  };

  // runQuiet shows the output of a quick operation, including the git
  // commands it ran, in the same dock the streaming operations use.
  const runQuiet = async (title: string, icon: OperationState["icon"], fn: () => Promise<string>): Promise<boolean> => {
    opLines.current = [];
    setOp({ title, icon, lines: [], running: true, startedAt: Date.now() });
    setOpOpen(false);
    try {
      const out = await fn();
      const lines = out.split("\n").map((l) => l.trim()).filter(Boolean);
      opLines.current = lines;
      const command = [...lines].reverse().find((l) => l.startsWith("$ "));
      setOp((prev) => (prev ? { ...prev, running: false, lines, success: command ?? t("done") } : prev));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      opLines.current = [message];
      await reload(false);
      if (stoppedOnConflicts()) {
        // The plan stopped on the next conflict: the remaining steps are
        // kept for Continue, so this is a stop, not a failed rewrite.
        setOp((prev) =>
          prev ? { ...prev, running: false, lines: [message], success: t("stoppedOnConflicts") } : prev,
        );
        notify("info", t("stoppedOnConflicts"), conflictSummary());
        openConflictSummary();
        void loadLog(true);
        return false;
      }
      setOp((prev) => (prev ? { ...prev, running: false, lines: [message], error: message } : prev));
      notify("error", title, message);
      void loadLog(true);
      return false;
    }
    await reload(false);
    void loadLog(true);
    return true;
  };

  const push = async (opts: PushOptions) => {
    const pushedBranch = opts.branch || branch;
    if (
      (opts.forceWithLease || opts.forceIfIncludes) &&
      isProtectedBranch(pushedBranch, settingsRef.current?.protectedBranches ?? [])
    ) {
      notify("error", t("protectedForcePushTitle"), t("protectedForcePushMessage", { branch: pushedBranch }));
      return;
    }
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
    const ok = await runOperation(t("operationPush"), "push", (ch) => Git.push(opts, ch));
    if (ok) return;
    const rejected = /rejected|non-fast-forward|fetch first/i.test(lastOperationError.current);
    if (!rejected || !(settingsRef.current?.autoUpdateOnReject ?? true)) return;
    const update = await ask({
      title: t("pushRejectedTitle"),
      message: t("pushRejectedMessage"),
      confirmLabel: t("updateProject"),
    });
    if (!update) return;
    const pulled = await runOperation(t("operationPull"), "pull", (ch) =>
      Git.pull(
        {
          remote: "",
          branch: "",
          rebase: settingsRef.current?.updateMethod === "rebase",
          autostash: true,
          prune: false,
          tags: false,
          ffOnly: false,
          noFF: false,
          squash: false,
          noCommit: false,
          tagsMode: "",
        },
        ch,
      ),
    );
    if (!pulled) return;
    await runOperation(t("operationPush"), "push", (ch) => Git.push(opts, ch));
  };

  const pull = (opts: Parameters<typeof Git.pull>[0]) => {
    setDialog(null);
    void runOperation(t("operationPull"), "pull", (ch) => Git.pull(opts, ch)).then(openConflictSummary);
  };

  // Fetch has no dialog: the toolbar fetches at once and keeps the options,
  // which a right click cycles through, in the background.
  const fetch = (opts?: FetchOptions) => {
    setFetchMenu(null);
    void runOperation(t("operationFetch"), "fetch", (ch) =>
      Git.fetch(
        opts ?? { all: true, remote: "", prune: fetchOptions.prune, tags: fetchOptions.tags, tagsMode: "" },
        ch,
      ),
    );
  };

  const checkout = async (ref: string) => {
    const out = await withBusy(() => Git.checkout(ref));
    if (out !== undefined) {
      notify("success", t("checkedOut"), ref);
      setLogRefs([]);
      await reload(false);
      void loadLog(true);
    }
  };

  // Both act on the branch the user pointed at: a pull takes the checked out
  // branch and its upstream.
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
      ffOnly: false,
      noFF: false,
      squash: false,
      noCommit: false,
      tagsMode: "",
    });
  };

  // Pushing is confirmed like any other push: the dialog shows what the
  // branch would send before anything leaves the machine.
  const pushBranch = (leaf: { name: string; upstream: string }) => {
    setDialog({ kind: "push", setUpstream: leaf.upstream === "", branch: leaf.name, upstream: leaf.upstream });
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

  const deleteTag = async (name: string) => {
    const ok = await ask({
      title: t("deleteTagTitle"),
      message: t("deleteTagMessage", { name }),
      confirmLabel: t("delete"),
      danger: true,
    });
    if (!ok) return;
    try {
      await withBusy(() => Git.deleteTag(name, ""));
      notify("success", t("tagDeleted"), name);
      // A deleted tag cannot stay the history scope.
      if (logRefs.includes(name)) {
        setLogRefs(logRefs.filter((r) => r !== name));
        setSelectedCommit(null);
        setLogDetail(null);
        setLogFile(null);
      }
      await reload(false);
      void loadLog(true);
    } catch (err) {
      fail(t("deleteTagFailed"), err);
    }
  };

  const reset = async (hash: string, mode: "soft" | "mixed" | "hard" | "keep") => {
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

  const checkoutUpdate = async (name: string) => {
    await withBusy(async () => {
      await Git.checkoutAndUpdate(name);
      await reload(false);
      void loadLog(true);
    });
  };

  const updateSelected = async (name: string) => {
    await withBusy(async () => {
      const out = await Git.updateSelected(name);
      notify("success", t("branchUpdated"), out.split("\n")[0]);
      await reload(false);
      void loadLog(true);
    });
  };

  const resetToRemote = async (name: string) => {
    const ok = await ask({
      title: t("resetToRemoteTitle"),
      message: t("resetToRemoteMessage", { branch: name }),
      confirmLabel: t("resetToRemote"),
      danger: true,
    });
    if (!ok) return;
    await withBusy(async () => {
      await Git.resetToRemote(name);
      await reload(false);
      void loadLog(true);
    });
  };

  const pushTag = async (name: string) => {
    await withBusy(async () => {
      await Git.pushTag("origin", name);
      notify("success", t("tagPushed"), name);
    });
  };

  const merge = async (ref: string, opts: Parameters<typeof Git.merge>[1]) => {
    setDialog(null);
    await withConflicts(async () => {
      const out = await Git.merge(ref, opts);
      notify("success", t("merged"), out.split("\n")[0]);
      await reload(false);
      void loadLog(true);
    });
  };

  const rebase = async (opts: RebaseOptions) => {
    setDialog(null);
    await withConflicts(async () => {
      await Git.rebase(opts);
      notify("success", t("rebaseFinished"));
      await reload(false);
      void loadLog(true);
    });
  };

  const cherryPick = async (hashes: string[]) => {
    if (hashes.length === 0) return;
    await withConflicts(async () => {
      const out = await Git.cherryPick(hashes, false);
      notify("success", t("cherryPicked"), out.split("\n")[0]);
      await reload(false);
      void loadLog(true);
    });
  };

  const revert = async (hashes: string[]) => {
    if (hashes.length === 0) return;
    const ok = await ask({
      title: t("revertTitle"),
      message:
        hashes.length === 1
          ? t("revertMessage", { hash: hashes[0]!.slice(0, 8) })
          : t("revertManyMessage", { n: hashes.length }),
      confirmLabel: t("revert"),
    });
    if (!ok) return;
    await withConflicts(async () => {
      await Git.revert(hashes);
      notify("success", t("reverted"), hashes.map((h) => h.slice(0, 8)).join(", "));
      await reload(false);
      void loadLog(true);
    });
  };

  // Rewriting starts at the oldest chosen commit: the plan covers it up to
  // HEAD, so nothing above the dialog's range is left out.
  const rewriteFrom = (oldest: Commit) => {
    const parent = oldest.parents[0];
    if (!parent) {
      notify("error", t("rewriteRoot"));
      return;
    }
    setDialog({ kind: "editHistory", onto: parent });
  };

  const applyRewrite = (onto: string, steps: PlanStep[]) => {
    setDialog(null);
    void runQuiet(t("rewriteTitle"), "commit", () => Git.rewrite(onto, steps)).then((ok) => {
      if (ok) notify("success", t("rewriteFinished"));
    });
  };

  const openCompareFile = async (ref: string, path: string, to = "HEAD") => {
    try {
      const opts: DiffOptions = {
        path,
        target: "range",
        from: ref,
        revision: to,
        context: settingsRef.current?.diffContext ?? -1,
        whitespace: "none",
        noText: false,
      };
      const diff = await Git.diff(opts);
      openDoc({ id: `diff:compare:${ref}:${to}:${path}`, title: path, kind: "diff", diff, opts });
    } catch (err) {
      fail(t("gitFailed"), err);
    }
  };

  const stashBranch = async (index: number, branch: string) => {
    setDialog(null);
    await withBusy(async () => {
      await Git.stashToBranch(index, branch);
      notify("success", t("stashRestored", { branch }));
      await reload(false);
      void loadLog(true);
    });
  };

  const openStashDiff = async (index: number, path: string, compareLocal: boolean) => {
    try {
      const opts: DiffOptions = {
        path,
        target: compareLocal ? "head" : "range",
        from: `stash@{${index}}^`,
        revision: `stash@{${index}}`,
        context: settingsRef.current?.diffContext ?? -1,
        whitespace: "none",
        noText: false,
      };
      const diff = await Git.diff(opts);
      openDoc({ id: `diff:${path}:stash${index}`, title: path, kind: "diff", diff, opts });
    } catch (err) {
      fail(t("readStashFiles"), err);
    }
  };

  const deleteCleanupBranches = async (names: string[]) => {
    setDialog(null);
    const unmerged: string[] = [];
    const failed: string[] = [];
    await withBusy(async () => {
      for (const name of names) {
        try {
          await Git.deleteBranch(name, false);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          if (/not fully merged/i.test(message)) unmerged.push(name);
          else failed.push(name);
        }
      }
    });
    let deleted = names.length - unmerged.length - failed.length;
    if (unmerged.length > 0) {
      const force = await ask({
        title: t("branchNotMergedTitle"),
        message: t("cleanupForceMessage", { n: unmerged.length }),
        detail: unmerged.join("\n"),
        confirmLabel: t("forceDelete"),
        danger: true,
      });
      if (force) {
        for (const name of unmerged) {
          try {
            await Git.deleteBranch(name, true);
            deleted++;
          } catch {
            failed.push(name);
          }
        }
      }
    }
    await reload(false);
    void loadLog(true);
    if (failed.length > 0) notify("error", t("deleteBranchFailed"), failed.join(", "));
    else notify("success", t("cleanupDone", { n: deleted }));
  };

  const takeSideAll = async (paths: string[], side: "ours" | "theirs") => {
    await withBusy(async () => {
      await Git.takeSideAll(paths, side);
      for (const path of paths) closeDoc(`conflict:${path}`);
      notify("success", side === "ours" ? t("tookOurs") : t("tookTheirs"));
      await reload(false);
    });
  };

  /** Resolves every conflict a line attribution can settle, across all
   *  conflicted files, leaving the hard ones marked. */
  const resolveSimpleConflictsAll = () =>
    withBusy(async () => {
      const list = snapshotRef.current?.conflicts ?? [];
      let done = 0;
      let remaining = 0;
      for (const conflict of list) {
        if (conflict.markers === 0) continue;
        const content = await Git.conflict(conflict.path);
        if (content.binary) continue;
        const labels = conflictLabels(content.working) ?? {};
        const model = computeMerge(normalizeText(content.base), normalizeText(content.ours), normalizeText(content.theirs), {
          labels,
        });
        const simple = resolveSimpleConflicts(model);
        await Git.saveResolution(conflict.path, simple.text, simple.remaining === 0);
        if (simple.remaining === 0) {
          done++;
          closeDoc(`conflict:${conflict.path}`);
        } else {
          remaining += simple.remaining;
        }
      }
      notify("success", t("simpleResolved", { n: done }), remaining > 0 ? t("stillUnresolved", { n: remaining }) : undefined);
      await reload(false);
    });

  /** Merges every conflicted file with git's three-way algorithm, computed
   *  in memory from the index stages: files that merge cleanly are staged
   *  and disappear, the rest keep markers for the merge editor. */
  const mergeConflictsInMemory = () =>
    withBusy(async () => {
      const list = snapshotRef.current?.conflicts ?? [];
      const ours = state?.opOurs ?? "";
      const theirs = state?.opTheirs ?? "";
      let done = 0;
      let remaining = 0;
      for (const conflict of list) {
        try {
          const content = await Git.conflict(conflict.path);
          const result = await mergeConflictInMemory(conflict.path, ours, theirs, content.working);
          if (result.clean) {
            done++;
            closeDoc(`conflict:${conflict.path}`);
          } else {
            remaining += result.conflicts;
          }
        } catch {
          // A binary file, a link or a deleted side has no line merge; it
          // stays for the reader to choose a side.
          remaining++;
        }
      }
      notify("success", t("simpleResolved", { n: done }), remaining > 0 ? t("stillUnresolved", { n: remaining }) : undefined);
      await reload(false);
    });

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

  const stashApply = async (index: number, pop: boolean, restoreIndex: boolean) => {
    await withBusy(async () => {
      await Git.stashApply(index, pop, restoreIndex);
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

  const clearStashes = async () => {
    const ok = await ask({
      title: t("clearStashesTitle"),
      message: t("clearStashesMessage"),
      confirmLabel: t("clearStashes"),
      danger: true,
    });
    if (!ok) return;
    await withBusy(async () => {
      await Git.clearStashes();
      await reload(false);
    });
  };

  const createPatch = async (paths: string[]) => {
    await withBusy(async () => {
      const target = await Git.savePatch(
        { paths, staged: false, revision: "", from: "", includeUntracked: false },
        "changes.patch",
      );
      if (target) notify("success", t("patchSaved"), target);
    });
  };

  const applyPatch = async () => {
    await withBusy(async () => {
      const out = await Git.applyPatchFile(false);
      if (out) notify("success", t("patchApplied"), out.split("\n")[0]);
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
    await withConflicts(async () => {
      const out = await Git.continueOperation();
      notify("success", t("operationContinued"), out.split("\n")[0]);
      await reload(false);
    });
  };

  const skipOperation = async () => {
    await withConflicts(async () => {
      const out = await Git.skipOperation();
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
      // A repository the system opened, from Open Recent, the Dock menu or
      // the jump list, arrives as "open:<path>": it opens like one chosen
      // with the picker.
      if (cmd.startsWith("open:")) {
        void openRepo(cmd.slice(5));
        return;
      }
      switch (cmd) {
        case "open":
          void openRepo();
          break;
        case "clone":
          setDialog({ kind: "clone" });
          break;
        case "init":
          setDialog({ kind: "init" });
          break;
        case "remotes":
          if (repoOpenRef.current) setDialog({ kind: "remotes" });
          break;
        case "browse-revision": {
          const hash = selectedCommitRef.current;
          if (hash) void openRevisionTree(hash);
          break;
        }
        case "quickopen":
          if (repoOpenRef.current) setQuickOpen(true);
          break;
        case "save":
          void saveAllRef.current(false);
          break;
        case "save-and-close":
          void saveAllRef.current(true).then(async (still) => {
            if (still.length === 0) await Workspace.closeWindow();
          });
          break;
        case "save-and-quit":
          void saveAllRef.current(true).then(async (still) => {
            if (still.length === 0) await Workspace.quitApp();
          });
          break;
        case "closetab":
          if (activeIdRef.current) requestCloseDoc(activeIdRef.current);
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
          if (repoOpen) setDialog({ kind: "push", setUpstream: !snapshot?.state.upstream, upstream: snapshot?.state.upstream });
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
        case "merge":
          if (repoOpen) setDialog({ kind: "merge" });
          break;
        case "repo-tools":
          if (repoOpen) setDialog({ kind: "repoTools", tab: "worktrees" });
          break;
        case "cleanup-branches":
          if (repoOpen) setDialog({ kind: "cleanupBranches" });
          break;
        case "resolve-conflicts":
          if (repoOpen) setDialog({ kind: "conflicts" });
          break;
        case "tab:commit":
          setTab("commit");
          break;
        case "tab:branch":
          setTab("branch");
          break;
        case "tab:files":
          setTab("files");
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

  const showFileHistory = (path: string, line = 0, revision = "") => {
    setLogPath(path);
    setLogLine(line);
    // A line's history is asked of the revision that line belongs to; the
    // index has no committed line numbers, so it keeps the branch in view.
    if (revision && revision !== "INDEX") setLogRefs([revision]);
    setTab("branch");
    // A folded dock would hide the answer the click asked for.
    setLogDockFolded(false);
    setSelectedCommit(null);
    setLogDetail(null);
    setLogFile(null);
  };

  const actions: CommitActions = {
    onRefresh: () => void reload(true),
    onError: (err) => fail(t("gitFailed"), err),
    onShowDiff: openEntryDiff,
    onShowConflict: (path) => void openConflict(path),
    onOpenSource: (path, revision) => void showFile(path, revision),
    onShowHistory: showFileHistory,
    onCompareHead: (path) =>
      void withBusy(async () => {
        const opts: DiffOptions = {
          path,
          target: "head",
          revision: "",
          from: "",
          context: settingsRef.current?.diffContext ?? -1,
          whitespace: "none",
          noText: false,
        };
        const diff = await Git.diff(opts);
        openDoc({ id: `diff:head::${path}`, title: path, kind: "diff", diff, opts });
      }),
    onStage: (paths) => void stage(paths),
    onIntentToAdd: (paths) =>
      withBusy(async () => {
        await Git.stageIntent(paths);
        await reload(false);
      }),
    onUnstage: (paths) => void unstage(paths),
    onRollback: (paths) => void rollback(paths),
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
    onCommit: (pushAfter, rebaseAfter) => void commit(pushAfter, rebaseAfter ?? false),
    onCommitAll: () => void commit(false, false, false, true),
    onCommitSelected: () => void commit(false, false, true),
    onShowThreeWay: (entry) => void showThreeWay(entry),
    onReview: () => setDialog({ kind: "review" }),
    onRepoLocalHistory: () => setDialog({ kind: "localHistory", path: "" }),
    onUndoCommit: () => void undoCommit(),
    onToggleAmend: (amend) => void toggleAmend(amend),
    onCommitFormChange: setForm,
    onRequestPush: () => void commit(true),
    onShowStashDetail: (index) => {
      const stash = snapshot?.stashes.find((s) => s.index === index);
      setDialog({ kind: "stashDetail", index, refName: stash?.ref ?? `stash@{${index}}` });
    },
    onResolveConflicts: () => setDialog({ kind: "conflicts" }),
    onStashPush: () => setDialog({ kind: "stash" }),
    onStashApply: (index, pop, restoreIndex) => void stashApply(index, pop, restoreIndex),
    onClearStashes: () => void clearStashes(),
    onCreatePatch: (paths) => void createPatch(paths),
    onApplyPatch: () => void applyPatch(),
    onEditGitignore: () => {
      void withBusy(async () => {
        await Git.createFile(".gitignore").catch(() => {});
        await reload(false);
        void showFile(".gitignore", "");
      });
    },
    onStashDrop: (index) => void stashDrop(index),
  };

  const saveSettings = async (next: Settings) => {
    try {
      const saved = await Workspace.saveSettings(next);
      settingsRef.current = saved;
      setSettings(saved);
      applyTheme(saved);
      // Only the dialog this save came from: a slow write must not close one
      // the user opened while it was in flight.
      setDialog((d) => (d?.kind === "settings" ? null : d));
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

  // The document on screen, as a path, so the project tree can mark the row
  // the editor is showing.
  const activeDocPath =
    activeDoc?.kind === "file"
      ? activeDoc.file.path
      : activeDoc?.kind === "diff"
        ? activeDoc.opts.path
        : undefined;

  const tabHeader = (
    <ToolTabs
      tab={tab}
      onSelect={setTab}
      order={tabOrder}
      changed={
        snapshot ? snapshot.state.changed + snapshot.state.untracked + snapshot.state.conflicts : 0
      }
      labels={{
        commit: t("commitTab"),
        branch: t("branchTab"),
        files: t("filesTab"),
        console: t("consoleTab"),
      }}
    />
  );

  return (
    <div className="app">
      <header className="titlebar">
        <div className="titlebar-brand">
          <span className="brand-mark">
            <Icon name="git" size={17} />
          </span>
          {snapshot && (
            <span className="titlebar-repo" title={snapshot.state.root}>
              {snapshot.state.name}
            </span>
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
              title={
                state && state.behind > 0
                  ? `${t("fetchTooltip")} · ${count(
                      state.behind,
                      t("fetchNewOne", { n: state.behind }),
                      t("fetchNewOther", { n: state.behind }),
                    )}`
                  : t("fetchTooltip")
              }
              onClick={() => fetch()}
              spinner={!!op?.running && op.icon === "fetch"}
              disabled={!repoOpen}
            />
            {state && state.behind > 0 && <span className="icon-dot todo" />}
          </span>
          <span className="icon-slot">
            <IconButton
              icon="pull"
              title={
                state && state.behind > 0
                  ? `${t("updateProject")} · ${count(
                      state.behind,
                      t("pullOne", { n: state.behind }),
                      t("pullOther", { n: state.behind }),
                    )}`
                  : t("updateProject")
              }
              onClick={() => setDialog({ kind: "pull" })}
              disabled={!repoOpen}
            />
            {state && state.behind > 0 && <span className="icon-dot todo" />}
          </span>
          <span className="icon-slot">
            <IconButton
              icon="push"
              title={pushTodo ? `${t("pushTip")} · ${pushTodo}` : t("pushTip")}
              onClick={() => setDialog({ kind: "push", setUpstream: !snapshot?.state.upstream, upstream: snapshot?.state.upstream })}
              disabled={!repoOpen}
            />
            {pushTodo !== "" && <span className="icon-dot todo" />}
          </span>
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
                <NoRepo
                  onOpen={() => void openRepo()}
                  onClone={() => setDialog({ kind: "clone" })}
                  onInit={() => setDialog({ kind: "init" })}
                />
              ))}
            {tab === "branch" &&
              (snapshot ? (
                <BranchList
                  refs={refs}
                  current={state?.branch ?? ""}
                  favorites={favorites}
                  selected={logRefs.length === 1 ? logRefs[0]! : ""}
                  onSelect={(name) => {
                    setLogRefs([name]);
                    setSelectedCommit(null);
                    setLogDetail(null);
                    setLogFile(null);
                  }}
                  onCheckout={(name) => void checkout(name)}
                  onToggleFavorite={toggleFavorite}
                  onNewBranch={(start) => setDialog({ kind: "newBranch", start })}
                  onMerge={(name) => void merge(name, defaultMergeOptions)}
                  onRebase={(name) => setDialog({ kind: "rebase", onto: name })}
                  onDelete={(name) => void deleteBranch(name)}
                  onDeleteTag={(name) => void deleteTag(name)}
                  onNewTag={(start) => setDialog({ kind: "tag", start })}
                  onCopy={copyText}
                  onPull={(leaf) => pullBranch(leaf)}
                  onPush={(leaf) => pushBranch(leaf)}
                  onCompare={(ref) => setDialog({ kind: "compare", ref })}
                  recent={recentBranches}
                  onCheckoutUpdate={(name) => void checkoutUpdate(name)}
                  onUpdateSelected={(name) => void updateSelected(name)}
                  onResetToRemote={(name) => void resetToRemote(name)}
                  onPushTag={(name) => void pushTag(name)}
                />
              ) : (
                <NoRepo
                  onOpen={() => void openRepo()}
                  onClone={() => setDialog({ kind: "clone" })}
                  onInit={() => setDialog({ kind: "init" })}
                />
              ))}
            {tab === "files" &&
              (repoOpen ? (
                <SourceTree
                  repoOpen={repoOpen}
                  root={state?.root ?? ""}
                  reloadKey={`${state?.branch ?? ""}:${snapshot?.state.changed ?? 0}:${snapshot?.state.untracked ?? 0}`}
                  activePath={activeDocPath}
                  onOpen={(path) => void showFile(path)}
                  onError={(err) => fail(t("openFileFailed"), err)}
                  onActionError={(err) => fail(t("fileActionFailed"), err)}
                  onIgnore={(paths) => void ignorePaths(paths)}
                />
              ) : (
                <NoRepo
                  onOpen={() => void openRepo()}
                  onClone={() => setDialog({ kind: "clone" })}
                  onInit={() => setDialog({ kind: "init" })}
                />
              ))}
            {tab === "console" && (
              <ConsolePanel
                key={snapshot?.state.root ?? "none"}
                onCommandDone={() => void reload(false)}
                repoOpen={repoOpen}
                repoKey={snapshot?.state.root ?? ""}
                notify={notify}
              />
            )}
          </div>
        </aside>
        <Splitter width={splitWidth} setWidth={setSplitWidth} />
        <div className="workspace-right">
        <RightPane
            root={snapshot?.state.root ?? ""}
            commitView={detailView}
            diffMode={diffMode}
            setDiffMode={setDiffMode}
            whitespace={whitespace}
            onWhitespace={chooseWhitespace}
            docs={docs}
            activeId={activeId}
            onActivate={setActiveId}
            onCloseDoc={requestCloseDoc}
            onCloseDocs={requestCloseDocs}
            dirtyIds={dirtyDocs}
            onDocDirty={setDocDirty}
            onFilesChanged={() => void reload(false)}
            onFileError={(err) => fail(t("fileActionFailed"), err)}
            onSaveFiles={saveFiles}
            saveAllRef={saveAllRef}
            autoSaveIdleSeconds={settings?.autoSaveIdle ? settings.autoSaveIdleSeconds : 0}
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
            onApplyLines={(lines, action) => {
              const active = docsRef.current.find((d) => d.id === activeIdRef.current);
              if (active?.kind === "diff") void applyLines(active.opts, lines, action);
            }}
            onApplyThreeHunk={applyThreeHunk}
            onApplyThreeFile={applyThreeFile}
            onOpenFile={(path, revision, line) => void showFile(path, revision, line)}
            onOpenDiff={(path, revision) => void showFileDiff(path, revision)}
            onNextDiffFile={nextDiffFile}
            onCopyPath={copyText}
            onReveal={(path) => void Workspace.reveal(path).catch((err) => fail(t("revealFailed"), err))}
            onRollbackHunk={(path, hunk) => void rollbackEditorHunk(path, hunk)}
            onRollbackLine={(path, line) => void rollbackEditorLine(path, line)}
            onExternalDiff={(opts) =>
              void Git.externalDiff(opts).catch((err) => fail(t("externalDiffFailed"), err))
            }
            onLocalHistory={(path) => setDialog({ kind: "localHistory", path })}
            onNavigate={handleEditorNavigation}
            onNavigated={recordJump}
            onHistory={navigateHistory}
            canBack={canStep(navHistory, -1)}
            canForward={canStep(navHistory, 1)}
            onBack={() => navigateHistory(-1)}
            onForward={() => navigateHistory(1)}
            busy={diffBusy}
            reloadKey={reloadKey}
            onShowFileHistory={showFileHistory}
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
            filters={logFilters}
            onFilters={setLogFilters}
            refs={logRefs}
            onRefs={setLogRefs}
            pathScope={logPath ? (logLine > 0 ? `${logPath}:${logLine}` : logPath) : ""}
            onClearScope={() => setLogRefs([])}
            onClearPathScope={() => {
              setLogPath("");
              setLogLine(0);
              setSelectedCommit(null);
            }}
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
            onAnnotateRevision={(path, revision) => {
              // The source view reads this preference when it mounts.
              try {
                localStorage.setItem("gitjet.annotate", "true");
              } catch {
                // A blocked store only loses the preference.
              }
              void showFile(path, revision);
            }}
            onShowHistory={showFileHistory}
            onCheckout={(ref) => void checkout(ref)}
            onNewBranch={(start) => setDialog({ kind: "newBranch", start })}
            onNewTag={(start) => setDialog({ kind: "tag", start })}
            onCherryPick={(hashes) => void cherryPick(hashes)}
            onPushCommits={(hash) => setDialog({ kind: "pushCommits", hash })}
            onBrowseRevision={(hash) => void openRevisionTree(hash)}
            onFixupCommit={(hash) => void commitFixup(hash, false)}
            onSquashCommit={(hash) => void commitFixup(hash, true)}
            onAmendCommit={(hash) => void amendSpecific(hash)}
            onFixupBySubject={(subject) => void fixupBySubject(subject)}
            onRevert={(hashes) => void revert(hashes)}
            onRewrite={(oldest) => rewriteFrom(oldest)}
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
                onClick={() => setDialog({ kind: "push", setUpstream: !state.upstream, upstream: state.upstream })}
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
            {(state.operation === "merge" ? state.opTheirs : state.opDetail) && (
              <span className="op-detail">
                {state.operation === "merge" ? state.opTheirs : state.opDetail}
              </span>
            )}
            <button className="mini-btn" onClick={() => void continueOperation()}>
              {t("continueOp")}
            </button>
            {["rebase", "rebase-interactive", "am", "cherry-pick", "revert"].includes(state.operation) && (
              <button className="mini-btn" onClick={() => void skipOperation()}>
                {t("skipOp")}
              </button>
            )}
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
        <NotificationCenter notices={notices} onClear={() => setNotices([])} />
      </footer>

      {quickOpen && (
        <QuickOpen
          onClose={() => setQuickOpen(false)}
          onOpen={(path) => void showFile(path, "")}
          onOpenCommit={(hash) => void openCommit(hash)}
        />
      )}

      {symbol && (
        <SymbolPanel
          word={symbol.word}
          language={symbol.language}
          hits={symbol.hits}
          source={symbol.source}
          definitions={symbol.definitions}
          server={symbol.server}
          onClose={() => setSymbol(null)}
          onOpen={(hit) => {
            const origin = symbol.origin;
            setSymbol(null);
            void (async () => {
              const target = {
                uri: toUri(absolutePathFor(hit.path)),
                path: hit.path,
                line: hit.line,
                column: hit.column,
                endLine: hit.line,
                endColumn: hit.column + 1,
              };
              if (!(await openNavigationTarget(target))) {
                notify("error", t("openFileFailed"), hit.path);
                return;
              }
              recordJump(origin, { path: hit.path, line: hit.line, column: hit.column });
            })();
          }}
        />
      )}

      {targetChoice && (
        <TargetPopup
          request={targetChoice}
          onChoose={chooseTarget}
          onClose={() => setTargetChoice(null)}
        />
      )}

      {dialog?.kind === "clone" && (
        <CloneDialog onClose={() => setDialog(null)} onSubmit={(url, dir) => void cloneRepo(url, dir)} />
      )}
      {dialog?.kind === "init" && (
        <InitDialog onClose={() => setDialog(null)} onSubmit={(dir, branch) => void initRepo(dir, branch)} />
      )}
      {dialog?.kind === "remotes" && (
        <RemotesDialog
          remotes={remotes}
          onAdd={(name, url) => void addRemote(name, url)}
          onSaveURL={(name, url) => void saveRemoteURL(name, url)}
          onRename={(oldName, newName) => void renameRemote(oldName, newName)}
          onRemove={(name) => void removeRemote(name)}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog?.kind === "pushCommits" && (
        <PushCommitsDialog
          hash={dialog.hash}
          remotes={remotes}
          current={branch || "HEAD"}
          onClose={() => setDialog(null)}
          onSubmit={(remote, remoteBranch) => {
            setDialog(null);
            void withBusy(async () => {
              await Git.pushCommits(remote, remoteBranch, dialog.hash);
              await reload(false);
              void loadLog(true);
            });
          }}
        />
      )}
      {dialog?.kind === "rollback" && snapshot && (
        <RollbackDialog
          entries={entriesFor(snapshot)}
          selected={dialog.paths}
          deleteAdded={settings.rollbackDeleteAdded}
          onDeleteAdded={(value) => void rememberRollbackDeleteAdded(value)}
          onClose={() => setDialog(null)}
          onConfirm={(paths, deleteAdded) => {
            setDialog(null);
            void runRollback(paths, deleteAdded);
          }}
        />
      )}
      {dialog?.kind === "review" && snapshot && (
        <ReviewDialog
          entries={entriesFor(snapshot)}
          context={settings?.diffContext ?? -1}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog?.kind === "localHistory" && (
        <LocalHistoryDialog
          path={dialog.path}
          onClose={() => setDialog(null)}
          onRestore={(path, digest) => {
            setDialog(null);
            void withBusy(async () => {
              await Git.restoreLocalHistory(path, digest);
              await reload(false);
            });
          }}
        />
      )}
      {dialog?.kind === "rebase" && (
        <RebaseDialog
          onto={dialog.onto}
          current={branch || "HEAD"}
          refs={refs?.local.map((b) => b.name) ?? []}
          onClose={() => setDialog(null)}
          onSubmit={(opts) => void rebase(opts)}
        />
      )}
      {dialog?.kind === "settings" && (
        <SettingsDialog
          settings={settings}
          tabOrder={tabOrder}
          onTabOrder={setTabOrder}
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
          branch={dialog.branch}
          trackedUpstream={dialog.upstream}
          setUpstream={dialog.setUpstream}
          root={snapshot?.state.root ?? ""}
          onCopyPath={copyText}
          diffMode={diffMode}
          setDiffMode={setDiffMode}
          diffWrap={diffWrap}
          onToggleWrap={() => setDiffWrap(!diffWrap)}
          whitespace={whitespace}
          onWhitespace={chooseWhitespace}
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
          branches={[
            ...(refs?.local ?? []).map((r) => r.name),
            ...(refs?.remote ?? []).filter((r) => !r.symbolic).map((r) => r.name),
          ].filter((name, index, all) => all.indexOf(name) === index)}
          current={state?.branch ?? ""}
          onClose={() => setDialog(null)}
          onSubmit={(ref, opts) => void merge(ref, opts)}
        />
      )}
      {dialog?.kind === "editHistory" && (
        <EditHistoryDialog
          onto={dialog.onto}
          onClose={() => setDialog(null)}
          onSubmit={(steps) => applyRewrite(dialog.onto, steps)}
        />
      )}
      {dialog?.kind === "stashDetail" && (
        <StashDetailDialog
          index={dialog.index}
          refName={dialog.refName}
          onClose={() => setDialog(null)}
          onOpenDiff={(index, path, compareLocal) => void openStashDiff(index, path, compareLocal)}
          onApply={(index, pop, restoreIndex) => {
            setDialog(null);
            void stashApply(index, pop, restoreIndex);
          }}
          onDrop={(index) => {
            setDialog(null);
            void stashDrop(index);
          }}
          onBranch={(index, branch) => void stashBranch(index, branch)}
        />
      )}
      {dialog?.kind === "repoTools" && (
        <RepoExtrasDialog
          tab={dialog.tab}
          root={state?.root ?? ""}
          shallow={state?.shallow ?? false}
          onClose={() => setDialog(null)}
          onOpenWorktree={(path) => void Workspace.openInWindow(path).catch((err) => fail(t("openNewWindow"), err))}
          onChanged={() => void reload(false)}
        />
      )}
      {dialog?.kind === "cleanupBranches" && (
        <CleanupBranchesDialog
          onClose={() => setDialog(null)}
          onDelete={(names) => void deleteCleanupBranches(names)}
        />
      )}
      {dialog?.kind === "compare" && (
        <CompareDialog
          from={dialog.ref}
          refs={[
            ...(refs?.local.map((r) => r.name) ?? []),
            ...(refs?.remote.map((r) => r.name) ?? []),
            ...(refs?.tags.map((r) => r.name) ?? []),
            "HEAD",
          ]}
          onClose={() => setDialog(null)}
          onOpenFile={(path, from, to) => void openCompareFile(from, path, to)}
        />
      )}
      {dialog?.kind === "conflicts" && (
        <ConflictSummaryDialog
          operation={state?.operation ?? ""}
          oursLabel={state?.opOurs ?? ""}
          theirsLabel={state?.opTheirs ?? ""}
          conflicts={snapshot?.conflicts ?? []}
          totals={conflictTotals}
          onClose={() => setDialog(null)}
          onOpen={(path) => {
            setDialog(null);
            void openConflict(path);
          }}
          onTakeSide={(paths, side) => void takeSideAll(paths, side)}
          onResolveSimple={() => void resolveSimpleConflictsAll()}
          onMergeInMemory={() => void mergeConflictsInMemory()}
          onContinue={() => {
            setDialog(null);
            void continueOperation();
          }}
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
              onClick: () => fetch({ all: true, remote: "", prune: fetchOptions.prune, tags: fetchOptions.tags, tagsMode: "" }),
            },
            ...(remotes.some((r) => r.name === "origin")
              ? [
                  {
                    label: t("fetchOrigin"),
                    icon: "download" as const,
                    onClick: () =>
                      fetch({ all: false, remote: "origin", prune: fetchOptions.prune, tags: fetchOptions.tags, tagsMode: "" }),
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

/** Start of a yyyy-mm-dd date in seconds; 0 means no bound. */
function dayStart(value: string): number {
  if (value === "") return 0;
  const time = new Date(`${value}T00:00:00`).getTime();
  return Number.isNaN(time) ? 0 : Math.floor(time / 1000);
}

/** End of a yyyy-mm-dd date in seconds; 0 means no bound. */
function dayEnd(value: string): number {
  if (value === "") return 0;
  const time = new Date(`${value}T23:59:59`).getTime();
  return Number.isNaN(time) ? 0 : Math.floor(time / 1000);
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

function NoRepo({ onOpen, onClone, onInit }: { onOpen: () => void; onClone: () => void; onInit: () => void }) {
  const t = useT(T);
  return (
    <div className="no-repo">
      <Icon name="git" size={26} />
      <div>{t("noRepoMessage")}</div>
      <div className="no-repo-actions">
        <Button variant="primary" onClick={onOpen}>
          {t("openRepoEllipsis")}
        </Button>
        <Button onClick={onClone}>{t("cloneRepoEllipsis")}</Button>
        <Button onClick={onInit}>{t("createRepoEllipsis")}</Button>
      </div>
    </div>
  );
}

/** The kind of document, as the word the icon stands for: the icon is what
 *  the tab shows, this is its tooltip. */
function kindLabel(doc: Doc, t: Translate): string {
  switch (doc.kind) {
    case "diff":
      return t("kindDiff");
    case "three":
      return t("kindThree");
    case "file":
      return t("kindSource");
    case "commit":
      return t("kindCommit");
    case "tree":
      return t("kindTree");
  }
}

function docIcon(doc: Doc): "diff" | "file" | "merge" | "user" | "commit" | "folder" {
  switch (doc.kind) {
    case "diff":
      return "diff";
    case "three":
      return "diff";
    case "file":
      return "file";
    case "commit":
      return "commit";
    case "tree":
      return "folder";
  }
}

/** The repository-relative file a tab stands for; a commit tab has none. */
function docPath(doc: Doc): string {
  switch (doc.kind) {
    case "diff":
      return doc.opts.path;
    case "three":
      return doc.opts.path;
    case "file":
      return doc.file.path;
    case "commit":
      return "";
    case "tree":
      return "";
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
    case "three":
      return `${baseName(doc.opts.path)} · 3`;
    case "file":
      return baseName(doc.file.path);
    case "commit":
      return doc.detail.short;
    case "tree":
      return `${doc.revision.slice(0, 8)} @`;
  }
}

function shortRevision(revision: string): string {
  if (/^[0-9a-f]{7,40}$/i.test(revision)) return revision.slice(0, 8);
  return revision;
}

/**
 * The half of a tab title that tells two otherwise identical tabs apart: the
 * revision a file was opened at, or the pair a diff compares. It is only
 * drawn when the base title repeats, so an ordinary tab stays short — the
 * same reason IDEA titles a staged revision tab and leaves the working copy
 * plain.
 */
function tabDetail(doc: Doc, t: Translate): string {
  switch (doc.kind) {
    case "file":
      if (doc.revision === "") return t("tabWorkingTree");
      if (doc.revision === "INDEX") return t("tabIndex");
      return shortRevision(doc.revision);
    case "diff": {
      if (doc.opts.target === "commit") return shortRevision(doc.opts.revision);
      if (doc.opts.target === "range") {
        return `${shortRevision(doc.opts.from)} ↔ ${shortRevision(doc.opts.revision)}`;
      }
      const side = (label: string) =>
        label === "Working Tree"
          ? t("tabWorkingTree")
          : label === "Index"
            ? t("tabIndex")
            : shortRevision(label);
      const left = side(doc.diff.oldLabel);
      const right = side(doc.diff.newLabel);
      return left === "" || right === "" ? "" : `${left} ↔ ${right}`;
    }
    case "three":
    case "commit":
    case "tree":
      return "";
  }
}

function RightPane({
  root,
  repoOpen,
  docs,
  activeId,
  onActivate,
  onCloseDoc,
  onCloseDocs,
  dirtyIds,
  onDocDirty,
  onFilesChanged,
  onFileError,
  onSaveFiles,
  saveAllRef,
  autoSaveIdleSeconds,
  diffMode,
  diffWrap,
  onToggleWrap,
  setDiffMode,
  whitespace,
  onWhitespace,
  onApplyHunk,
  onApplyFile,
  onApplyLines,
  onApplyThreeHunk,
  onApplyThreeFile,
  onOpenFile,
  onExternalDiff,
  onOpenDiff,
  onNextDiffFile,
  onCopyPath,
  onReveal,
  onRollbackHunk,
  onRollbackLine,
  onLocalHistory,
  onNavigate,
  onNavigated,
  onHistory,
  canBack,
  canForward,
  onBack,
  onForward,
  busy,
  reloadKey,
  onShowFileHistory,
  onOpenRecent,
  onRemoveRecent,
  recent,
  commitView,
}: {
  commitView: ChangeView;
  /** Absolute path of the repository, for the copy-path menu. */
  root: string;
  repoOpen: boolean;
  docs: Doc[];
  activeId: string | null;
  onActivate: (id: string) => void;
  onCloseDoc: (id: string) => void;
  onCloseDocs: (ids: string[]) => void;
  dirtyIds: ReadonlySet<string>;
  onDocDirty: (id: string, dirty: boolean) => void;
  onFilesChanged: () => void;
  onFileError: (err: unknown) => void;
  /** Writes every document Save All collected and resolves with the ids that
   *  reached disk. */
  onSaveFiles: (entries: { id: string; path: string; text: string }[], quiet: boolean) => Promise<string[]>;
  /** Set to this pane's Save All, so the menu, the status bar, the idle timer
   *  and the window's deactivation all reach one implementation. */
  saveAllRef: { current: (quiet?: boolean) => Promise<string[]> };
  /** IDEA's opt-in idle save, in seconds; 0 when the setting is off. */
  autoSaveIdleSeconds: number;
  diffWrap: boolean;
  onToggleWrap: () => void;
  diffMode: "split" | "unified";
  setDiffMode: (m: "split" | "unified") => void;
  whitespace: WhitespaceMode;
  onWhitespace: (mode: WhitespaceMode) => void;
  onApplyHunk: (hunk: number, action: "stage" | "unstage" | "rollback") => void;
  onApplyFile: (action: "stage" | "unstage" | "rollback") => void;
  onApplyLines: (lines: number[], action: "stage" | "unstage" | "rollback") => void;
  onApplyThreeHunk: (side: "staged" | "unstaged", hunk: number, action: "stage" | "unstage" | "rollback") => void;
  onApplyThreeFile: (side: "staged" | "unstaged", action: "stage" | "unstage" | "rollback") => void;
  onOpenFile: (path: string, revision: string, line?: number) => void;
  onExternalDiff: (opts: DiffOptions) => void;
  onOpenDiff: (path: string, revision: string) => void;
  /** Moves to the neighbouring changed file of the same transition. */
  onNextDiffFile: (path: string, revision: string, delta: 1 | -1) => void;
  onCopyPath: (text: string) => void;
  onReveal: (path: string) => void;
  onRollbackHunk: (path: string, hunk: number) => void;
  onRollbackLine: (path: string, line: number) => void;
  onLocalHistory: (path: string) => void;
  onNavigate: (request: EditorNavigationRequest) => void;
  onNavigated: (from: NavigationPoint, to: NavigationPoint) => void;
  onHistory: (delta: -1 | 1) => void;
  canBack: boolean;
  canForward: boolean;
  onBack: () => void;
  onForward: () => void;
  busy: boolean;
  reloadKey: number;
  onShowFileHistory: (path: string, line?: number, revision?: string) => void;
  onOpenRecent: (path: string) => void;
  onRemoveRecent: (path: string) => Promise<void>;
  recent: Settings["recent"];
}) {
  const active = docs.find((d) => d.id === activeId) ?? docs[0] ?? null;
  const t = useT(T);
  // Each open commit keeps its own expanded directories.
  const [commitDirs, setCommitDirs] = useState<Map<string, Set<string>>>(new Map());
  const [tabMenu, setTabMenu] = useState<{ x: number; y: number; items: ContextItem[] } | null>(null);
  const fileMenu = useFileMenu({
    root,
    onChanged: onFilesChanged,
    onError: onFileError,
    onCopy: onCopyPath,
    onReveal,
  });
  // A source tab's unsaved text while another tab is active. Clean documents
  // need no draft, and closing a tab drops its key.
  const drafts = useRef<Map<string, string>>(new Map());
  useEffect(() => {
    const open = new Set(docs.map((d) => d.id));
    for (const id of drafts.current.keys()) {
      if (!open.has(id) || !dirtyIds.has(id)) drafts.current.delete(id);
    }
  }, [docs, dirtyIds]);

  // Save All runs from a menu command, the status bar, the idle timer and the
  // window's deactivation, all of which outlive a render; these refs give it
  // the latest list without re-creating the callback on every keystroke.
  const docsRef = useRef(docs);
  docsRef.current = docs;
  const dirtyRef = useRef(dirtyIds);
  dirtyRef.current = dirtyIds;
  const activeRef = useRef(active);
  activeRef.current = active;
  // The mounted editor's own text and baseline; every other dirty tab lives
  // in `drafts`.
  const editorSave = useRef<EditorSaveHandle | null>(null);

  /** IDEA's Save All: write every unsaved document in one pass, then adopt
   *  each written snapshot as its saved baseline. Returns the ids that are
   *  still dirty — a failed write, or text typed while the write was in
   *  flight, leaves the document dirty, exactly as FileDocumentManager's
   *  loop does. */
  const saving = useRef<Promise<string[]> | null>(null);
  const saveAll = useCallback(
    (quiet = false): Promise<string[]> => {
      // The menu accelerator and the editor's Mod-s can both fire; a second
      // request while a write is in flight joins it instead of racing it.
      if (saving.current) return saving.current;
      const run = (async (): Promise<string[]> => {
        const dirty = dirtyRef.current;
        if (dirty.size === 0) return [];
        const activeNow = activeRef.current;
        const entries: { id: string; path: string; text: string }[] = [];
        for (const id of dirty) {
          const doc = docsRef.current.find((d) => d.id === id);
          if (!doc || doc.kind !== "file" || doc.revision !== "" || doc.file.external) continue;
          let text: string | undefined;
          if (doc.id === activeNow?.id) text = editorSave.current?.text();
          if (text === undefined) {
            const draft = drafts.current.get(id);
            if (draft !== undefined) text = withLineEnding(draft, detectLineEnding(doc.file.text));
          }
          if (text === undefined) continue;
          entries.push({ id, path: doc.file.path, text });
        }
        if (entries.length === 0) return [...dirty];
        const saved = await onSaveFiles(entries, quiet);
        const own = entries.find((entry) => entry.id === activeNow?.id);
        if (own && saved.includes(own.id)) editorSave.current?.markSaved();
        const handled = new Set(entries.map((entry) => entry.id));
        return [...dirty].filter(
          (id) =>
            !handled.has(id) ||
            !saved.includes(id) ||
            (id === activeNow?.id && (editorSave.current?.isDirty() ?? false)),
        );
      })();
      saving.current = run.finally(() => {
        saving.current = null;
      });
      return saving.current;
    },
    [onSaveFiles],
  );
  saveAllRef.current = saveAll;

  // IDEA's opt-in "save if the application is idle": one timer for the whole
  // pane, restarted by every keystroke in the mounted editor. Keeping it here
  // rather than in the editor means switching tabs cannot strand an edited
  // tab that nobody is typing in.
  const idleTimer = useRef<number | null>(null);
  const idleSeconds = useRef(autoSaveIdleSeconds);
  idleSeconds.current = autoSaveIdleSeconds;
  const armIdle = useCallback(() => {
    if (idleTimer.current !== null) window.clearTimeout(idleTimer.current);
    idleTimer.current = null;
    const seconds = idleSeconds.current;
    if (seconds <= 0) return;
    idleTimer.current = window.setTimeout(() => {
      idleTimer.current = null;
      if (dirtyRef.current.size > 0) void saveAllRef.current(true);
    }, seconds * 1000);
  }, [saveAllRef]);
  useEffect(() => {
    if (dirtyIds.size !== 0) return;
    if (idleTimer.current !== null) window.clearTimeout(idleTimer.current);
    idleTimer.current = null;
  }, [dirtyIds]);
  useEffect(
    () => () => {
      if (idleTimer.current !== null) window.clearTimeout(idleTimer.current);
    },
    [],
  );

  const closeTabItems = (doc: Doc): ContextItem[] => {
    const index = docs.findIndex((d) => d.id === doc.id);
    const before = docs.slice(0, index).map((d) => d.id);
    const after = docs.slice(index + 1).map((d) => d.id);
    const unmodified = docs.filter((d) => !dirtyIds.has(d.id)).map((d) => d.id);
    return [
      { label: t("close"), icon: "close", onClick: () => onCloseDocs([doc.id]) },
      { separator: true },
      {
        label: t("closeOthers"),
        icon: "close",
        disabled: docs.length <= 1,
        onClick: () => onCloseDocs(docs.filter((d) => d.id !== doc.id).map((d) => d.id)),
      },
      {
        label: t("closeAllTabs"),
        icon: "close",
        onClick: () => onCloseDocs(docs.map((d) => d.id)),
      },
      {
        label: t("closeUnmodifiedTabs"),
        icon: "close",
        disabled: unmodified.length === 0,
        onClick: () => onCloseDocs(unmodified),
      },
      {
        label: t("closeLeftTabs"),
        icon: "close",
        disabled: before.length === 0,
        onClick: () => onCloseDocs(before),
      },
      {
        label: t("closeRightTabs"),
        icon: "close",
        disabled: after.length === 0,
        onClick: () => onCloseDocs(after),
      },
    ];
  };

  const welcome = (
    <div className="welcome">
      <div className="welcome-inner">
        <div className="welcome-logo">
          <Icon name="git" size={36} />
        </div>
        <h1>{repoOpen ? t("noFileOpen") : t("welcomeHeadline")}</h1>
        <p className="welcome-tagline">{repoOpen ? t("emptyOpen") : t("welcomeTagline")}</p>
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

  // Two views of one path (working tree and HEAD, or two diff bases) would
  // otherwise read as identical tabs. Only duplicates get the extra half.
  const baseTitles = docs.map((doc) => tabTitle(doc, t));
  const titleCounts = new Map<string, number>();
  for (const title of baseTitles) titleCounts.set(title, (titleCounts.get(title) ?? 0) + 1);

  return (
    <main className="editor-area">
      <div className="editor-tabs" role="tablist">
        {docs.map((doc, index) => {
          const path = docPath(doc);
          const base = baseTitles[index]!;
          const detail = (titleCounts.get(base) ?? 0) > 1 ? tabDetail(doc, t) : "";
          const label = detail === "" ? base : `${base} · ${detail}`;
          return (
          <div
            key={doc.id}
            role="tab"
            aria-selected={doc.id === active.id}
            className={cx("editor-tab", doc.id === active.id && "active")}
            onClick={() => onActivate(doc.id)}
            onAuxClick={(e) => {
              if (e.button === 1) onCloseDoc(doc.id);
            }}
            onContextMenu={(e) => {
              if (path === "") {
                e.preventDefault();
                e.stopPropagation();
                setTabMenu({ x: e.clientX, y: e.clientY, items: closeTabItems(doc) });
              } else {
                setTabMenu(null);
                fileMenu.openMenu(e, { path, isDir: false }, [], closeTabItems(doc));
              }
            }}
            title={`${path || doc.title}${detail === "" ? "" : ` · ${detail}`}`}
          >
            {path !== "" ? (
              <span className="editor-tab-file" title={kindLabel(doc, t)}>
                <FileIcon path={path} size={14} />
              </span>
            ) : (
              <span className={cx("editor-tab-kind", `kind-${doc.kind}`)} title={kindLabel(doc, t)}>
                <Icon name={docIcon(doc)} size={11} />
              </span>
            )}
            <span className="editor-tab-title">{label}</span>
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
          );
        })}
        <span className="spacer" />
      </div>
      <div className="editor-content">
        {active.kind === "file" && (
          <SourceView
            key={`${active.id}:${active.revision}`}
            file={active.file}
            line={active.line}
            column={active.column}
            reveal={active.reveal}
            root={root}
            onShowDiff={() => onOpenDiff(active.file.path, active.revision)}
            onOpenWorkingTree={() => onOpenFile(active.file.path, "")}
            onCopyPath={(text) => onCopyPath(text)}
            onReveal={() => onReveal(active.file.path)}
            onRollbackHunk={(hunk) => onRollbackHunk(active.file.path, hunk)}
            onRollbackLine={(line) => onRollbackLine(active.file.path, line)}
            onLocalHistory={() => onLocalHistory(active.file.path)}
            onNavigate={onNavigate}
            onNavigated={onNavigated}
            onHistory={onHistory}
            canBack={canBack}
            canForward={canForward}
            onBack={onBack}
            onForward={onForward}
            onLineHistory={(line) => onShowFileHistory(active.file.path, line, active.revision)}
            onCommitDiff={(hash) => onOpenDiff(active.file.path, hash)}
            draft={drafts.current.get(active.id)}
            onDraftChange={(text) => drafts.current.set(active.id, text)}
            onSaveRequest={() => void saveAllRef.current()}
            onEdit={armIdle}
            saveRef={editorSave}
            onDirtyChange={(dirty) => onDocDirty(active.id, dirty)}
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
                  <FileIcon path={file.path} size={14} />
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
        {active.kind === "tree" && (
          <div className="revision-tree">
            <div className="diff-header">
              <div className="diff-title-row">
                <Icon name="folder" />
                <span className="diff-path">
                  {t("treeAtRevision", { rev: active.revision.slice(0, 8) })}
                </span>
                <span className="muted">{count(active.files.length, t("treeFileOne"), t("treeFileOther", { n: active.files.length }))}</span>
              </div>
            </div>
            <div className="revision-tree-list">
              {active.files.map((file) => (
                <button
                  key={file.path}
                  className="repo-row"
                  onClick={() => onOpenFile(file.path, active.revision)}
                  title={file.path}
                >
                  <FileIcon path={file.path} size={14} />
                  <span className="repo-row-title">{file.path}</span>
                </button>
              ))}
            </div>
          </div>
        )}
        {active.kind === "three" && (
          <ThreeWayView
            key={active.id}
            three={active.three}
            onApplyHunk={(side, hunk, action) => onApplyThreeHunk(side, hunk, action)}
            onApplyFile={(side, action) => onApplyThreeFile(side, action)}
            busy={busy}
          />
        )}
        {active.kind === "diff" && (
          <DiffView
            key={active.id}
            diff={active.diff}
            opts={active.opts}
            mode={diffMode}
            setMode={setDiffMode}
            whitespace={whitespace}
            onWhitespace={onWhitespace}
            onApply={onApplyHunk}
            onApplyFile={onApplyFile}
            onApplyLines={onApplyLines}
            onExternalDiff={() => onExternalDiff(active.opts)}
            onOpenFile={(side, line, path) => {
              const revisions = diffRevisions(active.opts);
              onOpenFile(path || active.opts.path, side === "before" ? revisions.before : revisions.after, line);
            }}
            onShowFileHistory={onShowFileHistory}
            root={root}
            onCopyPath={(text) => onCopyPath(text)}
            busy={busy}
            reloadKey={reloadKey}
            wrap={diffWrap}
            onToggleWrap={onToggleWrap}
            onNextFile={
              active.opts.target === "worktree" || active.opts.target === "staged"
                ? (delta) =>
                    onNextDiffFile(active.opts.path, active.opts.target === "staged" ? "INDEX" : "", delta)
                : undefined
            }
          />
        )}
      </div>
      {tabMenu && (
        <ContextMenu x={tabMenu.x} y={tabMenu.y} items={tabMenu.items} onClose={() => setTabMenu(null)} />
      )}
      {fileMenu.menuNode}
    </main>
  );
}
