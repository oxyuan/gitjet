import { useEffect, useRef, useState } from "react";
import { Workspace } from "./mygo";
import type { Remote } from "./mygo";
import { Icon } from "./icons";
import { useT } from "./i18n";
import { Button, Field, IconButton, Modal, TextInput } from "./ui";

const T = {
  en: {
    "common.cancel": "Cancel",
    "common.close": "Close",
    "clone.title": "Clone Repository",
    "clone.url": "Repository URL",
    "clone.parent": "Parent folder",
    "clone.name": "Folder name",
    "clone.choose": "Choose…",
    "clone.target": "The repository is cloned into {path}.",
    "clone.hint": "The folder must not exist or must be empty.",
    "clone.submit": "Clone",
    "init.title": "Create Git Repository",
    "init.dir": "Folder",
    "init.branch": "Initial branch",
    "init.hint": "The folder is created when it does not exist.",
    "init.submit": "Create",
    "remotes.title": "Remotes",
    "remotes.name": "Name",
    "remotes.url": "URL",
    "remotes.add": "Add",
    "remotes.addTitle": "Add a remote",
    "remotes.empty": "This repository has no remotes.",
    "remotes.rename": "Rename",
    "remotes.remove": "Remove",
    "remotes.save": "Save URL",
    "remotes.renameHint": "New name for {name}",
  },
  zh: {
    "common.cancel": "取消",
    "common.close": "关闭",
    "clone.title": "克隆仓库",
    "clone.url": "仓库地址",
    "clone.parent": "上级文件夹",
    "clone.name": "文件夹名",
    "clone.choose": "选择…",
    "clone.target": "仓库将克隆到 {path}。",
    "clone.hint": "目标文件夹不能存在或必须为空。",
    "clone.submit": "克隆",
    "init.title": "新建 Git 仓库",
    "init.dir": "文件夹",
    "init.branch": "初始分支",
    "init.hint": "文件夹不存在时会自动创建。",
    "init.submit": "创建",
    "remotes.title": "远端",
    "remotes.name": "名称",
    "remotes.url": "地址",
    "remotes.add": "添加",
    "remotes.addTitle": "添加远端",
    "remotes.empty": "这个仓库还没有远端。",
    "remotes.rename": "重命名",
    "remotes.remove": "删除",
    "remotes.save": "保存地址",
    "remotes.renameHint": "{name} 的新名称",
  },
};

/** The folder name a URL suggests: the last path segment without .git. */
export function folderNameFromURL(url: string): string {
  const trimmed = url.trim().replace(/[\\/]+$/, "");
  const segment = trimmed.split(/[\\/:]/).pop() ?? "";
  return segment.replace(/\.git$/i, "") || "repository";
}

function joinPath(parent: string, name: string): string {
  const base = parent.replace(/[\\/]+$/, "");
  return base === "" ? name : `${base}/${name}`;
}

export function CloneDialog({
  onClose,
  onSubmit,
}: {
  onClose: () => void;
  onSubmit: (url: string, dir: string) => void;
}) {
  const t = useT(T);
  const [url, setUrl] = useState("");
  const [parent, setParent] = useState("");
  const [name, setName] = useState("");
  const edited = useRef(false);
  useEffect(() => {
    if (!edited.current) setName(folderNameFromURL(url));
  }, [url]);
  const target = joinPath(parent.trim(), name.trim());
  const ready = url.trim() !== "" && name.trim() !== "" && parent.trim() !== "";
  const choose = async () => {
    const chosen = await Workspace.chooseFolder().catch(() => "");
    if (chosen) setParent(chosen);
  };
  return (
    <Modal
      title={t("clone.title")}
      icon="git"
      width={560}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>{t("common.cancel")}</Button>
          <Button variant="primary" disabled={!ready} onClick={() => onSubmit(url.trim(), target)}>
            {t("clone.submit")}
          </Button>
        </>
      }
    >
      <div className="dialog-form">
        <Field label={t("clone.url")}>
          <TextInput value={url} onChange={setUrl} autoFocus placeholder="https://host/team/repo.git" />
        </Field>
        <Field label={t("clone.parent")}>
          <div className="row">
            <TextInput value={parent} onChange={setParent} placeholder="/Users/you/code" />
            <Button onClick={() => void choose()}>{t("clone.choose")}</Button>
          </div>
        </Field>
        <Field label={t("clone.name")}>
          <TextInput
            value={name}
            onChange={(value) => {
              edited.current = true;
              setName(value);
            }}
          />
        </Field>
        {ready && <div className="dialog-note">{t("clone.target", { path: target })}</div>}
        <div className="dialog-note">{t("clone.hint")}</div>
      </div>
    </Modal>
  );
}

export function InitDialog({
  onClose,
  onSubmit,
}: {
  onClose: () => void;
  onSubmit: (dir: string, branch: string) => void;
}) {
  const t = useT(T);
  const [dir, setDir] = useState("");
  const [branch, setBranch] = useState("main");
  const choose = async () => {
    const chosen = await Workspace.chooseFolder().catch(() => "");
    if (chosen) setDir(chosen);
  };
  return (
    <Modal
      title={t("init.title")}
      icon="git"
      width={520}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>{t("common.cancel")}</Button>
          <Button variant="primary" disabled={dir.trim() === ""} onClick={() => onSubmit(dir.trim(), branch.trim() || "main")}>
            {t("init.submit")}
          </Button>
        </>
      }
    >
      <div className="dialog-form">
        <Field label={t("init.dir")}>
          <div className="row">
            <TextInput value={dir} onChange={setDir} autoFocus placeholder="/Users/you/code/project" />
            <Button onClick={() => void choose()}>{t("clone.choose")}</Button>
          </div>
        </Field>
        <Field label={t("init.branch")}>
          <TextInput value={branch} onChange={setBranch} />
        </Field>
        <div className="dialog-note">{t("init.hint")}</div>
      </div>
    </Modal>
  );
}

function RemoteRow({
  remote,
  onSaveURL,
  onRename,
  onRemove,
}: {
  remote: Remote;
  onSaveURL: (url: string) => void;
  onRename: (name: string) => void;
  onRemove: () => void;
}) {
  const t = useT(T);
  const [url, setUrl] = useState(remote.url);
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(remote.name);
  useEffect(() => {
    setUrl(remote.url);
    setName(remote.name);
  }, [remote.url, remote.name]);
  return (
    <div className="remote-row">
      {renaming ? (
        <TextInput
          value={name}
          onChange={setName}
          autoFocus
          onKeyDown={(e) => {
            if (e.key === "Enter" && name.trim() !== "" && name.trim() !== remote.name) {
              onRename(name.trim());
              setRenaming(false);
            }
            if (e.key === "Escape") {
              setName(remote.name);
              setRenaming(false);
            }
          }}
        />
      ) : (
        <span className="remote-name" title={remote.name}>
          {remote.name}
        </span>
      )}
      <TextInput value={url} onChange={setUrl} placeholder={t("remotes.url")} />
      <IconButton
        icon="save"
        title={t("remotes.save")}
        disabled={url.trim() === "" || url === remote.url}
        onClick={() => onSaveURL(url.trim())}
      />
      <IconButton
        icon="edit"
        title={t("remotes.rename")}
        active={renaming}
        onClick={() => setRenaming((v) => !v)}
      />
      <IconButton icon="trash" title={t("remotes.remove")} onClick={onRemove} />
    </div>
  );
}

export function RemotesDialog({
  remotes,
  onAdd,
  onSaveURL,
  onRename,
  onRemove,
  onClose,
}: {
  remotes: Remote[];
  onAdd: (name: string, url: string) => void;
  onSaveURL: (name: string, url: string) => void;
  onRename: (oldName: string, newName: string) => void;
  onRemove: (name: string) => void;
  onClose: () => void;
}) {
  const t = useT(T);
  const [name, setName] = useState("origin");
  const [url, setUrl] = useState("");
  const ready = name.trim() !== "" && url.trim() !== "";
  return (
    <Modal
      title={t("remotes.title")}
      icon="fetch"
      width={720}
      onClose={onClose}
      footer={<Button variant="primary" onClick={onClose}>{t("common.close")}</Button>}
    >
      <div className="dialog-form">
        {remotes.length === 0 ? (
          <div className="dialog-note">{t("remotes.empty")}</div>
        ) : (
          <div className="remote-list">
            {remotes.map((remote) => (
              <RemoteRow
                key={remote.name}
                remote={remote}
                onSaveURL={(value) => onSaveURL(remote.name, value)}
                onRename={(value) => onRename(remote.name, value)}
                onRemove={() => onRemove(remote.name)}
              />
            ))}
          </div>
        )}
        <div className="remote-row remote-add">
          <TextInput value={name} onChange={setName} placeholder={t("remotes.name")} />
          <TextInput value={url} onChange={setUrl} placeholder={t("remotes.url")} />
          <Button
            disabled={!ready}
            onClick={() => {
              onAdd(name.trim(), url.trim());
              setUrl("");
            }}
          >
            <Icon name="plus" size={12} /> {t("remotes.add")}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
