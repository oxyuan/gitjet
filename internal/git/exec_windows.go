//go:build windows

package git

import (
	"os/exec"
	"syscall"
)

// createNoWindow is CREATE_NO_WINDOW from the Win32 process creation flags.
const createNoWindow = 0x08000000

// prepareCmd hides the console window Windows creates for every console
// program. GitJet is a GUI process, so without this each git invocation
// (the status poll runs every 1.5s) flashes a new git console window.
func prepareCmd(cmd *exec.Cmd) {
	cmd.SysProcAttr = &syscall.SysProcAttr{
		HideWindow:    true,
		CreationFlags: createNoWindow,
	}
}
