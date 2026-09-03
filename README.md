# AI-eBook

面向桌面端的 AI 伴读与个人阅读知识库。当前阶段只支持键盘和鼠标，优先完成一条可验证的阅读闭环：恢复阅读位置、引用内容、与 AI 对话、确认写入批注、按章节总结并由 Git 留存历史。

开发前先阅读 [架构设计](docs/architecture.md)。

## 当前进度

- 支持将本地 PDF 按 SHA-256 导入书库、纵向连续滚动和缩放，视口附近页面按需渲染。
- 支持跟随系统的明暗主题，并记住手动选择。
- 使用全屏阅读区、左右抽屉和底部悬停阅读控制。
- 阅读页码持久化到 SQLite，重新启动和从书库打开时恢复。
- 支持配置 OpenAI Chat/Responses、Anthropic Messages 和 Gemini GenerateContent，兼容常见 OpenAI-compatible 服务。
- API Key 保存到系统凭据库，可在设置页保存配置并测试连接。
- 已建立 SQLite 知识库首版 schema，包含证据、知识项、关系、会话和 FTS5 全文索引，并在应用启动时自动迁移。
- PDF 文字选择会调起思考模式；扫描页可框选截图并发送给支持图像的模型。
- 支持流式伴读对话、相关知识检索、个人记录、按书总结，以及用户确认后录入知识库。
- 已确认知识、截图和会话写入开放格式知识库，并使用本地 Git 保存历史。
- 知识库页面支持全文搜索、来源区分和局部关系图；知识库目录可在设置中更改。
- 已接入 Tauri 2 桌面容器，可构建 macOS 应用。

## 本地运行

```bash
npm ci
npm run dev
npm run tauri dev
```

检查：

```bash
npm test
npm run build
cargo fmt --check --manifest-path src-tauri/Cargo.toml
cargo check --manifest-path src-tauri/Cargo.toml
```
