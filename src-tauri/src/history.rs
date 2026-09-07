use std::{
    fs,
    path::{Path, PathBuf},
};

use git2::{Repository, Signature};
#[cfg(desktop)]
use rfd::AsyncFileDialog;
use tauri::{AppHandle, Manager, State};

use crate::{
    knowledge::{Evidence, KnowledgeEdge, KnowledgeItem},
    storage::{BookRecord, KnowledgeStore, StorageError},
};

const VAULT_PATH_KEY: &str = "vault_path";

#[tauri::command]
pub fn get_vault_path(app: AppHandle, store: State<'_, KnowledgeStore>) -> Result<String, String> {
    vault_path(&app, &store)
        .map(|path| path.to_string_lossy().into_owned())
        .map_err(|error| error.to_string())
}

#[tauri::command]
#[cfg(desktop)]
pub async fn choose_vault(
    app: AppHandle,
    store: State<'_, KnowledgeStore>,
) -> Result<Option<String>, String> {
    let Some(folder) = AsyncFileDialog::new().pick_folder().await else {
        return Ok(None);
    };
    let path = folder.path().to_path_buf();
    fs::create_dir_all(path.join("items")).map_err(|error| error.to_string())?;
    Repository::open(&path)
        .or_else(|_| Repository::init(&path))
        .map_err(|error| error.to_string())?;
    store
        .set_setting(VAULT_PATH_KEY, &path.to_string_lossy())
        .map_err(|error| error.to_string())?;
    let _ = app;
    Ok(Some(path.to_string_lossy().into_owned()))
}

#[cfg(mobile)]
#[tauri::command]
pub async fn choose_vault() -> Result<Option<String>, String> {
    Err("移动端知识库保存在应用私有目录，暂不支持更换目录".into())
}

pub fn archive_book(
    app: &AppHandle,
    store: &KnowledgeStore,
    book: &BookRecord,
) -> Result<(), HistoryError> {
    let vault = vault_path(app, store)?;
    let relative = PathBuf::from("books").join(&book.id).join("book.md");
    let content = format!(
        "---\nschema: 1\nid: {}\ntitle: {}\nformat: {}\n---\n\n# {}\n",
        yaml(&book.id),
        yaml(&book.title),
        yaml(&book.format),
        book.title
    );
    write_and_commit(
        &vault,
        &relative,
        &content,
        &format!("更新《{}》书籍信息", book.title),
        &[],
    )
}

pub fn store_asset(
    app: &AppHandle,
    store: &KnowledgeStore,
    hash: &str,
    bytes: &[u8],
) -> Result<(), HistoryError> {
    if hash.len() != 64 || !hash.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        return Err(HistoryError::InvalidAssetHash);
    }
    let path = vault_path(app, store)?
        .join("assets")
        .join(format!("{hash}.webp"));
    if !path.exists() {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent)?;
        }
        fs::write(path, bytes)?;
    }
    Ok(())
}

pub fn archive_item(
    app: &AppHandle,
    store: &KnowledgeStore,
    item: &KnowledgeItem,
    evidence: &[Evidence],
    edges: &[KnowledgeEdge],
) -> Result<(), HistoryError> {
    let vault = vault_path(app, store)?;
    let relative = PathBuf::from("items").join(format!("{}.md", item.id));
    let mut content = format!(
        "---\nschema: 1\nid: {}\nbook_id: {}\nchapter_id: {}\ncategory: {}\ntype: {}\ncreator: {}\nbasis: {}\nreview_state: {}\ncreated_at: {}\nevidence:\n",
        yaml(&item.id),
        yaml_option(item.book_id.as_deref()),
        yaml_option(item.chapter_id.as_deref()),
        yaml_option(item.category.as_deref()),
        yaml(item.kind.as_str()),
        yaml(item.creator.as_str()),
        yaml(item.basis.as_str()),
        yaml(item.review_state.as_str()),
        item.created_at,
    );
    for source in evidence {
        content.push_str(&format!(
            "  - id: {}\n    locator: {}\n",
            yaml(&source.id),
            serde_json::to_string(&source.locator)?
        ));
    }
    content.push_str("links:\n");
    for edge in edges {
        let target = if edge.from_item_id == item.id {
            &edge.to_item_id
        } else {
            &edge.from_item_id
        };
        content.push_str(&format!(
            "  - type: {}\n    target: {}\n",
            yaml(edge.relation.as_str()),
            yaml(target)
        ));
    }
    content.push_str("---\n\n");
    content.push_str(&format!(
        "# {}\n\n{}\n",
        item.title.as_deref().unwrap_or("未命名知识"),
        item.body_md
    ));
    for source in evidence
        .iter()
        .filter_map(|source| source.text_snapshot.as_deref())
    {
        content.push_str("\n## 来源摘录\n\n");
        for line in source.lines() {
            content.push_str(&format!("> {line}\n"));
        }
    }
    let assets = evidence
        .iter()
        .filter_map(|source| source.asset_hash.as_ref())
        .map(|hash| PathBuf::from("assets").join(format!("{hash}.webp")))
        .collect::<Vec<_>>();
    write_and_commit(&vault, &relative, &content, "记录阅读知识", &assets)
}

pub fn delete_item(app: &AppHandle, store: &KnowledgeStore, id: &str) -> Result<(), HistoryError> {
    let vault = vault_path(app, store)?;
    let relative = PathBuf::from("items").join(format!("{id}.md"));
    let path = vault.join(&relative);
    if !path.exists() {
        return Ok(());
    }
    fs::remove_file(path)?;
    let repository = Repository::open(&vault)?;
    let mut index = repository.index()?;
    index.remove_path(&relative)?;
    commit_index(&repository, &mut index, "删除阅读知识")
}

fn vault_path(app: &AppHandle, store: &KnowledgeStore) -> Result<PathBuf, HistoryError> {
    if let Some(path) = store.get_setting(VAULT_PATH_KEY)? {
        return Ok(PathBuf::from(path));
    }
    let path = app.path().app_data_dir()?.join("knowledge-vault");
    store.set_setting(VAULT_PATH_KEY, &path.to_string_lossy())?;
    Ok(path)
}

fn write_and_commit(
    vault: &Path,
    relative: &Path,
    content: &str,
    message: &str,
    extra_paths: &[PathBuf],
) -> Result<(), HistoryError> {
    let path = vault.join(relative);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let temporary = path.with_extension("tmp");
    fs::write(&temporary, content)?;
    fs::rename(temporary, &path)?;

    let repository = Repository::open(vault).or_else(|_| Repository::init(vault))?;
    let mut index = repository.index()?;
    index.add_path(relative)?;
    for extra in extra_paths {
        index.add_path(extra)?;
    }
    commit_index(&repository, &mut index, message)
}

fn commit_index(
    repository: &Repository,
    index: &mut git2::Index,
    message: &str,
) -> Result<(), HistoryError> {
    index.write()?;
    let tree_id = index.write_tree()?;
    let tree = repository.find_tree(tree_id)?;
    let signature = repository
        .signature()
        .or_else(|_| Signature::now("AI-eBook", "local@ai-ebook"))?;
    let parent = repository
        .head()
        .ok()
        .and_then(|head| head.target())
        .and_then(|id| repository.find_commit(id).ok());
    let parents = parent.iter().collect::<Vec<_>>();
    repository.commit(
        Some("HEAD"),
        &signature,
        &signature,
        message,
        &tree,
        &parents,
    )?;
    Ok(())
}

fn yaml(value: &str) -> String {
    serde_json::to_string(value).unwrap_or_else(|_| "\"\"".into())
}

fn yaml_option(value: Option<&str>) -> String {
    value.map(yaml).unwrap_or_else(|| "null".into())
}

#[derive(Debug, thiserror::Error)]
pub enum HistoryError {
    #[error(transparent)]
    Storage(#[from] StorageError),
    #[error(transparent)]
    Io(#[from] std::io::Error),
    #[error(transparent)]
    Git(#[from] git2::Error),
    #[error(transparent)]
    Tauri(#[from] tauri::Error),
    #[error(transparent)]
    Json(#[from] serde_json::Error),
    #[error("截图内容哈希无效")]
    InvalidAssetHash,
}
