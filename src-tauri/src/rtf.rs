//! RTF 正文提取：只保留文字，丢弃样式；支持 `\uN` 与 `\'hh` 两种中文写法。

use std::{fs, path::Path};

use encoding_rs::{Encoding, WINDOWS_1252};

use crate::markup;

/// 文件大小上限，避免异常文件占用过多内存。
const SIZE_LIMIT: u64 = 64 * 1024 * 1024;

/// 提取正文，段落之间空一行；RTF 没有标题层级，不臆造章节标题。
pub fn markdown(path: &Path) -> Result<String, String> {
    let metadata = fs::metadata(path).map_err(|error| error.to_string())?;
    if metadata.len() > SIZE_LIMIT {
        return Err("RTF 文件过大".into());
    }
    let bytes = fs::read(path).map_err(|error| error.to_string())?;
    let markdown = markup::paragraphs(&extract(&bytes)).join("\n\n");
    if markdown.is_empty() {
        return Err("RTF 中没有可提取的正文".into());
    }
    Ok(markdown)
}

/// 扫描 RTF 字节流：跳过控制组，把文本与段落标记拼成纯文本。
fn extract(bytes: &[u8]) -> String {
    let mut output = String::new();
    let mut pending: Vec<u8> = Vec::new();
    let mut encoding = WINDOWS_1252;
    let mut fallback = 1usize;
    let mut skip_chars = 0usize;
    let mut depth = 0usize;
    let mut skipped: Vec<usize> = Vec::new();
    let mut index = 0;
    while index < bytes.len() {
        let byte = bytes[index];
        index += 1;
        match byte {
            b'{' => depth += 1,
            b'}' => {
                if skipped.last() == Some(&depth) {
                    skipped.pop();
                }
                depth = depth.saturating_sub(1);
            }
            b'\r' | b'\n' => {}
            b'\\' => {
                if index >= bytes.len() {
                    break;
                }
                if !bytes[index].is_ascii_alphabetic() {
                    let symbol = bytes[index];
                    index += 1;
                    match symbol {
                        b'\'' => {
                            let hex = bytes
                                .get(index..index + 2)
                                .and_then(|value| std::str::from_utf8(value).ok())
                                .and_then(|value| u8::from_str_radix(value, 16).ok());
                            index += 2;
                            if skipped.is_empty() {
                                match (hex, skip_chars > 0) {
                                    (Some(value), false) => pending.push(value),
                                    (Some(_), true) => skip_chars -= 1,
                                    (None, _) => {}
                                }
                            }
                        }
                        _ if !skipped.is_empty() => {}
                        b'*' => skipped.push(depth),
                        b'\\' | b'{' | b'}' => {
                            flush(&mut output, &mut pending, encoding);
                            output.push(symbol as char);
                        }
                        b'~' => {
                            flush(&mut output, &mut pending, encoding);
                            output.push(' ');
                        }
                        // \- 是软连字符，正文里直接丢掉。
                        _ => {}
                    }
                    continue;
                }
                let start = index;
                while index < bytes.len() && bytes[index].is_ascii_alphabetic() {
                    index += 1;
                }
                let word = String::from_utf8_lossy(&bytes[start..index]).to_ascii_lowercase();
                let negative = bytes.get(index) == Some(&b'-');
                if negative {
                    index += 1;
                }
                let digits = index;
                while index < bytes.len() && bytes[index].is_ascii_digit() {
                    index += 1;
                }
                let has_number = index > digits;
                let number: i32 = std::str::from_utf8(&bytes[digits..index])
                    .ok()
                    .and_then(|value| value.parse().ok())
                    .map_or(0, |value: i32| if negative { -value } else { value });
                if bytes.get(index) == Some(&b' ') {
                    index += 1;
                }
                // \binN 后面跟的是原始字节，必须整段跳过，否则里面的花括号会破坏分组。
                if word == "bin" && has_number && number > 0 {
                    index = index.saturating_add(number as usize).min(bytes.len());
                    continue;
                }
                if !skipped.is_empty() {
                    continue;
                }
                if is_destination(&word) {
                    skipped.push(depth);
                    continue;
                }
                match word.as_str() {
                    "par" => {
                        flush(&mut output, &mut pending, encoding);
                        output.push_str("\n\n");
                    }
                    "line" => {
                        flush(&mut output, &mut pending, encoding);
                        output.push('\n');
                    }
                    "tab" => {
                        flush(&mut output, &mut pending, encoding);
                        output.push(' ');
                    }
                    "uc" if has_number => fallback = number.max(0) as usize,
                    "ansicpg" if has_number => encoding = codepage(number.max(0) as u32),
                    "u" if has_number => {
                        flush(&mut output, &mut pending, encoding);
                        let code = if number < 0 { number + 0x10000 } else { number } as u32;
                        if let Some(character) = char::from_u32(code) {
                            output.push(character);
                            skip_chars = fallback;
                        }
                    }
                    _ => {}
                }
            }
            _ => {
                if !skipped.is_empty() {
                    continue;
                }
                if skip_chars > 0 {
                    skip_chars -= 1;
                } else if byte.is_ascii() {
                    flush(&mut output, &mut pending, encoding);
                    output.push(byte as char);
                } else {
                    // 未转义的高位字节也按文档编码解释。
                    pending.push(byte);
                }
            }
        }
    }
    flush(&mut output, &mut pending, encoding);
    output
}

/// `\'hh` 字节按当前 `\ansicpg` 解码；多字节序列要等整段攒齐再解。
fn flush(output: &mut String, pending: &mut Vec<u8>, encoding: &'static Encoding) {
    if pending.is_empty() {
        return;
    }
    output.push_str(&encoding.decode(pending).0);
    pending.clear();
}

/// 十六进制转义的目的地（图片、字体表、页眉页脚等），整组跳过。
fn is_destination(word: &str) -> bool {
    matches!(
        word,
        "fonttbl"
            | "colortbl"
            | "stylesheet"
            | "info"
            | "pict"
            | "header"
            | "headerl"
            | "headerr"
            | "headerf"
            | "footer"
            | "footerl"
            | "footerr"
            | "footerf"
            | "footnote"
            | "fldinst"
            | "object"
            | "shppict"
            | "nonshppict"
            | "generator"
            | "themedata"
            | "colorschememapping"
            | "latentstyles"
            | "rsidtbl"
            | "listtable"
            | "listoverridetable"
            | "revtbl"
            | "filetbl"
            | "xmlnstbl"
            | "datastore"
            | "upr"
            | "annotation"
    )
}

/// `\ansicpgN` → 编码；Windows 代码页编号不在 WHATWG 标签表里，按常见值映射。
fn codepage(number: u32) -> &'static Encoding {
    let label = match number {
        932 => "shift_jis",
        936 => "gbk",
        949 => "euc-kr",
        950 => "big5",
        65001 => "utf-8",
        _ => "",
    };
    Encoding::for_label(label.as_bytes())
        .or_else(|| Encoding::for_label(format!("cp{number}").as_bytes()))
        .unwrap_or(WINDOWS_1252)
}

#[cfg(test)]
mod tests {
    use super::markdown;

    #[test]
    fn extracts_unicode_and_codepage_text() {
        let directory = std::env::temp_dir().join(format!("rtf-test-{}", std::process::id()));
        std::fs::create_dir_all(&directory).unwrap();
        let path = directory.join("sample.rtf");
        let source = r"{\rtf1\ansi\ansicpg936\deff0{\fonttbl{\f0\fnil\fcharset134 SimSun;}}{\*\generator Riched20;}\uc1\pard\f0\fs24 \u31532?\u19968?\par \'d6\'d0\'ce\'c4\'b2\'e2\'ca\'d4\'a1\'a3\line \{note\}\par}";
        std::fs::write(&path, source).unwrap();

        let text = markdown(&path).unwrap();
        assert!(text.contains('第') && text.contains('中'), "{text}");
        assert_eq!(text, "第一\n\n中文测试。\n\n{note}");
        std::fs::remove_dir_all(&directory).unwrap();
    }
}
