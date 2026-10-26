# GitJet

![CI](https://github.com/oxyuan/gitjet/actions/workflows/ci.yml/badge.svg)

GitJet 是一个面向 Windows 与 macOS 的桌面 Git 客户端。界面由 Go 编写的后端服务与 React 前端组成，运行在系统 WebView 中：macOS 使用 WKWebView，Windows 使用 WebView2。

核心工作流围绕「本地变更 → 变更集 → 提交 → 日志 → 分支同步」展开，提供 Git 命令行的完整能力，同时把常用操作放进图形界面。代码审查场景可以同时打开差异、源码文件与冲突解决视图，在多个标签页之间切换。

## 功能

### 本地变更与提交

- 工作区状态实时刷新，外部修改（终端、编辑器、钩子）会自动同步
- 已暂存 / 未暂存分开呈现；支持按文件、按 hunk 暂存、取消暂存与回滚
- 变更集（Changelist）：新建、重命名、删除、设为活动、移动文件；按仓库持久化
- 提交面板：全选/反选文件、提交信息历史、Amend、Sign-off、跳过钩子、自定义作者
- 提交并推送、提交后自动刷新日志
- 未跟踪文件：加入版本控制、删除、写入 `.gitignore`
- 贮藏（Stash）：创建、列表、应用、弹出、删除；支持包含未跟踪文件与保留暂存区
- 合并冲突逐行解决：并排对比 Ours / Theirs（含词级差异），点击任意一行插入结果，或整段选择 Ours / Theirs / Both；可查看共同祖先、编辑最终文件、查看最终结果预览；支持继续/中止 merge、rebase、cherry-pick、revert
- 源码查看：直接打开工作区、索引或任意提交中的文件，带语法高亮、行号、自动换行与文件内变更跳转；可在源码与差异之间一键切换
- 快速打开：`⌘/Ctrl+P` 按文件名或路径片段搜索工作区文件（包含未跟踪文件）
- 编辑器标签页：差异、源码、冲突、Blame 与提交详情同时打开，支持关闭与中键关闭

### 日志与历史

- 提交图（多 lane、合并线、分支/标签标记）
- 按当前分支、全部分支或指定分支过滤；全文搜索、按路径查看文件历史
- 提交详情：作者、时间、完整提交信息、引用、文件列表与行数统计
- 提交操作：检出、从此新建分支/标签、Cherry-Pick、Revert、Soft/Mixed/Hard Reset、复制哈希
- 文件历史与作者标注（Blame）
- 在提交详情中直接打开对应版本的源码文件

### 差异查看器

- 并排 / 统一两种排版，长行自动换行
- 行内词级差异高亮、折叠未修改区域、上一处/下一处变更
- 忽略空白差异
- 在差异中直接暂存、取消暂存、回滚单个 hunk 或整个文件
- 二进制文件、超大文件与重命名/复制识别

### 分支与远端

- 分支弹窗：本地/远程分支、标签、上游跟踪、领先/落后计数、搜索
- 检出、新建、重命名、删除（含强制删除二次确认）、合并、变基、设置上游
- Fetch / Pull（merge 或 rebase、autostash、prune、tags）/ Push（set-upstream、`--force-with-lease`、tags、dry run）
- 操作输出实时流式显示，失败时保留完整错误信息

### 其他

- Git 控制台：执行任意 git 子命令，Tab 补全命令/选项/引用，命令历史
- 设置：Git 可执行文件路径与检测、主题、diff 上下文行数、空白处理、显示忽略文件、自动 fetch、更新策略、危险操作确认
- 最近仓库列表；启动时自动恢复上次打开的仓库
- 原生文件夹选择、系统剪贴板、在文件管理器中显示文件

## 技术栈

- **Go 1.27+**：全部 Git 操作通过调用本机 `git` 完成，保留用户的 hooks、filters、credential helper、签名等配置
- **MyGo**：窗口、菜单、原生对话框、WebView、类型安全的 Go ↔ TypeScript IPC；前端类型由 Go 服务自动生成（`src/mygo.ts`）
- **React 19 + TypeScript + Vite**
- **无 cgo**：可交叉编译到 Windows 与 macOS

## 开发

环境要求：

- Go 1.27.3 或更高
- Bun（或 npm）
- Git 2.23+（需要 `git switch`）
- Windows 10+ 需 WebView2 Runtime；macOS 使用系统 WKWebView

```sh
bun install
bun run dev        # 启动开发版，Vite 热更新
```

其他命令：

```sh
bun run typecheck  # TypeScript 类型检查
bun run test:web   # 前端纯逻辑单元测试（Bun test）
bun run generate   # 重新生成 src/mygo.ts
go test ./...      # Go 单元测试
go vet ./...
```

## 构建

```sh
bun run build                                   # 当前平台安装包
bun run build -- -platform darwin/universal,windows/amd64
```

产物位于 `build/<os>-<arch>/`：macOS 生成 `.app` 与 `.dmg`，Windows 生成 `.exe` 与安装程序（交叉构建安装程序需要本机安装 NSIS；未安装时只生成 `.exe`）。

## 目录结构

```
main.go                 应用入口
internal/app/           窗口、菜单、事件、绑定服务（Workspace / Git）、设置与仓库元数据
internal/git/           Git 命令层：状态、差异、日志、分支、提交、贮藏、冲突、Blame、控制台
src/                    React 前端
  App.tsx               应用状态、编辑器标签页与操作编排
  CommitPanel.tsx       变更列表与提交面板
  SourceView.tsx        源码查看（语法高亮、行号、换行）
  QuickOpen.tsx         快速打开文件
  highlight.ts          Prism 语法高亮
  LogPanel.tsx          提交图与提交详情
  DiffView.tsx          并排/统一差异查看器、Blame 视图
  ConflictView.tsx      逐行冲突解决与三路对比
  merge.ts              冲突解析、行对齐与结果组装（纯函数，带测试）
  ConsolePanel.tsx      Git 控制台
  Dialogs.tsx           推送、拉取、重置、标签、设置等对话框
  BranchPopup.tsx       分支弹窗
  mygo.ts               由 Go 服务生成的类型安全客户端
```

## 快捷键

| 快捷键 | 操作 |
| --- | --- |
| `⌘/Ctrl+O` | 打开仓库 |
| `⌘/Ctrl+P` | 快速打开文件 |
| `⌘/Ctrl+R` | 刷新 |
| `⌘/Ctrl+K` | 聚焦提交信息 |
| `⌘/Ctrl+Enter` | 提交 |
| `⌘/Ctrl+Shift+K` | 推送 |
| `⌘/Ctrl+T` | 更新项目（拉取） |
| `⌘/Ctrl+,` | 设置 |
| `⌘/Ctrl+9` / `⌘/Ctrl+0` | Commit / Log 工具窗口 |

## 说明

- GitJet 调用本机 Git，不内置 Git 实现；认证沿用系统 SSH agent 或 Git credential helper。
- 当前不支持交互式 rebase 编辑器、子模块与 worktree 管理。
- 所有 Git 写操作串行执行，避免并发操作争用 `index.lock`。
