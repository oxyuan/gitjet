import { useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";
import { buildChangeTree, directoryKeys } from "./changes";
import { FileTree } from "./FileTree";
import { Git, Workspace } from "./mygo";
import type {
  BranchCleanup,
  Change,
  BranchInfo,
  CommitDetail,
  CommitFile,
  MergeOptions,
  PullOptions,
  PushOptions,
  PushPreview,
  Conflict,
  Remote,
  Settings,
  StashFile,
  StashOptions,
  TagOptions,
} from "./mygo";
import { Icon } from "./icons";
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
  StatusMark,
  TextInput,
  formatWhen,
  type ContextItem,
} from "./ui";

import { count, useT } from "./i18n";

const T = {
  en: {
    "common.cancel": "Cancel",
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
    "settings.panelGitPath": "Git executable",
    "settings.panelDiff": "Diff settings",
    "settings.panelSync": "Sync and update",
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
    "settings.contextLinesHint": "Lines of unchanged code kept around each change.",
    "settings.ignoreWhitespace": "Ignore whitespace in diffs by default",
    "settings.ignoreWhitespaceHint": "Changes that only add, remove or reindent spaces are left out of the comparison.",
    "settings.showIgnored": "Show ignored files in the commit panel",
    "settings.showIgnoredHint": "Files matched by .gitignore stay in the change list instead of disappearing from it.",
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
    "pull.title": "Update Project",
    "pull.note": "Pull fetches the remote and integrates the upstream into the current branch.",
    "pull.integrate": "Integrate with",
    "pull.autostash": "Stash local changes before update (--autostash)",
    "pull.prune": "Prune deleted remote branches",
    "pull.tags": "Fetch tags",
    "reset.title": "Reset Current Branch",
    "reset.note": "Move {hash} to this commit, along with the current branch.",
    "reset.noteSubject": "Move {hash} (“{subject}”) to this commit, along with the current branch.",
    "reset.soft": "Soft",
    "reset.softHint": "Keep all local changes staged.",
    "reset.mixed": "Mixed",
    "reset.mixedHint": "Keep local changes in the working tree, unstaged.",
    "reset.hard": "Hard",
    "reset.hardHint": "Discard all local changes. This cannot be undone.",
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
    "merge.into": "Merge into",
    "merge.branch": "Branch",
    "merge.noFF": "Create a merge commit (--no-ff)",
    "merge.squash": "Squash commits (--squash)",
    "push.diverged": "The remote branch has commits you do not have (tip {tip}). Pushing overwrites them.",
    "push.forceIfIncludes": "Refuse the force if the remote moved (--force-if-includes)",
    "stashd.title": "Stash {ref}",
    "stashd.loading": "Reading the stash",
    "stashd.empty": "This stash has no files",
    "stashd.binary": "binary",
    "stashd.open": "Open the diff",
    "stashd.pop": "Pop",
    "stashd.apply": "Apply",
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
    "conflicts.allOurs": "All ours",
    "conflicts.allTheirs": "All theirs",
    "conflicts.open": "Merge…",
    "conflicts.mark": "Mark resolved",
    "conflicts.markAll": "Mark all resolved",
    "conflicts.continue": "Continue",
    "conflicts.abort": "Abort",
    "conflicts.close": "Close",
    "conflicts.empty": "No conflicted files",
    "compare.title": "Compare with the working branch",
    "compare.loading": "Comparing",
    "compare.empty": "No file differs",
    "compare.close": "Close",
    "compare.files": "{n} files differ",
  },
  zh: {
    "common.cancel": "取消",
    "common.save": "保存",
    "common.create": "创建",
    "common.rename": "重命名",
    "common.merge": "合并",
    "common.push": "推送",
    "common.pull": "拉取",
    "common.reset": "重置",
    "common.stash": "贮藏",
    "settings.title": "设置",
    "settings.tabGeneral": "通用",
    "settings.tabGit": "Git",
    "settings.tabKeys": "快捷键",
    "settings.panelGeneral": "通用设置",
    "settings.panelGitPath": "Git 基础配置",
    "settings.panelDiff": "差异对比设置",
    "settings.panelSync": "同步拉取设置",
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
    "settings.contextLinesHint": "每一处改动周围保留的未改动行数。",
    "settings.ignoreWhitespace": "默认忽略空白差异",
    "settings.ignoreWhitespaceHint": "对比代码时，忽略仅空格、缩进或换行上的变动。",
    "settings.showIgnored": "在提交面板中显示被忽略的文件",
    "settings.showIgnoredHint": "被 .gitignore 忽略的文件依然列在更改列表里，而不是直接消失。",
    "settings.updateMethod": "更新方式",
    "settings.updateMethodHint": "合并（merge）保留两条历史并产生一个合并提交；变基（rebase）把你的本地提交重放到远端提交之上，历史是一条直线。",
    "settings.merge": "合并",
    "settings.rebase": "变基",
    "settings.autoFetch": "自动获取远程更新",
    "settings.autoFetchHint": "只执行 fetch：刷新远端分支的状态，不会合并、不会改动你的工作区或历史——要拉取仍然由你手动触发。",
    "settings.minutes": "分钟",
    "settings.autoFetchInterval": "获取间隔",
    "settings.confirmRollback": "回滚更改前确认",
    "settings.confirmRollbackHint": "回滚会丢弃 git 无法找回的本地改动。",
    "settings.confirmForcePush": "强制推送前确认",
    "settings.confirmForcePushHint": "强制推送会覆盖远端分支，可能丢掉他人已经基于其开发的提交。",
    "settings.resetTab": "恢复默认",
    "settings.unsavedTitle": "未保存的修改",
    "settings.unsaved": "当前页有尚未保存的修改，切换后将会丢失。",
    "settings.discard": "放弃修改",
    "settings.saveAndClose": "保存并关闭",
    "settings.keysHint": "这些来自菜单，暂不支持在这里修改。",
    "settings.keyOpen": "打开仓库",
    "settings.keyQuickOpen": "快速打开文件",
    "settings.keyCommit": "提交",
    "settings.keyPush": "推送",
    "settings.keyUpdate": "更新项目",
    "settings.keySettings": "设置",
    "branch.new": "新建分支",
    "branch.rename": "重命名分支",
    "branch.name": "名称",
    "branch.from": "起点",
    "branch.current": "{ref}（当前）",
    "branch.checkout": "检出到新分支",
    "branch.createCheckout": "创建并检出",
    "push.title": "推送提交",
    "push.noRemotes": "此仓库没有远程。可在 Git 控制台中添加：",
    "push.remote": "远程",
    "push.branch": "分支",
    "push.setUpstream": "设置上游 (-u)",
    "push.allTags": "推送标签",
    "push.dryRun": "试运行",
    "push.force": "强制推送（--force-with-lease）",
    "push.moreOptions": "更多推送选项",
    "push.warning": "强制推送会重写远程历史。仅当远程分支仍停在你上次看到的位置时才会成功。",
    "push.chooseRemote": "选择要推送到哪个远程",
    "push.detached": "游离 HEAD",
    "push.newBranch": "新建分支",
    "push.checking": "正在读取将要推送的内容…",
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
    "push.createsOnly": "该分支没有新提交，推送会在远程创建它（{hash}）。",
    "push.dryRunAction": "试运行",
    "pull.title": "更新项目",
    "pull.note": "拉取会获取远程内容，并把上游合入当前分支。",
    "pull.integrate": "整合方式",
    "pull.autostash": "更新前贮藏本地更改（--autostash）",
    "pull.prune": "清理已删除的远程分支",
    "pull.tags": "获取标签",
    "reset.title": "重置当前分支",
    "reset.note": "将当前分支与 {hash} 一起移动到该提交。",
    "reset.noteSubject": "将当前分支与 {hash}（“{subject}”）一起移动到该提交。",
    "reset.soft": "软重置",
    "reset.softHint": "保留所有本地更改并维持已暂存状态。",
    "reset.mixed": "混合重置",
    "reset.mixedHint": "保留本地更改，但取消暂存。",
    "reset.hard": "硬重置",
    "reset.hardHint": "丢弃所有本地更改，且无法撤销。",
    "tag.title": "新建标签",
    "tag.tagging": "为 {hash} 创建标签",
    "tag.name": "标签名",
    "tag.message": "说明",
    "tag.messageHint": "留空则创建轻量标签。",
    "tag.messagePlaceholder": "发布 1.0.0",
    "tag.force": "替换已有标签（-f）",
    "tag.create": "创建标签",
    "stash.title": "贮藏更改",
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
    "merge.title": "合并分支",
    "merge.into": "合并到",
    "merge.branch": "分支",
    "merge.noFF": "创建合并提交（--no-ff）",
    "merge.squash": "压缩提交（--squash）",
    "push.diverged": "远端分支有本地没有的提交（{tip}），推送会覆盖它。",
    "push.forceIfIncludes": "远端有新提交时拒绝强推（--force-if-includes）",
    "stashd.title": "贮藏 {ref}",
    "stashd.loading": "正在读取贮藏内容",
    "stashd.empty": "该贮藏没有文件",
    "stashd.binary": "二进制",
    "stashd.open": "查看差异",
    "stashd.pop": "弹出",
    "stashd.apply": "应用",
    "stashd.branch": "恢复到新分支",
    "stashd.drop": "删除贮藏",
    "stashd.branchPlaceholder": "分支名",
    "stashd.cancel": "关闭",
    "cleanup.title": "清理分支",
    "cleanup.merged": "已合并到当前分支",
    "cleanup.gone": "上游已删除",
    "cleanup.empty": "没有可清理的分支",
    "cleanup.delete": "删除 {n} 个分支",
    "cleanup.cancel": "取消",
    "conflicts.title": "解决冲突",
    "conflicts.ours": "采用我方",
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
    "compare.title": "与当前分支比较",
    "compare.loading": "正在比较",
    "compare.empty": "没有不同的文件",
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
  { id: "gitPath", title: "settings.panelGitPath", open: true },
  { id: "diff", title: "settings.panelDiff", open: false },
  { id: "sync", title: "settings.panelSync", open: true },
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
    "diffContext",
    "ignoreWhitespace",
    "showIgnored",
    "updateMethod",
    "autoFetch",
    "autoFetchMinutes",
    "confirmRollback",
    "confirmForcePush",
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

export function SettingsDialog({
  settings,
  onSave,
  onClose,
  onValidate,
}: {
  settings: Settings;
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
          {tab === "general" &&
            panel(
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
                "diff",
                <>
                  <SettingRow label={t("settings.contextLines")} hint={t("settings.contextLinesHint")}>
                    <input
                      className="text-input number"
                      type="number"
                      min={1}
                      max={100}
                      value={draft.diffContext}
                      onChange={(e) => set("diffContext", Number(e.target.value) || 3)}
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

export function PushDialog({
  remotes,
  current,
  branch: initialBranch,
  setUpstream,
  onClose,
  onSubmit,
}: {
  remotes: Remote[];
  current: string;
  branch?: string;
  setUpstream: boolean;
  onClose: () => void;
  onSubmit: (opts: PushOptions) => void;
}) {
  const t = useT(T);
  const [branch, setBranch] = useState(initialBranch || current);
  const [recent, setRecent] = useState<string[]>([]);
  const [forceIfIncludes, setForceIfIncludes] = useState(false);
  const [remote, setRemote] = useState(remotes.find((r) => r.name === "origin")?.name ?? remotes[0]?.name ?? "origin");
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

  // The dialog is a confirmation: it shows what git would send before the
  // button sends it. Changing the remote changes the answer.
  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError("");
    setSelected(null);
    setDetail(null);
    Git.pushPreview(remote, branch)
      .then((p) => {
        if (!alive) return;
        setPreview(p);
        if (p.creates) setUpstreamState(true);
      })
      .catch((err) => {
        if (!alive) return;
        setPreview(null);
        setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [remote, branch]);

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
  const targetBranch = preview ? preview.remoteBranch.slice(remote.length + 1) || branch : branch;

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
                    if (targetBranch) setBranch(targetBranch);
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
        <div className="pushd">
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
              <span className="pushd-target">{targetBranch}</span>
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
                      >
                        <span className="tree-chevron-spacer" />
                        <StatusMark kind={file.status} />
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
  return (
    <Modal
      title={t("pull.title")}
      icon="pull"
      width={480}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>{t("common.cancel")}</Button>
          <Button variant="primary" onClick={() => onSubmit({ remote, branch: "", rebase, autostash, prune, tags })}>
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
          <Checkbox checked={autostash} onChange={setAutostash} label={t("pull.autostash")} />
          <Checkbox checked={prune} onChange={setPrune} label={t("pull.prune")} />
          <Checkbox checked={tags} onChange={setTags} label={t("pull.tags")} />
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
  onSubmit: (mode: "soft" | "mixed" | "hard") => void;
}) {
  const t = useT(T);
  const [mode, setMode] = useState<"soft" | "mixed" | "hard">("mixed");
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
  refs,
  current,
  onClose,
  onSubmit,
}: {
  refs: string[];
  current: string;
  onClose: () => void;
  onSubmit: (ref: string, opts: MergeOptions) => void;
}) {
  const t = useT(T);
  const [ref, setRef] = useState(refs[0] ?? "");
  const [noFF, setNoFF] = useState(false);
  const [squash, setSquash] = useState(false);
  return (
    <Modal
      title={t("merge.title")}
      icon="merge"
      width={460}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>{t("common.cancel")}</Button>
          <Button variant="primary" onClick={() => onSubmit(ref, { noFF, squash, message: "" })} disabled={!ref}>
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
            {refs.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </Select>
        </Field>
        <Checkbox checked={noFF} onChange={setNoFF} label={t("merge.noFF")} />
        <Checkbox checked={squash} onChange={setSquash} label={t("merge.squash")} />
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
  onOpenDiff: (index: number, path: string) => void;
  onApply: (index: number, pop: boolean) => void;
  onDrop: (index: number) => void;
  onBranch: (index: number, branch: string) => void;
}) {
  const t = useT(T);
  const [files, setFiles] = useState<StashFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [branch, setBranch] = useState(`stash-${index}`);

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
          <Button onClick={() => onApply(index, false)}>{t("stashd.apply")}</Button>
          <Button variant="primary" onClick={() => onApply(index, true)}>
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
              onClick={() => onOpenDiff(index, file.path)}
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
  conflicts,
  onClose,
  onOpen,
  onTakeSide,
  onMarkResolved,
  onContinue,
  onAbort,
}: {
  operation: string;
  conflicts: Conflict[];
  onClose: () => void;
  onOpen: (path: string) => void;
  onTakeSide: (paths: string[], side: "ours" | "theirs") => void;
  onMarkResolved: (paths: string[]) => void;
  onContinue: () => void;
  onAbort: () => void;
}) {
  const t = useT(T);
  const paths = conflicts.map((c) => c.path);
  return (
    <Modal
      title={operation ? `${t("conflicts.title")} — ${operation}` : t("conflicts.title")}
      icon="merge"
      width={720}
      onClose={onClose}
      footer={
        <>
          <Button variant="danger" onClick={onAbort}>
            {t("conflicts.abort")}
          </Button>
          <Button onClick={onClose}>{t("conflicts.close")}</Button>
          <Button variant="primary" onClick={onContinue} disabled={conflicts.length > 0 || operation === ""}>
            {t("conflicts.continue")}
          </Button>
        </>
      }
    >
      {conflicts.length === 0 ? (
        <p className="setting-hint">{t("conflicts.empty")}</p>
      ) : (
        <>
          <div className="conflict-bulk">
            <Button onClick={() => onTakeSide(paths, "ours")}>{t("conflicts.allOurs")}</Button>
            <Button onClick={() => onTakeSide(paths, "theirs")}>{t("conflicts.allTheirs")}</Button>
            <Button onClick={() => onMarkResolved(paths)}>{t("conflicts.markAll")}</Button>
          </div>
          <div className="conflict-list">
            {conflicts.map((c) => (
              <div className="conflict-row" key={c.path}>
                <span className="conflict-code">{c.code}</span>
                <span className="conflict-path" title={c.path}>
                  {c.path}
                </span>
                <Button onClick={() => onOpen(c.path)}>{t("conflicts.open")}</Button>
                <Button onClick={() => onTakeSide([c.path], "ours")} disabled={!c.ours}>
                  {t("conflicts.ours")}
                </Button>
                <Button onClick={() => onTakeSide([c.path], "theirs")} disabled={!c.theirs}>
                  {t("conflicts.theirs")}
                </Button>
                <Button onClick={() => onMarkResolved([c.path])}>{t("conflicts.mark")}</Button>
              </div>
            ))}
          </div>
        </>
      )}
    </Modal>
  );
}

/** CompareDialog lists the files that differ between a ref and HEAD. */
export function CompareDialog({
  from,
  onClose,
  onOpenFile,
}: {
  from: string;
  onClose: () => void;
  onOpenFile: (path: string) => void;
}) {
  const t = useT(T);
  const [files, setFiles] = useState<Change[] | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let alive = true;
    Git.compare(from, "HEAD")
      .then((list) => alive && setFiles(list))
      .catch((err: unknown) => alive && setError(err instanceof Error ? err.message : String(err)));
    return () => {
      alive = false;
    };
  }, [from]);

  return (
    <Modal
      title={`${t("compare.title")} — ${from}`}
      icon="diff"
      width={680}
      onClose={onClose}
      footer={<Button variant="primary" onClick={onClose}>{t("compare.close")}</Button>}
    >
      {error && <p className="dialog-error">{error}</p>}
      {!files && !error && <Spinner label={t("compare.loading")} />}
      {files && files.length === 0 && <p className="setting-hint">{t("compare.empty")}</p>}
      {files && files.length > 0 && (
        <>
          <p className="setting-hint">{t("compare.files", { n: files.length })}</p>
          <div className="repo-list">
            {files.map((file) => (
              <button className="repo-row compare-row" key={file.path} onClick={() => onOpenFile(file.path)}>
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
