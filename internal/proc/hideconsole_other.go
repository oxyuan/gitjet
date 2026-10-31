//go:build !windows

package proc

import "os/exec"

// HideConsole does nothing outside Windows, where child processes never open a
// console window of their own.
func HideConsole(*exec.Cmd) {}
