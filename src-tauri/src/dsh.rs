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

fn runtime_root(app: &AppHandle) -> Result<PathBuf, String> {
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

fn executable_path(name: &str) -> PathBuf {
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
    let url = reqwest::Url::parse(value).map_err(|_| "npm 源地址无效".to_owned())?;
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
    let version = Command::new(executable_path("dsh"))
        .arg("--version")
        .output()
        .ok()
        .filter(|output| output.status.success())
        .map(|output| String::from_utf8_lossy(&output.stdout).trim().to_owned());
    Ok(DshStatus {
        installed: version.is_some(),
        version,
        source: "system".into(),
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
pub async fn update_dsh(app: AppHandle, registry: String) -> Result<DshStatus, String> {
    tauri::async_runtime::spawn_blocking(move || update_managed_dsh(&app, &registry))
        .await
        .map_err(|error| error.to_string())?
}
