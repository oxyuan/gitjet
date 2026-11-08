import { useCallback, useEffect, useRef, useState } from "react";
import { ConflictView } from "./ConflictView";
import { LangProvider, resolveLang } from "./i18n";
import { Git, Workspace, events, type Bootstrap, type ConflictContent, type MergeDetails } from "./mygo";

const T = {
  en: {
    loading: "Loading the conflict…",
    failed: "Could not open the merge editor",
    retry: "Retry",
    close: "Close",
    title: "Merge {path}",
  },
  zh: {
    loading: "正在读取冲突…",
    failed: "无法打开合并编辑器",
    retry: "重试",
    close: "关闭",
    title: "合并 {path} 的修订",
  },
};

function dict(lang: string | undefined) {
  return resolveLang(lang ?? "system") === "zh" ? T.zh : T.en;
}

/**
 * The page of a merge window: one conflicted file, no docks. The window is
 * opened by Workspace.openMergeWindow and closes itself when the file is
 * applied, saved, or handed to the next conflict.
 */
export function MergeWindow({ path }: { path: string }) {
  const [boot, setBoot] = useState<Bootstrap | null>(null);
  const [conflict, setConflict] = useState<ConflictContent | null>(null);
  const [details, setDetails] = useState<MergeDetails | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [root, setRoot] = useState("");
  const busyRef = useRef(false);
  const lang = resolveLang(boot?.settings.language ?? "system");
  const t = dict(lang);

  const load = useCallback(async () => {
    setError("");
    try {
      const b = await Workspace.bootstrap();
      setBoot(b);
      if (!b.repo) {
        setError(b.error || "no repository is open");
        return;
      }
      setRoot(b.repo.state.root);
      const entry = b.repo.conflicts.find((c) => c.path === path);
      if (!entry) {
        // The file stopped conflicting while the window was open.
        await Workspace.closeWindow();
        return;
      }
      const [content, merge] = await Promise.all([
        Git.conflict(path),
        Git.mergeDetails().catch(() => null),
      ]);
      setConflict(content);
      setDetails(merge);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [path]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);

  // Another window or a terminal may end the merge or resolve this file:
  // leave then, instead of showing a conflict that no longer exists.
  useEffect(() => {
    const off = events.repoChanged.on(() => {
      if (busyRef.current) return;
      void Workspace.bootstrap()
        .then((b) => {
          if (!b.repo || !b.repo.conflicts.some((c) => c.path === path)) {
            void Workspace.closeWindow();
          }
        })
        .catch(() => {});
    });
    return off;
  }, [path]);

  useEffect(() => {
    if (!boot) return;
    const absolute = root ? `${root}/${path}` : path;
    document.title = `${dirty ? "• " : ""}${t.title.replace("{path}", absolute)}`;
  }, [boot, root, path, t, dirty]);

  const run = async (fn: () => Promise<void>) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    try {
      await fn();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  /** Closes this window, opening the next conflicted file first. */
  const finish = async () => {
    const b = await Workspace.bootstrap();
    const next = b.repo?.conflicts.find((c) => c.path !== path);
    if (next) await Workspace.openMergeWindow(next.path);
    await Workspace.closeWindow();
  };

  if (error) {
    return (
      <LangProvider lang={lang}>
      <div className="merge-window merge-window-error">
        <div className="merge-window-card">
          <div className="merge-window-title">{t.failed}</div>
          <div className="merge-window-message">{error}</div>
          <div className="merge-window-actions">
            <button className="btn" onClick={() => void load()}>
              {t.retry}
            </button>
            <button className="btn btn-primary" onClick={() => void Workspace.closeWindow()}>
              {t.close}
            </button>
          </div>
        </div>
      </div>
      </LangProvider>
    );
  }

  if (!conflict) {
    return (
      <LangProvider lang={lang}>
      <div className="merge-window merge-window-error">
        <div className="merge-window-card muted">{t.loading}</div>
      </div>
      </LangProvider>
    );
  }

  return (
    <LangProvider lang={lang}>
    <div className="merge-window">
      <ConflictView
        path={path}
        conflict={conflict}
        details={details}
        oursLabel={boot?.repo?.state.opOurs ?? ""}
        theirsLabel={boot?.repo?.state.opTheirs ?? ""}
        busy={busy}
        onSave={(content, stage, advance) =>
          void run(async () => {
            await Git.saveResolution(path, content, stage);
            // Apply Changes hands over to the next conflict; Save and Close
            // returns to the conflict list, as the IDE does.
            if (advance) await finish();
            else await Workspace.closeWindow();
          })
        }
        onTakeSide={(side) =>
          void run(async () => {
            await Git.takeSide(path, side);
            await finish();
          })
        }
        onClose={() => void Workspace.closeWindow()}
        onDirtyChange={setDirty}
      />
    </div>
    </LangProvider>
  );
}
