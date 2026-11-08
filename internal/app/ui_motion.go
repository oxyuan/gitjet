package app

import (
	"time"

	"github.com/egoist/mygo/ui"
)

// The app's motion vocabulary. Durations are short enough that a toolbar
// reads as responsive, and the springs keep their velocity when the pointer
// reverses direction mid-press: the same vocabulary the page had in CSS,
// now expressed as values of the native renderer.
var (
	// motionHover moves a control's color under the pointer.
	motionHover = ui.Animation{Duration: 130 * time.Millisecond, Oklab: true}
	// motionPress gives a control its small give when pressed. Snappy is
	// deliberately not Bouncy: a toolbar button must not wobble.
	motionPress = ui.Animation{Spring: ui.SpringOptions{Duration: 260 * time.Millisecond, Bounce: 0.12}}
	// motionSelect slides the active marker under a tab or segment.
	motionSelect = ui.Animation{Spring: ui.SpringOptions{Duration: 300 * time.Millisecond, Bounce: 0.1}}
	// motionPanel fades a card or a floating layer in.
	motionPanel = ui.Animation{Duration: 170 * time.Millisecond, Ease: ui.EaseOut, NonMotion: true}
)

// motionColor animates a color channel on el. Keys are local to el, so a
// control can keep separate background, border and foreground channels.
func motionColor(el ui.Element, key string, target ui.Color) ui.Color {
	return el.AnimateColor(key, target, motionHover)
}

// motionPressPose gives el a press scale and springs back on release. It is
// the native equivalent of the page's :active transform, with the pointer
// release handled by the spring's velocity.
func motionPressPose(el ui.Element, pressed bool, scale float32) {
	pose := ui.Pose{}
	if pressed {
		pose.Scale = scale
	}
	el.AnimatePose(pose, motionPress)
}

// motionReveal returns how far an active indicator has grown, from 0 to 1.
func motionReveal(el ui.Element, key string, active bool) float32 {
	to := float32(0)
	if active {
		to = 1
	}
	return el.AnimateTo(key, to, motionSelect)
}

// motionFade returns an opacity that follows a boolean without moving
// layout.
func motionFade(el ui.Element, key string, visible bool) float32 {
	to := float32(0)
	if visible {
		to = 1
	}
	return el.AnimateTo(key, to, motionPanel)
}
