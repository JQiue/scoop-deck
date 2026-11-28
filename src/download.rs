//! 下载器：把安装包直接取到 Scoop 的缓存目录，可并行、可续传。

use std::{
    collections::HashMap,
    fs,
    io::{Read, Write},
    path::{Path, PathBuf},
    process::{Command, Stdio},
    sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
        mpsc::Sender,
    },
    thread,
    time::Duration,
};

use sha2::{Digest, Sha256};

use crate::{ERR_CANCELLED, InstallProgress, Scoop};

impl Scoop {
    pub(crate) fn find_manifest(name: &str) -> Result<serde_json::Value, String> {
        Self::find_manifest_full(name).map(|(_, _, manifest)| manifest)
    }

    /// 找清单，并带回它所属的 bucket（URL 安装时为清单地址）与文件路径。
    pub(crate) fn find_manifest_full(
        name: &str,
    ) -> Result<(String, PathBuf, serde_json::Value), String> {
        let config = Self::get_scoop_config()?;
        let current = config.root_path.join("apps").join(name).join("current");
        let install = Self::read_install_in(&current);
        let installed_manifest = Self::find_manifest_path(&current);

        let bucket = install.bucket.clone().unwrap_or_default();
        let url = install.url.clone().unwrap_or_default();

        // URL 清单安装：远端清单才是最新版本，更新检查、下载大小和详情都应以它为准。
        // 网络不可用时退回本机已安装的清单，至少页面还能打开。
        if bucket.trim().is_empty() && Self::is_http_url(&url) {
            if let Some(manifest) = Self::fetch_manifest_from_url(&url) {
                return Ok((
                    url.clone(),
                    installed_manifest
                        .clone()
                        .unwrap_or_else(|| PathBuf::from(&url)),
                    manifest,
                ));
            }

            if let Some(installed) = installed_manifest.clone() {
                return Ok((url, installed.clone(), Self::read_json(&installed)?));
            }
        }

        let buckets_dir = config.root_path.join("buckets");
        let mut buckets = fs::read_dir(&buckets_dir)
            .map(|entries| {
                entries
                    .flatten()
                    .map(|entry| entry.path())
                    .collect::<Vec<_>>()
            })
            .unwrap_or_default();
        buckets.sort();

        for bucket in buckets {
            let path = bucket.join("bucket").join(format!("{name}.json"));

            if path.is_file() {
                let bucket_name = bucket
                    .file_name()
                    .map(|name| name.to_string_lossy().to_string())
                    .unwrap_or_default();

                return Ok((bucket_name, path.clone(), Self::read_json(&path)?));
            }
        }

        if let Some(installed) = installed_manifest {
            let source = install.bucket.or(install.url).unwrap_or_default();

            return Ok((source, installed.clone(), Self::read_json(&installed)?));
        }

        Err(format!("找不到 {name} 的清单"))
    }

    /// 用户配置的 GitHub 代理前缀；确保以 `/` 结尾，无效时返回空字符串。
    pub(crate) fn github_proxy_prefix() -> String {
        let proxy = Self::github_proxy();
        let proxy = proxy.trim().trim_end_matches('/');

        if proxy.is_empty() || !Self::is_http_url(proxy) {
            return String::new();
        }

        format!("{proxy}/")
    }

    /// 只代理 GitHub 的文件下载与清单地址。签名过的
    /// `objects.githubusercontent.com` / `release-assets.githubusercontent.com` 保持直连。
    pub(crate) fn is_github_url(url: &str) -> bool {
        let lower = url.trim().to_ascii_lowercase();
        let Some((_, rest)) = lower.split_once("://") else {
            return false;
        };
        let host = rest
            .split(|c| c == '/' || c == '?' || c == '#')
            .next()
            .unwrap_or_default();
        let host = host.rsplit('@').next().unwrap_or(host);
        let host = host.split(':').next().unwrap_or(host);
        let host = host.strip_prefix("www.").unwrap_or(host);

        matches!(
            host,
            "github.com" | "raw.githubusercontent.com" | "gist.githubusercontent.com"
        )
    }

    /// 给 GitHub 地址套上代理前缀；未配置或不是 GitHub 地址时原样返回。
    pub(crate) fn apply_github_proxy(url: &str) -> String {
        let prefix = Self::github_proxy_prefix();

        if prefix.is_empty() || !Self::is_github_url(url) || url.starts_with(&prefix) {
            return url.to_string();
        }

        format!("{prefix}{url}")
    }

    /// 取远端清单（`scoop install <url>` 的 url 字段）。超时或网络错误时返回 `None`，
    /// 让列表退回 bucket / 本机清单，不因为一次网络失败让整个安装列表报错。
    pub(crate) fn fetch_manifest_from_url(url: &str) -> Option<serde_json::Value> {
        let url = url.trim();

        if !Self::is_http_url(url) {
            return None;
        }

        let proxied = Self::apply_github_proxy(url);
        let manifest = Self::fetch_manifest_request(&proxied);

        if manifest.is_some() || proxied == url {
            return manifest;
        }

        // 代理挂了不影响版本检查：再直连试一次。
        Self::fetch_manifest_request(url)
    }

    fn fetch_manifest_request(url: &str) -> Option<serde_json::Value> {
        let agent: ureq::Agent = ureq::Agent::new_with_config(
            ureq::Agent::config_builder()
                .http_status_as_error(false)
                .max_redirects(10)
                .timeout_connect(Some(Duration::from_secs(8)))
                .timeout_per_read(Some(Duration::from_secs(12)))
                .build(),
        );
        let mut response = agent
            .get(url)
            .header("user-agent", "Scoop/1.0 (ScoopDeck)")
            .call()
            .ok()?;

        if !response.status().is_success() {
            return None;
        }

        let body = response.body_mut().read_to_string().ok()?;
        serde_json::from_str(&body).ok()
    }

    /// 预估算下载大小：清单里的下载地址 + 每个地址的 `Content-Length`。
    pub(crate) fn estimate_download_size(name: &str) -> Result<u64, String> {
        let manifest = Self::find_manifest(name)?;
        let version = manifest
            .get("version")
            .and_then(|version| version.as_str())
            .unwrap_or_default();
        let mut urls = Vec::new();
        Self::manifest_urls(&manifest, version, &mut urls);

        if urls.is_empty() {
            return Ok(0);
        }

        Ok(Self::head_content_length(&urls))
    }

    /// 从 `architecture` 字段里挑出当前平台优先匹配的架构节点（必须含 `url`）。
    fn select_arch_node(manifest: &serde_json::Value) -> Option<&serde_json::Value> {
        let architecture = manifest.get("architecture")?;
        let preferred = if cfg!(target_arch = "aarch64") {
            ["arm64", "64bit", "32bit"]
        } else {
            ["64bit", "32bit", "arm64"]
        };

        preferred
            .into_iter()
            .filter_map(|key| architecture.get(key))
            .find(|node| node.get("url").is_some())
    }

    /// 清单里的下载地址：优先当前架构，其次顶层 `url`；保留 `#/…` 片段。
    pub(crate) fn manifest_urls(
        manifest: &serde_json::Value,
        version: &str,
        urls: &mut Vec<String>,
    ) {
        if let Some(url) = Self::select_arch_node(manifest).and_then(|node| node.get("url")) {
            Self::collect_urls(url, version, urls);
        }

        if urls.is_empty()
            && let Some(url) = manifest.get("url")
        {
            Self::collect_urls(url, version, urls);
        }
    }

    pub(crate) fn collect_urls(value: &serde_json::Value, version: &str, urls: &mut Vec<String>) {
        match value {
            serde_json::Value::String(text) => {
                // 保留 `#/…` 片段：Scoop 算缓存文件名时用的是带片段的原始地址。
                let url = text.replace("$version", version);

                if url.starts_with("http") {
                    urls.push(url);
                }
            }
            serde_json::Value::Array(items) => {
                for item in items {
                    Self::collect_urls(item, version, urls);
                }
            }
            serde_json::Value::Object(object) => {
                if let Some(url) = object.get("url") {
                    Self::collect_urls(url, version, urls);
                }
            }
            _ => {}
        }
    }

    /// 依次对每个地址发 HEAD 请求，把 `Content-Length` 相加；拿不到就跳过。
    pub(crate) fn head_content_length(urls: &[String]) -> u64 {
        let list = urls
            .iter()
            .map(|url| {
                format!(
                    "'{}'",
                    Self::apply_github_proxy(Self::strip_fragment(url)).replace('\'', "''")
                )
            })
            .collect::<Vec<_>>()
            .join(", ");
        let script = format!(
            "$total = 0; foreach ($u in @({list})) {{ \
                try {{ \
                    $r = [Net.HttpWebRequest]::Create($u); \
                    $r.Method = 'HEAD'; \
                    $r.AllowAutoRedirect = $true; \
                    $r.UserAgent = 'Scoop/1.0'; \
                    $r.Timeout = 15000; \
                    $res = $r.GetResponse(); \
                    if ($res.ContentLength -gt 0) {{ $total += $res.ContentLength }}; \
                    $res.Close() \
                }} catch {{ }} \
            }}; Write-Output $total"
        );

        let mut command = Command::new("powershell");
        command
            .args(["-NoProfile", "-NonInteractive", "-Command", &script])
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::null());
        Self::quiet(&mut command);

        command
            .output()
            .ok()
            .map(|output| {
                String::from_utf8_lossy(&output.stdout)
                    .trim()
                    .parse::<u64>()
                    .unwrap_or(0)
            })
            .unwrap_or(0)
    }

    pub(crate) fn prefetch_impl(
        name: &str,
        flag: &Arc<AtomicBool>,
        progress: &Sender<InstallProgress>,
    ) -> Result<usize, String> {
        let manifest = Self::find_manifest(name)?;
        Self::prefetch_manifest(name, &manifest, flag, progress)
    }

    /// 从一个清单 URL 预下载：先取远端清单，再用清单里的地址填 Scoop cache。
    pub(crate) fn prefetch_url_impl(
        url: &str,
        name: &str,
        flag: &Arc<AtomicBool>,
        progress: &Sender<InstallProgress>,
    ) -> Result<usize, String> {
        let manifest = Self::fetch_manifest_from_url(url)
            .ok_or_else(|| format!("无法读取 {url} 的清单"))?;
        Self::prefetch_manifest(name, &manifest, flag, progress)
    }

    fn prefetch_manifest(
        app: &str,
        manifest: &serde_json::Value,
        flag: &Arc<AtomicBool>,
        progress: &Sender<InstallProgress>,
    ) -> Result<usize, String> {
        let version = manifest
            .get("version")
            .and_then(|version| version.as_str())
            .unwrap_or_default()
            .to_string();
        let mut urls = Vec::new();
        Self::manifest_urls(manifest, &version, &mut urls);

        if urls.is_empty() {
            return Err("清单里没有可直接下载的地址".into());
        }

        let cache_dir = Self::get_cache_dir()?;
        fs::create_dir_all(&cache_dir).map_err(|error| format!("创建缓存目录失败：{error}"))?;
        let mut reused = 0;
        let total = urls.len();

        for (index, url) in urls.iter().enumerate() {
            if flag.load(Ordering::Relaxed) {
                Self::cleanup_partial(app);
                return Err(ERR_CANCELLED.into());
            }

            let key = Self::cache_key(app, &version, url);
            let target = cache_dir.join(&key);

            if target.metadata().is_ok_and(|metadata| metadata.len() > 0) {
                reused += 1;
                continue;
            }

            let expected = Self::expected_hash(manifest, index, total);
            let part = cache_dir.join(format!("{key}.download"));

            if let Err(error) = Self::download_to(url, &part, flag, progress) {
                // 用户取消时连残片一起清掉；普通失败保留，下次可续传。
                if error == ERR_CANCELLED {
                    Self::cleanup_partial(app);
                }

                return Err(error);
            }

            // 先按清单里的 hash 自检；不匹配就删掉重下一次，避免把坏文件交给 Scoop。
            if let Some(expected) = &expected
                && !Self::verify_hash(&part, expected)
            {
                let _ = fs::remove_file(&part);

                if let Err(error) = Self::download_to(url, &part, flag, progress) {
                    if error == ERR_CANCELLED {
                        Self::cleanup_partial(app);
                    }

                    return Err(error);
                }

                if !Self::verify_hash(&part, expected) {
                    let _ = fs::remove_file(&part);
                    return Err(format!("{key} 的哈希与清单不符"));
                }
            }

            fs::rename(&part, &target)
                .map_err(|error| format!("把下载结果放进缓存失败：{error}"))?;
        }

        Ok(reused)
    }

    /// 清单里与第 `index` 个地址对应的 sha256；格式不认识就返回 None（不校验）。
    pub(crate) fn expected_hash(
        manifest: &serde_json::Value,
        index: usize,
        total: usize,
    ) -> Option<String> {
        let mut hashes = Vec::new();
        let mut from_architecture = false;

        if let Some(hash) = Self::select_arch_node(manifest).and_then(|node| node.get("hash")) {
            Self::collect_hashes(hash, &mut hashes);
            from_architecture = true;
        }

        if !from_architecture && let Some(hash) = manifest.get("hash") {
            Self::collect_hashes(hash, &mut hashes);
        }

        if hashes.len() == total {
            hashes[index].clone()
        } else if hashes.len() == 1 && total == 1 {
            hashes[0].clone()
        } else {
            None
        }
    }

    fn collect_hashes(value: &serde_json::Value, hashes: &mut Vec<Option<String>>) {
        match value {
            serde_json::Value::String(text) => {
                hashes.push(Self::normalize_hash(text));
            }
            serde_json::Value::Array(items) => {
                for item in items {
                    Self::collect_hashes(item, hashes);
                }
            }
            _ => hashes.push(None),
        }
    }

    /// 只认 sha256（可带 `sha256:` 前缀）；其它算法或长度不对就不校验。
    fn normalize_hash(text: &str) -> Option<String> {
        let hash = text.trim().to_ascii_lowercase();
        let hash = hash.strip_prefix("sha256:").unwrap_or(&hash);

        (hash.len() == 64 && hash.chars().all(|c| c.is_ascii_hexdigit())).then(|| hash.to_string())
    }

    fn verify_hash(path: &Path, expected: &str) -> bool {
        let Ok(mut file) = fs::File::open(path) else {
            return false;
        };

        let mut hasher = Sha256::new();
        let mut buffer = vec![0_u8; 64 * 1024];

        loop {
            match file.read(&mut buffer) {
                Ok(0) => break,
                Ok(read) => hasher.update(&buffer[..read]),
                Err(_) => return false,
            }
        }

        let actual = hasher
            .finalize()
            .iter()
            .map(|byte| format!("{byte:02x}"))
            .collect::<String>();

        actual == expected
    }

    /// Scoop 的缓存文件名：`<app>#<version>#<sha256(url) 前 7 位><扩展名>`。
    pub(crate) fn cache_key(app: &str, version: &str, url: &str) -> String {
        let mut hasher = Sha256::new();
        hasher.update(url.as_bytes());
        let digest = hasher.finalize();
        let sha = digest
            .iter()
            .flat_map(|byte| [format!("{byte:02x}")])
            .collect::<String>();
        let sha = &sha[..7];
        let extension = Self::url_extension(url);

        format!("{app}#{version}#{sha}{extension}")
    }

    /// 和 .NET 的 `[IO.Path]::GetExtension` 对齐：扩展名里不能含有路径分隔符。
    pub(crate) fn url_extension(url: &str) -> String {
        let Some(dot) = url.rfind('.') else {
            return String::new();
        };
        let extension = &url[dot..];

        if extension.contains('/') || extension.contains('\\') {
            String::new()
        } else {
            extension.to_string()
        }
    }

    pub(crate) fn strip_fragment(url: &str) -> &str {
        url.split('#').next().unwrap_or(url)
    }

    /// 下载到 `part`，支持断点续传（Range）和最多 3 次重试。
    pub(crate) fn download_to(
        url: &str,
        part: &Path,
        flag: &Arc<AtomicBool>,
        progress: &Sender<InstallProgress>,
    ) -> Result<(), String> {
        const ATTEMPTS: u32 = 3;
        let mut last_error = String::new();

        for attempt in 1..=ATTEMPTS {
            match Self::download_once(url, part, flag, progress) {
                Ok(()) => return Ok(()),
                Err(error) => {
                    if error == ERR_CANCELLED {
                        return Err(error);
                    }

                    last_error = error;

                    if attempt < ATTEMPTS {
                        let _ = progress.send(InstallProgress {
                            stage: "waiting".into(),
                            detail: format!("下载中断，正在重试（{attempt}/{ATTEMPTS}）…"),
                            ..InstallProgress::default()
                        });
                        thread::sleep(Duration::from_secs(2));
                    }
                }
            }
        }

        Err(last_error)
    }

    pub(crate) fn download_once(
        url: &str,
        part: &Path,
        flag: &Arc<AtomicBool>,
        progress: &Sender<InstallProgress>,
    ) -> Result<(), String> {
        let original = Self::strip_fragment(url);
        let url = Self::apply_github_proxy(original);
        let agent: ureq::Agent = ureq::Agent::new_with_config(
            ureq::Agent::config_builder()
                .http_status_as_error(false)
                .max_redirects(10)
                .timeout_connect(Some(Duration::from_secs(20)))
                // 30 秒收不到任何数据就判定这次连接死了，交给重试去续传。
                .timeout_per_read(Some(Duration::from_secs(30)))
                .build(),
        );

        let mut existing = part.metadata().map(|metadata| metadata.len()).unwrap_or(0);
        let mut request = agent
            .get(url.as_str())
            .header("user-agent", "Scoop/1.0 (ScoopDeck)");

        if let Some(referer) = original.rsplit_once('/').map(|(base, _)| base) {
            request = request.header("referer", referer);
        }

        if existing > 0 {
            request = request.header("range", format!("bytes={existing}-"));
        }

        let mut response = request
            .call()
            .map_err(|error| format!("连接失败：{error}"))?;
        let status = response.status().as_u16();

        let total = if status == 206 {
            response
                .headers()
                .get("content-range")
                .and_then(|value| value.to_str().ok())
                .and_then(|value| value.rsplit('/').next()?.parse::<u64>().ok())
        } else {
            response
                .headers()
                .get("content-length")
                .and_then(|value| value.to_str().ok())
                .and_then(|value| value.parse::<u64>().ok())
        };

        if status == 416 {
            // 续传点超过文件长度：丢掉残片，下一轮从头下载。
            let _ = fs::remove_file(part);
            return Err("续传位置无效，重新下载".into());
        }

        if status != 200 && status != 206 {
            return Err(format!("HTTP {status}"));
        }

        let append = status == 206 && existing > 0;

        if !append {
            existing = 0;
        }

        let mut options = fs::OpenOptions::new();
        options.create(true).write(true);

        if append {
            options.append(true);
        } else {
            options.truncate(true);
        }

        let mut file = options
            .open(part)
            .map_err(|error| format!("打开缓存文件失败：{error}"))?;
        let mut reader = response.body_mut().with_config().limit(u64::MAX).reader();
        let mut buffer = vec![0_u8; 64 * 1024];
        let mut written = existing;
        let mut reported = std::time::Instant::now() - Duration::from_secs(1);

        loop {
            if flag.load(Ordering::Relaxed) {
                return Err(ERR_CANCELLED.into());
            }

            let read = reader
                .read(&mut buffer)
                .map_err(|error| format!("读取数据失败：{error}"))?;

            if read == 0 {
                break;
            }

            file.write_all(&buffer[..read])
                .map_err(|error| format!("写入缓存失败：{error}"))?;
            written += read as u64;

            if reported.elapsed() >= Duration::from_millis(120) {
                reported = std::time::Instant::now();
                let percent = total
                    .filter(|total| *total > 0)
                    .map(|total| (written as f64 / total as f64 * 100.0).clamp(0.0, 100.0));
                let detail = match (total, percent) {
                    (Some(total), Some(percent)) => format!(
                        "{} / {} ({percent:.0}%)",
                        Self::format_bytes(written),
                        Self::format_bytes(total)
                    ),
                    _ => format!("已下载 {}", Self::format_bytes(written)),
                };
                let _ = progress.send(InstallProgress {
                    stage: "downloading".into(),
                    detail,
                    bytes: Some(written),
                    total_bytes: total,
                    percent,
                    ..InstallProgress::default()
                });
            }
        }

        file.flush()
            .map_err(|error| format!("刷新缓存文件失败：{error}"))?;

        if let Some(total) = total.filter(|total| *total > 0)
            && written < total
        {
            return Err(format!(
                "下载不完整：{} / {}",
                Self::format_bytes(written),
                Self::format_bytes(total)
            ));
        }

        let _ = progress.send(InstallProgress {
            stage: "downloading".into(),
            detail: format!("已下载 {}", Self::format_bytes(written)),
            bytes: Some(written),
            total_bytes: total,
            percent: Some(100.0),
            ..InstallProgress::default()
        });

        Ok(())
    }
    pub(crate) fn get_cache_dir() -> Result<PathBuf, String> {
        if let Some(path) = std::env::var_os("SCOOP_CACHE").filter(|path| !path.is_empty()) {
            return Ok(PathBuf::from(path));
        }

        let config = Self::get_scoop_config()?;
        let map = Self::read_config_map().unwrap_or_default();
        let configured = map
            .iter()
            .find(|(key, _)| key.eq_ignore_ascii_case("cache_path"))
            .and_then(|(_, value)| value.as_str())
            .map(str::trim)
            .filter(|path| !path.is_empty());

        Ok(configured
            .map(PathBuf::from)
            .unwrap_or_else(|| config.root_path.join("cache")))
    }

    pub(crate) fn cache_file_sizes(cache_dir: &Path) -> HashMap<PathBuf, u64> {
        fs::read_dir(cache_dir)
            .into_iter()
            .flatten()
            .flatten()
            .filter_map(|entry| {
                let path = entry.path();
                let metadata = entry.metadata().ok()?;
                metadata.is_file().then_some((path, metadata.len()))
            })
            .collect()
    }

    /// 找正在下载的文件：本轮新出现或仍在增长的 `.download`／数据文件。
    /// 只认本次操作开始后改动过的文件，避免把早先失败留下的 0 字节残片当成正在下载。
    pub(crate) fn active_download(
        cache_dir: &Path,
        observed: &mut HashMap<PathBuf, u64>,
        started: std::time::SystemTime,
    ) -> Option<(String, u64)> {
        let mut candidates: Vec<(u64, String)> = Vec::new();

        for entry in fs::read_dir(cache_dir).ok()?.flatten() {
            let path = entry.path();
            let Some(name) = path.file_name().and_then(|name| name.to_str()) else {
                continue;
            };
            let name = name.to_string();
            let lower = name.to_lowercase();

            if lower.ends_with(".aria2") || lower.ends_with(".txt") || lower.ends_with(".log") {
                continue;
            }

            let Ok(metadata) = entry.metadata() else {
                continue;
            };

            if !metadata.is_file() {
                continue;
            }

            let modified = metadata
                .modified()
                .unwrap_or(std::time::SystemTime::UNIX_EPOCH);

            // 本次操作之前就存在的文件（失败留下的残片、旧缓存）不算。
            if modified + Duration::from_secs(2) < started {
                continue;
            }

            let size = metadata.len();
            let previous = observed.insert(path, size);
            let is_partial = lower.ends_with(".download");
            let is_growing = previous.is_none_or(|previous| size > previous);

            if !(is_partial || is_growing) {
                continue;
            }

            candidates.push((size, name.trim_end_matches(".download").to_string()));
        }

        // 真正在下载的是最大的那个，而不是增量最大的那个。
        candidates.sort_by_key(|(size, _)| *size);
        candidates.pop().map(|(size, file)| (file, size))
    }
}
