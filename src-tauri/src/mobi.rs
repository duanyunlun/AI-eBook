//! MOBI / AZW / AZW3(KF8) 正文提取：解析 PalmDB 容器与 MOBI 头，解压文本记录后归一成章节 Markdown。

use std::{fs, path::Path};

use crate::markup;

const HEADINGS: [&str; 6] = ["h1", "h2", "h3", "h4", "h5", "h6"];
/// 提取结果的大小上限，超出后停止追加后续章节。
const OUTPUT_LIMIT: usize = 32 * 1024 * 1024;
const DRM_ERROR: &str = "该 MOBI/AZW3 带有 DRM 加密，无法解析";

/// 读取 MOBI 系文件并提取正文，返回带章节标题的 Markdown。
pub fn markdown(path: &Path) -> Result<String, String> {
    let data = fs::read(path).map_err(|error| error.to_string())?;
    let records = records(&data)?;
    // 一本书可能前半是 MOBI7、后半是 KF8，KF8 的头部记录排在后面，优先取它
    let start = (1..records.len())
        .find(|index| is_header(records[*index]))
        .unwrap_or(0);
    let header = Header::parse(&records, start)?;
    if header.encrypted {
        return Err(DRM_ERROR.into());
    }
    let html = decode(&header.text(&records)?, header.encoding);
    let mut output = String::new();
    let mut chapter = 0;
    for (title, body) in markup::chapters(&html, &HEADINGS) {
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
    if chapter == 0 {
        return Err("MOBI 中没有可提取的正文，可能是纯图片书籍".into());
    }
    Ok(output.trim_end().to_string())
}

/// 读取 PalmDB 记录偏移表并切成记录切片。
fn records(data: &[u8]) -> Result<Vec<&[u8]>, String> {
    if data.len() < 78 || &data[60..68] != b"BOOKMOBI" {
        return Err("不是有效的 MOBI/AZW 文件".into());
    }
    let count = u16(data, 76).unwrap_or_default() as usize;
    let mut offsets = Vec::with_capacity(count + 1);
    for index in 0..count {
        let Some(offset) = u32(data, 78 + index * 8) else {
            break;
        };
        let offset = offset as usize;
        // 声明条数可能多于实际记录，偏移也必须递增才能切片
        if offset > data.len() || offsets.last().is_some_and(|last| *last > offset) {
            break;
        }
        offsets.push(offset);
    }
    offsets.push(data.len());
    Ok(offsets
        .windows(2)
        .map(|pair| &data[pair[0]..pair[1]])
        .collect())
}

/// 记录是否是 MOBI 头部记录（组合文件里 KF8 部分的头记录同样满足）。
fn is_header(record: &[u8]) -> bool {
    record.len() >= 0x18
        && &record[16..20] == b"MOBI"
        && matches!(u16(record, 0).unwrap_or_default(), 1 | 2 | 17480)
        && u16(record, 8).unwrap_or_default() > 0
}

/// 头部记录里的 PalmDOC 头与 MOBI 头。
struct Header {
    start: usize,
    compression: u16,
    text_length: usize,
    text_records: usize,
    encoding: u32,
    trailing_flags: u16,
    encrypted: bool,
    /// HUFF/CDIC 的「起始记录、记录数」。
    huff: Option<(usize, usize)>,
}

impl Header {
    fn parse(records: &[&[u8]], start: usize) -> Result<Header, String> {
        let record = records.get(start).ok_or("MOBI 缺少头部记录")?;
        if record.len() < 0xB8 || &record[16..20] != b"MOBI" {
            return Err("不是有效的 MOBI/AZW 文件".into());
        }
        let header_length = u32(record, 0x14).unwrap_or_default();
        let version = u32(record, 0x24).unwrap_or_default();
        let huff_offset = u32(record, 0x70).unwrap_or(u32::MAX);
        let huff_count = u32(record, 0x74).unwrap_or_default() as usize;
        // 尾部数据条目（TBS 索引等）只出现在较新的头部里
        let trailing_flags = if version >= 5 && header_length >= 0xE4 {
            u16(record, 0xF2).unwrap_or_default()
        } else {
            0
        };
        let drm = u32(record, 0xA8).unwrap_or(u32::MAX);
        Ok(Header {
            start,
            compression: u16(record, 0).ok_or("MOBI 缺少压缩方式")?,
            text_length: u32(record, 4).ok_or("MOBI 缺少正文长度")? as usize,
            text_records: u16(record, 8).ok_or("MOBI 缺少正文记录数")? as usize,
            encoding: u32(record, 0x1C).unwrap_or(65001),
            trailing_flags,
            encrypted: u16(record, 0x0C).unwrap_or_default() != 0
                || (drm != u32::MAX && u32(record, 0xAC).unwrap_or_default() != 0),
            huff: (huff_count > 0 && huff_offset != u32::MAX)
                .then(|| (start.saturating_add(huff_offset as usize), huff_count)),
        })
    }

    /// 逐条解压正文记录并拼接。
    fn text(&self, records: &[&[u8]]) -> Result<Vec<u8>, String> {
        let mut huff = match self.huff {
            Some((offset, count)) => Some(Huff::load(records, offset, count)?),
            None => None,
        };
        match self.compression {
            1 | 2 => {}
            17480 if huff.is_some() => {}
            17480 => return Err("MOBI 缺少 HUFF/CDIC 压缩表".into()),
            other => return Err(format!("不支持的 MOBI 压缩方式（{other}）")),
        }
        let mut output = Vec::with_capacity(self.text_length.min(4 * 1024 * 1024));
        for index in 0..self.text_records {
            let Some(record) = records.get(self.start + 1 + index) else {
                break;
            };
            let data = trim(record, self.trailing_flags);
            match self.compression {
                2 => output.extend_from_slice(&palmdoc(data)),
                17480 => output.extend_from_slice(&huff.as_mut().unwrap().unpack(data)?),
                _ => output.extend_from_slice(data),
            }
            if output.len() >= self.text_length {
                break;
            }
        }
        output.truncate(self.text_length);
        Ok(output)
    }
}

/// 去掉正文记录尾部的额外数据条目（TBS 索引等），避免混入正文。
fn trim(record: &[u8], flags: u16) -> &[u8] {
    if flags == 0 {
        return record;
    }
    let mut end = record.len();
    for _ in 0..(flags >> 1).count_ones() {
        let size = trailing_size(&record[..end]);
        if size == 0 || size > end {
            break;
        }
        end -= size;
    }
    if flags & 1 != 0 && end > 0 {
        end = end.saturating_sub((record[end - 1] & 3) as usize + 1);
    }
    &record[..end]
}

/// 尾部数据条目的长度：末尾 4 字节按 7 位一组累加，遇到最高位为 1 的字节时清零。
fn trailing_size(data: &[u8]) -> usize {
    let mut size = 0usize;
    for byte in data[data.len().saturating_sub(4)..].iter() {
        if byte & 0x80 != 0 {
            size = 0;
        }
        size = (size << 7) | (byte & 0x7F) as usize;
    }
    size
}

/// PalmDOC（LZ77）解压。
fn palmdoc(data: &[u8]) -> Vec<u8> {
    let mut output = Vec::with_capacity(data.len() * 2);
    let mut index = 0;
    while index < data.len() {
        let byte = data[index];
        index += 1;
        match byte {
            0 => output.push(0),
            1..=8 => {
                let end = (index + byte as usize).min(data.len());
                output.extend_from_slice(&data[index..end]);
                index = end;
            }
            0x09..=0x7F => output.push(byte),
            0x80..=0xBF if index < data.len() => {
                let pair = ((byte as usize) << 8) | data[index] as usize;
                index += 1;
                let distance = (pair >> 3) & 0x07FF;
                for _ in 0..(pair & 7) + 3 {
                    if distance == 0 || distance > output.len() {
                        break;
                    }
                    let from = output.len() - distance;
                    let copied = output[from];
                    output.push(copied);
                }
            }
            0xC0..=0xFF => {
                output.push(b' ');
                output.push(byte ^ 0x80);
            }
            _ => {}
        }
    }
    output
}

/// HUFF/CDIC 解压表：HUFF 记录给出编码表，CDIC 记录给出短语字典。
struct Huff {
    /// 高位字节对应的「码长、是否直接给出 maxcode、maxcode」。
    codes: Vec<(u8, bool, u32)>,
    min: [u32; 33],
    max: [u32; 33],
    /// 短语字典，`None` 表示引用尚未解开。
    phrases: Vec<Option<(Vec<u8>, bool)>>,
}

impl Huff {
    fn load(records: &[&[u8]], offset: usize, count: usize) -> Result<Huff, String> {
        let huff = records.get(offset).ok_or("MOBI 的 HUFF 记录缺失")?;
        if huff.len() < 0x18 || &huff[..8] != b"HUFF\x00\x00\x00\x18" {
            return Err("MOBI 的 HUFF 压缩表无效".into());
        }
        let (off1, off2) = (
            u32(huff, 8).unwrap_or_default() as usize,
            u32(huff, 12).unwrap_or_default() as usize,
        );
        let mut codes = Vec::with_capacity(256);
        for index in 0..256 {
            let value = u32(huff, off1 + index * 4).ok_or("MOBI 的 HUFF 压缩表不完整")?;
            let length = (value & 0x1F) as u8;
            let maxcode = (((value >> 8) as u64 + 1) << (32 - length)) - 1;
            codes.push((length, value & 0x80 != 0, maxcode as u32));
        }
        let mut min = [0u32; 33];
        let mut max = [0u32; 33];
        for length in 1..=32usize {
            let low = u32(huff, off2 + (length - 1) * 8).ok_or("MOBI 的 HUFF 码表不完整")?;
            let high = u32(huff, off2 + (length - 1) * 8 + 4).ok_or("MOBI 的 HUFF 码表不完整")?;
            min[length] = ((low as u64) << (32 - length)) as u32;
            max[length] = ((((high as u64) + 1) << (32 - length)) - 1) as u32;
        }
        let mut phrases = Vec::new();
        for index in 1..count {
            let cdic = records.get(offset + index).ok_or("MOBI 的 CDIC 记录缺失")?;
            if cdic.len() < 16 || &cdic[..8] != b"CDIC\x00\x00\x00\x10" {
                return Err("MOBI 的 CDIC 压缩表无效".into());
            }
            let total = u32(cdic, 8).unwrap_or_default() as usize;
            let bits = u32(cdic, 12).unwrap_or_default();
            let take = (1usize << bits.min(16)).min(total.saturating_sub(phrases.len()));
            for entry in 0..take {
                let at = u16(cdic, 16 + entry * 2).ok_or("MOBI 的 CDIC 偏移表不完整")? as usize;
                let length = u16(cdic, 16 + at).ok_or("MOBI 的 CDIC 短语越界")? as usize;
                let start = (18 + at).min(cdic.len());
                let end = (start + (length & 0x7FFF)).min(cdic.len());
                phrases.push(Some((cdic[start..end].to_vec(), length & 0x8000 != 0)));
            }
        }
        Ok(Huff {
            codes,
            min,
            max,
            phrases,
        })
    }

    fn unpack(&mut self, data: &[u8]) -> Result<Vec<u8>, String> {
        self.decode(data, 0)
    }

    /// 32 位窗口的位流解码；短语可以引用其他短语，用深度兜底防止畸形数据递归失控。
    fn decode(&mut self, data: &[u8], depth: usize) -> Result<Vec<u8>, String> {
        if depth > 32 {
            return Err("MOBI 的 HUFF 压缩数据异常".into());
        }
        let mut output = Vec::new();
        let mut bits_left = data.len() as i64 * 8;
        let mut position = 0;
        let mut bits_window = window(data, 0);
        let mut bits = 32i32;
        loop {
            if bits <= 0 {
                position += 4;
                bits_window = window(data, position);
                bits += 32;
            }
            let code = (bits_window >> bits as u32) as u32;
            let Some(&(mut length, term, mut maxcode)) = self.codes.get((code >> 24) as usize)
            else {
                break;
            };
            if length == 0 {
                return Err("MOBI 的 HUFF 编码表无效".into());
            }
            if !term {
                while (length as usize) < 32 && code < self.min[length as usize] {
                    length += 1;
                }
                maxcode = self.max[length as usize];
            }
            bits -= length as i32;
            bits_left -= length as i64;
            if bits_left < 0 {
                break;
            }
            let index = (maxcode.wrapping_sub(code) >> (32 - length as u32)) as usize;
            let phrase = self.phrase(index, depth)?;
            output.extend_from_slice(&phrase);
        }
        Ok(output)
    }

    fn phrase(&mut self, index: usize, depth: usize) -> Result<Vec<u8>, String> {
        let Some(Some((bytes, literal))) = self.phrases.get(index).cloned() else {
            return Err("MOBI 的 HUFF 压缩数据越界".into());
        };
        if literal {
            return Ok(bytes);
        }
        // ponytail: 每个短语一次分配与拷贝，若大文件解析过慢再改成直接写入输出缓冲
        let decoded = self.decode(&bytes, depth + 1)?;
        self.phrases[index] = Some((decoded.clone(), true));
        Ok(decoded)
    }
}

/// 读取 8 字节窗口，越界部分按 0 补齐（与压缩流末尾的填充一致）。
fn window(data: &[u8], position: usize) -> u64 {
    let mut value = 0u64;
    for index in 0..8 {
        value = (value << 8) | data.get(position + index).copied().unwrap_or(0) as u64;
    }
    value
}

/// codepage 65001 是 UTF-8，其余按 Windows-1252 解码。
fn decode(bytes: &[u8], encoding: u32) -> String {
    if encoding == 65001 {
        return String::from_utf8_lossy(bytes).into_owned();
    }
    bytes.iter().map(|byte| cp1252(*byte)).collect()
}

/// Windows-1252 与 Latin-1 只在 0x80–0x9F 不同。
fn cp1252(byte: u8) -> char {
    match byte {
        0x80 => '€',
        0x82 => '‚',
        0x83 => 'ƒ',
        0x84 => '„',
        0x85 => '…',
        0x86 => '†',
        0x87 => '‡',
        0x88 => 'ˆ',
        0x89 => '‰',
        0x8A => 'Š',
        0x8B => '‹',
        0x8C => 'Œ',
        0x8E => 'Ž',
        0x91 => '‘',
        0x92 => '’',
        0x93 => '“',
        0x94 => '”',
        0x95 => '•',
        0x96 => '–',
        0x97 => '—',
        0x98 => '˜',
        0x99 => '™',
        0x9A => 'š',
        0x9B => '›',
        0x9C => 'œ',
        0x9E => 'ž',
        0x9F => 'Ÿ',
        other => other as char,
    }
}

fn u16(data: &[u8], at: usize) -> Option<u16> {
    Some(u16::from_be_bytes(data.get(at..at + 2)?.try_into().ok()?))
}

fn u32(data: &[u8], at: usize) -> Option<u32> {
    Some(u32::from_be_bytes(data.get(at..at + 4)?.try_into().ok()?))
}

#[cfg(test)]
mod tests {
    use std::{fs, path::PathBuf};

    use super::{markdown, palmdoc};

    /// 按 PalmDB 布局拼容器：记录 0 是头部记录，其余按顺序跟在后面。
    fn container(records: &[Vec<u8>]) -> Vec<u8> {
        let mut output = vec![0u8; 78];
        output[60..64].copy_from_slice(b"BOOK");
        output[64..68].copy_from_slice(b"MOBI");
        output[76..78].copy_from_slice(&(records.len() as u16).to_be_bytes());
        let mut offset = 78 + records.len() * 8 + 2; // 记录表之后还有 2 字节 gap
        for (index, record) in records.iter().enumerate() {
            output.extend_from_slice(&(offset as u32).to_be_bytes());
            output.extend_from_slice(&[0, 0, 0, index as u8]);
            offset += record.len();
        }
        output.extend_from_slice(&[0, 0]);
        for record in records {
            output.extend_from_slice(record);
        }
        output
    }

    /// 头部记录：PalmDOC 头 + MOBI 头，`length` 是解压后的正文长度。
    fn header(compression: u16, length: usize, version: u32) -> Vec<u8> {
        let mut record = vec![0u8; 0xF4];
        record[0..2].copy_from_slice(&compression.to_be_bytes());
        record[4..8].copy_from_slice(&(length as u32).to_be_bytes());
        record[8..10].copy_from_slice(&1u16.to_be_bytes());
        record[10..12].copy_from_slice(&4096u16.to_be_bytes());
        record[16..20].copy_from_slice(b"MOBI");
        record[0x14..0x18].copy_from_slice(&0xE4u32.to_be_bytes());
        record[0x18..0x1C].copy_from_slice(&2u32.to_be_bytes());
        record[0x1C..0x20].copy_from_slice(&65001u32.to_be_bytes());
        record[0x24..0x28].copy_from_slice(&version.to_be_bytes());
        record[0x50..0x54].copy_from_slice(&u32::MAX.to_be_bytes());
        record[0xA8..0xAC].copy_from_slice(&u32::MAX.to_be_bytes());
        record
    }

    /// 最小编码：ASCII 原样，其余字节用「复制 1 字节」转义。
    fn compress(data: &[u8]) -> Vec<u8> {
        let mut output = Vec::new();
        for byte in data {
            if (9..=0x7F).contains(byte) {
                output.push(*byte);
            } else {
                output.push(1);
                output.push(*byte);
            }
        }
        output
    }

    fn temp(name: &str, bytes: &[u8]) -> PathBuf {
        let path = std::env::temp_dir().join(format!("mobi-test-{}-{name}", std::process::id()));
        fs::write(&path, bytes).unwrap();
        path
    }

    #[test]
    fn extracts_chapter_from_palmdoc_book() {
        let html = "<html><body><h1>第一章</h1><p>正文内容。</p></body></html>";
        let text = compress(html.as_bytes());
        let path = temp(
            "palmdoc.mobi",
            &container(&[header(2, html.len(), 6), text]),
        );
        assert_eq!(markdown(&path).unwrap(), "# 第一章\n\n正文内容。");
        fs::remove_file(&path).unwrap();
    }

    #[test]
    fn palmdoc_expands_back_references() {
        let mut data = b"abc".to_vec();
        data.extend_from_slice(&[0x80, 0x18]); // 距离 3、长度 3
        data.extend_from_slice(&[0x80, 0x08]); // 距离 1、长度 3
        data.push(0xE1); // 字节对：空格 + 'a'（0xE1 与 0x80 异或得到 0x61）
        let mut expected = b"abcabc".to_vec();
        expected.extend_from_slice(b"ccc a");
        assert_eq!(palmdoc(&data), expected);
    }

    #[test]
    fn decodes_huffcdic_stream() {
        // HUFF：256 个 8 位定长码，码 0 对应短语 1、码 1 对应短语 0
        let mut huff = vec![0u8; 0x518];
        huff[0..8].copy_from_slice(b"HUFF\x00\x00\x00\x18");
        huff[8..12].copy_from_slice(&0x18u32.to_be_bytes());
        huff[12..16].copy_from_slice(&0x418u32.to_be_bytes());
        for code in 0..256 {
            let value = 8u32 | 0x80 | (1 << 8);
            huff[0x18 + code * 4..0x1C + code * 4].copy_from_slice(&value.to_be_bytes());
        }
        // CDIC：短语 0 = "ab"、短语 1 = "cd"
        let mut cdic = vec![0u8; 28];
        cdic[0..8].copy_from_slice(b"CDIC\x00\x00\x00\x10");
        cdic[8..12].copy_from_slice(&2u32.to_be_bytes());
        cdic[12..16].copy_from_slice(&1u32.to_be_bytes());
        cdic[16..18].copy_from_slice(&4u16.to_be_bytes());
        cdic[18..20].copy_from_slice(&8u16.to_be_bytes());
        cdic[20..22].copy_from_slice(&0x8002u16.to_be_bytes());
        cdic[22..24].copy_from_slice(b"ab");
        cdic[24..26].copy_from_slice(&0x8002u16.to_be_bytes());
        cdic[26..28].copy_from_slice(b"cd");

        // 正文记录是压缩流：码 0、码 1 → "cd" + "ab"
        let mut head = header(17480, 4, 6);
        head[0x70..0x74].copy_from_slice(&2u32.to_be_bytes());
        head[0x74..0x78].copy_from_slice(&2u32.to_be_bytes());
        let path = temp(
            "huff.mobi",
            &container(&[head, vec![0x00, 0x01], huff, cdic]),
        );
        assert_eq!(markdown(&path).unwrap(), "# 第 1 章\n\ncdab");
        fs::remove_file(&path).unwrap();
    }

    #[test]
    fn prefers_kf8_body_in_combo_book() {
        let (old, new) = (b"<h1>MOBI7</h1><p>old</p>", b"<h1>KF8</h1><p>new</p>");
        let path = temp(
            "combo.azw",
            &container(&[
                header(2, old.len(), 6),
                compress(old),
                b"BOUNDARY".to_vec(),
                header(2, new.len(), 8),
                compress(new),
            ]),
        );
        assert_eq!(markdown(&path).unwrap(), "# KF8\n\nnew");
        fs::remove_file(&path).unwrap();
    }

    #[test]
    fn rejects_drm_books() {
        let mut head = header(2, 4, 6);
        head[0x0C..0x0E].copy_from_slice(&1u16.to_be_bytes());
        let path = temp("drm.azw3", &container(&[head, compress(b"<p>hi</p>")]));
        assert_eq!(
            markdown(&path).unwrap_err(),
            "该 MOBI/AZW3 带有 DRM 加密，无法解析"
        );
        fs::remove_file(&path).unwrap();
    }
}
