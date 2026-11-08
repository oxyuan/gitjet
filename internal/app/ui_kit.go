package app

import (
	"github.com/egoist/mygo/ui"
)

// This file is the app's own small widget kit, not a theme for stock
// controls. Every control here composes a button, a box and a painter, so
// the shell owns its radii, spacing, hover timing and its pressed give
// instead of inheriting whatever the platform theme finds acceptable.
//
// The kit is deliberately narrow: the title bar, tool-window tabs, editor
// tabs, search affordance and dialog buttons are the surfaces that define
// the app's frame. Panels and editors remain MyGo widgets underneath.

const (
	kitRadiusControl = 7
	kitRadiusField   = 9
	kitRadiusTab     = 8
)

// kitLogo is the brand mark, drawn rather than composed from a background
// and a border: a diagonal indigo gradient, a top gloss, and a fine inner
// edge. It gives the title bar a point of depth without a bitmap.
func (a *nativeApp) kitLogo(c *ui.Context) ui.Element {
	box := ui.Box(c).Size(26, 26).Shadow(0, 2, 8, 0, ui.RGBA(48, 59, 92, 0.22))
	box.Draw(func(p *ui.Painter, r ui.Rect) {
		p.FillGradient(r, ui.LinearGradient{
			Angle: 135,
			From:  ui.Hex("#7b86bd"),
			To:    ui.Hex("#39456e"),
			Oklab: true,
		}, 7)
		p.FillGradient(ui.Rect{X: r.X + 1, Y: r.Y + 1, W: r.W - 2, H: r.H * 0.52}, ui.LinearGradient{
			Angle: 180,
			From:  ui.RGBA(255, 255, 255, 0.24),
			To:    ui.Transparent,
		}, 6)
		p.Stroke(ui.Rect{X: r.X + 0.5, Y: r.Y + 0.5, W: r.W - 1, H: r.H - 1}, ui.RGBA(255, 255, 255, 0.28), 6, 1)
	})
	box.Children(func() {
		ui.Row(c).TextColor(ui.Hex("#ffffff")).Center().Children(func() {
			a.icon(c, "git", 18)
		})
	})
	return box
}

// kitIconButton is a title-bar or panel icon control: animated hover wash,
// a pressed spring, an optional active tint and notification dot.
func (a *nativeApp) kitIconButton(c *ui.Context, name, tip string, size, iconSize float32, disabled, active, dot bool) (ui.Element, bool) {
	p := palette(c.Theme())
	b := ui.ButtonBase(c).Size(size, size).Radius(size * 0.27).Center().Tooltip(tip).Disabled(disabled)

	bg := ui.Transparent
	if active {
		bg = ui.Hex(p.selection)
	}
	if b.Hovered() {
		bg = ui.Hex(p.hover)
	}
	if b.Pressed() {
		bg = ui.Hex(p.hoverStrong)
	}
	b.Background(motionColor(b, "kit-icon-bg", bg))

	fg := ui.Hex(p.muted)
	if active || b.Hovered() {
		fg = ui.Hex(p.fgSoft)
	}
	if disabled {
		fg = ui.Hex(p.muted2)
	}
	b.Children(func() {
		ui.Row(c).TextColor(motionColor(b, "kit-icon-fg", fg)).Center().Children(func() {
			a.icon(c, name, iconSize)
		})
		if dot {
			ui.Box(c).Absolute().Top(size*0.2).Right(size*0.2).Size(5, 5).Radius(3).
				Background(ui.Hex(p.accent)).Shadow(0, 0, 5, 0, ui.Hex(p.accent).Alpha(0.55))
		}
	})
	motionPressPose(b, b.Pressed(), 0.88)
	return b, b.Clicked()
}

// kitToolTab is a tab of the tool window: a soft raised pill when active,
// an animated accent marker and a count badge. The marker is painted, so
// it can grow and fade instead of switching between two images.
func (a *nativeApp) kitToolTab(c *ui.Context, icon, label string, count int, active bool) (ui.Element, bool) {
	p := palette(c.Theme())
	b := ui.ButtonBase(c).Height(30).PaddingX(10).Radius(8).Gap(7).AlignItems(ui.Center)

	bg := ui.Transparent
	if active {
		bg = ui.Hex(p.raised)
	} else if b.Hovered() {
		bg = ui.Hex(p.hover)
	}
	b.Background(motionColor(b, "kit-tab-bg", bg))
	if active {
		b.Border(1, ui.Hex(p.border))
	}

	fg := ui.Hex(p.muted)
	if active {
		fg = ui.Hex(p.fg)
	} else if b.Hovered() {
		fg = ui.Hex(p.fgSoft)
	}
	fg = motionColor(b, "kit-tab-fg", fg)
	iconCol := ui.Hex(p.accent)
	if !active {
		iconCol = fg
	}
	b.Children(func() {
		ui.Row(c).TextColor(iconCol).Center().Children(func() {
			a.icon(c, icon, 15)
		})
		ui.Text(c, label).FontSize(12).FontWeight(550).TextColor(fg)
		if count > 0 {
			kitCount(c, count, active)
		}
	})
	motionPressPose(b, b.Pressed(), 0.97)
	return b, b.Clicked()
}

// kitCount is the small count beside a tool tab. Its fill is painted, so
// the active badge can lift off the tab instead of being a second colour
// constant.
func kitCount(c *ui.Context, n int, active bool) {
	p := palette(c.Theme())
	bg := ui.Hex(p.accentSoft)
	fg := ui.Hex(p.accent)
	if active {
		bg = ui.Hex(p.selectionStrong)
		fg = ui.Hex(p.accent)
	}
	ui.Box(c).Height(17).PaddingX(5).Radius(9).Background(bg).Center().Children(func() {
		ui.Text(c, fmtInt(n)).FontSize(10).FontWeight(650).TextColor(fg)
	})
}

// kitPrimary is the filled action of a dialog: a soft top gloss, a
// pressed spring and a shadow that stays behind the label.
func (a *nativeApp) kitPrimary(c *ui.Context, label string) bool {
	return a.kitPrimaryAction(c, "", label, false, false)
}

// kitPrimaryAction is kitPrimary with an optional leading icon and a
// disabled state; the commit bar uses it to keep one button for every
// count and every busy state.
func (a *nativeApp) kitPrimaryAction(c *ui.Context, icon, label string, disabled, grow bool, radius ...float32) bool {
	p := palette(c.Theme())
	b := ui.ButtonBase(c).Height(30).PaddingX(14).Radius(kitRadiusControl).Gap(7).AlignItems(ui.Center).Disabled(disabled)
	if len(radius) > 0 {
		b.Radius(radius...)
	}
	if grow {
		b.Grow(1)
	}
	bg := ui.Hex(p.accent)
	if b.Hovered() && !disabled {
		bg = ui.Hex(p.accentHover)
	}
	if b.Pressed() && !disabled {
		bg = ui.Hex(p.accentHover)
	}
	if disabled {
		bg = ui.Hex(p.accent).Alpha(0.55)
	}
	b.Background(motionColor(b, "kit-primary-bg", bg)).
		Shadow(0, 1, 3, 0, ui.Hex(p.accent).Alpha(0.22))
	fg := motionColor(b, "kit-primary-fg", ui.Hex(p.accentText))
	b.DrawOver(func(pt *ui.Painter, r ui.Rect) {
		pt.FillGradient(ui.Rect{X: r.X + 1, Y: r.Y + 1, W: r.W - 2, H: r.H * 0.5}, ui.LinearGradient{
			Angle: 180,
			From:  ui.RGBA(255, 255, 255, 0.16),
			To:    ui.Transparent,
		}, kitRadiusControl-1)
		pt.Stroke(ui.Rect{X: r.X + 0.5, Y: r.Y + 0.5, W: r.W - 1, H: r.H - 1}, ui.RGBA(255, 255, 255, 0.14), kitRadiusControl, 1)
	})
	b.Children(func() {
		if icon != "" {
			ui.Row(c).TextColor(fg).Center().Children(func() {
				a.icon(c, icon, 15)
			})
		}
		ui.Text(c, label).FontSize(12).FontWeight(600).TextColor(fg)
	})
	motionPressPose(b, b.Pressed() && !disabled, 0.96)
	return b.Clicked() && !disabled
}

// kitAccentArrow is the split-menu half of the commit bar. It shares the
// primary fill and gloss, separated by a translucent seam.
func (a *nativeApp) kitAccentArrow(c *ui.Context, disabled bool) ui.Element {
	p := palette(c.Theme())
	b := ui.ButtonBase(c).Size(28, 30).Center().Radius(0, 7, 7, 0).Disabled(disabled)
	bg := ui.Hex(p.accent)
	if b.Hovered() && !disabled {
		bg = ui.Hex(p.accentHover)
	}
	if disabled {
		bg = ui.Hex(p.accent).Alpha(0.55)
	}
	b.Background(motionColor(b, "kit-arrow-bg", bg))
	b.DrawOver(func(pt *ui.Painter, r ui.Rect) {
		pt.FillGradient(ui.Rect{X: r.X + 1, Y: r.Y + 1, W: r.W - 2, H: r.H * 0.5}, ui.LinearGradient{
			Angle: 180,
			From:  ui.RGBA(255, 255, 255, 0.14),
			To:    ui.Transparent,
		}, kitRadiusControl-1)
		pt.Line(r.X+0.5, r.Y+6, r.X+0.5, r.Y+r.H-6, 1, ui.RGBA(255, 255, 255, 0.24))
	})
	b.Children(func() {
		ui.Row(c).TextColor(ui.Hex(p.accentText)).Center().Children(func() {
			a.icon(c, "chevronUp", 12)
		})
	})
	motionPressPose(b, b.Pressed() && !disabled, 0.94)
	return b
}

// kitSecondary is the quiet sibling of kitPrimary.
func (a *nativeApp) kitSecondary(c *ui.Context, label string, disabled bool) bool {
	p := palette(c.Theme())
	b := ui.ButtonBase(c).Height(30).PaddingX(13).Radius(kitRadiusControl).AlignItems(ui.Center).Disabled(disabled)
	bg := ui.Hex(p.raised)
	if b.Hovered() {
		bg = ui.Hex(p.hover)
	}
	if b.Pressed() {
		bg = ui.Hex(p.hoverStrong)
	}
	b.Background(motionColor(b, "kit-secondary-bg", bg))
	border := ui.Hex(p.borderStrong)
	if b.Hovered() {
		border = ui.Hex(p.borderStrong)
	}
	b.Border(1, border)
	b.Children(func() {
		ui.Text(c, label).FontSize(12).TextColor(motionColor(b, "kit-secondary-fg", ui.Hex(p.fg))).FontWeight(500)
	})
	motionPressPose(b, b.Pressed(), 0.97)
	return b.Clicked()
}

// kitSearch is the title bar's quick-open affordance: a painted field with
// animated border and a keycap, not a stock text input. The field is a
// button because the palette, not typing here, is what opens.
func (a *nativeApp) kitSearch(c *ui.Context, placeholder, shortcut string, enabled bool) (ui.Element, bool) {
	p := palette(c.Theme())
	b := ui.ButtonBase(c).Height(30).Width(240).Radius(kitRadiusField).PaddingX(10).Gap(8).
		AlignItems(ui.Center).Tooltip(a.t("Quick Open")).Disabled(!enabled)
	border := ui.Hex(p.border)
	fill := ui.Hex(p.raised)
	if b.Hovered() {
		border = ui.Hex(p.borderStrong)
		fill = ui.Hex(p.raised)
	}
	border = motionColor(b, "kit-search-border", border)
	fill = motionColor(b, "kit-search-fill", fill)
	b.Draw(func(pt *ui.Painter, r ui.Rect) {
		pt.Shadow(r, kitRadiusField, 0, 1, 2, 0, ui.RGBA(17, 24, 39, 0.04))
		pt.Fill(r, fill, kitRadiusField)
		pt.Stroke(ui.Rect{X: r.X + 0.5, Y: r.Y + 0.5, W: r.W - 1, H: r.H - 1}, border, kitRadiusField, 1)
	})
	b.Children(func() {
		ui.Row(c).TextColor(ui.Hex(p.muted)).Center().Children(func() {
			a.icon(c, "search", 14)
		})
		ui.Text(c, placeholder).FontSize(12).TextColor(ui.Hex(p.muted)).Grow(1)
		kitKeycap(c, shortcut)
	})
	motionPressPose(b, b.Pressed(), 0.985)
	return b, b.Clicked()
}

// kitKeycap is the shortcut hint inside the search field.
func kitKeycap(c *ui.Context, label string) {
	p := palette(c.Theme())
	ui.Box(c).Height(17).PaddingX(5).Radius(5).Background(ui.Hex(p.hover)).Center().Children(func() {
		ui.Text(c, label).FontSize(9).TextColor(ui.Hex(p.muted2))
	})
}

// kitToolbarRule is the hairline separator between groups of title-bar
// controls, painted with a fade at each end so it does not read as a table
// border.
func kitToolbarRule(c *ui.Context) {
	p := palette(c.Theme())
	ui.Box(c).Width(1).Height(16).Draw(func(pt *ui.Painter, r ui.Rect) {
		pt.FillGradient(r, ui.LinearGradient{
			Angle: 180,
			Stops: []ui.GradientStop{
				{Color: ui.Hex(p.border).Alpha(0), At: 0},
				{Color: ui.Hex(p.borderStrong), At: 0.35},
				{Color: ui.Hex(p.borderStrong), At: 0.65},
				{Color: ui.Hex(p.border).Alpha(0), At: 1},
			},
		}, 0)
	}).MarginX(4)
}

// kitFileBadge is the small language tile in file lists. It mirrors the
// page's FileIcon: a 14-unit rounded rect with a 13% tint, 38% stroke and a
// monogram, scaled with the requested size.
func (a *nativeApp) kitFileBadge(c *ui.Context, path string, size float32) ui.Element {
	label, lang := fileBadge(path)
	if label == "" {
		return a.icon(c, "file", size)
	}
	tint := fileBadgeTint(lang, palette(c.Theme()))
	box := ui.Box(c).Size(size, size)
	box.Draw(func(p *ui.Painter, r ui.Rect) {
		scale := size / 16
		inset := 1 * scale
		p.Fill(ui.Rect{X: r.X + inset, Y: r.Y + inset, W: r.W - 2*inset, H: r.H - 2*inset}, tint.Alpha(0.13), 3.4*scale)
		p.Stroke(ui.Rect{X: r.X + inset + 0.5, Y: r.Y + inset + 0.5, W: r.W - 2*inset - 1, H: r.H - 2*inset - 1}, tint.Alpha(0.38), 3.4*scale, scale)
	})
	box.Children(func() {
		fontSize := float32(8)
		if len(label) > 2 {
			fontSize = 6
		}
		ui.Row(c).TextColor(tint).Center().Children(func() {
			ui.Text(c, label).FontSize(fontSize * size / 16).Font("monospace").FontWeight(800).LetterSpacing(-0.25)
		})
	})
	return box
}

// kitDocTab is an editor tab: a raised sheet when active, an animated
// accent underline, a language tile and its own close button. It is
// separate from kitToolTab because an open file is a document, not a
// navigation choice.
func (a *nativeApp) kitDocTab(c *ui.Context, kind tabKind, title, path string, active, dirty bool) (ui.Element, bool, bool) {
	p := palette(c.Theme())
	b := ui.ButtonBase(c).Height(36).Radius(9).Gap(7).PaddingX(11).AlignItems(ui.Center)
	bg := ui.Transparent
	if active {
		bg = ui.Hex(p.raised)
		b.Border(1, ui.Hex(p.border)).Shadow(0, 1, 4, 0, ui.RGBA(16, 24, 40, 0.08))
	} else if b.Hovered() {
		bg = ui.Hex(p.hover)
	}
	b.Background(motionColor(b, "kit-doc-bg", bg))

	mark := motionReveal(b, "kit-doc-mark", active)
	b.DrawOver(func(pt *ui.Painter, r ui.Rect) {
		if mark <= 0.01 {
			return
		}
		w := 18 + 10*mark
		x := r.X + (r.W-w)/2
		pt.FillGradient(ui.Rect{X: x, Y: r.Y + r.H - 2, W: w, H: 2}, ui.LinearGradient{
			Angle: 0, From: ui.Hex(p.accent), To: ui.Hex(p.accentAlt), Oklab: true,
		}, 1)
	})

	fg := ui.Hex(p.muted)
	if active {
		fg = ui.Hex(p.fg)
	} else if b.Hovered() {
		fg = ui.Hex(p.fgSoft)
	}
	fg = motionColor(b, "kit-doc-fg", fg)
	closeClicked := false
	b.Children(func() {
		switch kind {
		case tabDiff:
			ui.Row(c).TextColor(ui.Hex(p.accent)).Center().Children(func() {
				a.icon(c, "diff", 14)
			})
		case tabRevisionTree:
			ui.Row(c).TextColor(ui.Hex(p.untracked)).Center().Children(func() {
				a.icon(c, "folder", 14)
			})
		case tabCommit:
			ui.Row(c).TextColor(ui.Hex(p.accentAlt)).Center().Children(func() {
				a.icon(c, "commit", 14)
			})
		default:
			a.kitFileBadge(c, path, 16)
		}
		ui.Text(c, title).FontSize(12.5).TextColor(fg).MaxLines(1)
		if dirty {
			ui.Box(c).Size(5, 5).Radius(3).Background(ui.Hex(p.accent))
		}
		close := ui.ButtonBase(c).Size(18, 18).Radius(5).Center()
		cbg := ui.Transparent
		if close.Hovered() {
			cbg = ui.Hex(p.hoverStrong)
		}
		close.Background(motionColor(close, "kit-doc-close-bg", cbg))
		close.Children(func() {
			col := ui.Hex(p.muted2)
			if close.Hovered() {
				col = ui.Hex(p.fg)
			}
			ui.Row(c).TextColor(col).Center().Children(func() {
				a.icon(c, "close", 11)
			})
		})
		motionPressPose(close, close.Pressed(), 0.86)
		if close.Clicked() {
			closeClicked = true
		}
	})
	motionPressPose(b, b.Pressed(), 0.99)
	return b, b.Clicked(), closeClicked
}

// kitSegmented is a compact segmented control: one rounded track, a soft
// animated selection pill, and text that moves with it. It is the native
// replacement for the page's watchdog of three revision tabs.
func (a *nativeApp) kitSegmented(c *ui.Context, labels []string, active int) int {
	p := palette(c.Theme())
	chosen := active
	ui.Row(c).Height(24).Padding(2).Radius(6).Border(1, ui.Hex(p.border)).
		Background(ui.Hex(p.input)).Children(func() {
		for i, label := range labels {
			i, label := i, label
			b := ui.ButtonBase(c).Height(20).PaddingX(8).Radius(4).Center()
			bg := ui.Transparent
			if i == chosen {
				bg = ui.Hex(p.selectionStrong)
			} else if b.Hovered() {
				bg = ui.Hex(p.hover)
			}
			b.Background(motionColor(b, "kit-segment-bg", bg))
			fg := ui.Hex(p.muted)
			if i == chosen {
				fg = ui.Hex(p.fg)
			}
			fg = motionColor(b, "kit-segment-fg", fg)
			b.Children(func() {
				ui.Text(c, label).FontSize(11).TextColor(fg).FontWeight(500)
			})
			motionPressPose(b, b.Pressed(), 0.95)
			if b.Clicked() {
				chosen = i
			}
		}
	})
	return chosen
}

// kitDialogButton is the quiet action of a dialog footer or an inline
// row. It follows the page's 32px radius-9 button, with the kit's animated
// hover and pressed give.
func (a *nativeApp) kitDialogButton(c *ui.Context, label string, danger, disabled bool) bool {
	p := palette(c.Theme())
	b := ui.ButtonBase(c).Height(32).PaddingX(14).Radius(9).AlignItems(ui.Center).Disabled(disabled)
	bg := ui.Hex(p.raised)
	border := ui.Hex(p.border)
	if danger {
		bg = ui.Hex(p.danger)
		border = ui.Hex(p.danger)
	}
	if b.Hovered() && !disabled {
		if danger {
			bg = ui.Hex(p.danger).Mix(ui.RGB(255, 255, 255), 0.10)
		} else {
			bg = ui.Hex(p.raised).Mix(ui.Hex(p.hover), 0.45)
			border = ui.Hex(p.borderStrong)
		}
	}
	if b.Pressed() && !disabled {
		bg = bg.Mix(ui.Hex(p.hoverStrong), 0.55)
	}
	b.Background(motionColor(b, "kit-dialog-bg", bg)).Border(1, motionColor(b, "kit-dialog-border", border)).
		Shadow(0, 1, 2, 0, ui.RGBA(16, 24, 40, 0.05))
	fg := ui.Hex(p.fg)
	if danger {
		fg = ui.Hex(p.accentText)
	}
	b.Children(func() {
		ui.Text(c, label).FontSize(12.5).FontWeight(550).TextColor(motionColor(b, "kit-dialog-fg", fg))
	})
	motionPressPose(b, b.Pressed() && !disabled, 0.97)
	return b.Clicked() && !disabled
}

// kitDialogPrimary is the one filled action of a dialog.
func (a *nativeApp) kitDialogPrimary(c *ui.Context, label string, disabled bool) bool {
	p := palette(c.Theme())
	b := ui.ButtonBase(c).Height(32).PaddingX(14).Radius(9).AlignItems(ui.Center).Disabled(disabled)
	bg := ui.Hex(p.accent)
	if b.Hovered() && !disabled {
		bg = ui.Hex(p.accentHover)
	}
	if disabled {
		bg = ui.Hex(p.accent).Alpha(0.55)
	}
	b.Background(motionColor(b, "kit-dialog-primary-bg", bg)).
		Shadow(0, 4, 14, 0, ui.Hex(p.accent).Alpha(0.18))
	b.DrawOver(func(pt *ui.Painter, r ui.Rect) {
		pt.FillGradient(ui.Rect{X: r.X + 1, Y: r.Y + 1, W: r.W - 2, H: r.H * 0.5}, ui.LinearGradient{
			Angle: 180,
			From:  ui.RGBA(255, 255, 255, 0.18),
			To:    ui.Transparent,
		}, 8)
	})
	b.Children(func() {
		ui.Text(c, label).FontSize(12.5).FontWeight(550).TextColor(ui.Hex(p.accentText))
	})
	motionPressPose(b, b.Pressed() && !disabled, 0.97)
	return b.Clicked() && !disabled
}

// kitRow is the shared list row: fixed height, animated hover and selected
// washes, and the kit's padding rhythm. The caller composes its content.
func (a *nativeApp) kitRow(c *ui.Context, height, padStart, padEnd, gap float32, selected bool) ui.Element {
	p := palette(c.Theme())
	row := ui.Row(c).Height(height).PaddingStart(padStart).PaddingEnd(padEnd).Gap(gap).AlignItems(ui.Center)
	bg := ui.Transparent
	if selected {
		bg = ui.Hex(p.selection)
	} else if row.Hovered() {
		bg = ui.Hex(p.hover)
	}
	row.Background(motionColor(row, "kit-row-bg", bg))
	return row
}

// kitButtonRow is kitRow for a row that is itself the button, as branch
// groups and branch rows are.
func (a *nativeApp) kitButtonRow(c *ui.Context, height, padStart, padEnd, gap float32, selected bool) ui.Element {
	p := palette(c.Theme())
	b := ui.ButtonBase(c).Height(height).PaddingStart(padStart).PaddingEnd(padEnd).Gap(gap).
		AlignItems(ui.Center).FillWidth().Justify(ui.Start)
	bg := ui.Transparent
	if selected {
		bg = ui.Hex(p.selection)
	} else if b.Hovered() {
		bg = ui.Hex(p.hover)
	}
	b.Background(motionColor(b, "kit-button-row-bg", bg))
	return b
}

// kitEmptyState is the shared quiet state: a tinted icon tile, a title and
// a muted explanation.
func (a *nativeApp) kitEmptyState(c *ui.Context, icon, title, message string, tint ui.Color) {
	ui.Column(c).Fill().Center().Gap(6).Padding(24, 20).Children(func() {
		ui.Box(c).Size(26, 26).Radius(12).Background(tint.Alpha(0.12)).Center().Children(func() {
			ui.Row(c).TextColor(tint).Center().Children(func() {
				a.icon(c, icon, 15)
			})
		})
		ui.Text(c, title).FontSize(11.5).FontWeight(600).TextColor(ui.Hex(palette(c.Theme()).fgSoft))
		if message != "" {
			ui.Text(c, message).FontSize(10.5).TextColor(ui.Hex(palette(c.Theme()).muted2)).MaxWidth(260)
		}
	})
}

// kitCheckbox is the page's 16px checkbox: a rounded box that fills with
// the accent gradient, a white check, and a quiet border when off. It
// replaces MyGo's stock box throughout the native views.
func kitCheckbox(c *ui.Context, checked *bool, label string) ui.Element {
	p := palette(c.Theme())
	state := ui.CheckOff
	if *checked {
		state = ui.CheckOn
	}
	b := ui.CheckboxStateBase(c, &state).Label(label)
	b.Children(func() {
		ui.Row(c).Gap(6).AlignItems(ui.Center).Children(func() {
			box := ui.Box(c).Size(16, 16).Radius(5)
			box.Draw(func(pt *ui.Painter, r ui.Rect) {
				switch state {
				case ui.CheckOn:
					pt.FillGradient(r, ui.LinearGradient{
						Angle: 180, From: ui.Hex(p.accentHover), To: ui.Hex(p.accent), Oklab: true,
					}, 5)
					pt.Stroke(r, ui.Hex(p.accent), 5, 1)
				case ui.CheckMixed:
					pt.Fill(r, ui.Hex(p.accent), 5)
				default:
					fill := ui.Transparent
					if b.Hovered() {
						fill = ui.Hex(p.hover)
					}
					pt.Fill(r, fill, 5)
					pt.Stroke(r, ui.Hex(p.muted2).Alpha(0.55), 5, 1.5)
				}
			})
			box.Children(func() {
				switch state {
				case ui.CheckOn:
					ui.Row(c).TextColor(ui.Hex(p.accentText)).Center().Children(func() {
						ui.Icon(c, iconSVG("check")).Size(11, 11)
					})
				case ui.CheckMixed:
					ui.Box(c).Size(9, 2.5).Radius(1).Background(ui.Hex(p.accentText))
				}
			})
			if label != "" {
				ui.Text(c, label).FontSize(12.5).TextColor(ui.Hex(p.fgSoft))
			}
		})
	})
	if b.Changed() {
		*checked = state == ui.CheckOn
	}
	return b
}
