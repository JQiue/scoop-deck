//! Scoop 配置文件（`~/.config/scoop/config.json`）的读取、写回与导入导出。

use std::{
    fs,
    path::{Path, PathBuf},
    process::{Command, Stdio},
};

use crate::{Scoop, ScoopSettings};

impl Scoop {
    pub(crate) fn config_path() -> Result<PathBuf, String> {
        let home = std::env::var_os("USERPROFILE")
            .map(PathBuf::from)
            .ok_or_else(|| "找不到用户主目录".to_string())?;
        Ok(home.join(".config").join("scoop").join("config.json"))
    }

    /// 直接解析配置文件；文件不存在算空配置，但内容坏了就报错（避免写回时覆盖用户设置）。
    pub(crate) fn read_config_map() -> Result<serde_json::Map<String, serde_json::Value>, String> {
        let path = Self::config_path()?;

        let Ok(text) = fs::read_to_string(&path) else {
            return Ok(serde_json::Map::new());
        };

        match serde_json::from_str::<serde_json::Value>(&text) {
            Ok(serde_json::Value::Object(map)) => Ok(map),
            Ok(_) => Ok(serde_json::Map::new()),
            Err(error) => Err(format!("解析 {} 失败：{error}", path.display())),
        }
    }

    /// 原子写入：先写临时文件，再替换原文件。
    pub(crate) fn write_config_map(
        map: &serde_json::Map<String, serde_json::Value>,
    ) -> Result<(), String> {
        let path = Self::config_path()?;
        Self::write_config_file(&path, map)
    }

    pub(crate) fn write_config_file(
        path: &Path,
        map: &serde_json::Map<String, serde_json::Value>,
    ) -> Result<(), String> {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).map_err(|error| format!("创建配置目录失败：{error}"))?;
        }

        let text = format!(
            "{}\n",
            serde_json::to_string_pretty(&serde_json::Value::Object(map.clone()))
                .map_err(|error| format!("序列化配置失败：{error}"))?
        );
        let temp = path.with_extension("json.tmp");

        fs::write(&temp, text).map_err(|error| format!("写入临时配置失败：{error}"))?;

        if fs::rename(&temp, path).is_err() {
            fs::copy(&temp, path).map_err(|error| format!("保存配置失败：{error}"))?;
            let _ = fs::remove_file(&temp);
        }

        Ok(())
    }

    pub(crate) fn write_setting(key: &str, value: serde_json::Value) -> Result<(), String> {
        let mut map = Self::read_config_map()?;
        map.insert(key.to_ascii_lowercase(), value);
        Self::write_config_map(&map)
    }

    pub(crate) fn remove_setting(key: &str) -> Result<(), String> {
        let mut map = Self::read_config_map()?;
        map.remove(&key.to_ascii_lowercase());
        Self::write_config_map(&map)
    }

    /// ScoopDeck 自己的设置文件：`%LOCALAPPDATA%\ScoopDeck\settings.json`。
    /// 这类设置不写进 Scoop 的 config.json，避免污染 Scoop 配置。
    pub(crate) fn app_settings_path() -> Result<PathBuf, String> {
        let base = std::env::var_os("LOCALAPPDATA")
            .map(PathBuf::from)
            .ok_or_else(|| "找不到 LOCALAPPDATA".to_string())?;

        Ok(base.join("ScoopDeck").join("settings.json"))
    }

    pub(crate) fn read_app_settings_map()
    -> Result<serde_json::Map<String, serde_json::Value>, String> {
        let path = Self::app_settings_path()?;

        let Ok(text) = fs::read_to_string(&path) else {
            return Ok(serde_json::Map::new());
        };

        match serde_json::from_str::<serde_json::Value>(&text) {
            Ok(serde_json::Value::Object(map)) => Ok(map),
            Ok(_) => Ok(serde_json::Map::new()),
            Err(error) => Err(format!("解析 {} 失败：{error}", path.display())),
        }
    }

    pub(crate) fn write_app_settings_map(
        map: &serde_json::Map<String, serde_json::Value>,
    ) -> Result<(), String> {
        let path = Self::app_settings_path()?;
        Self::write_config_file(&path, map)
    }

    /// ScoopDeck 的 GitHub 下载代理前缀；损坏或没设置时返回空字符串。
    pub(crate) fn github_proxy() -> String {
        Self::read_app_settings_map()
            .ok()
            .and_then(|map| {
                map.get("github_proxy")
                    .and_then(|value| value.as_str())
                    .map(str::to_string)
            })
            .unwrap_or_default()
    }

    pub(crate) fn set_github_proxy(value: &str) -> Result<(), String> {
        let value = value.trim();
        let lower = value.to_ascii_lowercase();

        if !value.is_empty() && !lower.starts_with("http://") && !lower.starts_with("https://") {
            return Err("GitHub 下载代理需要以 http:// 或 https:// 开头".into());
        }

        let mut map = Self::read_app_settings_map()?;

        if value.is_empty() {
            map.remove("github_proxy");
        } else {
            map.insert(
                "github_proxy".into(),
                serde_json::Value::String(value.to_string()),
            );
        }

        Self::write_app_settings_map(&map)
    }

    pub(crate) fn dir_stats(dir: &Path) -> (u64, u32) {
        let mut bytes = 0;
        let mut files = 0;

        if let Ok(entries) = fs::read_dir(dir) {
            for entry in entries.flatten() {
                if let Ok(metadata) = entry.metadata()
                    && metadata.is_file()
                {
                    bytes += metadata.len();
                    files += 1;
                }
            }
        }

        (bytes, files)
    }

    pub(crate) fn load_settings() -> Result<ScoopSettings, String> {
        let map = Self::read_config_map().unwrap_or_default();
        let app_map = Self::read_app_settings_map().unwrap_or_default();
        let text = |key: &str| {
            map.get(key)
                .and_then(|value| value.as_str())
                .unwrap_or_default()
                .to_string()
        };
        let flag = |key: &str, default: bool| {
            map.get(key)
                .and_then(|value| value.as_bool())
                .unwrap_or(default)
        };

        let home = std::env::var_os("USERPROFILE")
            .map(PathBuf::from)
            .ok_or_else(|| "找不到用户主目录".to_string())?;

        let root = {
            let configured = text("root_path");

            if configured.is_empty() {
                home.join("scoop")
            } else {
                PathBuf::from(configured)
            }
        };
        let global = {
            let configured = text("global_path");

            if configured.is_empty() {
                std::env::var_os("PROGRAMDATA")
                    .map(PathBuf::from)
                    .unwrap_or_else(|| PathBuf::from("C:\\ProgramData"))
                    .join("scoop")
            } else {
                PathBuf::from(configured)
            }
        };
        let cache = {
            let configured = text("cache_path");

            if configured.is_empty() {
                root.join("cache")
            } else {
                PathBuf::from(configured)
            }
        };
        let (cache_bytes, cache_files) = Self::dir_stats(&cache);
        let version = fs::read_to_string(
            root.join("apps")
                .join("scoop")
                .join("current")
                .join("CHANGELOG.md"),
        )
        .ok()
        .and_then(|text| text.lines().next().map(str::to_string))
        .and_then(|line| {
            let start = line.find('[')? + 1;
            let end = line[start..].find(']')? + start;
            Some(line[start..end].trim_start_matches('v').to_string())
        })
        .unwrap_or_default();

        Ok(ScoopSettings {
            version,
            last_update: text("last_update"),
            root_path: root.display().to_string(),
            global_path: global.display().to_string(),
            cache_path: cache.display().to_string(),
            cache_bytes,
            cache_files,
            aria2_enabled: flag("aria2-enabled", true),
            aria2_fallback_enabled: flag("aria2-fallback-enabled", true),
            proxy: text("proxy"),
            github_proxy: app_map
                .get("github_proxy")
                .and_then(|value| value.as_str())
                .unwrap_or_default()
                .to_string(),
            default_architecture: text("default_architecture"),
            use_external_7zip: flag("use_external_7zip", false),
            use_lessmsi: flag("use_lessmsi", false),
            shim: {
                let configured = text("shim");

                if configured.is_empty() {
                    "kiennq".to_string()
                } else {
                    configured
                }
            },
            ignore_running_processes: flag("ignore_running_processes", false),
            scoop_repo: {
                let configured = text("scoop_repo");

                if configured.is_empty() {
                    "https://github.com/ScoopInstaller/Scoop".to_string()
                } else {
                    configured
                }
            },
            scoop_branch: {
                let configured = text("scoop_branch");

                if configured.is_empty() {
                    "master".to_string()
                } else {
                    configured
                }
            },
            update_nightly: flag("update_nightly", false),
            force_update: flag("force_update", false),
            no_junction: flag("no_junction", false),
            use_git_history: flag("use_git_history", true),
            autostash_on_conflict: flag("autostash_on_conflict", false),
            gh_token_set: !text("gh_token").is_empty(),
            debug: flag("debug", false),
        })
    }

    pub(crate) fn clear_cache_impl() -> Result<u64, String> {
        let cache = Self::get_cache_dir()?;
        let mut freed = 0;

        let entries = match fs::read_dir(&cache) {
            Ok(entries) => entries,
            Err(_) => return Ok(0),
        };

        for entry in entries.flatten() {
            let path = entry.path();
            let Ok(metadata) = entry.metadata() else {
                continue;
            };

            if metadata.is_file() && fs::remove_file(&path).is_ok() {
                freed += metadata.len();
            }
        }

        Ok(freed)
    }

    pub(crate) fn export_impl(dir: &str) -> Result<String, String> {
        let mut command = Command::new(
            Self::scoop_shim()
                .ok_or_else(|| "未找到 Scoop（scoop.cmd），请先安装 Scoop".to_string())?,
        );
        command
            .arg("export")
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        Self::quiet(&mut command);

        let output = command
            .output()
            .map_err(|error| format!("执行 scoop export 失败：{error}"))?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();

            return Err(if stderr.is_empty() {
                "scoop export 失败".to_string()
            } else {
                stderr
            });
        }

        let home = std::env::var_os("USERPROFILE")
            .map(PathBuf::from)
            .ok_or_else(|| "找不到用户主目录".to_string())?;
        let desktop = home.join("Desktop");
        let fallback = if desktop.is_dir() { desktop } else { home };
        let chosen = dir.trim();
        let target = if chosen.is_empty() {
            fallback.clone()
        } else {
            PathBuf::from(chosen)
        };
        let target = if target.is_dir() { target } else { fallback };
        let path = target.join(format!("scoop-export-{}.json", Self::timestamp()));

        fs::write(&path, &output.stdout)
            .map_err(|error| format!("写入 {} 失败：{error}", path.display()))?;

        Ok(path.display().to_string())
    }

    /// 选择一个目录（Windows 原生对话框）；取消返回空字符串。
    pub(crate) fn pick_folder_impl() -> Result<String, String> {
        let script = r#"
Add-Type -AssemblyName System.Windows.Forms
$owner = New-Object System.Windows.Forms.Form
$owner.TopMost = $true
$owner.ShowInTaskbar = $false
$dialog = New-Object System.Windows.Forms.FolderBrowserDialog
$dialog.Description = '选择导出目录'
$dialog.ShowNewFolderButton = $true
if ($dialog.ShowDialog($owner) -eq [System.Windows.Forms.DialogResult]::OK) { Write-Output $dialog.SelectedPath }
$owner.Dispose()
"#;

        Self::run_powershell(script)
    }

    /// 选择一个 Scoopfile（Windows 原生对话框）；取消返回空字符串。
    pub(crate) fn pick_file_impl() -> Result<String, String> {
        let script = r#"
Add-Type -AssemblyName System.Windows.Forms
$owner = New-Object System.Windows.Forms.Form
$owner.TopMost = $true
$owner.ShowInTaskbar = $false
$dialog = New-Object System.Windows.Forms.OpenFileDialog
$dialog.Filter = 'Scoopfile (*.json)|*.json|所有文件 (*.*)|*.*'
$dialog.CheckFileExists = $true
$dialog.Multiselect = $false
if ($dialog.ShowDialog($owner) -eq [System.Windows.Forms.DialogResult]::OK) { Write-Output $dialog.FileName }
$owner.Dispose()
"#;

        Self::run_powershell(script)
    }

    fn run_powershell(script: &str) -> Result<String, String> {
        let mut command = Command::new("powershell");
        command
            .args(["-STA", "-NoProfile", "-Command", script])
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        Self::quiet(&mut command);

        let output = command
            .output()
            .map_err(|error| format!("打开系统对话框失败：{error}"))?;

        Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
    }

    /// UTC 时间戳，形如 `20261112-184530`。
    pub(crate) fn timestamp() -> String {
        let seconds = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|elapsed| elapsed.as_secs())
            .unwrap_or_default();
        let days = (seconds / 86_400) as i64;
        let rest = seconds % 86_400;
        let (year, month, day) = Self::civil_from_days(days);

        format!(
            "{year:04}{month:02}{day:02}-{:02}{:02}{:02}",
            rest / 3600,
            (rest % 3600) / 60,
            rest % 60
        )
    }

    /// 从 1970-01-01 起的天数换成 (年, 月, 日)（Howard Hinnant 的算法）。
    pub(crate) fn civil_from_days(days: i64) -> (i64, u32, u32) {
        let z = days + 719_468;
        let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
        let day_of_era = (z - era * 146_097) as u64;
        let year_of_era =
            (day_of_era - day_of_era / 1460 + day_of_era / 36_524 - day_of_era / 146_096) / 365;
        let year = year_of_era as i64 + era * 400;
        let day_of_year = day_of_era - (365 * year_of_era + year_of_era / 4 - year_of_era / 100);
        let mp = (5 * day_of_year + 2) / 153;
        let day = (day_of_year - (153 * mp + 2) / 5 + 1) as u32;
        let month = if mp < 10 { mp + 3 } else { mp - 9 } as u32;

        (if month <= 2 { year + 1 } else { year }, month, day)
    }
}
