# 跨平台预览版

## 构建目标

| 平台 | 安装包 | 当前范围 |
| --- | --- | --- |
| macOS Apple Silicon | arm64 DMG | 阅读、批注、知识库、DSH |
| macOS Intel | x64 DMG | 同上，独立构建 |
| Windows 10/11 x64 | NSIS EXE | 同上，WebView2 安装器按需下载运行时 |
| Ubuntu 22.04+ x64 | DEB、AppImage | 同上，密钥存储需要桌面 Secret Service |
| Android 8+ arm64 | 测试 APK | 离线阅读、记录、批注和知识库；DSH/AI 尚未集成 |
| iOS | 本轮不打包 | 尚未适配及验证 |

安装包生成不等于真机验证通过。Android 使用测试签名，不用于正式商店发布；后续换签名可能需要卸载，卸载会删除应用私有数据，当前不要在 Android 预览版中存放唯一副本。桌面包没有商业代码签名或 Apple 公证，系统可能显示未知开发者提示。

## 桌面 DSH

安装包随附 Node 24.20.0 与 npm，仅放在应用资源目录。打包脚本从 nodejs.org 下载对应架构并校验官方 SHA256，同时附带 Node 许可证。运行时使用直接 `node npm-cli.js` 调用，Windows 不依赖 Shell 对 `npm.cmd` 的解析。

DSH 本体仍须在 AI 设置中手动安装或更新到应用数据目录的 `dsh-runtime`；不会读取、安装或修改全局 DSH。阅读器插件仍默认内置。发布构建不回退到系统 Node；开发模式保留系统 Node 方便调试。npm 缓存位于应用私有运行时目录。

## Android 边界

Android 通过原生文件选择器导入 PDF、TXT、Markdown，选择后在后台流式复制到临时私有目录，最大 512 MB，再复用桌面的内容哈希入库。取消选择不报错，失败清理临时文件。不会申请整个存储的读写权限。

窄屏显示可点击菜单和目录入口，设置、批注和知识详情使用全宽视图，并提供显式关闭按钮。长按选区后显示阅读操作菜单；后台切换时尝试保存阅读位置。应用被系统强制终止时，未手动保存的记录不保证保留。

Android 没有可直接执行的桌面 Node/npm。当前明确禁用 AI 配置提交及运行，不保存 API Key，不引入模型直连作为替代。后续需要单独验证 Android 内嵌 Node 引擎、DSH 依赖兼容性及应用私有运行时更新策略后才能启用；不能把桌面可执行文件复制进 APK 冒充支持。

## 发布与验证

`.github/workflows/release.yml` 由 `workflow_dispatch` 触发，输入已经存在的预发布标签。各平台从同一标签构建，独立上传安装包到该 Release，单个任务失败不取消其他平台。Android 项目由 Tauri CLI 初始化，并加入 `src-tauri/android/BookPickerPlugin.kt`，不提交本机 SDK 路径或生成目录。

桌面本地复现：

```sh
npm ci
npm test
cargo test --manifest-path src-tauri/Cargo.toml --locked
node scripts/prepare-node.mjs
npm run tauri -- build --config src-tauri/tauri.desktop.conf.json
```

验证顺序：安装并离线启动；导入书籍；翻页后重开；保存、编辑、取消删除和确认删除批注；知识库仍可查看；桌面再手动安装 DSH 并发送测试问题。发布资产应附 SHA256 校验清单，Android 安装包需通过签名校验。出现失败时以 Actions 日志和 Release 限制说明为准，不宣称所有平台都已真机验收。

参考：[Tauri 移动端准备](https://v2.tauri.app/start/prerequisites/)、[Android 文件访问差异](https://v2.tauri.app/plugin/dialog/)、[Node 官方发布清单](https://nodejs.org/dist/index.json)。
