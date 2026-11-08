package git

import "strings"

// MergeLabels name the three sides in the markers a merge leaves behind.
// They are the same labels git writes, so a file finished here looks like a
// file finished by `git merge-file`.
type MergeLabels struct {
	Ours   string `json:"ours"`
	Base   string `json:"base"`
	Theirs string `json:"theirs"`
}

func (l MergeLabels) withDefaults() MergeLabels {
	if strings.TrimSpace(l.Ours) == "" {
		l.Ours = "ours"
	}
	if strings.TrimSpace(l.Base) == "" {
		l.Base = "base"
	}
	if strings.TrimSpace(l.Theirs) == "" {
		l.Theirs = "theirs"
	}
	return l
}

// lcsCellLimit bounds the table a line match may build. A conflict file of a
// few thousand lines stays far below it; past that the merge falls back to
// unique-line anchors, which need no table at all.
const lcsCellLimit = 4 << 20

// MergeText merges two revisions of a text against their common base, the
// way git's diff3 strategy does: line by line, keeping both sides where they
// agree and marking a region that both sides changed differently with
// conflict markers. It returns the merged text and the number of conflict
// blocks left in it.
//
// Nothing is read from or written to the repository: the three texts are the
// whole input, which is what makes an in-memory resolution possible.
func MergeText(base, ours, theirs string, labels MergeLabels) (string, int) {
	labels = labels.withDefaults()
	b := splitMergeLines(base)
	o := splitMergeLines(ours)
	t := splitMergeLines(theirs)

	// Unchanged lines at both ends need no diff at all, and trimming them
	// is what keeps a one-line conflict in a large file cheap.
	pre := 0
	for pre < len(b) && pre < len(o) && pre < len(t) && b[pre] == o[pre] && b[pre] == t[pre] {
		pre++
	}
	suf := 0
	for suf < len(b)-pre && suf < len(o)-pre && suf < len(t)-pre {
		if b[len(b)-1-suf] != o[len(o)-1-suf] || b[len(b)-1-suf] != t[len(t)-1-suf] {
			break
		}
		suf++
	}

	var out strings.Builder
	for _, line := range b[:pre] {
		out.WriteString(line)
	}
	middle, conflicts := mergeMiddle(b[pre:len(b)-suf], o[pre:len(o)-suf], t[pre:len(t)-suf], labels)
	out.WriteString(middle)
	for _, line := range b[len(b)-suf:] {
		out.WriteString(line)
	}
	return out.String(), conflicts
}

// splitMergeLines keeps the newline on each line: a line that lost its
// newline is a difference, not the same text.
func splitMergeLines(text string) []string {
	if text == "" {
		return nil
	}
	lines := strings.SplitAfter(text, "\n")
	if lines[len(lines)-1] == "" {
		lines = lines[:len(lines)-1]
	}
	return lines
}

// mergeMiddle walks the base once, taking the longest stretches both sides
// still agree on as sync points and deciding each stretch between them.
func mergeMiddle(base, ours, theirs []string, labels MergeLabels) (string, int) {
	toOurs := matchIndex(base, ours)
	toTheirs := matchIndex(base, theirs)
	var out strings.Builder
	conflicts := 0
	i, j, k := 0, 0, 0
	for {
		anchor := -1
		for x := i; x < len(base); x++ {
			ox, okOurs := toOurs[x]
			tx, okTheirs := toTheirs[x]
			if okOurs && okTheirs && ox >= j && tx >= k {
				anchor = x
				break
			}
		}
		endBase, endOurs, endTheirs := len(base), len(ours), len(theirs)
		if anchor >= 0 {
			endBase, endOurs, endTheirs = anchor, toOurs[anchor], toTheirs[anchor]
		}
		text, count := mergeChunk(base[i:endBase], ours[j:endOurs], theirs[k:endTheirs], labels)
		out.WriteString(text)
		conflicts += count
		if anchor < 0 {
			return out.String(), conflicts
		}
		// The anchor is a line all three revisions share.
		out.WriteString(base[anchor])
		i, j, k = anchor+1, toOurs[anchor]+1, toTheirs[anchor]+1
	}
}

// mergeChunk decides one stretch between sync points: a side that did not
// touch it defers to the other, both sides agreeing is a clean merge, and
// anything else is a conflict the reader resolves.
func mergeChunk(base, ours, theirs []string, labels MergeLabels) (string, int) {
	switch {
	case sameLines(ours, theirs):
		return joinLines(ours), 0
	case sameLines(ours, base):
		return joinLines(theirs), 0
	case sameLines(theirs, base):
		return joinLines(ours), 0
	}
	var out strings.Builder
	writeMarkerLine(&out, "<<<<<<< "+labels.Ours)
	for _, line := range ours {
		writeMarkerLine(&out, line)
	}
	writeMarkerLine(&out, "||||||| "+labels.Base)
	for _, line := range base {
		writeMarkerLine(&out, line)
	}
	writeMarkerLine(&out, "=======")
	for _, line := range theirs {
		writeMarkerLine(&out, line)
	}
	writeMarkerLine(&out, ">>>>>>> "+labels.Theirs)
	return out.String(), 1
}

// writeMarkerLine writes one line of a conflict block. A side whose last
// line has no newline would otherwise glue the next marker onto the text.
func writeMarkerLine(out *strings.Builder, line string) {
	out.WriteString(line)
	if !strings.HasSuffix(line, "\n") {
		out.WriteString("\n")
	}
}

func joinLines(lines []string) string {
	var out strings.Builder
	for _, line := range lines {
		out.WriteString(line)
	}
	return out.String()
}

func sameLines(a, b []string) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}

// matchIndex maps a base line to the line it corresponds to in other, for
// the lines the two share in order.
func matchIndex(base, other []string) map[int]int {
	matched := make(map[int]int)
	for _, pair := range lineMatches(base, other) {
		matched[pair[0]] = pair[1]
	}
	return matched
}

// lineMatches returns the index pairs of a longest common subsequence.
func lineMatches(a, b []string) [][2]int {
	if len(a) == 0 || len(b) == 0 {
		return nil
	}
	if len(a)*len(b) > lcsCellLimit {
		return anchorMatches(a, b)
	}
	width := len(b) + 1
	table := make([]uint32, (len(a)+1)*width)
	for i := len(a) - 1; i >= 0; i-- {
		row := i * width
		next := row + width
		for j := len(b) - 1; j >= 0; j-- {
			switch {
			case a[i] == b[j]:
				table[row+j] = table[next+j+1] + 1
			case table[next+j] >= table[row+j+1]:
				table[row+j] = table[next+j]
			default:
				table[row+j] = table[row+j+1]
			}
		}
	}
	pairs := make([][2]int, 0, table[0])
	i, j := 0, 0
	for i < len(a) && j < len(b) {
		switch {
		case a[i] == b[j]:
			pairs = append(pairs, [2]int{i, j})
			i++
			j++
		case table[(i+1)*width+j] >= table[i*width+j+1]:
			i++
		default:
			j++
		}
	}
	return pairs
}

// anchorMatches matches lines that appear exactly once on both sides and in
// the same order. It is the patience-diff idea: a fair set of sync points
// for a file too large to build a table for, and an honest fallback to "one
// conflict" when there is none.
func anchorMatches(a, b []string) [][2]int {
	countA := make(map[string]int, len(a))
	countB := make(map[string]int, len(b))
	for _, line := range a {
		countA[line]++
	}
	for _, line := range b {
		countB[line]++
	}
	positionB := make(map[string]int, len(b))
	for j, line := range b {
		if countA[line] == 1 && countB[line] == 1 {
			positionB[line] = j
		}
	}
	var indexesA, indexesB []int
	for i, line := range a {
		if j, ok := positionB[line]; ok {
			indexesA = append(indexesA, i)
			indexesB = append(indexesB, j)
		}
	}
	if len(indexesA) == 0 {
		return nil
	}
	// Longest increasing subsequence of the positions in b, so the anchors
	// stay in order on both sides.
	tails := make([]int, 0, len(indexesB))
	parent := make([]int, len(indexesB))
	for i := range parent {
		parent[i] = -1
	}
	for i, value := range indexesB {
		lo, hi := 0, len(tails)
		for lo < hi {
			mid := (lo + hi) / 2
			if indexesB[tails[mid]] < value {
				lo = mid + 1
			} else {
				hi = mid
			}
		}
		if lo > 0 {
			parent[i] = tails[lo-1]
		}
		if lo == len(tails) {
			tails = append(tails, i)
		} else {
			tails[lo] = i
		}
	}
	pairs := make([][2]int, 0, len(tails))
	for at := tails[len(tails)-1]; at >= 0; at = parent[at] {
		pairs = append(pairs, [2]int{indexesA[at], indexesB[at]})
	}
	for i, j := 0, len(pairs)-1; i < j; i, j = i+1, j-1 {
		pairs[i], pairs[j] = pairs[j], pairs[i]
	}
	return pairs
}
