import { useEffect, useState } from "react";
import { Channel } from "mygo-runtime";
import { Git } from "./mygo";
import type { LFSStatus, Submodule, Worktree } from "./mygo";
import { Icon } from "./icons";
import { useT } from "./i18n";
import { Button, Checkbox, Field, Modal, Spinner, TextInput, cx } from "./ui";

const T = {
  en: {
    title: "Repository Tools",
    worktrees: "Worktrees",
    submodules: "Submodules",
    lfs: "Git LFS",
    close: "Close",
    loading: "Loading",
    refresh: "Refresh",
    failed: "The action failed",
    main: "main tree",
    detached: "detached",
    locked: "locked",
    prunable: "prunable",
    openWindow: "Open in Window",
    remove: "Remove",
    prune: "Prune",
    addTitle: "New worktree",
    path: "Folder",
    pathPlaceholder: "/path/to/another/checkout",
    branch: "Branch",
    branchPlaceholder: "feature/x",
    createBranch: "Create the branch from HEAD",
    add: "Add worktree",
    emptyWorktrees: "This repository has one working tree",
    subEmpty: "No submodules",
    update: "Update",
    initUpdate: "Init and update",
    modified: "different commit",
    uninitialized: "not checked out",
    conflict: "conflict",
    clean: "clean",
    lfsMissing: "Git LFS is not installed",
    lfsNone: "No file is stored in LFS",
    lfsTracked: "{n} files in LFS",
    unshallow: "Fetch the full history",
    unshallowHint: "This clone has a truncated history",
  },
  zh: {
    title: "仓库工具",
    worktrees: "工作树",
    submodules: "子模块",
    lfs: "Git LFS",
    close: "关闭",
    loading: "加载中",
    refresh: "刷新",
    failed: "操作失败",
    main: "主工作树",
    detached: "游离",
    locked: "已锁定",
    prunable: "可清理",
    openWindow: "在新窗口打开",
    remove: "移除",
    prune: "清理",
    addTitle: "新建工作树",
    path: "目录",
    pathPlaceholder: "/path/to/another/checkout",
    branch: "分支",
    branchPlaceholder: "feature/x",
    createBranch: "从 HEAD 新建分支",
    add: "创建工作树",
    emptyWorktrees: "该仓库只有一个工作树",
    subEmpty: "没有子模块",
    update: "更新",
    initUpdate: "初始化并更新",
    modified: "提交不一致",
    uninitialized: "未检出",
    conflict: "有冲突",
    clean: "干净",
    lfsMissing: "未安装 Git LFS",
    lfsNone: "没有文件存放在 LFS",
    lfsTracked: "{n} 个文件在 LFS 中",
    unshallow: "补全历史",
    unshallowHint: "该克隆的历史被截断",
  },
} as const;

type RepoTab = "worktrees" | "submodules" | "lfs";

/** submoduleState is the badge git's status prefix stands for. */
function submoduleState(state: string): string {
  switch (state) {
    case "modified":
      return "modified";
    case "uninitialized":
      return "uninitialized";
    case "conflict":
      return "conflict";
    default:
      return "clean";
  }
}

/** RepoExtrasDialog gathers the repository-level tools that do not belong
 *  to a branch: worktrees, submodules and Git LFS. */
export function RepoExtrasDialog({
  tab: initialTab,
  shallow,
  onClose,
  onOpenWorktree,
  onChanged,
}: {
  tab: RepoTab;
  shallow: boolean;
  onClose: () => void;
  onOpenWorktree: (path: string) => void;
  onChanged: () => void;
}) {
  const t = useT(T);
  const [tab, setTab] = useState<RepoTab>(initialTab);
  const [trees, setTrees] = useState<Worktree[] | null>(null);
  const [subs, setSubs] = useState<Submodule[] | null>(null);
  const [lfs, setLfs] = useState<LFSStatus | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [path, setPath] = useState("");
  const [branch, setBranch] = useState("");
  const [createBranch, setCreateBranch] = useState(true);

  const load = async () => {
    setError("");
    try {
      if (tab === "worktrees") setTrees(await Git.worktrees());
      else if (tab === "submodules") setSubs(await Git.submodules());
      else setLfs(await Git.lfs());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  useEffect(() => {
    void load();
  }, [tab]);

  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError("");
    try {
      await fn();
      await load();
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const addWorktree = () =>
    act(async () => {
      await Git.addWorktree(path.trim(), branch.trim(), createBranch);
      setPath("");
      setBranch("");
    });

  return (
    <Modal
      title={t("title")}
      icon="git"
      width={760}
      onClose={onClose}
      footer={
        <>
          <Button onClick={() => void load()} disabled={busy}>
            {t("refresh")}
          </Button>
          <Button variant="primary" onClick={onClose}>
            {t("close")}
          </Button>
        </>
      }
    >
      <div className="tabs repo-tabs" role="tablist">
        {(["worktrees", "submodules", "lfs"] as const).map((key) => (
          <button
            key={key}
            role="tab"
            aria-selected={tab === key}
            className={cx("tab", tab === key && "active")}
            onClick={() => setTab(key)}
          >
            {t(key)}
          </button>
        ))}
      </div>
      {error && <p className="dialog-error">{t("failed")}: {error}</p>}
      {busy && <Spinner />}

      {tab === "worktrees" && (
        <div className="repo-panel">
          {!trees && !error && <Spinner label={t("loading")} />}
          {trees?.length === 1 && <p className="setting-hint">{t("emptyWorktrees")}</p>}
          <div className="repo-list">
            {trees?.map((tree) => (
              <div className="repo-row" key={tree.path}>
                <Icon name="folder" size={14} />
                <div className="repo-row-main">
                  <span className="repo-row-title" title={tree.path}>
                    {tree.path}
                  </span>
                  <span className="muted repo-row-sub">
                    {tree.branch || tree.short}
                    {tree.detached && ` · ${t("detached")}`}
                    {tree.main && ` · ${t("main")}`}
                    {tree.locked && ` · ${t("locked")}`}
                    {tree.prunable && ` · ${t("prunable")}`}
                  </span>
                </div>
                <Button onClick={() => onOpenWorktree(tree.path)}>{t("openWindow")}</Button>
                {!tree.main && (
                  <Button variant="danger" onClick={() => void act(() => Git.removeWorktree(tree.path, false))}>
                    {t("remove")}
                  </Button>
                )}
              </div>
            ))}
          </div>
          <div className="repo-actions">
            <Button onClick={() => void act(() => Git.pruneWorktrees())}>{t("prune")}</Button>
          </div>
          <div className="dialog-form repo-add">
            <div className="repo-add-title">{t("addTitle")}</div>
            <Field label={t("path")}>
              <TextInput value={path} onChange={setPath} placeholder={t("pathPlaceholder")} />
            </Field>
            <Field label={t("branch")}>
              <TextInput value={branch} onChange={setBranch} placeholder={t("branchPlaceholder")} />
            </Field>
            <Checkbox checked={createBranch} onChange={setCreateBranch} label={t("createBranch")} />
            <Button variant="primary" onClick={() => void addWorktree()} disabled={!path.trim() || (createBranch && !branch.trim())}>
              {t("add")}
            </Button>
          </div>
        </div>
      )}

      {tab === "submodules" && (
        <div className="repo-panel">
          {!subs && !error && <Spinner label={t("loading")} />}
          {subs?.length === 0 && <p className="setting-hint">{t("subEmpty")}</p>}
          <div className="repo-list">
            {subs?.map((sub) => (
              <div className="repo-row" key={sub.path}>
                <Icon name="folder" size={14} />
                <div className="repo-row-main">
                  <span className="repo-row-title">{sub.path}</span>
                  <span className="muted repo-row-sub">
                    <code>{sub.short}</code> · {submoduleState(sub.state)}{sub.url ? ` · ${sub.url}` : ""}
                  </span>
                </div>
              </div>
            ))}
          </div>
          <div className="repo-actions">
            <Button onClick={() => void act(() => Git.updateSubmodules(true))}>{t("initUpdate")}</Button>
            <Button onClick={() => void act(() => Git.updateSubmodules(false))}>{t("update")}</Button>
          </div>
        </div>
      )}

      {tab === "lfs" && (
        <div className="repo-panel">
          {!lfs && !error && <Spinner label={t("loading")} />}
          {lfs && !lfs.installed && <p className="setting-hint">{t("lfsMissing")}</p>}
          {lfs?.installed && (
            <>
              <div className="repo-actions">
                <span className="muted">
                  {lfs.version ? `git lfs ${lfs.version}` : "git lfs"} · {t("lfsTracked", { n: lfs.files.length })}
                </span>
              </div>
              {lfs.files.length === 0 ? (
                <p className="setting-hint">{t("lfsNone")}</p>
              ) : (
                <div className="repo-list narrow">
                  {lfs.files.map((file) => (
                    <div className="repo-row" key={file.path}>
                      <Icon name="file" size={13} />
                      <span className="repo-row-title">{file.path}</span>
                      <code className="muted">{file.oid.slice(0, 10)}</code>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
          {shallow && (
            <div className="repo-actions">
              <span className="muted">{t("unshallowHint")}</span>
              <Button
                onClick={() =>
                  void act(async () => {
                    const ch = new Channel<string>();
                    const promise = Git.unshallow(ch);
                    for await (const line of ch) {
                      void line;
                    }
                    await promise;
                  })
                }
              >
                {t("unshallow")}
              </Button>
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}
