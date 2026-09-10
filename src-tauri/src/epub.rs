use std::{collections::HashMap, fs::File, io::Read, path::Path};

use zip::ZipArchive;

use crate::markup;

const HEADINGS: [&str; 6] = ["h1", "h2", "h3", "h4", "h5", "h6"];

/// 单个 XHTML 文件的大小上限，避免异常文件占用过多内存。
const PAGE_LIMIT: u64 = 16 * 1024 * 1024;
/// 提取结果的大小上限，超出后停止追加后续章节。
const OUTPUT_LIMIT: usize = 32 * 1024 * 1024;

/// 按 spine 顺序把 EPUB 正文提取为带章节标题的 Markdown，复用现有文本阅读链路。
pub fn extract_markdown(path: &Path) -> Result<String, String> {
    let file = File::open(path).map_err(|error| error.to_string())?;
    let mut archive = ZipArchive::new(file).map_err(|_| "无法读取 EPUB 压缩包".to_string())?;
    let container =
        read(&mut archive, "META-INF/container.xml").ok_or("EPUB 缺少 container.xml")?;
    let opf_path = attribute(&container, "full-path").ok_or("EPUB 缺少根文件路径")?;
    let opf = read(&mut archive, &opf_path).ok_or("EPUB 根文件缺失")?;
    let base = match opf_path.rsplit_once('/') {
        Some((directory, _)) if !directory.is_empty() => format!("{directory}/"),
        _ => String::new(),
    };
    let manifest = manifest(&opf);
    let mut output = String::new();
    let mut chapter = 0;
    for id in spine(&opf) {
        let Some(href) = manifest.get(&id) else {
            continue;
        };
        let Some(page) = read(&mut archive, &resolve(&base, href)) else {
            continue;
        };
        for (title, body) in markup::chapters(&page, &HEADINGS) {
            chapter += 1;
            let title = if title.is_empty() {
                format!("第 {chapter} 章")
            } else {
                title
            };
            output.push_str(&format!("# {title}\n\n{body}\n\n"));
            if output.len() > OUTPUT_LIMIT {
                break;
            }
        }
        if output.len() > OUTPUT_LIMIT {
            break;
        }
    }
    if chapter == 0 {
        return Err("EPUB 中没有可提取的正文，可能是纯图片或加密书籍".into());
    }
    Ok(output.trim_end().to_string())
}

fn read(archive: &mut ZipArchive<File>, name: &str) -> Option<String> {
    let mut entry = archive.by_name(name).ok()?;
    if entry.size() > PAGE_LIMIT {
        return None;
    }
    let mut bytes = Vec::with_capacity(entry.size() as usize);
    entry.read_to_end(&mut bytes).ok()?;
    Some(String::from_utf8_lossy(&bytes).into_owned())
}

/// 解析 manifest，得到「条目 id → 文件路径」。
fn manifest(opf: &str) -> HashMap<String, String> {
    let mut items = HashMap::new();
    for tag in tags(opf, "item") {
        if let (Some(id), Some(href)) = (attribute(&tag, "id"), attribute(&tag, "href")) {
            items.insert(id, href);
        }
    }
    items
}

/// 按 spine 顺序返回正文条目 id。
fn spine(opf: &str) -> Vec<String> {
    tags(opf, "itemref")
        .iter()
        .filter_map(|tag| attribute(tag, "idref"))
        .collect()
}

/// 取出指定标签的标签体，例如 `tags(source, "item")` 不会匹配 `<itemref>`。
fn tags(source: &str, name: &str) -> Vec<String> {
    let mut found = Vec::new();
    let mut rest = source;
    while let Some(start) = rest.find('<') {
        let Some(head) = rest[start + 1..].strip_prefix(name) else {
            rest = &rest[start + 1..];
            continue;
        };
        if !head.starts_with(|character: char| {
            character.is_whitespace() || character == '>' || character == '/'
        }) {
            rest = &rest[start + 1..];
            continue;
        }
        let mut quote = None;
        let mut end = None;
        for (offset, character) in head.char_indices() {
            match (quote, character) {
                (Some(open), character) if character == open => quote = None,
                (None, '"' | '\'') => quote = Some(character),
                (None, '>') => {
                    end = Some(offset);
                    break;
                }
                _ => {}
            }
        }
        let Some(end) = end else { break };
        found.push(head[..end].to_string());
        rest = &head[end..];
    }
    found
}

/// 读取标签属性，仅支持 XML 要求的引号写法。
fn attribute(tag: &str, name: &str) -> Option<String> {
    let mut rest = tag;
    while let Some(start) = rest.find(name) {
        rest = &rest[start + name.len()..];
        let trimmed = rest.trim_start();
        if trimmed.len() == rest.len() && !rest.starts_with('=') {
            continue;
        }
        let value = trimmed.strip_prefix('=')?.trim_start();
        let quote = value.chars().next()?;
        if quote != '"' && quote != '\'' {
            continue;
        }
        return value[1..].split(quote).next().map(str::to_string);
    }
    None
}

/// 相对于 OPF 所在目录解析 href，并去掉片段与百分号转义。
fn resolve(base: &str, href: &str) -> String {
    let target = percent_decode(href.split('#').next().unwrap_or(href));
    if let Some(absolute) = target.strip_prefix('/') {
        return absolute.to_string();
    }
    let mut parts: Vec<&str> = base.split('/').filter(|part| !part.is_empty()).collect();
    for part in target.split('/') {
        match part {
            "" | "." => {}
            ".." => {
                parts.pop();
            }
            other => parts.push(other),
        }
    }
    parts.join("/")
}

fn percent_decode(source: &str) -> String {
    if !source.contains('%') {
        return source.to_string();
    }
    let bytes = source.as_bytes();
    let mut output = Vec::with_capacity(bytes.len());
    let mut index = 0;
    while index < bytes.len() {
        let hex = source
            .get(index + 1..index + 3)
            .and_then(|value| u8::from_str_radix(value, 16).ok());
        match (bytes[index], hex) {
            (b'%', Some(byte)) => {
                output.push(byte);
                index += 3;
            }
            (byte, _) => {
                output.push(byte);
                index += 1;
            }
        }
    }
    String::from_utf8_lossy(&output).into_owned()
}

#[cfg(test)]
mod tests {
    use std::io::Write as _;

    use super::extract_markdown;

    #[test]
    fn extracts_spine_text_in_order() {
        let directory = std::env::temp_dir().join(format!("epub-test-{}", std::process::id()));
        std::fs::create_dir_all(&directory).unwrap();
        let path = directory.join("sample.epub");
        let mut writer = zip::ZipWriter::new(std::fs::File::create(&path).unwrap());
        let options: zip::write::SimpleFileOptions = Default::default();
        let mut add = |name: &str, body: &str| {
            writer.start_file(name, options).unwrap();
            writer.write_all(body.as_bytes()).unwrap();
        };
        add(
            "META-INF/container.xml",
            r#"<?xml version="1.0"?><container><rootfiles><rootfile full-path="OEBPS/book.opf"/></rootfiles></container>"#,
        );
        add(
            "OEBPS/book.opf",
            r#"<package><manifest><item id="c2" href="text/2.xhtml"/><item id="c1" href="text/1.xhtml"/><item id="css" href="style.css"/></manifest><spine><itemref idref="c1"/><itemref idref="c2"/></spine></package>"#,
        );
        add(
            "OEBPS/text/1.xhtml",
            "<html><head><title>书名</title><style>p{color:red}</style></head><body><h1>第一章 起点</h1><p>你好 &amp; 世界。</p><p>第二段。</p></body></html>",
        );
        add(
            "OEBPS/text/2.xhtml",
            "<html><body><p>只有正文，没有标题。</p></body></html>",
        );
        add("OEBPS/style.css", "p{color:red}");
        writer.finish().unwrap();

        let markdown = extract_markdown(&path).unwrap();
        assert_eq!(
            markdown,
            "# 第一章 起点\n\n你好 & 世界。\n\n第二段。\n\n# 第 2 章\n\n只有正文，没有标题。"
        );
        std::fs::remove_dir_all(&directory).unwrap();
    }
}
