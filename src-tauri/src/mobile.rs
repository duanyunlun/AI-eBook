use serde::Deserialize;
use std::path::PathBuf;
use tauri::{
    AppHandle, Manager, Wry,
    plugin::{Builder, PluginHandle, TauriPlugin},
};

struct BookPicker(PluginHandle<Wry>);

#[derive(Deserialize)]
pub struct PickedBook {
    pub path: PathBuf,
    pub name: String,
}

pub fn init() -> TauriPlugin<Wry> {
    Builder::new("book-picker")
        .setup(|app, api| {
            let handle = api.register_android_plugin("app.aiebook.reader", "BookPickerPlugin")?;
            app.manage(BookPicker(handle));
            Ok(())
        })
        .build()
}

pub async fn pick_book(app: AppHandle) -> Result<Option<PickedBook>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        #[derive(Deserialize)]
        struct ResultData {
            book: Option<PickedBook>,
        }
        let result: ResultData = app
            .state::<BookPicker>()
            .0
            .run_mobile_plugin("pickBook", ())
            .map_err(|_| "无法导入所选文件，请选择本地 PDF、TXT 或 Markdown 文件（最大 512 MB）")?;
        if let Some(book) = &result.book {
            let imports = app
                .path()
                .app_cache_dir()
                .map_err(|_| "缓存目录不可用")?
                .join("imports");
            let actual = book.path.canonicalize().map_err(|_| "临时书籍不可用")?;
            if !actual.starts_with(imports.canonicalize().map_err(|_| "导入目录不可用")?) {
                return Err("导入文件路径无效".into());
            }
        }
        Ok(result.book)
    })
    .await
    .map_err(|error| error.to_string())?
}
