pub mod ai;
pub mod dsh;
pub mod history;
pub mod knowledge;
pub mod library;
pub mod reader_runtime;
pub mod storage;

use ai::AiMessage;
use futures_util::future::{AbortHandle, Abortable};
use keyring::Entry;
use serde::{Deserialize, Serialize};
use std::{
    collections::{BTreeSet, HashMap, HashSet},
    sync::Mutex,
};
use storage::KnowledgeStore;
use tauri::{Manager, ipc::Channel};
use zeroize::Zeroizing;

const AI_KEY_SERVICE: &str = "app.aiebook.reader";

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct PublicProviderConfig {
    protocol: ai::AiProtocol,
    base_url: String,
    model: String,
    max_output_tokens: u32,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct AiConversationRequest {
    request_id: String,
    provider: PublicProviderConfig,
    messages: Vec<AiMessage>,
}

#[derive(Default)]
struct AiRequestRegistry {
    active: HashMap<String, AbortHandle>,
    cancelled: HashSet<String>,
    tools: HashMap<(String, String), tokio::sync::oneshot::Sender<reader_runtime::ToolReply>>,
    runtime_updating: bool,
}

#[derive(Default)]
struct AiRequests(Mutex<AiRequestRegistry>);

#[derive(Clone, Serialize)]
#[serde(tag = "type", content = "data", rename_all = "snake_case")]
enum AiOutput {
    Delta(String),
    Reset,
    Tool(serde_json::Value),
    Finished,
}

#[tauri::command]
fn list_system_fonts() -> Vec<String> {
    let mut database = fontdb::Database::new();
    database.load_system_fonts();
    database
        .faces()
        .flat_map(|face| face.families.iter().map(|(name, _)| name.trim()))
        .filter(|name| !name.is_empty() && !name.starts_with('.'))
        .map(str::to_owned)
        .collect::<BTreeSet<_>>()
        .into_iter()
        .collect()
}

fn key_entry(provider: &PublicProviderConfig) -> Result<Entry, String> {
    let account = provider.base_url.trim().trim_end_matches('/');
    Entry::new(AI_KEY_SERVICE, account).map_err(|error| error.to_string())
}

fn read_ai_api_key(provider: &PublicProviderConfig) -> Result<String, String> {
    match key_entry(provider)?.get_password() {
        Ok(api_key) => Ok(api_key),
        Err(keyring::Error::NoEntry) => Ok(String::new()),
        Err(error) => Err(error.to_string()),
    }
}

#[tauri::command]
fn has_ai_api_key(provider: PublicProviderConfig) -> Result<bool, String> {
    Ok(!read_ai_api_key(&provider)?.is_empty())
}

#[tauri::command]
fn save_ai_api_key(provider: PublicProviderConfig, api_key: String) -> Result<(), String> {
    if api_key.trim().is_empty() {
        return Err("API Key 不能为空".into());
    }
    key_entry(&provider)?
        .set_password(api_key.trim())
        .map_err(|error| error.to_string())
}

#[tauri::command]
async fn generate_ai(
    app: tauri::AppHandle,
    mut request: AiConversationRequest,
    on_event: Channel<AiOutput>,
    requests: tauri::State<'_, AiRequests>,
) -> Result<(), String> {
    uuid::Uuid::parse_str(&request.request_id).map_err(|_| "AI 请求标识无效")?;
    if request.provider.model.trim().is_empty() {
        return Err("请先在设置中配置 AI 模型".into());
    }
    let api_key = Zeroizing::new(read_ai_api_key(&request.provider)?);
    request.provider.max_output_tokens = request.provider.max_output_tokens.clamp(1, 131_072);
    let (abort_handle, abort_registration) = AbortHandle::new_pair();
    {
        let mut registry = requests.0.lock().map_err(|_| "AI 请求状态不可用")?;
        if registry.runtime_updating {
            return Err("DSH 正在手动更新，请稍后再发送".into());
        }
        if registry.active.contains_key(&request.request_id) {
            return Err("AI 请求标识重复".into());
        }
        if registry.cancelled.remove(&request.request_id) {
            return Err("AI 请求已中断".into());
        }
        registry
            .active
            .insert(request.request_id.clone(), abort_handle);
    }
    let result = Abortable::new(
        reader_runtime::generate(
            &app,
            &requests,
            &request.request_id,
            &request.provider,
            &api_key,
            &request.messages,
            &on_event,
        ),
        abort_registration,
    )
    .await;
    let cleanup = requests
        .0
        .lock()
        .map_err(|_| "AI 请求状态不可用")
        .map(|mut registry| {
            registry.active.remove(&request.request_id);
            registry.cancelled.remove(&request.request_id);
            registry
                .tools
                .retain(|(id, _), _| id != &request.request_id);
        });
    cleanup?;
    result
        .map_err(|_| "AI 请求已中断".to_owned())?
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn cancel_ai(request_id: String, requests: tauri::State<'_, AiRequests>) -> Result<(), String> {
    let mut registry = requests.0.lock().map_err(|_| "AI 请求状态不可用")?;
    if let Some(handle) = registry.active.remove(&request_id) {
        handle.abort();
    } else {
        registry.cancelled.insert(request_id);
    }
    Ok(())
}

fn main() {
    tauri::Builder::default()
        .setup(|app| {
            let database_path = app.path().app_data_dir()?.join("state.sqlite");
            app.manage(KnowledgeStore::open(&database_path)?);
            app.manage(AiRequests::default());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            has_ai_api_key,
            save_ai_api_key,
            generate_ai,
            cancel_ai,
            list_system_fonts,
            dsh::get_dsh_status,
            dsh::check_dsh_update,
            dsh::update_dsh,
            reader_runtime::get_reader_runtime_status,
            reader_runtime::import_reader_plugin,
            reader_runtime::restore_reader_plugin,
            reader_runtime::resolve_reader_tool,
            library::import_book,
            library::list_books,
            library::rename_book,
            library::save_reading_page,
            library::remove_book,
            knowledge::save_knowledge_item,
            knowledge::update_knowledge_item,
            knowledge::delete_knowledge_item,
            knowledge::list_knowledge,
            knowledge::list_book_annotations,
            knowledge::list_knowledge_books,
            knowledge::search_knowledge,
            knowledge::get_knowledge_graph,
            knowledge::append_thread_message,
            knowledge::list_threads_for_book,
            knowledge::create_thread_for_book,
            knowledge::select_thread,
            knowledge::load_latest_thread,
            knowledge::close_thread,
            knowledge::delete_thread,
            history::get_vault_path,
            history::choose_vault
        ])
        .run(tauri::generate_context!())
        .expect("启动 AI-eBook 失败");
}
