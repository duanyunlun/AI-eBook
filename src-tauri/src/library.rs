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
        .add_filter(
            "电子书",
            &[
                "pdf", "txt", "md", "markdown", "epub", "fb2", "zip", "docx", "rtf", "mobi", "azw",
                "azw3", "html", "htm", "xhtml", "cbz", "cbr",
            ],
        )
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
            fs::remove_file(&path).map_err(|error| error.to_string())?;
        }
        // PDF 重排文本与书籍文件同名不同后缀，一并清理
        let derived = path.with_extension("md");
        if derived.starts_with(&library_dir) && derived.exists() {
            fs::remove_file(derived).map_err(|error| error.to_string())?;
        }
        // CBZ 的图片目录与清单同名
        let images = path.with_extension("");
        if images.starts_with(&library_dir) && images.is_dir() {
            fs::remove_dir_all(images).map_err(|error| error.to_string())?;
        }
    }
    Ok(())
}

/// 保存 PDF 重排正文，供阅读区在“重排”模式下按章节阅读。
#[tauri::command]
pub fn save_book_markdown(
    app: AppHandle,
    store: State<'_, KnowledgeStore>,
    book_id: String,
    markdown: String,
) -> Result<String, String> {
    const LIMIT: usize = 32 * 1024 * 1024;
    if markdown.trim().is_empty() {
        return Err("没有提取到可重排的正文".into());
    }
    if markdown.len() > LIMIT {
        return Err("重排文本超过 32 MB，已中止保存".into());
    }
    let library_dir = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?
        .join("library");
    let stored = store
        .book_stored_path(&book_id)
        .map_err(|error| error.to_string())?
        .ok_or("书籍文件不存在")?;
    let path = PathBuf::from(stored);
    if !path.starts_with(&library_dir) {
        return Err("书籍文件不在书库目录".into());
    }
    let target = path.with_extension("md");
    fs::write(&target, markdown).map_err(|error| error.to_string())?;
    Ok(target.to_string_lossy().into_owned())
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
    let format = file_format(source)?;
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
    // 可转换格式入库时只保存提取后的正文，与文本格式共用同一套章节阅读和批注链路
    let stored = if format == "cbz" {
        "json"
    } else {
        converted(&format)
    };
    let path = library_dir.join(format!("{hash}.{stored}"));
    if !path.exists() {
        let temporary = library_dir.join(format!("{hash}.part"));
        if format == "cbz" {
            let directory = library_dir.join(&hash);
            let images = crate::comic::extract_images(source, &directory).inspect_err(|_| {
                let _ = fs::remove_dir_all(&directory);
            })?;
            let manifest = serde_json::to_vec(&images).map_err(|error| error.to_string())?;
            fs::write(&temporary, manifest).map_err(|error| error.to_string())?;
        } else if converted(&format) == "md" {
            let text = extract_text(source, &format)?;
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

/// 识别格式；`.fb2.zip` 这类复合后缀按内层格式处理。
fn file_format(source: &Path) -> Result<String, String> {
    let name = source
        .file_name()
        .and_then(|value| value.to_str())
        .ok_or("书籍文件名无效")?
        .to_ascii_lowercase();
    if name.ends_with(".fb2.zip") {
        return Ok("fb2".into());
    }
    let format = name
        .rsplit_once('.')
        .map(|(_, value)| value)
        .unwrap_or_default();
    if format == "cbr" {
        // CBR 与 CBZ 共用漫画阅读链路，能否读取由包内内容（zip/RAR）决定
        return Ok("cbz".into());
    }
    if matches!(
        format,
        "pdf"
            | "txt"
            | "md"
            | "markdown"
            | "epub"
            | "fb2"
            | "docx"
            | "rtf"
            | "mobi"
            | "azw"
            | "azw3"
            | "html"
            | "htm"
            | "xhtml"
            | "cbz"
    ) {
        Ok(format.to_string())
    } else {
        Err(
            "当前支持 PDF、TXT、Markdown、EPUB、FB2、DOCX、RTF、MOBI/AZW3、HTML 和 CBZ/CBR 电子书"
                .into(),
        )
    }
}

/// 需要转成章节 Markdown 的格式返回 `md`，其余保持原格式入库。
fn converted(format: &str) -> &'static str {
    match format {
        "epub" | "fb2" | "docx" | "rtf" | "mobi" | "azw" | "azw3" | "html" | "htm" | "xhtml" => {
            "md"
        }
        _ => "source",
    }
}

fn extract_text(source: &Path, format: &str) -> Result<String, String> {
    let text = match format {
        "epub" => crate::epub::extract_markdown(source)?,
        "fb2" => crate::fb2::markdown(source)?,
        "docx" => crate::docx::markdown(source)?,
        "rtf" => crate::rtf::markdown(source)?,
        "mobi" | "azw" | "azw3" => crate::mobi::markdown(source)?,
        _ => {
            let html = fs::read_to_string(source).map_err(|error| error.to_string())?;
            crate::markup::to_markdown(&crate::markup::chapters(
                &html,
                &["h1", "h2", "h3", "h4", "h5", "h6"],
            ))
        }
    };
    if text.trim().is_empty() {
        return Err("没有从这本书里提取到正文文本".into());
    }
    Ok(text)
}

#[cfg(test)]
mod tests {
    use std::io::Write as _;
    use std::path::Path;

    use super::ingest;

    #[test]
    fn detects_compound_extension() {
        assert_eq!(
            super::file_format(Path::new("/tmp/小说.fb2.zip")).unwrap(),
            "fb2"
        );
        assert_eq!(
            super::file_format(Path::new("/tmp/书.EPUB")).unwrap(),
            "epub"
        );
        // CBR 与 CBZ 共用漫画阅读链路
        assert_eq!(
            super::file_format(Path::new("/tmp/漫画.CBR")).unwrap(),
            "cbz"
        );
        assert!(super::file_format(Path::new("/tmp/书.xyz")).is_err());
    }

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
