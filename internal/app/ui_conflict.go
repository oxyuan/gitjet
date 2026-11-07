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
	app      *nativeApp
	path     string
	win      *mygo.Window
	content  git.ConflictContent
	err      string
	busy     bool
	merged   string
	ours     *editor.State
	theirs   *editor.State
	result   *editor.Buffer
	blocks   []mergeBlock
	choice   []mergeChoice
	selected int
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

var nativeMergeWindows = map[string]*mergeWindow{}

func openMergeEditor(a *nativeApp, path string) {
	if m := nativeMergeWindows[path]; m != nil && m.win != nil && !m.win.IsDestroyed() {
		m.win.Show()
		m.win.Focus()
		return
	}
	m := &mergeWindow{app: a, path: path}
	nativeMergeWindows[path] = m
	m.win = mygo.NewWindow(mygo.WindowOptions{
		Title:           "Merge " + path,
		Width:           1240,
		Height:          800,
		MinWidth:        900,
		MinHeight:       560,
		BackgroundColor: "light-dark(#f5f5f7, #141416)",
		Content:         ui.View(m.view),
	})
	m.win.OnClosed(func() {
		if nativeMergeWindows[path] == m {
			delete(nativeMergeWindows, path)
		}
	})
	m.load()
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
			m.win.Invalidate()
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
	m.ours = &editor.State{Buffer: editor.NewBuffer(m.content.Ours), ReadOnly: true, LineHeight: 1.5}
	m.theirs = &editor.State{Buffer: editor.NewBuffer(m.content.Theirs), ReadOnly: true, LineHeight: 1.5}
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
	t := c.Theme()
	ui.Column(c).Fill().Background(t.Background).Children(func() {
		ui.Row(c).Height(46).Padding(0, 12).Gap(8).AlignItems(ui.Center).BorderWidth(0, 0, 1, 0).BorderColor(t.Border).Children(func() {
			ui.Text(c, "Merge "+m.path).FontSize(13).FontWeight(600)
			ui.Spacer(c).Grow(1)
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
						m.win.Close()
					}
					if ui.Button(c, m.app.t("Accept Theirs")).Clicked() {
						m.app.takeSide(m.path, "theirs")
						m.win.Close()
					}
				})
			})
			return
		}
		if m.result == nil {
			ui.Column(c).Fill().Center().Children(func() { ui.Spinner(c) })
			return
		}
		ui.Row(c).Grow(1).AlignItems(ui.Stretch).Children(func() {
			m.side(c, m.app.t("Ours"), m.ours, "ours")
			m.resultPane(c)
			m.side(c, m.app.t("Theirs"), m.theirs, "theirs")
		})
	})
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
		state.Theme = editor.DefaultTheme(t)
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
		state := &editor.State{Buffer: m.result, LineHeight: 1.5}
		state.Theme = editor.DefaultTheme(t)
		editor.View(c, state).Grow(1).FillWidth()
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
	m.win.Invalidate()
}

// choose writes one side of a block into the result at the block's byte
// range, then rebuilds the result text.
func (m *mergeWindow) choose(i int, choice mergeChoice) {
	if i < 0 || i >= len(m.blocks) {
		return
	}
	m.choice[i] = choice
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
	stage := unresolved == 0
	if unresolved > 0 {
		// Keep the markers for the blocks still unresolved, so the file
		// stays unmerged and can be opened again.
		text = m.withMarkers(unresolved)
	}
	m.busy = true
	m.win.Invalidate()
	path := m.path
	go func() {
		err := m.app.g.SaveResolution(path, text, stage)
		mygo.RunOnMain(func() {
			m.busy = false
			if err != nil {
				m.err = err.Error()
				m.win.Invalidate()
				return
			}
			m.app.refresh()
			if finish || stage {
				m.win.Close()
			} else {
				m.win.Invalidate()
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
