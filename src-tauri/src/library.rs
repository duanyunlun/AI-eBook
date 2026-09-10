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
        .add_filter("电子书", &["pdf", "txt", "md", "markdown", "epub"])
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
    if !matches!(format.as_str(), "pdf" | "txt" | "md" | "markdown" | "epub") {
        return Err("当前支持 PDF、TXT、Markdown 和 EPUB 电子书".into());
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
    // EPUB 入库时按 spine 提取正文，与其他文本格式共用同一套章节阅读和批注链路
    let stored = if format == "epub" {
        "md"
    } else {
        format.as_str()
    };
    let path = library_dir.join(format!("{hash}.{stored}"));
    if !path.exists() {
        let temporary = library_dir.join(format!("{hash}.part"));
        if format == "epub" {
            let text = crate::epub::extract_markdown(source)?;
            fs::write(&temporary, text).map_err(|error| error.to_string())?;
        } else {
            fs::copy(source, &temporary).map_err(|error| error.to_string())?;
        }
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

#[cfg(test)]
mod tests {
    use std::io::Write as _;

    use super::ingest;

    #[test]
    fn stores_epub_as_extracted_text() {
        let directory = std::env::temp_dir().join(format!("epub-ingest-{}", std::process::id()));
        let source = directory.join("探索.epub");
        let library = directory.join("library");
        std::fs::create_dir_all(&directory).unwrap();
        let mut writer = zip::ZipWriter::new(std::fs::File::create(&source).unwrap());
        let options: zip::write::SimpleFileOptions = Default::default();
        let mut add = |name: &str, body: &str| {
            writer.start_file(name, options).unwrap();
            writer.write_all(body.as_bytes()).unwrap();
        };
        add(
            "META-INF/container.xml",
            r#"<container><rootfiles><rootfile full-path="book.opf"/></rootfiles></container>"#,
        );
        add(
            "book.opf",
            r#"<package><manifest><item id="chapter" href="chapter.xhtml"/></manifest><spine><itemref idref="chapter"/></spine></package>"#,
        );
        add(
            "chapter.xhtml",
            "<html><body><h1>第一章</h1><p>正文内容。</p></body></html>",
        );
        writer.finish().unwrap();

        let imported = ingest(&source, &library).unwrap();
        assert_eq!(imported.format, "epub");
        assert_eq!(imported.path.extension().unwrap(), "md");
        assert_eq!(
            std::fs::read_to_string(&imported.path).unwrap(),
            "# 第一章\n\n正文内容。"
        );
        std::fs::remove_dir_all(&directory).unwrap();
    }
}
