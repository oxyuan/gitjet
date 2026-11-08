import { useEffect, useState } from "react";
import { Channel } from "mygo-runtime";
import { Git } from "./mygo";
import type { Hook, LFSStatus, Shelf, Submodule, Worktree } from "./mygo";
import { Icon } from "./icons";
import { useT } from "./i18n";
import { Button, Checkbox, Field, Modal, Spinner, TextInput, cx } from "./ui";

const T = {
  en: {
    title: "Repository Tools",
    worktrees: "Worktrees",
    submodules: "Submodules",
    shelves: "Shelves",
    shelfEmpty: "No shelves",
    shelfFiles: "{n} files",
    shelfName: "Shelf name",
    shelveChanges: "Shelve changes",
    applyPatchFile: "Apply patch file…",
    lock: "Lock",
    unlock: "Unlock",
    subAddTitle: "Add a submodule",
    subUrl: "Repository URL",
    subPath: "Path in this repository",
    subBranch: "Branch (optional)",
    subAdd: "Add submodule",
    syncSubs: "Sync URLs",
    lfsPatterns: "Patterns",
    lfsTrack: "Track",
    lfsUntrack: "Untrack",
    lfsPull: "Pull objects",
    apply: "Apply",
    pop: "Apply and Drop",
    drop: "Drop",
    lfs: "Git LFS",
    hooks: "Hooks",
    hooksNone: "This repository has no hooks",
    hookRuns: "Runs",
    hookOff: "Not executable",
    hookSample: "Sample: rename it to enable",
    hookHint: "Hooks live in the git directory, outside the working tree.",
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
    shelves: "搁置",
    shelfEmpty: "没有搁置内容",
    shelfFiles: "{n} 个文件",
    shelfName: "搁置名称",
    shelveChanges: "搁置当前更改",
    applyPatchFile: "应用补丁文件…",
    lock: "锁定",
    unlock: "解锁",
    subAddTitle: "添加子模块",
    subUrl: "仓库地址",
    subPath: "在本仓库中的路径",
    subBranch: "分支（可选）",
    subAdd: "添加子模块",
    syncSubs: "同步地址",
    lfsPatterns: "匹配模式",
    lfsTrack: "跟踪",
    lfsUntrack: "取消跟踪",
    lfsPull: "拉取对象",
    apply: "应用",
    pop: "应用并删除",
    drop: "删除",
    lfs: "Git LFS",
    hooks: "钩子",
    hooksNone: "该仓库没有钩子",
    hookRuns: "会运行",
    hookOff: "没有执行权限",
    hookSample: "示例：改名后才会启用",
    hookHint: "钩子位于 git 目录，不在工作区里。",
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

type RepoTab = "worktrees" | "submodules" | "shelves" | "lfs" | "hooks";

/** submoduleState is the badge git's status prefix stands for. */
function joinPath(root: string, rel: string): string {
  if (root === "") return rel;
  return `${root.replace(/[\\/]+$/, "")}/${rel}`;
}

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
  root,
  shallow,
  onClose,
  onOpenWorktree,
  onChanged,
}: {
  tab: RepoTab;
  /** Absolute repository root, for turning submodule paths absolute. */
  root: string;
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
  const [hooks, setHooks] = useState<Hook[] | null>(null);
  const [shelves, setShelves] = useState<Shelf[] | null>(null);
  const [shelfName, setShelfName] = useState("");
  const [subUrl, setSubUrl] = useState("");
  const [subPath, setSubPath] = useState("");
  const [subBranch, setSubBranch] = useState("");
  const [lfsPattern, setLfsPattern] = useState("");
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
      else if (tab === "shelves") setShelves(await Git.shelves());
      else if (tab === "hooks") setHooks(await Git.hooks());
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
        {(["worktrees", "submodules", "shelves", "lfs", "hooks"] as const).map((key) => (
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
                {tree.locked ? (
                  <Button onClick={() => void act(() => Git.unlockWorktree(tree.path))}>{t("unlock")}</Button>
                ) : (
                  <Button onClick={() => void act(() => Git.lockWorktree(tree.path, ""))}>{t("lock")}</Button>
                )}
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
                <Button onClick={() => onOpenWorktree(joinPath(root, sub.path))}>{t("openWindow")}</Button>
              </div>
            ))}
          </div>
          <div className="repo-actions">
            <Button onClick={() => void act(() => Git.updateSubmodules(true))}>{t("initUpdate")}</Button>
            <Button onClick={() => void act(() => Git.updateSubmodules(false))}>{t("update")}</Button>
            <Button onClick={() => void act(() => Git.syncSubmodules())}>{t("syncSubs")}</Button>
          </div>
          <div className="dialog-form repo-add">
            <div className="repo-add-title">{t("subAddTitle")}</div>
            <Field label={t("subUrl")}>
              <TextInput value={subUrl} onChange={setSubUrl} placeholder="https://host/lib.git" />
            </Field>
            <Field label={t("subPath")}>
              <TextInput value={subPath} onChange={setSubPath} placeholder="vendor/lib" />
            </Field>
            <Field label={t("subBranch")}>
              <TextInput value={subBranch} onChange={setSubBranch} placeholder="main" />
            </Field>
            <Button
              variant="primary"
              disabled={!subUrl.trim() || !subPath.trim()}
              onClick={() =>
                void act(async () => {
                  await Git.addSubmodule(subUrl.trim(), subPath.trim(), subBranch.trim());
                  setSubUrl("");
                  setSubPath("");
                  setSubBranch("");
                })
              }
            >
              {t("subAdd")}
            </Button>
          </div>
        </div>
      )}

      {tab === "shelves" && (
        <div className="repo-panel">
          {!shelves && !error && <Spinner label={t("loading")} />}
          {shelves?.length === 0 && <p className="setting-hint">{t("shelfEmpty")}</p>}
          <div className="repo-list">
            {shelves?.map((shelf) => (
              <div className="repo-row" key={shelf.name}>
                <Icon name="stash" size={14} />
                <div className="repo-row-main">
                  <span className="repo-row-title">{shelf.name}</span>
                  <span className="muted repo-row-sub">
                    {t("shelfFiles", { n: shelf.files })}
                    {shelf.preview ? ` · ${shelf.preview}` : ""}
                  </span>
                </div>
                <Button onClick={() => void act(() => Git.applyShelf(shelf.name, false))}>{t("apply")}</Button>
                <Button onClick={() => void act(() => Git.applyShelf(shelf.name, true))}>{t("pop")}</Button>
                <Button variant="danger" onClick={() => void act(() => Git.dropShelf(shelf.name))}>
                  {t("drop")}
                </Button>
              </div>
            ))}
          </div>
          <div className="dialog-form repo-add">
            <div className="repo-add-title">{t("shelveChanges")}</div>
            <Field label={t("shelfName")}>
              <TextInput value={shelfName} onChange={setShelfName} placeholder="work in progress" />
            </Field>
            <div className="repo-actions">
              <Button
                variant="primary"
                disabled={!shelfName.trim()}
                onClick={() =>
                  void act(async () => {
                    await Git.saveShelf(shelfName.trim(), {
                      paths: [],
                      staged: false,
                      revision: "",
                      from: "",
                    });
                    setShelfName("");
                  })
                }
              >
                {t("shelveChanges")}
              </Button>
              <Button onClick={() => void act(() => Git.applyPatchFile(false))}>{t("applyPatchFile")}</Button>
            </div>
          </div>
        </div>
      )}

      {tab === "hooks" && (
        <div className="repo-panel">
          {!hooks && !error && <Spinner label={t("loading")} />}
          {hooks?.length === 0 && <p className="setting-hint">{t("hooksNone")}</p>}
          {hooks && hooks.length > 0 && (
            <>
              <p className="setting-hint">{t("hookHint")}</p>
              <div className="repo-list narrow">
                {hooks.map((hook) => (
                  <div className="repo-row" key={hook.path}>
                    <Icon name={hook.sample ? "file" : "check"} size={13} />
                    <div className="repo-row-main">
                      <span className="repo-row-title" title={hook.path}>
                        {hook.name}
                      </span>
                      <span className="muted repo-row-sub">{hook.path}</span>
                    </div>
                    <span className={cx("muted", hook.executable && !hook.sample && "hook-live")}>
                      {hook.sample ? t("hookSample") : hook.executable ? t("hookRuns") : t("hookOff")}
                    </span>
                  </div>
                ))}
              </div>
            </>
          )}
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
                <Button
                  onClick={() =>
                    void act(async () => {
                      const channel = new Channel<string>();
                      const promise = Git.lfsPull(channel);
                      for await (const line of channel) {
                        void line;
                      }
                      await promise;
                    })
                  }
                >
                  {t("lfsPull")}
                </Button>
              </div>
              <div className="dialog-form repo-add">
                <div className="repo-add-title">{t("lfsPatterns")}</div>
                <TextInput value={lfsPattern} onChange={setLfsPattern} placeholder="*.psd" />
                <div className="repo-actions">
                  <Button
                    disabled={!lfsPattern.trim()}
                    onClick={() =>
                      void act(async () => {
                        await Git.lfsTrack([lfsPattern.trim()]);
                        setLfsPattern("");
                      })
                    }
                  >
                    {t("lfsTrack")}
                  </Button>
                  <Button
                    disabled={!lfsPattern.trim()}
                    onClick={() =>
                      void act(async () => {
                        await Git.lfsUntrack([lfsPattern.trim()]);
                        setLfsPattern("");
                      })
                    }
                  >
                    {t("lfsUntrack")}
                  </Button>
                </div>
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
