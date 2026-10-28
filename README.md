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
- 贮藏详情：列出该贮藏改动的文件与行数，逐文件查看差异，可恢复到新分支
- 操作保护：检出、合并、变基、摘取、还原、拉取前自动贮藏本地改动，完成后自动恢复；恢复失败时保留在 stash 中并提示
- 合并冲突逐行解决：并排对比 Ours / Theirs（含词级差异），点击任意一行插入结果，或整段选择 Ours / Theirs / Both；可查看共同祖先、编辑最终文件、查看最终结果预览；支持继续/中止 merge、rebase、cherry-pick、revert
- 冲突汇总对话框：一次列出全部冲突文件，全部采用我方/对方、批量标记已解决、继续或中止操作
- 源码查看：直接打开工作区、索引或任意提交中的文件，用 CodeMirror 6 渲染（按需加载 30+ 语言语法、只读、行号、自动换行）；可在源码与差异之间一键切换
- 编辑器标注：左侧变更条对应 git 的 hunk，点击即可回滚该段修改（带确认）；当前行尾部显示 blame（作者、提交、摘要、时间），未提交的行单独标记
- 跳转：`⌘/Ctrl+B`（或 `F12`）跳到定义、`⌘/Ctrl+Shift+B`（或 `Shift+F12`）列出引用、`⌘/Ctrl+点击`/`⌘/Ctrl+Alt+点击` 同效，悬停显示文档；仓库里有 `gopls`、`clangd`、`typescript-language-server`、`rust-analyzer`、`jdtls`、`pyright-langserver` 时用语言服务器（含诊断波浪线），否则退回工作区全文搜索，按语言规则区分声明与引用
- 快速打开：`⌘/Ctrl+P` 按文件名或路径片段搜索工作区文件（包含未跟踪文件）；输入两个字以上时同时搜索提交信息与作者
- 编辑器标签页：差异、源码、冲突、Blame 与提交详情同时打开，支持关闭与中键关闭
- 复制路径：源码与差异的路径旁是一个小图标，点开可选绝对路径、仓库相对路径、文件名（三者都可带行号，行号跟随源码视图的光标），以及为终端转义好的绝对路径

### 日志与历史

- 提交图（多 lane、合并线、分支/标签标记）；分支/标签排在提交信息之后，只占自己需要的宽度，不会把最近一条提交的标题挤掉
- 时间列显示到秒；今天的提交写作「今天 09:41:26」，其余保持完整日期
- 按当前分支、全部分支或指定分支过滤；全文搜索、按路径查看文件历史
- 提交详情：作者、时间、完整提交信息、引用、文件列表与行数统计
- 提交操作：检出、从此新建分支/标签、Cherry-Pick、Revert、Soft/Mixed/Hard Reset、复制哈希
- 多选提交：⌘/Ctrl 点击与 Shift 连选，可批量摘取、批量还原、复制多个哈希
- 编辑历史（交互式 rebase 的可视化版本）：对一段提交逐条选择保留 / 改写信息 / 压缩 / 合并（fixup）/ 删除；遇到冲突暂停，用「继续」接着重放，用「中止」回到起点
- 与当前分支比较：分支右键列出与 HEAD 之间的差异文件，逐个打开差异
- 文件历史与作者标注（Blame）
- 在提交详情中直接打开对应版本的源码文件

### 差异查看器

- 并排 / 统一两种排版，长行自动换行
- 默认给出整个文件、只高亮改动部分（上下文行数 -1）；设成 1–100 则只保留改动附近的窗口，并折叠其余未修改区域
- 两侧都有语法高亮：差异里的关键字、字符串、注释与「源码」视图同一个调色板（`src/highlight.ts` 一份规则，编辑器与差异各自渲染）
- 行内词级差异高亮、上一处/下一处变更
- 忽略空白差异
- 在差异中直接暂存、取消暂存、回滚单个 hunk 或整个文件
- 二进制文件、超大文件与重命名/复制识别

### 分支与远端

- 分支弹窗：本地/远程分支、标签、上游跟踪、领先/落后计数、搜索
- 清理分支：列出已合并到当前分支、以及上游已删除的本地分支，勾选后删除
- 工作树：列出全部工作树，新建（可同时建分支）、在新窗口打开、移除、清理失效项
- 子模块与 Git LFS：列出子模块状态并初始化/更新；显示 LFS 是否安装与跟踪的文件；浅克隆可补全历史
- 检出、新建、重命名、删除（含强制删除二次确认）、合并、变基、设置上游
- Fetch / Pull（merge 或 rebase、autostash、prune、tags）
- Push 前二次确认：当前分支 → 远程分支的走向、本次提交列表（选中单个提交可看它的文件）、全部变更文件；远程分支不存在时标出「新建分支」，并支持 set-upstream、`--force-with-lease`、`--force-if-includes`、tags、dry run
- Push 安全提示：远端分支有本地没有的提交（历史已分叉）时明确警告；记住最近推送过的目标分支
- 推送预览里可以直接改远程分支名：`本地 : 远程` 的第二段是个输入框，改成别的名字就是以不同名称发布（走 refspec，本地分支名不变），预览会即时刷新并标出"新建分支"
- 操作输出实时流式显示，失败时保留完整错误信息
- 命令回显：每个操作实际执行的 git 命令（如 `$ git fetch --progress --all --prune --tags`）显示在操作面板中，可一键复制

### 其他

- 文件视图（左侧「文件」页，⌘/Ctrl+Shift+E）：整个工作区的目录树，含未被 git 跟踪的文件；按路径子序列筛选，点开就是源码视图。这是「读代码」的地方，与「改动」无关
- Git 控制台：`git` 是固定前缀，输入 `status` 就是 `git status`；以 `!` 开头则按原样运行其他程序（`!ls -la`、`!pwd`）。Tab 补全子命令/选项/引用，命令历史
- 设置：界面语言、主题、字号（整窗缩放）、Git 可执行文件路径与检测、diff 上下文行数（默认 -1 = 整个文件）、空白处理、显示忽略文件、自动 fetch、更新策略、危险操作确认
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
internal/git/           Git 命令层：状态、差异、日志、分支、提交、贮藏、冲突、Blame、控制台、
                        历史重写（rewrite.go）、工作树/清理/子模块/LFS/浅克隆（repo_extra.go）
src/                    React 前端
  App.tsx               应用状态、编辑器标签页与操作编排
  CommitPanel.tsx       变更列表与提交面板
  SourceView.tsx        源码查看的外壳：标题、工具栏、二进制/空文件状态
  SourceEditor.tsx      源码编辑器的挂载、变更条、blame 与跳转接线
  editor.ts             CodeMirror 6 配置：主题、按需语法、变更条、blame 装饰
  lsp.ts                语言服务器客户端：IPC 传输、工作区、跨文件跳转
  symbols.ts            标识符取词与声明/引用分类（纯函数，带测试）
  annotate.ts           由文件差异推导变更条区间（纯函数，带测试）
  SymbolPanel.tsx       引用列表对话框
  QuickOpen.tsx         快速打开文件与提交
  LogDock.tsx           提交图与提交详情（含多选）
  DiffView.tsx          并排/统一差异查看器、Blame 视图
  ConflictView.tsx      逐行冲突解决与三路对比
  merge.ts              冲突解析、行对齐与结果组装（纯函数，带测试）
  graph.ts              提交图 lane 计算（纯函数，带测试）
  ConsolePanel.tsx      Git 控制台
  SourceTree.tsx        文件视图（工作区目录树 + 筛选）
  syntax.ts             把 Lezer 语法树变成逐行 token，并在差异里叠加词级改动
  highlight.ts          唯一的语法调色板：编辑器与差异共用
  Dialogs.tsx           推送、拉取、重置、标签、设置等对话框
  BranchList.tsx        分支弹窗
  EditHistoryDialog.tsx 编辑历史（reword / squash / fixup / drop）
  RepoExtrasDialog.tsx  工作树 / 子模块 / Git LFS
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
| `⌘/Ctrl+B` | 跳到定义（源码视图中） |
| `⌘/Ctrl+Shift+B` | 列出引用（源码视图中） |
| `⌘/Ctrl+点击` | 跳到定义；`⌘/Ctrl+Alt+点击` 列出引用 |
| `⌘/Ctrl+9` / `⌘/Ctrl+0` | Commit / Log 工具窗口 |
| `⌘/Ctrl+Shift+E` | 文件工具窗口 |
| `⌘/Ctrl+Shift+9` | 控制台工具窗口 |

## 说明

- GitJet 调用本机 Git，不内置 Git 实现；认证沿用系统 SSH agent 或 Git credential helper。
- 语言服务器不随应用打包：装在哪里都行，只要能通过 `PATH` 找到。没有服务器时跳转仍然可用，只是按文本匹配，准确率不如类型解析。
- 编辑历史的计划按时间顺序执行，暂不支持在列表内拖动重排或 `edit`（停下来修改内容）动作。
- 子模块与 LFS 是只读状态加更新动作，没有子模块新增/删除与 LFS 跟踪规则编辑。
- 所有 Git 写操作串行执行，避免并发操作争用 `index.lock`。
