use serde::Deserialize;
use serde_json::json;
use std::path::PathBuf;
use tauri::{
    AppHandle, Manager, Wry,
    plugin::{Builder, PluginHandle, TauriPlugin},
};

struct BookPicker(PluginHandle<Wry>);

pub async fn background_app(app: AppHandle) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        app.state::<BookPicker>()
            .0
            .run_mobile_plugin::<serde_json::Value>("backgroundApp", ())
            .map(|_| ())
            .map_err(|_| "无法返回系统桌面".to_string())
    })
    .await
    .map_err(|_| "返回系统桌面任务失败".to_string())?
}

pub async fn set_status_bar(app: AppHandle, hidden: bool) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        app.state::<BookPicker>()
            .0
            .run_mobile_plugin::<serde_json::Value>("statusBar", json!({"hidden": hidden}))
            .map(|_| ())
            .map_err(|_| "无法设置系统状态栏".to_string())
    })
    .await
    .map_err(|_| "状态栏设置任务失败".to_string())?
}

#[derive(Deserialize)]
pub struct RuntimePaths {
    pub node: PathBuf,
    pub npm: PathBuf,
}

pub fn runtime_paths(app: &AppHandle) -> Result<RuntimePaths, String> {
    app.state::<BookPicker>()
        .0
        .run_mobile_plugin("runtimePaths", ())
        .map_err(|_| "无法准备应用内置 Node 运行时，请重新安装完整安装包".into())
}

pub async fn credential(
    app: AppHandle,
    account: String,
    secret: Option<String>,
) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        #[derive(Deserialize)]
        struct Credential {
            #[serde(default)]
            secret: String,
        }
        let result: Credential = app
            .state::<BookPicker>()
            .0
            .run_mobile_plugin("credential", json!({"account": account, "secret": secret}))
            .map_err(|_| "无法访问系统安全存储，请重新保存 API Key")?;
        Ok(result.secret)
    })
    .await
    .map_err(|_| "系统安全存储任务失败")?
}

pub async fn pick_plugin(app: AppHandle) -> Result<Option<PathBuf>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        #[derive(Deserialize)]
        struct ResultData {
            path: Option<PathBuf>,
        }
        let result: ResultData = app
            .state::<BookPicker>()
            .0
            .run_mobile_plugin("pickPlugin", ())
            .map_err(|_| "无法导入阅读器插件目录")?;
        if let Some(path) = &result.path {
            let root = app
                .path()
                .app_cache_dir()
                .map_err(|_| "缓存目录不可用")?
                .join("plugins");
            if !path
                .canonicalize()
                .map_err(|_| "插件目录不可用")?
                .starts_with(root.canonicalize().map_err(|_| "插件缓存目录不可用")?)
            {
                return Err("插件目录无效".into());
            }
        }
        Ok(result.path)
    })
    .await
    .map_err(|_| "插件导入任务失败")?
}

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
