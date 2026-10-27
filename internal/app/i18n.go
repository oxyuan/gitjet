package app

import (
	"os"
	"runtime"
	"strings"
)

// lang is the UI language: "en" or "zh".
type lang string

const (
	langEN lang = "en"
	langZH lang = "zh"
)

// resolveLang maps the settings value to a concrete language: "system"
// follows the OS, anything else names the language.
func resolveLang(setting string) lang {
	switch setting {
	case string(langEN):
		return langEN
	case string(langZH):
		return langZH
	}
	return systemLang()
}

// systemLang reads the user's language from the OS.
func systemLang() lang {
	if runtime.GOOS == "windows" {
		if systemUILanguageIsChinese() {
			return langZH
		}
		return langEN
	}
	for _, key := range []string{"LC_ALL", "LC_MESSAGES", "LANG"} {
		if v := os.Getenv(key); strings.HasPrefix(strings.ToLower(v), "zh") {
			return langZH
		}
	}
	return langEN
}

// messages holds the native-side text, keyed by message.
var messages = map[lang]map[string]string{
	langEN: {
		"menu.file":              "File",
		"menu.edit":              "Edit",
		"menu.view":              "View",
		"menu.git":               "Git",
		"menu.window":            "Window",
		"menu.openRepo":          "Open Repository…",
		"menu.quickOpen":         "Quick Open File…",
		"menu.closeTab":          "Close Editor Tab",
		"menu.closeRepo":         "Close Repository",
		"menu.settings":          "Settings…",
		"menu.commitTab":         "Commit",
		"menu.logTab":            "Log",
		"menu.filesTab":          "Files",
		"menu.consoleTab":        "Console",
		"menu.refresh":           "Refresh",
		"menu.commit":            "Commit…",
		"menu.push":              "Push…",
		"menu.pull":              "Update Project…",
		"menu.fetch":             "Fetch",
		"menu.branches":          "Branches…",
		"menu.stash":             "Stash Changes…",
		"menu.showConsole":       "Show Console",
		"menu.repoTools":         "Repository Tools…",
		"menu.cleanupBranches":   "Clean Up Branches…",
		"menu.resolveConflicts":  "Resolve Conflicts…",
		"dialog.openRepo":        "Open Git Repository",
		"dialog.openRepoButton":  "Open",
		"dialog.openRepoMessage": "Choose a folder inside a Git working tree",
	},
	langZH: {
		"menu.file":              "文件",
		"menu.edit":              "编辑",
		"menu.view":              "视图",
		"menu.git":               "Git",
		"menu.window":            "窗口",
		"menu.openRepo":          "打开仓库…",
		"menu.quickOpen":         "快速打开文件…",
		"menu.closeTab":          "关闭编辑器标签页",
		"menu.closeRepo":         "关闭仓库",
		"menu.settings":          "设置…",
		"menu.commitTab":         "提交",
		"menu.logTab":            "日志",
		"menu.filesTab":          "文件",
		"menu.consoleTab":        "控制台",
		"menu.refresh":           "刷新",
		"menu.commit":            "提交…",
		"menu.push":              "推送…",
		"menu.pull":              "更新项目…",
		"menu.fetch":             "获取",
		"menu.branches":          "分支…",
		"menu.stash":             "贮藏更改…",
		"menu.showConsole":       "显示控制台",
		"menu.repoTools":         "仓库工具…",
		"menu.cleanupBranches":   "清理分支…",
		"menu.resolveConflicts":  "解决冲突…",
		"dialog.openRepo":        "打开 Git 仓库",
		"dialog.openRepoButton":  "打开",
		"dialog.openRepoMessage": "选择 Git 工作区所在的文件夹",
	},
}

// tr returns the message in l.
func (l lang) tr(key string) string {
	if m, ok := messages[l][key]; ok {
		return m
	}
	return messages[langEN][key]
}
