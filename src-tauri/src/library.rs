use std::{
    fmt::Write as _,
    fs,
    io::{BufReader, Read},
    path::{Path, PathBuf},
};

#[cfg(desktop)]
use rfd::AsyncFileDialog;
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Manager, State};

use crate::{history, storage::BookRecord, storage::KnowledgeStore};

#[tauri::command]
pub async fn import_book(
    app: AppHandle,
    store: State<'_, KnowledgeStore>,
) -> Result<Option<BookRecord>, String> {
    #[cfg(desktop)]
    let Some(handle) = AsyncFileDialog::new()
        .add_filter("电子书", &["pdf", "txt", "md", "markdown"])
        .pick_file()
        .await
    else {
        return Ok(None);
    };
    #[cfg(desktop)]
    let source = handle.path().to_path_buf();
    #[cfg(target_os = "android")]
    let Some(picked) = crate::mobile::pick_book(app.clone()).await? else {
        return Ok(None);
    };
    #[cfg(target_os = "android")]
    let source = picked.path.clone();
    let library_dir = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?
        .join("library");
    let imported = tauri::async_runtime::spawn_blocking(move || {
        let result = ingest(&source, &library_dir);
        #[cfg(target_os = "android")]
        let result = {
            let _ = fs::remove_file(&source);
            result.map(|mut imported| {
                imported.original_name = picked.name.clone();
                imported.title = Path::new(&picked.name)
                    .file_stem()
                    .and_then(|name| name.to_str())
                    .unwrap_or("导入书籍")
                    .into();
                imported
            })
        };
        result
    })
    .await
    .map_err(|error| error.to_string())??;
    let book = store
        .import_book(
            &imported.title,
            &imported.hash,
            &imported.format,
            &imported.original_name,
            &imported.path,
            imported.size,
        )
        .map_err(|error| error.to_string())?;
    history::archive_book(&app, &store, &book).map_err(|error| error.to_string())?;
    Ok(Some(book))
}

#[tauri::command]
pub fn list_books(store: State<'_, KnowledgeStore>) -> Result<Vec<BookRecord>, String> {
    store.list_books().map_err(|error| error.to_string())
}

#[tauri::command]
pub fn rename_book(
    app: AppHandle,
    store: State<'_, KnowledgeStore>,
    book_id: String,
    title: String,
) -> Result<BookRecord, String> {
    let book = store
        .rename_book(&book_id, &title)
        .map_err(|error| error.to_string())?;
    history::archive_book(&app, &store, &book).map_err(|error| error.to_string())?;
    Ok(book)
}

#[tauri::command]
pub fn save_reading_page(
    store: State<'_, KnowledgeStore>,
    book_id: String,
    page: i64,
) -> Result<(), String> {
    store
        .save_reading_page(&book_id, page)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn remove_book(
    app: AppHandle,
    store: State<'_, KnowledgeStore>,
    book_id: String,
) -> Result<(), String> {
    let library_dir = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?
        .join("library");
    if let Some(stored_path) = store
        .remove_book_file(&book_id)
        .map_err(|error| error.to_string())?
    {
        let path = PathBuf::from(stored_path);
        if path.starts_with(&library_dir) && path.exists() {
            fs::remove_file(path).map_err(|error| error.to_string())?;
        }
    }
    Ok(())
}

struct ImportedFile {
    title: String,
    original_name: String,
    format: String,
    hash: String,
    path: PathBuf,
    size: u64,
}

fn ingest(source: &Path, library_dir: &Path) -> Result<ImportedFile, String> {
    let format = source
        .extension()
        .and_then(|value| value.to_str())
        .map(str::to_ascii_lowercase)
        .ok_or("书籍文件格式无效")?;
    if !matches!(format.as_str(), "pdf" | "txt" | "md" | "markdown") {
        return Err("当前支持 PDF、TXT 和 Markdown 电子书".into());
    }
    let original_name = source
        .file_name()
        .and_then(|value| value.to_str())
        .ok_or("书籍文件名无效")?
        .to_owned();
    let title = source
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or(&original_name)
        .to_owned();
    let file = fs::File::open(source).map_err(|error| error.to_string())?;
    let size = file.metadata().map_err(|error| error.to_string())?.len();
    let mut reader = BufReader::new(file);
    let mut hasher = Sha256::new();
    let mut buffer = [0_u8; 1024 * 1024];
    loop {
        let read = reader
            .read(&mut buffer)
            .map_err(|error| error.to_string())?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
    }
    let mut hash = String::with_capacity(64);
    for byte in hasher.finalize() {
        write!(hash, "{byte:02x}").map_err(|error| error.to_string())?;
    }
    fs::create_dir_all(library_dir).map_err(|error| error.to_string())?;
    let path = library_dir.join(format!("{hash}.{format}"));
    if !path.exists() {
        let temporary = library_dir.join(format!("{hash}.part"));
        fs::copy(source, &temporary).map_err(|error| error.to_string())?;
        fs::rename(temporary, &path).map_err(|error| error.to_string())?;
    }
    Ok(ImportedFile {
        title,
        original_name,
        format,
        hash,
        path,
        size,
    })
}
