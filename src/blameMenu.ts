import type { BlameLine } from "./mygo";
import { formatWhen, type ContextItem } from "./ui";

/** The words one blame menu needs; each surface owns its dictionary. */
export interface BlameMenuLabels {
  uncommitted: string;
  lineHistory: string;
  copyHash: string;
  annotate: string;
  closeAnnotations: string;
  /** Offered only where the reader is not already looking at the diff. */
  commitFileDiff?: string;
}

/** The Git menu a gutter opens: the line's blame, where to go next, and the
 *  annotation toggle. Source and diff gutters share it so one click means the
 *  same thing everywhere. */
export function blameMenuItems({
  blame,
  line,
  labels,
  annotate,
  onToggleAnnotate,
  onLineHistory,
  onCommitDiff,
  onCopy,
}: {
  blame?: BlameLine | null;
  line: number;
  labels: BlameMenuLabels;
  annotate: boolean;
  onToggleAnnotate?: () => void;
  onLineHistory?: (line: number) => void;
  onCommitDiff?: (hash: string) => void;
  onCopy?: (text: string) => void;
}): ContextItem[] {
  const items: ContextItem[] = [];
  const hash = blame && !blame.uncommitted ? blame.commit : "";
  if (blame) {
    items.push(
      blame.uncommitted
        ? { header: true, label: labels.uncommitted }
        : { header: true, label: `${blame.short} · ${blame.author} · ${formatWhen(blame.time)}` },
    );
    // git labels a local line "Version of … from …", which is noise here.
    if (!blame.uncommitted && blame.summary) items.push({ header: true, label: blame.summary });
    items.push({ separator: true });
  }
  if (labels.commitFileDiff) {
    items.push({
      label: labels.commitFileDiff,
      icon: "diff",
      disabled: !hash || !onCommitDiff,
      onClick: () => onCommitDiff?.(hash),
    });
  }
  items.push({
    label: labels.lineHistory,
    icon: "log",
    disabled: !onLineHistory,
    onClick: () => onLineHistory?.(line),
  });
  if (hash) {
    items.push({
      label: labels.copyHash,
      icon: "copy",
      disabled: !onCopy,
      onClick: () => onCopy?.(hash),
    });
  }
  items.push({ separator: true });
  items.push({
    label: annotate ? labels.closeAnnotations : labels.annotate,
    icon: "user",
    disabled: !onToggleAnnotate,
    onClick: () => onToggleAnnotate?.(),
  });
  return items;
}
