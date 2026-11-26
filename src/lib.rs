use nsh_core::prelude::*;
use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    fs,
    path::{Path, PathBuf},
    sync::{
        Arc, Mutex, OnceLock,
        atomic::{AtomicBool, Ordering},
        mpsc::{self, Receiver, Sender},
    },
    time::Duration,
};

/// 用户主动取消下载或安装时返回的固定错误文案（前后端据此区分主动取消与失败）。
pub(crate) const ERR_CANCELLED: &str = "已取消";
/// 新旧版本 Scoop 的清单文件名（新版优先）。
pub(crate) const MANIFEST_FILES: [&str; 2] = ["scoop-manifest.json", "manifest.json"];
/// 新旧版本 Scoop 的安装信息文件名（新版优先）。
pub(crate) const INSTALL_FILES: [&str; 2] = ["scoop-install.json", "install.json"];

/// 正在运行的 Scoop 子进程，供取消用。
pub(crate) static CURRENT_CHILD: Mutex<Option<u32>> = Mutex::new(None);
/// 正在跑 Scoop 的包名（同一时刻只有一个）。
pub(crate) static CURRENT_JOB: Mutex<Option<String>> = Mutex::new(None);
/// Scoop 子进程当前阶段：解压/收尾时杀进程会留下半个应用。
pub(crate) static CURRENT_STAGE: Mutex<Option<String>> = Mutex::new(None);

/// 校验/解压/收尾阶段不能杀 Scoop：可能已经删了旧版本或写了半个应用。
fn stage_blocks_cancel(stage: &str) -> bool {
    matches!(stage, "verifying" | "extracting" | "finalizing")
}

/// 每个进行中的任务一个取消标志；下载可以并行，所以取消按包区分。
fn active_jobs() -> &'static Mutex<HashMap<String, Arc<AtomicBool>>> {
    static JOBS: OnceLock<Mutex<HashMap<String, Arc<AtomicBool>>>> = OnceLock::new();
    JOBS.get_or_init(|| Mutex::new(HashMap::new()))
}

fn job_flag(name: &str) -> Arc<AtomicBool> {
    let mut jobs = active_jobs()
        .lock()
        .unwrap_or_else(|error| error.into_inner());

    jobs.entry(name.to_string())
        .or_insert_with(|| Arc::new(AtomicBool::new(false)))
        .clone()
}

fn finish_job(name: &str) {
    if let Ok(mut jobs) = active_jobs().lock() {
        jobs.remove(name);
    }
}

/// Scoop 配置里允许改写的布尔项。
pub(crate) const FLAG_KEYS: [&str; 11] = [
    "aria2-enabled",
    "aria2-fallback-enabled",
    "use_external_7zip",
    "use_lessmsi",
    "ignore_running_processes",
    "update_nightly",
    "force_update",
    "no_junction",
    "use_git_history",
    "autostash_on_conflict",
    "debug",
];

/// Scoop 配置里允许改写的文本项。
pub(crate) const TEXT_KEYS: [&str; 6] = [
    "proxy",
    "default_architecture",
    "shim",
    "scoop_repo",
    "scoop_branch",
    "gh_token",
];

mod download;
mod process;
mod settings;

/// 本 crate 导出给 TSX 的内容（`nsh.json` 的 `"rust"`）。
#[native_module("scoop-deck/native")]
fn native(registry: &mut Registry) {
    registry.module::<Scoop>();
}

/// 一个已安装的包。
#[derive(Debug, Clone, Default, JsObject)]
pub struct ScoopApp {
    /// 包名。
    pub name: String,
    /// 已安装的版本。
    pub installed_version: String,
    /// bucket 清单里的最新版本；清单不存在时为 `None`。
    #[prop(skip_none)]
    pub latest_version: Option<String>,
    /// 描述。
    pub description: String,
    /// 安装来源：bucket 名；通过 URL 清单安装时是清单地址。
    pub bucket: String,
}

/// 一个可安装的包（搜索结果的一行）。
#[derive(Debug, Clone, Default, JsObject, Serialize, Deserialize)]
pub struct ScoopCatalogApp {
    /// 包名。
    pub name: String,
    /// bucket 清单里的版本。
    pub version: String,
    /// 描述。
    pub description: String,
    /// 所属 bucket。
    pub bucket: String,
}

/// 一个已添加的 bucket。
#[derive(Debug, Clone, Default, JsObject)]
pub struct ScoopBucket {
    /// bucket 名称。
    pub name: String,
    /// `bucket/` 目录里的清单数量。
    pub app_count: u32,
    /// `.git/config` 里 origin 的 url；非 git bucket 时为 `None`。
    #[prop(skip_none)]
    pub source: Option<String>,
}

/// Scoop 内置的已知 bucket。
#[derive(Debug, Clone, Default, JsObject)]
pub struct ScoopKnownBucket {
    /// bucket 名称。
    pub name: String,
    /// 官方仓库地址。
    pub repo: String,
    /// 本机是否已经添加。
    pub installed: bool,
}

/// 安装或更新期间的可观测进度。下载百分比未知时只报告真实传输字节数。
#[derive(Debug, Clone, Default, JsObject)]
pub struct InstallProgress {
    /// 当前阶段：preparing、downloading、verifying、extracting、finalizing、completed 或 failed。
    pub stage: String,
    /// 当前阶段的简短说明。
    pub detail: String,
    /// 正在下载的文件名（如果能从 Scoop cache 中识别）。
    #[prop(skip_none)]
    pub file: Option<String>,
    /// 当前缓存文件已写入的字节数。
    #[prop(skip_none)]
    pub bytes: Option<u64>,
    /// 本次下载的总字节数：Scoop 在输出被重定向时会打印
    /// `Downloading <url> (<size>)`，那个 size 就是 Content-Length。
    /// 多文件安装时是当前文件的总量。
    #[prop(skip_none)]
    pub total_bytes: Option<u64>,
    /// 下载百分比（0–100）；总量未知（例如改用 aria2）时为 `None`。
    #[prop(skip_none)]
    pub percent: Option<f64>,
}

/// Scoop 的配置与运行环境（直接读 `~/.config/scoop/config.json`）。
#[derive(Debug, Clone, Default, JsObject)]
pub struct ScoopSettings {
    /// Scoop 自身的版本（取自 `CHANGELOG.md`）。
    pub version: String,
    /// 上一次 `scoop update` 的时间（配置文件里的 `last_update`）。
    pub last_update: String,
    /// Scoop 根目录。
    pub root_path: String,
    /// 全局安装目录。
    pub global_path: String,
    /// 下载缓存目录。
    pub cache_path: String,
    /// 缓存占用字节数。
    pub cache_bytes: u64,
    /// 缓存文件数。
    pub cache_files: u32,
    /// 用 aria2 下载（大文件更快）。
    pub aria2_enabled: bool,
    /// aria2 失败时回退到默认下载器。
    pub aria2_fallback_enabled: bool,
    /// 代理设置：`default`、`none`、`currentuser` 或 `host:port`；空为默认。
    pub proxy: String,
    /// ScoopDeck 自己的 GitHub 下载代理前缀（如 `https://ghproxy.net/`），不写入 Scoop 配置。
    pub github_proxy: String,
    /// 默认安装架构：`64bit`、`32bit`、`arm64`；空表示跟随系统。
    pub default_architecture: String,
    /// 用外部 7-Zip 解压。
    pub use_external_7zip: bool,
    /// 用 lessmsi 解开 msi。
    pub use_lessmsi: bool,
    /// shim 实现：`kiennq`、`scoopcs` 或 `71`。
    pub shim: String,
    /// 升级/卸载时忽略仍在运行的应用进程。
    pub ignore_running_processes: bool,
    /// Scoop 源码仓库地址（可换镜像）。
    pub scoop_repo: String,
    /// Scoop 分支：`master` 或 `develop`。
    pub scoop_branch: String,
    /// 允许 nightly 版本被更新。
    pub update_nightly: bool,
    /// 强制更新到 bucket 里的版本（忽略已安装版本判断）。
    pub force_update: bool,
    /// 不使用 `current` 链接：shim 与快捷方式直接指向具体版本。
    pub no_junction: bool,
    /// 安装带版本号的旧版本时，先在 bucket 的 git 历史里找。
    pub use_git_history: bool,
    /// 更新遇到冲突时自动 stash 未提交的改动。
    pub autostash_on_conflict: bool,
    /// 是否已配置 GitHub token（不返回明文）。
    pub gh_token_set: bool,
    /// 输出详细调试信息。
    pub debug: bool,
}

/// 一个包的详情：清单信息 + 本机安装情况。
#[derive(Debug, Clone, Default, JsObject)]
pub struct ScoopDetails {
    /// 包名。
    pub name: String,
    /// 清单里的版本。
    pub version: String,
    /// 描述。
    pub description: String,
    /// 主页。
    pub homepage: String,
    /// 许可证。
    pub license: String,
    /// 清单所属的 bucket；通过 URL 清单安装时是清单地址。
    pub bucket: String,
    /// 已安装的版本；没装时为空。
    pub installed_version: String,
    /// 已安装目录占用的字节数；没装时为 0。
    pub size_bytes: u64,
    /// 已安装版本的目录；没装时为空。
    pub installed_path: String,
    /// 清单里的第一个下载地址（去掉 `#/…` 片段）。
    pub url: String,
    /// 依赖的包，用「、」连接。
    pub depends: String,
    /// 建议一起安装的包。
    pub suggest: String,
    /// 安装后显示给用户的备注。
    pub notes: String,
    /// 清单文件路径。
    pub manifest_path: String,
}

/// Scoop 包管理。
#[module]
pub struct Scoop;
#[module]
impl Scoop {
    /// 已安装的包，按名称（不区分大小写）排序。
    pub async fn installed() -> Result<Vec<ScoopApp>, String> {
        blocking(Self::get_installed_app)
            .await
            .map_err(|error| format!("后台任务失败：{error}"))?
    }

    /// 本地 bucket 里所有可安装的包，按名称（不区分大小写）排序。
    pub async fn catalog() -> Result<Vec<ScoopCatalogApp>, String> {
        blocking(Self::get_catalog)
            .await
            .map_err(|error| format!("后台任务失败：{error}"))?
    }

    /// 已添加的 bucket，按名称（不区分大小写）排序。
    pub async fn buckets() -> Result<Vec<ScoopBucket>, String> {
        blocking(Self::get_buckets)
            .await
            .map_err(|error| format!("后台任务失败：{error}"))?
    }

    /// Scoop 内置的已知 bucket，附带本机是否已添加。
    pub async fn known_buckets() -> Result<Vec<ScoopKnownBucket>, String> {
        blocking(Self::get_known_buckets)
            .await
            .map_err(|error| format!("后台任务失败：{error}"))?
    }

    /// 读取 Scoop 的配置与环境；配置文件不存在时返回默认值。
    pub async fn settings() -> Result<ScoopSettings, String> {
        blocking(Self::load_settings)
            .await
            .map_err(|error| format!("后台任务失败：{error}"))?
    }

    /// 改写一个布尔设置（白名单内）。
    pub async fn set_flag(key: String, value: bool) -> Result<(), String> {
        blocking(move || {
            if !FLAG_KEYS.contains(&key.as_str()) {
                return Err(format!("不支持的开关：{key}"));
            }

            Self::write_setting(&key, serde_json::Value::Bool(value))
        })
        .await
        .map_err(|error| format!("后台任务失败：{error}"))?
    }

    /// 改写一个文本设置（白名单内）；空字符串表示恢复默认（删掉这个键）。
    pub async fn set_text(key: String, value: String) -> Result<(), String> {
        let value = value.trim().to_string();

        blocking(move || {
            if key == "github_proxy" {
                return Self::set_github_proxy(&value);
            }

            if !TEXT_KEYS.contains(&key.as_str()) {
                return Err(format!("不支持的设置项：{key}"));
            }

            if value.is_empty() {
                Self::remove_setting(&key)
            } else {
                Self::write_setting(&key, serde_json::Value::String(value))
            }
        })
        .await
        .map_err(|error| format!("后台任务失败：{error}"))?
    }

    /// 清空下载缓存，返回释放的字节数。
    pub async fn clear_cache() -> Result<u64, String> {
        blocking(Self::clear_cache_impl)
            .await
            .map_err(|error| format!("后台任务失败：{error}"))?
    }

    /// 把 `scoop export` 的结果写到 `dir`（空则桌面），返回文件路径。
    pub async fn export_config(dir: String) -> Result<String, String> {
        blocking(move || Self::export_impl(&dir))
            .await
            .map_err(|error| format!("后台任务失败：{error}"))?
    }

    /// 打开系统目录选择框；取消返回空字符串。
    pub async fn pick_folder() -> Result<String, String> {
        blocking(Self::pick_folder_impl)
            .await
            .map_err(|error| format!("后台任务失败：{error}"))?
    }

    /// 打开系统文件选择框；取消返回空字符串。
    pub async fn pick_file() -> Result<String, String> {
        blocking(Self::pick_file_impl)
            .await
            .map_err(|error| format!("后台任务失败：{error}"))?
    }

    /// 从 Scoopfile 恢复应用到本机（`scoop import <path>`）。
    pub async fn import_config(path: String) -> Result<(), String> {
        blocking(move || Self::run_scoop(&["import", &path]))
            .await
            .map_err(|error| format!("后台任务失败：{error}"))?
    }

    /// 更新 Scoop 自身与所有 bucket（`scoop update`，不含应用）。
    pub async fn update_scoop() -> Result<(), String> {
        blocking(|| Self::run_scoop(&["update"]))
            .await
            .map_err(|error| format!("后台任务失败：{error}"))?
    }

    /// 删除所有应用保留的旧版本目录（`scoop cleanup -a`）。
    pub async fn cleanup_old_apps() -> Result<(), String> {
        blocking(|| Self::run_scoop(&["cleanup", "-a"]))
            .await
            .map_err(|error| format!("后台任务失败：{error}"))?
    }

    /// 安装前预估下载大小（字节）：读清单里的下载地址，再用一次 HEAD 请求
    /// 取 `Content-Length`。多个文件求和；无法确定（镜像不给长度、需登录等）返回 0。
    pub async fn download_size(name: String) -> Result<u64, String> {
        blocking(move || Self::estimate_download_size(&name))
            .await
            .map_err(|error| format!("后台任务失败：{error}"))?
    }

    /// 一个包的详情：清单信息、所属 bucket、本机安装版本与占用空间。
    pub async fn details(name: String) -> Result<ScoopDetails, String> {
        blocking(move || Self::load_details(&name))
            .await
            .map_err(|error| format!("后台任务失败：{error}"))?
    }

    /// 把安装包下载到 Scoop 的缓存目录。可以并行调用；失败时返回错误，
    /// 调用方仍可直接安装（让 Scoop 自己下载）。
    pub async fn prefetch(
        name: String,
        on_progress: Callback<InstallProgress>,
    ) -> Result<(), String> {
        Self::run_job_with_progress(name, on_progress, |name, flag, sender| {
            Self::prefetch_impl(name, flag, &sender).map(|_| ())
        })
        .await
    }

    /// 取消某个包的下载或安装（按包区分，不影响其它并行下载）。
    pub async fn cancel(name: String) -> bool {
        let pid = {
            let mut job = CURRENT_JOB
                .lock()
                .unwrap_or_else(|error| error.into_inner());

            if job.as_deref() == Some(name.as_str()) {
                let stage = CURRENT_STAGE
                    .lock()
                    .unwrap_or_else(|error| error.into_inner())
                    .clone()
                    .unwrap_or_default();

                // 已经在校验/解压/写文件：这时杀进程会留下半个应用，只让安装跑完。
                if stage_blocks_cancel(&stage) {
                    return false;
                }

                *job = None;
                CURRENT_CHILD
                    .lock()
                    .unwrap_or_else(|error| error.into_inner())
                    .take()
            } else {
                None
            }
        };

        let mut cancelled = false;

        if let Ok(jobs) = active_jobs().lock()
            && let Some(flag) = jobs.get(&name)
        {
            flag.store(true, Ordering::Relaxed);
            cancelled = true;
        }

        if let Some(pid) = pid {
            let _ = blocking(move || Self::kill_tree(pid)).await;
            cancelled = true;
        }

        cancelled
    }

    /// 是否找得到 `scoop.cmd`：PATH，或默认 / 自定义 Scoop 目录的 shims。
    pub async fn available() -> bool {
        blocking(Self::scoop_shim).await.ok().flatten().is_some()
    }

    /// `scoop install <name>`，并把 Scoop cache 的实时写入量报告给 TSX。
    pub async fn install(
        name: String,
        on_progress: Callback<InstallProgress>,
    ) -> Result<(), String> {
        Self::run_job_with_progress(name, on_progress, Self::install_app).await
    }

    /// `scoop uninstall <name>`。
    pub async fn uninstall(name: String) -> Result<(), String> {
        blocking(move || Self::uninstall_app(&name))
            .await
            .map_err(|error| format!("后台任务失败：{error}"))?
    }

    /// `scoop update <name>`，并报告下载与安装阶段。
    pub async fn update(
        name: String,
        on_progress: Callback<InstallProgress>,
    ) -> Result<(), String> {
        Self::run_job_with_progress(name, on_progress, Self::update_app).await
    }

    /// `scoop bucket add <name> [<repo>]`。
    pub async fn add_bucket(name: String, repo: Option<String>) -> Result<(), String> {
        blocking(move || Self::add_bucket_impl(&name, repo.as_deref()))
            .await
            .map_err(|error| format!("后台任务失败：{error}"))?
    }

    /// `scoop bucket rm <name>`。
    pub async fn remove_bucket(name: String) -> Result<(), String> {
        blocking(move || Self::remove_bucket_impl(&name))
            .await
            .map_err(|error| format!("后台任务失败：{error}"))?
    }

    /// 改 bucket 的 git 远端地址（`git remote set-url origin <url>`）。
    pub async fn set_bucket_source(name: String, url: String) -> Result<(), String> {
        blocking(move || Self::set_bucket_source_impl(&name, &url))
            .await
            .map_err(|error| format!("后台任务失败：{error}"))?
    }
}

impl Scoop {
    async fn run_job_with_progress(
        name: String,
        on_progress: Callback<InstallProgress>,
        task: fn(&str, &Arc<AtomicBool>, Sender<InstallProgress>) -> Result<(), String>,
    ) -> Result<(), String> {
        let flag = job_flag(&name);
        let (sender, receiver) = mpsc::channel();
        let (result_sender, result_receiver) = mpsc::channel();
        let worker_name = name.clone();
        let _worker = blocking(move || {
            let result = task(&worker_name, &flag, sender);
            let _ = result_sender.send(result);
        });
        let result = Self::wait_for_progress(receiver, result_receiver, on_progress).await;
        finish_job(&name);
        result
    }

    async fn wait_for_progress(
        progress_receiver: Receiver<InstallProgress>,
        result_receiver: Receiver<Result<(), String>>,
        on_progress: Callback<InstallProgress>,
    ) -> Result<(), String> {
        loop {
            for progress in progress_receiver.try_iter() {
                on_progress.post(progress);
            }

            match result_receiver.try_recv() {
                Ok(result) => {
                    for progress in progress_receiver.try_iter() {
                        on_progress.post(progress);
                    }
                    return result;
                }
                Err(mpsc::TryRecvError::Disconnected) => {
                    return Err("后台任务异常退出".into());
                }
                Err(mpsc::TryRecvError::Empty) => {}
            }

            timer(Duration::from_millis(100)).await;
        }
    }

    /// `~/.config/scoop/config.json`
    ///
    /// 文件缺失、JSON 坏了、`root_path` 缺失/null/空字符串都回退到 Scoop 的默认根目录，
    /// 避免整个已安装列表 / 清单 / bucket 因为一个可选键解析失败。
    fn get_scoop_config() -> Result<ScoopConfig, String> {
        let home = std::env::var_os("USERPROFILE")
            .map(PathBuf::from)
            .ok_or_else(|| "找不到用户主目录".to_string())?;
        let path = home.join(".config").join("scoop").join("config.json");
        let value = fs::read_to_string(&path)
            .ok()
            .and_then(|text| serde_json::from_str::<serde_json::Value>(&text).ok());

        Ok(ScoopConfig {
            root_path: scoop_root_from_config(value.as_ref(), &home),
        })
    }

    /// 当前版本目录和清单都存在，才算真的装好。
    /// `scoop.cmd` 在下载失败时也可能返回 0，所以不能只看退出码。
    fn is_app_installed(name: &str) -> bool {
        let Ok(config) = Self::get_scoop_config() else {
            return false;
        };

        let current = config.root_path.join("apps").join(name).join("current");

        current.exists() && Self::has_manifest_file(&current)
    }

    /// 目录里是否存在新版或旧版 Scoop 清单文件。
    pub(crate) fn has_manifest_file(dir: &Path) -> bool {
        MANIFEST_FILES.iter().any(|file| dir.join(file).is_file())
    }

    /// 找到目录里的清单文件路径（优先 `scoop-manifest.json`，其次 `manifest.json`）。
    pub(crate) fn find_manifest_path(dir: &Path) -> Option<PathBuf> {
        MANIFEST_FILES
            .iter()
            .map(|file| dir.join(file))
            .find(|path| path.is_file())
    }

    /// 读取目录里的 Scoop 清单（自动兼容新旧文件名）。
    pub(crate) fn read_manifest_in(dir: &Path) -> Option<ScoopManifest> {
        MANIFEST_FILES
            .iter()
            .find_map(|file| Self::read_json(&dir.join(file)).ok())
    }

    /// 读取目录里的安装信息（自动兼容新旧文件名，缺失或损坏时返回默认值）。
    pub(crate) fn read_install_in(dir: &Path) -> ScoopInstall {
        INSTALL_FILES
            .iter()
            .find_map(|file| Self::read_json(&dir.join(file)).ok())
            .unwrap_or_default()
    }

    fn installed_version(name: &str) -> Option<String> {
        let config = Self::get_scoop_config().ok()?;
        let current = config.root_path.join("apps").join(name).join("current");
        Self::read_manifest_in(&current)?.version
    }

    fn latest_version_for(name: &str) -> Option<String> {
        let config = Self::get_scoop_config().ok()?;
        let current = config.root_path.join("apps").join(name).join("current");
        let install = Self::read_install_in(&current);

        if let Some(bucket) = install
            .bucket
            .as_deref()
            .map(str::trim)
            .filter(|bucket| !bucket.is_empty())
        {
            return Self::get_app_latest_version(name, bucket, &config.root_path).ok();
        }

        let url = install.url.as_deref()?.trim();

        if Self::is_http_url(url) {
            Self::latest_version_from_url(url)
        } else {
            None
        }
    }

    /// URL 清单安装的包：远端清单里的版本就是最新版本。
    fn latest_version_from_url(url: &str) -> Option<String> {
        Self::fetch_manifest_from_url(url)?
            .get("version")
            .and_then(|version| version.as_str())
            .map(str::to_string)
    }

    fn is_http_url(url: &str) -> bool {
        let url = url.trim().to_ascii_lowercase();
        url.starts_with("https://") || url.starts_with("http://")
    }

    /// 安装/更新的真实结果：退出码 0 之外，还要确认应用目录已装好；
    /// 更新时再确认当前版本已经是 bucket 里的最新版本。
    fn verify_scoop_result(name: &str, args: &[&str]) -> bool {
        if !Self::is_app_installed(name) {
            return false;
        }

        if args.first() == Some(&"update")
            && let (Some(installed), Some(latest)) = (
                Self::installed_version(name),
                Self::latest_version_for(name),
            )
        {
            return installed == latest;
        }

        true
    }

    /// 单个包清单坏了只跳过它，不让整个列表失败。
    fn get_installed_app() -> Result<Vec<ScoopApp>, String> {
        let config = Self::get_scoop_config()?;
        let apps_dir = config.root_path.join("apps");
        let entries = fs::read_dir(&apps_dir)
            .map_err(|error| format!("读取 {} 失败：{error}", apps_dir.display()))?;

        let mut apps = Vec::new();

        for entry in entries.flatten() {
            let app_path = entry.path();

            if !app_path.is_dir() {
                continue;
            }

            let name = entry.file_name().to_string_lossy().to_string();

            if name == "scoop" {
                continue;
            }

            // 只有带 current 的才算装好（旧版本目录会被跳过）
            let current = app_path.join("current");

            if !current.exists() {
                continue;
            }

            let Some(manifest) = Self::read_manifest_in(&current) else {
                continue;
            };

            let install = Self::read_install_in(&current);
            let bucket = install.bucket.unwrap_or_default();
            let url = install.url.unwrap_or_default();
            // 普通安装用 bucket；URL 清单安装没有 bucket，用清单地址作为来源。
            let source = if bucket.trim().is_empty() {
                url
            } else {
                bucket
            };

            let latest_version = if Self::is_http_url(&source) {
                Self::latest_version_from_url(&source)
            } else if !source.trim().is_empty() {
                Self::get_app_latest_version(&name, &source, &config.root_path).ok()
            } else {
                None
            };

            apps.push(ScoopApp {
                name,
                installed_version: manifest.version.unwrap_or_default(),
                latest_version,
                description: manifest.description.unwrap_or_default(),
                bucket: source,
            });
        }

        apps.sort_by_key(|app| app.name.to_lowercase());
        Ok(apps)
    }

    /// `<root_path>/buckets/<bucket>/bucket/<app>.json`
    fn get_app_latest_version(app: &str, bucket: &str, root_path: &Path) -> Result<String, String> {
        let path = root_path
            .join("buckets")
            .join(bucket)
            .join("bucket")
            .join(format!("{app}.json"));

        Ok(Scoop::read_json::<ScoopManifest>(&path)?
            .version
            .unwrap_or_default())
    }

    fn load_details(name: &str) -> Result<ScoopDetails, String> {
        let (bucket, path, manifest) = Self::find_manifest_full(name)?;
        let text = |key: &str| {
            manifest
                .get(key)
                .and_then(|value| value.as_str())
                .unwrap_or_default()
                .to_string()
        };
        let config = Self::get_scoop_config()?;
        let app_dir = config.root_path.join("apps").join(name);
        let installed = Self::read_manifest_in(&app_dir.join("current"));
        let installed_version = installed
            .and_then(|manifest| manifest.version)
            .unwrap_or_default();
        let size_bytes = if installed_version.is_empty() {
            0
        } else {
            Self::dir_size(&app_dir.join(&installed_version))
        };
        let installed_path = if installed_version.is_empty() {
            String::new()
        } else {
            app_dir.join(&installed_version).display().to_string()
        };
        let version = text("version");
        let mut urls = Vec::new();
        Self::manifest_urls(&manifest, &version, &mut urls);
        let url = urls
            .first()
            .map(|url| Self::strip_fragment(url).to_string())
            .unwrap_or_default();

        Ok(ScoopDetails {
            name: name.to_string(),
            version,
            description: text("description"),
            homepage: text("homepage"),
            license: Self::license_text(&manifest),
            bucket,
            installed_version,
            size_bytes,
            installed_path,
            url,
            depends: Self::join_texts(manifest.get("depends")),
            suggest: Self::join_texts(manifest.get("suggest")),
            notes: Self::join_texts(manifest.get("notes")),
            manifest_path: path.display().to_string(),
        })
    }

    /// `license` 既可能是字符串，也可能是 `{ identifier, url }` 对象。
    fn license_text(manifest: &serde_json::Value) -> String {
        match manifest.get("license") {
            Some(serde_json::Value::String(text)) => text.clone(),
            Some(serde_json::Value::Object(map)) => map
                .get("identifier")
                .and_then(|value| value.as_str())
                .or_else(|| map.get("url").and_then(|value| value.as_str()))
                .unwrap_or_default()
                .to_string(),
            _ => String::new(),
        }
    }

    /// 清单里这些字段可能是字符串、数组或对象；统一拼成一段文字。
    fn join_texts(value: Option<&serde_json::Value>) -> String {
        let Some(value) = value else {
            return String::new();
        };

        match value {
            serde_json::Value::String(text) => text.clone(),
            serde_json::Value::Array(items) => items
                .iter()
                .filter_map(|item| item.as_str())
                .collect::<Vec<_>>()
                .join("、"),
            serde_json::Value::Object(map) => map.keys().cloned().collect::<Vec<_>>().join("、"),
            _ => String::new(),
        }
    }

    /// 递归统计目录占用（不走 junction：只统计版本目录本身）。
    fn dir_size(dir: &Path) -> u64 {
        let mut total = 0;
        let mut stack = vec![dir.to_path_buf()];

        while let Some(dir) = stack.pop() {
            let Ok(entries) = fs::read_dir(&dir) else {
                continue;
            };

            for entry in entries.flatten() {
                let Ok(metadata) = entry.metadata() else {
                    continue;
                };

                if metadata.is_dir() {
                    stack.push(entry.path());
                } else {
                    total += metadata.len();
                }
            }
        }

        total
    }

    /// 扫描 `<root_path>/buckets/*/bucket/*.json`，列出所有可安装的包。
    /// 只会覆盖**本地已添加**的 bucket（和 `scoop search` 的默认行为一致）。
    fn get_catalog() -> Result<Vec<ScoopCatalogApp>, String> {
        let config = Self::get_scoop_config()?;
        let buckets_dir = config.root_path.join("buckets");
        let signature = Self::catalog_signature(&buckets_dir);

        if !signature.is_empty()
            && let Some(cached) = Self::read_catalog_cache(&signature)
        {
            return Ok(cached);
        }

        let apps = Self::scan_catalog(&buckets_dir)?;
        Self::write_catalog_cache(&signature, &apps);
        Ok(apps)
    }

    /// 扫描 `<root_path>/buckets/*/bucket/*.json`，列出所有可安装的包。
    fn scan_catalog(buckets_dir: &Path) -> Result<Vec<ScoopCatalogApp>, String> {
        let buckets = fs::read_dir(buckets_dir)
            .map_err(|error| format!("读取 {} 失败：{error}", buckets_dir.display()))?;

        let mut apps = Vec::new();

        for bucket in buckets.flatten() {
            if !bucket.path().is_dir() {
                continue;
            }

            let bucket_name = bucket.file_name().to_string_lossy().to_string();
            let manifest_dir = bucket.path().join("bucket");
            let Ok(entries) = fs::read_dir(&manifest_dir) else {
                continue;
            };

            for entry in entries.flatten() {
                let path = entry.path();

                if path.extension().is_none_or(|ext| ext != "json") {
                    continue;
                }

                let Some(name) = path
                    .file_stem()
                    .map(|stem| stem.to_string_lossy().to_string())
                else {
                    continue;
                };
                let Ok(manifest) = Scoop::read_json::<ScoopManifest>(&path) else {
                    continue;
                };

                apps.push(ScoopCatalogApp {
                    name,
                    version: manifest.version.unwrap_or_default(),
                    description: manifest.description.unwrap_or_default(),
                    bucket: bucket_name.clone(),
                });
            }
        }

        apps.sort_by_key(|app| app.name.to_lowercase());
        Ok(apps)
    }

    /// bucket 的「版本」：git 的 HEAD 提交（非 git bucket 用目录修改时间）。
    /// 任何 bucket 更新或增删都会改变它，从而让缓存失效。
    fn catalog_signature(buckets_dir: &Path) -> String {
        let Ok(entries) = fs::read_dir(buckets_dir) else {
            return String::new();
        };

        let mut dirs: Vec<PathBuf> = entries
            .flatten()
            .map(|entry| entry.path())
            .filter(|path| path.is_dir())
            .collect();
        dirs.sort();

        let mut parts = Vec::new();

        for dir in dirs {
            let name = dir
                .file_name()
                .map(|name| name.to_string_lossy().to_string())
                .unwrap_or_default();
            let stamp = Self::git_head(&dir).unwrap_or_else(|| {
                let modified = dir
                    .metadata()
                    .ok()
                    .and_then(|metadata| metadata.modified().ok())
                    .and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok())
                    .map(|elapsed| elapsed.as_secs())
                    .unwrap_or_default();

                format!("mtime:{modified}")
            });

            parts.push(format!("{name}={stamp}"));
        }

        parts.join(";")
    }

    fn git_head(bucket: &Path) -> Option<String> {
        let head = fs::read_to_string(bucket.join(".git").join("HEAD")).ok()?;
        let head = head.trim();

        if let Some(reference) = head.strip_prefix("ref: ") {
            fs::read_to_string(bucket.join(".git").join(reference))
                .ok()
                .map(|value| value.trim().to_string())
        } else {
            Some(head.to_string())
        }
    }

    fn catalog_cache_path() -> Option<PathBuf> {
        let base = std::env::var_os("LOCALAPPDATA").map(PathBuf::from)?;
        Some(base.join("ScoopDeck").join("catalog.json"))
    }

    fn read_catalog_cache(signature: &str) -> Option<Vec<ScoopCatalogApp>> {
        let path = Self::catalog_cache_path()?;
        let cache: CatalogCache = Self::read_json(&path).ok()?;

        (cache.signature == signature && !cache.apps.is_empty()).then_some(cache.apps)
    }

    fn write_catalog_cache(signature: &str, apps: &[ScoopCatalogApp]) {
        if signature.is_empty() {
            return;
        }

        let Some(path) = Self::catalog_cache_path() else {
            return;
        };

        if let Some(parent) = path.parent() {
            let _ = fs::create_dir_all(parent);
        }

        let cache = CatalogCache {
            signature: signature.to_string(),
            apps: apps.to_vec(),
        };

        if let Ok(text) = serde_json::to_string(&cache) {
            let _ = fs::write(path, text);
        }
    }

    /// 列出 `<root_path>/buckets` 下已添加的 bucket。
    fn get_buckets() -> Result<Vec<ScoopBucket>, String> {
        let config = Self::get_scoop_config()?;
        let buckets_dir = config.root_path.join("buckets");
        let entries = fs::read_dir(&buckets_dir)
            .map_err(|error| format!("读取 {} 失败：{error}", buckets_dir.display()))?;

        let mut buckets = Vec::new();

        for entry in entries.flatten() {
            let path = entry.path();

            if !path.is_dir() {
                continue;
            }

            let app_count = fs::read_dir(path.join("bucket"))
                .map(|entries| {
                    entries
                        .flatten()
                        .filter(|entry| entry.path().extension().is_some_and(|ext| ext == "json"))
                        .count()
                })
                .unwrap_or(0) as u32;

            buckets.push(ScoopBucket {
                name: entry.file_name().to_string_lossy().to_string(),
                app_count,
                source: Self::git_origin(&path),
            });
        }

        buckets.sort_by_key(|bucket| bucket.name.to_lowercase());
        Ok(buckets)
    }

    /// Scoop 自带的 `<root>/apps/scoop/current/buckets.json`。
    fn get_known_buckets() -> Result<Vec<ScoopKnownBucket>, String> {
        let config = Self::get_scoop_config()?;
        let path = config
            .root_path
            .join("apps")
            .join("scoop")
            .join("current")
            .join("buckets.json");

        if !path.is_file() {
            return Ok(Vec::new());
        }

        let value: serde_json::Value = Self::read_json(&path)?;
        let Some(object) = value.as_object() else {
            return Ok(Vec::new());
        };

        let buckets_dir = config.root_path.join("buckets");
        let mut buckets = Vec::new();

        for (name, repo) in object {
            buckets.push(ScoopKnownBucket {
                name: name.clone(),
                repo: repo.as_str().unwrap_or_default().to_string(),
                installed: buckets_dir.join(name).is_dir(),
            });
        }

        buckets.sort_by_key(|bucket| bucket.name.to_lowercase());
        Ok(buckets)
    }

    /// 从 `<bucket>/.git/config` 里取 `[remote "origin"]` 的 url；非 git bucket 返回 None
    fn git_origin(bucket: &Path) -> Option<String> {
        let text = fs::read_to_string(bucket.join(".git").join("config")).ok()?;
        let mut in_origin = false;

        for line in text.lines() {
            let line = line.trim();

            if line.starts_with('[') {
                in_origin = line.replace(' ', "") == "[remote\"origin\"]";
                continue;
            }

            if in_origin && let Some(rest) = line.strip_prefix("url") {
                let url = rest.trim_start_matches([' ', '=']).trim();

                if !url.is_empty() {
                    return Some(url.to_string());
                }
            }
        }

        None
    }

    fn read_json<T: for<'de> Deserialize<'de>>(path: &Path) -> Result<T, String> {
        let text = fs::read_to_string(path)
            .map_err(|error| format!("读取 {} 失败：{error}", path.display()))?;

        serde_json::from_str(&text)
            .map_err(|error| format!("解析 {} 失败：{error}", path.display()))
    }
}

/// `~/.config/scoop/config.json` 里和路径有关的部分。
#[derive(Debug)]
pub(crate) struct ScoopConfig {
    root_path: PathBuf,
}

/// `root_path` 是可选键：缺失、null、空字符串或非字符串时，用 `~/scoop`。
fn scoop_root_from_config(config: Option<&serde_json::Value>, home: &Path) -> PathBuf {
    config
        .and_then(|value| value.get("root_path"))
        .and_then(|value| value.as_str())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(PathBuf::from)
        .unwrap_or_else(|| home.join("scoop"))
}

/// 清单扫描结果的磁盘缓存；`signature` 对不上就重扫。
#[derive(Debug, Deserialize, Serialize)]
struct CatalogCache {
    signature: String,
    apps: Vec<ScoopCatalogApp>,
}

#[derive(Debug, Default, Deserialize)]
pub(crate) struct ScoopManifest {
    #[serde(default)]
    version: Option<String>,
    #[serde(default)]
    description: Option<String>,
}

#[derive(Debug, Default, Deserialize)]
pub(crate) struct ScoopInstall {
    #[serde(default)]
    bucket: Option<String>,
    /// 通过 `scoop install <清单 URL>` 安装时的清单地址。
    #[serde(default)]
    url: Option<String>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cache_key_matches_scoop() {
        assert_eq!(
            Scoop::cache_key(
                "7zip",
                "26.06",
                "https://github.com/ip7z/7zip/releases/download/26.06/7z2606-x64.msi"
            ),
            "7zip#26.06#256d826.msi"
        );
        assert_eq!(
            Scoop::cache_key(
                "duckdb",
                "2.0.0",
                "https://github.com/duckdb/duckdb/releases/download/v2.0.0/duckdb-cli-windows-amd64.tar.gz"
            ),
            "duckdb#2.0.0#8f84b89.gz"
        );
        assert_eq!(
            Scoop::cache_key(
                "inno-setup",
                "7.1.1",
                "https://github.com/jrsoftware/issrc/releases/download/is-7_1_1/innosetup-7.1.1-x64.exe"
            ),
            "inno-setup#7.1.1#258f8fb.exe"
        );
    }

    #[test]
    fn extension_follows_dotnet_rules() {
        assert_eq!(Scoop::url_extension("https://a/b.zip"), ".zip");
        assert_eq!(Scoop::url_extension("https://a/b.c/d"), "");
        assert_eq!(Scoop::url_extension("https://a/b#/dl.7z"), ".7z");
        assert_eq!(Scoop::url_extension("https://a/b"), "");
    }

    #[test]
    fn config_root_falls_back_when_missing() {
        let home = PathBuf::from("C:\\Users\\x");
        let defaults = [
            None,
            Some(serde_json::json!({})),
            Some(serde_json::json!({ "root_path": null })),
            Some(serde_json::json!({ "root_path": "" })),
            Some(serde_json::json!({ "root_path": 42 })),
        ];

        for config in defaults {
            assert_eq!(
                scoop_root_from_config(config.as_ref(), &home),
                home.join("scoop")
            );
        }

        assert_eq!(
            scoop_root_from_config(
                Some(&serde_json::json!({ "root_path": "D:\\Scoop" })),
                &home
            ),
            PathBuf::from("D:\\Scoop")
        );
    }

    #[test]
    fn writes_config_without_losing_keys() {
        let dir = std::env::temp_dir().join("scoop-deck-config-test");
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("config.json");
        let _ = std::fs::remove_file(&path);

        let mut map = serde_json::Map::new();
        map.insert("root_path".into(), serde_json::json!("C:\\Users\\x\\scoop"));
        map.insert("aria2-enabled".into(), serde_json::json!(true));
        Scoop::write_config_file(&path, &map).unwrap();

        // 第二次写入要保留上一次的键。
        map.insert("proxy".into(), serde_json::json!("none"));
        Scoop::write_config_file(&path, &map).unwrap();

        let text = std::fs::read_to_string(&path).unwrap();
        let value: serde_json::Value = serde_json::from_str(&text).unwrap();

        assert_eq!(value["root_path"], "C:\\Users\\x\\scoop");
        assert_eq!(value["aria2-enabled"], true);
        assert_eq!(value["proxy"], "none");

        let _ = std::fs::remove_dir_all(&dir);
    }

    /// 读本机真实配置：`cargo test -p scoop-deck -- --ignored` 手动跑。
    #[test]
    #[ignore]
    fn reads_real_settings() {
        let settings = Scoop::load_settings().unwrap();
        println!("{settings:?}");
        assert!(!settings.root_path.is_empty());
    }

    #[test]
    fn picks_hash_from_architecture() {
        let hash = "a".repeat(64);
        let manifest = serde_json::json!({
            "version": "1.0",
            "architecture": {
                "64bit": { "url": "https://example.com/x.zip", "hash": format!("sha256:{hash}") }
            }
        });

        assert_eq!(Scoop::expected_hash(&manifest, 0, 1), Some(hash));
        // 地址数量与 hash 数量对不上时宁可不校验。
        assert_eq!(Scoop::expected_hash(&manifest, 0, 2), None);
    }

    /// 老版本 Scoop 用 `manifest.json` / `install.json`；详情要能读这两种。
    #[test]
    #[ignore]
    fn details_reads_legacy_manifests() {
        let Some(home) = std::env::var_os("USERPROFILE") else {
            return;
        };
        let apps_dir = std::path::PathBuf::from(home).join("scoop").join("apps");
        let legacy = std::fs::read_dir(apps_dir)
            .into_iter()
            .flatten()
            .flatten()
            .find(|entry| {
                let current = entry.path().join("current");
                current.join("manifest.json").is_file()
                    && !current.join("scoop-manifest.json").is_file()
            });

        let Some(legacy) = legacy else {
            return;
        };
        let name = legacy.file_name().to_string_lossy().to_string();
        let details = Scoop::load_details(&name).unwrap();

        assert!(
            !details.installed_version.is_empty(),
            "{name} 没识别出已安装版本"
        );
    }

    /// 清理旧版本：真机上挑一个有多个版本目录的应用验证。
    #[test]
    #[ignore]
    fn cleans_old_versions() {
        let Some(home) = std::env::var_os("USERPROFILE") else {
            return;
        };
        let app_dir = std::path::PathBuf::from(home)
            .join("scoop")
            .join("apps")
            .join("hwinfo");

        let versions = || {
            std::fs::read_dir(&app_dir)
                .into_iter()
                .flatten()
                .flatten()
                .filter(|entry| {
                    entry.path().is_dir() && entry.file_name().to_string_lossy() != "current"
                })
                .count()
        };

        if versions() < 2 {
            return;
        }

        Scoop::cleanup_old_versions("hwinfo");
        assert_eq!(versions(), 1);
    }

    #[test]
    fn parses_license_shapes() {
        assert_eq!(
            Scoop::license_text(&serde_json::json!({ "license": "MIT" })),
            "MIT"
        );
        assert_eq!(
            Scoop::license_text(&serde_json::json!({
                "license": { "identifier": "EULA", "url": "https://x" }
            })),
            "EULA"
        );
        assert_eq!(
            Scoop::license_text(&serde_json::json!({ "license": { "url": "https://x" } })),
            "https://x"
        );
        assert_eq!(Scoop::license_text(&serde_json::json!({})), "");
    }

    #[test]
    fn blocks_cancel_only_while_downloading() {
        for stage in ["preparing", "downloading", "waiting"] {
            assert!(!stage_blocks_cancel(stage), "{stage} 应该允许取消");
        }

        for stage in ["verifying", "extracting", "finalizing"] {
            assert!(stage_blocks_cancel(stage), "{stage} 不应该允许取消");
        }
    }

    /// 全量形状检查：本机所有 bucket 清单与已安装清单都能被当前结构体解析。
    #[test]
    #[ignore]
    fn parses_all_local_manifests() {
        let Some(home) = std::env::var_os("USERPROFILE") else {
            return;
        };
        let home = std::path::PathBuf::from(home);
        let mut failures = Vec::new();
        let mut bucket_count = 0;

        let buckets = home.join("scoop").join("buckets");
        if let Ok(entries) = fs::read_dir(&buckets) {
            for bucket in entries.flatten() {
                let Ok(files) = fs::read_dir(bucket.path().join("bucket")) else {
                    continue;
                };

                for file in files.flatten() {
                    let path = file.path();

                    if path.extension().is_none_or(|extension| extension != "json") {
                        continue;
                    }

                    bucket_count += 1;

                    match Scoop::read_json::<ScoopManifest>(&path) {
                        Ok(manifest) => {
                            if manifest.version.as_deref().unwrap_or_default().is_empty() {
                                failures.push(format!("bucket {}: version 为空", path.display()));
                            }
                        }
                        Err(error) => {
                            failures.push(format!("bucket {}: {error}", path.display()));
                        }
                    }
                }
            }
        }

        let mut installed_count = 0;
        let apps = home.join("scoop").join("apps");
        if let Ok(entries) = fs::read_dir(&apps) {
            for app in entries.flatten() {
                let current = app.path().join("current");

                if !current.exists() {
                    continue;
                }

                let manifests: Vec<_> = ["scoop-manifest.json", "manifest.json"]
                    .iter()
                    .map(|file| current.join(file))
                    .filter(|path| path.is_file())
                    .collect();

                // Scoop 自己的目录没有清单，不算应用。
                if manifests.is_empty() {
                    continue;
                }

                installed_count += 1;

                if manifests
                    .iter()
                    .all(|path| Scoop::read_json::<ScoopManifest>(path).is_err())
                {
                    failures.push(format!(
                        "app {}: 清单解析失败",
                        app.file_name().to_string_lossy()
                    ));
                } else if manifests
                    .iter()
                    .filter_map(|path| Scoop::read_json::<ScoopManifest>(path).ok())
                    .all(|manifest| manifest.version.as_deref().unwrap_or_default().is_empty())
                {
                    failures.push(format!(
                        "app {}: version 为空",
                        app.file_name().to_string_lossy()
                    ));
                }

                for file in ["scoop-install.json", "install.json"] {
                    let path = current.join(file);

                    if path.is_file()
                        && let Err(error) = Scoop::read_json::<ScoopInstall>(&path)
                    {
                        failures.push(format!(
                            "app {} / {file}: {error}",
                            app.file_name().to_string_lossy()
                        ));
                    }
                }
            }
        }

        assert!(bucket_count > 0, "没有找到 bucket 清单");
        assert!(
            failures.is_empty(),
            "{} 个解析失败：\n{}",
            failures.len(),
            failures.join("\n")
        );
        println!("bucket manifests: {bucket_count}, installed apps: {installed_count}");
    }

    /// 网络测试：`cargo test -p scoop-deck -- --ignored` 手动跑。
    #[test]
    #[ignore]
    fn downloads_a_file_over_https() {
        let dir = std::env::temp_dir().join("scoop-deck-test");
        std::fs::create_dir_all(&dir).unwrap();
        let part = dir.join("favicon.ico.download");
        let _ = std::fs::remove_file(&part);
        let (sender, receiver) = mpsc::channel();
        let flag = Arc::new(AtomicBool::new(false));

        Scoop::download_once("https://scoop.sh/favicon.ico", &part, &flag, &sender).unwrap();

        let size = std::fs::metadata(&part).unwrap().len();
        assert!(size > 0, "nothing downloaded");
        assert!(receiver.try_iter().count() > 0, "no progress events");
    }

    /// 把一个小包真正下到 Scoop 缓存里，验证文件名和 Scoop 一致。
    #[test]
    #[ignore]
    fn prefetch_uses_scoop_cache_names() {
        let (sender, _receiver) = mpsc::channel();
        let flag = Arc::new(AtomicBool::new(false));
        Scoop::prefetch_impl("busybox", &flag, &sender).unwrap();

        let cache = Scoop::get_cache_dir().unwrap();
        let found = std::fs::read_dir(&cache).unwrap().flatten().any(|entry| {
            entry.file_name().to_string_lossy().starts_with("busybox#")
                && entry
                    .metadata()
                    .map(|metadata| metadata.len() > 0)
                    .unwrap_or(false)
        });

        assert!(found, "缓存目录里没有 busybox 的下载文件");
    }
}
