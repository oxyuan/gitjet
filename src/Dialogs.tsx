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
      title="Settings"
      icon="settings"
      width={600}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={() => onSave(draft)}>
            Save
          </Button>
        </>
      }
    >
      <div className="settings-body">
        <div className="settings-section-title">Git</div>
        <Field label="Git executable" hint="Leave empty to use the git on PATH.">
          <div className="row">
            <TextInput value={draft.gitPath} onChange={(v) => set("gitPath", v)} placeholder="Auto-detect" />
            <Button onClick={validate} disabled={checking}>
              {checking ? <Spinner /> : "Test"}
            </Button>
          </div>
        </Field>
        {gitVersion && <div className="settings-ok">git {gitVersion}</div>}
        {error && <div className="settings-error">{error}</div>}

        <div className="settings-section-title">Appearance</div>
        <Field label="Theme">
          <Select value={draft.theme} onChange={(v) => set("theme", v)}>
            <option value="system">Use system setting</option>
            <option value="light">Light</option>
            <option value="dark">Dark</option>
          </Select>
        </Field>

        <div className="settings-section-title">Diff</div>
        <Field label="Context lines">
          <input
            className="text-input narrow"
            type="number"
            min={1}
            max={100}
            value={draft.diffContext}
            onChange={(e) => set("diffContext", Number(e.target.value) || 3)}
          />
        </Field>
        <Checkbox
          checked={draft.ignoreWhitespace}
          onChange={(v) => set("ignoreWhitespace", v)}
          label="Ignore whitespace in diffs by default"
        />
        <Checkbox
          checked={draft.showIgnored}
          onChange={(v) => set("showIgnored", v)}
          label="Show ignored files in the commit panel"
        />

        <div className="settings-section-title">Synchronization</div>
        <Field label="Update method">
          <Select value={draft.updateMethod} onChange={(v) => set("updateMethod", v)}>
            <option value="merge">Merge</option>
            <option value="rebase">Rebase</option>
          </Select>
        </Field>
        <Checkbox
          checked={draft.autoFetch}
          onChange={(v) => set("autoFetch", v)}
          label="Fetch remotes automatically"
        />
        <Field label="Every (minutes)">
          <input
            className="text-input narrow"
            type="number"
            min={1}
            max={240}
            value={draft.autoFetchMinutes}
            onChange={(e) => set("autoFetchMinutes", Number(e.target.value) || 15)}
          />
        </Field>

        <div className="settings-section-title">Confirmations</div>
        <Checkbox
          checked={draft.confirmRollback}
          onChange={(v) => set("confirmRollback", v)}
          label="Confirm before rolling back changes"
        />
        <Checkbox
          checked={draft.confirmForcePush}
          onChange={(v) => set("confirmForcePush", v)}
          label="Confirm force push"
        />
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
  const [name, setName] = useState(initialName);
  const [from, setFrom] = useState(start || current);
  const [checkout, setCheckout] = useState(true);
  const submit = () => {
    if (name.trim() === "") return;
    onSubmit(name.trim(), from, checkout);
  };
  return (
    <Modal
      title={mode === "new" ? "New Branch" : "Rename Branch"}
      icon="branch"
      width={460}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={submit} disabled={!name.trim()}>
            {mode === "new" ? (checkout ? "Create and Checkout" : "Create") : "Rename"}
          </Button>
        </>
      }
    >
      <div className="dialog-form">
        <Field label="Name">
          <TextInput value={name} onChange={setName} autoFocus placeholder="feature/my-branch" />
        </Field>
        {mode === "new" && (
          <>
            <Field label="From">
              <Select value={from} onChange={setFrom}>
                {current && <option value={current}>{current} (current)</option>}
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
            <Checkbox checked={checkout} onChange={setCheckout} label="Checkout the new branch" />
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
  const [remote, setRemote] = useState(remotes.find((r) => r.name === "origin")?.name ?? remotes[0]?.name ?? "origin");
  const [branch, setBranch] = useState(current);
  const [force, setForce] = useState(false);
  const [tags, setTags] = useState(false);
  const [dryRun, setDryRun] = useState(false);
  const [upstream, setUpstreamState] = useState(setUpstream);
  return (
    <Modal
      title="Push Commits"
      icon="push"
      width={500}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            onClick={() => onSubmit({ remote, branch, setUpstream: upstream, forceWithLease: force, tags, dryRun })}
          >
            Push
          </Button>
        </>
      }
    >
      <div className="dialog-form">
        {remotes.length === 0 ? (
          <div className="dialog-note">This repository has no remotes. Add one with the Git console: <code>git remote add origin &lt;url&gt;</code></div>
        ) : (
          <Field label="Remote">
            <Select value={remote} onChange={setRemote}>
              {remotes.map((r) => (
                <option key={r.name} value={r.name}>
                  {r.name} — {r.url}
                </option>
              ))}
            </Select>
          </Field>
        )}
        <Field label="Branch">
          <TextInput value={branch} onChange={setBranch} placeholder={current || "branch"} />
        </Field>
        <div className="dialog-checks">
          <Checkbox checked={upstream} onChange={setUpstreamState} label="Set upstream (-u)" />
          <Checkbox checked={tags} onChange={setTags} label="Push all tags" />
          <Checkbox checked={dryRun} onChange={setDryRun} label="Dry run" />
          <Checkbox checked={force} onChange={setForce} label="Force with lease (--force-with-lease)" />
        </div>
        {force && (
          <div className="dialog-warning">
            <Icon name="warning" /> Force push rewrites history on the remote. It only succeeds when the remote
            branch is where you last saw it.
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
  const [remote, setRemote] = useState(remotes.find((r) => r.name === "origin")?.name ?? remotes[0]?.name ?? "");
  const [rebase, setRebase] = useState(updateMethod === "rebase");
  const [autostash, setAutostash] = useState(true);
  const [prune, setPrune] = useState(false);
  const [tags, setTags] = useState(false);
  return (
    <Modal
      title="Update Project"
      icon="pull"
      width={480}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={() => onSubmit({ remote, branch: "", rebase, autostash, prune, tags })}>
            Pull
          </Button>
        </>
      }
    >
      <div className="dialog-form">
        <div className="dialog-note">
          Pull fetches the remote and integrates the upstream into the current branch.
        </div>
        {remotes.length > 1 && (
          <Field label="Remote">
            <Select value={remote} onChange={setRemote}>
              {remotes.map((r) => (
                <option key={r.name} value={r.name}>
                  {r.name} — {r.url}
                </option>
              ))}
            </Select>
          </Field>
        )}
        <Field label="Integrate with">
          <div className="radio-row">
            <label className="radio">
              <input type="radio" checked={!rebase} onChange={() => setRebase(false)} /> Merge
            </label>
            <label className="radio">
              <input type="radio" checked={rebase} onChange={() => setRebase(true)} /> Rebase
            </label>
          </div>
        </Field>
        <div className="dialog-checks">
          <Checkbox checked={autostash} onChange={setAutostash} label="Stash local changes before update (--autostash)" />
          <Checkbox checked={prune} onChange={setPrune} label="Prune deleted remote branches" />
          <Checkbox checked={tags} onChange={setTags} label="Fetch tags" />
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
  const [mode, setMode] = useState<"soft" | "mixed" | "hard">("mixed");
  return (
    <Modal
      title="Reset Current Branch"
      icon="reset"
      width={520}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant={mode === "hard" ? "danger" : "primary"} onClick={() => onSubmit(mode)}>
            Reset
          </Button>
        </>
      }
    >
      <div className="dialog-form">
        <div className="dialog-note">
          Move <b>{shortHash(hash)}</b> {subject ? ` (“${subject}”)` : ""} and the current branch to this commit.
        </div>
        <label className="radio-card">
          <input type="radio" checked={mode === "soft"} onChange={() => setMode("soft")} />
          <span>
            <b>Soft</b>
            <small>Keep all local changes staged.</small>
          </span>
        </label>
        <label className="radio-card">
          <input type="radio" checked={mode === "mixed"} onChange={() => setMode("mixed")} />
          <span>
            <b>Mixed</b>
            <small>Keep local changes in the working tree, unstaged.</small>
          </span>
        </label>
        <label className="radio-card">
          <input type="radio" checked={mode === "hard"} onChange={() => setMode("hard")} />
          <span>
            <b>Hard</b>
            <small>Discard all local changes. This cannot be undone.</small>
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
  const [name, setName] = useState("");
  const [message, setMessage] = useState("");
  const [force, setForce] = useState(false);
  return (
    <Modal
      title="New Tag"
      icon="tag"
      width={460}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={() => onSubmit({ name, message, revision: start, force })} disabled={!name.trim()}>
            Create Tag
          </Button>
        </>
      }
    >
      <div className="dialog-form">
        <div className="dialog-note">Tagging {shortHash(start)}</div>
        <Field label="Tag name">
          <TextInput value={name} onChange={setName} autoFocus placeholder="v1.0.0" />
        </Field>
        <Field label="Message" hint="Leave empty for a lightweight tag.">
          <TextInput value={message} onChange={setMessage} placeholder="Release 1.0.0" />
        </Field>
        <Checkbox checked={force} onChange={setForce} label="Replace an existing tag (-f)" />
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
  const [message, setMessage] = useState("");
  const [untracked, setUntracked] = useState(true);
  const [keepIndex, setKeepIndex] = useState(false);
  return (
    <Modal
      title="Stash Changes"
      icon="stash"
      width={460}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={() => onSubmit({ message, includeUntracked: untracked, keepIndex, paths: [] })}>
            Stash
          </Button>
        </>
      }
    >
      <div className="dialog-form">
        <Field label="Message">
          <TextInput value={message} onChange={setMessage} autoFocus placeholder="WIP on feature" />
        </Field>
        <Checkbox checked={untracked} onChange={setUntracked} label="Include untracked files (-u)" />
        <Checkbox checked={keepIndex} onChange={setKeepIndex} label="Keep staged changes in the index (--keep-index)" />
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
  const [comment, setComment] = useState(initialComment);
  return (
    <Modal
      title={mode === "new" ? "New Changelist" : "Rename Changelist"}
      icon="list"
      width={440}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={() => onSubmit(name.trim(), comment)} disabled={!name.trim()}>
            {mode === "new" ? "Create" : "Rename"}
          </Button>
        </>
      }
    >
      <div className="dialog-form">
        <Field label="Name">
          <TextInput value={name} onChange={setName} autoFocus placeholder="Refactoring" />
        </Field>
        <Field label="Comment">
          <TextInput value={comment} onChange={setComment} placeholder="Optional" />
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
  const [ref, setRef] = useState(refs[0] ?? "");
  const [noFF, setNoFF] = useState(false);
  const [squash, setSquash] = useState(false);
  return (
    <Modal
      title="Merge Branch"
      icon="merge"
      width={460}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={() => onSubmit(ref, { noFF, squash, message: "" })} disabled={!ref}>
            Merge
          </Button>
        </>
      }
    >
      <div className="dialog-form">
        <Field label="Merge into">
          <span className="dialog-value">{current}</span>
        </Field>
        <Field label="Branch">
          <Select value={ref} onChange={setRef}>
            {refs.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </Select>
        </Field>
        <Checkbox checked={noFF} onChange={setNoFF} label="Create a merge commit (--no-ff)" />
        <Checkbox checked={squash} onChange={setSquash} label="Squash commits (--squash)" />
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
