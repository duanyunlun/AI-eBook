use base64::{Engine as _, engine::general_purpose::STANDARD};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tauri::{AppHandle, State};

use crate::{history, storage::KnowledgeStore};

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum EvidenceKind {
    Text,
    Image,
    External,
}

impl EvidenceKind {
    pub(crate) const fn as_str(self) -> &'static str {
        match self {
            Self::Text => "text",
            Self::Image => "image",
            Self::External => "external",
        }
    }
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum KnowledgeKind {
    Thought,
    Question,
    Answer,
    Concept,
    Conclusion,
    Summary,
}

impl KnowledgeKind {
    pub(crate) const fn as_str(self) -> &'static str {
        match self {
            Self::Thought => "thought",
            Self::Question => "question",
            Self::Answer => "answer",
            Self::Concept => "concept",
            Self::Conclusion => "conclusion",
            Self::Summary => "summary",
        }
    }

    pub(crate) fn parse(value: &str) -> Option<Self> {
        Some(match value {
            "thought" => Self::Thought,
            "question" => Self::Question,
            "answer" => Self::Answer,
            "concept" => Self::Concept,
            "conclusion" => Self::Conclusion,
            "summary" => Self::Summary,
            _ => return None,
        })
    }
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Creator {
    User,
    Ai,
}

impl Creator {
    pub(crate) const fn as_str(self) -> &'static str {
        match self {
            Self::User => "user",
            Self::Ai => "ai",
        }
    }

    pub(crate) fn parse(value: &str) -> Option<Self> {
        Some(match value {
            "user" => Self::User,
            "ai" => Self::Ai,
            _ => return None,
        })
    }
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum KnowledgeBasis {
    UserThought,
    Book,
    External,
    Mixed,
}

impl KnowledgeBasis {
    pub(crate) const fn as_str(self) -> &'static str {
        match self {
            Self::UserThought => "user_thought",
            Self::Book => "book",
            Self::External => "external",
            Self::Mixed => "mixed",
        }
    }

    pub(crate) fn parse(value: &str) -> Option<Self> {
        Some(match value {
            "user_thought" => Self::UserThought,
            "book" => Self::Book,
            "external" => Self::External,
            "mixed" => Self::Mixed,
            _ => return None,
        })
    }
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ReviewState {
    Draft,
    Confirmed,
    Rejected,
}

impl ReviewState {
    pub(crate) const fn as_str(self) -> &'static str {
        match self {
            Self::Draft => "draft",
            Self::Confirmed => "confirmed",
            Self::Rejected => "rejected",
        }
    }

    pub(crate) fn parse(value: &str) -> Option<Self> {
        Some(match value {
            "draft" => Self::Draft,
            "confirmed" => Self::Confirmed,
            "rejected" => Self::Rejected,
            _ => return None,
        })
    }
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum RelationKind {
    Quotes,
    AsksAbout,
    DerivedFrom,
    Summarizes,
    Supports,
    Contradicts,
    RelatedTo,
    MentionedIn,
}

impl RelationKind {
    pub(crate) const fn as_str(self) -> &'static str {
        match self {
            Self::Quotes => "quotes",
            Self::AsksAbout => "asks_about",
            Self::DerivedFrom => "derived_from",
            Self::Summarizes => "summarizes",
            Self::Supports => "supports",
            Self::Contradicts => "contradicts",
            Self::RelatedTo => "related_to",
            Self::MentionedIn => "mentioned_in",
        }
    }

    pub(crate) fn parse(value: &str) -> Option<Self> {
        Some(match value {
            "quotes" => Self::Quotes,
            "asks_about" => Self::AsksAbout,
            "derived_from" => Self::DerivedFrom,
            "summarizes" => Self::Summarizes,
            "supports" => Self::Supports,
            "contradicts" => Self::Contradicts,
            "related_to" => Self::RelatedTo,
            "mentioned_in" => Self::MentionedIn,
            _ => return None,
        })
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EvidenceDraft {
    pub kind: EvidenceKind,
    pub book_id: Option<String>,
    pub edition_id: Option<String>,
    pub chapter_id: Option<String>,
    #[serde(default)]
    pub locator: serde_json::Value,
    pub text_snapshot: Option<String>,
    pub asset_hash: Option<String>,
    pub source_url: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KnowledgeItemDraft {
    pub kind: KnowledgeKind,
    pub book_id: Option<String>,
    pub chapter_id: Option<String>,
    pub category: Option<String>,
    pub title: Option<String>,
    pub body_md: String,
    pub creator: Creator,
    pub basis: KnowledgeBasis,
    pub review_state: ReviewState,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct KnowledgeItem {
    pub id: String,
    pub kind: KnowledgeKind,
    pub book_id: Option<String>,
    pub chapter_id: Option<String>,
    pub category: Option<String>,
    pub title: Option<String>,
    pub body_md: String,
    pub creator: Creator,
    pub basis: KnowledgeBasis,
    pub review_state: ReviewState,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct KnowledgeEdge {
    pub id: String,
    pub from_item_id: String,
    pub to_item_id: String,
    pub relation: RelationKind,
    pub creator: Creator,
    pub review_state: ReviewState,
    pub confidence: Option<f64>,
    pub created_at: i64,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Evidence {
    pub id: String,
    pub kind: EvidenceKind,
    pub book_id: Option<String>,
    pub chapter_id: Option<String>,
    pub locator: serde_json::Value,
    pub text_snapshot: Option<String>,
    pub asset_hash: Option<String>,
    pub source_url: Option<String>,
    pub created_at: i64,
}

#[derive(Debug, Serialize)]
pub struct BookAnnotation {
    pub item: KnowledgeItem,
    pub quote: String,
    pub locator: serde_json::Value,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct KnowledgeGraph {
    pub items: Vec<KnowledgeItem>,
    pub edges: Vec<KnowledgeEdge>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ThreadMessage {
    pub id: String,
    pub role: String,
    pub body: String,
    pub created_at: i64,
    pub context_json: Option<String>,
    pub state: MessageState,
}

#[derive(Clone, Copy, Debug, Default, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum MessageState {
    #[default]
    Complete,
    Interrupted,
    Failed,
}

impl MessageState {
    pub(crate) const fn as_str(self) -> &'static str {
        match self {
            Self::Complete => "complete",
            Self::Interrupted => "interrupted",
            Self::Failed => "failed",
        }
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ThreadConversation {
    pub id: String,
    pub title: String,
    pub messages: Vec<ThreadMessage>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ThreadSummary {
    pub id: String,
    pub title: String,
    pub updated_at: i64,
    pub page: i64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppendMessageRequest {
    pub thread_id: Option<String>,
    pub mode: String,
    pub book_id: String,
    pub page: i64,
    pub role: String,
    pub body: String,
    pub context_json: Option<String>,
    #[serde(default)]
    pub state: MessageState,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KnowledgeLinkDraft {
    pub target_id: String,
    pub relation: RelationKind,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveKnowledgeRequest {
    pub item: KnowledgeItemDraft,
    pub evidence: Option<EvidenceDraft>,
    pub asset_data: Option<String>,
    #[serde(default)]
    pub links: Vec<KnowledgeLinkDraft>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateKnowledgeRequest {
    pub id: String,
    pub kind: KnowledgeKind,
    pub book_id: Option<String>,
    pub category: Option<String>,
    pub title: Option<String>,
    pub body_md: String,
}

#[tauri::command]
pub fn save_knowledge_item(
    app: AppHandle,
    store: State<'_, KnowledgeStore>,
    mut request: SaveKnowledgeRequest,
) -> Result<KnowledgeItem, String> {
    if request.item.review_state != ReviewState::Confirmed {
        return Err("只有用户确认的知识项才能归档".into());
    }
    if let Some(evidence) = &request.evidence {
        if evidence.locator["annotation"] == true {
            if request.item.book_id.is_none()
                || evidence.book_id != request.item.book_id
                || evidence.kind != EvidenceKind::Text
                || evidence
                    .text_snapshot
                    .as_deref()
                    .unwrap_or("")
                    .trim()
                    .is_empty()
                || evidence.locator["page"].as_u64().unwrap_or(0) == 0
            {
                return Err("批注必须绑定书籍、页码和原文".into());
            }
        }
    }
    if let Some(data) = request.asset_data.take() {
        let bytes = STANDARD.decode(data).map_err(|_| "截图数据无效")?;
        if bytes.len() > 8 * 1024 * 1024 {
            return Err("截图超过 8 MB，请缩小页面后重试".into());
        }
        let mut hash = String::with_capacity(64);
        for byte in Sha256::digest(&bytes) {
            use std::fmt::Write as _;
            write!(hash, "{byte:02x}").map_err(|error| error.to_string())?;
        }
        let evidence = request.evidence.as_mut().ok_or("截图缺少证据信息")?;
        if evidence.kind != EvidenceKind::Image {
            return Err("截图的证据类型必须是 image".into());
        }
        evidence.asset_hash = Some(hash.clone());
        history::store_asset(&app, &store, &hash, &bytes).map_err(|error| error.to_string())?;
    }
    let evidence_id = request
        .evidence
        .as_ref()
        .map(|evidence| store.create_evidence(evidence))
        .transpose()
        .map_err(|error| error.to_string())?;
    let item = store
        .create_item(&request.item)
        .map_err(|error| error.to_string())?;
    if let Some(evidence_id) = evidence_id {
        store
            .attach_evidence(&item.id, &evidence_id, "quotes")
            .map_err(|error| error.to_string())?;
    }
    for link in request.links {
        store
            .add_edge(
                &item.id,
                &link.target_id,
                link.relation,
                item.creator,
                ReviewState::Confirmed,
                None,
            )
            .map_err(|error| error.to_string())?;
    }
    let evidence = store
        .evidence_for_item(&item.id)
        .map_err(|error| error.to_string())?;
    let edges = store
        .edges_for_item(&item.id)
        .map_err(|error| error.to_string())?;
    history::archive_item(&app, &store, &item, &evidence, &edges)
        .map_err(|error| error.to_string())?;
    Ok(item)
}

#[tauri::command]
pub fn update_knowledge_item(
    app: AppHandle,
    store: State<'_, KnowledgeStore>,
    request: UpdateKnowledgeRequest,
) -> Result<KnowledgeItem, String> {
    let item = store
        .update_item(&request)
        .map_err(|error| error.to_string())?;
    let evidence = store
        .evidence_for_item(&item.id)
        .map_err(|error| error.to_string())?;
    let edges = store
        .edges_for_item(&item.id)
        .map_err(|error| error.to_string())?;
    history::archive_item(&app, &store, &item, &evidence, &edges)
        .map_err(|error| error.to_string())?;
    Ok(item)
}

#[tauri::command]
pub fn delete_knowledge_item(
    app: AppHandle,
    store: State<'_, KnowledgeStore>,
    id: String,
) -> Result<(), String> {
    store.delete_item(&id).map_err(|error| error.to_string())?;
    history::delete_item(&app, &store, &id).map_err(|error| error.to_string())
}

#[tauri::command]
pub fn list_knowledge(
    store: State<'_, KnowledgeStore>,
    book_id: Option<String>,
) -> Result<Vec<KnowledgeItem>, String> {
    store
        .list_items(book_id.as_deref(), 200)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn list_book_annotations(
    store: State<'_, KnowledgeStore>,
    book_id: String,
) -> Result<Vec<BookAnnotation>, String> {
    store
        .book_annotations(&book_id)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn list_knowledge_books(
    store: State<'_, KnowledgeStore>,
) -> Result<Vec<crate::storage::BookReference>, String> {
    store
        .list_book_references()
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn search_knowledge(
    store: State<'_, KnowledgeStore>,
    query: String,
    book_id: Option<String>,
) -> Result<Vec<KnowledgeItem>, String> {
    store
        .search(&query, 20, book_id.as_deref())
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn get_knowledge_graph(store: State<'_, KnowledgeStore>) -> Result<KnowledgeGraph, String> {
    store.graph(80).map_err(|error| error.to_string())
}

#[tauri::command]
pub fn append_thread_message(
    store: State<'_, KnowledgeStore>,
    request: AppendMessageRequest,
) -> Result<ThreadConversation, String> {
    let conversation = store
        .append_message(&request)
        .map_err(|error| error.to_string())?;
    Ok(conversation)
}

#[tauri::command]
pub fn list_threads_for_book(
    store: State<'_, KnowledgeStore>,
    book_id: String,
    mode: String,
) -> Result<Vec<ThreadSummary>, String> {
    store
        .list_threads_for_book(&book_id, &mode)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn create_thread_for_book(
    store: State<'_, KnowledgeStore>,
    book_id: String,
    mode: String,
) -> Result<ThreadConversation, String> {
    store
        .create_thread_for_book(&book_id, &mode)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn select_thread(
    store: State<'_, KnowledgeStore>,
    thread_id: String,
    book_id: String,
) -> Result<ThreadConversation, String> {
    store
        .select_thread(&thread_id, &book_id)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn load_latest_thread(
    store: State<'_, KnowledgeStore>,
    book_id: String,
    mode: String,
) -> Result<Option<ThreadConversation>, String> {
    store
        .load_latest_thread(&book_id, &mode)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn close_thread(
    store: State<'_, KnowledgeStore>,
    thread_id: String,
    book_id: String,
) -> Result<(), String> {
    store
        .close_thread(&thread_id, &book_id)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn delete_thread(
    store: State<'_, KnowledgeStore>,
    thread_id: String,
    book_id: String,
) -> Result<(), String> {
    store
        .delete_thread(&thread_id, &book_id)
        .map_err(|error| error.to_string())
}
