use std::{
    fs,
    path::Path,
    sync::{Mutex, MutexGuard},
    time::{SystemTime, UNIX_EPOCH},
};

use rusqlite::{Connection, OptionalExtension, Row, params};
use thiserror::Error;
use uuid::Uuid;

use crate::knowledge::{
    AppendMessageRequest, Creator, Evidence, EvidenceDraft, EvidenceKind, KnowledgeBasis,
    KnowledgeEdge, KnowledgeGraph, KnowledgeItem, KnowledgeItemDraft, KnowledgeKind, MessageState,
    RelationKind, ReviewState, ThreadConversation, ThreadMessage, ThreadSummary,
    UpdateKnowledgeRequest,
};

const SCHEMA_VERSION: i64 = 5;

const THREAD_TITLE: &str = "SELECT COALESCE((SELECT substr(body, 1, 40) FROM messages
    WHERE thread_id = threads.id AND role = 'user' ORDER BY created_at, rowid LIMIT 1), '新对话')";

#[derive(Clone, Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BookRecord {
    pub id: String,
    pub edition_id: String,
    pub title: String,
    pub stored_path: String,
    pub format: String,
    pub last_page: i64,
    pub updated_at: i64,
}

#[derive(Clone, Debug, serde::Serialize)]
pub struct BookReference {
    pub id: String,
    pub title: String,
}

#[derive(Debug, Error)]
pub enum StorageError {
    #[error("数据库错误：{0}")]
    Database(#[from] rusqlite::Error),
    #[error("文件系统错误：{0}")]
    Io(#[from] std::io::Error),
    #[error("知识库输入无效：{0}")]
    InvalidInput(String),
    #[error("知识库数据无效：{0}")]
    InvalidData(String),
    #[error("知识库当前不可用")]
    LockPoisoned,
}

pub struct KnowledgeStore {
    connection: Mutex<Connection>,
}

impl KnowledgeStore {
    pub fn open(path: &Path) -> Result<Self, StorageError> {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent)?;
        }
        let mut connection = Connection::open(path)?;
        connection.execute_batch("PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;")?;
        migrate(&mut connection)?;
        Ok(Self {
            connection: Mutex::new(connection),
        })
    }

    #[cfg(test)]
    fn in_memory() -> Result<Self, StorageError> {
        let mut connection = Connection::open_in_memory()?;
        connection.execute_batch("PRAGMA foreign_keys = ON;")?;
        migrate(&mut connection)?;
        Ok(Self {
            connection: Mutex::new(connection),
        })
    }

    pub fn create_evidence(&self, draft: &EvidenceDraft) -> Result<String, StorageError> {
        if draft.text_snapshot.is_none() && draft.asset_hash.is_none() && draft.source_url.is_none()
        {
            return Err(StorageError::InvalidInput(
                "证据必须包含文字快照、附件或来源地址".into(),
            ));
        }
        let id = new_id();
        self.lock()?.execute(
            "INSERT INTO evidence (
                id, kind, book_id, edition_id, chapter_id, locator_json,
                text_snapshot, asset_hash, source_url, created_at
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            params![
                id,
                draft.kind.as_str(),
                draft.book_id,
                draft.edition_id,
                draft.chapter_id,
                serde_json::to_string(&draft.locator)
                    .map_err(|error| StorageError::InvalidInput(error.to_string()))?,
                draft.text_snapshot,
                draft.asset_hash,
                draft.source_url,
                now_millis(),
            ],
        )?;
        Ok(id)
    }

    pub fn import_book(
        &self,
        title: &str,
        file_hash: &str,
        format: &str,
        original_name: &str,
        stored_path: &Path,
        file_size: u64,
    ) -> Result<BookRecord, StorageError> {
        let mut connection = self.lock()?;
        if let Some(book) = connection
            .query_row(
                "SELECT b.id, e.id, b.title, e.stored_path, e.format, b.last_page, b.updated_at
                 FROM editions e JOIN books b ON b.id = e.book_id
                 WHERE e.file_hash = ?",
                [file_hash],
                row_to_book,
            )
            .optional()?
        {
            if book.stored_path != stored_path.to_string_lossy() {
                connection.execute(
                    "UPDATE editions SET stored_path = ?, file_size = ? WHERE id = ?",
                    params![
                        stored_path.to_string_lossy(),
                        file_size as i64,
                        book.edition_id
                    ],
                )?;
            }
            return Ok(BookRecord {
                stored_path: stored_path.to_string_lossy().into_owned(),
                ..book
            });
        }

        let now = now_millis();
        let book_id = new_id();
        let edition_id = new_id();
        let transaction = connection.transaction()?;
        transaction.execute(
            "INSERT INTO books (id, title, created_at, updated_at, last_page, last_opened_at)
             VALUES (?, ?, ?, ?, 1, ?)",
            params![book_id, title, now, now, now],
        )?;
        transaction.execute(
            "INSERT INTO editions (
                id, book_id, file_hash, format, original_name, created_at, stored_path, file_size
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            params![
                edition_id,
                book_id,
                file_hash,
                format,
                original_name,
                now,
                stored_path.to_string_lossy(),
                file_size as i64,
            ],
        )?;
        transaction.commit()?;
        Ok(BookRecord {
            id: book_id,
            edition_id,
            title: title.into(),
            stored_path: stored_path.to_string_lossy().into_owned(),
            format: format.into(),
            last_page: 1,
            updated_at: now,
        })
    }

    pub fn list_books(&self) -> Result<Vec<BookRecord>, StorageError> {
        let connection = self.lock()?;
        let mut statement = connection.prepare(
            "SELECT b.id, e.id, b.title, e.stored_path, e.format, b.last_page, b.updated_at
             FROM books b JOIN editions e ON e.book_id = b.id
             WHERE e.stored_path IS NOT NULL
             ORDER BY COALESCE(b.last_opened_at, b.updated_at) DESC",
        )?;
        statement
            .query_map([], row_to_book)?
            .collect::<Result<Vec<_>, _>>()
            .map_err(StorageError::from)
    }

    pub fn rename_book(&self, book_id: &str, title: &str) -> Result<BookRecord, StorageError> {
        let title = title.trim();
        if title.is_empty() || title.chars().count() > 200 {
            return Err(StorageError::InvalidInput(
                "书名必须为 1 至 200 个字符".into(),
            ));
        }
        let changed = self.lock()?.execute(
            "UPDATE books SET title = ?, updated_at = ? WHERE id = ?",
            params![title, now_millis(), book_id],
        )?;
        if changed == 0 {
            return Err(StorageError::InvalidInput("书籍不存在".into()));
        }
        self.lock()?
            .query_row(
                "SELECT b.id, e.id, b.title, e.stored_path, e.format, b.last_page, b.updated_at
                 FROM books b JOIN editions e ON e.book_id = b.id
                 WHERE b.id = ? LIMIT 1",
                [book_id],
                row_to_book,
            )
            .map_err(StorageError::from)
    }

    pub fn save_reading_page(&self, book_id: &str, page: i64) -> Result<(), StorageError> {
        if page < 1 {
            return Err(StorageError::InvalidInput("阅读页码必须大于零".into()));
        }
        let changed = self.lock()?.execute(
            "UPDATE books SET last_page = ?, last_opened_at = ?, updated_at = ? WHERE id = ?",
            params![page, now_millis(), now_millis(), book_id],
        )?;
        if changed == 0 {
            return Err(StorageError::InvalidInput("书籍不存在".into()));
        }
        Ok(())
    }

    pub fn remove_book_file(&self, book_id: &str) -> Result<Option<String>, StorageError> {
        let mut connection = self.lock()?;
        let transaction = connection.transaction()?;
        let path = transaction
            .query_row(
                "SELECT stored_path FROM editions WHERE book_id = ? LIMIT 1",
                [book_id],
                |row| row.get::<_, Option<String>>(0),
            )
            .optional()?
            .flatten();
        transaction.execute("DELETE FROM editions WHERE book_id = ?", [book_id])?;
        transaction.commit()?;
        Ok(path)
    }

    pub fn get_setting(&self, key: &str) -> Result<Option<String>, StorageError> {
        self.lock()?
            .query_row(
                "SELECT value FROM app_settings WHERE key = ?",
                [key],
                |row| row.get(0),
            )
            .optional()
            .map_err(StorageError::from)
    }

    pub fn set_setting(&self, key: &str, value: &str) -> Result<(), StorageError> {
        self.lock()?.execute(
            "INSERT INTO app_settings (key, value) VALUES (?, ?)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            params![key, value],
        )?;
        Ok(())
    }

    pub fn create_item(&self, draft: &KnowledgeItemDraft) -> Result<KnowledgeItem, StorageError> {
        if draft.body_md.trim().is_empty() {
            return Err(StorageError::InvalidInput("知识项正文不能为空".into()));
        }
        let id = new_id();
        let now = now_millis();
        self.lock()?.execute(
            "INSERT INTO knowledge_items (
                id, kind, book_id, chapter_id, category, title, body_md,
                creator, basis, review_state, created_at, updated_at
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            params![
                id,
                draft.kind.as_str(),
                draft.book_id,
                draft.chapter_id,
                normalized_optional(draft.category.as_deref()),
                draft.title,
                draft.body_md.trim(),
                draft.creator.as_str(),
                draft.basis.as_str(),
                draft.review_state.as_str(),
                now,
                now,
            ],
        )?;
        self.get_item(&id)?
            .ok_or_else(|| StorageError::InvalidData(format!("刚创建的知识项不存在：{id}")))
    }

    pub fn update_item(
        &self,
        request: &UpdateKnowledgeRequest,
    ) -> Result<KnowledgeItem, StorageError> {
        if request.body_md.trim().is_empty() {
            return Err(StorageError::InvalidInput("知识项正文不能为空".into()));
        }
        let changed = self.lock()?.execute(
            "UPDATE knowledge_items
             SET kind = ?, book_id = ?, category = ?, title = ?, body_md = ?, updated_at = ?
             WHERE id = ?",
            params![
                request.kind.as_str(),
                request.book_id,
                normalized_optional(request.category.as_deref()),
                normalized_optional(request.title.as_deref()),
                request.body_md.trim(),
                now_millis(),
                request.id,
            ],
        )?;
        if changed == 0 {
            return Err(StorageError::InvalidInput("知识项不存在".into()));
        }
        self.get_item(&request.id)?
            .ok_or_else(|| StorageError::InvalidData("更新后的知识项不存在".into()))
    }

    pub fn delete_item(&self, id: &str) -> Result<(), StorageError> {
        let mut connection = self.lock()?;
        let transaction = connection.transaction()?;
        let changed = transaction.execute("DELETE FROM knowledge_items WHERE id = ?", [id])?;
        if changed == 0 {
            return Err(StorageError::InvalidInput("知识项不存在".into()));
        }
        transaction.execute(
            "DELETE FROM evidence WHERE id NOT IN (SELECT evidence_id FROM item_evidence)",
            [],
        )?;
        transaction.commit()?;
        Ok(())
    }

    pub fn list_book_references(&self) -> Result<Vec<BookReference>, StorageError> {
        let connection = self.lock()?;
        let mut statement = connection.prepare("SELECT id, title FROM books ORDER BY title")?;
        statement
            .query_map([], |row| {
                Ok(BookReference {
                    id: row.get(0)?,
                    title: row.get(1)?,
                })
            })?
            .collect::<Result<Vec<_>, _>>()
            .map_err(StorageError::from)
    }

    pub fn attach_evidence(
        &self,
        item_id: &str,
        evidence_id: &str,
        role: &str,
    ) -> Result<(), StorageError> {
        if !matches!(role, "quotes" | "basis" | "context") {
            return Err(StorageError::InvalidInput(format!(
                "不支持的证据角色：{role}"
            )));
        }
        self.lock()?.execute(
            "INSERT INTO item_evidence (item_id, evidence_id, role) VALUES (?, ?, ?)",
            params![item_id, evidence_id, role],
        )?;
        Ok(())
    }

    pub fn add_edge(
        &self,
        from_item_id: &str,
        to_item_id: &str,
        relation: RelationKind,
        creator: Creator,
        review_state: ReviewState,
        confidence: Option<f64>,
    ) -> Result<KnowledgeEdge, StorageError> {
        if from_item_id == to_item_id {
            return Err(StorageError::InvalidInput("知识项不能关联自身".into()));
        }
        if confidence.is_some_and(|value| !(0.0..=1.0).contains(&value)) {
            return Err(StorageError::InvalidInput(
                "关系置信度必须介于 0 和 1 之间".into(),
            ));
        }
        let edge = KnowledgeEdge {
            id: new_id(),
            from_item_id: from_item_id.into(),
            to_item_id: to_item_id.into(),
            relation,
            creator,
            review_state,
            confidence,
            created_at: now_millis(),
        };
        self.lock()?.execute(
            "INSERT INTO knowledge_edges (
                id, from_item_id, to_item_id, relation, creator,
                review_state, confidence, created_at
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            params![
                edge.id,
                edge.from_item_id,
                edge.to_item_id,
                edge.relation.as_str(),
                edge.creator.as_str(),
                edge.review_state.as_str(),
                edge.confidence,
                edge.created_at,
            ],
        )?;
        Ok(edge)
    }

    pub fn get_item(&self, id: &str) -> Result<Option<KnowledgeItem>, StorageError> {
        self.lock()?
            .query_row(
                "SELECT id, kind, book_id, chapter_id, category, title, body_md,
                        creator, basis, review_state, created_at, updated_at
                 FROM knowledge_items WHERE id = ?",
                [id],
                row_to_item,
            )
            .optional()
            .map_err(StorageError::from)
    }

    pub fn search(&self, query: &str, limit: usize) -> Result<Vec<KnowledgeItem>, StorageError> {
        if query.trim().is_empty() || limit == 0 {
            return Ok(Vec::new());
        }
        let connection = self.lock()?;
        if query.trim().chars().count() < 3 {
            let mut statement = connection.prepare(
                "SELECT id, kind, book_id, chapter_id, category, title, body_md,
                        creator, basis, review_state, created_at, updated_at
                 FROM knowledge_items
                 WHERE review_state = 'confirmed' AND (title LIKE ? OR body_md LIKE ?)
                 ORDER BY updated_at DESC LIMIT ?",
            )?;
            let pattern = format!("%{}%", query.trim());
            return collect_items(
                statement.query_map(params![pattern, pattern, limit as i64], row_to_item)?,
            );
        }
        let mut statement = connection.prepare(
            "SELECT i.id, i.kind, i.book_id, i.chapter_id, i.category, i.title, i.body_md,
                    i.creator, i.basis, i.review_state, i.created_at, i.updated_at
             FROM knowledge_items_fts f
             JOIN knowledge_items i ON i.rowid = f.rowid
             WHERE knowledge_items_fts MATCH ? AND i.review_state = 'confirmed'
             ORDER BY bm25(knowledge_items_fts)
             LIMIT ?",
        )?;
        collect_items(statement.query_map(params![fts_query(query), limit as i64], row_to_item)?)
    }

    pub fn related(&self, item_id: &str, limit: usize) -> Result<Vec<KnowledgeItem>, StorageError> {
        if limit == 0 {
            return Ok(Vec::new());
        }
        let connection = self.lock()?;
        let mut statement = connection.prepare(
            "SELECT DISTINCT i.id, i.kind, i.book_id, i.chapter_id, i.category, i.title, i.body_md,
                    i.creator, i.basis, i.review_state, i.created_at, i.updated_at
             FROM knowledge_edges e
             JOIN knowledge_items i ON i.id = CASE
                 WHEN e.from_item_id = ? THEN e.to_item_id ELSE e.from_item_id END
             WHERE (e.from_item_id = ? OR e.to_item_id = ?)
               AND e.review_state = 'confirmed'
               AND i.review_state = 'confirmed'
             ORDER BY e.created_at DESC
             LIMIT ?",
        )?;
        collect_items(statement.query_map(
            params![item_id, item_id, item_id, limit as i64],
            row_to_item,
        )?)
    }

    pub fn list_items(
        &self,
        book_id: Option<&str>,
        limit: usize,
    ) -> Result<Vec<KnowledgeItem>, StorageError> {
        let connection = self.lock()?;
        let mut statement = connection.prepare(
            "SELECT id, kind, book_id, chapter_id, category, title, body_md,
                    creator, basis, review_state, created_at, updated_at
             FROM knowledge_items
             WHERE review_state = 'confirmed' AND (? IS NULL OR book_id = ?)
             ORDER BY updated_at DESC LIMIT ?",
        )?;
        collect_items(statement.query_map(params![book_id, book_id, limit as i64], row_to_item)?)
    }

    pub fn graph(&self, limit: usize) -> Result<KnowledgeGraph, StorageError> {
        let items = self.list_items(None, limit)?;
        let ids = items
            .iter()
            .map(|item| item.id.as_str())
            .collect::<Vec<_>>();
        if ids.is_empty() {
            return Ok(KnowledgeGraph {
                items,
                edges: Vec::new(),
            });
        }
        let connection = self.lock()?;
        let mut statement = connection.prepare(
            "SELECT id, from_item_id, to_item_id, relation, creator,
                    review_state, confidence, created_at
             FROM knowledge_edges WHERE review_state = 'confirmed'
             ORDER BY created_at DESC LIMIT 200",
        )?;
        let edges = statement
            .query_map([], row_to_edge)?
            .filter_map(Result::ok)
            .filter(|edge| {
                ids.contains(&edge.from_item_id.as_str()) && ids.contains(&edge.to_item_id.as_str())
            })
            .collect();
        Ok(KnowledgeGraph { items, edges })
    }

    pub fn evidence_for_item(&self, item_id: &str) -> Result<Vec<Evidence>, StorageError> {
        let connection = self.lock()?;
        let mut statement = connection.prepare(
            "SELECT e.id, e.kind, e.book_id, e.chapter_id, e.locator_json,
                    e.text_snapshot, e.asset_hash, e.source_url, e.created_at
             FROM item_evidence ie JOIN evidence e ON e.id = ie.evidence_id
             WHERE ie.item_id = ? ORDER BY e.created_at",
        )?;
        statement
            .query_map([item_id], row_to_evidence)?
            .collect::<Result<Vec<_>, _>>()
            .map_err(StorageError::from)
    }

    pub fn edges_for_item(&self, item_id: &str) -> Result<Vec<KnowledgeEdge>, StorageError> {
        let connection = self.lock()?;
        let mut statement = connection.prepare(
            "SELECT id, from_item_id, to_item_id, relation, creator,
                    review_state, confidence, created_at
             FROM knowledge_edges
             WHERE (from_item_id = ? OR to_item_id = ?) AND review_state = 'confirmed'
             ORDER BY created_at",
        )?;
        statement
            .query_map(params![item_id, item_id], row_to_edge)?
            .collect::<Result<Vec<_>, _>>()
            .map_err(StorageError::from)
    }

    pub fn append_message(
        &self,
        request: &AppendMessageRequest,
    ) -> Result<ThreadConversation, StorageError> {
        let AppendMessageRequest {
            thread_id,
            mode,
            book_id,
            page,
            role,
            body,
            context_json,
            state,
        } = request;
        validate_thread_mode(mode)?;
        if !matches!(role.as_str(), "user" | "assistant")
            || (body.trim().is_empty() && (role != "assistant" || *state == MessageState::Complete))
        {
            return Err(StorageError::InvalidInput("会话消息无效".into()));
        }
        if let Some(context) = context_json {
            serde_json::from_str::<serde_json::Value>(context).map_err(|_| {
                StorageError::InvalidInput("消息 contextJson 必须为有效 JSON".into())
            })?;
        }
        let mut connection = self.lock()?;
        let transaction = connection.transaction()?;
        let id = thread_id.clone().unwrap_or_else(new_id);
        let now = now_millis();
        if thread_id.is_none() {
            transaction.execute(
                "INSERT INTO threads (
                    id, mode, book_id, chapter_id, locator_json, status, created_at, updated_at
                 ) VALUES (?, ?, ?, ?, ?, 'active', ?, ?)",
                params![
                    id,
                    mode,
                    book_id,
                    format!("page-{page}"),
                    serde_json::json!({"page": page}).to_string(),
                    now,
                    now,
                ],
            )?;
            transaction.execute(
                "INSERT INTO selected_threads (book_id, thread_id) VALUES (?, ?)
                 ON CONFLICT(book_id) DO UPDATE SET thread_id = excluded.thread_id",
                params![book_id, id],
            )?;
        } else {
            let changed = transaction.execute(
                "UPDATE threads SET updated_at = ?, locator_json = ? WHERE id = ? AND book_id = ? AND mode = ?",
                params![
                    now,
                    serde_json::json!({"page": page}).to_string(),
                    id,
                    book_id,
                    mode
                ],
            )?;
            if changed == 0 {
                return Err(StorageError::InvalidInput("会话不存在".into()));
            }
        }
        transaction.execute(
            "INSERT INTO messages (id, thread_id, role, body, created_at, context_json, state)
             VALUES (?, ?, ?, ?, ?, ?, ?)",
            params![
                new_id(),
                id,
                role,
                body.trim(),
                now,
                context_json,
                state.as_str()
            ],
        )?;
        transaction.commit()?;
        drop(connection);
        self.load_thread(&id)?
            .ok_or_else(|| StorageError::InvalidData(format!("刚保存的会话不存在：{id}")))
    }

    pub fn load_latest_thread(
        &self,
        book_id: &str,
        mode: &str,
    ) -> Result<Option<ThreadConversation>, StorageError> {
        validate_thread_mode(mode)?;
        let id = self
            .lock()?
            .query_row(
                "SELECT threads.id FROM threads
                 LEFT JOIN selected_threads selected ON selected.book_id = threads.book_id
                 AND selected.thread_id = threads.id
                 WHERE threads.book_id = ? AND mode = ?
                 AND (selected.thread_id IS NOT NULL OR status = 'active')
                 ORDER BY (selected.thread_id IS NOT NULL) DESC, updated_at DESC, threads.rowid DESC LIMIT 1",
                params![book_id, mode],
                |row| row.get::<_, String>(0),
            )
            .optional()?;
        id.map(|id| self.load_thread(&id))
            .transpose()
            .map(Option::flatten)
    }

    pub fn list_threads_for_book(
        &self,
        book_id: &str,
        mode: &str,
    ) -> Result<Vec<ThreadSummary>, StorageError> {
        validate_thread_mode(mode)?;
        let connection = self.lock()?;
        let mut statement = connection.prepare(&format!(
            "SELECT id, ({THREAD_TITLE}), updated_at, locator_json FROM threads
             WHERE book_id = ? AND mode = ? ORDER BY updated_at DESC, rowid DESC"
        ))?;
        statement
            .query_map(params![book_id, mode], |row| {
                let locator: String = row.get(3)?;
                let locator: serde_json::Value =
                    serde_json::from_str(&locator).map_err(|_| invalid_column(3, locator))?;
                Ok(ThreadSummary {
                    id: row.get(0)?,
                    title: row.get(1)?,
                    updated_at: row.get(2)?,
                    page: locator["page"].as_i64().unwrap_or(1),
                })
            })?
            .collect::<Result<Vec<_>, _>>()
            .map_err(StorageError::from)
    }

    pub fn create_thread_for_book(
        &self,
        book_id: &str,
        mode: &str,
    ) -> Result<ThreadConversation, StorageError> {
        validate_thread_mode(mode)?;
        let mut connection = self.lock()?;
        let transaction = connection.transaction()?;
        let page = transaction
            .query_row(
                "SELECT last_page FROM books WHERE id = ?",
                [book_id],
                |row| row.get::<_, i64>(0),
            )
            .optional()?
            .ok_or_else(|| StorageError::InvalidInput("书籍不存在".into()))?;
        let id = new_id();
        let now = now_millis();
        transaction.execute(
            "INSERT INTO threads (id, mode, book_id, chapter_id, locator_json, status, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, 'active', ?, ?)",
            params![id, mode, book_id, format!("page-{page}"), serde_json::json!({"page": page}).to_string(), now, now],
        )?;
        transaction.execute(
            "INSERT INTO selected_threads (book_id, thread_id) VALUES (?, ?)
             ON CONFLICT(book_id) DO UPDATE SET thread_id = excluded.thread_id",
            params![book_id, id],
        )?;
        transaction.commit()?;
        Ok(ThreadConversation {
            id,
            title: "新对话".into(),
            messages: Vec::new(),
        })
    }

    pub fn select_thread(
        &self,
        id: &str,
        book_id: &str,
    ) -> Result<ThreadConversation, StorageError> {
        let changed = self.lock()?.execute(
            "INSERT INTO selected_threads (book_id, thread_id)
             SELECT book_id, id FROM threads WHERE id = ? AND book_id = ?
             ON CONFLICT(book_id) DO UPDATE SET thread_id = excluded.thread_id",
            params![id, book_id],
        )?;
        if changed == 0 {
            return Err(StorageError::InvalidInput(
                "会话不存在或不属于该书籍".into(),
            ));
        }
        self.load_thread(id)?
            .ok_or_else(|| StorageError::InvalidData("所选会话不存在".into()))
    }

    pub fn close_thread(&self, id: &str, book_id: &str) -> Result<(), StorageError> {
        let changed = self.lock()?.execute(
            "UPDATE threads SET status = 'closed', updated_at = ? WHERE id = ? AND book_id = ?",
            params![now_millis(), id, book_id],
        )?;
        if changed == 0 {
            return Err(StorageError::InvalidInput("会话不存在".into()));
        }
        Ok(())
    }

    fn load_thread(&self, id: &str) -> Result<Option<ThreadConversation>, StorageError> {
        let connection = self.lock()?;
        let title = connection
            .query_row(
                &format!("{THREAD_TITLE} FROM threads WHERE id = ?"),
                [id],
                |row| row.get::<_, String>(0),
            )
            .optional()?;
        let Some(title) = title else {
            return Ok(None);
        };
        let mut statement = connection.prepare(
            "SELECT id, role, body, created_at, context_json, state FROM messages
             WHERE thread_id = ? ORDER BY created_at, rowid",
        )?;
        let messages = statement
            .query_map([id], |row| {
                Ok(ThreadMessage {
                    id: row.get(0)?,
                    role: row.get(1)?,
                    body: row.get(2)?,
                    created_at: row.get(3)?,
                    context_json: row.get(4)?,
                    state: match row.get::<_, String>(5)?.as_str() {
                        "complete" => MessageState::Complete,
                        "interrupted" => MessageState::Interrupted,
                        "failed" => MessageState::Failed,
                        value => return Err(invalid_column(5, value.into())),
                    },
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(Some(ThreadConversation {
            id: id.into(),
            title,
            messages,
        }))
    }

    fn lock(&self) -> Result<MutexGuard<'_, Connection>, StorageError> {
        self.connection
            .lock()
            .map_err(|_| StorageError::LockPoisoned)
    }
}

fn validate_thread_mode(mode: &str) -> Result<(), StorageError> {
    if !matches!(mode, "thought" | "record") {
        return Err(StorageError::InvalidInput("会话模式无效".into()));
    }
    Ok(())
}

fn migrate(connection: &mut Connection) -> Result<(), StorageError> {
    connection.execute_batch(
        "CREATE TABLE IF NOT EXISTS schema_migrations (
            version INTEGER PRIMARY KEY,
            applied_at INTEGER NOT NULL
        );",
    )?;
    let current = connection.query_row(
        "SELECT COALESCE(MAX(version), 0) FROM schema_migrations",
        [],
        |row| row.get::<_, i64>(0),
    )?;
    if current < 1 {
        let transaction = connection.transaction()?;
        transaction.execute_batch(include_str!("../migrations/0001_knowledge.sql"))?;
        transaction.execute(
            "INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)",
            params![1, now_millis()],
        )?;
        transaction.commit()?;
    }
    if current < 2 {
        let transaction = connection.transaction()?;
        transaction.execute_batch(include_str!("../migrations/0002_library.sql"))?;
        transaction.execute(
            "INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)",
            params![2, now_millis()],
        )?;
        transaction.commit()?;
    }
    if current < 3 {
        let transaction = connection.transaction()?;
        transaction.execute_batch(include_str!("../migrations/0003_chinese_fts.sql"))?;
        transaction.execute(
            "INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)",
            params![3, now_millis()],
        )?;
        transaction.commit()?;
    }
    if current < 4 {
        let transaction = connection.transaction()?;
        transaction.execute_batch(include_str!("../migrations/0004_knowledge_categories.sql"))?;
        transaction.execute(
            "INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)",
            params![4, now_millis()],
        )?;
        transaction.commit()?;
    }
    if current < SCHEMA_VERSION {
        let transaction = connection.transaction()?;
        transaction.execute_batch(include_str!("../migrations/0005_thread_management.sql"))?;
        transaction.execute(
            "INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)",
            params![SCHEMA_VERSION, now_millis()],
        )?;
        transaction.commit()?;
    }
    Ok(())
}

fn row_to_book(row: &Row<'_>) -> rusqlite::Result<BookRecord> {
    Ok(BookRecord {
        id: row.get(0)?,
        edition_id: row.get(1)?,
        title: row.get(2)?,
        stored_path: row.get::<_, Option<String>>(3)?.unwrap_or_default(),
        format: row.get(4)?,
        last_page: row.get(5)?,
        updated_at: row.get(6)?,
    })
}

fn row_to_item(row: &Row<'_>) -> rusqlite::Result<KnowledgeItem> {
    let kind: String = row.get(1)?;
    let creator: String = row.get(7)?;
    let basis: String = row.get(8)?;
    let review_state: String = row.get(9)?;
    Ok(KnowledgeItem {
        id: row.get(0)?,
        kind: KnowledgeKind::parse(&kind).ok_or_else(|| invalid_column(1, kind))?,
        book_id: row.get(2)?,
        chapter_id: row.get(3)?,
        category: row.get(4)?,
        title: row.get(5)?,
        body_md: row.get(6)?,
        creator: Creator::parse(&creator).ok_or_else(|| invalid_column(7, creator))?,
        basis: KnowledgeBasis::parse(&basis).ok_or_else(|| invalid_column(8, basis))?,
        review_state: ReviewState::parse(&review_state)
            .ok_or_else(|| invalid_column(9, review_state))?,
        created_at: row.get(10)?,
        updated_at: row.get(11)?,
    })
}

fn normalized_optional(value: Option<&str>) -> Option<&str> {
    value.map(str::trim).filter(|value| !value.is_empty())
}

fn row_to_edge(row: &Row<'_>) -> rusqlite::Result<KnowledgeEdge> {
    let relation: String = row.get(3)?;
    let creator: String = row.get(4)?;
    let review_state: String = row.get(5)?;
    Ok(KnowledgeEdge {
        id: row.get(0)?,
        from_item_id: row.get(1)?,
        to_item_id: row.get(2)?,
        relation: RelationKind::parse(&relation).ok_or_else(|| invalid_column(3, relation))?,
        creator: Creator::parse(&creator).ok_or_else(|| invalid_column(4, creator))?,
        review_state: ReviewState::parse(&review_state)
            .ok_or_else(|| invalid_column(5, review_state))?,
        confidence: row.get(6)?,
        created_at: row.get(7)?,
    })
}

fn row_to_evidence(row: &Row<'_>) -> rusqlite::Result<Evidence> {
    let kind: String = row.get(1)?;
    let locator: String = row.get(4)?;
    Ok(Evidence {
        id: row.get(0)?,
        kind: match kind.as_str() {
            "text" => EvidenceKind::Text,
            "image" => EvidenceKind::Image,
            "external" => EvidenceKind::External,
            _ => return Err(invalid_column(1, kind)),
        },
        book_id: row.get(2)?,
        chapter_id: row.get(3)?,
        locator: serde_json::from_str(&locator).map_err(|error| {
            rusqlite::Error::FromSqlConversionFailure(
                4,
                rusqlite::types::Type::Text,
                Box::new(error),
            )
        })?,
        text_snapshot: row.get(5)?,
        asset_hash: row.get(6)?,
        source_url: row.get(7)?,
        created_at: row.get(8)?,
    })
}

fn invalid_column(index: usize, value: String) -> rusqlite::Error {
    rusqlite::Error::FromSqlConversionFailure(
        index,
        rusqlite::types::Type::Text,
        format!("未知枚举值：{value}").into(),
    )
}

fn collect_items(
    rows: rusqlite::MappedRows<'_, impl FnMut(&Row<'_>) -> rusqlite::Result<KnowledgeItem>>,
) -> Result<Vec<KnowledgeItem>, StorageError> {
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(StorageError::from)
}

fn fts_query(query: &str) -> String {
    let mut terms = Vec::new();
    for segment in query.split(|character: char| !character.is_alphanumeric()) {
        let characters = segment.chars().collect::<Vec<_>>();
        if characters.len() < 3 {
            continue;
        }
        if characters.iter().all(|character| character.is_ascii()) || characters.len() <= 6 {
            terms.push(segment.to_owned());
        } else {
            terms.extend(
                characters
                    .windows(3)
                    .map(|window| window.iter().collect::<String>()),
            );
        }
        if terms.len() >= 16 {
            break;
        }
    }
    if terms.is_empty() {
        terms.push(query.trim().to_owned());
    }
    terms
        .into_iter()
        .take(16)
        .map(|term| format!("\"{}\"", term.replace('"', "\"\"")))
        .collect::<Vec<_>>()
        .join(" OR ")
}

fn new_id() -> String {
    Uuid::now_v7().to_string()
}

fn now_millis() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;
    use crate::knowledge::{EvidenceKind, KnowledgeBasis};

    #[test]
    fn stores_searches_and_connects_confirmed_knowledge() {
        let store = KnowledgeStore::in_memory().unwrap();
        let evidence_id = store
            .create_evidence(&EvidenceDraft {
                kind: EvidenceKind::Text,
                book_id: None,
                edition_id: None,
                chapter_id: Some("chapter-1".into()),
                locator: json!({"page": 3}),
                text_snapshot: Some("知识来自可追溯的阅读证据".into()),
                asset_hash: None,
                source_url: None,
            })
            .unwrap();
        let thought = store
            .create_item(&KnowledgeItemDraft {
                kind: KnowledgeKind::Thought,
                book_id: None,
                chapter_id: Some("chapter-1".into()),
                category: None,
                title: Some("我的理解".into()),
                body_md: "知识来自可追溯的阅读证据。Evidence should remain traceable.".into(),
                creator: Creator::User,
                basis: KnowledgeBasis::Book,
                review_state: ReviewState::Confirmed,
            })
            .unwrap();
        store
            .attach_evidence(&thought.id, &evidence_id, "quotes")
            .unwrap();
        let summary = store
            .create_item(&KnowledgeItemDraft {
                kind: KnowledgeKind::Summary,
                book_id: None,
                chapter_id: Some("chapter-1".into()),
                category: None,
                title: Some("章节总结".into()),
                body_md: "Traceable evidence supports durable knowledge.".into(),
                creator: Creator::Ai,
                basis: KnowledgeBasis::Mixed,
                review_state: ReviewState::Confirmed,
            })
            .unwrap();
        store
            .add_edge(
                &summary.id,
                &thought.id,
                RelationKind::DerivedFrom,
                Creator::Ai,
                ReviewState::Confirmed,
                Some(0.9),
            )
            .unwrap();

        assert_eq!(
            store.search("durable knowledge", 10).unwrap(),
            vec![summary]
        );
        assert_eq!(store.search("可追溯", 10).unwrap(), vec![thought.clone()]);
        assert_eq!(
            store.search("为什么知识需要保持可追溯？", 10).unwrap(),
            vec![thought.clone()]
        );
        assert_eq!(store.related(&thought.id, 10).unwrap().len(), 1);
        assert!(
            store
                .add_edge(
                    &thought.id,
                    &thought.id,
                    RelationKind::RelatedTo,
                    Creator::User,
                    ReviewState::Confirmed,
                    None,
                )
                .is_err()
        );

        let book_id = new_id();
        store
            .lock()
            .unwrap()
            .execute(
                "INSERT INTO books (id, title, created_at, updated_at) VALUES (?, '测试书籍', 0, 0)",
                [&book_id],
            )
            .unwrap();
        let thread = store
            .append_message(&message_request(None, &book_id, "user", "这里是什么意思？"))
            .unwrap();
        let thread = store
            .append_message(&message_request(
                Some(&thread.id),
                &book_id,
                "assistant",
                "这是一个可追溯的回答。",
            ))
            .unwrap();
        assert_eq!(thread.messages.len(), 2);
        assert_eq!(
            store
                .load_latest_thread(&book_id, "thought")
                .unwrap()
                .unwrap()
                .id,
            thread.id
        );

        let mut version_one = Connection::open_in_memory().unwrap();
        version_one
            .execute_batch(
                "PRAGMA foreign_keys = ON;
                 CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, applied_at INTEGER NOT NULL);",
            )
            .unwrap();
        version_one
            .execute_batch(include_str!("../migrations/0001_knowledge.sql"))
            .unwrap();
        version_one
            .execute("INSERT INTO schema_migrations VALUES (1, 0)", [])
            .unwrap();
        migrate(&mut version_one).unwrap();
        assert_eq!(
            version_one
                .query_row("SELECT MAX(version) FROM schema_migrations", [], |row| row
                    .get::<_, i64>(
                    0
                ))
                .unwrap(),
            SCHEMA_VERSION
        );
    }

    fn message_request(
        thread_id: Option<&str>,
        book_id: &str,
        role: &str,
        body: &str,
    ) -> AppendMessageRequest {
        serde_json::from_value(json!({
            "threadId": thread_id, "bookId": book_id, "mode": "thought",
            "page": 3, "role": role, "body": body,
        }))
        .unwrap()
    }

    #[test]
    fn thread_history_selection_and_v4_migration_persist() {
        let directory = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("target")
            .join(format!("thread-test-{}", new_id()));
        fs::create_dir_all(&directory).unwrap();
        let path = directory.join("state.sqlite");
        let connection = Connection::open(&path).unwrap();
        connection
            .execute_batch(include_str!("../migrations/0001_knowledge.sql"))
            .unwrap();
        connection
            .execute_batch(include_str!("../migrations/0002_library.sql"))
            .unwrap();
        connection
            .execute_batch(include_str!("../migrations/0003_chinese_fts.sql"))
            .unwrap();
        connection
            .execute_batch(include_str!("../migrations/0004_knowledge_categories.sql"))
            .unwrap();
        connection.execute_batch(
            "CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, applied_at INTEGER NOT NULL);
             INSERT INTO schema_migrations VALUES (4, 0);
             INSERT INTO books (id, title, created_at, updated_at, last_page) VALUES ('book', '书', 0, 0, 7), ('other', '另一本', 0, 0, 1);
             INSERT INTO threads (id, mode, book_id, status, created_at, updated_at) VALUES
             ('old-closed', 'thought', 'book', 'closed', 0, 30),
             ('old-active', 'thought', 'book', 'active', 0, 20),
             ('older-active', 'thought', 'book', 'active', 0, 10);
             INSERT INTO messages (id, thread_id, role, body, created_at) VALUES ('old-message', 'old-closed', 'user', '旧问题', 0);"
        ).unwrap();
        drop(connection);

        let store = KnowledgeStore::open(&path).unwrap();
        assert_eq!(
            store
                .load_latest_thread("book", "thought")
                .unwrap()
                .unwrap()
                .id,
            "old-active"
        );
        let history = store.list_threads_for_book("book", "thought").unwrap();
        assert_eq!(history.len(), 3);
        assert_eq!(history[0].id, "old-closed");
        assert_eq!(history[0].title, "旧问题");
        assert_eq!(history[0].page, 1);
        let closed = store.select_thread("old-closed", "book").unwrap();
        assert_eq!(closed.messages[0].state, MessageState::Complete);
        assert!(closed.messages[0].context_json.is_none());
        assert_eq!(
            store
                .load_latest_thread("book", "thought")
                .unwrap()
                .unwrap()
                .id,
            closed.id
        );
        let lifecycle: (String, i64) = store
            .lock()
            .unwrap()
            .query_row(
                "SELECT status, updated_at FROM threads WHERE id = 'old-closed'",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .unwrap();
        assert_eq!(lifecycle, ("closed".into(), 30));
        let continued = store
            .append_message(&message_request(
                Some(&closed.id),
                "book",
                "user",
                "继续提问",
            ))
            .unwrap();
        assert_eq!(continued.messages.len(), 2);
        assert_eq!(continued.title, "旧问题");
        assert!(store.select_thread(&closed.id, "other").is_err());
        assert!(store.select_thread("missing", "book").is_err());
        assert!(
            store
                .append_message(&message_request(Some(&closed.id), "other", "user", "跨书"))
                .is_err()
        );
        assert!(store.close_thread(&closed.id, "other").is_err());
        assert!(
            store
                .load_latest_thread("other", "thought")
                .unwrap()
                .is_none()
        );

        let empty = store.create_thread_for_book("book", "thought").unwrap();
        assert!(empty.messages.is_empty());
        assert_eq!(empty.title, "新对话");
        assert_eq!(
            store.list_threads_for_book("book", "thought").unwrap()[0].page,
            7
        );
        drop(store);
        let store = KnowledgeStore::open(&path).unwrap();
        let loaded = store
            .load_latest_thread("book", "thought")
            .unwrap()
            .unwrap();
        assert_eq!(loaded.id, empty.id);
        assert!(loaded.messages.is_empty());
        store.close_thread(&empty.id, "book").unwrap();
        assert_eq!(
            store
                .load_latest_thread("book", "thought")
                .unwrap()
                .unwrap()
                .id,
            empty.id
        );
        let record = store.create_thread_for_book("book", "record").unwrap();
        assert_eq!(
            store.list_threads_for_book("book", "record").unwrap().len(),
            1
        );
        assert_eq!(
            store
                .load_latest_thread("book", "record")
                .unwrap()
                .unwrap()
                .id,
            record.id
        );
        assert_ne!(
            store
                .load_latest_thread("book", "thought")
                .unwrap()
                .unwrap()
                .id,
            record.id
        );
        store.select_thread(&closed.id, "book").unwrap();
        drop(store);
        let store = KnowledgeStore::open(&path).unwrap();
        assert_eq!(
            store
                .load_latest_thread("book", "thought")
                .unwrap()
                .unwrap()
                .id,
            closed.id
        );
        assert_eq!(
            store
                .lock()
                .unwrap()
                .query_row("SELECT MAX(version) FROM schema_migrations", [], |row| row
                    .get::<_, i64>(
                    0
                ))
                .unwrap(),
            SCHEMA_VERSION
        );
        drop(store);
        fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn thread_message_context_state_and_validation() {
        let store = KnowledgeStore::in_memory().unwrap();
        store
            .lock()
            .unwrap()
            .execute(
                "INSERT INTO books (id, title, created_at, updated_at) VALUES ('book', '书', 0, 0)",
                [],
            )
            .unwrap();
        let mut request = message_request(None, "book", "user", &"问🦀".repeat(30));
        assert_eq!(request.state, MessageState::Complete);
        assert!(request.context_json.is_none());
        request.context_json = Some("{\"text\":\"原文\", \"page\":3,\"image\":null}".into());
        let thread = store.append_message(&request).unwrap();
        assert_eq!(thread.title, "问🦀".repeat(20));
        assert_eq!(thread.messages[0].context_json, request.context_json);
        let summary = store.list_threads_for_book("book", "thought").unwrap();
        assert_eq!(summary[0].title, thread.title);
        assert_eq!(summary[0].page, 3);
        request.thread_id = Some(thread.id.clone());
        request.role = "assistant".into();
        request.body = "  ".into();
        assert!(store.append_message(&request).is_err());
        for state in [MessageState::Interrupted, MessageState::Failed] {
            request.state = state;
            let saved = store.append_message(&request).unwrap();
            assert_eq!(saved.messages.last().unwrap().state, state);
            assert_eq!(saved.messages.last().unwrap().body, "");
        }
        request.role = "user".into();
        assert!(store.append_message(&request).is_err());
        request.body = "问题".into();
        request.context_json = Some("not json".into());
        assert!(store.append_message(&request).is_err());
        request.context_json = None;
        request.mode = "record".into();
        assert!(store.append_message(&request).is_err());
        request.mode = "invalid".into();
        assert!(store.append_message(&request).is_err());
        assert!(store.create_thread_for_book("book", "invalid").is_err());
        assert!(store.list_threads_for_book("book", "invalid").is_err());
        assert!(store.load_latest_thread("book", "invalid").is_err());
        assert!(store.create_thread_for_book("missing", "thought").is_err());
        assert!(serde_json::from_value::<AppendMessageRequest>(json!({
            "bookId": "book", "mode": "thought", "page": 1, "role": "assistant", "body": "", "state": "invalid"
        })).is_err());
        let loaded = store
            .load_latest_thread("book", "thought")
            .unwrap()
            .unwrap();
        assert_eq!(loaded.messages.len(), 3);
        let output = serde_json::to_value(loaded).unwrap();
        assert_eq!(
            output["messages"][0]["contextJson"],
            thread.messages[0].context_json.as_deref().unwrap()
        );
        assert_eq!(output["messages"][0]["state"], "complete");
        assert_eq!(output["messages"][2]["state"], "failed");
    }
}
