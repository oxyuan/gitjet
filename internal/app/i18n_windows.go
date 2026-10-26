//go:build windows

package app

import "syscall"

// systemUILanguageIsChinese reports whether the Windows UI language is
// Chinese. LANGID's low 10 bits hold the primary language; 0x04 is Chinese.
func systemUILanguageIsChinese() bool {
	kernel32 := syscall.NewLazyDLL("kernel32.dll")
	proc := kernel32.NewProc("GetUserDefaultUILanguage")
	if err := proc.Find(); err != nil {
		return false
	}
	id, _, _ := proc.Call()
	return uint16(id)&0x3ff == 0x04
}
