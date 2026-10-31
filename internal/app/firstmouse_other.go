//go:build !darwin

package app

// acceptFirstMouse has no counterpart outside macOS: windows there get the
// first click in an inactive window as they are.
func acceptFirstMouse() {}
