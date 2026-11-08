import { useState } from "react";
import { ContextMenu, IconButton } from "./ui";
import { useT } from "./i18n";
import { pathChoices, type PathChoiceKey } from "./paths";

const T = {
  en: {
    title: "Copy path",
    absolute: "Absolute Path",
    absoluteLine: "Absolute Path with Line",
    relative: "Path from Repository Root",
    relativeLine: "Path from Repository Root with Line",
    name: "File Name",
    nameLine: "File Name with Line",
    quoted: "Absolute Path for Shell",
    copied: "Path copied",
  },
  zh: {
    title: "复制路径",
    absolute: "绝对路径",
    absoluteLine: "绝对路径（带行号）",
    relative: "仓库相对路径",
    relativeLine: "仓库相对路径（带行号）",
    name: "文件名",
    nameLine: "文件名（带行号）",
    quoted: "绝对路径（Shell 转义）",
    copied: "已复制路径",
  },
} as const;

/** The small control next to a file's path: one click, one menu of the ways
 *  to name that file, and the choice on the clipboard — an IDE's Copy
 *  Path/Reference, limited to what a Git client can honestly answer. */
export function PathCopyButton({
  path,
  root,
  line,
  onCopy,
}: {
  path: string;
  root: string;
  /** 1-based line under the caret; omitted when the view has no caret. */
  line?: number;
  onCopy: (text: string) => void;
}) {
  const t = useT(T);
  const [at, setAt] = useState<{ x: number; y: number } | null>(null);
  const choices = pathChoices({ path, root, line });

  return (
    <>
      <IconButton
        icon="copy"
        title={t("title")}
        small
        onClick={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          setAt({ x: rect.left, y: rect.bottom + 4 });
        }}
      />
      {at && (
        <ContextMenu
          x={at.x}
          y={at.y}
          onClose={() => setAt(null)}
          items={choices.map((choice) => ({
            label: t(choice.key as PathChoiceKey),
            icon: choice.key === "name" || choice.key === "nameLine" ? "file" : "copy",
            onClick: () => onCopy(choice.value),
          }))}
        />
      )}
    </>
  );
}
