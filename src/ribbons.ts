/** The three kinds of change a diff paints, using the same names the merge
 *  bands use. */
export type RibbonTone = "inserted" | "deleted" | "modified";

export interface RibbonSpan {
  /** First pixel row the side's text covers. */
  top: number;
  /** One past the last pixel row the side's text covers. */
  bottom: number;
}

/** What happened to a change block: a change with text on both sides is a
 *  modification, one with text on a single side is an insertion or a
 *  deletion. This is `DiffUtil.getDiffType` in IDEA. */
export function ribbonTone(hasLeft: boolean, hasRight: boolean): RibbonTone {
  if (hasLeft && hasRight) return "modified";
  return hasLeft ? "deleted" : "inserted";
}

/**
 * The path of one divider ribbon, the trapezium IDEA draws between the two
 * panes (`DiffDrawUtil.drawCurveTrapezium`): the top and bottom edges are
 * cubic curves whose control points sit at 30% and 70% of the divider width,
 * so a block that is taller on one side tapers the way the IDE's does.
 *
 * A side with no lines is a points-zero range; IDEA draws it as a one-pixel
 * line (`DividerPolygon`), which keeps the path sane and the taper visible.
 */
export function ribbonPath(x1: number, x2: number, left: RibbonSpan, right: RibbonSpan): string {
  const width = x2 - x1;
  const leftTop = left.top;
  const leftBottom = left.bottom > left.top ? left.bottom : left.top + 1;
  const rightTop = right.top;
  const rightBottom = right.bottom > right.top ? right.bottom : right.top + 1;
  const c1 = x1 + width * 0.3;
  const c2 = x1 + width * 0.7;
  const n = (value: number) => Math.round(value * 10) / 10;
  return [
    `M${n(x1)},${n(leftTop)}`,
    `C${n(c1)},${n(leftTop)} ${n(c2)},${n(rightTop)} ${n(x2)},${n(rightTop)}`,
    `L${n(x2)},${n(rightBottom)}`,
    `C${n(c2)},${n(rightBottom)} ${n(c1)},${n(leftBottom)} ${n(x1)},${n(leftBottom)}`,
    "Z",
  ].join(" ");
}
