import { useState, type ReactNode } from "react";
import { Git, Workspace } from "./mygo";
import { useT } from "./i18n";
import { type IconName } from "./icons";
import { menuPathValues, newEntryPrefix, type FileMenuTarget } from "./fileMenuModel";
import { baseName } from "./paths";
import {
  Button,
  ConfirmDialog,
  type ContextItem,
  ContextMenu,
  Field,
  Modal,
  TextInput,
} from "./ui";

const T = {
  en: {
    new: "New",
    newFile: "File…",
    newDir: "Directory…",
    rename: "Rename…",
    delete: "Delete…",
    reveal: "Open in File Manager",
    copyPathRef: "Copy Path/Reference",
    copyAbsolute: "Absolute Path",
    copyName: "File Name",
    copyContentRoot: "Path from Content Root",
    copyReference: "Copy File Reference",
    copyRepoRoot: "Repository Root",
    newFileTitle: "New file",
    newDirTitle: "New directory",
    renameTitle: "Rename",
    pathLabel: "Path",
    newPathLabel: "New path",
    pathHint: "Relative to the repository root. Missing folders are created.",
    renameHint: "Relative to the repository root.",
    create: "Create",
    cancel: "Cancel",
    renameAction: "Rename",
    deleteTitle: "Delete {name}",
    deleteMessage: "Delete {path}?",
    deleteDirDetail: "Everything inside the directory is removed. Tracked files are staged as deleted.",
    deleteFileDetail: "The file is removed from disk. A tracked file is staged as deleted.",
  },
  zh: {
    new: "新建",
    newFile: "文件…",
    newDir: "目录…",
    rename: "重命名…",
    delete: "删除…",
    reveal: "打开于资源管理器",
    copyPathRef: "复制路径/引用",
    copyAbsolute: "绝对路径",
    copyName: "文件名",
    copyContentRoot: "来自内容根的路径",
    copyReference: "拷贝文件引用",
    copyRepoRoot: "仓库根路径",
    newFileTitle: "新建文件",
    newDirTitle: "新建目录",
    renameTitle: "重命名",
    pathLabel: "路径",
    newPathLabel: "新路径",
    pathHint: "相对于仓库根目录；缺失的文件夹会自动创建。",
    renameHint: "相对于仓库根目录。",
    create: "创建",
    cancel: "取消",
    renameAction: "重命名",
    deleteTitle: "删除 {name}",
    deleteMessage: "确认删除 {path}？",
    deleteDirDetail: "目录内的全部内容都会被删除；已跟踪文件会以删除状态暂存。",
    deleteFileDetail: "文件将从磁盘删除；已跟踪文件会以删除状态暂存。",
  },
} as const;

type PromptState =
  | { kind: "file"; value: string }
  | { kind: "dir"; value: string }
  | { kind: "rename"; from: string; value: string };

type ConfirmState = { path: string; isDir: boolean };

/**
 * The working-tree half of a file row's context menu: create, rename, delete,
 * reveal and the clipboard choices. Both the Files tab and the Commit tab
 * mount the same hook, so a row means the same thing in either place.
 */
export function useFileMenu({
  root,
  onChanged,
  onError,
  onCopy,
  onReveal,
}: {
  root: string;
  onChanged: () => void;
  onError: (err: unknown) => void;
  onCopy?: (text: string) => void;
  onReveal?: (path: string) => void;
}) {
  const t = useT(T);
  const [menu, setMenu] = useState<{
    x: number;
    y: number;
    target: FileMenuTarget;
    extra: ContextItem[];
  } | null>(null);
  const [prompt, setPrompt] = useState<PromptState | null>(null);
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);
  const [busy, setBusy] = useState(false);

  const openMenu = (
    event: React.MouseEvent,
    target: FileMenuTarget,
    extra: ContextItem[] = [],
  ) => {
    event.preventDefault();
    event.stopPropagation();
    setMenu({ x: event.clientX, y: event.clientY, target, extra });
  };

  const copy = (text: string) => {
    if (onCopy) {
      onCopy(text);
      return;
    }
    void Workspace.copy(text).catch(onError);
  };

  const reveal = (path: string) => {
    if (onReveal) {
      onReveal(path);
      return;
    }
    void Workspace.reveal(path).catch(onError);
  };

  const startNew = (kind: "file" | "dir") => {
    if (!menu) return;
    setPrompt({ kind, value: newEntryPrefix(menu.target) });
  };

  const beginRename = () => {
    if (!menu || menu.target.path === "") return;
    setPrompt({ kind: "rename", from: menu.target.path, value: menu.target.path });
  };

  const submitPrompt = async () => {
    if (!prompt || busy) return;
    const value = prompt.value.trim();
    if (value === "") return;
    setBusy(true);
    try {
      if (prompt.kind === "file") await Git.createFile(value);
      else if (prompt.kind === "dir") await Git.createDir(value);
      else await Git.renamePath(prompt.from, value);
      setPrompt(null);
      onChanged();
    } catch (err) {
      onError(err);
    } finally {
      setBusy(false);
    }
  };

  const performDelete = async () => {
    if (!confirm || busy) return;
    setBusy(true);
    try {
      await Git.deletePath(confirm.path);
      setConfirm(null);
      onChanged();
    } catch (err) {
      onError(err);
    } finally {
      setBusy(false);
    }
  };

  const menuItems = (): ContextItem[] => {
    if (!menu) return [];
    const target = menu.target;
    const values = menuPathValues(root, target);
    const copyItem = (label: string, value: string, icon: IconName = "copy"): ContextItem => ({
      label,
      icon,
      disabled: value === "",
      onClick: () => copy(value),
    });
    const items: ContextItem[] = [
      {
        label: t("new"),
        icon: "plus",
        children: [
          { label: t("newFile"), icon: "file", onClick: () => startNew("file") },
          { label: t("newDir"), icon: "folder", onClick: () => startNew("dir") },
        ],
      },
    ];
    if (menu.extra.length > 0) items.push({ separator: true }, ...menu.extra);
    if (target.path !== "") {
      items.push(
        { separator: true },
        { label: t("rename"), icon: "edit", onClick: beginRename },
        {
          label: t("delete"),
          icon: "trash",
          danger: true,
          onClick: () => setConfirm({ path: target.path, isDir: target.isDir }),
        },
      );
    }
    items.push(
      { separator: true },
      { label: t("reveal"), icon: "external", onClick: () => reveal(target.path) },
      {
        label: t("copyPathRef"),
        icon: "copy",
        children: [
          copyItem(t("copyAbsolute"), values.absolute),
          copyItem(t("copyName"), values.name),
          copyItem(t("copyContentRoot"), values.contentRoot),
          copyItem(t("copyReference"), values.reference),
          copyItem(t("copyRepoRoot"), values.repositoryRoot),
        ],
      },
    );
    return items;
  };

  const promptTitle =
    prompt?.kind === "file"
      ? t("newFileTitle")
      : prompt?.kind === "dir"
        ? t("newDirTitle")
        : t("renameTitle");
  const promptIcon: IconName = prompt?.kind === "dir" ? "folder" : prompt?.kind === "file" ? "file" : "edit";

  const node: ReactNode = (
    <>
      {menu && (
        <ContextMenu x={menu.x} y={menu.y} items={menuItems()} onClose={() => setMenu(null)} />
      )}
      {prompt && (
        <Modal
          title={promptTitle}
          icon={promptIcon}
          width={480}
          onClose={() => (busy ? undefined : setPrompt(null))}
          footer={
            <>
              <Button onClick={() => setPrompt(null)} disabled={busy}>
                {t("cancel")}
              </Button>
              <Button
                variant="primary"
                onClick={() => void submitPrompt()}
                disabled={busy || prompt.value.trim() === ""}
              >
                {prompt.kind === "rename" ? t("renameAction") : t("create")}
              </Button>
            </>
          }
        >
          <Field
            label={prompt.kind === "rename" ? t("newPathLabel") : t("pathLabel")}
            hint={prompt.kind === "rename" ? t("renameHint") : t("pathHint")}
          >
            <TextInput
              value={prompt.value}
              onChange={(value) => setPrompt({ ...prompt, value })}
              placeholder={prompt.kind === "rename" ? t("newPathLabel") : t("pathLabel")}
              autoFocus
              selectOnFocus={prompt.kind === "rename"}
              monospace
              disabled={busy}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void submitPrompt();
                }
              }}
            />
          </Field>
        </Modal>
      )}
      {confirm && (
        <ConfirmDialog
          title={t("deleteTitle", { name: baseName(confirm.path) || confirm.path })}
          message={t("deleteMessage", { path: confirm.path })}
          detail={confirm.isDir ? t("deleteDirDetail") : t("deleteFileDetail")}
          confirmLabel={t("delete")}
          danger
          onConfirm={() => void performDelete()}
          onCancel={() => setConfirm(null)}
        />
      )}
    </>
  );

  return { openMenu, menuNode: node };
}
