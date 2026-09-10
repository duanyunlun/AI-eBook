use std::{cmp::Ordering, fs, fs::File, io::Read, path::Path};

use zip::ZipArchive;

const IMAGE_EXTENSIONS: [&str; 8] = ["jpg", "jpeg", "png", "webp", "gif", "bmp", "avif", "jfif"];
/// 单张图片大小上限，避免异常压缩包占满磁盘。
const IMAGE_LIMIT: u64 = 64 * 1024 * 1024;

/// 把 CBZ（zip 漫画包）里的图片按页序导出到目录，返回相对文件名。
pub fn extract_images(archive: &Path, target: &Path) -> Result<Vec<String>, String> {
    // 部分 CBR 实际是 zip 打包，按内容而不是扩展名判断；真正的 RAR 压缩包直接给出可执行的提示
    let mut magic = [0_u8; 4];
    let zip_like = File::open(archive)
        .and_then(|mut probe| probe.read(&mut magic))
        .map(|read| read == 4 && &magic == b"PK\x03\x04")
        .unwrap_or(false);
    if !zip_like {
        return Err("这个漫画包是 RAR 压缩（CBR），暂不支持；请转换成 CBZ 后重新导入".into());
    }
    let file = File::open(archive).map_err(|error| error.to_string())?;
    let mut zip = ZipArchive::new(file).map_err(|_| "无法读取 CBZ 压缩包".to_string())?;
    let mut pages: Vec<(String, usize)> = Vec::new();
    for index in 0..zip.len() {
        let entry = zip.by_index(index).map_err(|error| error.to_string())?;
        if entry.is_dir() {
            continue;
        }
        let name = entry.name().to_string();
        let extension = name
            .rsplit('.')
            .next()
            .unwrap_or_default()
            .to_ascii_lowercase();
        if IMAGE_EXTENSIONS.contains(&extension.as_str()) {
            pages.push((name, index));
        }
    }
    if pages.is_empty() {
        return Err("CBZ 中没有找到图片".into());
    }
    pages.sort_by(|left, right| natural_order(&left.0, &right.0));
    fs::create_dir_all(target).map_err(|error| error.to_string())?;
    let mut files = Vec::with_capacity(pages.len());
    for (position, (name, index)) in pages.iter().enumerate() {
        let extension = name
            .rsplit('.')
            .next()
            .unwrap_or("jpg")
            .to_ascii_lowercase();
        let file_name = format!("{:04}.{extension}", position + 1);
        let mut entry = zip.by_index(*index).map_err(|error| error.to_string())?;
        if entry.size() > IMAGE_LIMIT {
            return Err(format!("图片 {name} 超过 64 MB，已中止导入"));
        }
        let mut bytes = Vec::with_capacity(entry.size() as usize);
        entry
            .read_to_end(&mut bytes)
            .map_err(|error| error.to_string())?;
        fs::write(target.join(&file_name), bytes).map_err(|error| error.to_string())?;
        files.push(file_name);
    }
    Ok(files)
}

/// 按数字段比较文件名，保证 2.jpg 排在 10.jpg 前面。
fn natural_order(left: &str, right: &str) -> Ordering {
    let (mut left, mut right) = (left.as_bytes(), right.as_bytes());
    loop {
        match (left.first(), right.first()) {
            (None, None) => return Ordering::Equal,
            (None, Some(_)) => return Ordering::Less,
            (Some(_), None) => return Ordering::Greater,
            (Some(a), Some(b)) if a.is_ascii_digit() && b.is_ascii_digit() => {
                let left_digits = left.iter().take_while(|byte| byte.is_ascii_digit()).count();
                let right_digits = right
                    .iter()
                    .take_while(|byte| byte.is_ascii_digit())
                    .count();
                let number = |digits: &[u8]| {
                    std::str::from_utf8(digits)
                        .ok()
                        .and_then(|value| value.parse::<u128>().ok())
                        .unwrap_or(0)
                };
                let left_number = number(&left[..left_digits]);
                let right_number = number(&right[..right_digits]);
                match left_number.cmp(&right_number) {
                    Ordering::Equal => {}
                    order => return order,
                }
                left = &left[left_digits..];
                right = &right[right_digits..];
            }
            (Some(a), Some(b)) if a.eq_ignore_ascii_case(b) => {
                left = &left[1..];
                right = &right[1..];
            }
            (Some(a), Some(b)) => return a.to_ascii_lowercase().cmp(&b.to_ascii_lowercase()),
        }
    }
}

#[cfg(test)]
mod tests {
    use std::io::Write as _;

    use super::extract_images;

    #[test]
    fn sorts_pages_naturally_and_copies_images() {
        let directory = std::env::temp_dir().join(format!("comic-test-{}", std::process::id()));
        let archive = directory.join("sample.cbz");
        let target = directory.join("pages");
        std::fs::create_dir_all(&directory).unwrap();
        let mut writer = zip::ZipWriter::new(std::fs::File::create(&archive).unwrap());
        let options: zip::write::SimpleFileOptions = Default::default();
        for name in ["10.jpg", "2.jpg", "1.jpg", "notes.txt"] {
            writer.start_file(name, options).unwrap();
            writer.write_all(name.as_bytes()).unwrap();
        }
        writer.finish().unwrap();

        let files = extract_images(&archive, &target).unwrap();
        assert_eq!(files, ["0001.jpg", "0002.jpg", "0003.jpg"]);
        assert_eq!(std::fs::read(target.join("0002.jpg")).unwrap(), b"2.jpg");

        let rar = directory.join("sample.cbr");
        std::fs::write(&rar, b"Rar!\x1a\x07\x00payload").unwrap();
        assert!(extract_images(&rar, &target).is_err());
        std::fs::remove_dir_all(&directory).unwrap();
    }
}
