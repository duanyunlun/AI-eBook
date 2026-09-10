//! 标记文本的共享提取逻辑：EPUB、FB2、MOBI/AZW3、DOCX 等格式都先归一成章节 Markdown。

/// 解析标记文本，按层级最浅的标题分章，返回「(标题, 正文)」；没有标题的章节标题为空串。
pub fn chapters(source: &str, headings: &[&str]) -> Vec<(String, String)> {
    let mut blocks: Vec<(Option<usize>, String)> = Vec::new();
    scan(source, headings, &mut blocks);
    let shallowest = blocks.iter().filter_map(|(level, _)| *level).min();
    let mut chapters: Vec<(String, Vec<String>)> = Vec::new();
    for (level, text) in blocks {
        if level.is_some() && level == shallowest {
            chapters.push((text, Vec::new()));
            continue;
        }
        if text.is_empty() {
            continue;
        }
        match chapters.last_mut() {
            Some(last) => last.1.push(text),
            None => chapters.push((String::new(), vec![text])),
        }
    }
    chapters
        .into_iter()
        .map(|(title, body)| (title, body.join("\n\n")))
        .filter(|(_, body)| !body.is_empty())
        .collect()
}

fn scan(source: &str, headings: &[&str], blocks: &mut Vec<(Option<usize>, String)>) {
    let mut raw = String::new();
    let mut heading = String::new();
    let mut level: Option<usize> = None;
    let mut skipped: Option<String> = None;
    let mut rest = source;
    while let Some(start) = rest.find('<') {
        let text = &rest[..start];
        if skipped.is_none() {
            if level.is_some() {
                heading.push_str(&decode(text));
            } else {
                raw.push_str(&decode(text));
            }
        }
        let Some(end) = rest[start..].find('>') else {
            // 末尾残缺标签：其后不再有可归属的文本
            rest = "";
            break;
        };
        let tag = &rest[start + 1..start + end];
        rest = &rest[start + end + 1..];
        let closing = tag.starts_with('/');
        let name = tag
            .trim_start_matches('/')
            .split(|character: char| character.is_whitespace() || character == '/')
            .next()
            .unwrap_or_default()
            .to_ascii_lowercase();
        if let Some(open) = &skipped {
            if closing && *open == name {
                skipped = None;
            }
            continue;
        }
        if !closing
            && matches!(
                name.as_str(),
                "head" | "script" | "style" | "binary" | "svg"
            )
        {
            skipped = Some(name);
            continue;
        }
        let next = headings
            .iter()
            .any(|candidate| *candidate == name)
            .then(|| heading_level(&name));
        if let Some(open) = level {
            if closing && next == Some(open) {
                level = None;
                flush(blocks, &mut raw);
                let title = paragraphs(&heading).join(" ");
                if !title.is_empty() {
                    blocks.push((Some(open), title));
                }
                heading.clear();
                continue;
            }
            continue;
        }
        if let Some(open) = next.filter(|_| !closing) {
            flush(blocks, &mut raw);
            level = Some(open);
            heading.clear();
            continue;
        }
        if is_block(&name) {
            raw.push('\n');
        }
    }
    if skipped.is_none() {
        if level.is_some() {
            heading.push_str(&decode(rest));
        } else {
            raw.push_str(&decode(rest));
        }
    }
    if level.is_some() {
        let title = paragraphs(&heading).join(" ");
        if !title.is_empty() {
            blocks.push((level, title));
        }
    }
    flush(blocks, &mut raw);
}

fn flush(blocks: &mut Vec<(Option<usize>, String)>, raw: &mut String) {
    for line in paragraphs(raw) {
        blocks.push((None, line));
    }
    raw.clear();
}

/// 把「(标题, 正文)」章节列表拼成 Markdown：有标题的加 `# 标题`，没有标题的格式只保留正文。
pub fn to_markdown(chapters: &[(String, String)]) -> String {
    let mut output = String::new();
    for (title, body) in chapters {
        if !title.is_empty() {
            output.push_str(&format!("# {title}\n\n"));
        }
        output.push_str(&format!("{body}\n\n"));
    }
    output.trim_end().to_string()
}

/// `h1`–`h6` 按标题层级分章，其余标题标签与同级标题合并成一章。
fn heading_level(name: &str) -> usize {
    name.strip_prefix('h')
        .and_then(|value| value.parse::<usize>().ok())
        .unwrap_or(0)
}

fn is_block(name: &str) -> bool {
    matches!(
        name,
        "br" | "p"
            | "div"
            | "li"
            | "ul"
            | "ol"
            | "tr"
            | "td"
            | "th"
            | "table"
            | "section"
            | "article"
            | "blockquote"
            | "figure"
            | "figcaption"
            | "hr"
            | "pre"
            | "title"
            | "subtitle"
            | "empty-line"
            | "pagebreak"
            | "mbp:pagebreak"
            | "h1"
            | "h2"
            | "h3"
            | "h4"
            | "h5"
            | "h6"
    )
}

/// 合并空白字符，丢弃空行。
pub fn paragraphs(source: &str) -> Vec<String> {
    source
        .lines()
        .map(|line| line.split_whitespace().collect::<Vec<_>>().join(" "))
        .filter(|line| !line.is_empty())
        .collect()
}

fn decode(source: &str) -> String {
    if !source.contains('&') {
        return source.to_string();
    }
    let mut output = String::with_capacity(source.len());
    let mut rest = source;
    while let Some(start) = rest.find('&') {
        output.push_str(&rest[..start]);
        let tail = &rest[start..];
        let entity = tail[..tail.len().min(12)]
            .find(';')
            .map(|end| (end, &tail[1..end]));
        match entity.and_then(|(end, name)| entity_text(name).map(|text| (end, text))) {
            Some((end, text)) => {
                output.push_str(&text);
                rest = &tail[end + 1..];
            }
            None => {
                output.push('&');
                rest = &tail[1..];
            }
        }
    }
    output.push_str(rest);
    output
}

fn entity_text(entity: &str) -> Option<String> {
    let character = match entity {
        "amp" => '&',
        "lt" => '<',
        "gt" => '>',
        "quot" => '"',
        "apos" => '\'',
        "nbsp" | "ensp" | "emsp" | "thinsp" => ' ',
        "mdash" => '—',
        "ndash" => '–',
        "hellip" => '…',
        "ldquo" => '“',
        "rdquo" => '”',
        "lsquo" => '‘',
        "rsquo" => '’',
        "middot" => '·',
        "bull" => '•',
        "laquo" => '«',
        "raquo" => '»',
        "copy" => '©',
        "reg" => '®',
        "trade" => '™',
        "times" => '×',
        "sect" => '§',
        "deg" => '°',
        "plusmn" => '±',
        "yen" => '¥',
        "euro" => '€',
        "pound" => '£',
        other => {
            let number = other.strip_prefix('#')?;
            let code = match number.strip_prefix(['x', 'X']) {
                Some(hex) => u32::from_str_radix(hex, 16).ok()?,
                None => number.parse().ok()?,
            };
            char::from_u32(code)?
        }
    };
    Some(character.to_string())
}

#[cfg(test)]
mod tests {
    use super::chapters;

    #[test]
    fn splits_at_the_shallowest_heading() {
        let html = "<h1>第一章</h1><p>正文一。</p><h2>小节</h2><p>正文二。</p><h1>第二章</h1><p>正文三。</p>";
        assert_eq!(
            chapters(html, &["h1", "h2", "h3"]),
            [
                (
                    "第一章".to_string(),
                    "正文一。\n\n小节\n\n正文二。".to_string()
                ),
                ("第二章".to_string(), "正文三。".to_string()),
            ]
        );
    }

    #[test]
    fn keeps_trailing_text_without_tags() {
        assert_eq!(
            chapters("正文", &["h1"]),
            [("".to_string(), "正文".to_string())]
        );
        assert_eq!(
            chapters("<h1>第一章</h1>正文", &["h1"]),
            [("第一章".to_string(), "正文".to_string())]
        );
    }

    #[test]
    fn skips_script_and_binary_content() {
        let html = "<body><p>正文。</p><script>var a = 1;</script><binary>AAAA</binary></body>";
        assert_eq!(
            chapters(html, &["h1"]),
            [(String::new(), "正文。".to_string())]
        );
    }
}
