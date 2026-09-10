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

安装包生成不等于真机验证通过。Android 使用固定预览签名，供测试和后续覆盖升级，不用于正式商店发布；旧 `.2` 版本使用临时签名，无法直接覆盖升级，需先备份数据再卸载旧包。卸载会删除应用私有数据，预览版中不要存放唯一副本。macOS 包使用 ad-hoc 完整性签名，没有 Developer ID 签名或 Apple 公证；Windows 未签名，系统可能显示未知开发者提示。

Android 固定签名通过 Actions Secrets `ANDROID_PREVIEW_KEYSTORE`（PKCS12 的 Base64）与 `ANDROID_PREVIEW_STORE_PASSWORD` 注入，别名为 `ai-ebook-preview`。私钥和密码不进入 Git、安装包或构建产物。证书 SHA256 为 `82d9aeaf645261256b275deb3f41b745aa14eb4815320d4c59c61c1878dadb41`，构建后校验签名、CPU 架构和 16 KB ELF 对齐。不要随意重新生成签名，否则会破坏覆盖升级。

## EPUB 导入

桌面与 Android 都能导入 EPUB 2/3：导入时按 spine 顺序提取各章正文，转成带标题的 Markdown 存入书库，章节目录、阅读进度、批注与 AI 上下文复用现有文本链路。图片、样式和脚本不进入正文；纯图片或带 DRM 加密的 EPUB 会拒绝导入并提示。书库只保存提取后的正文，原文件不入库，需要保留原始文件时请自行备份。

## 桌面 DSH

安装包随附 Node 24.20.0 与 npm，仅放在应用资源目录。打包脚本从 nodejs.org 下载对应架构并校验官方 SHA256，同时附带 Node 许可证。运行时使用直接 `node npm-cli.js` 调用，Windows 不依赖 Shell 对 `npm.cmd` 的解析。

DSH 本体仍须在 AI 设置中手动安装或更新到应用数据目录的 `dsh-runtime`；不会读取、安装或修改全局 DSH。阅读器插件仍默认内置。发布构建不回退到系统 Node；开发模式保留系统 Node 方便调试。npm 缓存位于应用私有运行时目录。

## Android 边界

移动端左右侧栏不显示关闭按钮，使用系统返回或阅读区点击收起。侧栏已打开时，在露出的阅读区朝收起方向滑动只关闭当前侧栏，同一次手势不会打开另一侧；朝展开方向滑动保持当前侧栏。桌面的鼠标、快捷键及关闭入口保持原行为。

移动端阅读默认收起上下悬浮控件，轻点阅读区域切换显示；中间区域右滑打开左侧主菜单，左滑打开右侧伴读栏。纵向滚动、双指缩放、长按选区及批注点击不触发横滑。系统取消触摸时放弃识别，不申请系统手势排除区域；外观设置可调整两侧滑动禁区（24–120 CSS px，默认 32），拖动时显示等宽半透明色带，不拦截触摸。

平台由原生 `platform_info` 返回的 `mobile` / `android` 判定。移动手势、独立移动样式和 Android 返回键模块按平台加载；桌面触屏或窄窗口不会因此启用移动导航。公共布局仍按窗口宽度自适应，鼠标悬停能力按输入设备判断。设置页在桌面与移动端均移除大标题，顶部保留页签和紧凑关闭入口。

Android 系统返回键先由系统收起软键盘，再逐层关闭弹窗、确认区、设置、书库、知识详情、知识库、历史对话、批注编辑及侧栏；批注编辑复用原有未保存确认。回到阅读区后再返回，会保存阅读位置并将任务移到后台，恢复时保留当前会话。移动端外接键盘 Esc 使用相同的页面关闭顺序，桌面原有快捷键行为保持不变。

Android 外观设置可切换“隐藏系统状态栏”，即时生效并记住选择。原生窗口按系统栏、屏幕切口和键盘的实际 Insets 留出空间；隐藏状态栏时重新分配阅读高度，导航返回手势保持系统默认。实现依据：[Android 系统栏与 Insets](https://developer.android.com/develop/ui/views/layout/edge-to-edge)。

Android 通过原生文件选择器导入 PDF、TXT、Markdown、EPUB，选择后在后台流式复制到临时私有目录，最大 512 MB，再复用桌面的内容哈希入库。取消选择不报错，失败清理临时文件。不会申请整个存储的读写权限。

触控设备和窄屏显示可点击菜单、目录及关闭入口，不依赖鼠标悬停；窄屏的设置、批注和知识详情使用全宽视图。长按选区后显示阅读操作菜单；后台切换时尝试保存阅读位置。应用被系统强制终止时，未手动保存的记录不保证保留。

Android 从官方 Node 24.20.0 源码交叉编译 arm64/x64 运行时，使用 Android NDK 27.2 与 16 KB 链接对齐，随 APK 安装。应用继续使用同一 DSH 子进程协议、默认阅读器插件、提示词和工具边界。DSH 保持在应用私有目录手动安装/更新；API Key 由 Android Keystore 加密保护。具体行为见 [DSH 阅读器插件](dsh-reader.md)。Node 上游未将 Android 列为正式支持平台，因此必须以应用构建和设备测试结果为准。

## 发布与验证

`.github/workflows/release.yml` 由 `workflow_dispatch` 触发，输入已经存在的预发布标签。各平台从同一标签构建，独立上传安装包到该 Release，单个任务失败不取消其他平台。Android 项目由 Tauri CLI 初始化，并加入 `src-tauri/android/BookPickerPlugin.kt`，不提交本机 SDK 路径或生成目录。Android 编译和模拟器验收使用独立构建机，避免磁盘不足；`android_only` 可单独重试移动端，`android_artifact_run_id` 可复用同一标签的已有 APK 产物。验收脚本使用本次工作流版本，应用仍来自指定标签。

设置 `validation_only=true` 时仅构建验收，不上传 Release，可使用分支或提交作为 `tag`。正式预览包先上传为草稿，待各平台检查完成后再发布；Android Node 源码构建脚本也从指定标签检出。

Android 本机单架构调试时，将对应 Node 构建产物放入 `.build-cache/android-node/android-node-arm64`（或 `android-node-x64`），初始化 Android 项目后执行 `node scripts/prepare-android.mjs arm64`（或 `x64`）。不传参数时仍准备两种架构，供发布流程使用。

Apple Silicon 本机也可设置 `NDK_HOME` 后运行 `AI_EBOOK_NODE_JOBS=10 bash scripts/build-android-node.sh arm64`，产物位于 `.build-cache/android-node/arm64`。脚本使用 Xcode 宿主工具、NDK Android 编译器，并修正上游 GYP 对宿主系统的判断；只构建 Node，不构建上游 C++ 测试程序。将产物复制到上一段指定目录后构建 APK。Android 本机验收通过时，可使用 `desktop_only=true` 单独构建桌面安装包，再将同一提交的已验证 APK 上传到草稿 Release；此选项本身不代表 Android 验收通过。

国内网络下载缓慢时，使用项目内 Gradle 缓存和阿里云镜像，不改系统全局配置：

```sh
export GRADLE_USER_HOME="$PWD/.build-cache/gradle"
mkdir -p "$GRADLE_USER_HOME/init.d"
cp scripts/gradle-mirrors.gradle "$GRADLE_USER_HOME/init.d/mirrors.gradle"
```

镜像规则覆盖 Google Maven、Maven Central 与 Gradle Plugin Portal，包括 `buildSrc`；配置依据为[阿里云镜像说明](https://help.aliyun.com/zh/document_detail/436767.html)。本机有 HTTP 代理时，应让 `*.aliyun.com` 直接连接。单架构 APK 使用 `python3 scripts/check-android-apks.py arm64` 检查；连接对应模拟器后，设置 `ANDROID_TEST_APK` 为安装包路径、`AI_EBOOK_TEST_REGISTRY=https://registry.npmmirror.com/`，执行 `bash scripts/android-smoke.sh`。

桌面本地复现：

```sh
npm ci
npm test
cargo test --manifest-path src-tauri/Cargo.toml --locked
node scripts/prepare-node.mjs
npm run tauri -- build --config src-tauri/tauri.desktop.conf.json
```

验证顺序：安装并离线启动；导入书籍；翻页后重开；保存、编辑、取消删除和确认删除批注；知识库仍可查看；桌面再手动安装 DSH 并发送测试问题。发布资产应附 SHA256 校验清单，Android 安装包需通过签名校验。出现失败时以 Actions 日志和 Release 限制说明为准，不宣称所有平台都已真机验收。

## 2026-09-08 Android DSH 本机验收

[下载新版 .3](https://github.com/duanyunlun/AI-eBook/releases/tag/v0.1.0-preview.20260908.3)。[桌面发布构建](https://github.com/duanyunlun/AI-eBook/actions/runs/34224122660)的 macOS arm64/x64、Windows x64、Linux x64 四项任务均通过，包含各自单元测试和真实 DSH 子进程集成测试；与本机 Android APK 一并发布六个安装包及校验清单。

- Android 15 arm64 模拟器：从空应用数据安装，通过私有 npm/DSH 安装、默认插件、安全凭据存储及密文恢复检查。
- 同一应用接口通过图片附件、五项工具协议往返、流式回答、取消和取消后再次对话；模型为本机测试服务，工具回复为测试数据。
- 固定签名覆盖安装后，密钥、模型配置和知识记录保留，再次手动更新 DSH 成功；启动日志未发现应用崩溃或 ANR。
- APK 内 Node/npm 资源逐文件一致，原生程序架构、可执行入口、签名和 16 KB ELF 对齐检查通过。16 KB 真机尚未验证。
- 本机使用国内 Gradle/npm 镜像完成构建及安装验证。Android 按应用私有目录、Keystore 和平台文件操作规则适配，没有增加存储权限。
- 真机上的文件选择、长篇阅读、系统后台回收及界面细节仍需用户验证；不把模拟器结果等同于所有手机验收通过。
- `.3` 存在设置页顶部与系统状态栏重叠，本次触屏更新已增加原生 Insets 避让。

## 触屏交互更新验证

### 正文字体与 PDF 原版

“外观 → 字体 → 正文字体”提供系统、衬线、无衬线字体，16–32px 字号和三档行距，仅应用于 TXT、Markdown、EPUB 等可重排文本。偏好独立于 UI 字号，保存到 reading-typography，并兼容读取上一版的正文字体数值。

PDF 始终使用原版，已移除裁白边、文字重排和模式切换入口；旧 PDF 模式偏好不再生效。原版缩放、阅读工具、截图、批注和此前的阅读配色继续保留。旧重排模式创建的批注保留文字定位兼容，无法唯一匹配时仍可在批注栏查看。

`src/pdf-reading-ui.test.html` 验证旧重排偏好不会改变 PDF、原版缩放与文字读取正常、旧批注兼容，以及 TXT 字号、行距、分段和窄屏布局。

记录底部操作文案为“本书记录”“总结思考”“保存记录”。移动端使用等宽单行网格，按钮高度至少 40px，字号跟随 UI 设置，桌面布局不变。`src/record-actions-ui.test.html` 验证 320–768px 和不同 UI 字号下无换行、文字溢出或按钮越界。

伴读顶部三个页签等宽，切换思考、记录、批注时保留操作区占位；截图与固定批注按钮共用同一个 30px 方形位置，图标使用居中 SVG。此布局由桌面与移动端共用。

运行 `PATH="$PWD/.build-cache/android-sdk/platform-tools:$PATH" node scripts/android-touch-test.mjs`，在已启动的 Android 调试版上验证点击浮层、右滑主菜单、左滑伴读栏、禁区示意、纵向滚动、长按、双指触摸、系统取消触摸、设置持久化及原生返回键。历史弹层使用测试内容，不依赖真实书籍。无开孔模拟器增加 `ANDROID_NO_CUTOUT=1` 检查隐藏状态栏确实增加可用高度。桌面平台隔离与快捷键使用 `src/platform-ui.test.html`，批注未保存返回使用 `src/margin-notes-ui.test.html` 验证。

Android 15 arm64 模拟器无开孔模式下，可用高度为 867 → 891 → 867 CSS px；有开孔时保留开孔安全区，隐藏时不强制把按钮放到开孔下。手机厂商的返回手势与长按选区体验仍需真机验证。

## 2026-09-08 早间旧版验收结果（.2）

[下载本轮预览版](https://github.com/duanyunlun/AI-eBook/releases/tag/v0.1.0-preview.20260908.2)，应用源码标签为 `v0.1.0-preview.20260908.2`。

- [桌面构建](https://github.com/duanyunlun/AI-eBook/actions/runs/34172648160)：四个平台任务成功，产出五个安装包；各任务通过 17 项前端单测、6 项 Rust 测试及真实 DSH 子进程与模拟模型的插件集成测试。
- macOS 本机检查：两个下载 DMG 的完整性签名校验通过；Apple Silicon 包内私有 Node 可执行。macOS 应用首屏和窄屏界面另有本地检查。
- [Android 验收](https://github.com/duanyunlun/AI-eBook/actions/runs/34177110964)：Android 15 x86_64 模拟器安装、启动、WebView 与异常日志检查通过；截图确认“打开书籍”入口显示。发布的 arm64 APK 通过签名校验，但尚无 arm64 真机验证。
- 曾在资源紧张的模拟器冷启动时出现无响应；增加模拟器资源并等待系统启动稳定后复测通过。不能据此保证低端真机的启动表现。
- Windows/Linux 尚未人工安装验收；Android 文件导入、批注持久化及长时间阅读仍需真机测试。当前移动版不能使用 DSH/AI，iOS 未打包。

参考：[Tauri 移动端准备](https://v2.tauri.app/start/prerequisites/)、[Android 文件访问差异](https://v2.tauri.app/plugin/dialog/)、[Node 官方发布清单](https://nodejs.org/dist/index.json)。
