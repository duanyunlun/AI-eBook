use serde::Serialize;
use std::{fs, path::PathBuf, process::Command};
use tauri::{AppHandle, Manager};

const DSH_PACKAGE: &str = "@deepseek-ai/dsh";

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DshStatus {
    installed: bool,
    version: Option<String>,
    source: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DshUpdateStatus {
    current: DshStatus,
    latest_version: String,
    update_available: bool,
}

pub(crate) fn runtime_root(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?
        .join("dsh-runtime"))
}

fn managed_version(app: &AppHandle) -> Result<Option<String>, String> {
    let package = runtime_root(app)?.join("node_modules/@deepseek-ai/dsh/package.json");
    if !package.exists() {
        return Ok(None);
    }
    let value: serde_json::Value =
        serde_json::from_slice(&fs::read(package).map_err(|error| error.to_string())?)
            .map_err(|error| error.to_string())?;
    Ok(value["version"].as_str().map(str::to_owned))
}

pub(crate) fn executable_path(name: &str) -> PathBuf {
    [
        format!("/opt/homebrew/bin/{name}"),
        format!("/usr/local/bin/{name}"),
    ]
    .into_iter()
    .map(PathBuf::from)
    .find(|path| path.exists())
    .unwrap_or_else(|| PathBuf::from(name))
}

pub(crate) fn node_path(app: &AppHandle) -> Result<PathBuf, String> {
    #[cfg(target_os = "android")]
    return crate::mobile::runtime_paths(app).map(|paths| paths.node);
    #[cfg(not(target_os = "android"))]
    {
        if cfg!(target_os = "ios") {
            return Err(crate::MOBILE_AI_UNAVAILABLE.into());
        }
        let bundled = app
            .path()
            .resource_dir()
            .map_err(|error| error.to_string())?
            .join("runtime")
            .join(if cfg!(windows) { "node.exe" } else { "node" });
        if bundled.is_file() {
            return Ok(bundled);
        }
        if cfg!(debug_assertions) {
            return Ok(executable_path("node"));
        }
        Err("安装包缺少私有 Node 运行时，请重新下载完整安装包".into())
    }
}

fn npm_command(app: &AppHandle) -> Result<Command, String> {
    let node = node_path(app)?;
    #[cfg(target_os = "android")]
    let npm = crate::mobile::runtime_paths(app)?.npm;
    #[cfg(not(target_os = "android"))]
    let npm = node
        .parent()
        .unwrap_or(std::path::Path::new("."))
        .join("npm/bin/npm-cli.js");
    let mut command = if npm.is_file() {
        let mut command = Command::new(&node);
        command.arg(npm);
        command
    } else if cfg!(all(debug_assertions, not(target_os = "android"))) {
        Command::new(executable_path(if cfg!(windows) {
            "npm.cmd"
        } else {
            "npm"
        }))
    } else {
        return Err("安装包缺少私有 npm".into());
    };
    if let Some(parent) = node
        .parent()
        .filter(|parent| !parent.as_os_str().is_empty())
    {
        let mut paths = vec![parent.to_path_buf()];
        paths.extend(std::env::split_paths(
            &std::env::var_os("PATH").unwrap_or_default(),
        ));
        command.env(
            "PATH",
            std::env::join_paths(paths).map_err(|_| "Node 路径无效")?,
        );
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000);
    }
    command.env(
        "TMPDIR",
        app.path().app_cache_dir().map_err(|_| "缓存目录不可用")?,
    );
    #[cfg(target_os = "android")]
    {
        command.arg("--ignore-scripts");
        let directory = app.path().app_data_dir().map_err(|_| "应用目录不可用")?;
        command.env("HOME", &directory).current_dir(directory);
    }
    for key in [
        "HTTP_PROXY",
        "HTTPS_PROXY",
        "ALL_PROXY",
        "http_proxy",
        "https_proxy",
        "all_proxy",
    ] {
        command.env_remove(key);
    }
    Ok(command)
}

fn validated_registry(value: &str) -> Result<String, String> {
    let url = url::Url::parse(value).map_err(|_| "npm 源地址无效".to_owned())?;
    if !matches!(url.scheme(), "http" | "https") || url.host_str().is_none() {
        return Err("npm 源地址必须是 HTTP 或 HTTPS URL".into());
    }
    Ok(format!("{}/", url.as_str().trim_end_matches('/')))
}

#[tauri::command]
pub fn get_dsh_status(app: AppHandle) -> Result<DshStatus, String> {
    if let Some(version) = managed_version(&app)? {
        return Ok(DshStatus {
            installed: true,
            version: Some(version),
            source: "managed".into(),
        });
    }
    Ok(DshStatus {
        installed: false,
        version: None,
        source: "managed".into(),
    })
}

fn update_managed_dsh(app: &AppHandle, registry: &str) -> Result<DshStatus, String> {
    let registry = validated_registry(registry)?;
    let root = runtime_root(&app)?;
    fs::create_dir_all(&root).map_err(|error| error.to_string())?;
    let mut command = npm_command(app)?;
    command
        .args([
            "install",
            "--no-audit",
            "--no-fund",
            "--omit=dev",
            "--cache",
        ])
        .arg(root.join("npm-cache"))
        .arg("--prefix")
        .arg(&root)
        .arg(format!("{DSH_PACKAGE}@latest"))
        .args([
            "--registry",
            &registry,
            "--proxy=false",
            "--https-proxy=false",
        ]);
    let output = command
        .output()
        .map_err(|error| format!("无法启动 npm：{error}"))?;
    if !output.status.success() {
        let error = String::from_utf8_lossy(&output.stderr);
        return Err(error.trim().chars().take(500).collect());
    }
    #[cfg(target_os = "android")]
    {
        let sharp: serde_json::Value = serde_json::from_slice(
            &fs::read(root.join("node_modules/sharp/package.json")).map_err(|error| error.to_string())?,
        )
        .map_err(|error| error.to_string())?;
        let version = sharp["version"].as_str().ok_or("图片运行时版本缺失")?;
        if version.is_empty() || !version.chars().all(|value| value.is_ascii_digit() || value == '.') {
            return Err("图片运行时版本无效".into());
        }
        let output = command
            .arg(format!("@img/sharp-wasm32@{version}"))
            .output()
            .map_err(|error| format!("无法安装图片运行时：{error}"))?;
        if !output.status.success() {
            return Err(String::from_utf8_lossy(&output.stderr)
                .trim()
                .chars()
                .take(500)
                .collect());
        }
        let entry = root.join("node_modules/@deepseek-ai/dsh-attachment-local/lib/index.js");
        let source = fs::read_to_string(&entry).map_err(|error| error.to_string())?;
        let boundary = app.path().app_data_dir().map_err(|_| "应用目录不可用")?;
        let patched = patch_attachment_module(&source, &boundary.to_string_lossy())?;
        fs::write(entry, patched).map_err(|error| error.to_string())?;
    }
    get_dsh_status(app.clone())
}

/// 为 Android 打附件模块补丁：附件目录限制在应用私有目录、硬链接改为重命名、容忍 staging 文件已被移走。
/// 上游包改写这些语句时补丁会失配，这里显式报错要求安装兼容版本。
#[cfg(any(target_os = "android", test))]
fn patch_attachment_module(source: &str, boundary: &str) -> Result<String, String> {
    let boundary = serde_json::to_string(boundary).map_err(|error| error.to_string())?;
    let mut patched = source.to_string();
    let original = "await ensureDurableDirectory(home, parse(home).root);";
    let replacement = format!(
        "if (home !== {boundary} && !home.startsWith({boundary} + '/')) throw new Error('Attachment home is outside app data'); await ensureDurableDirectory(home, {boundary});"
    );
    // 必需：附件目录必须落在应用私有目录内
    if patched.matches(original).count() == 1 {
        patched = patched.replacen(original, &replacement, 1);
    } else if !patched.contains(&replacement) {
        return Err("当前 DSH 附件模块尚未适配 Android，请安装兼容版本".into());
    }
    // 尽力而为：模块用硬链接落盘，Android 沙箱下 link 会失败，换成重命名并容忍 staging 文件已被移走
    for (before, after) in [
        ("await link(temporary, target);", "await rename(temporary, target);"),
        ("await link(source, target);", "await rename(source, target);"),
        ("await link(staged.path, target);", "await rename(staged.path, target);"),
        ("await unlink(temporary);", "await unlink(temporary).catch(() => {});"),
        ("await unlink(staged.path);", "await unlink(staged.path).catch(() => {});"),
    ] {
        if patched.matches(before).count() == 1 {
            patched = patched.replacen(before, after, 1);
        }
    }
    Ok(patched)
}

fn check_managed_dsh(app: &AppHandle, registry: &str) -> Result<DshUpdateStatus, String> {
    let registry = validated_registry(registry)?;
    let current = get_dsh_status(app.clone())?;
    let output = npm_command(app)?
        .args([
            "view",
            DSH_PACKAGE,
            "version",
            "--registry",
            &registry,
            "--proxy=false",
            "--https-proxy=false",
        ])
        .arg("--cache")
        .arg(runtime_root(app)?.join("npm-cache"))
        .output()
        .map_err(|error| format!("无法启动 npm：{error}"))?;
    if !output.status.success() {
        let error = String::from_utf8_lossy(&output.stderr);
        return Err(error.trim().chars().take(500).collect());
    }
    let latest_version = String::from_utf8_lossy(&output.stdout).trim().to_owned();
    if latest_version.is_empty() {
        return Err("npm 未返回 DSH 最新版本".into());
    }
    let update_available =
        current.source != "managed" || current.version.as_deref() != Some(latest_version.as_str());
    Ok(DshUpdateStatus {
        current,
        latest_version,
        update_available,
    })
}

#[tauri::command]
pub async fn check_dsh_update(app: AppHandle, registry: String) -> Result<DshUpdateStatus, String> {
    tauri::async_runtime::spawn_blocking(move || check_managed_dsh(&app, &registry))
        .await
        .map_err(|error| error.to_string())?
}

#[tauri::command]
pub(crate) async fn update_dsh(
    app: AppHandle,
    registry: String,
    requests: tauri::State<'_, crate::AiRequests>,
) -> Result<DshStatus, String> {
    {
        let mut state = requests.0.lock().map_err(|_| "AI 请求状态不可用")?;
        if state.runtime_updating || !state.active.is_empty() {
            return Err("请等待 AI 请求结束后再手动更新 DSH".into());
        }
        state.runtime_updating = true;
    }
    let result =
        tauri::async_runtime::spawn_blocking(move || update_managed_dsh(&app, &registry)).await;
    requests
        .0
        .lock()
        .map_err(|_| "AI 请求状态不可用")?
        .runtime_updating = false;
    result.map_err(|error| error.to_string())?
}

#[cfg(test)]
mod tests {
    use super::patch_attachment_module;

    /// 取自上游 0.0.1-rc.1 的三处待改写语句
    const UPSTREAM: &str = "async function save(home) {\n\tawait ensureDurableDirectory(home, parse(home).root);\n}\nasync function store() {\n\ttry { await link(temporary, target); } catch (error) {}\n\tawait unlink(temporary);\n}\n";

    #[test]
    fn patches_attachment_module_for_android() {
        let patched = patch_attachment_module(UPSTREAM, "/data/user/0/app/files").unwrap();
        assert!(patched.contains("await rename(temporary, target);"));
        assert!(patched.contains("await unlink(temporary).catch(() => {});"));
        assert!(patched.contains("Attachment home is outside app data"));
        assert!(!patched.contains("await link(temporary, target);"));
        // 重复打补丁应保持幂等
        assert_eq!(patch_attachment_module(&patched, "/data/user/0/app/files").unwrap(), patched);
    }

    /// 0.1.5-rc.2 的落盘函数，硬链接目标与 staging 路径都已改名
    const UPSTREAM_NEW: &str = "async function ensureDurableHome(path) {\n\tconst home = resolve(path);\n\tif (!durableHomes.has(home)) {\n\t\tawait ensureDurableDirectory(home, parse(home).root);\n\t\tdurableHomes.add(home);\n\t}\n\treturn home;\n}\nasync function publishImmutableAlias(root, source, target, sha256) {\n\ttry { await link(source, target); } catch (error) {}\n}\nasync function publishStagedObject(root, target, staged) {\n\ttry { await link(staged.path, target); } catch (error) {}\n\tawait unlink(staged.path);\n\tawait chmod(target, 256);\n}\n";

    #[test]
    fn patches_new_layout_module() {
        let patched = patch_attachment_module(UPSTREAM_NEW, "/data/user/0/app/files").unwrap();
        assert!(patched.contains("Attachment home is outside app data"));
        assert!(patched.contains("ensureDurableDirectory(home, \"/data/user/0/app/files\");"));
        assert!(patched.contains("await rename(source, target);"));
        assert!(patched.contains("await rename(staged.path, target);"));
        assert!(patched.contains("await unlink(staged.path).catch(() => {});"));
        assert!(!patched.contains("await link("));
    }

    #[test]
    fn rejects_unknown_attachment_module() {
        assert!(patch_attachment_module("export const nothing = true;", "/data/app").is_err());
    }
}
