# ScoopDeck — agent notes

Windows-only Scoop package manager UI. TSX (nsh) for the interface, Rust for everything that touches Scoop.
No git repo, no CI.

## Commands

- `nsh check` — TS typecheck + `cargo check`; also regenerates `.nsh/` (types + host crates). Run after changing exported Rust types/functions.
- `nsh test` — Rust unit tests + headless `ui/App.test.tsx` (15–20 s). Network/cache tests are `#[ignore]`.
- Ignored tests (touch real Scoop cache / desktop / network):
  `cargo test --manifest-path .nsh\rust\Cargo.toml -p scoop-deck -- --ignored`
- `nsh run` — dev host: TSX hot-reloads, Rust edits rebuild and restart the host.
- `nsh add nsh-omarchy` — installs/locks the component nshm (`nsh.json` `dependencies`, `nsh.lock`, Cargo dependency); `nsh upgrade` refreshes it.
- After upgrading nsh itself, delete `.nsh/` before the next build: generated crate names change between 0.6 and 0.7 and old leftovers fail with `nsh-app-…-hack`.
- `cargo fmt` before finishing Rust edits; `nsh check` does not format.
- `nsh package --target windows` — output under `.nsh\out`.
- Branches: develop on `dev`; releases merge into `main`, and version tags (`v*`) are only created on `main`. `.github/workflows/release.yml` checks the tag is on `main` and that `nsh.json`'s version matches the tag.
- Release artifacts: `ScoopDeck.zip` plus a generated `scoop-deck.json` Scoop manifest (with the archive hash) attached to the GitHub Release. CI runs `nsh check` and `nsh test` on Windows.
- CI cost: it runs on pull requests, pushes to `main`, manual dispatch, and one nightly scheduled run on `dev` — not on every `dev` push. Docs-only changes are ignored via `paths-ignore`; release packaging still builds the full app.

## Layout

- `App.tsx` — the nsh entry, one line: `import "./ui/App";`.
- `ui/App.tsx` — shell, tabs, window and startup effects.
- `ui/deck.ts` — shared signals, loaders, detail/bucket actions, context.
- `ui/queue.ts` — download/install queue, progress, cancel, retry.
- `ui/filters.ts` / `ui/search.ts` — installed filters and catalog search.
- `ui/InstalledTab.tsx`, `ui/SearchTab.tsx`, `ui/BucketsTab.tsx` — the three package lists.
- `ui/SettingsTab.tsx` — settings page (config read/write, cache, import/export); owns its own state.
- `ui/DetailSheet.tsx`, `ui/QueueDock.tsx`, `ui/JobSlot.tsx`, `ui/ErrorBanner.tsx` — detail/queue/notice UI.
- `ui/omarchy.ts` — the only place that re-exports the components of the installed `nsh-omarchy` nshm. Import UI controls from `./omarchy` so the surface stays in one file.
- `ui/theme.ts` — theme preference (`system` / `light` / `dark`), persisted in nsh `Storage` under `theme.preference`; applies it with `setColorScheme`.
- `ui/i18n.ts` — language preference (`system` / `zh-CN` / `en`), persisted in `Storage` under `language.preference`; applies it with `setLocale`.
- `locales/app.yml` — Simplified Chinese and English copy, read by nsh's `t()`.
- `ui/types.ts` — shared types, constants, update/cancel predicates.
- `ui/ui.tsx` — shared class strings and helpers (`Busy`, `formatBytes`, `stageLabel`).
- `theme.json` — the Flexoki Light / Tokyo Night tokens copied from nsh-omarchy; `nsh.json` names it.
- `nsh.json` `dependencies` / `nsh.lock` — the `nsh-omarchy` nshm installed with `nsh add nsh-omarchy`; its crate lives in `~/.nsh/nshms`.
- `src/lib.rs` — `#[native_module("scoop-deck/native")]`, public `Scoop` API, manifest reading, tests.
- `src/download.rs`, `src/process.rs`, `src/settings.rs` — `pub(crate)` inherent methods on `Scoop`; `impl` is split across files on purpose.
- The app root is the repository root: `nsh.json`, `tsconfig.json`, `.nsh/`, `target/` and the one-line entry `App.tsx` stay there. All TS/TSX source lives in `ui/`.
- Start dev with `nsh run` from the repository root. If the host reports `no module scoop-deck/native`, restart it; if that persists, delete `.nsh` and let nsh regenerate it.
- `.nsh/` is generated and gitignored: never edit; delete it to force full regeneration.

## Things that bite

- The TSX import specifier is `scoop-deck/native`, tied to `#[native_module("scoop-deck/native")]` and the Cargo package name. Renaming requires all three.
- nsh reactivity: `const x = derived()` in a component body is evaluated once. Use `computed(...)`, or read the signal inside JSX props/children.
- `nsh/base` controls have **no built-in look** (`Switch`, `Select`, `Checkbox`, `Toast`, `Tooltip`): without explicit classes they render invisible/zero-size. Canonical snippets: <https://nsh.dev/elements>.
- `Select` needs both a `trigger` element and `popupClass`/`itemClass`; `Switch` needs `trackClass` + `thumbClass` with `checked:translate-x-*`.
- `numberOfLines` goes in `style={{ numberOfLines: 1 }}`, not as a prop.
- Headless tests must not depend on specific installed packages; they only exercise tabs/search shell.

## Omarchy 组件库

- 控件优先用 `./omarchy` 里的 Omarchy 组件：`Button`、`Input`/`TextField`、`Select`、`Switch`、`Panel`、`Sheet`、`Tabs`、`Badge`、`Progress`、`Popover`、`Toaster`、`toast()`、`confirm()`、`EmptyState` 等。
- 组件由 nsh 0.7 的 nshm 提供：`nsh add nsh-omarchy` 安装并写入 `nsh.json` `dependencies` 与 `nsh.lock`；TSX 从 `"nsh-omarchy"` 导入，运行时自动注册，不需要在 `src/lib.rs` 里手动注册，也不要恢复 vendor 源码。
- `Toaster` 挂在应用 shell 里；页面里用 `toast()` 提示，不再维护 NoticeStack。确认框统一用 `confirm()`，不要再调 `AlertDialog.show`。
- 已安装、搜索、Bucket 三个列表仍用 `nsh/base` 的 `Table`：Omarchy 的表格单元格只接受文本，无法承载行内按钮和版本箭头。其余容器、按钮、输入、弹层都用 Omarchy。
- 主题来自 `nsh.json` 的 `"theme": "theme.json"`（复制自 nsh-omarchy）：`light` 是 Flexoki Light，`dark` 是 Tokyo Night。设置页通过 `ui/theme.ts` 的 `setThemePreference` 调 `setColorScheme("system" | "light" | "dark")`，选择存在 nsh `Storage` 的 `theme.preference`。
- 不要在 Windows 上调 `Omarchy.followSystem()`：它只读 Linux 的 Omarchy 主题文件，读不到就固定应用 Tokyo Night，结果就是只有深色。
- 不要硬编码圆角/背景色，沿用 `bg-background`、`border-border`、`text-muted-foreground` 等 token；深浅两套外观都要检查。
- 队列面板位于窗口底部，默认收起；有任务时用底部 `队列（n）` 行展开，`Panel` 内用 `Scroll` 限高，避免挤占列表。

## Scoop integration (do not break)

- Install/update = our downloader writes into Scoop's cache, then `scoop install|update` runs (it verifies hash, extracts, links, builds shims).
- Cache filename must match Scoop's `cache_path` exactly: `<app>#<version>#<sha256(raw url, fragment included)[0..7]><ext>`, ext = .NET `Path.GetExtension`. Write `<name>.download` first, then rename.
- If prefetch fails for any reason, fall back to letting Scoop download; never fail the install because of it.
- Settings bypass `scoop config`: read/write `%USERPROFILE%\.config\scoop\config.json` directly (atomic replace, keep unknown keys). Only `FLAG_KEYS` / `TEXT_KEYS` in `src/lib.rs` are writable; `use_sqlite_cache` is excluded on purpose (needs Scoop's side effects).
- Install phase must stay serial (one `scoop` child at a time); downloads may run in parallel (`MAX_DOWNLOADS = 3`). `CURRENT_CHILD` / `CURRENT_JOB` plus per-app cancel flags enforce this.
- Installed manifests exist under both names — `scoop-manifest.json`/`scoop-install.json` (new) and `manifest.json`/`install.json` (old). Always try both; `ScoopManifest`/`ScoopInstall` fields are `#[serde(default)]` so a missing `version`/`bucket` does not drop the app.
- On cancel/failure, `cleanup_partial` deletes version dirs without `scoop-manifest.json` and that app's `.download` files — never the `current` target.
- `Scoop.cancel` may only kill the `scoop` child while its stage is `preparing`/`downloading`/`waiting`. In `verifying`/`extracting`/`finalizing` it must return false: Scoop may have already removed the old version or be writing the new one, so killing it leaves a half-installed app. The row hides 取消 for those stages; uninstall has no cancel.
- The catalog scan is cached at `%LOCALAPPDATA%\ScoopDeck\catalog.json`, keyed by each bucket's git HEAD; delete it to force a rescan.
- `ui/App.test.tsx` waits for the catalog count before typing — input events sent while the list is still loading are dropped.
- Scoop source of truth on a dev machine: `%USERPROFILE%\scoop\apps\scoop\current\lib\*.ps1` (read it before re-deriving behavior).

## Conventions

- UI copy goes through `t("key")` from `ui/i18n.ts`, with keys in `locales/app.yml` for both `zh-CN` and `en`; comments stay in Simplified Chinese, identifiers in English. Dynamic text uses `%{name}` placeholders, not string concatenation.
- The app's language follows Windows by default; Settings stores an explicit `zh-CN` / `en` choice. New UI text must be added to both languages in the same commit.
- nsh-omarchy's built-in update prompt (if enabled later) is English-only; the app's own text is not.
- Keep files split by screen/concern; no extra abstractions beyond nsh + local signals.

## 响应式设计与跨平台适配

- 设计原则：根据产品类型和目标用户选择移动端优先或桌面端优先，不要机械套用单一策略。无论从哪个端开始设计，都必须考虑其他目标平台的使用体验。
- 布局适配：不要简单缩小桌面端界面。应根据屏幕空间重新组织布局，例如多栏变单栏、表格变卡片、侧边栏变抽屉、横向排列变纵向排列。
- 信息层级：根据设备空间和使用场景调整信息优先级，优先展示核心信息和操作。次要信息可以折叠、延迟展示或放入详情页，但不能随意丢失重要功能。
- 交互适配：充分考虑触控、鼠标、键盘等不同输入方式。不要依赖 Hover 等特定交互，确保操作入口清晰、触控区域合理，并符合目标平台的交互习惯。
- 代码组织：按业务模块组织代码，而不是简单按照 PC 和移动端拆分两套项目。业务逻辑、数据模型、状态管理和数据请求应尽可能复用；布局和交互差异较大时，允许拆分独立的展示组件。
- 设计一致性：统一管理颜色、字体、间距、圆角、断点等设计规范，优先使用设计变量和可复用组件，避免重复定义和随意硬编码。
- 平台适配：根据 Web、移动应用、桌面应用等平台的技术特点，优先使用对应平台的原生适配能力，同时尊重各平台的设计规范，不要为了代码复用而牺牲原生体验。
- 测试验证：开发完成后，检查不同屏幕尺寸、窗口大小和交互方式下的布局、内容完整性及功能可用性，避免内容溢出、布局错乱、操作困难等问题。

核心原则：共享业务逻辑，适配展示方式，尊重平台特性，保证使用体验。
