# GitJet

**跑在系统 WebView 里的桌面 Git 客户端。**Go 负责调用你机器上真正的 `git`，React 负责界面；没有 Git 重实现，所以 hooks、filters、credential helper、签名和你的全局配置照常生效。

[![CI](https://github.com/oxyuan/gitjet/actions/workflows/ci.yml/badge.svg)](https://github.com/oxyuan/gitjet/actions/workflows/ci.yml)
![Go](https://img.shields.io/badge/Go-1.27-00ADD8?logo=go&logoColor=white)
![React](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=white)
![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20macOS-lightgrey)

---

## 它解决什么问题

多数 Git GUI「看」做得很好，「改历史」和「解冲突」却退化成一次性命令行弹窗。GitJet 把这两件事做成一等公民：

- **IDEA 风格三栏冲突解决**：本地 / 结果 / 远程三栏同屏，变更块与行内词级差异高亮，按块从任一侧应用、自动解决简单冲突、`F7` 导航、滚动同步、结果区可直接编辑；全部解决后应用即暂存，仍有标记时保存只写文件，然后继续 merge / rebase / cherry-pick / revert。
- **可视化交互式 rebase**：对一段提交逐条保留 / 改写 / 压缩 / fixup / 删除；冲突时暂停，继续即重放剩余计划，中止即回到起点。
- **变更集（Changelist）**：改动按主题分组、切换活动集，按仓库持久化，适合手上同时开三条线。
- **在差异旁边读代码**：源码视图有 LSP 跳转定义/引用、悬停文档与诊断；左侧变更条点一下回滚对应 hunk，当前行显示 blame。

## 架构

```mermaid
flowchart LR
  menu["原生菜单 / 快捷键"] -- "events.appCommand" --> ui
  ui["React 19 UI<br/>CodeMirror 6"] -- "typed IPC (src/mygo.ts)" --> host
  host["internal/app<br/>Workspace · Git 服务<br/>菜单 · 设置 · 轮询"] --> core
  core["internal/git<br/>命令执行 + 输出解析"] --> git[("本机 git<br/>hooks · credential helper · 签名")]
  core -- "status 签名变化" --> host
  host -- "events.repoChanged" --> ui
```

- 前端从不拼 git 命令，也不做乐观更新：改完 → `await Git.x()` → 重新读取 → 事件广播刷新。
- 写操作串行执行，避免争用 `index.lock`；读操作不加锁，长推送期间轮询照常。
- 无 cgo，Windows / macOS 都能交叉编译。

## 功能

### 工作区与提交
- 状态实时刷新，终端或编辑器里的改动会自动同步；已暂存 / 未暂存分开呈现
- 克隆仓库、新建仓库（可指定初始分支）、管理远端（添加/修改地址/重命名/删除）
- 按文件、hunk 或**选中行**暂存、取消暂存、回滚；未跟踪文件可「暂存但不含内容」（`git add -N`）
- 比较 HEAD 与工作区（`Compare with HEAD`），索引与工作区、HEAD 与索引三种视角齐备
- 变更集：新建、重命名、删除、设为活动、移动文件
- 提交面板：全选/反选、提交信息历史、Amend、Sign-off、跳过钩子、自定义作者、允许空提交、GPG 签名、按 72 列重排信息、提交信息模板
- 提交前检查（可设置）：CRLF 换行、超大文件、Windows 不可检出的文件名、分离 HEAD；确认后可继续
- 撤销上次提交（改动保留在暂存区、信息回到输入框）、提交并推送、提交并 Rebase；日志里可对任意提交创建 `fixup!`/`squash!` 提交，配合 autosquash Rebase
- 文件/目录右键忽略：写入 `.gitignore`；已跟踪文件同时移出 Git 索引（磁盘保留），不再跟踪后续变更
- 贮藏：创建/列表/应用/弹出/删除（可含未跟踪文件、保留暂存区、应用时还原索引 `--index`、一键清空）；贮藏详情逐文件看差异，可恢复到新分支
- 补丁：从工作区/索引/提交生成补丁并另存，应用补丁文件
- 搁置（Shelf）：把更改保存成仓库内的补丁并移出工作区，之后应用、应用并删除或删除；与贮藏并列在仓库工具里
- 本地历史：编辑器保存与外部改动都会留下内容副本（按内容去重、每文件最多 50 份），源码页可列出、预览、命名并恢复任意副本
- 破坏性操作前自动贮藏本地改动（`gitjet: before <action>`），完成后 `stash pop --index` 还原，失败则保留并告知

### 冲突与历史重写
- 每个冲突在**独立窗口**中解决（标题「合并 <路径> 的修订」，与 IDEA 一致），主窗口的标签页与停靠面板保持原样；窗口内解完一个文件会自动打开下一处
- 三栏合并：左边「来自 <分支> 的更改」/ 中间结果 / 右边「来自 <分支> 的更改」；接受/忽略符号贴在**两侧与结果之间的内侧边**，左侧栏的 ✕ 和 » 在左栏右缘，右侧栏的 « 和 ✕ 在右栏左缘；页头可展开该侧提交详情
- 结果区**不显示 Git 的 `<<<<<<<` 标记**：文件按块读取，每个冲突是一个块，默认显示本地一侧；接受、忽略或直接编辑都会把该块标记为已解决，状态按块计数（与 IDEA 相同）
- 工具栏：上一处/下一处变更、比较内容、折叠未修改行、解决简单冲突、撤销/重做、忽略差异（无 / 修整空白 / 忽略空格）、高亮行数/单词
- 右键菜单：接受左侧 / 右侧、使用左侧/右侧解决、忽略、与剪贴板比较、Git 追溯、折叠、同步滚动
- 冲突汇总对话框：按「未解决」分组的文件表，文件名、`已解决/总数`、目录，左右两列表头为「您的更改 (分支)」「他人的更改 (分支)」，逐文件「接受」任意一侧；双击或「手动解决」打开合并编辑器；「解决所有简单冲突」跨文件处理；全部解决后「接受并完成」提交合并
- 仍有未解决块时 Apply 弹出确认：只有未解决的块会写回 `<<<<<<<` / `=======` / `>>>>>>>` 标记，文件保持未合并，可稍后重新打开继续；全部解决后保存的是纯结果文本并暂存该文件；支持冲突专用导航与 Accept Left / Right
- merge / rebase / cherry-pick / revert / am 的继续、跳过与中止（`am` 走 `git am --abort/--continue/--skip`）
- 编辑历史：逐条 reword / squash / fixup / drop；计划按顺序写到 `<git dir>/gitjet-rewrite-plan.json`，可从中断处继续
- Rebase 对话框：autostash、`--update-refs`、`--rebase-merges`、`--keep-empty`、`--root`、autosquash 三态、以及 Rebase 另一个分支
- Merge / Pull 的完整选项：`--ff-only`、`--no-ff`、`--squash`、`--no-commit`、`--no-verify`、`--allow-unrelated-histories`；Reset 增加 `--keep`

### 日志与历史
- 多 lane 提交图、合并线、分支/标签标记（排在提交信息之后，只占自己需要的宽度）
- 时间列到秒；今天的提交显示为「今天 09:41:26」
- 按当前分支 / 全部分支 / 指定分支过滤；提交信息搜索支持忽略/区分大小写与扩展正则；起止日期筛选；文件历史跟随重命名（`--follow`）
- 提交详情显示所在分支与标签、父提交与已加载的子提交，可跳到相邻提交；每个变更文件可「标注此版本」直接以注解打开
- 提交详情：作者、时间、完整信息、引用、文件列表与行数统计，可直接打开该版本源码
- 提交操作：检出、新建分支/标签、Cherry-Pick、Revert、Soft/Mixed/Hard Reset、复制哈希
- 多选提交（⌘/Ctrl 点击与 Shift 连选）后批量摘取 / 批量还原 / 复制哈希
- 分支右键：列出与 HEAD 之间的差异文件
- 文件历史与作者标注（Blame）

### 差异查看器
- 并排 / 统一排版，长行自动换行，上/下一块变更（连续改动的行算一块，计数也是块数），忽略空白
- 默认展示整个文件、只高亮改动；上下文行数设成 1–100 则只保留改动附近窗口，其余折叠
- 两侧语法高亮与源码视图共用一套调色板（`src/highlight.ts`）
- 在差异里直接暂存、取消暂存、回滚单个 hunk、整个文件或选中的行（Shift 连选）
- 识别二进制、超大文件、重命名与复制

### 源码阅读与跳转
- CodeMirror 6 查看工作区文件并可编辑（`⌘/Ctrl+S` 或工具栏保存，标签页显示未保存圆点）；索引与任意提交版本只读；30+ 语言语法按需加载
- 编辑器标注：左侧变更条对应 git 的 hunk，点击即可回滚该段修改（带确认）；当前行尾部显示 blame（作者、提交、摘要、时间），未提交的行单独标记
- 行号 Git 菜单：点击或右键行号显示该行的提交、作者、时间与摘要；可查看该提交在此文件中的全部差异、按行过滤历史（`git log -L`）或复制哈希。工作区、索引与任意提交的源码都是同一个视图，blame 按当前版本计算
- 行注解（Annotate）：在同一菜单里开关「使用 Git Blame 注解」，在行号左侧逐行展开提交日期与作者，并按提交着色；点击任意注解行可打开同一菜单。差异视图的两侧行号也提供同一菜单与注解列（左侧按父提交、右侧按新版本）
- 源码 ↔ 差异一键切换；工具栏上一处/下一处变更在编辑器里跳转两处改动之间；源码与差异的路径旁可复制绝对路径、仓库相对路径、文件名（可带光标行号）或终端转义路径
- `⌘/Ctrl+B`（`F12`）跳定义、`⌘/Ctrl+Shift+B`（`Shift+F12`）列引用、`⌘/Ctrl+点击` 同效，悬停看文档；检测到 `gopls`、`clangd`、`typescript-language-server`、`rust-analyzer`、`jdtls`、`pyright-langserver` 时走 LSP（含诊断波浪线），否则退回 `git grep` 全文搜索，并按语言规则区分声明与引用
- 文件视图（`⌘/Ctrl+Shift+E`）：整个工作区目录树（含未跟踪文件），按路径子序列筛选，点开即源码
- 文件视图与提交视图的文件/目录右键菜单：新建文件或目录、重命名、删除、在文件管理器中显示，以及复制绝对路径、文件名、内容根相对路径、文件引用（`@路径`）或仓库根路径
- 快速打开：`⌘/Ctrl+P` 搜文件名/路径片段；输入两个字以上时同时搜提交信息与作者
- 差异、源码、冲突、提交详情以标签页并存，图标按文件类型区分；右键标签页可关闭当前/其他/全部/未修改/左侧/右侧，并可直接新建、重命名、删除、在文件管理器中显示或复制路径；中键关闭

### 分支、远端与仓库工具
- 分支页：本地/远程分支按路径分组，展示上游跟踪与领先/落后；最近检出的分支以圆片置顶；顶部按钮一键展开或收起全部，点击分区标题可收起该本地/远程分区的所有分支
- 分支操作：检出并更新（checkout + fast-forward）、不切分支更新所选分支、强制推送后「重置到远端分支」、与当前分支比较、单个标签推送
- 标签分区：按时间倒序展示标签名、指向的提交与说明；双击查看该标签历史，右键可 Checkout（分离头指针）、从此建分支、比较、复制或删除；分区标题的「+」在当前 HEAD 新建标签
- 清理分支：已合并到当前分支的、上游已删除的本地分支，勾选后删除
- 工作树：列出、新建（可同时建分支）、锁定/解锁、在新窗口打开、移除、清理失效项；新建时按 `.worktreeinclude` 复制列出的文件/目录
- 子模块：状态、初始化与递归更新、添加、同步 `.gitmodules` 地址；Git LFS：状态、跟踪/取消跟踪模式、`lfs pull`；浅克隆补全历史
- Fetch / Pull（merge 或 rebase、autostash、prune、tags）
- Push 前确认面板：本地→远程走向、本次提交列表（可展开看文件）、全部变更文件；远程分支不存在时标为「新建分支」
- 预览里可直接改远程分支名（走 refspec，本地分支名不变），预览即时刷新并标出「新建分支」
- 支持 set-upstream、`--force-with-lease`、`--force-if-includes`、tags、dry run；远端已分叉时明确警告；记住最近推送目标
- 把任意提交（及其之前的历史）推送到远端分支，无需检出；推送被拒绝时提示「更新项目」并自动重试
- 受保护分支（名称模式）：提交前确认，强制推送直接拒绝
- 预览里的变更文件可直接点开：并排/统一差异、折行、忽略空白与改动跳转，也可切到「文件」查看该版本全文
- 工具栏同步提示：有未推送提交时 Push 显示绿色圆点，远端有新提交时 Fetch 与 Pull 显示绿色圆点；悬停标题给出待处理的提交数

### 其他
- 控制台工具有两个视图：「日志」默认展示软件执行过的操作（pull、push、提交、命令行……）及其完整命令与输出；「命令」是原来的命令行，`git` 是隐含前缀，输入 `status` 就是 `git status`；`!` 开头按原样运行其他程序（`!ls -la`）。Tab 补全子命令/选项/引用，带命令历史
- 控制台的清除只是清空当前视图（记住清除时间点，新记录继续出现），记录本身追加写入 `<配置目录>/logs/<仓库名>-<摘要>.jsonl`；工具栏的日志文件按钮直接在文件管理器里定位它
- 每个操作都会回显实际执行的命令（如 `$ git fetch --progress --all --prune --tags`），可一键复制；输出实时流式显示
- 左上四个工具窗口（提交 / 分支 / 文件 / 控制台）的顺序在「设置 → 通用」里用上下箭头调整，立即生效并记住
- 设置：界面语言、主题、字号（整窗缩放）、工具窗口顺序、Git 可执行文件路径与检测、SSH 命令、Fetch 标签策略、diff 上下文行数、空白处理、显示忽略文件、自动 fetch、更新策略、提交检查阈值、提交模板、受保护分支、危险操作确认
- 最近仓库列表，启动时恢复上次打开的仓库；同时登记到系统的「最近使用」（macOS 程序坞菜单、Windows 跳转列表、Linux 最近文件），从「文件 → 打开最近使用」、程序坞或访达打开都会回到对应仓库
- 原生文件夹选择、系统剪贴板、在文件管理器中显示；右键菜单只保留编辑、拼写、查询与开发版的检查元素，网页式的刷新、前进、下载、打印都不再出现
- 界面语言与系统一致：菜单里由 MyGo 提供的标准项（撤销、打开最近使用、退出 GitJet 等）跟随同一种语言；窗口位置与大小、深浅色外观也由系统记住

## 快速开始

目前没有预编译发行版，从源码构建即可（一条命令）：

```sh
bun install && bun run build            # 产物在 build/<os>-<arch>/
```

|依赖|说明|
|---|---|
|Go 1.27.3+|构建后端|
|Bun|包管理、构建、前端测试|
|Git 2.23+|运行时调用，需要 `git switch`；认证沿用系统 SSH agent / credential helper|
|WebView2 Runtime|仅 Windows，Win11 自带，[下载](https://developer.microsoft.com/microsoft-edge/webview2/)|

macOS 产出 `.app` / `.dmg`，Windows 产出 `GitJet.exe` 与安装程序（交叉构建安装程序需要本机有 NSIS，没有则只出 `.exe`，如 `build/windows-amd64/GitJet.exe`）。

指定平台：

```sh
bun run build -- -platform darwin/universal,windows/amd64
```

## 开发

```sh
bun run dev          # mygo dev：生成绑定 + Vite + 原生窗口（热更新）

bun run typecheck    # tsc --noEmit
bun run test:web     # 前端纯逻辑单测（bun test）
bun run generate     # 改过绑定类型后重新生成 src/mygo.ts
go test ./... && go vet ./...
```

提交前跑一遍 CI 同款门槛：

```sh
go test ./... && go vet ./... && bun run typecheck && bun run test:web && bun run build:web
```

## 快捷键

| 快捷键 | 操作 |
| --- | --- |
| `⌘/Ctrl+O` | 打开仓库 |
| `⌘/Ctrl+P` | 快速打开文件 / 提交 |
| `⌘/Ctrl+R` | 刷新 |
| `⌘/Ctrl+K` | 聚焦提交信息 |
| `⌘/Ctrl+Enter` | Commit |
| `⌘/Ctrl+Shift+K` | Push |
| `⌘/Ctrl+T` | Pull |
| `⌘/Ctrl+Shift+S` | Stash |
| ``⌘/Ctrl+Shift+` `` | 分支弹窗 |
| `⌘/Ctrl+,` | 设置 |
| `⌘/Ctrl+B` / `⌘/Ctrl+Shift+B` | 跳到定义 / 列出引用（源码视图） |
| `⌘/Ctrl+S` | 保存当前源码 / 应用冲突结果 |
| `⌘/Ctrl+F` | 当前源码的查找与替换（浮动在右上角，`Aa`/`ab`/`.*` 切换大小写、全词、正则） |
| `F7` / `Shift+F7` | 下一处 / 上一处变更（冲突视图） |
| `Alt+←` / `Alt+→` | 采用本地 / 远程版本（冲突视图） |
| `⌘⌃←` / `⌘⌃→`（macOS）、`Ctrl+Alt+←` / `Ctrl+Alt+→` | 接受右侧 / 接受左侧（冲突视图） |
| `⌘/Ctrl+点击` / `⌘/Ctrl+Alt+点击` | 跳到定义 / 列出引用 |
| `⌘/Ctrl+9` / `⌘/Ctrl+Shift+9` / `⌘/Ctrl+Shift+E` | 提交 / 控制台 / 文件 工具窗口 |
| 任意字符（文件窗口、焦点不在编辑器时） | 匹配并高亮文件名，`↑`/`↓` 切换，`Enter` 打开，`Esc` 清除 |

## 目录结构

```
main.go                 入口 → internal/app.Run
internal/app/           窗口、菜单、事件、绑定服务、设置、仓库元数据、LSP 桥
internal/git/           git 执行与解析：状态、差异、日志、动作、blame、控制台、
                        历史重写（rewrite.go）、工作树/子模块/LFS（repo_extra.go）
internal/lsp/           按仓库标记探测语言服务器
src/                    React 前端
  App.tsx               应用状态、命令分发、工具窗口与编辑器标签页
  CommitPanel.tsx       变更列表、变更集与提交
  DiffView.tsx          并排/统一差异、行号 blame 菜单与注解列
  ConflictView.tsx      三栏冲突解决：块级应用、自动解决、同步滚动
  mergePane.ts          冲突面板的 CodeMirror：块/词装饰、应用箭头、滚动映射
  SourceView.tsx        可编辑源码外壳：保存、工具栏、二进制/缺失文件状态
  SourceEditor.tsx      CodeMirror 挂载、变更条、blame、跳转接线
  SourceTree.tsx        文件视图：工作区目录树、子序列筛选、键入即匹配高亮
  editor.ts             CodeMirror 配置：主题、按需语法、装饰
  lsp.ts                LSP 客户端（IPC 传输，无 socket/worker）
  syntax.ts / highlight.ts  Lezer 语法树 → 逐行 token；编辑器与差异共用的调色板
  LogDock.tsx           提交图与提交详情
  BranchList.tsx / RepoExtrasDialog.tsx / EditHistoryDialog.tsx / SymbolPanel.tsx / QuickOpen.tsx
  *.ts 纯逻辑模块         diff / graph / merge / branches / changes / annotate / symbols /
                        paths / explorer / tabs（各带测试）
  mygo.ts               由 Go 服务生成的类型安全客户端（勿手改）
```

## 已知限制

- 不内置 Git：认证走系统 SSH agent 或 credential helper；Git 版本过低会直接提示。
- 语言服务器不随应用打包，只从 `PATH` 找；没有服务器时跳转退化为文本匹配。
- 编辑历史的计划按时间顺序执行，列表内不能拖动重排，也暂不支持 `edit`（停下来改内容）。
- 日志的差异预览在标签页里打开，不在停靠面板内嵌；三版本对照以三种两两比较呈现（HEAD↔索引、索引↔工作区、HEAD↔工作区），没有同屏三栏。
- 无自动更新；构建产物未签名（macOS 为 ad-hoc 签名）。
