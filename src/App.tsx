import { useCallback, useEffect, useRef, useState } from "react";
import { Channel } from "mygo-runtime";
import {
  Git,
  Workspace,
  events,
  type Bootstrap,
  type ChangesSnapshot,
  type Commit,
  type CommitDetail,
  type CommitFile,
  type ConflictContent,
  type DiffOptions,
  type FileDiff,
  type LogResult,
  type PushOptions,
  type RefsSnapshot,
  type Remote,
  type RepoState,
  type Settings,
} from "./mygo";
import { BranchPopup } from "./BranchPopup";
import { CommitPanel, type CommitActions, type CommitForm, type FileEntry } from "./CommitPanel";
import { ConflictView } from "./ConflictView";
import { ConsolePanel } from "./ConsolePanel";
import { DiffView, BlameView } from "./DiffView";
import {
  ChangelistDialog,
  FetchDialog,
  MergeDialog,
  NewBranchDialog,
  OperationDialog,
  PullDialog,
  PushDialog,
  ResetDialog,
  SettingsDialog,
  StashDialog,
  TagDialog,
} from "./Dialogs";
import { Icon } from "./icons";
import { LogPanel, type LogBranchFilter } from "./LogPanel";
import {
  Button,
  ConfirmDialog,
  cx,
  formatWhen,
  IconButton,
  Spinner,
  Splitter,
  StatusMark,
  Toast,
  useStoredState,
} from "./ui";
import type { BlameResult } from "./mygo";

type Tab = "commit" | "log" | "console";

type RightView =
  | { kind: "welcome" }
  | { kind: "loading"; title: string }
  | { kind: "diff"; diff: FileDiff; opts: DiffOptions; title: string }
  | { kind: "conflict"; path: string; content: ConflictContent }
  | { kind: "blame"; path: string; data: BlameResult }
  | { kind: "commit"; detail: CommitDetail }
  | { kind: "message"; title: string; text: string; tone?: "error" | "info" };

type Dialog =
  | { kind: "settings" }
  | { kind: "newBranch"; start: string }
  | { kind: "renameBranch"; name: string }
  | { kind: "push"; setUpstream: boolean }
  | { kind: "pull" }
  | { kind: "fetch" }
  | { kind: "reset"; hash: string; subject: string }
  | { kind: "tag"; start: string }
  | { kind: "stash" }
  | { kind: "changelist"; mode: "new" | "rename"; id?: string; name?: string; comment?: string }
  | { kind: "merge"; refs: string[] }
  | { kind: "operation"; op: OperationState };

interface OperationState {
  title: string;
  icon: "fetch" | "pull" | "push" | "commit" | "stash" | "reset" | "merge";
  lines: string[];
  running: boolean;
  error?: string;
  success?: string;
}

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
  const [boot, setBoot] = useState<Bootstrap | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [snapshot, setSnapshot] = useState<ChangesSnapshot | null>(null);
  const [refs, setRefs] = useState<RefsSnapshot | null>(null);
  const [remotes, setRemotes] = useState<Remote[]>([]);
  const [tab, setTab] = useStoredState<Tab>("gitjet.tab", "commit");
  const [right, setRight] = useState<RightView>({ kind: "welcome" });
  const [busy, setBusy] = useState(0);
  const [toast, setToast] = useState<{ kind: "info" | "success" | "error"; title: string; message?: string } | null>(null);
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);
  const [branchPopup, setBranchPopup] = useState<{ x: number; y: number } | null>(null);
  const [splitWidth, setSplitWidth] = useStoredState<number>("gitjet.split", 430);
  const [diffMode, setDiffMode] = useStoredState<"split" | "unified">("gitjet.diffMode", "split");
  const [ignoreWhitespace, setIgnoreWhitespace] = useState(false);
  const [form, setForm] = useState<CommitForm>(emptyForm);
  const [history, setHistory] = useState<string[]>([]);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [logFilter, setLogFilter] = useState<LogBranchFilter>("current");
  const [searchInput, setSearchInput] = useState("");
  const [logSearch, setLogSearch] = useState("");
  const [logPath, setLogPath] = useState("");
  const [logResult, setLogResult] = useState<LogResult | null>(null);
  const [logDetail, setLogDetail] = useState<CommitDetail | null>(null);
  const [logLoading, setLogLoading] = useState(false);
  const [selectedCommit, setSelectedCommit] = useState<string | null>(null);
  const [diffBusy, setDiffBusy] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  const knownPaths = useRef<Set<string>>(new Set());
  const settingsRef = useRef<Settings | null>(null);
  const snapshotRef = useRef<ChangesSnapshot | null>(null);
  const rightRef = useRef<RightView>({ kind: "welcome" });
  const repoOpenRef = useRef(false);
  const refreshRef = useRef<(() => void) | null>(null);
  const amendBackup = useRef("");
  const logReq = useRef(0);
  const opLines = useRef<string[]>([]);

  const repoOpen = !!snapshot;
  const branch = snapshot?.state.branch ?? "";
  const state = snapshot?.state;

  settingsRef.current = settings;
  snapshotRef.current = snapshot;
  rightRef.current = right;

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
          all: logFilter === "all",
          refs: logFilter === "all" ? [] : logFilter === "current" ? [current.state.branch || "HEAD"] : [logFilter],
          path: logPath,
          search: logSearch,
          author: "",
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
        if (reset && !append) {
          setSelectedCommit(null);
          setLogDetail(null);
        }
        if (s) void s;
      } catch (err) {
        fail("Could not read the log", err);
      } finally {
        if (req === logReq.current) setLogLoading(false);
      }
    },
    [fail, logFilter, logPath, logSearch, logResult?.commits.length],
  );

  const loadCommitDetail = useCallback(
    async (hash: string) => {
      try {
        const detail = await Git.showCommit(hash);
        setLogDetail(detail);
      } catch (err) {
        fail("Could not read the commit", err);
      }
    },
    [fail],
  );

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
        const view = rightRef.current;
        if (view.kind === "diff" && (view.opts.target === "worktree" || view.opts.target === "staged")) {
          setDiffBusy(true);
          Git.diff(view.opts)
            .then((diff) => setRight({ ...view, diff }))
            .catch(() => {})
            .finally(() => setDiffBusy(false));
        }
        if (selectedCommit) void loadCommitDetail(selectedCommit);
        setReloadKey((k) => k + 1);
      } catch (err) {
        fail("Could not refresh the repository", err);
      } finally {
        if (spinner) setBusy((n) => n - 1);
      }
    },
    [applyCheckedDefaults, fail, loadCommitDetail, selectedCommit],
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
        if (b.error) notify("error", "Could not reopen the last repository", b.error);
      })
      .catch((err) => {
        setBoot({ settings: { gitPath: "", theme: "system", diffContext: 3, ignoreWhitespace: false, showIgnored: false, autoFetch: false, autoFetchMinutes: 15, updateMethod: "merge", confirmForcePush: true, confirmRollback: true, recent: [] }, repo: null, error: String(err), version: "", platform: "" });
        notify("error", "GitJet could not start", err instanceof Error ? err.message : String(err));
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

  // Debounce the log's search box.
  useEffect(() => {
    const t = window.setTimeout(() => setLogSearch(searchInput), 250);
    return () => window.clearTimeout(t);
  }, [searchInput]);

  // Load the log when its tab is visible or its filters change.
  useEffect(() => {
    if (tab !== "log" || !snapshot) return;
    void loadLog(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, logFilter, logSearch, logPath, snapshot?.state.head]);

  useEffect(() => {
    if (!snapshot) return;
    document.title = `${snapshot.state.name || "Repository"} – GitJet`;
  }, [snapshot?.state.name]);

  function applyTheme(s: Settings) {
    document.documentElement.dataset.theme = s.theme;
    setIgnoreWhitespace(s.ignoreWhitespace);
  }

  const selectedCommitRef = useRef(selectedCommit);
  selectedCommitRef.current = selectedCommit;

  const openRepo = async (path?: string) => {
    setBusy((n) => n + 1);
    try {
      const chosen = path && path.trim() !== "" ? path : await Workspace.chooseFolder();
      if (!chosen) return;
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
      setRight({ kind: "welcome" });
      setForm(emptyForm);
      setLogResult(null);
      setLogDetail(null);
      setSelectedCommit(null);
      setLogPath("");
      setSearchInput("");
      setLogSearch("");
      setFilterDefault(snap.state);
      setHistory(await Git.messageHistory().catch(() => []));
      void reload(false);
      void loadLog(true);
    } catch (err) {
      fail("Could not open the repository", err);
    } finally {
      setBusy((n) => n - 1);
    }
  };

  const setFilterDefault = (st: RepoState) => {
    setLogFilter("current");
    if (st.branch === "") setLogFilter("all");
  };

  const closeRepo = async () => {
    const ok = await ask({
      title: "Close Repository",
      message: "Close this repository and return to the welcome screen?",
      confirmLabel: "Close",
    });
    if (!ok) return;
    await Workspace.close();
    repoOpenRef.current = false;
    snapshotRef.current = null;
    setSnapshot(null);
    setRefs(null);
    setRight({ kind: "welcome" });
    knownPaths.current = new Set();
    setChecked(new Set());
    document.title = "GitJet";
  };

  const showDiff = async (opts: DiffOptions, title: string) => {
    setRight({ kind: "loading", title });
    setDiffBusy(true);
    try {
      const diff = await Git.diff(opts);
      setRight({ kind: "diff", diff, opts, title });
    } catch (err) {
      setRight({ kind: "message", title: "Could not show the diff", text: err instanceof Error ? err.message : String(err), tone: "error" });
    } finally {
      setDiffBusy(false);
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

  const openConflict = async (path: string) => {
    setRight({ kind: "loading", title: `Resolving ${path}` });
    try {
      const content = await Git.conflict(path);
      setRight({ kind: "conflict", path, content });
    } catch (err) {
      fail("Could not open the conflict", err);
    }
  };

  const openStash = async (index: number) => {
    try {
      const detail = await Git.showCommit(`stash@{${index}}`);
      setRight({ kind: "commit", detail });
    } catch (err) {
      fail("Could not read the stash", err);
    }
  };

  const openBlame = async (path: string) => {
    setRight({ kind: "loading", title: `Annotating ${path}` });
    try {
      const data = await Git.blame(path);
      setRight({ kind: "blame", path, data });
    } catch (err) {
      fail("Could not annotate the file", err);
    }
  };

  const toggleWhitespace = () => {
    const next = !ignoreWhitespace;
    setIgnoreWhitespace(next);
    const view = rightRef.current;
    if (view.kind === "diff") {
      void showDiff({ ...view.opts, ignoreWhitespace: next }, view.title);
    }
  };

  const copyText = (text: string) => {
    void Workspace.copy(text).catch((err) => fail("Could not copy", err));
  };

  const withBusy = async <T,>(fn: () => Promise<T>, label = "Git command failed"): Promise<T | undefined> => {
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
        title: "Rollback Changes",
        message: `Discard local changes to ${paths.length} file${paths.length === 1 ? "" : "s"}?`,
        detail: "The files are restored from HEAD. This cannot be undone.",
        confirmLabel: "Rollback",
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
      title: "Delete Files",
      message: `Delete ${paths.length} untracked file${paths.length === 1 ? "" : "s"}?`,
      detail: "The files are removed from disk. This cannot be undone.",
      confirmLabel: "Delete",
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
      notify("success", "Added to .gitignore", file);
      await reload(false);
    });

  const applyHunk = (opts: DiffOptions, hunk: number, action: "stage" | "unstage" | "rollback") =>
    withBusy(async () => {
      await Git.applyHunk(opts, hunk, action);
      await reload(false);
      const diff = await Git.diff(opts);
      setRight({ kind: "diff", diff, opts, title: opts.path });
    });

  const applyFile = async (opts: DiffOptions, action: "stage" | "unstage" | "rollback") => {
    if (action === "rollback") {
      const ok = await ask({
        title: "Rollback File",
        message: `Discard all changes to ${opts.path}?`,
        confirmLabel: "Rollback",
        danger: true,
      });
      if (!ok) return;
    }
    await withBusy(async () => {
      await Git.applyFile(opts, action);
      await reload(false);
      try {
        const diff = await Git.diff(opts);
        setRight({ kind: "diff", diff, opts, title: opts.path });
      } catch {
        setRight({ kind: "welcome" });
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
      notify("error", "Nothing to commit", "Check at least one file in the commit panel.");
      return;
    }
    if (form.message.trim() === "" && !form.amend) {
      notify("error", "A commit needs a message");
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
    }, "Commit failed");
    if (!ok) return;
    notify("success", `Committed ${ok.short}`, ok.subject);
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
        fail("Could not read the last commit message", err);
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
    const update = (patch: Partial<OperationState>) => {
      setDialog((d) =>
        d && d.kind === "operation"
          ? { kind: "operation", op: { ...d.op, ...patch, lines: [...opLines.current] } }
          : d,
      );
    };
    setDialog({
      kind: "operation",
      op: { title, icon, lines: [], running: true },
    });
    const channel = new Channel<string>();
    try {
      const promise = fn(channel);
      for await (const line of channel) {
        opLines.current.push(line);
        if (opLines.current.length > 2000) opLines.current.splice(0, opLines.current.length - 2000);
        update({ lines: opLines.current });
      }
      const out = await promise;
      const first = out
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean)
        .pop();
      update({ running: false, success: first || "Done" });
    } catch (err) {
      update({ running: false, error: err instanceof Error ? err.message : String(err) });
    }
    await reload(false);
    void loadLog(true);
  };

  const push = (opts: PushOptions) => {
    setDialog(null);
    void runOperation("Push", "push", (ch) => Git.push(opts, ch));
  };

  const pull = (opts: Parameters<typeof Git.pull>[0]) => {
    setDialog(null);
    void runOperation("Update Project", "pull", (ch) => Git.pull(opts, ch));
  };

  const fetch = (opts: Parameters<typeof Git.fetch>[0]) => {
    setDialog(null);
    void runOperation("Fetch", "fetch", (ch) => Git.fetch(opts, ch));
  };

  const checkout = async (ref: string) => {
    const out = await withBusy(() => Git.checkout(ref));
    if (out !== undefined) {
      notify("success", "Checked out", ref);
      await reload(false);
      void loadLog(true);
    }
  };

  const deleteBranch = async (name: string) => {
    const isCurrent = name === branch;
    const ok = await ask({
      title: isCurrent ? "Delete Current Branch" : "Delete Branch",
      message: `Delete branch “${name}”?`,
      detail: isCurrent ? "You are on this branch. Git will refuse to delete the checked out branch." : undefined,
      confirmLabel: "Delete",
      danger: true,
    });
    if (!ok) return;
    try {
      await Git.deleteBranch(name, false);
      notify("success", "Branch deleted", name);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (/not fully merged/i.test(message)) {
        const force = await ask({
          title: "Branch Not Merged",
          message: `“${name}” has commits that are not merged. Delete it anyway?`,
          detail: message,
          confirmLabel: "Force Delete",
          danger: true,
        });
        if (!force) return;
        await withBusy(() => Git.deleteBranch(name, true));
      } else {
        fail("Could not delete the branch", err);
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
        title: "Hard Reset",
        message: "Discard every local change and move the branch?",
        detail: "This cannot be undone.",
        confirmLabel: "Reset Hard",
        danger: true,
      });
      if (!ok) return;
    }
    await withBusy(async () => {
      await Git.reset(hash, mode);
      notify("success", `Branch reset (${mode})`);
      await reload(false);
      void loadLog(true);
    });
  };

  const merge = async (ref: string, opts: Parameters<typeof Git.merge>[1]) => {
    setDialog(null);
    await withBusy(async () => {
      const out = await Git.merge(ref, opts);
      notify("success", "Merged", out.split("\n")[0]);
      await reload(false);
      void loadLog(true);
    });
  };

  const rebase = async (onto: string) => {
    const ok = await ask({
      title: "Rebase Branch",
      message: `Rebase “${branch || "HEAD"}” onto “${onto}”?`,
      detail: "Local commits are replayed on top of that branch.",
      confirmLabel: "Rebase",
    });
    if (!ok) return;
    await withBusy(async () => {
      await Git.rebase(onto, true);
      notify("success", "Rebase finished");
      await reload(false);
      void loadLog(true);
    });
  };

  const cherryPick = async (hash: string) => {
    await withBusy(async () => {
      const out = await Git.cherryPick(hash, false);
      notify("success", "Cherry-picked", out.split("\n")[0]);
      await reload(false);
      void loadLog(true);
    });
  };

  const revert = async (hash: string) => {
    const ok = await ask({
      title: "Revert Commit",
      message: `Create a commit that undoes ${hash.slice(0, 8)}?`,
      confirmLabel: "Revert",
    });
    if (!ok) return;
    await withBusy(async () => {
      await Git.revert(hash);
      notify("success", "Reverted", hash.slice(0, 8));
      await reload(false);
      void loadLog(true);
    });
  };

  const createTag = async (opts: { name: string; message: string; revision: string; force: boolean }) => {
    setDialog(null);
    await withBusy(async () => {
      await Git.createTag(opts);
      notify("success", "Tag created", opts.name);
      await reload(false);
    });
  };

  const stashPush = (opts: { message: string; includeUntracked: boolean; keepIndex: boolean }) => {
    setDialog(null);
    void withBusy(async () => {
      await Git.stashPush({ ...opts, paths: [] });
      notify("success", "Changes stashed");
      await reload(false);
    });
  };

  const stashApply = async (index: number, pop: boolean) => {
    await withBusy(async () => {
      await Git.stashApply(index, pop);
      notify("success", pop ? "Stash popped" : "Stash applied");
      await reload(false);
    });
  };

  const stashDrop = async (index: number) => {
    const ok = await ask({
      title: "Drop Stash",
      message: `Delete stash@{${index}}?`,
      confirmLabel: "Drop",
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
      notify("success", "Operation continued", out.split("\n")[0]);
      await reload(false);
    });
  };

  const abortOperation = async () => {
    const ok = await ask({
      title: "Abort Operation",
      message: `Abort the ${state?.operation || "current"} operation and restore the previous state?`,
      confirmLabel: "Abort",
      danger: true,
    });
    if (!ok) return;
    await withBusy(async () => {
      await Git.abortOperation();
      notify("success", "Operation aborted");
      await reload(false);
    });
  };

  const handleCommand = useCallback(
    (cmd: string) => {
      switch (cmd) {
        case "open":
          void openRepo();
          break;
        case "close":
          void closeRepo();
          break;
        case "refresh":
          void reload(true);
          if (tab === "log") void loadLog(true);
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
          if (repoOpen) setDialog({ kind: "fetch" });
          break;
        case "stash":
          if (repoOpen) setDialog({ kind: "stash" });
          break;
        case "branches":
          openBranchPopupFromStatus();
          break;
        case "tab:commit":
          setTab("commit");
          break;
        case "tab:log":
          setTab("log");
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

  const openBranchPopupFromStatus = () => {
    const el = document.querySelector<HTMLElement>("#branch-widget");
    if (!el) return;
    const rect = el.getBoundingClientRect();
    setBranchPopup({ x: rect.left, y: rect.top });
  };

  const selectCommit = (commit: Commit) => {
    setSelectedCommit(commit.hash);
    void loadCommitDetail(commit.hash);
  };

  const openCommitFile = (hash: string, file: CommitFile) => {
    void showDiff(
      {
        path: file.path,
        oldPath: file.oldPath ?? "",
        target: "commit",
        revision: hash,
        from: "",
        context: settings?.diffContext ?? 3,
        ignoreWhitespace,
        ignoreWhitespaceEol: false,
        noText: false,
      },
      file.path,
    );
  };

  const showFileHistory = (path: string) => {
    setLogPath(path);
    setTab("log");
    setSelectedCommit(null);
    setLogDetail(null);
  };

  const actions: CommitActions = {
    onRefresh: () => void reload(true),
    onShowDiff: openEntryDiff,
    onShowConflict: (path) => void openConflict(path),
    onShowHistory: showFileHistory,
    onStage: (paths) => void stage(paths),
    onUnstage: (paths) => void unstage(paths),
    onRollback: (paths) => void rollback(paths),
    onDelete: (paths) => void deleteUntracked(paths),
    onIgnore: (paths) => void ignorePaths(paths),
    onReveal: (path) => void Workspace.reveal(path).catch((err) => fail("Could not reveal the file", err)),
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
        title: "Delete Changelist",
        message: `Delete “${cl?.name ?? id}”? Its files move to the default changelist.`,
        confirmLabel: "Delete",
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
        notify("success", side === "ours" ? "Took ours" : "Took theirs", path);
        await reload(false);
        setRight({ kind: "welcome" });
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
      notify("success", "Settings saved");
      await reload(false);
    } catch (err) {
      fail("Could not save settings", err);
    }
  };

  const operationDone = () => {
    setDialog((d) => (d && d.kind === "operation" && !d.op.running ? null : d));
  };

  if (!boot || !settings) {
    return (
      <div className="boot-screen">
        <Icon name="git" size={28} />
        <Spinner label="Starting GitJet" />
      </div>
    );
  }

  const tabHeader = (
    <div className="toolwindow-tabs">
      <button className={cx("toolwindow-tab", tab === "commit" && "active")} onClick={() => setTab("commit")}>
        <Icon name="commit" />
        Commit
        {snapshot && snapshot.state.changed + snapshot.state.untracked + snapshot.state.conflicts > 0 && (
          <span className="tab-count">{snapshot.state.changed + snapshot.state.untracked + snapshot.state.conflicts}</span>
        )}
      </button>
      <button className={cx("toolwindow-tab", tab === "log" && "active")} onClick={() => setTab("log")}>
        <Icon name="log" />
        Log
      </button>
      <button className={cx("toolwindow-tab", tab === "console" && "active")} onClick={() => setTab("console")}>
        <Icon name="console" />
        Console
      </button>
    </div>
  );

  return (
    <div className="app">
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
          <IconButton icon="open" title="Open Repository (⌘/Ctrl+O)" onClick={() => void openRepo()} />
          <span className="toolbar-sep" />
          <IconButton icon="refresh" title="Refresh (⌘/Ctrl+R)" onClick={() => void reload(true)} spinner={busy > 0} />
          <IconButton icon="fetch" title="Fetch" onClick={() => setDialog({ kind: "fetch" })} disabled={!repoOpen} />
          <IconButton icon="pull" title="Update Project (⌘/Ctrl+T)" onClick={() => setDialog({ kind: "pull" })} disabled={!repoOpen} />
          <IconButton icon="push" title="Push (⌘/Ctrl+Shift+K)" onClick={() => setDialog({ kind: "push", setUpstream: !snapshot?.state.upstream })} disabled={!repoOpen} />
          <button
            className="branch-button"
            onClick={openBranchPopupFromStatus}
            disabled={!repoOpen}
            title="Branches"
          >
            <Icon name="branch" />
            <span>{state ? (state.detached ? `detached at ${state.shortHead}` : state.unborn ? "(no commits)" : state.branch) : "No repository"}</span>
            {state && (state.ahead > 0 || state.behind > 0) && (
              <span className="sync">
                {state.ahead > 0 && <span className="ahead">↑{state.ahead}</span>}
                {state.behind > 0 && <span className="behind">↓{state.behind}</span>}
              </span>
            )}
            <Icon name="chevronDown" size={12} />
          </button>
          <span className="spacer" />
          <IconButton icon="settings" title="Settings (⌘/Ctrl+,)" onClick={() => setDialog({ kind: "settings" })} />
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
                />
              ) : (
                <NoRepo onOpen={() => void openRepo()} />
              ))}
            {tab === "log" &&
              (snapshot ? (
                <LogPanel
                  result={logResult}
                  detail={logDetail}
                  refs={refs}
                  loading={logLoading}
                  selected={selectedCommit}
                  filter={logFilter}
                  search={searchInput}
                  onFilter={(f) => {
                    setLogFilter(f);
                    setSelectedCommit(null);
                    setLogDetail(null);
                  }}
                  onSearch={setSearchInput}
                  onSelect={selectCommit}
                  onRefresh={() => void loadLog(true)}
                  onFetch={() => setDialog({ kind: "fetch" })}
                  onLoadMore={() => void loadLog(false, true)}
                  onCheckout={(ref) => void checkout(ref)}
                  onNewBranch={(start) => setDialog({ kind: "newBranch", start })}
                  onNewTag={(start) => setDialog({ kind: "tag", start })}
                  onCherryPick={(hash) => void cherryPick(hash)}
                  onRevert={(hash) => void revert(hash)}
                  onReset={(hash) => {
                    const commit = logResult?.commits.find((c) => c.hash === hash);
                    setDialog({ kind: "reset", hash, subject: commit?.subject ?? "" });
                  }}
                  onCopy={copyText}
                  onOpenFile={openCommitFile}
                  onShowFileHistory={showFileHistory}
                />
              ) : (
                <NoRepo onOpen={() => void openRepo()} />
              ))}
            {tab === "console" && <ConsolePanel onCommandDone={() => void reload(false)} repoOpen={repoOpen} />}
          </div>
          {logPath && tab === "log" && (
            <div className="history-banner">
              <Icon name="log" />
              <span>History of {logPath}</span>
              <button
                className="mini-btn"
                onClick={() => {
                  setLogPath("");
                  setSelectedCommit(null);
                  setLogDetail(null);
                }}
              >
                Clear
              </button>
            </div>
          )}
        </aside>
        <Splitter width={splitWidth} setWidth={setSplitWidth} />
        <main className="editor-area">
          <RightPane
            view={right}
            diffMode={diffMode}
            setDiffMode={setDiffMode}
            ignoreWhitespace={ignoreWhitespace}
            onToggleWhitespace={toggleWhitespace}
            onApplyHunk={(hunk, action) => {
              if (right.kind === "diff") void applyHunk(right.opts, hunk, action);
            }}
            onApplyFile={(action) => {
              if (right.kind === "diff") void applyFile(right.opts, action);
            }}
            onBlame={(path) => void openBlame(path)}
            onCopyPath={copyText}
            busy={diffBusy}
            reloadKey={reloadKey}
            onClose={() => setRight({ kind: "welcome" })}
            onOpenFile={openCommitFile}
            onShowFileHistory={showFileHistory}
            onSaveConflict={async (path, content) => {
              await withBusy(async () => {
                await Git.saveResolution(path, content);
                notify("success", "Conflict resolved", path);
                await reload(false);
                setRight({ kind: "welcome" });
              });
            }}
            onTakeSide={async (path, side) => {
              await withBusy(async () => {
                await Git.takeSide(path, side);
                notify("success", side === "ours" ? "Took ours" : "Took theirs", path);
                await reload(false);
                setRight({ kind: "welcome" });
              });
            }}
            onMarkResolved={async (path) => {
              await withBusy(async () => {
                await Git.markResolved([path]);
                notify("success", "Marked resolved", path);
                await reload(false);
                setRight({ kind: "welcome" });
              });
            }}
            onOpenRecent={(path) => void openRepo(path)}
            onRemoveRecent={async (path) => {
              await Workspace.removeRecent(path);
              setBoot({ ...boot, settings: { ...settings, recent: settings.recent.filter((r) => r.path !== path) } });
            }}
            recent={settings.recent}
          />
        </main>
      </div>
      <footer className="statusbar">
        <button className="status-branch" id="branch-widget" onClick={openBranchPopupFromStatus} disabled={!repoOpen}>
          <Icon name="branch" size={13} />
          <span>{state ? (state.detached ? "Detached HEAD" : state.unborn ? "No commits yet" : state.branch) : "No repository"}</span>
          {state && state.upstream && <span className="status-upstream">{state.upstream}</span>}
        </button>
        {state && (state.ahead > 0 || state.behind > 0) && (
          <span className="status-sync">
            {state.ahead > 0 && <span className="ahead">↑ {state.ahead}</span>}
            {state.behind > 0 && <span className="behind">↓ {state.behind}</span>}
          </span>
        )}
        {state?.operation && (
          <span className="status-operation">
            <Icon name="warning" size={12} />
            <span className="op-name">{operationLabel(state.operation)}</span>
            {state.opProgress && <span className="op-progress">{state.opProgress}</span>}
            {state.opDetail && <span className="op-detail">{state.opDetail}</span>}
            <button className="mini-btn" onClick={() => void continueOperation()}>
              Continue
            </button>
            <button className="mini-btn danger" onClick={() => void abortOperation()}>
              Abort
            </button>
          </span>
        )}
        {state?.conflicts ? (
          <span className="status-conflicts">
            <Icon name="warning" size={12} /> {state.conflicts} conflict{state.conflicts === 1 ? "" : "s"}
          </span>
        ) : null}
        <span className="spacer" />
        {snapshot && (
          <>
            <span className="status-item">{snapshot.state.changed} changed</span>
            {snapshot.state.staged > 0 && <span className="status-item">{snapshot.state.staged} staged</span>}
            {snapshot.state.untracked > 0 && <span className="status-item">{snapshot.state.untracked} untracked</span>}
            <span className="status-item status-path" title={snapshot.state.root}>
              {snapshot.state.root}
            </span>
          </>
        )}
        <span className="status-item">git {snapshot?.state.gitVersion || boot.version}</span>
      </footer>

      {branchPopup && refs && (
        <BranchPopup
          refs={refs}
          current={refs.current}
          detached={refs.detached}
          x={branchPopup.x}
          y={branchPopup.y}
          onClose={() => setBranchPopup(null)}
          onCheckout={(name) => void checkout(name)}
          onNewBranch={() => setDialog({ kind: "newBranch", start: "" })}
          onMerge={(name) => setDialog({ kind: "merge", refs: [name] })}
          onRebase={(name) => void rebase(name)}
          onDelete={(name) => void deleteBranch(name)}
          onFetch={() => setDialog({ kind: "fetch" })}
          onPull={() => setDialog({ kind: "pull" })}
          onPush={() => setDialog({ kind: "push", setUpstream: !snapshot?.state.upstream })}
          onFilterLog={(name) => {
            setLogFilter(name);
            setTab("log");
            setSelectedCommit(null);
            setLogDetail(null);
          }}
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
              notify("success", "Branch created", name);
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
          onSubmit={push}
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
      {dialog?.kind === "fetch" && (
        <FetchDialog remotes={remotes} onClose={() => setDialog(null)} onSubmit={fetch} />
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
      {dialog?.kind === "operation" && (
        <OperationDialog
          title={dialog.op.title}
          icon={dialog.op.icon}
          lines={dialog.op.lines}
          running={dialog.op.running}
          error={dialog.op.error}
          success={dialog.op.success}
          onClose={operationDone}
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
      {toast && <Toast kind={toast.kind} title={toast.title} message={toast.message} onClose={() => setToast(null)} />}
    </div>
  );
}

function operationLabel(op: string): string {
  switch (op) {
    case "merge":
      return "Merging";
    case "rebase":
      return "Rebasing";
    case "rebase-interactive":
      return "Interactive rebase";
    case "cherry-pick":
      return "Cherry-picking";
    case "revert":
      return "Reverting";
    case "am":
      return "Applying patches";
    case "bisect":
      return "Bisecting";
    default:
      return op;
  }
}

function noRepoMessage() {
  return "Open a Git repository to get started.";
}

function NoRepo({ onOpen }: { onOpen: () => void }) {
  return (
    <div className="no-repo">
      <Icon name="git" size={26} />
      <div>{noRepoMessage()}</div>
      <Button variant="primary" onClick={onOpen}>
        Open Repository…
      </Button>
    </div>
  );
}

function RightPane({
  view,
  diffMode,
  setDiffMode,
  ignoreWhitespace,
  onToggleWhitespace,
  onApplyHunk,
  onApplyFile,
  onBlame,
  onCopyPath,
  busy,
  reloadKey,
  onClose,
  onOpenFile,
  onShowFileHistory,
  onSaveConflict,
  onTakeSide,
  onMarkResolved,
  onOpenRecent,
  onRemoveRecent,
  recent,
}: {
  view: RightView;
  diffMode: "split" | "unified";
  setDiffMode: (m: "split" | "unified") => void;
  ignoreWhitespace: boolean;
  onToggleWhitespace: () => void;
  onApplyHunk: (hunk: number, action: "stage" | "unstage" | "rollback") => void;
  onApplyFile: (action: "stage" | "unstage" | "rollback") => void;
  onBlame: (path: string) => void;
  onCopyPath: (text: string) => void;
  busy: boolean;
  reloadKey: number;
  onClose: () => void;
  onOpenFile: (hash: string, file: CommitFile) => void;
  onShowFileHistory: (path: string) => void;
  onSaveConflict: (path: string, content: string) => Promise<void>;
  onTakeSide: (path: string, side: "ours" | "theirs") => Promise<void>;
  onMarkResolved: (path: string) => Promise<void>;
  onOpenRecent: (path: string) => void;
  onRemoveRecent: (path: string) => Promise<void>;
  recent: Settings["recent"];
}) {
  if (view.kind === "welcome") {
    return (
      <div className="welcome">
        <div className="welcome-inner">
          <div className="welcome-logo">
            <Icon name="git" size={34} />
          </div>
          <h1>GitJet</h1>
          <p className="welcome-tagline">
            A desktop Git client for Windows and macOS: changelists, a commit panel,
            the log graph, and a three-way merge tool.
          </p>
          <div className="welcome-actions">
            <Button variant="primary" onClick={() => onOpenRecent("")}>
              <Icon name="open" /> Open Repository…
            </Button>
          </div>
          {recent.length > 0 && (
            <div className="recent-list">
              <div className="recent-title">Recent repositories</div>
              {recent.map((r) => (
                <div
                  className="recent-row"
                  key={r.path}
                  onClick={() => onOpenRecent(r.path)}
                  title={r.path}
                >
                  <Icon name="folder" />
                  <span className="recent-name">{r.name || r.path}</span>
                  <span className="recent-path">{r.path}</span>
                  <button
                    className="mini-icon"
                    title="Remove from recent"
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
          )}
          <div className="welcome-hints">
            <span><kbd>⌘/Ctrl</kbd> <kbd>O</kbd> Open</span>
            <span><kbd>⌘/Ctrl</kbd> <kbd>K</kbd> Commit</span>
            <span><kbd>⌘/Ctrl</kbd> <kbd>Shift</kbd> <kbd>K</kbd> Push</span>
            <span><kbd>⌘/Ctrl</kbd> <kbd>T</kbd> Update</span>
          </div>
        </div>
      </div>
    );
  }
  if (view.kind === "loading") {
    return (
      <div className="editor-empty">
        <Spinner label={view.title} />
      </div>
    );
  }
  if (view.kind === "message") {
    return (
      <div className={cx("editor-empty", view.tone === "error" && "error")}>
        <Icon name={view.tone === "error" ? "error" : "info"} size={26} />
        <div className="message-title">{view.title}</div>
        <pre className="message-body">{view.text}</pre>
      </div>
    );
  }
  if (view.kind === "conflict") {
    return (
      <ConflictView
        path={view.path}
        conflict={view.content}
        busy={busy}
        onSave={(content) => void onSaveConflict(view.path, content)}
        onTakeSide={(side) => void onTakeSide(view.path, side)}
        onMarkResolved={() => void onMarkResolved(view.path)}
        onClose={onClose}
      />
    );
  }
  if (view.kind === "blame") {
    return <BlameView path={view.path} lines={view.data.lines} onClose={onClose} onCopy={onCopyPath} />;
  }
  if (view.kind === "commit") {
    const detail = view.detail;
    return (
      <div className="commit-view">
        <div className="diff-header">
          <div className="diff-title-row">
            <Icon name="commit" />
            <span className="diff-path">{detail.short}</span>
            <span className="muted">{formatWhen(detail.authorTime)}</span>
            <span className="spacer" />
            <button className="toolbar-text-btn" onClick={() => onCopyPath(detail.hash)}>
              <Icon name="copy" /> Copy hash
            </button>
            <IconButton icon="close" title="Close" small onClick={onClose} />
          </div>
          <div className="diff-toolbar">
            <span className="muted">
              {detail.author} &lt;{detail.authorEmail}&gt;
            </span>
          </div>
        </div>
        <div className="details-scroll">
          <div className="details-subject commit-view-subject">{detail.subject}</div>
          {detail.body && <pre className="details-body">{detail.body}</pre>}
          <div className="details-stats">
            {detail.stats.files} files changed
            {detail.stats.additions > 0 && <span className="add-count"> +{detail.stats.additions}</span>}
            {detail.stats.deletions > 0 && <span className="del-count"> −{detail.stats.deletions}</span>}
          </div>
          {detail.files.map((file) => (
            <div
              className="details-file"
              key={file.path}
              onClick={() => onOpenFile(detail.hash, file)}
              title={file.path}
            >
              <StatusMark kind={file.status} />
              <span className="details-file-path">{file.path}</span>
              <button
                className="mini-icon"
                title="Show file history"
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
          ))}
        </div>
      </div>
    );
  }
  return (
    <DiffView
      diff={view.diff}
      opts={view.opts}
      mode={diffMode}
      setMode={setDiffMode}
      ignoreWhitespace={ignoreWhitespace}
      onToggleWhitespace={onToggleWhitespace}
      onApply={onApplyHunk}
      onApplyFile={onApplyFile}
      onBlame={
        view.opts.target === "worktree"
          ? () => onBlame(view.opts.path)
          : undefined
      }
      onCopyPath={() => onCopyPath(view.opts.path)}
      busy={busy}
      reloadKey={reloadKey}
    />
  );
}
