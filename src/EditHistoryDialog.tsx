import { useEffect, useState } from "react";
import { Git } from "./mygo";
import type { PlanCommit, PlanStep } from "./mygo";
import { Icon } from "./icons";
import { useT } from "./i18n";
import { Button, Field, Modal, Select, Spinner, TextInput, cx } from "./ui";

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
    edit: "Edit (stop)",
    message: "Message",
    apply: "Rewrite {n} commits",
    cancel: "Cancel",
    rewordPlaceholder: "The new commit message",
    squashPlaceholder: "Text added to the message of the commit above",
    hintRoot: "The first line cannot be squashed or fixed up",
    hintMerge: "Merge commits cannot be rewritten; drop them instead",
    summary: "{picked} kept, {dropped} dropped, {folded} folded",
    moveUp: "Move up",
    moveDown: "Move down",
    insertExec: "Add shell command",
    insertBreak: "Add break",
    execPlaceholder: "Command to run at this point",
    removeStep: "Remove this step",
    exec: "exec (run a command)",
    break: "break (stop here)",
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
    insertExec: "添加 shell 命令",
    insertBreak: "添加 break",
    execPlaceholder: "在此处执行的命令",
    removeStep: "删除此步骤",
    exec: "exec（执行命令）",
    break: "break（停在这里）",
  },
} as const;

const ACTIONS = ["pick", "reword", "edit", "squash", "fixup", "drop"] as const;

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

  const update = (index: number, patch: Partial<PlanStep>) =>
    setSteps((prev) => prev.map((s, i) => (i === index ? { ...s, ...patch } : s)));

  const remove = (index: number) => setSteps((prev) => prev.filter((_, i) => i !== index));

  const insert = (action: "exec" | "break") =>
    setSteps((prev) => [...prev, { hash: "", action, message: "", command: "" }]);

  const move = (index: number, delta: number) =>
    setSteps((prev) => {
      const next = [...prev];
      const target = index + delta;
      if (target < 0 || target >= next.length) return prev;
      const [step] = next.splice(index, 1);
      next.splice(target, 0, step!);
      return next;
    });

  const byHash = new Map(commits.map((c) => [c.hash, c]));
  const firstKept = steps.find((s) => s.action !== "drop" && s.action !== "exec" && s.action !== "break")?.hash ?? "";
  const picked = steps.filter((s) => s.action === "pick" || s.action === "reword" || s.action === "edit").length;
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
          <div className="rewrite-insert">
            <Button onClick={() => insert("exec")}>{t("insertExec")}</Button>
            <Button onClick={() => insert("break")}>{t("insertBreak")}</Button>
          </div>
          <div className="rewrite-list" role="list">
            {steps.map((step, i) => {
              const extra = step.action === "exec" || step.action === "break";
              const commit = step.hash ? byHash.get(step.hash) : undefined;
              if (!extra && !commit) return null;
              const first = step.hash === firstKept;
              const messageAction = step.action === "reword" || step.action === "squash";
              return (
                <div className={cx("rewrite-row", step.action === "drop" && "dropped")} key={step.hash || `extra:${i}`} role="listitem">
                  <div className="rewrite-line">
                    {extra ? (
                      <span className="rewrite-action">{t(step.action as "exec" | "break")}</span>
                    ) : (
                      <Select
                        value={step.action}
                        onChange={(action) => {
                          update(i, { action });
                          if (action === "reword") setEditing(step.hash);
                        }}
                      >
                        {ACTIONS.map((action) => (
                          <option
                            key={action}
                            value={action}
                            disabled={commit!.merge && action !== "drop"}
                          >
                            {t(action)}
                          </option>
                        ))}
                      </Select>
                    )}
                    {commit ? (
                      <>
                        <code className="rewrite-hash">{commit.short}</code>
                        <span className="rewrite-subject" title={commit.subject}>
                          {commit.subject}
                        </span>
                        <span className="rewrite-author">{commit.author}</span>
                      </>
                    ) : (
                      <span className="rewrite-subject">
                        {step.action === "exec" ? step.command || t("execPlaceholder") : t("break")}
                      </span>
                    )}
                    <button
                      className="mini-icon"
                      title={t("moveUp")}
                      disabled={i === 0}
                      onClick={() => move(i, -1)}
                    >
                      <Icon name="chevronUp" size={12} />
                    </button>
                    <button
                      className="mini-icon"
                      title={t("moveDown")}
                      disabled={i === steps.length - 1}
                      onClick={() => move(i, 1)}
                    >
                      <Icon name="chevronDown" size={12} />
                    </button>
                    {extra ? (
                      <button className="mini-icon" title={t("removeStep")} onClick={() => remove(i)}>
                        <Icon name="trash" size={12} />
                      </button>
                    ) : messageAction ? (
                      <button
                        className="mini-btn"
                        onClick={() => setEditing(editing === step.hash ? null : step.hash)}
                      >
                        <Icon name="edit" size={12} />
                      </button>
                    ) : null}
                  </div>
                  {extra && step.action === "exec" && (
                    <Field label={t("exec")}>
                      <TextInput
                        value={step.command ?? ""}
                        onChange={(value) => update(i, { command: value })}
                        placeholder={t("execPlaceholder")}
                      />
                    </Field>
                  )}
                  {!extra && first && step.action !== "drop" && <span className="rewrite-warning">{t("hintRoot")}</span>}
                  {!extra && commit?.merge && step.action !== "drop" && (
                    <span className="rewrite-warning">{t("hintMerge")}</span>
                  )}
                  {!extra && editing === step.hash && messageAction && (
                    <Field label={t("message")}>
                      <textarea
                        className="text-input rewrite-message"
                        value={step.message ?? ""}
                        onChange={(e) => update(i, { message: e.target.value })}
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
