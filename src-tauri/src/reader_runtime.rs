use crate::{AiOutput, AiRequests, PublicProviderConfig, ai::AiMessage, dsh};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::{
    fs,
    path::{Path, PathBuf},
    process::Stdio,
    time::Duration,
};
use tauri::{AppHandle, Manager, ipc::Channel};
use tokio::{
    io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader},
    process::Command,
    sync::oneshot,
    time::timeout,
};

const MANIFEST: &str = include_str!("../../plugins/dsh-reader/package.json");
const ENTRY: &str = include_str!("../../plugins/dsh-reader/index.mjs");
const PATCH: &str = include_str!("../../plugins/dsh-reader/cordis.patch.yml");
const TOOLS: &[&str] = &[
    "reading_context",
    "read_page",
    "search_book",
    "search_knowledge",
    "save_note",
];

struct RequestFiles(PathBuf);
impl Drop for RequestFiles {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReaderRuntimeStatus {
    plugin_version: String,
    dsh_version: Option<String>,
    compatible: bool,
}

#[derive(Deserialize)]
pub struct ToolReply {
    pub value: Option<Value>,
    pub error: Option<String>,
}

fn plugin_home(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?
        .join("dsh-reader"))
}

fn read_manifest(path: &Path) -> Result<Value, String> {
    let metadata = fs::metadata(path).map_err(|_| "无法读取 DSH 或插件清单")?;
    if !metadata.is_file() || metadata.len() > 2_000_000 {
        return Err("DSH 或插件清单过大或不是文件".into());
    }
    serde_json::from_slice(&fs::read(path).map_err(|_| "无法读取 DSH 或插件清单")?)
        .map_err(|_| "DSH 或插件清单无效".into())
}

fn active_plugin(app: &AppHandle) -> Result<Option<PathBuf>, String> {
    let root = plugin_home(app)?;
    let pointer = root.join("active-plugin.json");
    if !pointer.exists() {
        return Ok(None);
    }
    let value = read_manifest(&pointer)?;
    let directory = value["directory"].as_str().ok_or("插件选择记录无效")?;
    if directory.len() != 64 || !directory.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        return Err("插件目录无效".into());
    }
    Ok(Some(root.join("plugins").join(directory)))
}

fn compatible(manifest: &Value, version: &str) -> bool {
    manifest["aiEbook"]["bridgeVersion"] == 1
        && manifest["aiEbook"]["dshVersions"]
            .as_array()
            .is_some_and(|versions| {
                versions
                    .iter()
                    .any(|candidate| candidate.as_str() == Some(version))
            })
}

#[tauri::command]
pub fn get_reader_runtime_status(app: AppHandle) -> Result<ReaderRuntimeStatus, String> {
    let manifest = match active_plugin(&app)? {
        Some(path) => read_manifest(&path.join("package.json"))?,
        None => serde_json::from_str(MANIFEST).map_err(|error| format!("内置插件无效：{error}"))?,
    };
    let package = dsh::runtime_root(&app)?.join("node_modules/@deepseek-ai/dsh/package.json");
    let dsh_version = if package.exists() {
        read_manifest(&package)?["version"]
            .as_str()
            .map(str::to_owned)
    } else {
        None
    };
    Ok(ReaderRuntimeStatus {
        plugin_version: manifest["version"].as_str().unwrap_or("unknown").into(),
        compatible: dsh_version
            .as_deref()
            .is_some_and(|version| compatible(&manifest, version)),
        dsh_version,
    })
}

fn install_files(
    root: &Path,
    manifest: &[u8],
    entry: &[u8],
    patch: &[u8],
) -> Result<PathBuf, String> {
    let digest = Sha256::digest([manifest, entry, patch].concat());
    let directory: String = digest.iter().map(|byte| format!("{byte:02x}")).collect();
    let target = root.join("plugins").join(directory);
    fs::create_dir_all(&target).map_err(|error| error.to_string())?;
    for (name, bytes) in [
        ("package.json", manifest),
        ("index.mjs", entry),
        ("cordis.patch.yml", patch),
    ] {
        fs::write(target.join(name), bytes).map_err(|error| error.to_string())?;
    }
    Ok(target)
}

#[tauri::command]
pub async fn import_reader_plugin(app: AppHandle) -> Result<Option<ReaderRuntimeStatus>, String> {
    let Some(folder) = rfd::AsyncFileDialog::new()
        .set_title("选择可信的阅读器插件目录")
        .pick_folder()
        .await
    else {
        return Ok(None);
    };
    let root = folder.path();
    let manifest = read_manifest(&root.join("package.json"))?;
    if manifest["name"] != "ai-ebook-dsh-reader" || manifest["aiEbook"]["bridgeVersion"] != 1 {
        return Err("不是兼容的阅读器插件".into());
    }
    let dsh_package = dsh::runtime_root(&app)?.join("node_modules/@deepseek-ai/dsh/package.json");
    let version = read_manifest(&dsh_package)?;
    if !compatible(&manifest, version["version"].as_str().unwrap_or("")) {
        return Err("插件与当前内置 DSH 版本不兼容，请手动选择匹配版本".into());
    }
    let read = |name: &str| -> Result<Vec<u8>, String> {
        let path = root.join(name);
        let metadata = fs::metadata(&path).map_err(|error| error.to_string())?;
        if !metadata.is_file() || metadata.len() > 2_000_000 {
            return Err("插件文件过大或不是文件".into());
        }
        fs::read(path).map_err(|error| error.to_string())
    };
    let home = plugin_home(&app)?;
    let target = install_files(
        &home,
        &read("package.json")?,
        &read("index.mjs")?,
        &read("cordis.patch.yml")?,
    )?;
    let pointer = json!({"directory":target.file_name().and_then(|value| value.to_str()).ok_or("插件目录无效")?});
    fs::write(home.join("active-plugin.json"), pointer.to_string())
        .map_err(|error| error.to_string())?;
    get_reader_runtime_status(app).map(Some)
}

#[tauri::command]
pub fn restore_reader_plugin(app: AppHandle) -> Result<ReaderRuntimeStatus, String> {
    let root = plugin_home(&app)?;
    let target = install_files(
        &root,
        MANIFEST.as_bytes(),
        ENTRY.as_bytes(),
        PATCH.as_bytes(),
    )?;
    fs::write(
        root.join("active-plugin.json"),
        json!({"directory": target.file_name().unwrap().to_str().unwrap()}).to_string(),
    )
    .map_err(|error| error.to_string())?;
    get_reader_runtime_status(app)
}

#[tauri::command]
pub(crate) fn resolve_reader_tool(
    request_id: String,
    call_id: String,
    reply: ToolReply,
    requests: tauri::State<'_, AiRequests>,
) -> Result<(), String> {
    let sender = requests
        .0
        .lock()
        .map_err(|_| "AI 请求状态不可用")?
        .tools
        .remove(&(request_id, call_id))
        .ok_or("工具请求已结束")?;
    sender.send(reply).map_err(|_| "工具请求已取消".into())
}

pub(crate) async fn generate(
    app: &AppHandle,
    requests: &AiRequests,
    request_id: &str,
    provider: &PublicProviderConfig,
    api_key: &str,
    messages: &[AiMessage],
    on_event: &Channel<AiOutput>,
) -> Result<(), String> {
    let runtime = dsh::runtime_root(app)?;
    let package = runtime.join("node_modules/@deepseek-ai/dsh/package.json");
    if !package.exists() {
        return Err("请先在 AI 设置中手动安装内置 DSH".into());
    }
    let version = read_manifest(&package)?;
    let home = plugin_home(app)?;
    let plugin = match active_plugin(app)? {
        Some(path) => path,
        None => install_files(
            &home,
            MANIFEST.as_bytes(),
            ENTRY.as_bytes(),
            PATCH.as_bytes(),
        )?,
    };
    if !compatible(
        &read_manifest(&plugin.join("package.json"))?,
        version["version"].as_str().unwrap_or(""),
    ) {
        return Err("阅读器插件与内置 DSH 不兼容，请手动更新匹配版本".into());
    }
    let request_home = home.join("requests").join(request_id);
    let _files = RequestFiles(request_home.clone());
    fs::create_dir_all(request_home.join("profiles/reader")).map_err(|error| error.to_string())?;
    fs::write(
        request_home.join("profiles/reader/package.json"),
        r#"{"private":true,"dsh":{"profile":{"bundles":[],"patchReload":"startup"}}}"#,
    )
    .map_err(|error| error.to_string())?;
    let mut child = Command::new(dsh::executable_path("node"))
        .arg(runtime.join("node_modules/@deepseek-ai/dsh/lib/bin.js"))
        .args(["--profile", "reader", "--patch"])
        .arg(plugin.join("cordis.patch.yml"))
        .env("DSH_HOME", &request_home)
        .env("AI_EBOOK_DSH_PACKAGE", &package)
        .env(
            "AI_EBOOK_API_KEY",
            if api_key.is_empty() {
                "local-no-key"
            } else {
                api_key
            },
        )
        .current_dir(&request_home)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .kill_on_drop(true)
        .spawn()
        .map_err(|_| "无法启动内置 DSH，请检查 Node.js 与手动安装状态")?;
    let mut input = child.stdin.take().ok_or("DSH 输入不可用")?;
    let mut output = BufReader::new(child.stdout.take().ok_or("DSH 输出不可用")?);
    input
        .write_all(
            b"{\"jsonrpc\":\"2.0\",\"id\":\"hello\",\"method\":\"reader/hello\",\"params\":{}}\n",
        )
        .await
        .map_err(|_| "DSH 握手失败")?;
    let mut line = String::new();
    loop {
        line.clear();
        let mut limited = (&mut output).take(8_000_001);
        let size = timeout(Duration::from_secs(180), limited.read_line(&mut line))
            .await
            .map_err(|_| "DSH 或工具等待超时")?
            .map_err(|_| "无法读取 DSH 输出")?;
        if size == 0 {
            return Err("DSH 意外退出，请检查运行时与插件兼容性".into());
        }
        if size > 8_000_000 {
            return Err("DSH 输出超过限制".into());
        }
        let frame: Value = serde_json::from_str(&line).map_err(|_| "DSH 插件输出了无效协议数据")?;
        let mut response = None;
        if frame["id"] == "hello" {
            if frame["result"]["bridgeVersion"] != 1 {
                return Err("DSH 插件握手失败或协议不兼容".into());
            }
            response = Some(
                json!({"jsonrpc":"2.0","id":"generate","method":"reader/generate","params":{"requestId":request_id,"provider":provider,"messages":messages}}),
            );
        } else if frame["id"] == "generate" {
            if !frame["error"].is_null() {
                return Err("DSH 回答失败；请检查模型是否支持工具调用及插件兼容性".into());
            }
            if frame["result"]["finished"] != true {
                return Err("DSH 未正常完成".into());
            }
            on_event
                .send(AiOutput::Finished)
                .map_err(|_| "界面已断开")?;
            child.kill().await.map_err(|_| "DSH 进程清理失败")?;
            let _ = child.wait().await;
            return Ok(());
        } else if frame["method"] == "reader/delta" {
            on_event
                .send(AiOutput::Delta(
                    frame["params"]["text"].as_str().unwrap_or("").into(),
                ))
                .map_err(|_| "界面已断开")?;
        } else if frame["method"] == "reader/reset" {
            on_event.send(AiOutput::Reset).map_err(|_| "界面已断开")?;
        } else if frame["method"] == "reader/tool" {
            let name = frame["params"]["name"].as_str().ok_or("工具名称无效")?;
            if !TOOLS.contains(&name) {
                return Err("插件请求了未授权的工具".into());
            }
            let call_id = frame["id"].as_str().ok_or("工具标识无效")?.to_owned();
            let (sender, receiver) = oneshot::channel();
            requests
                .0
                .lock()
                .map_err(|_| "AI 请求状态不可用")?
                .tools
                .insert((request_id.into(), call_id.clone()), sender);
            on_event
                .send(AiOutput::Tool(
                    json!({"callId":call_id,"name":name,"arguments":frame["params"]["arguments"]}),
                ))
                .map_err(|_| "界面已断开")?;
            let reply = timeout(Duration::from_secs(180), receiver)
                .await
                .map_err(|_| "工具确认或执行超时")?
                .map_err(|_| "工具已取消")?;
            response = Some(match reply.error {
                Some(_) => {
                    json!({"jsonrpc":"2.0","id":call_id,"error":{"code":-32000,"message":"阅读工具执行失败或用户取消"}})
                }
                None => json!({"jsonrpc":"2.0","id":call_id,"result":reply.value}),
            });
        }
        if let Some(response) = response {
            input
                .write_all(format!("{response}\n").as_bytes())
                .await
                .map_err(|_| "DSH 通信中断")?;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn plugin_compatibility_is_explicit() {
        let manifest: Value = serde_json::from_str(MANIFEST).unwrap();
        assert!(compatible(&manifest, "0.1.2-rc.1"));
        assert!(!compatible(&manifest, "0.1.3-alpha.1"));
        assert!(!compatible(
            &json!({"aiEbook":{"bridgeVersion":2,"dshVersions":["0.1.2-rc.1"]}}),
            "0.1.2-rc.1"
        ));
    }
}
