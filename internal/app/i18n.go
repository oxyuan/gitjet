package app

import (
	"strings"

	"github.com/egoist/mygo"
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

// systemLang is the language the user reads best: the first of MyGo's
// preferred languages, which are the system's own on every platform. The
// environment cannot say it: a macOS app started from the Finder has no
// LANG, and would show English to a Chinese reader. The page asks
// navigator.language, which is the same list.
func systemLang() lang {
	for _, tag := range mygo.App.PreferredLanguages() {
		if strings.HasPrefix(strings.ToLower(tag), "zh") {
			return langZH
		}
		return langEN
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
		"menu.clone":             "Clone Repository…",
		"menu.init":              "Create Git Repository…",
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
		"menu.merge":             "Merge…",
		"menu.stash":             "Stash Changes…",
		"menu.showConsole":       "Show Console",
		"menu.repoTools":         "Repository Tools…",
		"menu.remotes":           "Remotes…",
		"menu.browseRevision":    "Browse Repository at Revision…",
		"menu.cleanupBranches":   "Clean Up Branches…",
		"menu.resolveConflicts":  "Resolve Conflicts…",
		"dialog.savePatch":       "Save Patch",
		"dialog.save":            "Save",
		"dialog.openPatch":       "Open Patch",
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
		"menu.clone":             "克隆仓库…",
		"menu.init":              "新建 Git 仓库…",
		"menu.quickOpen":         "快速打开文件…",
		"menu.closeTab":          "关闭编辑器标签页",
		"menu.closeRepo":         "关闭仓库",
		"menu.settings":          "设置…",
		"menu.commitTab":         "提交",
		"menu.logTab":            "日志",
		"menu.filesTab":          "文件",
		"menu.consoleTab":        "控制台",
		"menu.refresh":           "刷新",
		"menu.commit":            "Commit…",
		"menu.push":              "Push…",
		"menu.pull":              "Pull…",
		"menu.fetch":             "Fetch",
		"menu.branches":          "分支…",
		"menu.merge":             "Merge…",
		"menu.stash":             "Stash 更改…",
		"menu.showConsole":       "显示控制台",
		"menu.repoTools":         "仓库工具…",
		"menu.remotes":           "远端…",
		"menu.browseRevision":    "浏览所选提交的仓库…",
		"menu.cleanupBranches":   "清理分支…",
		"menu.resolveConflicts":  "解决冲突…",
		"dialog.savePatch":       "保存补丁",
		"dialog.save":            "保存",
		"dialog.openPatch":       "打开补丁",
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
