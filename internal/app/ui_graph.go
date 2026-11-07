package app

import "gitjet/internal/git"

// The log's graph column: each commit stays on its lane, its first parent
// continues straight down, and extra parents branch into free lanes.

type graphRow struct {
	lane   int
	before []string
	after  []string
	edges  []int
	faint  []bool
}

const (
	graphLaneWidth = 14
	graphMaxLanes  = 8
	graphFaintRows = 12
)

func computeGraph(commits []git.Commit) []graphRow {
	lanes := []string{}
	present := map[string]bool{}
	at := map[string]int{}
	for i, c := range commits {
		present[c.Hash] = true
		if _, ok := at[c.Hash]; !ok {
			at[c.Hash] = i
		}
	}
	firstFree := func() int {
		for i, h := range lanes {
			if h == "" {
				return i
			}
		}
		if len(lanes) >= graphMaxLanes {
			return graphMaxLanes - 1
		}
		return len(lanes)
	}
	rows := make([]graphRow, 0, len(commits))
	for _, c := range commits {
		before := append([]string(nil), lanes...)
		lane := -1
		for i, h := range lanes {
			if h == c.Hash {
				lane = i
				break
			}
		}
		if lane < 0 {
			lane = firstFree()
		}
		for len(lanes) <= lane {
			lanes = append(lanes, "")
		}
		lanes[lane] = c.Hash
		lanes[lane] = ""
		var edges []int
		for i, parent := range c.Parents {
			target := -1
			for j, h := range lanes {
				if h == parent {
					target = j
					break
				}
			}
			if target < 0 {
				if i == 0 {
					target = lane
				} else {
					target = firstFree()
				}
				for len(lanes) <= target {
					lanes = append(lanes, "")
				}
				if present[parent] {
					lanes[target] = parent
				} else {
					lanes[target] = ""
				}
			}
			edges = append(edges, target)
		}
		for len(lanes) > 0 && lanes[len(lanes)-1] == "" {
			lanes = lanes[:len(lanes)-1]
		}
		faint := make([]bool, len(before))
		for i, h := range before {
			faint[i] = h != "" && at[h]-len(rows) > graphFaintRows
		}
		rows = append(rows, graphRow{
			lane:   lane,
			before: before,
			after:  append([]string(nil), lanes...),
			edges:  edges,
			faint:  faint,
		})
	}
	return rows
}

func graphWidth(rows []graphRow) float32 {
	maxLane := 0
	for _, row := range rows {
		if row.lane+1 > maxLane {
			maxLane = row.lane + 1
		}
		if len(row.before) > maxLane {
			maxLane = len(row.before)
		}
		if len(row.after) > maxLane {
			maxLane = len(row.after)
		}
		for _, e := range row.edges {
			if e+1 > maxLane {
				maxLane = e + 1
			}
		}
	}
	if maxLane < 2 {
		maxLane = 2
	}
	if maxLane > 14 {
		maxLane = 14
	}
	return float32(maxLane*graphLaneWidth + 4)
}
