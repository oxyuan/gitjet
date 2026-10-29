import { useEffect, useState } from "react";
import { Git } from "./mygo";
import type { PlanCommit, PlanStep } from "./mygo";
import { Icon } from "./icons";
import { useT } from "./i18n";
import { Button, Field, Modal, Select, Spinner, cx } from "./ui";

const T = {
  en: {
    title: "Edit History",
    intro:
      "Replay these commits with the chosen action. The branch is rebuilt from the commit below the list; a conflict stops the replay and Continue finishes it.",
    loading: "Reading commits",
    failed: "The commits could not be read",
    empty: "There is nothing to rewrite here",
    action: "Action",
    pick: "Pick",
    reword: "Reword",
    squash: "Squash into previous",
    fixup: "Fixup into previous",
    drop: "Drop",
    message: "Message",
    apply: "Rewrite {n} commits",
    cancel: "Cancel",
    rewordPlaceholder: "The new commit message",
    squashPlaceholder: "Text added to the message of the commit above",
    hintRoot: "The first line cannot be squashed or fixed up",
    hintMerge: "Merge commits cannot be rewritten; drop them instead",
    summary: "{picked} kept, {dropped} dropped, {folded} folded",
  },
  zh: {
    title: "编辑历史",
    intro:
      "按所选动作重放这些提交。分支会从列表下方的提交重建；遇到冲突会暂停，之后用“继续”完成。",
    loading: "正在读取提交",
    failed: "无法读取提交",
    empty: "这里没有可重写的提交",
    action: "动作",
    pick: "pick（保留）",
    reword: "reword（改写信息）",
    squash: "squash（压缩到上一个）",
    fixup: "fixup（合并到上一个，保留信息）",
    drop: "drop（删除）",
    message: "提交信息",
    apply: "重写 {n} 个提交",
    cancel: "取消",
    rewordPlaceholder: "新的提交信息",
    squashPlaceholder: "追加到上一个提交信息之后的内容",
    hintRoot: "第一个提交不能压缩或合并",
    hintMerge: "合并提交不能重写，请改为删除",
    summary: "保留 {picked}，删除 {dropped}，合并 {folded}",
  },
} as const;

const ACTIONS = ["pick", "reword", "squash", "fixup", "drop"] as const;

/** EditHistoryDialog rewrites a commit range: reword, squash, fixup or drop. */
export function EditHistoryDialog({
  onto,
  onClose,
  onSubmit,
}: {
  onto: string;
  onClose: () => void;
  onSubmit: (steps: PlanStep[]) => void;
}) {
  const t = useT(T);
  const [commits, setCommits] = useState<PlanCommit[]>([]);
  const [steps, setSteps] = useState<PlanStep[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    Git.rewritePlan(onto)
      .then((plan) => {
        if (!alive) return;
        setCommits(plan);
        setSteps(plan.map((c) => ({ hash: c.hash, action: "pick", message: c.message })));
      })
      .catch((err: unknown) => {
        if (alive) setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [onto]);

  const update = (hash: string, patch: Partial<PlanStep>) =>
    setSteps((prev) => prev.map((s) => (s.hash === hash ? { ...s, ...patch } : s)));

  const picked = steps.filter((s) => s.action === "pick" || s.action === "reword").length;
  const dropped = steps.filter((s) => s.action === "drop").length;
  const folded = steps.filter((s) => s.action === "squash" || s.action === "fixup").length;

  return (
    <Modal
      title={t("title")}
      icon="commit"
      width={720}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>{t("cancel")}</Button>
          <Button variant="primary" onClick={() => onSubmit(steps)} disabled={loading || steps.length === 0}>
            {t("apply", { n: steps.length })}
          </Button>
        </>
      }
    >
      <p className="setting-hint">{t("intro")}</p>
      {loading && <Spinner label={t("loading")} />}
      {error && <p className="dialog-error">{t("failed")}: {error}</p>}
      {!loading && !error && steps.length === 0 && <p className="setting-hint">{t("empty")}</p>}
      {!loading && !error && (
        <>
          <div className="rewrite-list" role="list">
            {steps.map((step, i) => {
              const commit = commits[i];
              if (!commit) return null;
              const first = i === 0;
              const messageAction = step.action === "reword" || step.action === "squash";
              return (
                <div className={cx("rewrite-row", step.action === "drop" && "dropped")} key={step.hash} role="listitem">
                  <div className="rewrite-line">
                    <Select
                      value={step.action}
                      onChange={(action) => {
                        update(step.hash, { action });
                        if (action === "reword") setEditing(step.hash);
                      }}
                    >
                      {ACTIONS.map((action) => (
                        <option
                          key={action}
                          value={action}
                          disabled={commit.merge && action !== "drop"}
                        >
                          {t(action)}
                        </option>
                      ))}
                    </Select>
                    <code className="rewrite-hash">{commit.short}</code>
                    <span className="rewrite-subject" title={commit.subject}>
                      {commit.subject}
                    </span>
                    <span className="rewrite-author">{commit.author}</span>
                    {messageAction && (
                      <button
                        className="mini-btn"
                        onClick={() => setEditing(editing === step.hash ? null : step.hash)}
                      >
                        <Icon name="edit" size={12} />
                      </button>
                    )}
                  </div>
                  {first && step.action !== "drop" && <span className="rewrite-warning">{t("hintRoot")}</span>}
                  {commit.merge && step.action !== "drop" && (
                    <span className="rewrite-warning">{t("hintMerge")}</span>
                  )}
                  {editing === step.hash && messageAction && (
                    <Field label={t("message")}>
                      <textarea
                        className="text-input rewrite-message"
                        value={step.message ?? ""}
                        onChange={(e) => update(step.hash, { message: e.target.value })}
                        placeholder={step.action === "squash" ? t("squashPlaceholder") : t("rewordPlaceholder")}
                        rows={3}
                      />
                    </Field>
                  )}
                </div>
              );
            })}
          </div>
          <p className="setting-hint">{t("summary", { picked, dropped, folded })}</p>
        </>
      )}
    </Modal>
  );
}
