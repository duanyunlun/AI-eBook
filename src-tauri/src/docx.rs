//! DOCX 正文提取：只读 `word/document.xml`，段落先转成伪 HTML 再复用 markup 的分章逻辑。

use std::{fs::File, io::Read, path::Path};

use zip::ZipArchive;

use crate::markup;

/// 正文 XML 的大小上限，避免异常文件占用过多内存。
const SIZE_LIMIT: u64 = 32 * 1024 * 1024;
const DOCUMENT: &str = "word/document.xml";

/// 按标题样式（Heading1–6 / 标题 1–6）分章，返回 Markdown。
pub fn markdown(path: &Path) -> Result<String, String> {
    let html = pseudo_html(&read(path)?);
    let headings = ["h1", "h2", "h3", "h4", "h5", "h6"];
    let markdown = markup::to_markdown(&markup::chapters(&html, &headings));
    if markdown.is_empty() {
        return Err("DOCX 中没有可提取的正文".into());
    }
    Ok(markdown)
}

fn read(path: &Path) -> Result<String, String> {
    let file = File::open(path).map_err(|error| error.to_string())?;
    let mut archive = ZipArchive::new(file).map_err(|_| "无法读取 DOCX 压缩包".to_string())?;
    let mut entry = archive
        .by_name(DOCUMENT)
        .map_err(|_| "DOCX 缺少 word/document.xml".to_string())?;
    if entry.size() > SIZE_LIMIT {
        return Err("DOCX 正文过大".into());
    }
    let mut bytes = Vec::with_capacity(entry.size() as usize);
    entry
        .read_to_end(&mut bytes)
        .map_err(|error| error.to_string())?;
    Ok(String::from_utf8_lossy(&bytes).into_owned())
}

/// 把 `<w:p>` 段落转成 `<p>` / `<h1>`–`<h6>`，文本实体留给 markup 解码。
fn pseudo_html(xml: &str) -> String {
    let mut html = String::new();
    let mut paragraph = String::new();
    let mut style = String::new();
    let mut open = false;
    let mut rest = xml;
    while let Some(start) = rest.find('<') {
        let Some(offset) = rest[start..].find('>') else {
            break;
        };
        let tag = &rest[start + 1..start + offset];
        rest = &rest[start + offset + 1..];
        let closing = tag.starts_with('/');
        let empty = tag.ends_with('/');
        let name = tag
            .trim_start_matches('/')
            .split(|character: char| character.is_whitespace() || character == '/')
            .next()
            .unwrap_or_default()
            .to_ascii_lowercase();
        match name.as_str() {
            "w:p" if !closing && !empty => {
                open = true;
                paragraph.clear();
                style.clear();
            }
            "w:p" if closing => {
                if open {
                    flush(&mut html, &paragraph, &style);
                    open = false;
                }
            }
            // Word 会把一段文字拆成多个 run，需要拼接；xml:space 保留的空格照原样带上。
            "w:t" if open && !closing && !empty => {
                let end = rest.find('<').unwrap_or(rest.len());
                paragraph.push_str(&rest[..end]);
                rest = &rest[end..];
            }
            "w:br" | "w:cr" if open => paragraph.push('\n'),
            "w:tab" if open => paragraph.push(' '),
            "w:pstyle" if open && !closing => {
                style = attribute(tag, "w:val").unwrap_or_default();
            }
            _ => {}
        }
    }
    if open {
        flush(&mut html, &paragraph, &style);
    }
    html
}

fn flush(html: &mut String, paragraph: &str, style: &str) {
    let text = paragraph.trim();
    if text.is_empty() {
        return;
    }
    match heading_level(style) {
        Some(level) => html.push_str(&format!("<h{level}>{text}</h{level}>")),
        None => html.push_str(&format!("<p>{text}</p>")),
    }
}

/// 标题样式：`Heading1`–`Heading6` 或 `标题 1`–`标题 6`，大小写与空格不敏感。
fn heading_level(style: &str) -> Option<usize> {
    let normalized: String = style
        .chars()
        .filter(|character| !character.is_whitespace())
        .collect::<String>()
        .to_lowercase();
    let digits = normalized
        .strip_prefix("heading")
        .or_else(|| normalized.strip_prefix("标题"))?;
    digits
        .parse::<usize>()
        .ok()
        .filter(|level| (1..=6).contains(level))
}

fn attribute(tag: &str, name: &str) -> Option<String> {
    let rest = tag.split_once(&format!(" {name}=\""))?.1;
    Some(rest.split('"').next()?.to_string())
}

#[cfg(test)]
mod tests {
    use std::io::Write as _;

    use super::markdown;

    const SAMPLE: &str = r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>
<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>第一章 起点</w:t></w:r></w:p>
<w:p><w:r><w:t xml:space="preserve">你好 </w:t></w:r><w:r><w:t>&amp; 世界。</w:t></w:r></w:p>
<w:p><w:pPr><w:pStyle w:val="标题 2"/></w:pPr><w:r><w:t>小节</w:t></w:r></w:p>
<w:p><w:r><w:t>第二段。</w:t><w:br/><w:t>换行后。</w:t><w:tab/><w:t>制表后。</w:t></w:r></w:p>
</w:body></w:document>"#;

    #[test]
    fn extracts_headings_and_paragraphs() {
        let directory = std::env::temp_dir().join(format!("docx-test-{}", std::process::id()));
        std::fs::create_dir_all(&directory).unwrap();
        let path = directory.join("sample.docx");
        let mut writer = zip::ZipWriter::new(std::fs::File::create(&path).unwrap());
        let options: zip::write::SimpleFileOptions = Default::default();
        writer.start_file("word/document.xml", options).unwrap();
        writer.write_all(SAMPLE.as_bytes()).unwrap();
        writer.finish().unwrap();

        assert_eq!(
            markdown(&path).unwrap(),
            "# 第一章 起点\n\n你好 & 世界。\n\n小节\n\n第二段。\n\n换行后。 制表后。"
        );
        std::fs::remove_dir_all(&directory).unwrap();
    }
}
