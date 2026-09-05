# DSH 阅读器插件

## 使用与更新

在设置的 AI 页手动检查并安装 DSH，再将“对话运行时”切换为“内置 DSH + 阅读器插件”。默认仍为直连；不自动安装、更新或回退运行时。需要本机 Node.js/npm，当前集成验证使用 Node.js 24 与 `@deepseek-ai/dsh@0.1.2-rc.1`。

DSH 沿用 `<app-data>/dsh-runtime` 的 npm `--prefix` 安装，绝不使用全局 DSH。阅读器插件位于 `<app-data>/dsh-reader/plugins/<内容哈希>`，当前选择记录在 `active-plugin.json`；每次请求使用临时 reader profile，正常结束或取消时清理。应用崩溃可能遗留请求临时目录。

“导入插件”选择含 `package.json`、`index.mjs`、`cordis.patch.yml` 的可信目录；每个文件最多 2 MB。导入不更新 DSH，不影响运行中的旧插件，下次请求生效。“恢复内置插件”恢复应用附带版本。插件是可信 Node.js 代码，**不是操作系统沙箱**，不要导入不可信来源。运行时仍由用户手动更新；未来 DSH 版本不在插件兼容清单时拒绝运行，需配套更新插件。

## 协议与边界

插件源码位于 `plugins/dsh-reader`，复用 DSH 的 Cordis、Agent、工具服务与模型适配器，不修改 DSH 源码。插件清单 `aiEbook.bridgeVersion` 当前为 1，`dshVersions` 明确列出验证过的版本。

标准输入输出使用 JSON-RPC 2.0 单行 JSON：宿主发送 `reader/hello`、`reader/generate`；插件通知 `reader/reset`、`reader/delta`，以反向请求 `reader/tool` 等待宿主返回结果。生成响应 `{finished:true}` 表示完成。插件支持 `reader/cancel`；应用取消时直接终止对应子进程，并关闭待确认弹窗。宿主限制单帧 8 MB、通信或工具等待 180 秒；插件限制每次请求 16 次工具调用、20 个生成步骤。

密钥由 Rust 从系统凭据库读取，只通过子进程环境传递，不出现在命令行、profile 或前端工具参数中。插件仅通过官方模型适配器访问用户配置的模型端点；远程地址要求 HTTPS。没有接入通用网页检索、Shell、任意文件读取或删除工具。

| 工具 | 范围 |
| --- | --- |
| `reading_context` | 请求绑定的作品、页码、选区和页面快照，文本各最多 20,000 字符 |
| `read_page` | 当前作品指定页，TXT/Markdown 为章节；返回最多 20,000 字符并标记截断 |
| `search_book` | 每批最多扫描 100 页，最多 20 个匹配，返回下一批起点；不改变阅读位置 |
| `search_knowledge` | 当前作品匹配记录，最多 10 条、每条正文 4,000 字符 |
| `save_note` | 显示标题和正文供用户确认，确认后独立保存 AI 知识项；不修改或删除旧内容 |

工具不接受模型提供的书籍 ID 或磁盘路径；切书后旧请求不能读取新书。扫描版 PDF 无文本时不假装已经 OCR。已有历史以带角色标记的文本上下文恢复，不是 DSH 原生多轮会话；每个请求独立进程会增加启动成本。应用对话和知识库继续由现有 SQLite/Markdown/Git 管理，删除对话不会删除已保存知识。

## 验证

```sh
npm test
npm run build
cargo test --manifest-path src-tauri/Cargo.toml
npm install --prefix .npm-cache/dsh-runtime --cache .npm-cache/npm @deepseek-ai/dsh@0.1.2-rc.1
node --test plugins/dsh-reader/integration.test.mjs
```

集成测试启动真实 DSH 与本机模拟 OpenAI Chat SSE 服务，验证工具调用、结果回传和等待工具时取消，不使用用户密钥。测试 profile 在项目忽略目录内自动创建和清理。其他模型协议复用官方适配器，但尚未逐一完成真实服务端验收。

启动开发服务后访问 `/src/reader-tools-ui.test.html`，验证完整章节检索、输出限制、跨书隔离、保存确认、取消和中断；该页面使用模拟持久化接口，不修改用户知识库。
