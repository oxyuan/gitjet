package app

import (
	"strings"
	"time"

	"github.com/egoist/mygo/ui"
	"github.com/egoist/mygo/ui/editor"

	"gitjet/internal/git"
)

// appColors are the window's own colors: the palette GitJet had before the
// native view, kept apart from ui.Theme because panels, diffs and the log
// use more shades than a control theme names.
type appColors struct {
	bg, editor, panel, panel2, raised, input, code string
	fg, fgSoft, muted, muted2                      string
	border, borderStrong                           string
	hover, hoverStrong                             string
	selection, selectionStrong                     string
	accent, accentHover, accentSoft, accentAlt     string
	accentText                                     string
	danger, dangerSoft, success, warning           string
	gutter, diffAdd, diffDel, diffAddWord          string
	diffDelWord, diffHunk, diffCurrent             string
	scrollbar                                      string
	added, modified, deleted, renamed              string
	untracked, conflict, ignored                   string
	lane0, lane1, lane2, lane3, lane4, lane5       string
	syntaxComment, syntaxPunct, syntaxTag          string
	syntaxNumber, syntaxString, syntaxOperator     string
	syntaxKeyword, syntaxFunction, syntaxVariable  string
}

func (p appColors) c(s string) ui.Color { return ui.Hex(s) }

var lightColors = appColors{
	bg:              "#f5f5f7",
	editor:          "#fbfbfd",
	panel:           "#f1f1f4",
	panel2:          "#ececf0",
	raised:          "#ffffff",
	input:           "#ffffff",
	code:            "#f7f7fa",
	fg:              "#1d1d1f",
	fgSoft:          "#3c3c43",
	muted:           "#6e6e73",
	muted2:          "#96969d",
	border:          "#00000013",
	borderStrong:    "#00000024",
	hover:           "#0000000b",
	hoverStrong:     "#00000014",
	selection:       "#5b669921",
	selectionStrong: "#5b669938",
	accent:          "#5b6699",
	accentHover:     "#4c5689",
	accentSoft:      "#5b66991a",
	accentAlt:       "#7a6b9e",
	accentText:      "#ffffff",
	danger:          "#d9474f",
	dangerSoft:      "#d9474f1c",
	success:         "#248a5b",
	warning:         "#a8661c",
	gutter:          "#fafafd",
	diffAdd:         "#e9f7ef",
	diffDel:         "#fdf0f0",
	diffAddWord:     "#b7e5c7",
	diffDelWord:     "#f3c6c6",
	diffHunk:        "#f2f2f6",
	diffCurrent:     "#e9a23b",
	scrollbar:       "#0000002e",
	added:           "#248a5b",
	modified:        "#5b6699",
	deleted:         "#d9474f",
	renamed:         "#7a6b9e",
	untracked:       "#b06a1f",
	conflict:        "#d9474f",
	ignored:         "#a0a0a8",
	lane0:           "#5b6699",
	lane1:           "#26a269",
	lane2:           "#c27a2f",
	lane3:           "#8b5cf6",
	lane4:           "#0b93a5",
	lane5:           "#d9474f",
	syntaxComment:   "#7d8590",
	syntaxPunct:     "#626b78",
	syntaxTag:       "#b3541e",
	syntaxNumber:    "#b45309",
	syntaxString:    "#0f766e",
	syntaxOperator:  "#4b5563",
	syntaxKeyword:   "#7c3aed",
	syntaxFunction:  "#2563eb",
	syntaxVariable:  "#be123c",
}

var darkColors = appColors{
	bg:              "#1c1d21",
	editor:          "#212228",
	panel:           "#24252b",
	panel2:          "#292a31",
	raised:          "#2c2d35",
	input:           "#303139",
	code:            "#25262c",
	fg:              "#dfe1e6",
	fgSoft:          "#c3c6cd",
	muted:           "#90939c",
	muted2:          "#6e717a",
	border:          "#ffffff13",
	borderStrong:    "#ffffff24",
	hover:           "#ffffff0e",
	hoverStrong:     "#ffffff1a",
	selection:       "#7f88bb33",
	selectionStrong: "#7f88bb4d",
	accent:          "#7f88bb",
	accentHover:     "#919ac8",
	accentSoft:      "#7f88bb26",
	accentAlt:       "#a99ec4",
	accentText:      "#ffffff",
	danger:          "#f06a70",
	dangerSoft:      "#f06a7024",
	success:         "#6acb94",
	warning:         "#e0a45c",
	gutter:          "#26272d",
	diffAdd:         "#182e22",
	diffDel:         "#331e23",
	diffAddWord:     "#2c5a3e",
	diffDelWord:     "#673238",
	diffHunk:        "#2a2b31",
	diffCurrent:     "#d2a33c",
	scrollbar:       "#ffffff2e",
	added:           "#6acb94",
	modified:        "#9aa3cf",
	deleted:         "#f06a70",
	renamed:         "#ab9fc6",
	untracked:       "#e0a45c",
	conflict:        "#f06a70",
	ignored:         "#71717a",
	lane0:           "#9aa3cf",
	lane1:           "#6acb94",
	lane2:           "#e0a45c",
	lane3:           "#a99ec4",
	lane4:           "#56d4dd",
	lane5:           "#f06a70",
	syntaxComment:   "#7f8a99",
	syntaxPunct:     "#a0a8b4",
	syntaxTag:       "#e0a05a",
	syntaxNumber:    "#f0b46b",
	syntaxString:    "#7fd1b9",
	syntaxOperator:  "#b8c0cc",
	syntaxKeyword:   "#c4a7ff",
	syntaxFunction:  "#8ab4f8",
	syntaxVariable:  "#f28ba8",
}

func palette(t *ui.Theme) appColors {
	if t.Dark {
		return darkColors
	}
	return lightColors
}

// gitjetTheme gives MyGo's controls the colors and metrics of the old page.
func gitjetTheme(dark bool) *ui.Theme {
	var t *ui.Theme
	if dark {
		t = ui.DarkTheme()
	} else {
		t = ui.LightTheme()
	}
	p := lightColors
	if dark {
		p = darkColors
	}
	t.Dark = dark
	t.Background = ui.Hex(p.bg)
	t.Surface = ui.Hex(p.raised)
	t.SurfaceHover = ui.Hex(p.hover)
	t.SurfacePressed = ui.Hex(p.selection)
	t.Border = ui.Hex(p.borderStrong)
	t.Text = ui.Hex(p.fg)
	t.TextMuted = ui.Hex(p.muted)
	t.Accent = ui.Hex(p.accent)
	t.AccentHover = ui.Hex(p.accentHover)
	t.AccentPressed = ui.Hex(p.accentHover)
	t.AccentText = ui.Hex(p.accentText)
	t.InactiveAccent = ui.Hex(p.accent)
	t.Danger = ui.Hex(p.danger)
	t.Warning = ui.Hex(p.warning)
	t.Success = ui.Hex(p.success)
	t.Selection = ui.Hex(p.selectionStrong)
	t.Focus = ui.Hex(p.accent)
	t.FocusRingWidth = 2
	t.FocusRingOffset = 1
	t.Inverse = ui.Hex(p.fg)
	t.InverseText = ui.Hex(p.bg)
	t.Scrollbar = ui.Hex(p.scrollbar)
	t.ScrollbarWidth = 12
	t.Radius = 9
	t.Spacing = 5
	t.FontSize = 12.5
	t.TooltipDelay = 600 * time.Millisecond
	return t
}

// iconPaths are the app's 16px stroke icons, the same drawings the page
// used, so the native toolbar reads like the one it replaces.
var iconPaths = map[string]string{
	"open":         `<path d="M1.8 3.6c0-.5.4-.9.9-.9h3l1.3 1.4h5.3c.5 0 .9.4.9.9v1.1H1.8z"/><path d="M1.8 5.6h12.4l-1.1 6.8c-.1.5-.5.9-1 .9H2.9c-.5 0-.9-.4-1-.9z"/>`,
	"refresh":      `<path d="M13 8a5 5 0 1 1-1.6-3.7"/><path d="M13.2 2.2v3.1H10"/>`,
	"fetch":        `<path d="M8 2v7"/><path d="M5.4 6.6 8 9.2l2.6-2.6"/><path d="M2.4 11v1.5c0 .5.4.9.9.9h9.4c.5 0 .9-.4.9-.9V11"/>`,
	"pull":         `<path d="M8 2v7.4"/><path d="M5.2 6.7 8 9.5l2.8-2.8"/><path d="M2.5 13.2h11"/><path d="M4 11.5h8" opacity=".35"/>`,
	"push":         `<path d="M8 9.6V2.2"/><path d="M5.2 5 8 2.2 10.8 5"/><path d="M2.5 13.2h11"/><path d="M4 11.5h8" opacity=".35"/>`,
	"branch":       `<circle cx="4.4" cy="3.4" r="1.7"/><circle cx="4.4" cy="12.6" r="1.7"/><circle cx="11.6" cy="5.2" r="1.7"/><path d="M4.4 5.1v5.8"/><path d="M11.6 6.9c0 2.6-2.2 3.4-4.4 3.8"/>`,
	"star":         `<path d="m8 1.8 1.9 3.9 4.3.6-3.1 3 .7 4.3-3.8-2-3.8 2 .7-4.3-3.1-3 4.3-.6z"/>`,
	"tag":          `<path d="M2.2 2.2h5.4c.4 0 .8.2 1.1.4l5 5c.5.5.5 1.3 0 1.8l-4.3 4.3c-.5.5-1.3.5-1.8 0l-5-5a1.6 1.6 0 0 1-.4-1.1z"/><circle cx="5.2" cy="5.2" r=".9"/>`,
	"commit":       `<circle cx="8" cy="8" r="3.1"/><path d="M8 1.2v3.7M8 11.1v3.7"/>`,
	"log":          `<circle cx="4" cy="4" r="1.6"/><circle cx="4" cy="12" r="1.6"/><path d="M4 5.6v4.8"/><path d="M7.4 4h6.4M7.4 12h6.4M7.4 8h4.8" opacity=".85"/>`,
	"files":        `<path d="M3.4 1.8h6l3.2 3.2v9.2H3.4z"/><path d="M9.4 1.8v3.2h3.2" opacity=".6"/>`,
	"console":      `<rect x="1.6" y="2.4" width="12.8" height="11.2" rx="1.4"/><path d="m4.4 6 2 2-2 2M8.4 10.2h3.2"/>`,
	"settings":     `<path d="M6.71 3.17 6.29 1.62h3.42l-.42 1.55 2.25 1.29 1.13-1.13 1.71 2.96-1.55.42v2.58l1.55.42-1.71 2.96-1.13-1.13-2.25 1.29.42 1.55H6.29l.42-1.55-2.25-1.29-1.13 1.13L1.62 9.71l1.55-.42V6.71l-1.55-.42 1.71-2.96 1.13 1.13z"/><circle cx="8" cy="8" r="2.25"/>`,
	"search":       `<circle cx="7" cy="7" r="4.3"/><path d="m10.3 10.3 3.5 3.5"/>`,
	"close":        `<path d="m3.5 3.5 9 9M12.5 3.5l-9 9"/>`,
	"chevronDown":  `<path d="m4.2 6 3.8 3.8L11.8 6"/>`,
	"chevronRight": `<path d="m6 4.2 3.8 3.8L6 11.8"/>`,
	"chevronUp":    `<path d="m4.2 10 3.8-3.8L11.8 10"/>`,
	"expand":       `<path d="M9.5 2.5h4v4M6.5 13.5h-4v-4M13.5 2.5 9.6 6.4M2.5 13.5l3.9-3.9"/>`,
	"collapse":     `<path d="M13.5 6.5h-4v-4M2.5 9.5h4v4M9.5 6.5l4-4M6.5 9.5l-4 4"/>`,
	"more":         `<circle cx="3.2" cy="8" r="1" fill="currentColor" stroke="none"/><circle cx="8" cy="8" r="1" fill="currentColor" stroke="none"/><circle cx="12.8" cy="8" r="1" fill="currentColor" stroke="none"/>`,
	"plus":         `<path d="M8 3v10M3 8h10"/>`,
	"minus":        `<path d="M3 8h10"/>`,
	"check":        `<path d="m3.2 8.4 3.1 3.1 6.5-6.9"/>`,
	"save":         `<path d="M2.5 2.5h8.6L13.5 5v8.5h-11z"/><path d="M5 2.5v3.6h4.5V2.5M5 13.5V9.2h6v4.3"/>`,
	"trash":        `<path d="M2.8 4.4h10.4M6.4 4.4V2.8h3.2v1.6"/><path d="M4 4.4l.6 8.2c0 .5.4.8.9.8h5c.5 0 .9-.3.9-.8l.6-8.2"/><path d="M6.6 6.8v4.4M9.4 6.8v4.4" opacity=".5"/>`,
	"undo":         `<path d="M5.3 3.2 2.5 6l2.8 2.8"/><path d="M2.8 6h6.1a4 4 0 0 1 0 8H6.4"/>`,
	"redo":         `<path d="M10.7 3.2 13.5 6l-2.8 2.8"/><path d="M13.2 6H7.1a4 4 0 0 0 0 8h2.5"/>`,
	"copy":         `<rect x="5.4" y="5.4" width="8.2" height="8.2" rx="1.2"/><path d="M10.6 5.4V3.6c0-.7-.5-1.2-1.2-1.2H3.6c-.7 0-1.2.5-1.2 1.2v5.8c0 .7.5 1.2 1.2 1.2h1.8"/>`,
	"external":     `<path d="M9.5 2.5h4v4M13.5 2.5 7.8 8.2M12 9.8v2.6c0 .6-.5 1.1-1.1 1.1H3.6c-.6 0-1.1-.5-1.1-1.1V5.1c0-.6.5-1.1 1.1-1.1h2.6"/>`,
	"columns":      `<rect x="1.8" y="2.6" width="12.4" height="10.8" rx="1.2"/><path d="M8 2.6v10.8"/>`,
	"rows":         `<rect x="1.8" y="2.6" width="12.4" height="10.8" rx="1.2"/><path d="M1.8 8h12.4"/>`,
	"prevDiff":     `<path d="m6.8 8 4.6-4.6M3.2 3.2v9.6M11.4 3.4v9.2"/>`,
	"nextDiff":     `<path d="m9.2 8-4.6 4.6M12.8 3.2v9.6M4.6 3.4v9.2"/>`,
	"stage":        `<rect x="2.2" y="2.2" width="11.6" height="11.6" rx="1.4" opacity=".45"/><path d="M8 4.6v6.2M4.9 7.7h6.2"/>`,
	"unstage":      `<rect x="2.2" y="2.2" width="11.6" height="11.6" rx="1.4" opacity=".45"/><path d="M4.9 8h6.2"/>`,
	"stash":        `<path d="M2 4.4h12v8.2c0 .6-.5 1.1-1.1 1.1H3.1c-.6 0-1.1-.5-1.1-1.1z"/><path d="M2 4.4 3.5 2h9L14 4.4"/><path d="M6 7.4h4"/>`,
	"merge":        `<circle cx="4.2" cy="3.6" r="1.6"/><circle cx="4.2" cy="12.4" r="1.6"/><circle cx="11.8" cy="12.4" r="1.6"/><path d="M4.2 5.2v5.6M4.2 8.6c3 0 4.6-1.6 5.6-3.4"/>`,
	"rebase":       `<circle cx="4" cy="3.6" r="1.6"/><circle cx="12" cy="12.4" r="1.6"/><path d="M4 5.2v3.2c0 2 1.2 2.8 3 3.2"/><path d="m9.4 8.8 2.6 2.6"/>`,
	"cherry":       `<circle cx="8" cy="9.4" r="2.6"/><path d="M8 6.8c0-2.6 1.6-4.2 4-4.2M8 6.8c-.4-2-1.4-3.2-3.2-3.8"/><path d="M8 12v2"/>`,
	"revert":       `<circle cx="8" cy="8" r="5.4"/><path d="M8 5.2v3.4l2.3 1.4"/><path d="m2.6 8-1.6-1.8M2.6 8l1.8-1.5" opacity=".7"/>`,
	"reset":        `<path d="M2.4 8a5.6 5.6 0 1 0 1.7-4"/><path d="M2 2.4v3.4h3.4"/>`,
	"ours":         `<path d="M13 8H3M6.4 4.6 3 8l3.4 3.4"/>`,
	"theirs":       `<path d="M3 8h10M9.6 4.6 13 8l-3.4 3.4"/>`,
	"file":         `<path d="M3.4 1.8h6l3.2 3.2v9.2H3.4z"/><path d="M9.4 1.8v3.2h3.2" opacity=".6"/>`,
	"folder":       `<path d="M1.9 3.6c0-.5.4-.9.9-.9h3.2l1.3 1.5h5.9c.5 0 .9.4.9.9v7.4c0 .5-.4.9-.9.9H2.8c-.5 0-.9-.4-.9-.9z"/>`,
	"folderOpen":   `<path d="M1.9 3.6c0-.5.4-.9.9-.9h3.2l1.3 1.5h5.3c.5 0 .9.4.9.9v.9H1.9z"/><path d="M1.9 5.7h12.2l-1.1 6.2c-.1.5-.5.9-1 .9H2.9c-.5 0-.9-.4-.9-.9z"/>`,
	"warning":      `<path d="M8 2.2 14.2 13H1.8z"/><path d="M8 6v3.4"/><circle cx="8" cy="11.3" r=".7" fill="currentColor" stroke="none"/>`,
	"info":         `<circle cx="8" cy="8" r="5.8"/><path d="M8 7.2v3.6"/><circle cx="8" cy="5.1" r=".7" fill="currentColor" stroke="none"/>`,
	"error":        `<circle cx="8" cy="8" r="5.8"/><path d="m5.8 5.8 4.4 4.4M10.2 5.8l-4.4 4.4"/>`,
	"git":          `<circle cx="4.2" cy="3.6" r="1.5"/><circle cx="4.2" cy="12.4" r="1.5"/><circle cx="11.8" cy="8" r="1.5"/><path d="M4.2 5.1v5.8M5.6 4.4l4.7 3M5.6 11.6l4.7-3"/>`,
	"user":         `<circle cx="8" cy="5.2" r="2.6"/><path d="M3 13.2c.3-2.4 2.4-4 5-4s4.7 1.6 5 4"/>`,
	"clock":        `<circle cx="8" cy="8" r="5.6"/><path d="M8 4.8V8l2.2 1.4"/>`,
	"eye":          `<path d="M1.5 8s2.4-4.4 6.5-4.4S14.5 8 14.5 8s-2.4 4.4-6.5 4.4S1.5 8 1.5 8z"/><circle cx="8" cy="8" r="2.2"/>`,
	"edit":         `<path d="M9.8 2.8 13.2 6.2 5 14.4H1.6V11z"/><path d="m8.4 4.2 3.4 3.4"/>`,
	"diff":         `<rect x="1.8" y="2.6" width="12.4" height="10.8" rx="1.2"/><path d="M8 2.6v10.8"/>`,
	"download":     `<path d="M8 2v8"/><path d="M5 7l3 3 3-3"/><path d="M2.5 13.5h11"/>`,
	"list":         `<path d="M2.5 4h11M2.5 8h11M2.5 12h11"/>`,
}

var iconSVGs map[string]*ui.SVG

func initIcons() {
	iconSVGs = make(map[string]*ui.SVG, len(iconPaths))
	for name, body := range iconPaths {
		svg := `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">` + body + `</svg>`
		iconSVGs[name] = ui.MustParseSVG([]byte(svg))
	}
}

func iconSVG(name string) *ui.SVG {
	if iconSVGs == nil {
		initIcons()
	}
	if s, ok := iconSVGs[name]; ok {
		return s
	}
	return iconSVGs["file"]
}

// icon draws a 16px icon at size, in the text color around it.
func (a *nativeApp) icon(c *ui.Context, name string, size float32) ui.Element {
	e := ui.Icon(c, iconSVG(name))
	if size > 0 {
		e.Size(size, size)
	}
	return e
}

// iconButton is the 26px toolbar button of the old title bar and panels.
// It is a kit control so every panel inherits the same hover timing and
// pressed give rather than its own copy of a stock button.
func (a *nativeApp) iconButton(c *ui.Context, name, tip string, disabled bool) (ui.Element, bool) {
	return a.kitIconButton(c, name, tip, 26, 16, disabled, false, false)
}

func (a *nativeApp) smallIconButton(c *ui.Context, name, tip string, disabled bool) (ui.Element, bool) {
	return a.kitIconButton(c, name, tip, 28, 14, disabled, false, false)
}

// toolbarRule is the short vertical divider between toolbar groups.
func toolbarRule(c *ui.Context) {
	kitToolbarRule(c)
}

// countBadge is the small accent pill beside a tool-window tab.
func countBadge(c *ui.Context, n int) {
	if n <= 0 {
		return
	}
	p := palette(c.Theme())
	ui.Box(c).Height(15).PaddingX(5).Radius(8).Background(ui.Hex(p.accentSoft)).Center().Children(func() {
		ui.Text(c, fmtInt(n)).FontSize(10).FontWeight(600).TextColor(ui.Hex(p.accent))
	})
}

func fmtInt(n int) string {
	if n == 0 {
		return "0"
	}
	var digits [12]byte
	i := len(digits)
	for n > 0 {
		i--
		digits[i] = byte('0' + n%10)
		n /= 10
	}
	return string(digits[i:])
}

// iconNameForTab maps a tool-window page to its icon.
func iconNameForTab(tab int) string {
	switch tab {
	case 0:
		return "commit"
	case 1:
		return "branch"
	case 2:
		return "files"
	case 3:
		return "log"
	default:
		return "console"
	}
}

// primaryButton is the accent button of the old pages: a rounded pill on
// the welcome card and a 5px button in dialogs.
func (a *nativeApp) primaryButton(c *ui.Context, label string) bool {
	return a.kitDialogPrimary(c, label, false)
}

func (a *nativeApp) secondaryButton(c *ui.Context, label string, disabled bool) bool {
	return a.kitDialogButton(c, label, false, disabled)
}

func (a *nativeApp) kbd(c *ui.Context, label string) {
	p := palette(c.Theme())
	ui.Box(c).Height(16).PaddingX(5).Radius(3).Border(1, ui.Hex(p.border)).
		Background(ui.Hex(p.panel)).Center().Children(func() {
		ui.Text(c, label).FontSize(9.5).TextColor(ui.Hex(p.muted))
	})
}

func (a *nativeApp) miniTextButton(c *ui.Context, label string, danger bool) bool {
	p := palette(c.Theme())
	b := ui.ButtonBase(c).Height(18).PaddingX(6).Radius(4).AlignItems(ui.Center).
		Border(1, ui.Hex(p.border))
	bg := ui.Hex(p.raised)
	if b.Hovered() {
		bg = ui.Hex(p.hover)
	}
	if b.Pressed() {
		bg = ui.Hex(p.hoverStrong)
	}
	b.Background(motionColor(b, "kit-mini-bg", bg))
	col := ui.Hex(p.fgSoft)
	if danger {
		col = ui.Hex(p.danger)
	}
	b.Children(func() {
		ui.Text(c, label).FontSize(10.5).TextColor(motionColor(b, "kit-mini-fg", col))
	})
	motionPressPose(b, b.Pressed(), 0.96)
	return b.Clicked()
}

// searchBox is the bordered little search field of the page's toolbars.
func (a *nativeApp) searchBox(c *ui.Context, value *string, placeholder string, width float32) (ui.Element, bool, bool) {
	p := palette(c.Theme())
	b := ui.Row(c).Height(30).Width(width).PaddingX(9).Gap(7).AlignItems(ui.Center).
		Radius(8).Background(ui.Hex(p.input)).Border(1, ui.Hex(p.border))
	border := ui.Hex(p.borderStrong)
	if b.Hovered() {
		border = ui.Hex(p.accent)
	}
	b.BorderColor(motionColor(b, "kit-search-border", border))
	var submitted, changed bool
	b.Children(func() {
		ui.Row(c).TextColor(ui.Hex(p.muted)).Center().Children(func() {
			a.icon(c, "search", 12)
		})
		in := ui.TextInputBase(c, value).FontSize(12).Placeholder(placeholder).Grow(1)
		submitted = in.Submitted()
		changed = in.Changed()
	})
	return b, submitted, changed
}

// toggleTextButton is a tiny toolbar toggle, as ".*" and "Aa" in the old
// history header.
func (a *nativeApp) toggleTextButton(c *ui.Context, label string, on bool) bool {
	p := palette(c.Theme())
	b := ui.ButtonBase(c).Height(24).PaddingX(6).Radius(5).Center()
	bg := ui.Transparent
	if on {
		bg = ui.Hex(p.selection)
	} else if b.Hovered() {
		bg = ui.Hex(p.hover)
	}
	b.Background(motionColor(b, "kit-toggle-bg", bg))
	col := ui.Hex(p.muted)
	if on {
		col = ui.Hex(p.fg)
	} else if b.Hovered() {
		col = ui.Hex(p.fgSoft)
	}
	col = motionColor(b, "kit-toggle-fg", col)
	b.Children(func() {
		ui.Text(c, label).FontSize(12).TextColor(col)
	})
	motionPressPose(b, b.Pressed(), 0.95)
	return b.Clicked()
}

func (a *nativeApp) refBadge(c *ui.Context, ref git.CommitRef) {
	p := palette(c.Theme())
	bg := ui.Hex(p.accentSoft)
	fg := ui.Hex(p.accent)
	icon := "branch"
	switch {
	case ref.Type == "tag":
		bg = ui.RGBA(169, 97, 30, 0.12)
		fg = ui.Hex(p.untracked)
		icon = "tag"
	case ref.Type == "remote":
		bg = ui.RGBA(122, 79, 208, 0.12)
		fg = ui.Hex(p.renamed)
		icon = "fetch"
	case ref.Head:
		bg = ui.RGBA(43, 124, 74, 0.14)
		fg = ui.Hex(p.added)
		icon = "check"
	}
	ui.Box(c).Height(18).PaddingX(6).Radius(5).Gap(3).AlignItems(ui.Center).
		Background(bg).MaxWidth(150).Children(func() {
		ui.Row(c).TextColor(fg).Center().Children(func() {
			a.icon(c, icon, 9)
		})
		ui.Text(c, ref.Name).FontSize(9.5).FontWeight(600).TextColor(fg).MaxLines(1)
	})
}

func (a *nativeApp) toolbarButton(c *ui.Context, icon, label string, disabled bool) bool {
	p := palette(c.Theme())
	b := ui.ButtonBase(c).Height(24).PaddingX(8).Radius(5).Gap(5).AlignItems(ui.Center).Disabled(disabled)
	bg := ui.Transparent
	if b.Hovered() {
		bg = ui.Hex(p.hover)
	}
	if b.Pressed() {
		bg = ui.Hex(p.hoverStrong)
	}
	b.Background(motionColor(b, "kit-toolbar-bg", bg))
	fg := motionColor(b, "kit-toolbar-fg", ui.Hex(p.fgSoft))
	b.Children(func() {
		ui.Row(c).TextColor(fg).Center().Children(func() {
			a.icon(c, icon, 14)
		})
		ui.Text(c, label).FontSize(12).TextColor(fg)
	})
	motionPressPose(b, b.Pressed(), 0.97)
	return b.Clicked()
}

func (a *nativeApp) toolbarToggle(c *ui.Context, icon, label string, on bool) bool {
	p := palette(c.Theme())
	b := ui.ButtonBase(c).Height(24).PaddingX(8).Radius(5).Gap(5).AlignItems(ui.Center)
	bg := ui.Transparent
	if on {
		bg = ui.Hex(p.selection)
	} else if b.Hovered() {
		bg = ui.Hex(p.hover)
	}
	b.Background(motionColor(b, "kit-toolbar-bg", bg))
	col := ui.Hex(p.muted)
	if on {
		col = ui.Hex(p.fg)
	} else if b.Hovered() {
		col = ui.Hex(p.fgSoft)
	}
	col = motionColor(b, "kit-toolbar-fg", col)
	b.Children(func() {
		ui.Row(c).TextColor(col).Center().Children(func() {
			a.icon(c, icon, 14)
		})
		ui.Text(c, label).FontSize(12).TextColor(col)
	})
	motionPressPose(b, b.Pressed(), 0.97)
	return b.Clicked()
}

func (a *nativeApp) iconSegment(c *ui.Context, active int, names ...string) int {
	p := palette(c.Theme())
	chosen := active
	ui.Row(c).Height(22).Radius(5).Border(1, ui.Hex(p.border)).Background(ui.Hex(p.input)).Children(func() {
		for i, name := range names {
			i := i
			b := ui.ButtonBase(c).Size(24, 20).Center()
			bg := ui.Transparent
			if chosen == i {
				bg = ui.Hex(p.selection)
			} else if b.Hovered() {
				bg = ui.Hex(p.hover)
			}
			b.Background(motionColor(b, "kit-segment-bg", bg))
			col := ui.Hex(p.muted)
			if chosen == i {
				col = ui.Hex(p.fg)
			}
			col = motionColor(b, "kit-segment-fg", col)
			b.Children(func() {
				ui.Row(c).TextColor(col).Center().Children(func() {
					a.icon(c, name, 13)
				})
			})
			motionPressPose(b, b.Pressed(), 0.92)
			if b.Clicked() {
				chosen = i
			}
		}
	})
	return chosen
}

// editorTheme keeps code on the old page's paper, with its syntax colors.
func editorTheme(t *ui.Theme) *editor.Theme {
	p := palette(t)
	ct := editor.DefaultTheme(t)
	ct.Background = ui.Hex(p.editor)
	ct.Text = ui.Hex(p.fg)
	ct.LineNumber = ui.Hex(p.muted2)
	ct.ActiveLineNumber = ui.Hex(p.fg)
	ct.Selection = ui.Hex(p.selectionStrong)
	ct.InactiveSelection = ui.Hex(p.selection)
	ct.Cursor = ui.Hex(p.accent)
	ct.Match = ui.RGBA(233, 162, 59, 0.26)
	ct.CurrentMatch = ui.RGBA(233, 162, 59, 0.42)
	ct.Occurrence = ui.Hex(p.selection)
	ct.IndentGuide = ui.RGBA(0, 0, 0, 0.08)
	ct.ActiveIndentGuide = ui.RGBA(0, 0, 0, 0.18)
	ct.Whitespace = ui.RGBA(0, 0, 0, 0.22)
	ct.Error = ui.Hex(p.danger)
	ct.Warning = ui.Hex(p.warning)
	ct.Info = ui.Hex(p.accent)
	ct.Hint = ui.Hex(p.muted)
	ct.Added = ui.Hex(p.added)
	ct.Deleted = ui.Hex(p.deleted)
	ct.Modified = ui.Hex(p.modified)
	set := func(k editor.TokenKind, hex string) { ct.Tokens[k].Color = ui.Hex(hex) }
	set(editor.TokenKeyword, p.syntaxKeyword)
	set(editor.TokenOperator, p.syntaxOperator)
	set(editor.TokenType, p.syntaxTag)
	set(editor.TokenFunction, p.syntaxFunction)
	set(editor.TokenMeta, p.syntaxKeyword)
	set(editor.TokenProperty, p.syntaxFunction)
	set(editor.TokenConstant, p.syntaxNumber)
	set(editor.TokenNumber, p.syntaxNumber)
	set(editor.TokenAttribute, p.syntaxTag)
	set(editor.TokenString, p.syntaxString)
	set(editor.TokenEscape, p.syntaxString)
	set(editor.TokenRegexp, p.syntaxString)
	set(editor.TokenTag, p.syntaxTag)
	set(editor.TokenComment, p.syntaxComment)
	set(editor.TokenHeading, p.syntaxFunction)
	set(editor.TokenLink, p.syntaxString)
	set(editor.TokenCode, p.syntaxString)
	set(editor.TokenInserted, p.added)
	set(editor.TokenDeleted, p.deleted)
	set(editor.TokenInvalid, p.danger)
	return ct
}

func (a *nativeApp) titleIconButton(c *ui.Context, name, tip string, disabled, dot bool) (ui.Element, bool) {
	return a.kitIconButton(c, name, tip, 30, 16, disabled, false, dot)
}

// fileTint is the hint of color the old file icons gave each language.
func fileTint(path string) ui.Color {
	switch strings.ToLower(filepathExt(path)) {
	case "go":
		return ui.Hex("#00a7d0")
	case "ts", "tsx":
		return ui.Hex("#3178c6")
	case "js", "jsx", "mjs", "cjs":
		return ui.Hex("#b7a600")
	case "json", "jsonc":
		return ui.Hex("#b59b00")
	case "md", "markdown":
		return ui.Hex("#6b7280")
	case "css", "scss", "less":
		return ui.Hex("#7a5aa8")
	case "html", "htm":
		return ui.Hex("#c4552d")
	case "py":
		return ui.Hex("#3572a5")
	case "rs":
		return ui.Hex("#b06a3b")
	case "java", "kt":
		return ui.Hex("#b07219")
	case "c", "h", "cc", "cpp", "hpp":
		return ui.Hex("#6a737d")
	case "yml", "yaml", "toml":
		return ui.Hex("#b0474f")
	case "sh", "bash", "zsh":
		return ui.Hex("#4f8a3a")
	case "png", "jpg", "jpeg", "gif", "svg", "webp":
		return ui.Hex("#9a63b5")
	}
	return ui.Hex(lightColors.muted)
}

func filepathExt(path string) string {
	i := strings.LastIndexByte(path, '.')
	if i < 0 || i == len(path)-1 {
		return ""
	}
	return path[i+1:]
}
