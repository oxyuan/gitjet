//go:build !windows

package app

// systemUILanguageIsChinese is unused outside Windows: systemLang reads the
// locale from the environment there.
func systemUILanguageIsChinese() bool { return false }
