//! 调用外部命令（scoop / taskkill）并把输出转成阶段进度。

use std::{
    collections::HashMap,
    fs,
    io::{BufRead, BufReader, Read},
    path::{Path, PathBuf},
    process::{Command, Stdio},
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, Ordering},
        mpsc::{self, Sender},
    },
    thread,
    time::Duration,
};

use crate::{CURRENT_CHILD, CURRENT_JOB, CURRENT_STAGE, ERR_CANCELLED, InstallProgress, Scoop};

/// 登记当前运行的 Scoop 子进程并在作用域结束时自动清空全局状态。
struct ActiveChildGuard;

impl ActiveChildGuard {
    fn register(pid: u32, name: &str) -> Self {
        if let Ok(mut slot) = CURRENT_CHILD.lock() {
            *slot = Some(pid);
        }
        if let Ok(mut job) = CURRENT_JOB.lock() {
            *job = Some(name.to_string());
        }
        if let Ok(mut stage) = CURRENT_STAGE.lock() {
            *stage = Some("preparing".into());
        }
        Self
    }
}

impl Drop for ActiveChildGuard {
    fn drop(&mut self) {
        if let Ok(mut slot) = CURRENT_CHILD.lock() {
            *slot = None;
        }
        if let Ok(mut job) = CURRENT_JOB.lock() {
            *job = None;
        }
        if let Ok(mut stage) = CURRENT_STAGE.lock() {
            *stage = None;
        }
    }
}

impl Scoop {
    pub(crate) fn run(program: &str, cwd: Option<&Path>, args: &[&str]) -> Result<(), String> {
        let display = program.trim_end_matches(".cmd");
        let label = if args.is_empty() {
            display.to_string()
        } else {
            format!("{display} {}", args.join(" "))
        };

        let mut command = Command::new(program);

        if let Some(cwd) = cwd {
            command.current_dir(cwd);
        }

        command
            .args(args)
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        Self::quiet(&mut command);

        let output = command
            .output()
            .map_err(|error| format!("执行 {label} 失败：{error}"))?;

        if output.status.success() {
            return Ok(());
        }

        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();

        Err(format!(
            "{label} 失败：{}",
            if stderr.is_empty() { stdout } else { stderr }
        ))
    }

    pub(crate) fn run_scoop(args: &[&str]) -> Result<(), String> {
        let program = Self::scoop_shim()
            .ok_or_else(|| "未找到 Scoop（scoop.cmd），请先安装 Scoop".to_string())?;
        let program = program.to_string_lossy().to_string();
        Self::run(&program, None, args)
    }

    /// 找到可执行的 `scoop.cmd`：PATH 优先，再看默认/自定义 Scoop 根目录的 shims。
    pub(crate) fn scoop_shim() -> Option<PathBuf> {
        let mut where_command = Command::new("where");
        where_command
            .arg("scoop")
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::null());
        Self::quiet(&mut where_command);

        if let Ok(output) = where_command.output()
            && output.status.success()
        {
            for line in String::from_utf8_lossy(&output.stdout).lines() {
                let line = line.trim();

                if line.to_ascii_lowercase().ends_with("scoop.cmd") {
                    let path = PathBuf::from(line);

                    if path.is_file() {
                        return Some(path);
                    }
                }
            }
        }

        let mut roots = Vec::new();

        if let Some(root) = std::env::var_os("SCOOP") {
            roots.push(PathBuf::from(root));
        }

        if let Some(home) = std::env::var_os("USERPROFILE") {
            roots.push(PathBuf::from(home).join("scoop"));
        }

        if let Ok(config) = Self::get_scoop_config() {
            roots.push(config.root_path);
        }

        roots
            .into_iter()
            .map(|root| root.join("shims").join("scoop.cmd"))
            .find(|path| path.is_file())
    }

    /// 子进程不弹控制台窗口。
    pub(crate) fn quiet(command: &mut Command) {
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;

            const CREATE_NO_WINDOW: u32 = 0x08000000;
            command.creation_flags(CREATE_NO_WINDOW);
        }
    }

    /// 结束整个子进程树（`scoop.cmd` 会再拉起 PowerShell）。
    pub(crate) fn kill_tree(pid: u32) {
        let mut command = Command::new("taskkill");
        command
            .args(["/PID", &pid.to_string(), "/T", "/F"])
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null());
        Self::quiet(&mut command);
        let _ = command.status();
    }

    /// 清理取消/失败留下的半成品：没有清单的版本目录，以及这个包的下载残片。
    pub(crate) fn cleanup_partial(name: &str) {
        let Ok(config) = Self::get_scoop_config() else {
            return;
        };

        let app_dir = config.root_path.join("apps").join(name);
        let current_target = fs::canonicalize(app_dir.join("current")).ok();

        if let Ok(entries) = fs::read_dir(&app_dir) {
            for entry in entries.flatten() {
                let path = entry.path();
                let Ok(metadata) = entry.metadata() else {
                    continue;
                };

                if !metadata.is_dir() {
                    continue;
                }

                // `current` 本身不是版本目录。
                if path.file_name().is_some_and(|file| file == "current") {
                    continue;
                }

                if current_target
                    .as_ref()
                    .is_some_and(|target| fs::canonicalize(&path).ok().as_ref() == Some(target))
                {
                    continue;
                }

                // 装好的版本一定有清单；没有的就是装到一半的。
                if Self::has_manifest_file(&path) {
                    continue;
                }

                let _ = fs::remove_dir_all(&path);
            }
        }

        let prefix = format!("{name}#");

        if let Ok(cache) = Self::get_cache_dir()
            && let Ok(entries) = fs::read_dir(&cache)
        {
            for entry in entries.flatten() {
                let file = entry.file_name().to_string_lossy().to_string();

                if file.starts_with(&prefix) && file.ends_with(".download") {
                    let _ = fs::remove_file(entry.path());
                }
            }
        }
    }

    /// 更新成功后删除旧版本目录（Scoop 自己只会在 `scoop cleanup` 里做）。
    pub(crate) fn cleanup_old_versions(name: &str) {
        let Ok(config) = Self::get_scoop_config() else {
            return;
        };

        let app_dir = config.root_path.join("apps").join(name);

        // `current` 不在（没装好）时不要动任何目录。
        let Ok(current) = fs::canonicalize(app_dir.join("current")) else {
            return;
        };

        let Ok(entries) = fs::read_dir(&app_dir) else {
            return;
        };

        for entry in entries.flatten() {
            let path = entry.path();

            if !entry.metadata().map(|meta| meta.is_dir()).unwrap_or(false) {
                continue;
            }

            if path.file_name().is_some_and(|file| file == "current") {
                continue;
            }

            if fs::canonicalize(&path).ok().as_ref() == Some(&current) {
                continue;
            }

            let _ = fs::remove_dir_all(&path);
        }
    }

    pub(crate) fn install_app(
        name: &str,
        flag: &Arc<AtomicBool>,
        progress: Sender<InstallProgress>,
    ) -> Result<(), String> {
        Self::run_scoop_with_progress(&["install", name], name, flag, progress)
    }

    pub(crate) fn uninstall_app(name: &str) -> Result<(), String> {
        Self::run_scoop(&["uninstall", name])?;

        if Self::is_app_installed(name) {
            return Err(format!("scoop uninstall {name} 返回成功，但应用仍然存在"));
        }

        Ok(())
    }

    pub(crate) fn update_app(
        name: &str,
        flag: &Arc<AtomicBool>,
        progress: Sender<InstallProgress>,
    ) -> Result<(), String> {
        Self::run_scoop_with_progress(&["update", name], name, flag, progress)
    }

    /// Scoop 的交互式百分比只在输出连接到终端时输出；NSH 捕获子进程输出，
    /// 所以改为解析它重定向时打印的 `Downloading <url> (<size>)` 拿到总量，
    /// 再用 Scoop 自己 cache 文件的大小算百分比。
    pub(crate) fn run_scoop_with_progress(
        args: &[&str],
        name: &str,
        flag: &Arc<AtomicBool>,
        progress: Sender<InstallProgress>,
    ) -> Result<(), String> {
        let label = format!("scoop {}", args.join(" "));
        let cache_dir = Self::get_cache_dir().ok();
        let initial_sizes = cache_dir
            .as_deref()
            .map(Self::cache_file_sizes)
            .unwrap_or_default();
        // 启动时的 cache 快照，之后每轮更新，用来判断“谁在增长”。
        let mut observed = initial_sizes;
        let mut current_stage = "preparing".to_string();
        let started = std::time::SystemTime::now();
        // 下载卡住（网络没有数据）时，界面要显示“等待数据”，而不是一直 0%。
        let mut last_bytes = 0_u64;
        let mut last_growth = std::time::Instant::now();
        let (stage_sender, stage_receiver) = mpsc::channel::<(String, String)>();
        // Scoop 打印的下载总量（Content-Length），由输出读取线程写入、监视循环读取。
        let total_bytes = Arc::new(Mutex::new(None::<u64>));

        let mut command = Command::new(
            Self::scoop_shim()
                .ok_or_else(|| "未找到 Scoop（scoop.cmd），请先安装 Scoop".to_string())?,
        );
        command
            .args(args)
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        Self::quiet(&mut command);

        let mut child = command
            .spawn()
            .map_err(|error| format!("执行 {label} 失败：{error}"))?;
        let _active_guard = ActiveChildGuard::register(child.id(), name);

        let stdout_thread = child.stdout.take().map(|stdout| {
            Self::read_command_output(stdout, stage_sender.clone(), total_bytes.clone())
        });
        let stderr_thread = child.stderr.take().map(|stderr| {
            Self::read_command_output(stderr, stage_sender.clone(), total_bytes.clone())
        });
        let _ = progress.send(InstallProgress {
            stage: "preparing".into(),
            detail: "正在读取 Scoop 清单并准备安装…".into(),
            ..InstallProgress::default()
        });

        let status = loop {
            for (stage, detail) in stage_receiver.try_iter() {
                current_stage = stage.clone();
                if let Ok(mut current) = CURRENT_STAGE.lock() {
                    *current = Some(stage.clone());
                }
                let _ = progress.send(InstallProgress {
                    stage,
                    detail,
                    ..InstallProgress::default()
                });
            }

            // 只在下载阶段观察 cache，避免解压/收尾时继续报“下载中”。
            if current_stage == "downloading"
                && let Some(cache_dir) = cache_dir.as_deref()
            {
                let total = total_bytes.lock().ok().and_then(|total| *total);
                Self::report_cache_download_progress(
                    cache_dir,
                    &mut observed,
                    started,
                    total,
                    &mut last_bytes,
                    &mut last_growth,
                    &progress,
                );
            }

            match child.try_wait() {
                Ok(Some(status)) => break status,
                Ok(None) => thread::sleep(Duration::from_millis(180)),
                Err(error) => {
                    let _ = child.kill();
                    let _ = child.wait();
                    return Err(format!("等待 {label} 结束失败：{error}"));
                }
            }
        };

        for (stage, detail) in stage_receiver.try_iter() {
            let _ = progress.send(InstallProgress {
                stage,
                detail,
                ..InstallProgress::default()
            });
        }

        let stdout = stdout_thread
            .and_then(|handle| handle.join().ok())
            .unwrap_or_default();
        let stderr = stderr_thread
            .and_then(|handle| handle.join().ok())
            .unwrap_or_default();

        drop(_active_guard);

        if flag.load(Ordering::Relaxed) {
            Self::cleanup_partial(name);
            let _ = progress.send(InstallProgress {
                stage: "cancelled".into(),
                detail: ERR_CANCELLED.into(),
                ..InstallProgress::default()
            });
            return Err(ERR_CANCELLED.into());
        }

        Self::finalize_scoop_process(status, name, args, &label, &stdout, &stderr, &progress)
    }

    /// 下载阶段轮询缓存目录：上报实时下载字节与百分比，或在长时间无新数据时报告等待状态。
    fn report_cache_download_progress(
        cache_dir: &Path,
        observed: &mut HashMap<PathBuf, u64>,
        started: std::time::SystemTime,
        total: Option<u64>,
        last_bytes: &mut u64,
        last_growth: &mut std::time::Instant,
        progress: &Sender<InstallProgress>,
    ) {
        match Self::active_download(cache_dir, observed, started) {
            Some((file, bytes)) => {
                if bytes > *last_bytes {
                    *last_bytes = bytes;
                    *last_growth = std::time::Instant::now();
                }

                // 8 秒没有新数据：说明网络卡住了，别再显示一个假的 0%。
                if last_growth.elapsed() > Duration::from_secs(8) {
                    let _ = progress.send(InstallProgress {
                        stage: "waiting".into(),
                        detail: format!("已收到 {}，等待网络数据…", Self::format_bytes(bytes)),
                        file: Some(file),
                        bytes: Some(bytes),
                        total_bytes: total,
                        ..InstallProgress::default()
                    });
                } else {
                    let percent = total
                        .filter(|total| *total > 0)
                        .map(|total| (bytes as f64 / total as f64 * 100.0).clamp(0.0, 100.0));
                    let detail = match (total, percent) {
                        (Some(total), Some(percent)) => format!(
                            "{} / {} ({percent:.0}%)",
                            Self::format_bytes(bytes),
                            Self::format_bytes(total)
                        ),
                        _ => format!("已下载 {}", Self::format_bytes(bytes)),
                    };
                    let _ = progress.send(InstallProgress {
                        stage: "downloading".into(),
                        detail,
                        file: Some(file),
                        bytes: Some(bytes),
                        total_bytes: total,
                        percent,
                    });
                }
            }
            None => {
                // 进入下载阶段几秒还没看到文件：同样是在等网络。
                if last_growth.elapsed() > Duration::from_secs(3) {
                    let _ = progress.send(InstallProgress {
                        stage: "waiting".into(),
                        detail: "等待下载开始…".into(),
                        total_bytes: total,
                        ..InstallProgress::default()
                    });
                }
            }
        }
    }

    /// 子进程退出后：核验真实安装结果、清理旧版本或残片，并发送最终状态。
    fn finalize_scoop_process(
        status: std::process::ExitStatus,
        name: &str,
        args: &[&str],
        label: &str,
        stdout: &str,
        stderr: &str,
        progress: &Sender<InstallProgress>,
    ) -> Result<(), String> {
        let diagnostic = || {
            let raw = if stderr.trim().is_empty() {
                stdout
            } else {
                stderr
            };
            Self::tail_text(raw, 4000)
        };

        if status.success() {
            if !Self::verify_scoop_result(name, args) {
                Self::cleanup_partial(name);
                return Err(format!(
                    "{label} 返回成功，但 {name} 没有被正确安装或更新。\n{}",
                    diagnostic()
                ));
            }

            // Scoop 更新后不会自己删旧版本，这里清掉，避免版本目录越积越多。
            Self::cleanup_old_versions(name);
            let _ = progress.send(InstallProgress {
                stage: "completed".into(),
                detail: "操作已完成".into(),
                ..InstallProgress::default()
            });
            Ok(())
        } else {
            Self::cleanup_partial(name);
            let diag = diagnostic();
            let detail = if diag.is_empty() {
                format!("{label} 失败（退出码 {:?}）", status.code())
            } else {
                format!("{label} 失败：{diag}")
            };
            let _ = progress.send(InstallProgress {
                stage: "failed".into(),
                detail: detail.clone(),
                ..InstallProgress::default()
            });
            Err(detail)
        }
    }

    pub(crate) fn read_command_output<R: Read + Send + 'static>(
        output: R,
        stages: Sender<(String, String)>,
        total_bytes: Arc<Mutex<Option<u64>>>,
    ) -> thread::JoinHandle<String> {
        thread::spawn(move || {
            let mut reader = BufReader::new(output);
            let mut bytes = Vec::new();
            let mut text = String::new();
            loop {
                bytes.clear();
                match reader.read_until(b'\n', &mut bytes) {
                    Ok(0) | Err(_) => break,
                    Ok(_) => {
                        let line = String::from_utf8_lossy(&bytes);
                        text.push_str(&line);
                        if let Some(total) = Self::download_total(&line)
                            && let Ok(mut slot) = total_bytes.lock()
                        {
                            *slot = Some(total);
                        }
                        if let Some(event) = Self::stage_from_output(&line) {
                            let _ = stages.send(event);
                        }
                    }
                }
            }
            text
        })
    }

    /// `Downloading <url> (<size>)...`：Scoop 的重定向输出里这一行的括号就是
    /// HTTP 响应头的 `Content-Length`（`filesize` 格式化过）。
    pub(crate) fn download_total(line: &str) -> Option<u64> {
        let lower = line.to_lowercase();
        if !lower.contains("downloading ") {
            return None;
        }
        let open = line.rfind('(')?;
        let close = line[open..].find(')')? + open;
        let text = line[open + 1..close].trim();
        let mut parts = text.split_whitespace();
        let number = parts.next()?.trim();
        let unit = parts.next()?.to_uppercase();
        // `{0:n1}` 依区域设置可能用逗号做小数点，也可能用逗号做千位分隔。
        let value = if number.contains(',') && number.contains('.') {
            number.replace(',', "").parse::<f64>().ok()?
        } else {
            number.replace(',', ".").parse::<f64>().ok()?
        };
        let factor = match unit.as_str() {
            "B" => 1.0,
            "KB" => 1024.0,
            "MB" => 1024.0 * 1024.0,
            "GB" => 1024.0 * 1024.0 * 1024.0,
            _ => return None,
        };
        Some((value * factor).round() as u64)
    }

    pub(crate) fn stage_from_output(line: &str) -> Option<(String, String)> {
        let clean = line
            .chars()
            .filter(|character| !character.is_control() || *character == '\t')
            .collect::<String>()
            .trim()
            .to_string();
        let lower = clean.to_lowercase();
        let (stage, detail) = if lower.contains("installing '") {
            ("preparing", "已解析清单，正在准备包文件")
        } else if lower.contains("downloading ") || lower.contains("starting download") {
            ("downloading", "正在下载包文件…")
        } else if lower.contains("checking hash") {
            ("verifying", "正在校验下载文件…")
        } else if lower.contains("extracting ") {
            ("extracting", "正在解压文件…")
        } else if lower.contains("linking ")
            || lower.contains("creating shim")
            || lower.contains("running ")
            || lower.contains("persisting ")
            || lower.contains("installed successfully")
        {
            ("finalizing", "正在配置快捷方式和环境…")
        } else {
            return None;
        };
        Some((stage.into(), detail.into()))
    }

    pub(crate) fn format_bytes(bytes: u64) -> String {
        const UNITS: [&str; 4] = ["B", "KB", "MB", "GB"];
        let mut amount = bytes as f64;
        let mut unit = 0;
        while amount >= 1024.0 && unit < UNITS.len() - 1 {
            amount /= 1024.0;
            unit += 1;
        }
        if unit == 0 {
            format!("{bytes} B")
        } else {
            format!("{amount:.1} {}", UNITS[unit])
        }
    }

    pub(crate) fn tail_text(text: &str, max_chars: usize) -> String {
        let trimmed = text.trim();
        let chars = trimmed.chars().count();
        if chars <= max_chars {
            return trimmed.to_string();
        }
        let tail = trimmed.chars().skip(chars - max_chars).collect::<String>();
        format!("…{tail}")
    }

    /// `scoop bucket add <name> [<repo>]`。不带 repo 时 Scoop 会去 known buckets 里找。
    pub(crate) fn add_bucket_impl(name: &str, repo: Option<&str>) -> Result<(), String> {
        let mut args = vec!["bucket", "add", name];

        if let Some(repo) = repo.filter(|repo| !repo.trim().is_empty()) {
            args.push(repo.trim());
        }

        Self::run_scoop(&args)
    }

    /// `scoop bucket rm <name>`
    pub(crate) fn remove_bucket_impl(name: &str) -> Result<(), String> {
        Self::run_scoop(&["bucket", "rm", name])
    }

    /// 改 bucket 的 git 远端地址。
    pub(crate) fn set_bucket_source_impl(name: &str, url: &str) -> Result<(), String> {
        let config = Self::get_scoop_config()?;
        let repo = config.root_path.join("buckets").join(name);
        Self::run("git", Some(&repo), &["remote", "set-url", "origin", url])
    }
}
