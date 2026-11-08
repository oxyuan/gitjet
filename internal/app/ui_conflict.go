package app

import (
	"fmt"
	"strings"

	"github.com/egoist/mygo"
	"github.com/egoist/mygo/ui"
	"github.com/egoist/mygo/ui/editor"

	"gitjet/internal/git"
)

// The merge editor: one window per conflicted file, with the local, result
// and remote text side by side. Resolution works on the working file's
// blocks; saving writes the result and stages it when nothing is left
// unresolved.

type mergeWindow struct {
	app         *nativeApp
	path        string
	win         *mygo.Window
	content     git.ConflictContent
	err         string
	busy        bool
	merged      string
	ours        *editor.State
	theirs      *editor.State
	result      *editor.Buffer
	resultState *editor.State
	blocks      []mergeBlock
	choice      []mergeChoice
	selected    int
	sync        bool
	details     git.MergeDetails
	undo        [][]mergeChoice
	redo        [][]mergeChoice
}

type mergeChoice uint8

const (
	blockUnresolved mergeChoice = iota
	blockOurs
	blockTheirs
	blockBase
	blockEdited
)

type mergeBlock struct {
	start, end int // byte range in the original working text
	ours       string
	theirs     string
	base       string
}

func openMergeEditor(a *nativeApp, path string) {
	if m := a.merge; m != nil && m.path == path {
		a.redraw()
		return
	}
	m := &mergeWindow{app: a, path: path, sync: true}
	a.merge = m
	m.load()
	go func() {
		details, err := m.app.g.MergeDetails()
		if err == nil {
			mygo.RunOnMain(func() {
				m.details = details
				m.invalidate()
			})
		}
	}()
}

func (m *mergeWindow) invalidate() {
	if m.win != nil {
		m.win.Invalidate()
		return
	}
	m.app.redraw()
}

func (m *mergeWindow) close() {
	if m.win != nil {
		m.win.Close()
		return
	}
	if m.app.merge == m {
		m.app.merge = nil
	}
	m.app.redraw()
}

func (m *mergeWindow) load() {
	go func() {
		cc, err := m.app.g.Conflict(m.path)
		mygo.RunOnMain(func() {
			if err != nil {
				m.err = err.Error()
				m.app.redraw()
				return
			}
			m.content = cc
			m.build()
			m.invalidate()
		})
	}()
}

// build splits the working file at conflict markers. Text outside a block
// is kept as it is; each block defaults to the local side.
func (m *mergeWindow) build() {
	working := normalizeNewlines(m.content.Working)
	ours := normalizeNewlines(m.content.Ours)
	theirs := normalizeNewlines(m.content.Theirs)
	_ = ours
	_ = theirs
	var result strings.Builder
	m.blocks = m.blocks[:0]
	pos := 0
	for {
		i := strings.Index(working[pos:], "<<<<<<<")
		if i < 0 {
			result.WriteString(working[pos:])
			break
		}
		i += pos
		result.WriteString(working[pos:i])
		rest := working[i:]
		endMarker := strings.Index(rest, ">>>>>>>")
		if endMarker < 0 {
			result.WriteString(rest)
			break
		}
		end := i + endMarker + len(">>>>>>>")
		if nl := strings.IndexByte(working[end:], '\n'); nl >= 0 {
			end += nl + 1
		}
		blockText := working[i:end]
		sections := splitConflict(blockText)
		m.blocks = append(m.blocks, mergeBlock{start: i, end: end, ours: sections[0], base: sections[1], theirs: sections[2]})
		result.WriteString(sections[0])
		pos = end
	}
	m.merged = result.String()
	m.result = editor.NewBuffer(m.merged)
	m.result.SetLanguage(editor.LanguageFor(m.path))
	m.resultState = &editor.State{Buffer: m.result, LineHeight: 1.5}
	lang := editor.LanguageFor(m.path)
	oursBuf := editor.NewBuffer(m.content.Ours)
	theirsBuf := editor.NewBuffer(m.content.Theirs)
	oursBuf.SetLanguage(lang)
	theirsBuf.SetLanguage(lang)
	m.ours = &editor.State{Buffer: oursBuf, ReadOnly: true, LineHeight: 1.5}
	m.theirs = &editor.State{Buffer: theirsBuf, ReadOnly: true, LineHeight: 1.5}
	m.choice = make([]mergeChoice, len(m.blocks))
}

// splitConflict returns the ours, base and theirs text of one marker block.
func splitConflict(block string) [3]string {
	var out [3]string
	lines := strings.SplitAfter(block, "\n")
	var cur strings.Builder
	section := 0
	flush := func() {
		out[section] = cur.String()
		cur.Reset()
	}
	for _, line := range lines {
		trimmed := strings.TrimRight(line, "\r\n")
		switch {
		case strings.HasPrefix(trimmed, "<<<<<<<"):
			section = 0
			continue
		case strings.HasPrefix(trimmed, "|||||||"):
			flush()
			section = 1
			continue
		case strings.HasPrefix(trimmed, "======="):
			flush()
			section = 2
			continue
		case strings.HasPrefix(trimmed, ">>>>>>>"):
			flush()
			continue
		}
		cur.WriteString(line)
	}
	return out
}

func normalizeNewlines(s string) string {
	s = strings.ReplaceAll(s, "\r\n", "\n")
	return strings.ReplaceAll(s, "\r", "\n")
}

func (m *mergeWindow) view(c *ui.Context) {
	theme := m.app.theme
	if theme == nil {
		theme = gitjetTheme(false)
	}
	ui.Themed(c, theme).Fill().Children(func() {
		m.body(c)
	})
}

func (a *nativeApp) mergeView(c *ui.Context) {
	m := a.merge
	if m == nil {
		return
	}
	p := palette(c.Theme())
	ui.Overlay(c, func() {
		ui.Box(c).Absolute().Fill().Background(ui.RGBA(10, 14, 22, 0.32))
		panel := ui.Column(c).Absolute().Left(24).Right(24).Top(24).Bottom(24).Radius(16).
			Background(ui.Hex(p.editor)).Border(1, ui.Hex(p.border)).
			Shadow(0, 30, 80, 0, ui.RGBA(16, 20, 40, 0.24)).Clip()
		panel.Children(func() { m.body(c) })
	})
}

func (m *mergeWindow) body(c *ui.Context) {
	t := c.Theme()
	c.OnWindowShortcut(0, ui.KeyF7, func() {
		if len(m.blocks) > 0 {
			m.selected = (m.selected + 1) % len(m.blocks)
			m.invalidate()
		}
	})
	c.OnWindowShortcut(ui.Shift, ui.KeyF7, func() {
		if len(m.blocks) > 0 {
			m.selected = (m.selected + len(m.blocks) - 1) % len(m.blocks)
			m.invalidate()
		}
	})
	c.OnWindowShortcut(ui.Alt, ui.KeyLeft, func() { m.choose(m.selected, blockOurs); m.invalidate() })
	c.OnWindowShortcut(ui.Alt, ui.KeyRight, func() { m.choose(m.selected, blockTheirs); m.invalidate() })
	c.OnWindowShortcut(ui.Cmd|ui.Ctrl, ui.KeyLeft, func() { m.choose(m.selected, blockOurs); m.invalidate() })
	c.OnWindowShortcut(ui.Cmd|ui.Ctrl, ui.KeyRight, func() { m.choose(m.selected, blockTheirs); m.invalidate() })
	c.OnWindowShortcut(ui.Cmd, ui.KeyZ, func() { m.undoChoice(); m.invalidate() })
	c.OnWindowShortcut(ui.Cmd|ui.Shift, ui.KeyZ, func() { m.redoChoice(); m.invalidate() })
	ui.Column(c).Fill().Background(t.Background).Children(func() {
		ui.Row(c).Height(46).Padding(0, 12).Gap(8).AlignItems(ui.Center).BorderWidth(0, 0, 1, 0).BorderColor(t.Border).Children(func() {
			ui.Text(c, "Merge "+m.path).FontSize(13).FontWeight(600)
			st := m.app.snapshot.State
			if m.details.Ours.Branch != "" || m.details.Theirs.Branch != "" {
				ui.Text(c, m.details.Ours.Branch+" → "+m.details.Theirs.Branch).FontSize(10).TextColor(t.TextMuted)
			} else if st.OpOurs != "" || st.OpTheirs != "" {
				ui.Text(c, st.OpOurs+" → "+st.OpTheirs).FontSize(10).TextColor(t.TextMuted)
			}
			ui.Spacer(c).Grow(1)
			if m.app.merge == m {
				if _, clicked := m.app.kitIconButton(c, "close", m.app.t("Close"), 28, 14, false, false, false); clicked {
					m.close()
				}
			}
			if _, clicked := m.app.kitIconButton(c, "undo", m.app.t("Undo"), 28, 14, len(m.undo) == 0, false, false); clicked {
				m.undoChoice()
				m.invalidate()
			}
			if _, clicked := m.app.kitIconButton(c, "redo", m.app.t("Redo"), 28, 14, len(m.redo) == 0, false, false); clicked {
				m.redoChoice()
				m.invalidate()
			}
			if m.err != "" {
				ui.Text(c, m.err).FontSize(10).TextColor(t.Danger)
			}
			if m.busy {
				ui.Spinner(c)
			}
			if ui.Button(c, m.app.t("Apply")).Clicked() {
				m.apply(false)
			}
			if ui.Button(c, m.app.t("Apply and Finish")).Clicked() {
				m.apply(true)
			}
		})
		if m.content.Binary {
			ui.Column(c).Fill().Center().Gap(10).Children(func() {
				ui.Text(c, m.app.t("Binary conflict — choose a side")).FontSize(13)
				ui.Row(c).Gap(8).Children(func() {
					if ui.Button(c, m.app.t("Accept Ours")).Clicked() {
						m.app.takeSide(m.path, "ours")
						m.close()
					}
					if ui.Button(c, m.app.t("Accept Theirs")).Clicked() {
						m.app.takeSide(m.path, "theirs")
						m.close()
					}
				})
			})
			return
		}
		if m.result == nil {
			ui.Column(c).Fill().Center().Children(func() { ui.Spinner(c) })
			return
		}
		if m.sync && m.resultState != nil {
			y := m.resultState.ScrollY()
			m.ours.SetScrollY(y)
			m.theirs.SetScrollY(y)
		}
		ui.Row(c).Grow(1).AlignItems(ui.Stretch).Children(func() {
			ours := m.app.snapshot.State.OpOurs
			if ours == "" {
				ours = m.app.t("Ours")
			}
			theirs := m.app.snapshot.State.OpTheirs
			if theirs == "" {
				theirs = m.app.t("Theirs")
			}
			m.side(c, ours, m.ours, "ours")
			m.resultPane(c)
			m.side(c, theirs, m.theirs, "theirs")
		})
		ui.Row(c).Height(32).Padding(0, 10).Gap(8).AlignItems(ui.Center).BorderWidth(1, 0, 0, 0).BorderColor(t.Border).Children(func() {
			unresolved := 0
			for i := range m.blocks {
				if m.choice[i] == blockUnresolved {
					unresolved++
				}
			}
			ui.Text(c, fmt.Sprintf("%d of %d blocks unresolved", unresolved, len(m.blocks))).FontSize(10).TextColor(t.TextMuted)
			kitCheckbox(c, &m.sync, m.app.t("Sync scroll"))
			ui.Spacer(c).Grow(1)
			if ui.Button(c, m.app.t("Accept All Ours")).Clicked() {
				m.acceptAll("ours")
			}
			if ui.Button(c, m.app.t("Accept All Theirs")).Clicked() {
				m.acceptAll("theirs")
			}
			if ui.Button(c, m.app.t("Resolve Simple")).Clicked() {
				m.resolveSimple()
			}
		})
	})
}

func (m *mergeWindow) resolveSimple() {
	for i, b := range m.blocks {
		if text, ok := simpleBlock(b.ours, b.base, b.theirs); ok {
			if text == b.theirs {
				m.choice[i] = blockTheirs
			} else {
				m.choice[i] = blockOurs
			}
		}
	}
	m.rebuildResult()
	m.invalidate()
}

func (m *mergeWindow) side(c *ui.Context, title string, state *editor.State, side string) {
	t := c.Theme()
	ui.Column(c).Grow(1).MinWidth(0).BorderWidth(0, 1, 0, 1).BorderColor(t.Border).Children(func() {
		ui.Row(c).Height(28).Padding(0, 8).Gap(6).Children(func() {
			ui.Text(c, title).FontSize(10).TextColor(t.TextMuted)
			ui.Spacer(c).Grow(1)
			if ui.Button(c, "→").Clicked() {
				m.acceptAll(side)
			}
		})
		state.Theme = editorTheme(t)
		editor.View(c, state).Grow(1).FillWidth()
	})
}

func (m *mergeWindow) resultPane(c *ui.Context) {
	t := c.Theme()
	ui.Column(c).Grow(1).MinWidth(0).Children(func() {
		ui.Row(c).Height(28).Padding(0, 8).Gap(6).Children(func() {
			ui.Text(c, m.app.t("Result")).FontSize(10).TextColor(t.TextMuted)
			ui.Spacer(c).Grow(1)
			if m.selected >= 0 && m.selected < len(m.blocks) {
				ui.Text(c, fmt.Sprintf("%d/%d", m.selected+1, len(m.blocks))).FontSize(10).TextColor(t.TextMuted)
				if ui.Button(c, "↑").Clicked() {
					m.selected--
				}
				if ui.Button(c, "↓").Clicked() {
					m.selected++
				}
				if ui.Button(c, "◀").Clicked() {
					m.choose(m.selected, blockOurs)
				}
				if ui.Button(c, "▶").Clicked() {
					m.choose(m.selected, blockTheirs)
				}
				if ui.Button(c, "✕").Clicked() {
					m.choose(m.selected, blockBase)
				}
			}
		})
		m.result.SetLanguage(editor.LanguageFor(m.path))
		if m.resultState == nil {
			m.resultState = &editor.State{Buffer: m.result, LineHeight: 1.5}
		}
		m.resultState.Theme = editorTheme(t)
		editor.View(c, m.resultState).Grow(1).FillWidth()
	})
}

func (m *mergeWindow) acceptAll(side string) {
	for i := range m.blocks {
		if side == "ours" {
			m.choose(i, blockOurs)
		} else {
			m.choose(i, blockTheirs)
		}
	}
	m.invalidate()
}

// choose writes one side of a block into the result at the block's byte
// range, then rebuilds the result text.
func (m *mergeWindow) choose(i int, choice mergeChoice) {
	if i < 0 || i >= len(m.blocks) {
		return
	}
	m.undo = append(m.undo, append([]mergeChoice(nil), m.choice...))
	if len(m.undo) > 100 {
		m.undo = m.undo[1:]
	}
	m.redo = nil
	m.choice[i] = choice
	m.rebuildResult()
}

func (m *mergeWindow) undoChoice() {
	if len(m.undo) == 0 {
		return
	}
	m.redo = append(m.redo, append([]mergeChoice(nil), m.choice...))
	last := len(m.undo) - 1
	m.choice = m.undo[last]
	m.undo = m.undo[:last]
	m.rebuildResult()
}

func (m *mergeWindow) redoChoice() {
	if len(m.redo) == 0 {
		return
	}
	m.undo = append(m.undo, append([]mergeChoice(nil), m.choice...))
	last := len(m.redo) - 1
	m.choice = m.redo[last]
	m.redo = m.redo[:last]
	m.rebuildResult()
}

func (m *mergeWindow) rebuildResult() {
	working := normalizeNewlines(m.content.Working)
	var out strings.Builder
	last := 0
	for i, b := range m.blocks {
		out.WriteString(working[last:b.start])
		switch m.choice[i] {
		case blockTheirs:
			out.WriteString(b.theirs)
		case blockBase:
			out.WriteString(b.base)
		default:
			out.WriteString(b.ours)
		}
		last = b.end
	}
	out.WriteString(working[last:])
	m.merged = out.String()
	if m.result != nil {
		m.result.Reset(m.merged)
		m.result.MarkSaved()
	}
}

func (m *mergeWindow) apply(finish bool) {
	if m.result == nil {
		return
	}
	if m.result.Modified() {
		m.merged = m.result.String()
	}
	unresolved := 0
	for i := range m.blocks {
		if m.choice[i] == blockUnresolved {
			unresolved++
		}
	}
	text := m.merged
	if m.result.Modified() {
		// An edit in the result is the user's resolution of every block
		// it touches; saving stages it as it is.
		unresolved = 0
	}
	stage := unresolved == 0
	if unresolved > 0 {
		// Keep the markers for the blocks still unresolved, so the file
		// stays unmerged and can be opened again.
		text = m.withMarkers(unresolved)
	}
	m.busy = true
	m.invalidate()
	path := m.path
	go func() {
		err := m.app.g.SaveResolution(path, text, stage)
		mygo.RunOnMain(func() {
			m.busy = false
			if err != nil {
				m.err = err.Error()
				m.invalidate()
				return
			}
			m.app.refresh()
			if stage || (finish && unresolved == 0) {
				m.close()
			} else {
				m.invalidate()
			}
		})
	}()
}

func (m *mergeWindow) withMarkers(unresolved int) string {
	working := normalizeNewlines(m.content.Working)
	var out strings.Builder
	last := 0
	for i, b := range m.blocks {
		out.WriteString(working[last:b.start])
		if m.choice[i] == blockUnresolved {
			out.WriteString("<<<<<<< HEAD\n")
			out.WriteString(b.ours)
			out.WriteString("=======\n")
			out.WriteString(b.theirs)
			out.WriteString(">>>>>>>\n")
		} else {
			switch m.choice[i] {
			case blockTheirs:
				out.WriteString(b.theirs)
			case blockBase:
				out.WriteString(b.base)
			default:
				out.WriteString(b.ours)
			}
		}
		last = b.end
	}
	out.WriteString(working[last:])
	return out.String()
}

// resolveSimpleText resolves the conflict blocks git wrote into working
// when one side kept the base text, or both sides agree, and leaves the
// rest marked. It reports how many blocks remain.
func resolveSimpleText(working string) (string, int) {
	var out strings.Builder
	pos := 0
	remaining := 0
	for {
		i := strings.Index(working[pos:], "<<<<<<<")
		if i < 0 {
			out.WriteString(working[pos:])
			break
		}
		i += pos
		out.WriteString(working[pos:i])
		rest := working[i:]
		endMarker := strings.Index(rest, ">>>>>>>")
		if endMarker < 0 {
			out.WriteString(rest)
			break
		}
		end := i + endMarker + len(">>>>>>>")
		if nl := strings.IndexByte(working[end:], '\n'); nl >= 0 {
			end += nl + 1
		}
		sections := splitConflict(working[i:end])
		if lines, ok := simpleBlock(sections[0], sections[1], sections[2]); ok {
			out.WriteString(lines)
		} else {
			remaining++
			out.WriteString(working[i:end])
		}
		pos = end
	}
	return out.String(), remaining
}

// simpleBlock returns one block's text when max one side changed a line
// from the base, or both changed it the same way.
func simpleBlock(ours, base, theirs string) (string, bool) {
	o := conflictLines(ours)
	b := conflictLines(base)
	t := conflictLines(theirs)
	if len(o) == 0 && len(t) > 0 {
		return theirs, true
	}
	if len(t) == 0 && len(o) > 0 {
		return ours, true
	}
	n := len(o)
	if len(b) > n {
		n = len(b)
	}
	if len(t) > n {
		n = len(t)
	}
	out := make([]string, 0, n)
	for i := 0; i < n; i++ {
		ov, ook := lineAt(o, i)
		bv, bok := lineAt(b, i)
		tv, tok := lineAt(t, i)
		oSame := ook == bok && ov == bv
		tSame := tok == bok && tv == bv
		switch {
		case oSame && tSame:
			if ook {
				out = append(out, ov)
			}
		case !oSame && tSame:
			if ook {
				out = append(out, ov)
			}
		case oSame && !tSame:
			if tok {
				out = append(out, tv)
			}
		case ook && tok && ov == tv:
			out = append(out, ov)
		default:
			return "", false
		}
	}
	text := strings.Join(out, "\n")
	if text != "" && !strings.HasSuffix(text, "\n") {
		text += "\n"
	}
	return text, true
}

func conflictLines(s string) []string {
	if s == "" {
		return nil
	}
	s = strings.TrimSuffix(s, "\n")
	if s == "" {
		return []string{""}
	}
	return strings.Split(s, "\n")
}

func lineAt(lines []string, i int) (string, bool) {
	if i < 0 || i >= len(lines) {
		return "", false
	}
	return lines[i], true
}

func closeMergeWindows(a *nativeApp) {
	if a.merge != nil {
		a.merge = nil
	}
}
