//go:build !windows

package git

import "os/exec"

// prepareCmd does nothing outside Windows, where child processes never open
// a console window of their own.
func prepareCmd(*exec.Cmd) {}
