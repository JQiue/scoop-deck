# ScoopDeck — agent notes

Windows-only Scoop package manager UI. TSX (nsh) for the UI, Rust for anything touching Scoop.

## Commands

- `nsh run` — dev host; TSX hot-reloads, Rust edits rebuild and restart the host. Run from the repo root.
- `nsh check` — TS typecheck + `cargo check`; regenerates `.nsh/` types and host crates. Run after changing exported Rust types/functions.
- `nsh test` — Rust unit tests + headless `ui/App.test.tsx`. UI tests mock `scoop-deck/native`, so no local Scoop install or bucket is needed.
- Ignored tests (real Scoop cache / desktop / network):
  `cargo test --manifest-path .nsh\rust\Cargo.toml -p scoop-deck -- --ignored`
- `nsh add nsh-omarchy` — installs/locks the component nshm (`nsh.json` `dependencies`, `nsh.lock`). Commit both changes.
- `nsh package --target windows` — writes `.nsh\out\ScoopDeck.zip` (and a directory). An Inno Setup installer is added only when Inno Setup is installed; a local installer failure does not invalidate the zip.
- `cargo fmt` before finishing Rust edits; `nsh check` does not format.
- `python scripts/mock-scoop.py` — in-memory URL-manifest mock server for download testing: serves `/<app>.json` and generated zips at a fixed `RATE_KIB`/`DEFAULT_SIZE`. No subcommands, no state files; apps start at 0.1.0.

## Branch / CI / release

- Develop on `dev`; release on `main`. Version tags (`v*`) must point to a commit on `main`; the release workflow rejects tags elsewhere.
- CI runs on PRs, pushes to `main`, manual dispatch, and one nightly run on `dev` — not on every `dev` push. README/LICENSE/`docs/` changes are skipped.
- CI uses `nsh check` + `nsh test`; release packaging runs the full build.
- CI pins nsh `0.7.1` in `.github/workflows/ci.yml`; bump it together with `nsh-core`/`nsh-omarchy`.
- Release workflow checks `nsh.json` version == tag, packages, generates `scoop-deck.json` with the zip hash, and uploads zip + manifest. Do not commit a static manifest hash.
- Release artifacts are the portable `ScoopDeck.zip` and generated `scoop-deck.json`; no installer is currently guaranteed.
- Default GitHub branch is `dev`; `main` is the release branch.

## Architecture

- `App.tsx` is a one-line entry: `import "./ui/App";`. All TS/TSX source lives in `ui/`.
- `ui/App.tsx` — shell, tabs, window/tray, startup checks.
- `ui/deck.ts` — shared signals, loaders, detail/bucket actions, context.
- `ui/queue.ts` — download/install queue, progress, cancel, retry.
- `ui/filters.ts` / `ui/search.ts` — installed filters and catalog search.
- `ui/InstalledTab.tsx`, `SearchTab.tsx`, `BucketsTab.tsx`, `SettingsTab.tsx`, `DetailSheet.tsx`, `QueueIndicator.tsx`, `JobSlot.tsx`, `ErrorBanner.tsx`, `ScoopSetup.tsx` — screens/widgets.
- `ui/omarchy.ts` — central re-export of `nsh-omarchy`; import controls from here.
- `ui/confirm.tsx` — themed `confirm()` and its `ConfirmHost` (Omarchy `Dialog`); mounted once in `ui/App.tsx`.
- `ui/theme.ts` / `ui/i18n.ts` — theme and language preferences in nsh `Storage`.
- `src/lib.rs` — `#[native_module("scoop-deck/native")]`, `Scoop` API, manifests, tests. `download.rs`, `process.rs`, `settings.rs` split `impl Scoop` on purpose.
- App root is the repo root (`nsh.json`, `tsconfig.json`, `.nsh/`, `target/`); all TS/TSX stays under `ui/`.
- `.nsh/` is generated and gitignored: never edit. After a major nsh upgrade delete it; stale generated crates fail with `nsh-app-…-hack`.

## nsh / Omarchy rules

- nsh 0.7 nshm: install `nsh-omarchy` with `nsh add`. Do not vendor it or add a `register_components` bridge; components are registered by their own `nsh-omarchy` native module.
- Import Omarchy controls through `./omarchy`, which re-exports from `"nsh-omarchy"`.
- Use `toast()` for transient feedback and `confirm()` from `ui/confirm.tsx` for confirmations. `nsh-omarchy` also exports `confirm`/`AlertDialog`, but those draw the platform alert (a WinUI3-style card on Windows) and ignore `theme.json` — do not use them for app dialogs.
- Keep `theme.json` (copied from nsh-omarchy) as `nsh.json` `"theme"`. Switch with `setColorScheme("system" | "light" | "dark")`.
- Do not call `Omarchy.followSystem()` on Windows: it reads a Linux Omarchy theme path, falls back to Tokyo Night, and locks the app to dark.
- The installed/search/bucket lists use `nsh/base` `Table` because Omarchy table cells are text-only and cannot hold row actions/version arrows. Other UI uses Omarchy.
- Use theme tokens (`bg-background`, `border-border`, `text-muted-foreground`, `rounded-(--radius)`); never hardcode colors. Check light and dark.
- nsh reactivity: values read in a component body are evaluated once. Use `computed(...)` or read signals inside JSX props/children.
- `numberOfLines` belongs in `style={{ numberOfLines: 1 }}`, not as a prop.

## i18n

- All user-facing copy goes through `t("key")` from `ui/i18n.ts`; keys live in `locales/app.yml` with both `en` and `zh-CN`.
- Comments stay in Simplified Chinese; identifiers in English. Use `%{name}` placeholders rather than concatenation.
- Language preference (`system` / `zh-CN` / `en`) is stored under `language.preference`; theme under `theme.preference`.
- Add new UI text to both languages in the same commit. nsh `t()` has no plural support; use neutral wording or separate keys.
- Rust-produced errors (Scoop output, `已取消`) remain raw; UI copy is bilingual, but backend error text is not fully localized.

## Testing and responsive checks

- UI tests live in `ui/App.test.tsx` and `open("../App.tsx")`; opening `./App.tsx` makes nsh treat `ui/` as the app root and miss root `locales/`.
- They stub `scoop-deck/native` (`Scoop.available`, `Scoop.catalog`, etc.) and assert the catalog count; update the fixture and assertions together.
- Wait for the catalog to load before typing in the search test; input sent during loading is dropped.
- Layout: tables switch to cards and setting rows stack below `900` points (`COMPACT_WIDTH` in `ui/ui.tsx`). Verify both layouts after UI changes.
- `nsh test` builds a headless runner first; the tests themselves are fast. `nsh check` does not format.

## Scoop integration invariants

- Install/update: our downloader populates Scoop's cache, then `scoop install|update` verifies/extracts/links. Cache name must match `<app>#<version>#<sha256(raw url incl. fragment)[0..7]><ext>` exactly; write `<name>.download` then rename.
- URL-manifest installs skip prefetch: the Search tab's dialog calls `Scoop.installUrl(url, name)` (`scoop install <url>`); `name` is the manifest file's stem, and the queue keeps `job.url` so retries stay URL installs. Progress is parsed from Scoop's output.
- If prefetch fails, always let Scoop download; never fail the install because prefetch failed.
- Settings read/write `%USERPROFILE%\.config\scoop\config.json` directly (atomic, preserve unknown keys); only `FLAG_KEYS`/`TEXT_KEYS` in `src/lib.rs` are writable. `use_sqlite_cache` is intentionally excluded.
- Downloads run in parallel (`MAX_DOWNLOADS = 3`) but install/uninstall is serial. `CURRENT_CHILD`/`CURRENT_JOB` and per-app flags enforce this.
- Read both manifest families: `scoop-manifest.json`/`scoop-install.json` and legacy `manifest.json`/`install.json`.
- Cancel only during `preparing`/`downloading`/`waiting`; never kill Scoop in `verifying`/`extracting`/`finalizing`. Uninstall has no cancel.
- `cleanup_partial` removes incomplete version dirs and `.download` files, never the `current` target.
- Catalog cache: `%LOCALAPPDATA%\ScoopDeck\catalog.json`, keyed by bucket git HEAD; delete to force a rescan.
- Scoop behavior source of truth: `%USERPROFILE%\scoop\apps\scoop\current\lib\*.ps1`.

## Conventions

- Keep files split by screen/concern; no extra abstractions beyond nsh + local signals.
- Settings rows: a label that needs explaining carries a small decorative `info` icon whose tooltip holds the text (hover only, not in the Tab order); omit it when the label and control already say it (theme, language, debug). Keep a second line only for live status (last update time, cache path, exported path).
- Windows 10 1809+/11 only; no Node/npm. `nsh` owns build, typecheck, test, package.
- Docs are English (`README.md`) and Simplified Chinese (`README.zh-CN.md`); keep install/release instructions in sync.
