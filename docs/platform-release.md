# 跨平台预览版

## 构建目标

| 平台 | 安装包 | 当前范围 |
| --- | --- | --- |
| macOS 13.5+ Apple Silicon | arm64 DMG | 阅读、批注、知识库、DSH |
| macOS 13.5+ Intel | x64 DMG | 同上，独立构建 |
| Windows 10/11 x64 | NSIS EXE | 同上，WebView2 安装器按需下载运行时 |
| Ubuntu 22.04+ x64 | DEB、AppImage | 同上，密钥存储需要桌面 Secret Service |
| Android 8+ arm64 | 测试 APK | 阅读、记录、批注、知识库、应用私有 DSH 与阅读器插件 |
| iOS | 本轮不打包 | 尚未适配及验证 |

安装包生成不等于真机验证通过。Android 使用测试签名，不用于正式商店发布；后续换签名可能需要卸载，卸载会删除应用私有数据，当前不要在 Android 预览版中存放唯一副本。macOS 包使用 ad-hoc 完整性签名，没有 Developer ID 签名或 Apple 公证；Windows 未签名，系统可能显示未知开发者提示。

## 桌面 DSH

安装包随附 Node 24.20.0 与 npm，仅放在应用资源目录。打包脚本从 nodejs.org 下载对应架构并校验官方 SHA256，同时附带 Node 许可证。运行时使用直接 `node npm-cli.js` 调用，Windows 不依赖 Shell 对 `npm.cmd` 的解析。

DSH 本体仍须在 AI 设置中手动安装或更新到应用数据目录的 `dsh-runtime`；不会读取、安装或修改全局 DSH。阅读器插件仍默认内置。发布构建不回退到系统 Node；开发模式保留系统 Node 方便调试。npm 缓存位于应用私有运行时目录。

## Android 边界

Android 通过原生文件选择器导入 PDF、TXT、Markdown，选择后在后台流式复制到临时私有目录，最大 512 MB，再复用桌面的内容哈希入库。取消选择不报错，失败清理临时文件。不会申请整个存储的读写权限。

窄屏显示可点击菜单和目录入口，设置、批注和知识详情使用全宽视图，并提供显式关闭按钮。长按选区后显示阅读操作菜单；后台切换时尝试保存阅读位置。应用被系统强制终止时，未手动保存的记录不保证保留。

Android 从官方 Node 24.20.0 源码交叉编译 arm64/x64 运行时，使用 Android NDK 27.2 与 16 KB 链接对齐，随 APK 安装。应用继续使用同一 DSH 子进程协议、默认阅读器插件、提示词和工具边界。DSH 保持在应用私有目录手动安装/更新；API Key 由 Android Keystore 加密保护。具体行为见 [DSH 阅读器插件](dsh-reader.md)。Node 上游未将 Android 列为正式支持平台，因此必须以应用构建和设备测试结果为准。

## 发布与验证

`.github/workflows/release.yml` 由 `workflow_dispatch` 触发，输入已经存在的预发布标签。各平台从同一标签构建，独立上传安装包到该 Release，单个任务失败不取消其他平台。Android 项目由 Tauri CLI 初始化，并加入 `src-tauri/android/BookPickerPlugin.kt`，不提交本机 SDK 路径或生成目录。Android 编译和模拟器验收使用独立构建机，避免磁盘不足；`android_only` 可单独重试移动端，`android_artifact_run_id` 可复用同一标签的已有 APK 产物。验收脚本使用本次工作流版本，应用仍来自指定标签。

设置 `validation_only=true` 时仅构建验收，不上传 Release，可使用分支或提交作为 `tag`。正式预览包先上传为草稿，待各平台检查完成后再发布；Android Node 源码构建脚本也从指定标签检出。

桌面本地复现：

```sh
npm ci
npm test
cargo test --manifest-path src-tauri/Cargo.toml --locked
node scripts/prepare-node.mjs
npm run tauri -- build --config src-tauri/tauri.desktop.conf.json
```

验证顺序：安装并离线启动；导入书籍；翻页后重开；保存、编辑、取消删除和确认删除批注；知识库仍可查看；桌面再手动安装 DSH 并发送测试问题。发布资产应附 SHA256 校验清单，Android 安装包需通过签名校验。出现失败时以 Actions 日志和 Release 限制说明为准，不宣称所有平台都已真机验收。

## 2026-09-08 验收结果

[下载本轮预览版](https://github.com/duanyunlun/AI-eBook/releases/tag/v0.1.0-preview.20260908.2)，应用源码标签为 `v0.1.0-preview.20260908.2`。

- [桌面构建](https://github.com/duanyunlun/AI-eBook/actions/runs/34172648160)：四个平台任务成功，产出五个安装包；各任务通过 17 项前端单测、6 项 Rust 测试及真实 DSH 子进程与模拟模型的插件集成测试。
- macOS 本机检查：两个下载 DMG 的完整性签名校验通过；Apple Silicon 包内私有 Node 可执行。macOS 应用首屏和窄屏界面另有本地检查。
- [Android 验收](https://github.com/duanyunlun/AI-eBook/actions/runs/34177110964)：Android 15 x86_64 模拟器安装、启动、WebView 与异常日志检查通过；截图确认“打开书籍”入口显示。发布的 arm64 APK 通过签名校验，但尚无 arm64 真机验证。
- 曾在资源紧张的模拟器冷启动时出现无响应；增加模拟器资源并等待系统启动稳定后复测通过。不能据此保证低端真机的启动表现。
- Windows/Linux 尚未人工安装验收；Android 文件导入、批注持久化及长时间阅读仍需真机测试。当前移动版不能使用 DSH/AI，iOS 未打包。

参考：[Tauri 移动端准备](https://v2.tauri.app/start/prerequisites/)、[Android 文件访问差异](https://v2.tauri.app/plugin/dialog/)、[Node 官方发布清单](https://nodejs.org/dist/index.json)。
