pub mod ai;
pub mod dsh;
pub mod history;
pub mod knowledge;
pub mod library;
pub mod storage;

use ai::{
    AiClient, AiMessage, ContentPart, GenerateRequest, MessageRole, ProviderConfig, StreamEvent,
};
use futures_util::future::{AbortHandle, Abortable};
use keyring::Entry;
use serde::{Deserialize, Serialize};
use std::{
    collections::{BTreeSet, HashMap, HashSet},
    sync::Mutex,
};
use storage::KnowledgeStore;
use tauri::{Manager, ipc::Channel};
use zeroize::Zeroize;

const AI_KEY_SERVICE: &str = "app.aiebook.reader";

#[derive(Deserialize)]
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
}

#[derive(Default)]
struct AiRequests(Mutex<AiRequestRegistry>);

#[derive(Clone, Serialize)]
#[serde(tag = "type", content = "data", rename_all = "snake_case")]
enum AiOutput {
    Delta(String),
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
async fn test_ai_provider(provider: PublicProviderConfig) -> Result<String, String> {
    if provider.model.trim().is_empty() {
        return Err("模型名称不能为空".into());
    }
    let api_key = read_ai_api_key(&provider)?;
    let mut config = ProviderConfig {
        protocol: provider.protocol,
        base_url: provider.base_url,
        model: provider.model,
        api_key,
    };
    let request = GenerateRequest {
        messages: vec![AiMessage {
            role: MessageRole::User,
            content: vec![ContentPart::Text {
                text: "仅回复 OK".into(),
            }],
        }],
        max_output_tokens: 16,
        temperature: Some(0.0),
    };
    let mut output = String::new();
    let result = AiClient::new()
        .map_err(|error| error.to_string())?
        .generate_stream(&config, &request, |event| {
            if let StreamEvent::TextDelta(text) = event {
                output.push_str(&text);
            }
        })
        .await;
    config.api_key.zeroize();
    result.map_err(|error| error.to_string())?;
    Ok(output)
}

#[tauri::command]
async fn generate_ai(
    request: AiConversationRequest,
    on_event: Channel<AiOutput>,
    requests: tauri::State<'_, AiRequests>,
) -> Result<(), String> {
    if request.provider.model.trim().is_empty() {
        return Err("请先在设置中配置 AI 模型".into());
    }
    let api_key = read_ai_api_key(&request.provider)?;
    let max_output_tokens = request.provider.max_output_tokens.clamp(1, 131_072);
    let mut config = ProviderConfig {
        protocol: request.provider.protocol,
        base_url: request.provider.base_url,
        model: request.provider.model,
        api_key,
    };
    let generation = GenerateRequest {
        messages: request.messages,
        max_output_tokens,
        temperature: Some(0.2),
    };
    let client = AiClient::new().map_err(|error| error.to_string())?;
    let (abort_handle, abort_registration) = AbortHandle::new_pair();
    {
        let mut registry = requests.0.lock().map_err(|_| "AI 请求状态不可用")?;
        if registry.cancelled.remove(&request.request_id) {
            config.api_key.zeroize();
            return Err("AI 请求已中断".into());
        }
        registry
            .active
            .insert(request.request_id.clone(), abort_handle);
    }
    let result = Abortable::new(
        client.generate_stream(&config, &generation, |event| {
            let output = match event {
                StreamEvent::TextDelta(text) => AiOutput::Delta(text),
                StreamEvent::Finished => AiOutput::Finished,
            };
            let _ = on_event.send(output);
        }),
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
        });
    config.api_key.zeroize();
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
            test_ai_provider,
            generate_ai,
            cancel_ai,
            list_system_fonts,
            dsh::get_dsh_status,
            dsh::check_dsh_update,
            dsh::update_dsh,
            library::import_book,
            library::list_books,
            library::rename_book,
            library::save_reading_page,
            library::remove_book,
            knowledge::save_knowledge_item,
            knowledge::update_knowledge_item,
            knowledge::delete_knowledge_item,
            knowledge::list_knowledge,
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
