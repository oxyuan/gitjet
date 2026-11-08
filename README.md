<div align="center">

<img src="resources/icon.png" width="96" alt="GitJet" />

# GitJet

**把真正的 `git` 装进一个好看的桌面界面。**

Go 调用你机器上的 git，React 画界面。hooks、filters、credential helper、签名和你的全局配置照常生效——因为它从不重写 git。

[![CI](https://github.com/oxyuan/gitjet/actions/workflows/ci.yml/badge.svg)](https://github.com/oxyuan/gitjet/actions/workflows/ci.yml)
![Go](https://img.shields.io/badge/Go-1.27-00ADD8?logo=go&logoColor=white)
![React](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=white)
![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20macOS-lightgrey)

![GitJet 主界面](docs/main.png)

</div>

## ✨ 亮点

- 🧩 **三栏冲突解决** —— 本地 / 结果 / 远程同屏，逐块接受或忽略，结果区可直接编辑。
- 🕰️ **可视化改历史** —— pick / reword / squash / fixup / drop，冲突时暂停，可继续或中止。
- 🗂️ **变更集** —— 改动按主题分组，一个仓库同时开几条线。
- 🔍 **在差异旁读代码** —— LSP 跳转与悬停文档、行内 blame，点变更条回滚 hunk。
- 🧬 **原生 git** —— 每条命令都是本机的 git，行为和终端一致。
- 🪶 **轻** —— 系统 WebView，无 Electron；无 cgo，Windows / macOS 交叉编译。

## 📸 界面

**冲突解决**：三栏合并、块级接受 / 忽略、同步滚动。

![冲突解决](docs/conflict.png)

**源码阅读**：目录树、可编辑源码、行内 blame 与 LSP。

![源码阅读](docs/source.png)

## 🧰 功能一览

- 🗂️ **工作区** —— 按文件、hunk 或选中行暂存与回滚；变更集；贮藏、补丁、搁置、本地历史。
- ✍️ **提交** —— amend、sign-off、GPG 与签名校验、模板、只提交选中更改、提交前检查、撤销提交、fixup / squash。
- 🌿 **分支与远端** —— 检出 / 更新、标签、清理已合并分支、工作树、子模块、LFS、钩子、push 预览与 refspec。
- 🕰️ **历史** —— 多 lane 提交图、过滤与搜索、任意比较、cherry-pick / revert / reset、文件历史、blame。
- 🔀 **冲突与重写** —— 三栏合并与内存三方合并（按 git 的 diff3 算法，不触碰工作区即可暂存结果）；merge / rebase / cherry-pick / revert 的继续、跳过与中止；交互式 rebase。
- 👀 **阅读** —— 并排 / 统一差异、图片对照、可编辑源码、LSP、快速打开、多标签。
- 🖥️ **工具** —— 控制台与操作日志、快捷键、主题与语言、最近仓库、系统集成。

## 🚀 快速开始

目前没有预编译发行版，从源码构建：

```sh
bun install && bun run build     # 产物在 build/<os>-<arch>/
```

| 依赖 | 说明 |
| --- | --- |
| Go 1.27.3+ | 构建后端 |
| Bun | 包管理、构建、前端测试 |
| Git 2.23+ | 运行时调用，认证沿用系统 SSH agent / credential helper |
| WebView2 | 仅 Windows，Win11 自带，[下载](https://developer.microsoft.com/microsoft-edge/webview2/) |

macOS 产出 `.app` / `.dmg`，Windows 产出 `GitJet.exe` 与安装程序（交叉构建安装程序需本机有 NSIS）。指定平台：

```sh
bun run build -- -platform darwin/universal,windows/amd64
```

## 🧑‍💻 开发

```sh
bun run dev          # 生成绑定 + Vite + 原生窗口（热更新）
bun run typecheck    # tsc --noEmit
bun run test:web     # 前端纯逻辑单测
go test ./... && go vet ./...
```

提交前跑一遍 CI 同款门槛：

```sh
go test ./... && go vet ./... && bun run typecheck && bun run test:web && bun run build:web
```

## ⌨️ 常用快捷键

| 快捷键 | 操作 |
| --- | --- |
| `⌘/Ctrl+O` | 打开仓库 |
| `⌘/Ctrl+P` | 快速打开文件 / 提交 |
| `⌘/Ctrl+K` | 聚焦提交信息 |
| `⌘/Ctrl+Enter` | Commit |
| `⌘/Ctrl+Shift+K` | Push |
| `⌘/Ctrl+T` | Pull |
| `⌘/Ctrl+Shift+S` | Stash |
| `` ⌘/Ctrl+Shift+` `` | 分支弹窗 |
| `⌘/Ctrl+9` / `⌘/Ctrl+0` | 提交 / 分支工具窗口 |
| `⌘/Ctrl+B` / `⌘/Ctrl+Shift+B` | 跳到定义 / 列出引用 |
| `⌘/Ctrl+S` | 保存源码 / 应用冲突结果 |
| `F7` / `Shift+F7` | 下一处 / 上一处变更（冲突视图） |

## 📌 说明

- 不内置 Git，版本过低会直接提示。
- 语言服务器不随应用打包，只从 `PATH` 找；没有服务器时跳转退化为文本搜索。
- 构建产物未签名（macOS 为 ad-hoc），没有自动更新。
