import { useState } from "react";
import type {
  MergeOptions,
  PullOptions,
  PushOptions,
  Remote,
  Settings,
  StashOptions,
  TagOptions,
} from "./mygo";
import { Icon } from "./icons";
import { Button, Checkbox, Field, IconButton, Modal, Select, Spinner, TextInput } from "./ui";

import { useT } from "./i18n";

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
    "settings.general": "General",
    "settings.language": "Language",
    "settings.languageSystem": "Use system language",
    "settings.theme": "Theme",
    "settings.themeSystem": "Use system setting",
    "settings.themeLight": "Light",
    "settings.themeDark": "Dark",
    "settings.openRepo": "Open Repository",
    "settings.openRepoSame": "Replace this window",
    "settings.openRepoNew": "Open a new window",
    "settings.git": "Git",
    "settings.gitPath": "Git executable",
    "settings.gitPathHint": "Leave empty to use the git on PATH.",
    "settings.gitAuto": "Auto-detect",
    "settings.test": "Test",
    "settings.gitVersion": "git {version}",
    "settings.diff": "Diff",
    "settings.contextLines": "Context lines",
    "settings.ignoreWhitespace": "Ignore whitespace in diffs by default",
    "settings.showIgnored": "Show ignored files in the commit panel",
    "settings.sync": "Synchronization",
    "settings.updateMethod": "Update method",
    "settings.merge": "Merge",
    "settings.rebase": "Rebase",
    "settings.autoFetch": "Fetch remotes automatically",
    "settings.every": "Every",
    "settings.minutes": "minutes",
    "settings.confirmations": "Confirmations",
    "settings.confirmRollback": "Confirm before rolling back changes",
    "settings.confirmForcePush": "Confirm force push",
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
    "push.allTags": "Push all tags",
    "push.dryRun": "Dry run",
    "push.force": "Force with lease (--force-with-lease)",
    "push.warning": "Force push rewrites history on the remote. It only succeeds when the remote branch is where you last saw it.",
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
    "settings.general": "通用",
    "settings.language": "界面语言",
    "settings.languageSystem": "跟随系统",
    "settings.theme": "主题",
    "settings.themeSystem": "跟随系统",
    "settings.themeLight": "浅色",
    "settings.themeDark": "深色",
    "settings.openRepo": "打开仓库时",
    "settings.openRepoSame": "替换当前窗口",
    "settings.openRepoNew": "在新窗口中打开",
    "settings.git": "Git",
    "settings.gitPath": "Git 可执行文件",
    "settings.gitPathHint": "留空则使用 PATH 中的 git。",
    "settings.gitAuto": "自动检测",
    "settings.test": "测试",
    "settings.gitVersion": "git {version}",
    "settings.diff": "差异",
    "settings.contextLines": "上下文行数",
    "settings.ignoreWhitespace": "默认忽略空白差异",
    "settings.showIgnored": "在提交面板中显示被忽略的文件",
    "settings.sync": "同步",
    "settings.updateMethod": "更新方式",
    "settings.merge": "合并",
    "settings.rebase": "变基",
    "settings.autoFetch": "自动获取远程更新",
    "settings.every": "间隔",
    "settings.minutes": "分钟",
    "settings.confirmations": "确认",
    "settings.confirmRollback": "回滚更改前确认",
    "settings.confirmForcePush": "强制推送前确认",
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
    "push.allTags": "推送所有标签",
    "push.dryRun": "试运行",
    "push.force": "强制推送（--force-with-lease）",
    "push.warning": "强制推送会重写远程历史。仅当远程分支仍停在你上次看到的位置时才会成功。",
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
  },
} as const;

function SettingRow({ label, hint, children }: { label?: string; hint?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="setting-row">
      <div className="setting-label">{label ?? ""}</div>
      <div className="setting-control">
        {children}
        {hint && <div className="setting-hint">{hint}</div>}
      </div>
    </div>
  );
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
  const [draft, setDraft] = useState<Settings>(settings);
  const [gitVersion, setGitVersion] = useState("");
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState("");
  const set = <K extends keyof Settings>(key: K, value: Settings[K]) => setDraft({ ...draft, [key]: value });

  const validate = async () => {
    setChecking(true);
    setError("");
    try {
      const version = await onValidate(draft.gitPath);
      setGitVersion(version);
    } catch (err) {
      setGitVersion("");
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setChecking(false);
    }
  };

  return (
    <Modal
      title={t("settings.title")}
      icon="settings"
      width={640}
      className="settings-modal"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>{t("common.cancel")}</Button>
          <Button variant="primary" onClick={() => onSave(draft)}>
            {t("common.save")}
          </Button>
        </>
      }
    >
      <div className="settings">
        <section className="settings-group">
          <h2 className="settings-group-title">{t("settings.general")}</h2>
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
          <SettingRow label={t("settings.openRepo")}>
            <Select
              value={draft.openInNewWindow ? "new" : "same"}
              onChange={(v) => set("openInNewWindow", v === "new")}
            >
              <option value="same">{t("settings.openRepoSame")}</option>
              <option value="new">{t("settings.openRepoNew")}</option>
            </Select>
          </SettingRow>
        </section>

        <section className="settings-group">
          <h2 className="settings-group-title">{t("settings.git")}</h2>
          <SettingRow label={t("settings.gitPath")} hint={t("settings.gitPathHint")}>
            <div className="setting-inline">
              <TextInput value={draft.gitPath} onChange={(v) => set("gitPath", v)} placeholder={t("settings.gitAuto")} />
              <Button onClick={validate} disabled={checking}>
                {checking ? <Spinner /> : t("settings.test")}
              </Button>
            </div>
            {gitVersion && <div className="setting-note ok">{t("settings.gitVersion", { version: gitVersion })}</div>}
            {error && <div className="setting-note error">{error}</div>}
          </SettingRow>
        </section>

        <section className="settings-group">
          <h2 className="settings-group-title">{t("settings.diff")}</h2>
          <SettingRow label={t("settings.contextLines")}>
            <input
              className="text-input number"
              type="number"
              min={1}
              max={100}
              value={draft.diffContext}
              onChange={(e) => set("diffContext", Number(e.target.value) || 3)}
            />
          </SettingRow>
          <SettingRow>
            <Checkbox
              checked={draft.ignoreWhitespace}
              onChange={(v) => set("ignoreWhitespace", v)}
              label={t("settings.ignoreWhitespace")}
            />
          </SettingRow>
          <SettingRow>
            <Checkbox
              checked={draft.showIgnored}
              onChange={(v) => set("showIgnored", v)}
              label={t("settings.showIgnored")}
            />
          </SettingRow>
        </section>

        <section className="settings-group">
          <h2 className="settings-group-title">{t("settings.sync")}</h2>
          <SettingRow label={t("settings.updateMethod")}>
            <Select value={draft.updateMethod} onChange={(v) => set("updateMethod", v)}>
              <option value="merge">{t("settings.merge")}</option>
              <option value="rebase">{t("settings.rebase")}</option>
            </Select>
          </SettingRow>
          <SettingRow>
            <Checkbox checked={draft.autoFetch} onChange={(v) => set("autoFetch", v)} label={t("settings.autoFetch")} />
          </SettingRow>
          <SettingRow label={t("settings.every")}>
            <div className="setting-inline">
              <input
                className="text-input number"
                type="number"
                min={1}
                max={240}
                value={draft.autoFetchMinutes}
                onChange={(e) => set("autoFetchMinutes", Number(e.target.value) || 15)}
              />
              <span className="setting-unit">{t("settings.minutes")}</span>
            </div>
          </SettingRow>
        </section>

        <section className="settings-group">
          <h2 className="settings-group-title">{t("settings.confirmations")}</h2>
          <SettingRow>
            <Checkbox
              checked={draft.confirmRollback}
              onChange={(v) => set("confirmRollback", v)}
              label={t("settings.confirmRollback")}
            />
          </SettingRow>
          <SettingRow>
            <Checkbox
              checked={draft.confirmForcePush}
              onChange={(v) => set("confirmForcePush", v)}
              label={t("settings.confirmForcePush")}
            />
          </SettingRow>
        </section>
      </div>
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
  setUpstream,
  onClose,
  onSubmit,
}: {
  remotes: Remote[];
  current: string;
  setUpstream: boolean;
  onClose: () => void;
  onSubmit: (opts: PushOptions) => void;
}) {
  const t = useT(T);
  const [remote, setRemote] = useState(remotes.find((r) => r.name === "origin")?.name ?? remotes[0]?.name ?? "origin");
  const [branch, setBranch] = useState(current);
  const [force, setForce] = useState(false);
  const [tags, setTags] = useState(false);
  const [dryRun, setDryRun] = useState(false);
  const [upstream, setUpstreamState] = useState(setUpstream);
  return (
    <Modal
      title={t("push.title")}
      icon="push"
      width={500}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>{t("common.cancel")}</Button>
          <Button
            variant="primary"
            onClick={() => onSubmit({ remote, branch, setUpstream: upstream, forceWithLease: force, tags, dryRun })}
          >
            {t("common.push")}
          </Button>
        </>
      }
    >
      <div className="dialog-form">
        {remotes.length === 0 ? (
          <div className="dialog-note">
            {t("push.noRemotes")}
            <code>git remote add origin &lt;url&gt;</code>
          </div>
        ) : (
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
        <Field label={t("push.branch")}>
          <TextInput value={branch} onChange={setBranch} placeholder={current || "branch"} />
        </Field>
        <div className="dialog-checks">
          <Checkbox checked={upstream} onChange={setUpstreamState} label={t("push.setUpstream")} />
          <Checkbox checked={tags} onChange={setTags} label={t("push.allTags")} />
          <Checkbox checked={dryRun} onChange={setDryRun} label={t("push.dryRun")} />
          <Checkbox checked={force} onChange={setForce} label={t("push.force")} />
        </div>
        {force && (
          <div className="dialog-warning">
            <Icon name="warning" /> {t("push.warning")}
          </div>
        )}
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
