# ScoopDeck

Windows 上的 Scoop 图形界面。界面用 TSX（[nsh](https://nsh.dev)）编写，读写 Scoop 目录、清单、缓存和配置的工作交给 Rust；真正的安装、更新与卸载仍由 `scoop` 执行。

ScoopDeck 不另建一套包数据库，而是把本机的 Scoop 环境整理成可搜索、可筛选、可排队的桌面界面。关闭窗口后应用留在托盘继续下载，退出请用托盘菜单。

> 仅支持 Windows 10 1809+ 和 Windows 11。

## 功能

### 已安装

- 列出包名、已安装版本、最新版本、来源 bucket 和描述。
- 按关键词、更新状态（全部 / 有更新 / 已最新）和来源 bucket 筛选。
- 单个更新或卸载；「全部更新」跟随当前筛选结果。
- 详情面板显示主页、许可证、依赖、建议、下载地址、备注、安装路径、占用空间和清单路径，可复制包名。
- 从窗口外通过 `scoop` 安装或卸载后，切回窗口会自动刷新列表。

### 搜索与安装

- 聚合本机所有 bucket 的清单，按包名和描述搜索。
- 排序优先级：名称完全匹配 → 名称前缀 → 名称包含 → 描述包含；同级短名称优先。结果最多显示 100 条。
- 安装前用清单里的下载地址做一次 `HEAD` 请求估算大小；拿不到 `Content-Length` 时显示「下载大小未知」。
- 已安装的包在搜索结果里标记为「✓ 已安装」。

### 下载与安装队列

- 下载最多 3 个并行，安装和卸载严格一次一个。
- 进度阶段包括准备、下载、校验、解压和收尾；能拿到百分比时显示百分比，否则显示阶段文字。
- 排队中、待安装和下载中的任务可以取消；校验、解压、收尾阶段不提供取消，避免留下装了一半的应用。卸载不可取消。
- 失败的任务保留在队列里，可以重试或忽略；一批任务结束后汇总成功和失败数量。
- 队列面板停在窗口底部，默认收起；有任务时点「队列（n）」展开，窄窗口下也能随时收起腾出列表空间。
- 托盘图标提示当前活动和队列数量，「退出 ScoopDeck」才会真正结束进程。
- 单实例运行，第二次启动会唤起已有窗口；窗口大小和位置会记住。

### Buckets

- 查看已添加的 bucket、清单数量和 git 来源地址。
- 从 Scoop 自带的已知 bucket 列表一键添加，也可以输入名称和仓库地址添加自定义 bucket。
- 修改 bucket 的 origin 地址，或删除 bucket。删除只移除本机清单，不会卸载已安装的包。

### 设置与维护

- 直接读写 `%USERPROFILE%\.config\scoop\config.json`，支持常用开关、代理、默认架构、shim、Scoop 仓库/分支、GitHub token 等白名单键。
- ScoopDeck 自己的 GitHub 下载代理（例如 `https://ghproxy.net/`）只作用于 GitHub 的清单和预下载，不写进 Scoop 配置。
- 一键运行 `scoop update` 更新 Scoop 自身和所有 bucket。
- 外观可跟随 Windows、固定浅色（Flexoki Light）或固定深色（Tokyo Night），立即生效并记住选择。
- 导出 `scoop export` 生成的 Scoopfile，或从 Scoopfile 导入 bucket 和缺失的应用。
- 查看下载缓存占用、清理下载缓存、清理所有应用的旧版本目录。
- 窗口宽度小于 900 时，表格自动改为卡片，设置项改为上下排布。

## 技术栈

| 层 | 使用 |
| --- | --- |
| 界面 | TSX、[nsh](https://nsh.dev)、[nsh-omarchy](https://huacnlee.github.io/nsh-omarchy/) 组件、Tailwind 风格 class |
| 原生后端 | Rust 2024、`nsh-core` 0.7、`#[native_module("scoop-deck/native")]` |
| 数据与校验 | `serde`、`serde_json`、`sha2` |
| 网络 | `ureq`，支持断点续传与 GitHub 代理 |
| 外部程序 | `scoop`（PowerShell）、`git`、PowerShell + WinForms 文件对话框 |

TSX 通过 `scoop-deck/native` 调用 Rust 导出的 `Scoop` 模块；没有 Node.js 或 npm 依赖，构建、类型检查和打包都由 `nsh` 完成。

界面组件来自 [nsh-omarchy](https://huacnlee.github.io/nsh-omarchy/)。项目用 nsh 0.7 的 nshm 机制安装它：`nsh add nsh-omarchy` 会把依赖写进 `nsh.json` 的 `dependencies` 和 `nsh.lock`，TSX 直接 `import { Button } from "nsh-omarchy"`，由 nsh 在构建时注册组件，不再需要 vendor 源码或手动 `register_components`。`ui/omarchy.ts` 只是统一的转出口。主题文件 `theme.json` 复制自 nsh-omarchy：浅色是 Flexoki Light，深色是 Tokyo Night，设置页只切换 appearance。三个数据表仍使用 `nsh/base` 的 `Table`，因为 Omarchy 的单元格只支持文本，放不下行内操作按钮和版本箭头。

## 环境要求

- Windows 10 1809+ 或 Windows 11。
- [Scoop](https://scoop.sh) 已安装并可用。`scoop` 不在 `PATH` 时，ScoopDeck 也会尝试默认安装目录。
- Rust 工具链（[rustup](https://rustup.rs)）。项目使用 edition 2024，需要 Rust 1.85 或更新；Windows 上还需要 Visual Studio Build Tools 的「使用 C++ 的桌面开发」工作负载。
- [nsh CLI](https://nsh.dev/docs/installation) 0.7 或更新。

## 快速开始

### 1. 安装 Scoop

已安装可跳过。以普通用户打开 PowerShell：

```powershell
Set-ExecutionPolicy RemoteSigned -Scope CurrentUser
irm get.scoop.sh | iex
```

### 2. 安装 Rust

按 [rustup.rs](https://rustup.rs) 的说明安装。Windows 上选择 MSVC 工具链，并在 Visual Studio Build Tools 中勾选「使用 C++ 的桌面开发」和 Windows SDK。

### 3. 安装 nsh

```powershell
irm https://nsh.dev/install.ps1 | iex
```

安装脚本会把 `nsh` 放到 `%LOCALAPPDATA%\nsh` 并加入用户 `PATH`，之后需要新开一个终端。已经安装 Scoop 的话也可以：

```powershell
scoop install https://github.com/longbridge/nsh/releases/latest/download/nsh.json
```

### 4. 运行

在项目目录执行：

```powershell
nsh run
```

第一次编译需要一些时间。启动后如果提示「未检测到 Scoop」，先按引导安装 Scoop，再点「重新检测」；仍然失败时重启一次 ScoopDeck。

## 开发

| 命令 | 作用 |
| --- | --- |
| `nsh run` | 启动开发宿主。TSX 热更新；修改 Rust 后会重新编译并重启宿主。 |
| `nsh add nsh-omarchy` | 安装/刷新组件库 nshm，写入 `nsh.json` `dependencies`、`nsh.lock` 和 Cargo 依赖。 |
| `nsh upgrade` | 按 `nsh.json` 的要求升级已安装的 nshm。 |
| `nsh check` | TypeScript 类型检查 + `cargo check`，同时重新生成 `.nsh/` 里的类型和宿主 crate。修改导出的 Rust 类型或函数后必须运行。 |
| `nsh test` | Rust 单元测试 + `ui/App.test.tsx` 的无头测试，通常需要 15–20 秒。 |
| `nsh package --target windows` | 打包 Windows 应用，输出在 `.nsh\out`。 |
| `cargo fmt` | 格式化 Rust 代码。`nsh check` 不会自动格式化。 |

涉及真实 Scoop 缓存、桌面或网络的测试默认标记为 `#[ignore]`：

```powershell
cargo test --manifest-path .nsh\rust\Cargo.toml -p scoop-deck -- --ignored
```

项目目前没有 CI，完成修改前请在本地运行 `nsh check`、`nsh test` 和 `cargo fmt`。更细的开发约定和容易踩的坑见 [AGENTS.md](AGENTS.md)。

## 工作原理

- **已安装列表**：读取 `<Scoop 根目录>\apps\<包名>\current` 下的清单，同时兼容新命名 `scoop-manifest.json` / `scoop-install.json` 和旧命名 `manifest.json` / `install.json`。最新版本从 bucket 清单读取；URL 清单安装的包会优先请求远端清单，网络失败时退回本机清单。
- **可安装清单**：扫描 `<Scoop 根目录>\buckets\<bucket>\bucket\*.json`，按每个 bucket 的 git HEAD（非 git bucket 用目录修改时间）生成签名，缓存到 `%LOCALAPPDATA%\ScoopDeck\catalog.json`。bucket 没有变化时直接复用缓存。
- **预下载**：先从清单里选出当前架构的下载地址，按 Scoop 的规则拼出缓存文件名 `<包名>#<版本>#<原始 URL（含 fragment）的 SHA-256 前 7 位><扩展名>`；先写 `<文件名>.download`，清单提供哈希时先校验，再改名，最后交给 `scoop install` 或 `scoop update`。预下载失败不会让安装失败，Scoop 会自己重新下载。
- **进度**：Scoop 在输出被重定向时仍会打印 `Downloading <url> (<size>)`，ScoopDeck 从这里取总大小，再观察缓存文件的增长计算百分比；同时根据输出识别校验、解压和收尾阶段。
- **取消**：只有 `preparing`、`downloading`、`waiting` 阶段会终止 `scoop` 子进程。`verifying`、`extracting`、`finalizing` 阶段不允许取消，因为此时 Scoop 可能已经删掉旧版本或正在写新版本。
- **配置**：设置页直接读写 Scoop 的 `config.json`，采用临时文件 + 替换的原子写入，保留未知键。只允许修改 `FLAG_KEYS` / `TEXT_KEYS` 白名单里的键；`use_sqlite_cache` 特意排除在外，因为它需要 Scoop 自己的副作用。
- **导入导出**：导出调用 `scoop export` 并把结果写成 Scoopfile，导入调用 `scoop import`；导入期间不再接受其它耗时操作。

## 数据文件

| 路径 | 内容 |
| --- | --- |
| `%USERPROFILE%\.config\scoop\config.json` | Scoop 配置。设置页直接改写它，写入前保留已有未知键。 |
| `%LOCALAPPDATA%\ScoopDeck\settings.json` | ScoopDeck 自己的设置，目前保存 GitHub 下载代理。 |
| `%LOCALAPPDATA%\ScoopDeck\catalog.json` | 可安装清单缓存。删除它可强制重新扫描所有 bucket。 |
| `%APPDATA%\io.github.jqiue.scoopdeck\storage.json` | 界面本地状态：窗口位置和大小、外观选择。 |
| `<Scoop 根目录>\cache\` | Scoop 下载缓存，默认是 `%USERPROFILE%\scoop\cache`。设置页可以清理。 |
| `.nsh\` | nsh 生成的类型声明和宿主 crate，已被 gitignore。不要手工修改；出问题时可整个删除让 nsh 重新生成。 |
| `~\.nsh\nshms\` | `nsh add` 安装的 nshm 源码和编译缓存；`nsh.lock` 记录项目使用的版本。 |

## 项目结构

```text
.
├─ App.tsx                 # nsh 入口，只导入 ui/App
├─ nsh.json                # 应用名、id、图标、主题、nshm 依赖
├─ nsh.lock                # nsh add 锁定的 nshm 版本
├─ theme.json              # Flexoki Light / Tokyo Night 两套 token
├─ Cargo.toml              # Rust crate（scoop-deck）
├─ assets/                 # 应用图标和托盘图标
├─ ui/
│  ├─ App.tsx              # 窗口、标签页、托盘、启动检查
│  ├─ deck.ts              # 共享信号、加载器、详情与 bucket 操作
│  ├─ queue.ts             # 下载/安装队列、取消、重试
│  ├─ filters.ts           # 已安装列表筛选
│  ├─ search.ts            # 清单搜索与排序
│  ├─ omarchy.ts           # 统一的 nsh-omarchy 组件转出口
│  ├─ theme.ts             # 外观选择（跟随系统/浅色/深色）与持久化
│  ├─ InstalledTab.tsx     # 已安装页
│  ├─ SearchTab.tsx        # 搜索页
│  ├─ BucketsTab.tsx       # bucket 管理页
│  ├─ SettingsTab.tsx      # 设置页
│  ├─ DetailSheet.tsx      # 包详情侧栏
│  ├─ JobSlot.tsx          # 列表行内的任务状态与操作
│  ├─ QueueDock.tsx        # 窗口底部可收起的队列面板
│  ├─ ScoopSetup.tsx       # 未检测到 Scoop 时的引导页
│  ├─ ErrorBanner.tsx      # 顶部错误横幅
│  ├─ ui.tsx               # 共用样式、格式化与窄窗口判断
│  ├─ types.ts             # 共用类型和取消规则
│  └─ App.test.tsx         # 无头界面测试
├─ src/
│  ├─ lib.rs               # Scoop API、清单读取、catalog 缓存、测试
│  ├─ download.rs          # 预下载、缓存命名、哈希校验、GitHub 代理
│  ├─ process.rs           # scoop 子进程、进度解析、取消与清理
│  └─ settings.rs          # config.json 读写、缓存统计、导入导出
└─ AGENTS.md               # 开发约定和 Scoop 集成注意事项
```

## 故障排查

- **提示未检测到 Scoop**：在 PowerShell 里运行 `scoop --version`，确认 Scoop 已安装且 `scoop.cmd` 在 `PATH` 或默认安装目录中。装好后点「重新检测」，仍不行就重启应用。
- **`no module scoop-deck/native`**：nsh 宿主没有加载到 Rust 模块。先重启 `nsh run`；如果仍然出现，删除 `.nsh` 目录后重新运行，让 nsh 重新生成。
- **升级 nsh 后报找不到 `nsh-app-…-hack`**：旧 `.nsh` 是上一版 nsh 生成的，包名已经变了。删除 `.nsh` 后重新 `nsh build` / `nsh run`。
- **`no module nsh-omarchy`**：组件库没有安装或没有锁定版本。运行 `nsh add nsh-omarchy`，确认 `nsh.json` 的 `dependencies` 和 `nsh.lock` 都存在，然后重启宿主。
- **搜索页没有可安装包**：本机还没有添加 bucket，或清单缓存过期。去 Bucket 页添加来源，或在设置页运行「更新 Scoop 和 bucket」；也可以删除 `%LOCALAPPDATA%\ScoopDeck\catalog.json` 后重启。
- **下载失败或一直等待数据**：检查网络和代理。访问 GitHub 较慢时可以设置「GitHub 下载代理」；预下载失败时 Scoop 会自动改用自带的下载方式。错误详情会显示在顶部横幅里。
- **点击关闭后进程还在**：这是预期行为，窗口收进了托盘。从托盘菜单选择「退出 ScoopDeck」即可结束进程。
- **任务没有取消按钮**：安装已经进入校验、解压或收尾阶段，此时终止会留下半个应用。等它执行完再操作。
- **设置改了但没生效**：设置页每次打开都会重新读取配置文件；如果是在外部改的文件，重新进入设置页即可。`scoop config` 和设置页写的是同一个文件，不要同时改。

## 限制与说明

- 仅支持 Windows；界面文案目前只有简体中文。
- 搜索范围仅限本机已添加的 bucket，不提供远程包索引。
- 同一时间只有一个安装或卸载任务；下载最多 3 个并行。
- ScoopDeck 自身没有自动更新功能；升级需要重新构建或替换可执行文件。

## 参与开发

- UI 文案和注释使用简体中文，标识符使用英文。
- 按页面/职责拆分文件，不引入超出 nsh + 本地信号之外的抽象。
- 修改 Scoop 集成逻辑时，不要破坏这些约束：缓存文件名必须匹配 Scoop 的 `cache_path`、预下载失败必须回退、安装阶段必须串行、取消只能发生在安全阶段。
- 更多细节见 [AGENTS.md](AGENTS.md)。

## 许可

[MIT](LICENSE) © 2026 JQiue
