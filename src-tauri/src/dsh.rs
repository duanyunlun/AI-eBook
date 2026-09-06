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

fn npm_command() -> Command {
    let mut command = Command::new(executable_path("npm"));
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
    command
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
    let output = npm_command()
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
        ])
        .output()
        .map_err(|error| format!("无法启动 npm：{error}"))?;
    if !output.status.success() {
        let error = String::from_utf8_lossy(&output.stderr);
        return Err(error.trim().chars().take(500).collect());
    }
    get_dsh_status(app.clone())
}

fn check_managed_dsh(app: &AppHandle, registry: &str) -> Result<DshUpdateStatus, String> {
    let registry = validated_registry(registry)?;
    let current = get_dsh_status(app.clone())?;
    let output = npm_command()
        .args([
            "view",
            DSH_PACKAGE,
            "version",
            "--registry",
            &registry,
            "--proxy=false",
            "--https-proxy=false",
        ])
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
