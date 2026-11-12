import { useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";
import { buildChangeTree, directoryKeys } from "./changes";
import type { FileEntry } from "./CommitPanel";
import { DiffView } from "./DiffView";
import type { WhitespaceMode } from "./diff";
import { FileTree } from "./FileTree";
import { SourceEditor } from "./SourceEditor";
import { Git, Workspace } from "./mygo";
import type {
  BranchCleanup,
  Change,
  BranchInfo,
  CommitDetail,
  CommitFile,
  DiffOptions,
  FileDiff,
  MergeOptions,
  PullOptions,
  PushOptions,
  PushPreview,
  RebaseOptions,
  Conflict,
  Remote,
  Settings,
  SourceFile,
  StashFile,
  StashOptions,
  LocalHistoryEntry,
  TagOptions,
} from "./mygo";
import { Icon } from "./icons";
import { moveItem, TOOL_TAB_ICONS, type ToolTab } from "./tabs";
import {
  Button,
  Checkbox,
  ContextMenu,
  cx,
  Field,
  IconButton,
  Modal,
  Select,
  Spinner,
  Splitter,
  StatusMark,
  TextInput,
  formatWhen,
  useStoredState,
  type ContextItem,
} from "./ui";

import { count, useT } from "./i18n";
import { FileIcon } from "./icons";

const T = {
  en: {
    "common.cancel": "Cancel",
    "common.close": "Close",
    "common.rebase": "Rebase",
    "common.save": "Save",
    "common.create": "Create",
    "common.rename": "Rename",
    "common.merge": "Merge",
    "common.push": "Push",
    "common.pull": "Pull",
    "common.reset": "Reset",
    "common.stash": "Stash",
    "settings.title": "Settings",
    "settings.tabGeneral": "General",
    "settings.tabGit": "Git",
    "settings.tabKeys": "Shortcuts",
    "settings.panelGeneral": "General settings",
    "settings.panelTabs": "Dock tabs",
    "settings.tabOrderHint": "The left dock follows this order at once, with no save needed.",
    "settings.moveUp": "Move up",
    "settings.moveDown": "Move down",
    "settings.toolCommit": "Commit",
    "settings.toolBranch": "Branch",
    "settings.toolFiles": "Files",
    "settings.toolConsole": "Console",
    "settings.panelGitPath": "Git executable",
    "settings.panelConnection": "Remote connection",
    "settings.sshCommand": "SSH command",
    "settings.sshCommandHint": "Replaces the SSH client git runs, for a key or an agent. Empty keeps git's own.",
    "settings.fetchTags": "Fetch tags",
    "settings.fetchTagsAuto": "Follow the fetched history",
    "settings.fetchTagsAlways": "Always fetch all tags",
    "settings.fetchTagsNever": "Never fetch tags",
    "settings.panelDiff": "Diff settings",
    "settings.panelSync": "Sync and update",
    "settings.panelCommit": "Commit",
    "settings.panelDanger": "Confirmations",
    "settings.language": "Language",
    "settings.languageSystem": "Use system language",
    "settings.theme": "Theme",
    "settings.themeSystem": "Use system setting",
    "settings.themeLight": "Light",
    "settings.themeDark": "Dark",
    "settings.uiScale": "Font size",
    "settings.uiScaleSmall": "Small",
    "settings.uiScaleNormal": "Default",
    "settings.uiScaleLarge": "Large",
    "settings.uiScaleLargest": "Largest",
    "settings.openRepo": "Open Repository",
    "settings.openRepoSame": "Replace this window",
    "settings.openRepoNew": "Open a new window",
    "settings.openRepoHint": "Where a repository opens when you pick it from the recent list.",
    "settings.gitPath": "Git executable",
    "settings.gitPathHint": "Leave empty to use the git on PATH",
    "settings.gitAuto": "Detected automatically",
    "settings.test": "Test",
    "settings.gitVersion": "in use: git {version}",
    "settings.contextLines": "Context lines",
    "settings.contextLinesHint": "Lines of unchanged code kept around each change. -1 shows the whole file and only marks what changed.",
    "settings.ignoreWhitespace": "Ignore whitespace in diffs by default",
    "settings.ignoreWhitespaceHint": "Changes that only add, remove or reindent spaces are left out of the comparison.",
    "settings.showIgnored": "Show ignored files in the commit panel",
    "settings.showIgnoredHint": "Files matched by .gitignore stay in the change list instead of disappearing from it.",
    "settings.checkCrlf": "Warn about CRLF line separators",
    "settings.checkLarge": "Warn about files larger than",
    "settings.checkNames": "Warn about names Windows cannot check out",
    "settings.checkHead": "Warn about a detached HEAD",
    "settings.protected": "Protected branches",
    "settings.protectedHint": "One pattern per line, * as a wildcard. A commit on these branches asks first and a force-push is refused.",
    "settings.autoUpdate": "Offer an update when a push is rejected",
    "settings.template": "Commit message template",
    "settings.templateHint": "Put into the empty message box of a new repository window.",
    "settings.updateMethod": "Update method",
    "settings.updateMethodHint": "Merge keeps the branches' histories and adds a merge commit; rebase replays your local commits on top of the incoming ones, leaving a straight line.",
    "settings.merge": "Merge",
    "settings.rebase": "Rebase",
    "settings.autoFetch": "Fetch remotes automatically",
    "settings.autoFetchHint": "Only fetches: the remote-tracking branches are updated and nothing in your working tree or history changes. Merging is still up to you.",
    "settings.minutes": "minutes",
    "settings.autoFetchInterval": "Interval",
    "settings.confirmRollback": "Confirm before rolling back changes",
    "settings.confirmRollbackHint": "Rolling back discards local work that git cannot recover.",
    "settings.confirmForcePush": "Confirm force push",
    "settings.confirmForcePushHint": "A force push rewrites the remote branch and can drop commits other people already based work on.",
    "settings.resetTab": "Restore defaults",
    "settings.unsavedTitle": "Unsaved changes",
    "settings.unsaved": "This tab has edits that are not saved yet. Switching tabs loses them.",
    "settings.discard": "Discard",
    "settings.saveAndClose": "Save and close",
    "settings.keysHint": "These come from the menu and cannot be rebound here.",
    "settings.keyOpen": "Open repository",
    "settings.keyQuickOpen": "Quick open a file",
    "settings.keyCommit": "Commit",
    "settings.keyPush": "Push",
    "settings.keyUpdate": "Update project",
    "settings.keySettings": "Settings",
    "branch.new": "New Branch",
    "branch.rename": "Rename Branch",
    "branch.name": "Name",
    "branch.from": "From",
    "branch.current": "{ref} (current)",
    "branch.checkout": "Checkout the new branch",
    "branch.createCheckout": "Create and Checkout",
    "push.title": "Push Commits",
    "push.noRemotes": "This repository has no remotes. Add one with the Git console: ",
    "push.remote": "Remote",
    "push.branch": "Branch",
    "push.setUpstream": "Set upstream (-u)",
    "push.allTags": "Push tags",
    "push.dryRun": "Dry run",
    "push.force": "Force push (--force-with-lease)",
    "push.moreOptions": "More push options",
    "push.warning": "Force push rewrites history on the remote. It only succeeds when the remote branch is where you last saw it.",
    "push.chooseRemote": "Choose the remote to push to",
    "push.detached": "detached HEAD",
    "push.newBranch": "new branch",
    "push.targetBranch": "Remote branch",
    "push.targetHint": "The branch this pushes onto. Edit it to publish under another name.",
    "push.badBranch": "That is not a valid branch name.",
    "push.checking": "Reading what would be pushed…",
    "push.summary": "{commits} · {files} changed",
    "push.commitOne": "1 commit",
    "push.commitOther": "{n} commits",
    "push.fileOne": "1 file",
    "push.fileOther": "{n} files",
    "push.behind": "{n} behind the remote",
    "push.truncated": "showing the first {n}",
    "push.everything": "All commits",
    "push.filesHead": "Changed files · {n}",
    "push.allFilesHead": "All changed files · {n}",
    "push.noFiles": "No files changed",
    "push.expandAll": "Expand all",
    "push.collapseAll": "Collapse all",
    "push.on": "on {when}",
    "push.binary": "binary",
    "push.nothingToPush": "Everything here is already on the remote.",
    "push.createsOnly": "The branch has no new commits; pushing creates it at {hash}.",
    "push.dryRunAction": "Dry run",
    "push.diffTab": "Diff",
    "push.fileTab": "File",
    "push.fileView": "File view",
    "push.fileMissing": "This file does not exist in this revision.",
    "push.binaryFile": "Binary file — no text to show",
    "push.fileTruncated": "File truncated at 8 MB",
    "pull.title": "Update Project",
    "pull.note": "Pull fetches the remote and integrates the upstream into the current branch.",
    "pull.integrate": "Integrate with",
    "pull.autostash": "Stash local changes before update (--autostash)",
    "pull.prune": "Prune deleted remote branches",
    "pull.tags": "Fetch tags",
    "pushCommits.title": "Push commits up to {hash}",
    "pushCommits.note": "The commit and everything below it is published to the remote branch; nothing is checked out.",
    "pushCommits.branch": "Remote branch",
    "pull.ffOnly": "Fast-forward only (--ff-only)",
    "pull.noFF": "Always create a merge commit (--no-ff)",
    "pull.squash": "Squash the pulled commits (--squash)",
    "pull.noCommit": "Integrate without committing (--no-commit)",
    "rebase.title": "Rebase",
    "rebase.current": "Rebasing {branch}",
    "rebase.onto": "New base",
    "rebase.branch": "Branch to rebase",
    "rebase.autostash": "Stash local changes (--autostash)",
    "rebase.updateRefs": "Update branches pointing into the range (--update-refs)",
    "rebase.merges": "Recreate merge commits (--rebase-merges)",
    "rebase.empty": "Commits that become empty",
    "rebase.emptyDefault": "Leave it to git (drops them)",
    "rebase.emptyKeep": "Keep them (--empty=keep)",
    "rebase.emptyDrop": "Drop them (--empty=drop)",
    "rebase.emptyStop": "Stop and ask (--empty=stop)",
    "rebase.root": "Rebase the whole branch (--root)",
    "rebase.autosquash": "Autosquash",
    "rebase.autosquashConfig": "Follow git config",
    "rebase.autosquashOn": "Squash fixup!/squash! commits",
    "rebase.autosquashOff": "Leave them alone",
    "reset.title": "Reset Current Branch",
    "reset.note": "Move {hash} to this commit, along with the current branch.",
    "reset.noteSubject": "Move {hash} (“{subject}”) to this commit, along with the current branch.",
    "reset.soft": "Soft",
    "reset.softHint": "Keep all local changes staged.",
    "reset.mixed": "Mixed",
    "reset.mixedHint": "Keep local changes in the working tree, unstaged.",
    "reset.hard": "Hard",
    "reset.hardHint": "Discard all local changes. This cannot be undone.",
    "reset.keep": "Keep local changes",
    "reset.keepHint": "Move HEAD and update the files that differ, but keep local changes that would not be lost.",
    "tag.title": "New Tag",
    "tag.tagging": "Tagging {hash}",
    "tag.name": "Tag name",
    "tag.message": "Message",
    "tag.messageHint": "Leave empty for a lightweight tag.",
    "tag.messagePlaceholder": "Release 1.0.0",
    "tag.force": "Replace an existing tag (-f)",
    "tag.create": "Create Tag",
    "stash.title": "Stash Changes",
    "stash.message": "Message",
    "stash.messagePlaceholder": "WIP on feature",
    "stash.untracked": "Include untracked files (-u)",
    "stash.keepIndex": "Keep staged changes in the index (--keep-index)",
    "changelist.new": "New Changelist",
    "changelist.rename": "Rename Changelist",
    "changelist.name": "Name",
    "changelist.namePlaceholder": "Refactoring",
    "changelist.comment": "Comment",
    "changelist.commentPlaceholder": "Optional",
    "merge.title": "Merge Branch",
    "merge.titleNamed": "Merge “{branch}” into “{into}”",
    "merge.select": "Select a branch",
    "merge.into": "Merge into",
    "merge.branch": "Branch",
    "merge.noFF": "Create a merge commit (--no-ff)",
    "merge.ffOnly": "Fast-forward only (--ff-only)",
    "merge.squash": "Squash commits (--squash)",
    "merge.noCommit": "Do not commit the merge result (--no-commit)",
    "merge.noVerify": "Bypass the hooks (--no-verify)",
    "merge.unrelated": "Allow unrelated histories (--allow-unrelated-histories)",
    "merge.message": "Merge message",
    "push.diverged": "The remote branch has commits you do not have (tip {tip}). Pushing overwrites them.",
    "push.forceIfIncludes": "Refuse the force if the remote moved (--force-if-includes)",
    "stashd.title": "Stash {ref}",
    "stashd.loading": "Reading the stash",
    "stashd.empty": "This stash has no files",
    "stashd.binary": "binary",
    "stashd.open": "Open the diff",
    "stashd.pop": "Pop",
    "stashd.apply": "Apply",
    "localHistory.title": "Local History — {path}",
    "localHistory.repoTitle": "Local History — Repository",
    "localHistory.loading": "Reading the local history",
    "localHistory.empty": "No saved copies of this file yet",
    "localHistory.repoEmpty": "No saved copies in this repository yet",
    "localHistory.unlabelled": "unlabelled",
    "localHistory.restore": "Restore This Copy",
    "localHistory.label": "Label",
    "localHistory.labelPlaceholder": "Name this copy",
    "localHistory.binary": "This copy cannot be shown as text.",
    "review.title": "Review Changes",
    "review.files": "Changed files",
    "review.loading": "Reading the diff",
    "review.empty": "There are no changes to review",
    "review.failed": "The diff could not be read",
    "rollback.title": "Rollback Changes",
    "rollback.files": "Changes to roll back",
    "rollback.empty": "There are no changes to roll back",
    "rollback.deleteAdded": "Delete local copies of added files",
    "rollback.action": "Rollback",
    "rollback.hint": "Rolling back restores the selected paths to HEAD; a file HEAD does not have leaves the index.",
    "stashd.restoreIndex": "Reinstate the index (--index)",
    "stashd.compareLocal": "Compare with the working tree",
    "stashd.branch": "Restore on a new branch",
    "stashd.drop": "Drop",
    "stashd.branchPlaceholder": "branch name",
    "stashd.cancel": "Close",
    "cleanup.title": "Clean Up Branches",
    "cleanup.merged": "Merged into the current branch",
    "cleanup.gone": "Upstream is gone",
    "cleanup.empty": "No branch can be cleaned up",
    "cleanup.delete": "Delete {n} branches",
    "cleanup.cancel": "Cancel",
    "conflicts.title": "Resolve Conflicts",
    "conflicts.ours": "Take ours",
    "conflicts.theirs": "Take theirs",
    "conflicts.oursMany": "Take ours for {n} files",
    "conflicts.theirsMany": "Take theirs for {n} files",
    "conflicts.allOurs": "All ours",
    "conflicts.allTheirs": "All theirs",
    "conflicts.open": "Merge…",
    "conflicts.mark": "Mark resolved",
    "conflicts.markAll": "Mark all resolved",
    "conflicts.continue": "Continue",
    "conflicts.abort": "Abort",
    "conflicts.close": "Close",
    "conflicts.empty": "No conflicted files",
    "conflicts.yoursCol": "Your changes ({name})",
    "conflicts.theirsCol": "Their changes ({name})",
    "conflicts.unresolvedGroup": "Unresolved",
    "conflicts.resolvedGroup": "Resolved",
    "conflicts.allResolved": "All conflicts resolved",
    "conflicts.files": "{n} files",
    "conflicts.solveSimple": "Resolve all simple conflicts",
    "conflicts.mergeInMemory": "Three-way merge all",
    "conflicts.showDirs": "Show directories",
    "conflicts.accept": "Accept",
    "conflicts.acceptFinish": "Accept and Finish",
    "conflicts.manual": "Resolve Manually",
    "conflicts.modified": "Modified",
    "conflicts.added": "Added",
    "conflicts.deleted": "Deleted",
    "conflicts.merging": "Merging branch {theirs} into branch {ours}",
    "conflicts.rebasing": "Rebasing {ours} onto {theirs}",
    "conflicts.operation": "Resolving conflicts",
    "compare.title": "Compare with the working branch",
    "compare.loading": "Comparing",
    "compare.empty": "No file differs",
    "compare.swap": "Swap the two revisions",
    "compare.close": "Close",
    "compare.files": "{n} files differ",
  },
  zh: {
    "common.cancel": "取消",
    "common.close": "关闭",
    "common.rebase": "Rebase",
    "common.save": "保存",
    "common.create": "创建",
    "common.rename": "重命名",
    "common.merge": "Merge",
    "common.push": "Push",
    "common.pull": "Pull",
    "common.reset": "Reset",
    "common.stash": "Stash",
    "settings.title": "设置",
    "settings.tabGeneral": "通用",
    "settings.tabGit": "Git",
    "settings.tabKeys": "快捷键",
    "settings.panelGeneral": "通用设置",
    "settings.panelTabs": "工具窗口顺序",
    "settings.tabOrderHint": "左侧工具窗口立即按此顺序显示，无需保存。",
    "settings.moveUp": "上移",
    "settings.moveDown": "下移",
    "settings.toolCommit": "提交",
    "settings.toolBranch": "分支",
    "settings.toolFiles": "文件",
    "settings.toolConsole": "控制台",
    "settings.panelGitPath": "Git 基础配置",
    "settings.panelDiff": "差异对比设置",
    "settings.panelSync": "同步 Pull 设置",
    "settings.panelCommit": "提交",
    "settings.panelDanger": "危险操作确认",
    "settings.language": "界面语言",
    "settings.languageSystem": "跟随系统",
    "settings.theme": "主题",
    "settings.themeSystem": "跟随系统",
    "settings.themeLight": "浅色",
    "settings.themeDark": "深色",
    "settings.uiScale": "字号",
    "settings.uiScaleSmall": "小",
    "settings.uiScaleNormal": "默认",
    "settings.uiScaleLarge": "大",
    "settings.uiScaleLargest": "特大",
    "settings.openRepo": "打开仓库时",
    "settings.openRepoSame": "替换当前窗口",
    "settings.openRepoNew": "在新窗口中打开",
    "settings.openRepoHint": "从最近列表里选择仓库时，在哪个窗口打开。",
    "settings.gitPath": "Git 可执行文件",
    "settings.gitPathHint": "留空则自动读取系统 PATH 中的 Git",
    "settings.gitAuto": "自动检测",
    "settings.test": "测试",
    "settings.gitVersion": "当前检测版本 git {version}",
    "settings.contextLines": "上下文行数",
    "settings.contextLinesHint": "每一处改动周围保留的未改动行数。-1 表示显示整个文件，只高亮改动部分。",
    "settings.ignoreWhitespace": "默认忽略空白差异",
    "settings.ignoreWhitespaceHint": "对比代码时，忽略仅空格、缩进或换行上的变动。",
    "settings.showIgnored": "在提交面板中显示被忽略的文件",
    "settings.showIgnoredHint": "被 .gitignore 忽略的文件依然列在更改列表里，而不是直接消失。",
    "settings.checkCrlf": "提交时警告 CRLF 换行",
    "settings.checkLarge": "警告超过此大小的文件",
    "settings.checkNames": "警告 Windows 无法检出的文件名",
    "settings.checkHead": "警告分离的 HEAD",
    "settings.protected": "受保护分支",
    "settings.protectedHint": "每行一个模式，支持 * 通配。在这些分支上提交会先确认，强制推送会被拒绝。",
    "settings.autoUpdate": "Push 被拒绝时提示更新",
    "settings.template": "提交信息模板",
    "settings.templateHint": "新提交框为空时填入这段文字。",
    "settings.updateMethod": "Pull 方式",
    "settings.updateMethodHint": "Merge 保留两条历史并产生一个 merge 提交；Rebase 把你的本地提交重放到远端提交之上，历史是一条直线。",
    "settings.merge": "Merge",
    "settings.rebase": "Rebase",
    "settings.autoFetch": "自动 Fetch 远程更新",
    "settings.autoFetchHint": "只执行 Fetch：刷新远端分支的状态，不会 Merge、不会改动你的工作区或历史——要 Pull 仍然由你手动触发。",
    "settings.minutes": "分钟",
    "settings.autoFetchInterval": "Fetch 间隔",
    "settings.confirmRollback": "回滚更改前确认",
    "settings.confirmRollbackHint": "回滚会丢弃 git 无法找回的本地改动。",
    "settings.confirmForcePush": "Force Push 前确认",
    "settings.confirmForcePushHint": "Force Push 会覆盖远端分支，可能丢掉他人已经基于其开发的提交。",
    "settings.resetTab": "恢复默认",
    "settings.unsavedTitle": "未保存的修改",
    "settings.unsaved": "当前页有尚未保存的修改，切换后将会丢失。",
    "settings.discard": "放弃修改",
    "settings.saveAndClose": "保存并关闭",
    "settings.keysHint": "这些来自菜单，暂不支持在这里修改。",
    "settings.keyOpen": "打开仓库",
    "settings.keyQuickOpen": "快速打开文件",
    "settings.keyCommit": "Commit",
    "settings.keyPush": "Push",
    "settings.keyUpdate": "Pull",
    "settings.keySettings": "设置",
    "branch.new": "新建分支",
    "branch.rename": "重命名分支",
    "branch.name": "名称",
    "branch.from": "起点",
    "branch.current": "{ref}（当前）",
    "branch.checkout": "Checkout 到新分支",
    "branch.createCheckout": "创建并 Checkout",
    "push.title": "Push 提交",
    "push.noRemotes": "此仓库没有远程。可在 Git 控制台中添加：",
    "push.remote": "远程",
    "push.branch": "分支",
    "push.setUpstream": "设置上游 (-u)",
    "push.allTags": "Push 标签",
    "push.dryRun": "试运行",
    "push.force": "Force Push（--force-with-lease）",
    "push.moreOptions": "更多 Push 选项",
    "push.warning": "Force Push 会重写远程历史。仅当远程分支仍停在你上次看到的位置时才会成功。",
    "push.chooseRemote": "选择要 Push 到哪个远程",
    "push.detached": "游离 HEAD",
    "push.newBranch": "新建分支",
    "push.targetBranch": "远程分支",
    "push.targetHint": "Push 到的远程分支。改成另一个名字即可用不同名称发布。",
    "push.badBranch": "这不是合法的分支名。",
    "push.checking": "正在读取将要 Push 的内容…",
    "push.summary": "{commits} · {files} 项变更",
    "push.commitOne": "1 个提交",
    "push.commitOther": "{n} 个提交",
    "push.fileOne": "1 个文件",
    "push.fileOther": "{n} 个文件",
    "push.behind": "落后远程 {n} 个提交",
    "push.truncated": "仅显示前 {n} 个",
    "push.everything": "全部提交",
    "push.filesHead": "变更文件 · {n}",
    "push.allFilesHead": "全部变更文件 · {n}",
    "push.noFiles": "没有文件变更",
    "push.expandAll": "全部展开",
    "push.collapseAll": "全部折叠",
    "push.on": "于 {when}",
    "push.binary": "二进制",
    "push.nothingToPush": "本地内容都已经在远程上了。",
    "push.createsOnly": "该分支没有新提交，Push 会在远程创建它（{hash}）。",
    "push.dryRunAction": "试运行",
    "push.diffTab": "差异",
    "push.fileTab": "文件",
    "push.fileView": "文件视图",
    "push.fileMissing": "此版本中不存在该文件。",
    "push.binaryFile": "二进制文件 — 无文本可显示",
    "push.fileTruncated": "文件已截断至 8 MB",
    "pull.title": "Pull",
    "pull.note": "Pull 会 Fetch 远程内容，并把上游 Merge 进当前分支。",
    "pull.integrate": "整合方式",
    "pull.autostash": "Pull 前 Stash 本地更改（--autostash）",
    "pull.prune": "清理已删除的远程分支",
    "pull.tags": "Fetch 标签",
    "pushCommits.title": "推送提交到 {hash}",
    "pushCommits.note": "该提交及其之前的提交会发布到远端分支，不会检出任何内容。",
    "pushCommits.branch": "远端分支",
    "pull.ffOnly": "仅允许快进（--ff-only）",
    "pull.noFF": "始终创建 Merge 提交（--no-ff）",
    "pull.squash": "Squash 拉取的提交（--squash）",
    "pull.noCommit": "整合但不提交（--no-commit）",
    "rebase.title": "Rebase",
    "rebase.current": "正在 Rebase {branch}",
    "rebase.onto": "新基点",
    "rebase.branch": "要 Rebase 的分支",
    "rebase.autostash": "Stash 本地更改（--autostash）",
    "rebase.updateRefs": "更新指向该区间的分支（--update-refs）",
    "rebase.merges": "重建 Merge 提交（--rebase-merges）",
    "rebase.empty": "变为空的提交",
    "rebase.emptyDefault": "跟随 git（丢弃）",
    "rebase.emptyKeep": "保留（--empty=keep）",
    "rebase.emptyDrop": "丢弃（--empty=drop）",
    "rebase.emptyStop": "停下来询问（--empty=stop）",
    "rebase.root": "Rebase 整个分支（--root）",
    "rebase.autosquash": "自动合并",
    "rebase.autosquashConfig": "跟随 Git 配置",
    "rebase.autosquashOn": "合并 fixup!/squash! 提交",
    "rebase.autosquashOff": "不自动合并",
    "reset.title": "Reset 当前分支",
    "reset.note": "将当前分支与 {hash} 一起移动到该提交。",
    "reset.noteSubject": "将当前分支与 {hash}（“{subject}”）一起移动到该提交。",
    "reset.soft": "Soft Reset",
    "reset.softHint": "保留所有本地更改并维持已暂存状态。",
    "reset.mixed": "Mixed Reset",
    "reset.mixedHint": "保留本地更改，但取消暂存。",
    "reset.hard": "Hard Reset",
    "reset.hardHint": "丢弃所有本地更改，且无法撤销。",
    "reset.keep": "保留本地更改",
    "reset.keepHint": "移动 HEAD 并更新有差异的文件，但保留不会被丢弃的本地更改。",
    "tag.title": "新建标签",
    "tag.tagging": "为 {hash} 创建标签",
    "tag.name": "标签名",
    "tag.message": "说明",
    "tag.messageHint": "留空则创建轻量标签。",
    "tag.messagePlaceholder": "发布 1.0.0",
    "tag.force": "替换已有标签（-f）",
    "tag.create": "创建标签",
    "stash.title": "Stash 更改",
    "stash.message": "说明",
    "stash.messagePlaceholder": "功能开发中",
    "stash.untracked": "包含未跟踪文件（-u）",
    "stash.keepIndex": "保留已暂存内容（--keep-index）",
    "changelist.new": "新建更改列表",
    "changelist.rename": "重命名更改列表",
    "changelist.name": "名称",
    "changelist.namePlaceholder": "重构",
    "changelist.comment": "备注",
    "changelist.commentPlaceholder": "可选",
    "merge.title": "Merge 分支",
    "merge.titleNamed": "将“{branch}”合并到“{into}”",
    "merge.select": "选择分支",
    "merge.into": "Merge 到",
    "merge.branch": "分支",
    "merge.noFF": "创建 Merge 提交（--no-ff）",
    "merge.ffOnly": "仅允许快进（--ff-only）",
    "merge.squash": "Squash 提交（--squash）",
    "merge.noCommit": "不提交 Merge 结果（--no-commit）",
    "merge.noVerify": "跳过 hooks（--no-verify）",
    "merge.unrelated": "允许无共同历史（--allow-unrelated-histories）",
    "merge.message": "Merge 提交信息",
    "push.diverged": "远端分支有本地没有的提交（{tip}），Push 会覆盖它。",
    "push.forceIfIncludes": "远端有新提交时拒绝强推（--force-if-includes）",
    "stashd.title": "Stash {ref}",
    "stashd.loading": "正在读取 Stash 内容",
    "stashd.empty": "该 Stash 没有文件",
    "stashd.binary": "二进制",
    "stashd.open": "查看差异",
    "stashd.pop": "弹出",
    "stashd.apply": "应用",
    "localHistory.title": "本地历史 — {path}",
    "localHistory.repoTitle": "本地历史 — 仓库",
    "localHistory.loading": "正在读取本地历史",
    "localHistory.empty": "这个文件还没有历史副本",
    "localHistory.repoEmpty": "这个仓库还没有历史副本",
    "localHistory.unlabelled": "未命名",
    "localHistory.restore": "恢复此副本",
    "localHistory.label": "标记",
    "localHistory.labelPlaceholder": "为此副本命名",
    "localHistory.binary": "此副本无法以文本显示。",
    "review.title": "Review 更改",
    "review.files": "已更改的文件",
    "review.loading": "正在读取差异",
    "review.empty": "没有可 Review 的更改",
    "review.failed": "无法读取差异",
    "rollback.title": "回滚更改",
    "rollback.files": "要回滚的更改",
    "rollback.empty": "没有可回滚的更改",
    "rollback.deleteAdded": "删除添加的文件的本地副本",
    "rollback.action": "回滚",
    "rollback.hint": "回滚会把选中的路径恢复为 HEAD；HEAD 中没有的文件会退出暂存区。",
    "stashd.restoreIndex": "还原暂存区（--index）",
    "stashd.compareLocal": "与工作区比较",
    "stashd.branch": "恢复到新分支",
    "stashd.drop": "Stash drop",
    "stashd.branchPlaceholder": "分支名",
    "stashd.cancel": "关闭",
    "cleanup.title": "清理分支",
    "cleanup.merged": "已 Merge 到当前分支",
    "cleanup.gone": "上游已删除",
    "cleanup.empty": "没有可清理的分支",
    "cleanup.delete": "删除 {n} 个分支",
    "cleanup.cancel": "取消",
    "conflicts.title": "解决冲突",
    "conflicts.ours": "采用我方",
    "conflicts.oursMany": "为 {n} 个文件采用我方",
    "conflicts.theirsMany": "为 {n} 个文件采用对方",
    "conflicts.theirs": "采用对方",
    "conflicts.allOurs": "全部采用我方",
    "conflicts.allTheirs": "全部采用对方",
    "conflicts.open": "合并…",
    "conflicts.mark": "标记为已解决",
    "conflicts.markAll": "全部标记为已解决",
    "conflicts.continue": "继续",
    "conflicts.abort": "中止",
    "conflicts.close": "关闭",
    "conflicts.empty": "没有冲突文件",
    "conflicts.yoursCol": "您的更改 ({name})",
    "conflicts.theirsCol": "他人的更改 ({name})",
    "conflicts.unresolvedGroup": "未解决",
    "conflicts.resolvedGroup": "已解决",
    "conflicts.allResolved": "所有冲突已解决",
    "conflicts.files": "{n} 文件",
    "conflicts.solveSimple": "解决所有简单冲突",
    "conflicts.mergeInMemory": "全部三方合并",
    "conflicts.showDirs": "显示目录",
    "conflicts.accept": "接受",
    "conflicts.acceptFinish": "接受并完成",
    "conflicts.manual": "手动解决",
    "conflicts.modified": "已修改",
    "conflicts.added": "已添加",
    "conflicts.deleted": "已删除",
    "conflicts.merging": "将分支 {theirs} 合并到分支 {ours}",
    "conflicts.rebasing": "正在将 {ours} 变基到 {theirs}",
    "conflicts.operation": "解决冲突",
    "compare.title": "与当前分支比较",
    "compare.loading": "正在比较",
    "compare.empty": "没有不同的文件",
    "compare.swap": "交换两个版本",
    "compare.close": "关闭",
    "compare.files": "{n} 个文件不同",
  },
} as const;

/** SettingRow is a panel's grid: a label rail, then the control. A row
 *  without a label is a checkbox whose own text carries the meaning, so it
 *  keeps the rail out of the way instead of leaving a hole in it. */
function SettingRow({ label, hint, children }: { label?: string; hint?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className={label ? "setting-row" : "setting-row check"}>
      {label && <div className="setting-label">{label}</div>}
      <div className="setting-control">
        {children}
        {hint && <div className="setting-hint">{hint}</div>}
      </div>
    </div>
  );
}

/** TKey is a key of the dialog dictionary, for the places that pick a label
 *  at runtime. */
type TKey = keyof (typeof T)["en"] & string;

/** The panels a tab shows, in order, and whether they start open. Only the
 *  settings most people change are open; the rest wait behind a click, and
 *  the last state is remembered. */
const PANELS: { id: string; title: TKey; open: boolean; tone?: "warning" }[] = [
  { id: "general", title: "settings.panelGeneral", open: true },
  { id: "tabs", title: "settings.panelTabs", open: true },
  { id: "gitPath", title: "settings.panelGitPath", open: true },
  { id: "connection", title: "settings.panelConnection", open: false },
  { id: "diff", title: "settings.panelDiff", open: false },
  { id: "sync", title: "settings.panelSync", open: true },
  { id: "commit", title: "settings.panelCommit", open: false },
  { id: "danger", title: "settings.panelDanger", open: true, tone: "warning" },
];

type SettingsTab = "general" | "git" | "keys";

/** Which fields each tab owns: the save button, the reset button and the
 *  unsaved-changes prompt all work on this mapping, so a tab can never
 *  silently discard a field it does not show. */
const TAB_FIELDS: Record<SettingsTab, (keyof Settings)[]> = {
  general: ["language", "theme", "uiScale", "openInNewWindow"],
  git: [
    "gitPath",
    "sshCommand",
    "fetchTagsMode",
    "diffContext",
    "ignoreWhitespace",
    "showIgnored",
    "updateMethod",
    "autoFetch",
    "autoFetchMinutes",
    "confirmRollback",
    "confirmForcePush",
    "commitCheckCrlf",
    "commitCheckLargeMB",
    "commitCheckNames",
    "commitCheckHead",
    "commitTemplate",
    "protectedBranches",
    "autoUpdateOnReject",
  ],
  keys: [],
};

const PANEL_STATE_KEY = "gitjet.settings.panels";

function readPanelState(): Record<string, boolean> {
  const start = Object.fromEntries(PANELS.map((p) => [p.id, p.open]));
  try {
    const saved = JSON.parse(localStorage.getItem(PANEL_STATE_KEY) ?? "{}");
    if (saved && typeof saved === "object") {
      for (const id of Object.keys(start)) {
        if (typeof saved[id] === "boolean") start[id] = saved[id];
      }
    }
  } catch {
    // A corrupt entry is not worth a dialog: fall back to the defaults.
  }
  return start;
}

function field<T>(s: Settings, key: keyof Settings): T {
  return s[key] as T;
}

/** The dock's pages, named the way the strip names them. */
const TOOL_TAB_LABELS: Record<ToolTab, TKey> = {
  commit: "settings.toolCommit",
  branch: "settings.toolBranch",
  files: "settings.toolFiles",
  console: "settings.toolConsole",
};

export function SettingsDialog({
  settings,
  tabOrder,
  onTabOrder,
  onSave,
  onClose,
  onValidate,
}: {
  settings: Settings;
  tabOrder: ToolTab[];
  onTabOrder: (order: ToolTab[]) => void;
  onSave: (next: Settings) => void;
  onClose: () => void;
  onValidate: (path: string) => Promise<string>;
}) {
  const t = useT(T);
  const [tab, setTab] = useState<SettingsTab>("general");
  const [draft, setDraft] = useState<Settings>(settings);
  const [open, setOpen] = useState<Record<string, boolean>>(readPanelState);
  const [pending, setPending] = useState<SettingsTab | null>(null);
  const [defaults, setDefaults] = useState<Settings | null>(null);
  const panelsRef = useRef<HTMLDivElement>(null);
  const [gitVersion, setGitVersion] = useState("");
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState("");

  // The defaults power the reset button; the detected version tells the user
  // which git the field is about before anything is typed. Both are fetched
  // once: the parent re-renders often and must not re-spawn git each time.
  const boot = useRef({ defaults: false, version: false });
  useEffect(() => {
    if (!boot.current.defaults) {
      boot.current.defaults = true;
      void Workspace.defaultSettings()
        .then(setDefaults)
        .catch(() => {
          // Without the defaults the reset button stays disabled.
        });
    }
    if (!boot.current.version) {
      boot.current.version = true;
      void onValidate("")
        .then(setGitVersion)
        .catch(() => {
          // No git found: the field's own hint already covers that.
        });
    }
  }, [onValidate]);

  // A tab opens at its first panel, not wherever the previous one was scrolled.
  useEffect(() => {
    const body = panelsRef.current?.closest(".modal-body");
    if (body) body.scrollTop = 0;
  }, [tab]);

  const set = <K extends keyof Settings>(key: K, value: Settings[K]) => setDraft({ ...draft, [key]: value });

  const anyDirty = (Object.keys(TAB_FIELDS) as SettingsTab[]).some((name) =>
    TAB_FIELDS[name].some((k) => draft[k] !== settings[k]),
  );
  const canReset =
    !!defaults && TAB_FIELDS[tab].some((k) => draft[k] !== field(defaults, k));

  const togglePanel = (id: string) => {
    const next = { ...open, [id]: !open[id] };
    setOpen(next);
    try {
      localStorage.setItem(PANEL_STATE_KEY, JSON.stringify(next));
    } catch {
      // Private storage: the panels simply go back to their defaults.
    }
  };

  const pickTab = (next: SettingsTab) => {
    if (next === tab) return;
    if (TAB_FIELDS[tab].some((k) => draft[k] !== settings[k])) {
      setPending(next);
      return;
    }
    setTab(next);
  };

  const discardThen = (next: SettingsTab) => {
    setDraft(settings);
    setPending(null);
    setTab(next);
  };

  const validate = async () => {
    setChecking(true);
    setError("");
    try {
      setGitVersion(await onValidate(draft.gitPath));
    } catch (err) {
      setGitVersion("");
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setChecking(false);
    }
  };

  const panel = (id: string, body: React.ReactNode) => {
    const spec = PANELS.find((p) => p.id === id)!;
    const isOpen = open[id];
    return (
      <section key={id} className={cx("settings-panel", spec.tone === "warning" && "warn", isOpen && "open")}>
        <button
          type="button"
          className="settings-panel-head"
          aria-expanded={isOpen}
          onClick={() => togglePanel(id)}
        >
          <Icon name={isOpen ? "chevronDown" : "chevronRight"} size={12} />
          <span className="settings-panel-title">
            {t(spec.title)}
            {spec.tone === "warning" && <Icon name="warning" size={12} className="settings-panel-warn" />}
          </span>
        </button>
        {isOpen && <div className="settings-panel-body">{body}</div>}
      </section>
    );
  };

  const gitVersionNote = gitVersion ? t("settings.gitVersion", { version: gitVersion }) : "";

  return (
    <Modal
      title={t("settings.title")}
      icon="settings"
      width={640}
      className="settings-modal"
      onClose={pending ? () => setPending(null) : onClose}
      footer={
        <>
          <Button
            className="settings-reset"
            disabled={!canReset}
            onClick={() => {
              if (!defaults) return;
              const next = { ...draft };
              for (const k of TAB_FIELDS[tab]) (next[k] as unknown) = field(defaults, k);
              setDraft(next);
            }}
          >
            {t("settings.resetTab")}
          </Button>
          <Button onClick={onClose}>{t("common.cancel")}</Button>
          <Button variant="primary" disabled={!anyDirty} onClick={() => onSave(draft)}>
            {t("common.save")}
          </Button>
        </>
      }
    >
      <div className="settings">
        <div className="settings-head">
          <div className="settings-tabs" role="tablist">
            {(
              [
                ["general", "settings.tabGeneral"],
                ["git", "settings.tabGit"],
                ["keys", "settings.tabKeys"],
              ] as [SettingsTab, string][]
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                role="tab"
                className="settings-tab"
                aria-selected={tab === id}
                onClick={() => pickTab(id)}
              >
                {t(label as TKey)}
              </button>
            ))}
          </div>
        </div>

        <div className="settings-panels" role="tabpanel" ref={panelsRef}>
          {tab === "general" && (
            <>
              {panel(
                "general",
                <>
                  <SettingRow label={t("settings.language")}>
                    <Select value={draft.language} onChange={(v) => set("language", v)}>
                      <option value="system">{t("settings.languageSystem")}</option>
                      <option value="en">English</option>
                      <option value="zh">简体中文</option>
                    </Select>
                  </SettingRow>
                  <SettingRow label={t("settings.theme")}>
                    <Select value={draft.theme} onChange={(v) => set("theme", v)}>
                      <option value="system">{t("settings.themeSystem")}</option>
                      <option value="light">{t("settings.themeLight")}</option>
                      <option value="dark">{t("settings.themeDark")}</option>
                    </Select>
                  </SettingRow>
                  <SettingRow label={t("settings.uiScale")}>
                    <Select value={String(draft.uiScale)} onChange={(v) => set("uiScale", Number(v))}>
                      <option value="90">{t("settings.uiScaleSmall")}</option>
                      <option value="100">{t("settings.uiScaleNormal")}</option>
                      <option value="112">{t("settings.uiScaleLarge")}</option>
                      <option value="125">{t("settings.uiScaleLargest")}</option>
                    </Select>
                  </SettingRow>
                  <SettingRow label={t("settings.openRepo")} hint={t("settings.openRepoHint")}>
                    <Select
                      value={draft.openInNewWindow ? "new" : "same"}
                      onChange={(v) => set("openInNewWindow", v === "new")}
                    >
                      <option value="same">{t("settings.openRepoSame")}</option>
                      <option value="new">{t("settings.openRepoNew")}</option>
                    </Select>
                  </SettingRow>
                </>,
              )}

              {panel(
                "tabs",
                <>
                  <div className="tool-order">
                    {tabOrder.map((id, index) => (
                      <div className="tool-order-row" key={id}>
                        <Icon name={TOOL_TAB_ICONS[id]} size={14} />
                        <span className="tool-order-name">{t(TOOL_TAB_LABELS[id])}</span>
                        <IconButton
                          icon="chevronUp"
                          small
                          title={t("settings.moveUp")}
                          disabled={index === 0}
                          onClick={() => onTabOrder(moveItem(tabOrder, index, index - 1))}
                        />
                        <IconButton
                          icon="chevronDown"
                          small
                          title={t("settings.moveDown")}
                          disabled={index === tabOrder.length - 1}
                          onClick={() => onTabOrder(moveItem(tabOrder, index, index + 1))}
                        />
                      </div>
                    ))}
                  </div>
                  <div className="setting-hint">{t("settings.tabOrderHint")}</div>
                </>,
              )}
            </>
          )}

          {tab === "git" && (
            <>
              {panel(
                "gitPath",
                <SettingRow
                  label={t("settings.gitPath")}
                  hint={
                    <>
                      {t("settings.gitPathHint")}
                      {gitVersionNote && <span className="setting-hint-value"> · {gitVersionNote}</span>}
                    </>
                  }
                >
                  <div className="setting-field-group">
                    <TextInput
                      value={draft.gitPath}
                      onChange={(v) => {
                        set("gitPath", v);
                        setGitVersion("");
                        setError("");
                      }}
                      placeholder={t("settings.gitAuto")}
                      monospace
                    />
                    <Button onClick={validate} disabled={checking}>
                      {checking ? <Spinner /> : t("settings.test")}
                    </Button>
                  </div>
                  {error && <div className="setting-note error">{error}</div>}
                </SettingRow>,
              )}
              {panel(
                "connection",
                <>
                  <SettingRow label={t("settings.sshCommand")} hint={t("settings.sshCommandHint")}>
                    <TextInput
                      value={draft.sshCommand}
                      onChange={(value) => set("sshCommand", value)}
                      placeholder="ssh -i ~/.ssh/id_ed25519"
                      monospace
                    />
                  </SettingRow>
                  <SettingRow label={t("settings.fetchTags")}>
                    <Select value={draft.fetchTagsMode} onChange={(v) => set("fetchTagsMode", v)}>
                      <option value="auto">{t("settings.fetchTagsAuto")}</option>
                      <option value="always">{t("settings.fetchTagsAlways")}</option>
                      <option value="never">{t("settings.fetchTagsNever")}</option>
                    </Select>
                  </SettingRow>
                </>,
              )}

              {panel(
                "diff",
                <>
                  <SettingRow label={t("settings.contextLines")} hint={t("settings.contextLinesHint")}>
                    <input
                      className="text-input number"
                      type="number"
                      min={-1}
                      max={100}
                      value={draft.diffContext}
                      onChange={(e) => {
                        const n = Number.parseInt(e.target.value, 10);
                        set("diffContext", Number.isNaN(n) ? -1 : n);
                      }}
                    />
                  </SettingRow>
                  <SettingRow hint={t("settings.ignoreWhitespaceHint")}>
                    <Checkbox
                      checked={draft.ignoreWhitespace}
                      onChange={(v) => set("ignoreWhitespace", v)}
                      label={t("settings.ignoreWhitespace")}
                    />
                  </SettingRow>
                  <SettingRow hint={t("settings.showIgnoredHint")}>
                    <Checkbox
                      checked={draft.showIgnored}
                      onChange={(v) => set("showIgnored", v)}
                      label={t("settings.showIgnored")}
                    />
                  </SettingRow>
                </>,
              )}

              {panel(
                "sync",
                <>
                  <SettingRow label={t("settings.updateMethod")} hint={t("settings.updateMethodHint")}>
                    <Select value={draft.updateMethod} onChange={(v) => set("updateMethod", v)}>
                      <option value="merge">{t("settings.merge")}</option>
                      <option value="rebase">{t("settings.rebase")}</option>
                    </Select>
                  </SettingRow>
                  <SettingRow hint={t("settings.autoFetchHint")}>
                    <Checkbox
                      checked={draft.autoFetch}
                      onChange={(v) => set("autoFetch", v)}
                      label={t("settings.autoFetch")}
                    />
                  </SettingRow>
                  <SettingRow label={t("settings.autoFetchInterval")}>
                    <div className="setting-inline">
                      <input
                        className="text-input number"
                        type="number"
                        min={1}
                        max={240}
                        disabled={!draft.autoFetch}
                        value={draft.autoFetchMinutes}
                        onChange={(e) => set("autoFetchMinutes", Number(e.target.value) || 15)}
                      />
                      <span className="setting-unit">{t("settings.minutes")}</span>
                    </div>
                  </SettingRow>
                </>,
              )}

              {panel(
                "commit",
                <>
                  <SettingRow hint={t("settings.checkCrlf")}>
                    <Checkbox
                      checked={draft.commitCheckCrlf}
                      onChange={(v) => set("commitCheckCrlf", v)}
                      label={t("settings.checkCrlf")}
                    />
                  </SettingRow>
                  <SettingRow label={t("settings.checkLarge")}>
                    <div className="setting-inline">
                      <input
                        className="text-input number"
                        type="number"
                        min={0}
                        max={1000}
                        value={draft.commitCheckLargeMB}
                        onChange={(e) => set("commitCheckLargeMB", Number(e.target.value) || 0)}
                      />
                      <span className="setting-unit">MB</span>
                    </div>
                  </SettingRow>
                  <SettingRow hint={t("settings.checkNames")}>
                    <Checkbox
                      checked={draft.commitCheckNames}
                      onChange={(v) => set("commitCheckNames", v)}
                      label={t("settings.checkNames")}
                    />
                  </SettingRow>
                  <SettingRow hint={t("settings.checkHead")}>
                    <Checkbox
                      checked={draft.commitCheckHead}
                      onChange={(v) => set("commitCheckHead", v)}
                      label={t("settings.checkHead")}
                    />
                  </SettingRow>
                  <SettingRow label={t("settings.protected")} hint={t("settings.protectedHint")}>
                    <textarea
                      className="text-input settings-textarea"
                      value={draft.protectedBranches.join("\n")}
                      onChange={(e) =>
                        set(
                          "protectedBranches",
                          e.target.value
                            .split("\n")
                            .map((line) => line.trim())
                            .filter(Boolean),
                        )
                      }
                    />
                  </SettingRow>
                  <SettingRow hint={t("settings.autoUpdate")}>
                    <Checkbox
                      checked={draft.autoUpdateOnReject}
                      onChange={(v) => set("autoUpdateOnReject", v)}
                      label={t("settings.autoUpdate")}
                    />
                  </SettingRow>
                  <SettingRow label={t("settings.template")} hint={t("settings.templateHint")}>
                    <textarea
                      className="text-input settings-textarea"
                      value={draft.commitTemplate}
                      onChange={(e) => set("commitTemplate", e.target.value)}
                    />
                  </SettingRow>
                </>,
              )}

              {panel(
                "danger",
                <>
                  <SettingRow hint={t("settings.confirmRollbackHint")}>
                    <Checkbox
                      checked={draft.confirmRollback}
                      onChange={(v) => set("confirmRollback", v)}
                      label={t("settings.confirmRollback")}
                    />
                  </SettingRow>
                  <SettingRow hint={t("settings.confirmForcePushHint")}>
                    <Checkbox
                      checked={draft.confirmForcePush}
                      onChange={(v) => set("confirmForcePush", v)}
                      label={t("settings.confirmForcePush")}
                    />
                  </SettingRow>
                </>,
              )}
            </>
          )}

          {tab === "keys" && (
            <>
              <p className="settings-keys-note">{t("settings.keysHint")}</p>
              <div className="settings-keys">
                {(
                  [
                    ["settings.keyOpen", ["⌘/Ctrl", "O"]],
                    ["settings.keyQuickOpen", ["⌘/Ctrl", "P"]],
                    ["settings.keyCommit", ["⌘/Ctrl", "K"]],
                    ["settings.keyPush", ["⌘/Ctrl", "Shift", "K"]],
                    ["settings.keyUpdate", ["⌘/Ctrl", "T"]],
                    ["settings.keySettings", ["⌘/Ctrl", ","]],
                  ] as [TKey, string[]][]
                ).map(([label, keys]) => (
                  <div key={label} className="settings-key-row">
                    <span>{t(label)}</span>
                    <span className="settings-key-combo">
                      {keys.map((k) => (
                        <kbd key={k}>{k}</kbd>
                      ))}
                    </span>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
      {pending && (
        <Modal
          title={t("settings.unsavedTitle")}
          icon="warning"
          width={440}
          onClose={() => setPending(null)}
          footer={
            <>
              <Button onClick={() => setPending(null)}>{t("common.cancel")}</Button>
              <Button onClick={() => discardThen(pending)}>{t("settings.discard")}</Button>
              <Button variant="primary" onClick={() => onSave(draft)}>
                {t("settings.saveAndClose")}
              </Button>
            </>
          }
        >
          <div className="confirm-message">{t("settings.unsaved")}</div>
        </Modal>
      )}
    </Modal>
  );
}

export function NewBranchDialog({
  mode,
  initialName = "",
  refs,
  current,
  start,
  onClose,
  onSubmit,
}: {
  mode: "new" | "rename";
  initialName?: string;
  refs: string[];
  current: string;
  start: string;
  onClose: () => void;
  onSubmit: (name: string, start: string, checkout: boolean) => void;
}) {
  const t = useT(T);
  const [name, setName] = useState(initialName);
  const [from, setFrom] = useState(start || current);
  const [checkout, setCheckout] = useState(true);
  const submit = () => {
    if (name.trim() === "") return;
    onSubmit(name.trim(), from, checkout);
  };
  return (
    <Modal
      title={mode === "new" ? t("branch.new") : t("branch.rename")}
      icon="branch"
      width={460}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>{t("common.cancel")}</Button>
          <Button variant="primary" onClick={submit} disabled={!name.trim()}>
            {mode === "new" ? (checkout ? t("branch.createCheckout") : t("common.create")) : t("common.rename")}
          </Button>
        </>
      }
    >
      <div className="dialog-form">
        <Field label={t("branch.name")}>
          <TextInput value={name} onChange={setName} autoFocus placeholder="feature/my-branch" />
        </Field>
        {mode === "new" && (
          <>
            <Field label={t("branch.from")}>
              <Select value={from} onChange={setFrom}>
                {current && <option value={current}>{t("branch.current", { ref: current })}</option>}
                {refs
                  .filter((r) => r !== current)
                  .map((r) => (
                    <option key={r} value={r}>
                      {r}
                    </option>
                  ))}
                {start && !refs.includes(start) && <option value={start}>{start}</option>}
              </Select>
            </Field>
            <Checkbox checked={checkout} onChange={setCheckout} label={t("branch.checkout")} />
          </>
        )}
      </div>
    </Modal>
  );
}

/** One file opened from the push preview: the comparison it belongs to. */
type PushFileTarget = {
  file: CommitFile;
  target: "commit" | "range";
  revision: string;
  from: string;
};

/** git's empty tree, the old side of a range when the branch has no remote. */
const EMPTY_TREE = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";

export function PushDialog({
  remotes,
  current,
  branch: initialBranch,
  trackedUpstream,
  setUpstream,
  root,
  onCopyPath,
  diffMode,
  setDiffMode,
  diffWrap,
  onToggleWrap,
  whitespace,
  onWhitespace,
  onClose,
  onSubmit,
}: {
  remotes: Remote[];
  current: string;
  branch?: string;
  /** The configured upstream of the branch being pushed, as remote/branch. */
  trackedUpstream?: string;
  setUpstream: boolean;
  /** Repository root, for copy-path and absolute paths in the diff. */
  root: string;
  onCopyPath: (text: string) => void;
  diffMode: "split" | "unified";
  setDiffMode: (mode: "split" | "unified") => void;
  diffWrap: boolean;
  onToggleWrap: () => void;
  whitespace: WhitespaceMode;
  onWhitespace: (mode: WhitespaceMode) => void;
  onClose: () => void;
  onSubmit: (opts: PushOptions) => void;
}) {
  const t = useT(T);
  // The tracked branch is the default destination: pushing a branch whose
  // upstream is origin/topic onto origin/<local-name> would create a new
  // branch and, with -u, silently move the upstream.
  const upstreamRef = useMemo(() => {
    const value = (trackedUpstream ?? "").trim();
    const match = remotes.find((r) => value.startsWith(r.name + "/"));
    if (!match) return { remote: "", branch: "", known: false };
    return { remote: match.name, branch: value.slice(match.name.length + 1), known: true };
  }, [remotes, trackedUpstream]);
  const startBranch = initialBranch || current;
  const [branch, setBranch] = useState(startBranch);
  // The branch on the other side. It starts at the tracked branch, or the
  // local name when there is nothing tracked, and stays editable: pushing
  // local `main` onto `release` is a refspec, not a rename.
  const [target, setTarget] = useState(upstreamRef.branch || startBranch);
  const [targetEdited, setTargetEdited] = useState(false);
  const [recent, setRecent] = useState<string[]>([]);
  const [forceIfIncludes, setForceIfIncludes] = useState(false);
  const fallbackRemote = remotes.find((r) => r.name === "origin")?.name ?? remotes[0]?.name ?? "origin";
  const [remote, setRemote] = useState(upstreamRef.remote || fallbackRemote);
  const [preview, setPreview] = useState<PushPreview | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<string | null>(null);
  const [detail, setDetail] = useState<CommitDetail | null>(null);
  const [force, setForce] = useState(false);
  const [tags, setTags] = useState(false);
  const [dryRun, setDryRun] = useState(false);
  const [upstream, setUpstreamState] = useState(setUpstream);
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const [menu, setMenu] = useState<{ x: number; y: number; items: ContextItem[] } | null>(null);
  const [previewFile, setPreviewFile] = useState<PushFileTarget | null>(null);
  // Capped below the modal's 900px so the file pane cannot be squeezed out.
  const [splitWidth, setSplitWidth] = useStoredState<number>("gitjet.pushSplit", 320);
  const split = Math.min(560, Math.max(220, splitWidth));

  // Typing a target branch re-reads the preview; the pause keeps git from
  // being spawned once per keystroke.
  useEffect(() => {
    let alive = true;
    const timer = setTimeout(
      () => {
        const wanted = target.trim();
        if (wanted === "" || wanted.startsWith("-") || /[\s~^:?*[\\]/.test(wanted)) {
          setLoading(false);
          setPreview(null);
          setError(t("push.badBranch"));
          return;
        }
        setLoading(true);
        setError("");
        setSelected(null);
        setDetail(null);
        Git.pushPreview(remote, branch, wanted)
          .then((p) => {
            if (!alive) return;
            setPreview(p);
            // Only a branch with no upstream gets -u proposed; a push to a
            // differently named remote branch must not steal the tracking.
            if (p.creates && !upstreamRef.known) setUpstreamState(true);
          })
          .catch((err) => {
            if (!alive) return;
            setPreview(null);
            setError(err instanceof Error ? err.message : String(err));
          })
          .finally(() => {
            if (alive) setLoading(false);
          });
      },
      targetEdited ? 220 : 0,
    );
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [remote, branch, target, targetEdited, t, upstreamRef.known]);

  // Picking a different local branch renames the target with it, unless the
  // name was typed on purpose.
  useEffect(() => {
    if (!targetEdited) setTarget(upstreamRef.branch || branch);
  }, [branch, targetEdited, upstreamRef.branch]);

  useEffect(() => {
    Git.pushTargets()
      .then((targets) => setRecent(targets))
      .catch(() => setRecent([]));
  }, []);

  // One commit's files are read on demand; the whole range comes with the
  // preview, so nothing is fetched twice.
  useEffect(() => {
    if (!selected) {
      setDetail(null);
      return;
    }
    let alive = true;
    Git.showCommit(selected)
      .then((d) => {
        if (alive) setDetail(d);
      })
      .catch(() => {
        if (alive) setDetail(null);
      });
    return () => {
      alive = false;
    };
  }, [selected]);

  const commits = preview?.commits ?? [];
  const files = useMemo<CommitFile[]>(
    () => (selected ? (detail?.files ?? []) : (preview?.files ?? [])),
    [selected, detail, preview],
  );
  const chosen = selected ? (commits.find((c) => c.hash === selected) ?? null) : null;
  const ahead = preview?.ahead ?? 0;

  // A fresh range opens with every folder unfolded, like the IDE's detail
  // pane: the shape of the change first, then the names.
  useEffect(() => {
    setExpanded(new Set(directoryKeys(buildChangeTree(files))));
  }, [files]);

  // A branch with no new commits can still be worth pushing: creating it
  // on the remote is the point.
  const createsOnly = !loading && !error && ahead === 0 && !!preview?.creates;
  const nothing = !loading && !error && ahead === 0 && !preview?.creates;

  const openRemoteMenu = (e: ReactMouseEvent<HTMLButtonElement>) => {
    e.stopPropagation();
    const rect = e.currentTarget.getBoundingClientRect();
    setMenu({
      x: rect.left,
      y: rect.bottom + 4,
      items: [
        ...remotes.map((r) => ({
          label: r.name,
          checked: r.name === remote,
          onClick: () => setRemote(r.name),
        })),
        ...(recent.length > 0
          ? [
              { separator: true } as ContextItem,
              ...recent.map((target) => {
                const cut = target.indexOf("/");
                const targetRemote = cut > 0 ? target.slice(0, cut) : target;
                const targetBranch = cut > 0 ? target.slice(cut + 1) : "";
                return {
                  label: target,
                  icon: "clock" as const,
                  onClick: () => {
                    setRemote(targetRemote);
                    setTargetEdited(false);
                    if (targetBranch) {
                      setBranch(targetBranch);
                      setTarget(targetBranch);
                    }
                  },
                };
              }),
            ]
          : []),
      ],
    });
  };

  // The split button's menu is where the options that change what git is
  // asked to do live; the push itself stays the one obvious action.
  const openOptionsMenu = (e: ReactMouseEvent<HTMLButtonElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    setMenu({
      x: Math.max(8, rect.right - 236),
      y: rect.bottom + 4,
      items: [
        { label: t("push.force"), checked: force, onClick: () => setForce(!force) },
        {
          label: t("push.forceIfIncludes"),
          checked: forceIfIncludes,
          disabled: !force,
          onClick: () => setForceIfIncludes(!forceIfIncludes),
        },
        { label: t("push.dryRun"), checked: dryRun, onClick: () => setDryRun(!dryRun) },
        { separator: true },
        { label: t("push.setUpstream"), checked: upstream, onClick: () => setUpstreamState(!upstream) },
      ],
    });
  };

  return (
    <Modal
      title={t("push.title")}
      icon="push"
      width={900}
      className="push-modal"
      onClose={onClose}
      footer={
        <>
          <Checkbox checked={tags} onChange={setTags} label={t("push.allTags")} />
          <span className="pushd-gap" />
          <Button onClick={onClose}>{t("common.cancel")}</Button>
          <span className="pushd-split">
            <Button
              variant="primary"
              disabled={loading || !!error || (nothing && !tags)}
              onClick={() =>
                onSubmit({
                  remote,
                  branch,
                  remoteBranch: target.trim(),
                  setUpstream: upstream,
                  forceWithLease: force,
                  forceIfIncludes,
                  tags,
                  dryRun,
                })
              }
            >
              {dryRun ? t("push.dryRunAction") : t("common.push")}
            </Button>
            <button
              type="button"
              className="pushd-split-arrow"
              title={t("push.moreOptions")}
              aria-label={t("push.moreOptions")}
              onClick={openOptionsMenu}
            >
              <Icon name="chevronDown" size={12} />
            </button>
          </span>
        </>
      }
    >
      {remotes.length === 0 ? (
        <div className="dialog-note pushd-noremotes">
          {t("push.noRemotes")}
          <code>git remote add origin &lt;url&gt;</code>
        </div>
      ) : (
        <div className="pushd" style={{ gridTemplateColumns: `${split}px 5px minmax(0, 1fr)` }}>
          <div className="pushd-left">
            <div
              className={cx("pushd-repo", !selected && "active")}
              onClick={() => setSelected(null)}
              title={t("push.everything")}
            >
              <Icon name="chevronDown" size={12} className="pushd-caret" />
              <span className="pushd-local" title={t("push.branch")}>
                {branch || t("push.detached")}
              </span>
              <Icon name="chevronRight" size={11} className="pushd-arrow" />
              <button
                type="button"
                className="pushd-remote"
                title={t("push.chooseRemote")}
                onClick={openRemoteMenu}
              >
                {remote}
              </button>
              <span className="pushd-colon">:</span>
              <input
                className="pushd-target-input"
                value={target}
                spellCheck={false}
                autoComplete="off"
                aria-label={t("push.targetBranch")}
                title={t("push.targetHint")}
                size={Math.max(6, Math.min(40, target.length + 1))}
                onChange={(e) => {
                  setTargetEdited(true);
                  setTarget(e.target.value);
                }}
              />
              {preview?.creates && <span className="pushd-badge">{t("push.newBranch")}</span>}
            </div>
            <div className="pushd-commits">
              {commits.map((c) => (
                <button
                  key={c.hash}
                  type="button"
                  className={cx("pushd-commit", selected === c.hash && "active")}
                  onClick={() => setSelected(c.hash)}
                  title={c.message}
                >
                  <span className="pushd-commit-subject">{c.subject || c.short}</span>
                  <span className="pushd-commit-meta">
                    {c.short} · {c.author} · {formatWhen(c.commitTime)}
                  </span>
                </button>
              ))}
            </div>
          </div>

          <Splitter width={split} setWidth={setSplitWidth} min={220} max={560} reset={320} />

          <div className="pushd-right">
            <div className="pushd-toolbar">
              <IconButton
                icon="expand"
                title={t("push.expandAll")}
                small
                onClick={() => setExpanded(new Set(directoryKeys(buildChangeTree(files))))}
              />
              <IconButton
                icon="collapse"
                title={t("push.collapseAll")}
                small
                onClick={() => setExpanded(new Set())}
              />
              <span className="pushd-count">
                {selected
                  ? t("push.filesHead", { n: files.length })
                  : t("push.allFilesHead", { n: files.length })}
              </span>
            </div>
            <div className="pushd-files">
              {files.length > 0 && (
                <FileTree
                  files={files}
                  expanded={expanded}
                  onToggleDir={(key) => {
                    const next = new Set(expanded);
                    if (next.has(key)) next.delete(key);
                    else next.add(key);
                    setExpanded(next);
                  }}
                  renderFile={(file, depth, flat) => {
                    const slash = file.path.lastIndexOf("/");
                    const name = slash < 0 ? file.path : file.path.slice(slash + 1);
                    const dir = slash < 0 ? "" : file.path.slice(0, slash + 1);
                    return (
                      <div
                        className="tree-row file"
                        style={{ paddingLeft: 8 + depth * 12 }}
                        title={file.oldPath ? `${file.oldPath} → ${file.path}` : file.path}
                        onClick={() => {
                          // The newest commit carries the full hash; the
                          // preview's own head is only the short display form.
                          const revision = selected ?? preview?.commits[0]?.hash ?? preview?.head ?? "";
                          if (revision === "") return;
                          setPreviewFile({
                            file,
                            target: selected ? "commit" : "range",
                            revision,
                            from: selected ? "" : preview?.base || EMPTY_TREE,
                          });
                        }}
                      >
                        <span className="tree-chevron-spacer" />
                        <StatusMark kind={file.status} />
                        <FileIcon path={file.path} size={14} />
                        <span className="tree-name">
                          <span className="file-base">{file.oldPath ? `${file.oldPath} → ${name}` : name}</span>
                          {flat && dir !== "" && <span className="file-dir">{dir}</span>}
                        </span>
                        <span className="tree-stats">
                          {file.binary ? (
                            <span className="pushd-binary">{t("push.binary")}</span>
                          ) : (
                            <>
                              {file.additions > 0 && <span className="add-count">+{file.additions}</span>}
                              {file.deletions > 0 && <span className="del-count">−{file.deletions}</span>}
                            </>
                          )}
                        </span>
                      </div>
                    );
                  }}
                />
              )}
              {files.length === 0 && !loading && !error && (
                <div className="pushd-empty">{t("push.noFiles")}</div>
              )}
            </div>
            <div className="pushd-detail">
              {loading ? (
                <Spinner label={t("push.checking")} />
              ) : error ? (
                <span className="push-error">{error}</span>
              ) : nothing ? (
                <span className="pushd-note">{t("push.nothingToPush")}</span>
              ) : chosen ? (
                <>
                  <div className="pushd-message">{chosen.message.trim() || chosen.subject}</div>
                  <div className="pushd-meta">
                    <code>{chosen.short}</code>
                    <span>
                      {chosen.author} &lt;{chosen.authorEmail}&gt;
                    </span>
                    <span>{t("push.on", { when: formatWhen(chosen.commitTime) })}</span>
                  </div>
                </>
              ) : (
                <div className="pushd-summary">
                  {createsOnly ? (
                    <span>{t("push.createsOnly", { hash: preview?.head ?? "" })}</span>
                  ) : (
                    <>
                      <span>
                        {t("push.summary", {
                          commits: count(ahead, t("push.commitOne"), t("push.commitOther", { n: ahead })),
                          files: files.length,
                        })}
                      </span>
                      {preview?.behind ? (
                        <span className="pushd-behind">{t("push.behind", { n: preview.behind })}</span>
                      ) : null}
                      {preview?.truncated ? (
                        <span className="pushd-behind">{t("push.truncated", { n: 200 })}</span>
                      ) : null}
                    </>
                  )}
                </div>
              )}
            </div>
          </div>

          {force && (
            <div className="pushd-warning">
              <Icon name="warning" size={13} /> {t("push.warning")}
            </div>
          )}
          {preview?.diverged && !force && (
            <div className="pushd-warning">
              <Icon name="warning" size={13} /> {t("push.diverged", { tip: preview.remoteTip })}
            </div>
          )}
        </div>
      )}
      {menu && <ContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={() => setMenu(null)} />}
      {/* The portal puts the preview above this dialog; Escape closes the
          preview first, then this one. */}
      {previewFile && (
        <PushFilePreviewDialog
          {...previewFile}
          root={root}
          diffMode={diffMode}
          setDiffMode={setDiffMode}
          diffWrap={diffWrap}
          onToggleWrap={onToggleWrap}
          whitespace={whitespace}
          onWhitespace={onWhitespace}
          onCopyPath={onCopyPath}
          onClose={() => setPreviewFile(null)}
        />
      )}
    </Modal>
  );
}


/** One changed file of a push, with the same diff surface as a log commit:
 *  side-by-side or unified, wrapping, whitespace, and the file itself. */
function PushFilePreviewDialog({
  file,
  target,
  revision,
  from,
  root,
  diffMode,
  setDiffMode,
  diffWrap,
  onToggleWrap,
  whitespace,
  onWhitespace,
  onCopyPath,
  onClose,
}: PushFileTarget & {
  root: string;
  diffMode: "split" | "unified";
  setDiffMode: (mode: "split" | "unified") => void;
  diffWrap: boolean;
  onToggleWrap: () => void;
  whitespace: WhitespaceMode;
  onWhitespace: (mode: WhitespaceMode) => void;
  onCopyPath: (text: string) => void;
  onClose: () => void;
}) {
  const t = useT(T);
  const [mode, setMode] = useState<"diff" | "file">("diff");
  const [diff, setDiff] = useState<FileDiff | null>(null);
  const [diffLoading, setDiffLoading] = useState(true);
  const [diffError, setDiffError] = useState("");
  const [source, setSource] = useState<SourceFile | null>(null);
  const [sourceLoading, setSourceLoading] = useState(false);
  const [sourceError, setSourceError] = useState("");

  // A zero context asks the service for the user's configured window, so the
  // preview follows the same setting as every other diff in the app.
  const opts = useMemo<DiffOptions>(
    () => ({
      path: file.path,
      oldPath: file.oldPath ?? "",
      target,
      revision,
      from,
      context: 0,
      whitespace,
      noText: false,
    }),
    [file.path, file.oldPath, target, revision, from, whitespace],
  );

  useEffect(() => {
    let alive = true;
    setDiffLoading(true);
    setDiffError("");
    Git.diff(opts)
      .then((d) => {
        if (alive) setDiff(d);
      })
      .catch((err) => {
        if (!alive) return;
        setDiff(null);
        setDiffError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (alive) setDiffLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [opts]);

  // The file itself is read only when its tab is opened; the new side of the
  // comparison is the revision the diff shows on the right.
  useEffect(() => {
    if (mode !== "file") return;
    let alive = true;
    setSourceLoading(true);
    setSourceError("");
    Git.file(file.path, revision)
      .then((f) => {
        if (alive) setSource(f);
      })
      .catch((err) => {
        if (!alive) return;
        setSource(null);
        setSourceError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (alive) setSourceLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [mode, file.path, revision]);

  return (
    <Modal title={file.path} icon="file" width={1080} className="pushd-preview-modal" onClose={onClose}>
      <div className="pushd-preview">
        <div className="pushd-preview-bar">
          <div className="segmented" role="tablist" aria-label={t("push.fileView")}>
            <button
              type="button"
              role="tab"
              aria-selected={mode === "diff"}
              className={cx("segmented-btn", "text", mode === "diff" && "active")}
              onClick={() => setMode("diff")}
            >
              {t("push.diffTab")}
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={mode === "file"}
              className={cx("segmented-btn", "text", mode === "file" && "active")}
              onClick={() => setMode("file")}
            >
              {t("push.fileTab")}
            </button>
          </div>
          <span className="spacer" />
          <span className="pushd-count">
            {file.binary
              ? t("push.binary")
              : [file.additions > 0 ? `+${file.additions}` : "", file.deletions > 0 ? `−${file.deletions}` : ""]
                  .filter(Boolean)
                  .join(" ")}
          </span>
        </div>
        <div className="pushd-preview-body">
          {mode === "diff" ? (
            diffLoading ? (
              <div className="pushd-preview-state">
                <Spinner label={t("push.checking")} />
              </div>
            ) : diffError ? (
              <div className="pushd-preview-state">
                <span className="push-error">{diffError}</span>
              </div>
            ) : diff ? (
              <DiffView
                diff={diff}
                opts={opts}
                mode={diffMode}
                setMode={setDiffMode}
                whitespace={whitespace}
                onWhitespace={onWhitespace}
                onApply={() => {}}
                onApplyFile={() => {}}
                onApplyLines={() => {}}
                onExternalDiff={() => {}}
                onOpenFile={() => setMode("file")}
                root={root}
                onCopyPath={onCopyPath}
                reloadKey={0}
                wrap={diffWrap}
                onToggleWrap={onToggleWrap}
              />
            ) : null
          ) : sourceLoading ? (
            <div className="pushd-preview-state">
              <Spinner label={t("push.checking")} />
            </div>
          ) : sourceError ? (
            <div className="pushd-preview-state">
              <span className="push-error">{sourceError}</span>
            </div>
          ) : source && !source.exists ? (
            <div className="pushd-preview-state">
              <span className="pushd-note">{t("push.fileMissing")}</span>
            </div>
          ) : source && source.binary ? (
            <div className="pushd-preview-state">
              <span className="pushd-note">{t("push.binaryFile")}</span>
            </div>
          ) : source ? (
            <div className="pushd-preview-file">
              {source.truncated && <div className="diff-truncated">{t("push.fileTruncated")}</div>}
              <SourceEditor file={source} root={root} wrap={diffWrap} />
            </div>
          ) : null}
        </div>
      </div>
    </Modal>
  );
}

/** PushCommitsDialog publishes history up to one commit into a remote
 *  branch, without checking anything out. */
export function PushCommitsDialog({
  hash,
  remotes,
  current,
  onClose,
  onSubmit,
}: {
  hash: string;
  remotes: Remote[];
  current: string;
  onClose: () => void;
  onSubmit: (remote: string, branch: string) => void;
}) {
  const t = useT(T);
  const [remote, setRemote] = useState(remotes.find((r) => r.name === "origin")?.name ?? remotes[0]?.name ?? "origin");
  const [branch, setBranch] = useState(current);
  return (
    <Modal
      title={t("pushCommits.title", { hash: shortHash(hash) })}
      icon="push"
      width={460}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>{t("common.cancel")}</Button>
          <Button variant="primary" disabled={!remote || !branch.trim()} onClick={() => onSubmit(remote, branch.trim())}>
            {t("common.push")}
          </Button>
        </>
      }
    >
      <div className="dialog-form">
        <div className="dialog-note">{t("pushCommits.note")}</div>
        <Field label={t("push.remote")}>
          <Select value={remote} onChange={setRemote}>
            {remotes.map((r) => (
              <option key={r.name} value={r.name}>
                {r.name} — {r.url}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t("pushCommits.branch")}>
          <TextInput value={branch} onChange={setBranch} placeholder="release" />
        </Field>
      </div>
    </Modal>
  );
}

export function PullDialog({
  remotes,
  updateMethod,
  onClose,
  onSubmit,
}: {
  remotes: Remote[];
  updateMethod: string;
  onClose: () => void;
  onSubmit: (opts: PullOptions) => void;
}) {
  const t = useT(T);
  const [remote, setRemote] = useState(remotes.find((r) => r.name === "origin")?.name ?? remotes[0]?.name ?? "");
  const [rebase, setRebase] = useState(updateMethod === "rebase");
  const [autostash, setAutostash] = useState(true);
  const [prune, setPrune] = useState(false);
  const [tags, setTags] = useState(false);
  const [ffOnly, setFFOnly] = useState(false);
  const [noFF, setNoFF] = useState(false);
  const [squash, setSquash] = useState(false);
  const [noCommit, setNoCommit] = useState(false);
  return (
    <Modal
      title={t("pull.title")}
      icon="pull"
      width={480}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>{t("common.cancel")}</Button>
          <Button variant="primary" onClick={() =>
            onSubmit({ remote, branch: "", rebase, autostash, prune, tags, ffOnly, noFF, squash, noCommit, tagsMode: "" })
          }>
            {t("common.pull")}
          </Button>
        </>
      }
    >
      <div className="dialog-form">
        <div className="dialog-note">{t("pull.note")}</div>
        {remotes.length > 1 && (
          <Field label={t("push.remote")}>
            <Select value={remote} onChange={setRemote}>
              {remotes.map((r) => (
                <option key={r.name} value={r.name}>
                  {r.name} — {r.url}
                </option>
              ))}
            </Select>
          </Field>
        )}
        <Field label={t("pull.integrate")}>
          <div className="radio-row">
            <label className="radio">
              <input type="radio" checked={!rebase} onChange={() => setRebase(false)} /> {t("settings.merge")}
            </label>
            <label className="radio">
              <input type="radio" checked={rebase} onChange={() => setRebase(true)} /> {t("settings.rebase")}
            </label>
          </div>
        </Field>
        <div className="dialog-checks">
          <Checkbox
            checked={ffOnly}
            onChange={(v) => {
              setFFOnly(v);
              if (v) setNoFF(false);
            }}
            label={t("pull.ffOnly")}
          />
          <Checkbox
            checked={noFF}
            onChange={(v) => {
              setNoFF(v);
              if (v) setFFOnly(false);
            }}
            label={t("pull.noFF")}
          />
          <Checkbox checked={squash} onChange={setSquash} label={t("pull.squash")} />
          <Checkbox checked={noCommit} onChange={setNoCommit} label={t("pull.noCommit")} />
          <Checkbox checked={autostash} onChange={setAutostash} label={t("pull.autostash")} />
          <Checkbox checked={prune} onChange={setPrune} label={t("pull.prune")} />
          <Checkbox checked={tags} onChange={setTags} label={t("pull.tags")} />
        </div>
      </div>
    </Modal>
  );
}

export function RebaseDialog({
  onto,
  current,
  refs,
  onClose,
  onSubmit,
}: {
  onto: string;
  current: string;
  refs: string[];
  onClose: () => void;
  onSubmit: (opts: RebaseOptions) => void;
}) {
  const t = useT(T);
  const [base, setBase] = useState(onto);
  const [branch, setBranch] = useState("");
  const [autostash, setAutostash] = useState(true);
  const [updateRefs, setUpdateRefs] = useState(false);
  const [rebaseMerges, setRebaseMerges] = useState(false);
  const [empty, setEmpty] = useState("");
  const [root, setRoot] = useState(false);
  const [autoSquash, setAutoSquash] = useState("");
  const ready = root || base.trim() !== "";
  return (
    <Modal
      title={t("rebase.title")}
      icon="rebase"
      width={520}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>{t("common.cancel")}</Button>
          <Button
            variant="primary"
            disabled={!ready}
            onClick={() =>
              onSubmit({
                onto: base.trim(),
                branch,
                autostash,
                updateRefs,
                rebaseMerges,
                empty,
                root,
                autoSquash,
              })
            }
          >
            {t("common.rebase")}
          </Button>
        </>
      }
    >
      <div className="dialog-form">
        <div className="dialog-note">{t("rebase.current", { branch: current })}</div>
        <Field label={t("rebase.onto")}>
          <TextInput value={base} onChange={setBase} disabled={root} placeholder="origin/main" />
        </Field>
        <Field label={t("rebase.branch")}>
          <Select value={branch} onChange={setBranch}>
            <option value="">{current}</option>
            {refs.filter((r) => r !== current).map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t("rebase.autosquash")}>
          <Select value={autoSquash} onChange={setAutoSquash}>
            <option value="">{t("rebase.autosquashConfig")}</option>
            <option value="true">{t("rebase.autosquashOn")}</option>
            <option value="false">{t("rebase.autosquashOff")}</option>
          </Select>
        </Field>
        <Field label={t("rebase.empty")}>
          <Select value={empty} onChange={setEmpty}>
            <option value="">{t("rebase.emptyDefault")}</option>
            <option value="keep">{t("rebase.emptyKeep")}</option>
            <option value="drop">{t("rebase.emptyDrop")}</option>
            <option value="stop">{t("rebase.emptyStop")}</option>
          </Select>
        </Field>
        <div className="dialog-checks">
          <Checkbox checked={autostash} onChange={setAutostash} label={t("rebase.autostash")} />
          <Checkbox checked={updateRefs} onChange={setUpdateRefs} label={t("rebase.updateRefs")} />
          <Checkbox checked={rebaseMerges} onChange={setRebaseMerges} label={t("rebase.merges")} />
          <Checkbox
            checked={root}
            onChange={(v) => {
              setRoot(v);
              if (v) setBase("");
            }}
            label={t("rebase.root")}
          />
        </div>
      </div>
    </Modal>
  );
}

export function ResetDialog({
  hash,
  subject,
  onClose,
  onSubmit,
}: {
  hash: string;
  subject: string;
  onClose: () => void;
  onSubmit: (mode: "soft" | "mixed" | "hard" | "keep") => void;
}) {
  const t = useT(T);
  const [mode, setMode] = useState<"soft" | "mixed" | "hard" | "keep">("mixed");
  return (
    <Modal
      title={t("reset.title")}
      icon="reset"
      width={520}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>{t("common.cancel")}</Button>
          <Button variant={mode === "hard" ? "danger" : "primary"} onClick={() => onSubmit(mode)}>
            {t("common.reset")}
          </Button>
        </>
      }
    >
      <div className="dialog-form">
        <div className="dialog-note">
          {subject
            ? t("reset.noteSubject", { hash: shortHash(hash), subject })
            : t("reset.note", { hash: shortHash(hash) })}
        </div>
        <label className="radio-card">
          <input type="radio" checked={mode === "soft"} onChange={() => setMode("soft")} />
          <span>
            <b>{t("reset.soft")}</b>
            <small>{t("reset.softHint")}</small>
          </span>
        </label>
        <label className="radio-card">
          <input type="radio" checked={mode === "mixed"} onChange={() => setMode("mixed")} />
          <span>
            <b>{t("reset.mixed")}</b>
            <small>{t("reset.mixedHint")}</small>
          </span>
        </label>
        <label className="radio-card">
          <input type="radio" checked={mode === "keep"} onChange={() => setMode("keep")} />
          <span>
            <b>{t("reset.keep")}</b>
            <small>{t("reset.keepHint")}</small>
          </span>
        </label>
        <label className="radio-card">
          <input type="radio" checked={mode === "hard"} onChange={() => setMode("hard")} />
          <span>
            <b>{t("reset.hard")}</b>
            <small>{t("reset.hardHint")}</small>
          </span>
        </label>
      </div>
    </Modal>
  );
}

function shortHash(hash: string): string {
  return hash.length > 8 ? hash.slice(0, 8) : hash;
}

/** IDEA's rollback dialog: the changes to discard, one checkbox each, and
 *  the option that decides whether added files keep their local copy. */
export function RollbackDialog({
  entries,
  selected,
  deleteAdded,
  onDeleteAdded,
  onClose,
  onConfirm,
}: {
  entries: FileEntry[];
  /** Paths checked when the dialog opens. */
  selected: string[];
  deleteAdded: boolean;
  onDeleteAdded: (value: boolean) => void;
  onClose: () => void;
  onConfirm: (paths: string[], deleteAdded: boolean) => void;
}) {
  const t = useT(T);
  // A path can be listed twice (staged and working-tree sides); rollback
  // speaks paths, so the dialog shows it once and prefers the worktree row.
  const files = useMemo(() => {
    const seen = new Map<string, FileEntry>();
    for (const entry of entries) {
      if (entry.ignored || entry.unmerged) continue;
      const previous = seen.get(entry.path);
      if (!previous || (previous.staged && !entry.staged)) seen.set(entry.path, entry);
    }
    return [...seen.values()];
  }, [entries]);
  const [checked, setChecked] = useState<Set<string>>(
    () => new Set(selected.filter((path) => files.some((f) => f.path === path))),
  );
  // An untracked file has no index entry to give up, so keeping its local
  // copy would be a no-op; when that is all the dialog started with, the
  // option starts checked. Mixed selections follow the remembered choice.
  const [deleteLocal, setDeleteLocal] = useState(() => {
    const picked = files.filter((f) => checked.has(f.path));
    return deleteAdded || (picked.length > 0 && picked.every((f) => f.kind === "untracked"));
  });
  const included = files.filter((f) => checked.has(f.path));
  const hasAdded = included.some((f) => f.kind === "untracked" || f.kind === "added");

  const toggle = (path: string, value: boolean) => {
    const next = new Set(checked);
    if (value) next.add(path);
    else next.delete(path);
    setChecked(next);
  };

  return (
    <Modal
      title={t("rollback.title")}
      icon="undo"
      width={600}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>{t("common.close")}</Button>
          <Button
            variant="danger"
            disabled={included.length === 0}
            onClick={() => onConfirm(included.map((f) => f.path), deleteLocal)}
          >
            {t("rollback.action")}
          </Button>
        </>
      }
    >
      {files.length === 0 ? (
        <p className="setting-hint">{t("rollback.empty")}</p>
      ) : (
        <div className="rollback-list">
          <div className="rollback-list-title">{t("rollback.files")}</div>
          {files.map((entry) => (
            <label key={entry.path} className={cx("rollback-row", checked.has(entry.path) && "checked")} title={entry.path}>
              <input
                type="checkbox"
                checked={checked.has(entry.path)}
                onChange={(e) => toggle(entry.path, e.target.checked)}
              />
              <StatusMark kind={entry.kind} staged={entry.staged} />
              <span className="rollback-path">{entry.path}</span>
            </label>
          ))}
        </div>
      )}
      <p className="setting-hint rollback-hint">{t("rollback.hint")}</p>
      <div className="rollback-delete">
        <Checkbox
          checked={deleteLocal}
          disabled={!hasAdded}
          onChange={(value) => {
            setDeleteLocal(value);
            onDeleteAdded(value);
          }}
          label={t("rollback.deleteAdded")}
        />
      </div>
    </Modal>
  );
}

export function TagDialog({
  start,
  onClose,
  onSubmit,
}: {
  start: string;
  onClose: () => void;
  onSubmit: (opts: TagOptions) => void;
}) {
  const t = useT(T);
  const [name, setName] = useState("");
  const [message, setMessage] = useState("");
  const [force, setForce] = useState(false);
  return (
    <Modal
      title={t("tag.title")}
      icon="tag"
      width={460}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>{t("common.cancel")}</Button>
          <Button variant="primary" onClick={() => onSubmit({ name, message, revision: start, force })} disabled={!name.trim()}>
            {t("tag.create")}
          </Button>
        </>
      }
    >
      <div className="dialog-form">
        <div className="dialog-note">{t("tag.tagging", { hash: shortHash(start) })}</div>
        <Field label={t("tag.name")}>
          <TextInput value={name} onChange={setName} autoFocus placeholder="v1.0.0" />
        </Field>
        <Field label={t("tag.message")} hint={t("tag.messageHint")}>
          <TextInput value={message} onChange={setMessage} placeholder={t("tag.messagePlaceholder")} />
        </Field>
        <Checkbox checked={force} onChange={setForce} label={t("tag.force")} />
      </div>
    </Modal>
  );
}

export function StashDialog({
  onClose,
  onSubmit,
}: {
  onClose: () => void;
  onSubmit: (opts: StashOptions) => void;
}) {
  const t = useT(T);
  const [message, setMessage] = useState("");
  const [untracked, setUntracked] = useState(true);
  const [keepIndex, setKeepIndex] = useState(false);
  return (
    <Modal
      title={t("stash.title")}
      icon="stash"
      width={460}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>{t("common.cancel")}</Button>
          <Button variant="primary" onClick={() => onSubmit({ message, includeUntracked: untracked, keepIndex, paths: [] })}>
            {t("common.stash")}
          </Button>
        </>
      }
    >
      <div className="dialog-form">
        <Field label={t("stash.message")}>
          <TextInput value={message} onChange={setMessage} autoFocus placeholder={t("stash.messagePlaceholder")} />
        </Field>
        <Checkbox checked={untracked} onChange={setUntracked} label={t("stash.untracked")} />
        <Checkbox checked={keepIndex} onChange={setKeepIndex} label={t("stash.keepIndex")} />
      </div>
    </Modal>
  );
}

export function ChangelistDialog({
  mode,
  initialName = "",
  initialComment = "",
  onClose,
  onSubmit,
}: {
  mode: "new" | "rename";
  initialName?: string;
  initialComment?: string;
  onClose: () => void;
  onSubmit: (name: string, comment: string) => void;
}) {
  const [name, setName] = useState(initialName);
  const t = useT(T);
  const [comment, setComment] = useState(initialComment);
  return (
    <Modal
      title={mode === "new" ? t("changelist.new") : t("changelist.rename")}
      icon="list"
      width={440}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>{t("common.cancel")}</Button>
          <Button variant="primary" onClick={() => onSubmit(name.trim(), comment)} disabled={!name.trim()}>
            {mode === "new" ? t("common.create") : t("common.rename")}
          </Button>
        </>
      }
    >
      <div className="dialog-form">
        <Field label={t("changelist.name")}>
          <TextInput value={name} onChange={setName} autoFocus placeholder={t("changelist.namePlaceholder")} />
        </Field>
        <Field label={t("changelist.comment")}>
          <TextInput value={comment} onChange={setComment} placeholder={t("changelist.commentPlaceholder")} />
        </Field>
      </div>
    </Modal>
  );
}

export function MergeDialog({
  branches,
  current,
  onClose,
  onSubmit,
}: {
  branches: string[];
  current: string;
  onClose: () => void;
  onSubmit: (ref: string, opts: MergeOptions) => void;
}) {
  const t = useT(T);
  // The branch popup merges directly, as the IDE's does; this dialog is the
  // Git menu's "Merge…", so nothing is preselected — the reader names the
  // branch, and the title says where it will land.
  const [ref, setRef] = useState("");
  const [noFF, setNoFF] = useState(false);
  const [ffOnly, setFFOnly] = useState(false);
  const [squash, setSquash] = useState(false);
  const [noCommit, setNoCommit] = useState(false);
  const [noVerify, setNoVerify] = useState(false);
  const [unrelated, setUnrelated] = useState(false);
  const [message, setMessage] = useState("");
  return (
    <Modal
      title={ref ? t("merge.titleNamed", { branch: ref, into: current }) : t("merge.title")}
      icon="merge"
      width={460}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>{t("common.cancel")}</Button>
          <Button
            variant="primary"
            onClick={() => onSubmit(ref, { noFF, ffOnly, squash, message, noCommit, noVerify, allowUnrelatedHistories: unrelated })}
            disabled={!ref}
          >
            {t("common.merge")}
          </Button>
        </>
      }
    >
      <div className="dialog-form">
        <Field label={t("merge.into")}>
          <span className="dialog-value">{current}</span>
        </Field>
        <Field label={t("merge.branch")}>
          <Select value={ref} onChange={setRef}>
            <option value="">{t("merge.select")}</option>
            {branches.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </Select>
        </Field>
        <div className="dialog-checks">
          <Checkbox
            checked={noFF}
            onChange={(v) => {
              setNoFF(v);
              if (v) setFFOnly(false);
            }}
            label={t("merge.noFF")}
          />
          <Checkbox
            checked={ffOnly}
            onChange={(v) => {
              setFFOnly(v);
              if (v) setNoFF(false);
            }}
            label={t("merge.ffOnly")}
          />
          <Checkbox checked={squash} onChange={setSquash} label={t("merge.squash")} />
          <Checkbox checked={noCommit} onChange={setNoCommit} label={t("merge.noCommit")} />
          <Checkbox checked={noVerify} onChange={setNoVerify} label={t("merge.noVerify")} />
          <Checkbox checked={unrelated} onChange={setUnrelated} label={t("merge.unrelated")} />
        </div>
        <Field label={t("merge.message")}>
          <TextInput value={message} onChange={setMessage} placeholder="" />
        </Field>
      </div>
    </Modal>
  );
}

export function IconHeader({ icon, children }: { icon: "warning" | "info"; children: React.ReactNode }) {
  return (
    <div className={`icon-header icon-${icon}`}>
      <Icon name={icon} />
      <span>{children}</span>
    </div>
  );
}

export function SmallIconButton({ icon, onClick, title }: { icon: "plus" | "minus"; onClick: () => void; title: string }) {
  return <IconButton icon={icon} onClick={onClick} title={title} small />;
}

/** StashDetailDialog shows what one stash entry contains and the actions
 *  that rescue it: open a file diff, pop, apply, or restore on a branch. */
export function StashDetailDialog({
  index,
  refName,
  onClose,
  onOpenDiff,
  onApply,
  onDrop,
  onBranch,
}: {
  index: number;
  refName: string;
  onClose: () => void;
  onOpenDiff: (index: number, path: string, compareLocal: boolean) => void;
  onApply: (index: number, pop: boolean, restoreIndex: boolean) => void;
  onDrop: (index: number) => void;
  onBranch: (index: number, branch: string) => void;
}) {
  const t = useT(T);
  const [files, setFiles] = useState<StashFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [branch, setBranch] = useState(`stash-${index}`);
  const [restoreIndex, setRestoreIndex] = useState(false);
  const [compareLocal, setCompareLocal] = useState(false);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    Git.stashFiles(index)
      .then((list) => alive && setFiles(list))
      .catch(() => alive && setFiles([]))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [index]);

  return (
    <Modal
      title={t("stashd.title", { ref: refName })}
      icon="stash"
      width={620}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>{t("stashd.cancel")}</Button>
          <Button onClick={() => onApply(index, false, restoreIndex)}>{t("stashd.apply")}</Button>
          <Button variant="primary" onClick={() => onApply(index, true, restoreIndex)}>
            {t("stashd.pop")}
          </Button>
        </>
      }
    >
      {loading ? (
        <Spinner label={t("stashd.loading")} />
      ) : files.length === 0 ? (
        <p className="setting-hint">{t("stashd.empty")}</p>
      ) : (
        <div className="stashd-files">
          {files.map((file) => (
            <button
              key={file.path}
              className="stashd-file"
              title={t("stashd.open")}
              onClick={() => onOpenDiff(index, file.path, compareLocal)}
            >
              <Icon name="file" size={13} />
              <span className="stashd-path">
                {file.path}
                {file.oldPath ? <span className="muted"> ← {file.oldPath}</span> : null}
              </span>
              {file.binary ? (
                <span className="muted">{t("stashd.binary")}</span>
              ) : (
                <span className="stashd-counts">
                  <span className="add">+{file.additions}</span>
                  <span className="del">-{file.deletions}</span>
                </span>
              )}
            </button>
          ))}
        </div>
      )}
      <div className="dialog-checks">
        <Checkbox
          checked={restoreIndex}
          onChange={setRestoreIndex}
          label={t("stashd.restoreIndex")}
        />
        <Checkbox
          checked={compareLocal}
          onChange={setCompareLocal}
          label={t("stashd.compareLocal")}
        />
      </div>
      <div className="dialog-form stashd-branch">
        <Field label={t("stashd.branch")}>
          <TextInput value={branch} onChange={setBranch} placeholder={t("stashd.branchPlaceholder")} />
        </Field>
        <div className="stashd-branch-actions">
          <Button onClick={() => onBranch(index, branch.trim())} disabled={!branch.trim()}>
            {t("stashd.branch")}
          </Button>
          <Button variant="danger" onClick={() => onDrop(index)}>
            {t("stashd.drop")}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

/** LocalHistoryDialog lists the copies IDEA's Local History keeps of one
 *  file, lets the reader compare them, and restores one. */
export function LocalHistoryDialog({
  path,
  onClose,
  onRestore,
}: {
  path: string;
  onClose: () => void;
  onRestore: (path: string, digest: string) => void;
}) {
  const t = useT(T);
  const [entries, setEntries] = useState<LocalHistoryEntry[] | null>(null);
  const [selected, setSelected] = useState<LocalHistoryEntry | null>(null);
  const [text, setText] = useState("");
  const [label, setLabel] = useState("");

  const pick = async (entry: LocalHistoryEntry) => {
    setSelected(entry);
    setLabel(entry.label);
    try {
      setText(await Git.localHistoryContent(entry.path, entry.digest));
    } catch {
      setText("");
    }
  };
  const load = async () => {
    try {
      const list = path ? await Git.localHistory(path) : await Git.localHistoryAll();
      setEntries(list);
      if (list.length > 0) await pick(list[0]!);
    } catch {
      setEntries([]);
    }
  };
  useEffect(() => {
    void load();
  }, [path]);

  const saveLabel = async () => {
    if (!selected) return;
    await Git.labelLocalHistory(selected.path, selected.digest, label).catch(() => {});
    await load();
  };

  return (
    <Modal
      title={path ? t("localHistory.title", { path }) : t("localHistory.repoTitle")}
      icon="clock"
      width={880}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>{t("common.close")}</Button>
          <Button
            variant="primary"
            disabled={!selected}
            onClick={() => selected && onRestore(selected.path, selected.digest)}
          >
            {t("localHistory.restore")}
          </Button>
        </>
      }
    >
      {entries === null ? (
        <Spinner label={t("localHistory.loading")} />
      ) : entries.length === 0 ? (
        <p className="setting-hint">{path ? t("localHistory.empty") : t("localHistory.repoEmpty")}</p>
      ) : (
        <div className="local-history">
          <div className="local-history-list">
            {entries.map((entry) => (
              <button
                key={entry.path + ":" + entry.digest}
                className={cx("local-history-row", selected?.digest === entry.digest && selected.path === entry.path && "selected")}
                onClick={() => void pick(entry)}
              >
                <span className="local-history-time">{formatWhen(entry.time)}</span>
                {!path && <span className="local-history-path" title={entry.path}>{entry.path}</span>}
                <span className="local-history-label">{entry.label || t("localHistory.unlabelled")}</span>
                <span className="muted">{entry.size} B</span>
              </button>
            ))}
          </div>
          <div className="local-history-detail">
            <div className="row">
              <TextInput value={label} onChange={setLabel} placeholder={t("localHistory.labelPlaceholder")} />
              <Button onClick={() => void saveLabel()} disabled={!selected}>
                {t("localHistory.label")}
              </Button>
            </div>
            <pre className="local-history-preview">{text || t("localHistory.binary")}</pre>
          </div>
        </div>
      )}
    </Modal>
  );
}

/** ReviewDialog reads every working-tree change in one place, with the
 *  same full-file diff the editor shows, before a commit. */
export function ReviewDialog({
  entries,
  context,
  onClose,
}: {
  entries: FileEntry[];
  context: number;
  onClose: () => void;
}) {
  const t = useT(T);
  const files = useMemo(() => entries.filter((e) => !e.unmerged && !e.ignored), [entries]);
  const [path, setPath] = useState<string>(files[0]?.path ?? "");
  const [diff, setDiff] = useState<FileDiff | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [mode, setMode] = useState<"split" | "unified">("unified");
  const [whitespace, setWhitespace] = useState<WhitespaceMode>("none");
  const [wrap, setWrap] = useState(false);

  const opts: DiffOptions = {
    path,
    target: "head",
    revision: "",
    from: "",
    context,
    whitespace,
    noText: false,
  };

  useEffect(() => {
    if (!path) {
      setDiff(null);
      return;
    }
    let alive = true;
    setLoading(true);
    setError("");
    Git.diff({ ...opts, path })
      .then((result) => {
        if (alive) setDiff(result);
      })
      .catch((err: unknown) => {
        if (alive) {
          setError(err instanceof Error ? err.message : String(err));
          setDiff(null);
        }
      })
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [path, context, whitespace]);

  return (
    <Modal
      title={t("review.title")}
      icon="diff"
      width={1180}
      onClose={onClose}
      footer={<Button onClick={onClose}>{t("common.close")}</Button>}
    >
      {files.length === 0 ? (
        <p className="setting-hint">{t("review.empty")}</p>
      ) : (
        <div className="review-layout">
          <div className="review-files">
            <div className="review-files-title">{t("review.files")}</div>
            {files.map((entry) => (
              <button
                key={entry.path + (entry.staged ? ":staged" : "")}
                className={cx("review-file", entry.path === path && "selected")}
                onClick={() => setPath(entry.path)}
                title={entry.path}
              >
                <StatusMark kind={entry.kind} staged={entry.staged} />
                <span className="review-file-path">{entry.path}</span>
              </button>
            ))}
          </div>
          <div className="review-diff">
            {error ? (
              <p className="dialog-error">{t("review.failed")}: {error}</p>
            ) : loading && !diff ? (
              <Spinner label={t("review.loading")} />
            ) : diff ? (
              <DiffView
                diff={diff}
                opts={{ ...opts, path }}
                mode={mode}
                setMode={setMode}
                whitespace={whitespace}
                onWhitespace={setWhitespace}
                onApply={() => {}}
                onApplyFile={() => {}}
                onApplyLines={() => {}}
                onOpenFile={() => {}}
                root=""
                onCopyPath={() => {}}
                busy={loading}
                reloadKey={0}
                wrap={wrap}
                onToggleWrap={() => setWrap((v) => !v)}
              />
            ) : null}
          </div>
        </div>
      )}
    </Modal>
  );
}

/** CleanupBranchesDialog deletes branches that are merged or whose
 *  upstream disappeared, with a checkbox per branch. */
export function CleanupBranchesDialog({
  onClose,
  onDelete,
}: {
  onClose: () => void;
  onDelete: (names: string[]) => void;
}) {
  const t = useT(T);
  const [data, setData] = useState<BranchCleanup | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [failed, setFailed] = useState("");

  useEffect(() => {
    let alive = true;
    Git.cleanupCandidates()
      .then((cleanup) => {
        if (!alive) return;
        setData(cleanup);
        setPicked(new Set([...cleanup.merged, ...cleanup.gone].map((b) => b.name)));
      })
      .catch((err: unknown) => alive && setFailed(err instanceof Error ? err.message : String(err)));
    return () => {
      alive = false;
    };
  }, []);

  const toggle = (name: string) => {
    const next = new Set(picked);
    if (next.has(name)) next.delete(name);
    else next.add(name);
    setPicked(next);
  };

  const group = (title: string, branches: BranchInfo[]) =>
    branches.length > 0 && (
      <div className="cleanup-group">
        <div className="cleanup-head">{title}</div>
        {branches.map((b) => (
          <label className="cleanup-row" key={b.name}>
            <Checkbox checked={picked.has(b.name)} onChange={() => toggle(b.name)} label={b.name} />
            <span className="cleanup-subject" title={b.subject}>
              {b.subject}
            </span>
            {b.upstream && <span className="muted cleanup-upstream">{b.upstream}</span>}
          </label>
        ))}
      </div>
    );

  return (
    <Modal
      title={t("cleanup.title")}
      icon="branch"
      width={640}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>{t("cleanup.cancel")}</Button>
          <Button
            variant="primary"
            disabled={picked.size === 0}
            onClick={() => onDelete([...picked])}
          >
            {t("cleanup.delete", { n: picked.size })}
          </Button>
        </>
      }
    >
      {failed && <p className="dialog-error">{failed}</p>}
      {!data && !failed && <Spinner />}
      {data && data.merged.length === 0 && data.gone.length === 0 && (
        <p className="setting-hint">{t("cleanup.empty")}</p>
      )}
      {data && group(t("cleanup.merged"), data.merged)}
      {data && group(t("cleanup.gone"), data.gone)}
    </Modal>
  );
}

/** ConflictSummaryDialog lists every conflicted file and resolves them in
 *  bulk, the way the IDE's conflicts dialog does. */
export function ConflictSummaryDialog({
  operation,
  oursLabel,
  theirsLabel,
  conflicts,
  totals,
  onClose,
  onOpen,
  onTakeSide,
  onResolveSimple,
  onMergeInMemory,
  onContinue,
}: {
  operation: string;
  oursLabel: string;
  theirsLabel: string;
  conflicts: Conflict[];
  /** Conflicts each file had when it entered the merge; markers is what is left. */
  totals: Record<string, number>;
  onClose: () => void;
  onOpen: (path: string) => void;
  onTakeSide: (paths: string[], side: "ours" | "theirs") => void;
  onResolveSimple: () => void;
  /** Merge every file with git's three-way algorithm, in memory. */
  onMergeInMemory: () => void;
  onContinue: () => void;
}) {
  const t = useT(T);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [open, setOpen] = useState(true);
  const [showDirs, setShowDirs] = useState(true);
  const [menu, setMenu] = useState<{ x: number; y: number; items: ContextItem[] } | null>(null);
  const current = conflicts.find((c) => selected.has(c.path)) ?? conflicts[0];
  // The selection outlives the files it names: a side taken from the row menu
  // removes a path, and acting on it again would "take a side" for a path that
  // is no longer unmerged (git would delete it).
  const chosen = conflicts.filter((c) => selected.has(c.path)).map((c) => c.path);
  const stateLabel = (state: string) =>
    state === "added"
      ? t("conflicts.added")
      : state === "deleted"
        ? t("conflicts.deleted")
        : state === "modified"
          ? t("conflicts.modified")
          : "";

  const ours = oursLabel || "LOCAL";
  const theirs = theirsLabel || "REMOTE";
  const subtitle =
    operation === "merge"
      ? t("conflicts.merging", { ours, theirs })
      : operation === "rebase" || operation === "rebase-interactive"
        ? t("conflicts.rebasing", { ours, theirs })
        : t("conflicts.operation");

  const row = (c: Conflict) => {
    const total = totals[c.path] ?? c.markers;
    const resolved = Math.max(0, total - c.markers);
    const slash = c.path.lastIndexOf("/");
    const dir = slash >= 0 ? c.path.slice(0, slash) : "";
    const name = slash >= 0 ? c.path.slice(slash + 1) : c.path;
    return (
      <div
        key={c.path}
        className={cx("conflict-row2", selected.has(c.path) && "selected")}
        onClick={(event) => {
          if (event.metaKey || event.ctrlKey) {
            setSelected((prev) => {
              const next = new Set(prev);
              if (next.has(c.path)) next.delete(c.path);
              else next.add(c.path);
              return next;
            });
            return;
          }
          setSelected(new Set([c.path]));
        }}
        onDoubleClick={() => onOpen(c.path)}
        onContextMenu={(event) => {
          event.preventDefault();
          if (!selected.has(c.path)) setSelected(new Set([c.path]));
          // A row inside the selection acts on the whole selection, the way a
          // tree in an IDE does.
          const targets = selected.has(c.path) ? [...selected].filter((p) => conflicts.some((f) => f.path === p)) : [c.path];
          setMenu({
            x: event.clientX,
            y: event.clientY,
            items: [
              { label: t("conflicts.open"), icon: "merge", onClick: () => onOpen(c.path) },
              { separator: true },
              {
                label: targets.length > 1 ? t("conflicts.oursMany", { n: targets.length }) : t("conflicts.ours"),
                icon: "ours",
                disabled: !c.oursState,
                onClick: () => onTakeSide(targets, "ours"),
              },
              {
                label: targets.length > 1 ? t("conflicts.theirsMany", { n: targets.length }) : t("conflicts.theirs"),
                icon: "theirs",
                disabled: !c.theirsState,
                onClick: () => onTakeSide(targets, "theirs"),
              },
            ],
          });
        }}
      >
        <span className="conflict-file">
          <FileIcon path={c.path} />
          <span className="conflict-name">{name}</span>
          {total > 0 && (
            <span className="conflict-badge">
              {resolved}/{total}
            </span>
          )}
          {showDirs && dir !== "" && <span className="conflict-dir">{dir}</span>}
        </span>
        <span className="conflict-side">
          <span className="conflict-side-state">{stateLabel(c.oursState)}</span>
          {c.oursState !== "" && (
            <Button size="small" onClick={() => onTakeSide([c.path], "ours")}>
              {t("conflicts.accept")}
            </Button>
          )}
        </span>
        <span className="conflict-side">
          <span className="conflict-side-state">{stateLabel(c.theirsState)}</span>
          {c.theirsState !== "" && (
            <Button size="small" onClick={() => onTakeSide([c.path], "theirs")}>
              {t("conflicts.accept")}
            </Button>
          )}
        </span>
      </div>
    );
  };

  return (
    <Modal
      title={t("conflicts.title")}
      icon="merge"
      width={860}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>{t("conflicts.close")}</Button>
          <Button disabled={conflicts.length > 0} onClick={onContinue}>
            {t("conflicts.acceptFinish")}
          </Button>
          <Button variant="primary" disabled={!current} onClick={() => current && onOpen(current.path)}>
            {t("conflicts.manual")}
          </Button>
        </>
      }
    >
      <div className="conflict-intro">{subtitle}</div>
      <div className="conflict-dialog-toolbar">
        <Button size="small" onClick={onResolveSimple} disabled={conflicts.length === 0}>
          <Icon name="sparkle" size={12} /> {t("conflicts.solveSimple")}
        </Button>
        <Button size="small" onClick={onMergeInMemory} disabled={conflicts.length === 0}>
          <Icon name="merge" size={12} /> {t("conflicts.mergeInMemory")}
        </Button>
        <span className="spacer" />
        <Button size="small" onClick={() => onTakeSide(chosen, "ours")} disabled={chosen.length === 0}>
          {t("conflicts.ours")}
          {chosen.length > 1 ? ` (${chosen.length})` : ""}
        </Button>
        <Button size="small" onClick={() => onTakeSide(chosen, "theirs")} disabled={chosen.length === 0}>
          {t("conflicts.theirs")}
          {chosen.length > 1 ? ` (${chosen.length})` : ""}
        </Button>
        <IconButton
          icon="eye"
          title={t("conflicts.showDirs")}
          small
          onClick={(event) => {
            const rect = event.currentTarget.getBoundingClientRect();
            setMenu({
              x: rect.left,
              y: rect.bottom,
              items: [
                {
                  label: t("conflicts.showDirs"),
                  checked: showDirs,
                  onClick: () => setShowDirs((v) => !v),
                },
              ],
            });
          }}
        />
      </div>
      <div className="conflict-table">
        <div className="conflict-table-head">
          <span className="conflict-file" />
          <span className="conflict-side">{t("conflicts.yoursCol", { name: ours })}</span>
          <span className="conflict-side">{t("conflicts.theirsCol", { name: theirs })}</span>
        </div>
        <div className="conflict-group-head" onClick={() => setOpen((v) => !v)}>
          <Icon name={open ? "chevronDown" : "chevronRight"} size={12} />
          <span className={cx("conflict-group-icon", conflicts.length > 0 ? "bad" : "good")}>
            <Icon name={conflicts.length > 0 ? "error" : "check"} size={13} />
          </span>
          <span className="conflict-group-title">
            {conflicts.length > 0 ? t("conflicts.unresolvedGroup") : t("conflicts.allResolved")}
          </span>
          {conflicts.length > 0 && (
            <span className="conflict-group-count">{t("conflicts.files", { n: conflicts.length })}</span>
          )}
        </div>
        {open && conflicts.map(row)}
      </div>
      {menu && <ContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={() => setMenu(null)} />}
    </Modal>
  );
}

/** CompareDialog lists the files that differ between a ref and HEAD. */
export function CompareDialog({
  from,
  refs,
  onClose,
  onOpenFile,
}: {
  from: string;
  refs: string[];
  onClose: () => void;
  onOpenFile: (path: string, from: string, to: string) => void;
}) {
  const t = useT(T);
  const [left, setLeft] = useState(from);
  const [right, setRight] = useState("HEAD");
  const [files, setFiles] = useState<Change[] | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let alive = true;
    setFiles(null);
    setError("");
    Git.compare(left, right)
      .then((list) => alive && setFiles(list))
      .catch((err: unknown) => alive && setError(err instanceof Error ? err.message : String(err)));
    return () => {
      alive = false;
    };
  }, [left, right]);

  return (
    <Modal
      title={`${t("compare.title")} — ${left} → ${right}`}
      icon="diff"
      width={680}
      onClose={onClose}
      footer={<Button variant="primary" onClick={onClose}>{t("compare.close")}</Button>}
    >
      <div className="row">
        <Select value={left} onChange={setLeft}>
          {[...new Set([left, ...refs])].map((ref) => (
            <option key={ref} value={ref}>
              {ref}
            </option>
          ))}
        </Select>
        <Button
          onClick={() => {
            const previousLeft = left;
            setLeft(right);
            setRight(previousLeft);
          }}
          title={t("compare.swap")}
        >
          ⇄
        </Button>
        <Select value={right} onChange={setRight}>
          {[...new Set([right, ...refs])].map((ref) => (
            <option key={ref} value={ref}>
              {ref}
            </option>
          ))}
        </Select>
      </div>
      {error && <p className="dialog-error">{error}</p>}
      {!files && !error && <Spinner label={t("compare.loading")} />}
      {files && files.length === 0 && <p className="setting-hint">{t("compare.empty")}</p>}
      {files && files.length > 0 && (
        <>
          <p className="setting-hint">{t("compare.files", { n: files.length })}</p>
          <div className="repo-list">
            {files.map((file) => (
              <button className="repo-row compare-row" key={file.path} onClick={() => onOpenFile(file.path, left, right)}>
                <StatusMark kind={file.kind} />
                <span className="repo-row-title">{file.path}</span>
                {file.oldPath && <span className="muted">{file.oldPath}</span>}
              </button>
            ))}
          </div>
        </>
      )}
    </Modal>
  );
}
