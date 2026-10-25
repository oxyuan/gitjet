import type { Commit } from "./mygo";

/** How a commit is drawn in the log's graph column. */
export interface GraphRow {
  /** The lane the commit itself sits on. */
  lane: number;
  /** Lanes entering this row from above. */
  before: (string | null)[];
  /** Lanes leaving this row downwards. */
  after: (string | null)[];
  /** Edges from the commit to its parents, by lane. */
  edges: number[];
  /** Colour index of the commit's lane. */
  color: number;
}

const LANE_COLORS = 6;

/**
 * computeGraph lays commits out in lanes: each commit stays on its lane,
 * its first parent continues straight down, and additional parents branch
 * into free lanes. The log must be in topological order, which
 * `git log --topo-order` provides.
 */
export function computeGraph(commits: Commit[]): GraphRow[] {
  const lanes: (string | null)[] = [];
  const rows: GraphRow[] = [];
  const firstFree = () => {
    const i = lanes.indexOf(null);
    return i === -1 ? lanes.length : i;
  };

  for (const commit of commits) {
    const before = lanes.slice();
    let lane = lanes.indexOf(commit.hash);
    if (lane === -1) {
      lane = firstFree();
    }
    while (lanes.length <= lane) lanes.push(null);
    lanes[lane] = commit.hash;

    // The commit goes; its parents take over lanes.
    lanes[lane] = null;
    const edges: number[] = [];
    const parents = commit.parents;
    for (let i = 0; i < parents.length; i++) {
      const parent = parents[i]!;
      let target = lanes.indexOf(parent);
      if (target === -1) {
        target = i === 0 ? lane : firstFree();
        while (lanes.length <= target) lanes.push(null);
        lanes[target] = parent;
      }
      edges.push(target);
    }
    while (lanes.length > 0 && lanes[lanes.length - 1] === null) lanes.pop();
    rows.push({
      lane,
      before,
      after: lanes.slice(),
      edges,
      color: lane % LANE_COLORS,
    });
  }
  return rows;
}

/** graphWidth returns how wide the graph column must be for these rows. */
export function graphWidth(rows: GraphRow[]): number {
  let max = 0;
  for (const row of rows) {
    max = Math.max(max, row.before.length, row.after.length, row.lane + 1, ...row.edges.map((e) => e + 1));
  }
  return Math.max(2, Math.min(max, 14)) * 14 + 4;
}
