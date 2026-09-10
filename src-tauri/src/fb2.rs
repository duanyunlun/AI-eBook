//! FB2（含 `.fb2.zip`）正文提取：XML 归一后复用 markup 的分章逻辑。

use std::{
    fs::{self, File},
    io::Read,
    path::Path,
};

use zip::ZipArchive;

use crate::markup;

/// 单个文件的大小上限，避免异常文件占用过多内存。
const SIZE_LIMIT: u64 = 32 * 1024 * 1024;

/// 按 `<title>` / `<subtitle>` 分章，返回带标题的 Markdown。
pub fn markdown(path: &Path) -> Result<String, String> {
    let source = read(path)?;
    // 从第一个 <body> 开始，跳过 description 中的书名、简介与出版信息。
    let body = source
        .find("<body")
        .map_or(source.as_str(), |start| &source[start..]);
    let markdown = markup::to_markdown(&markup::chapters(body, &["title", "subtitle"]));
    if markdown.is_empty() {
        return Err("FB2 中没有可提取的正文".into());
    }
    Ok(markdown)
}

/// 读取 `.fb2` 文本，`.fb2.zip` 取包内第一个 FB2 文件。
fn read(path: &Path) -> Result<String, String> {
    let zipped = path
        .extension()
        .is_some_and(|extension| extension.eq_ignore_ascii_case("zip"));
    let bytes = if zipped {
        let file = File::open(path).map_err(|error| error.to_string())?;
        let mut archive = ZipArchive::new(file).map_err(|_| "无法读取 FB2 压缩包".to_string())?;
        let mut content = None;
        for index in 0..archive.len() {
            let mut entry = archive
                .by_index(index)
                .map_err(|_| "FB2 压缩包已损坏".to_string())?;
            if !entry.name().to_ascii_lowercase().ends_with(".fb2") {
                continue;
            }
            if entry.size() > SIZE_LIMIT {
                return Err("FB2 文件过大".into());
            }
            let mut bytes = Vec::with_capacity(entry.size() as usize);
            entry
                .read_to_end(&mut bytes)
                .map_err(|error| error.to_string())?;
            content = Some(bytes);
            break;
        }
        content.ok_or("压缩包中没有找到 FB2 文件")?
    } else {
        let metadata = fs::metadata(path).map_err(|error| error.to_string())?;
        if metadata.len() > SIZE_LIMIT {
            return Err("FB2 文件过大".into());
        }
        fs::read(path).map_err(|error| error.to_string())?
    };
    Ok(String::from_utf8_lossy(&bytes).into_owned())
}

#[cfg(test)]
mod tests {
    use std::io::Write as _;

    use super::markdown;

    const SAMPLE: &str = r#"<?xml version="1.0" encoding="utf-8"?>
<FictionBook xmlns="http://www.gribuser.ru/xml/fictionbook/2.0">
<description><title-info><book-title>书名</book-title><annotation><p>简介。</p></annotation></title-info></description>
<body><section><title><p>第一章 起点</p></title><p>你好 &amp; 世界。</p><empty-line/><p>第二段。</p></section></body>
<binary id="cover.jpg" content-type="image/jpeg">AAAA</binary>
</FictionBook>"#;

    #[test]
    fn extracts_title_and_paragraphs() {
        let directory = std::env::temp_dir().join(format!("fb2-test-{}", std::process::id()));
        std::fs::create_dir_all(&directory).unwrap();
        let path = directory.join("sample.fb2");
        std::fs::write(&path, SAMPLE).unwrap();

        assert_eq!(
            markdown(&path).unwrap(),
            "# 第一章 起点\n\n你好 & 世界。\n\n第二段。"
        );
        std::fs::remove_dir_all(&directory).unwrap();
    }

    #[test]
    fn extracts_fb2_inside_zip() {
        let directory = std::env::temp_dir().join(format!("fb2-zip-test-{}", std::process::id()));
        std::fs::create_dir_all(&directory).unwrap();
        let path = directory.join("sample.fb2.zip");
        let mut writer = zip::ZipWriter::new(std::fs::File::create(&path).unwrap());
        let options: zip::write::SimpleFileOptions = Default::default();
        writer.start_file("book.fb2", options).unwrap();
        writer.write_all(SAMPLE.as_bytes()).unwrap();
        writer.finish().unwrap();

        assert!(
            markdown(&path).unwrap().starts_with("# 第一章 起点"),
            "压缩包内的 FB2 应正常提取"
        );
        std::fs::remove_dir_all(&directory).unwrap();
    }
}
