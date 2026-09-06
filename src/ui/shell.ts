import appIconUrl from "../../src-tauri/icons/app-icon.svg?url";

export type ShellElements = {
  openBook: HTMLButtonElement;
  openChapters: HTMLButtonElement;
  openLibrary: HTMLButtonElement;
  openKnowledge: HTMLButtonElement;
  openSettings: HTMLButtonElement;
  emptyOpen: HTMLButtonElement;
  exitApp: HTMLButtonElement;
  pageInput: HTMLInputElement;
  pageTotal: HTMLElement;
  zoomOut: HTMLButtonElement;
  zoomSlider: HTMLInputElement;
  zoomIn: HTMLButtonElement;
  zoomLevel: HTMLElement;
  chapterToggle: HTMLButtonElement;
  chapterDrawer: HTMLElement;
  chapterList: HTMLElement;
  chapterClose: HTMLButtonElement;
  themeToggle: HTMLButtonElement;
  leftDrawer: HTMLElement;
  leftDrawerToggle: HTMLButtonElement;
  annotationDrawer: HTMLElement;
  annotationResizer: HTMLElement;
  annotationToggle: HTMLButtonElement;
  thoughtMode: HTMLButtonElement;
  recordMode: HTMLButtonElement;
  thoughtPanel: HTMLElement;
  recordPanel: HTMLElement;
  selectionContext: HTMLElement;
  selectionQuote: HTMLElement;
  selectionClear: HTMLButtonElement;
  conversation: HTMLElement;
  questionInput: HTMLTextAreaElement;
  questionResizer: HTMLElement;
  saveAnswer: HTMLButtonElement;
  relatedKnowledge: HTMLElement;
  noteTitle: HTMLInputElement;
  noteBody: HTMLDivElement;
  noteCommandMenu: HTMLElement;
  currentBookRecords: HTMLButtonElement;
  saveNote: HTMLButtonElement;
  summarizeNotes: HTMLButtonElement;
  capturePage: HTMLButtonElement;
  clearConversation: HTMLButtonElement;
  threadHistory: HTMLButtonElement;
  threadTitle: HTMLElement;
  threadList: HTMLElement;
  companionStatus: HTMLElement;
  emptyState: HTMLElement;
  pageStage: HTMLElement;
  loading: HTMLElement;
  error: HTMLElement;
  reader: HTMLElement;
  selectionActions: HTMLElement;
  selectionThink: HTMLButtonElement;
  selectionRecord: HTMLButtonElement;
  selectionTranslate: HTMLButtonElement;
  selectionExplain: HTMLButtonElement;
  lookupDialog: HTMLDialogElement;
  lookupTitle: HTMLElement;
  lookupSource: HTMLElement;
  lookupResultTitle: HTMLElement;
  lookupStatus: HTMLOutputElement;
  lookupBody: HTMLElement;
  lookupClose: HTMLButtonElement;
  settingsPanel: HTMLElement;
  vaultPath: HTMLInputElement;
  chooseVault: HTMLButtonElement;
  libraryPanel: HTMLElement;
  libraryList: HTMLElement;
  libraryImport: HTMLButtonElement;
  libraryClose: HTMLButtonElement;
  knowledgePanel: HTMLElement;
  knowledgeLeftDrawer: HTMLElement;
  knowledgeLeftTrigger: HTMLButtonElement;
  knowledgeCategories: HTMLElement;
  knowledgeList: HTMLElement;
  knowledgeSearch: HTMLInputElement;
  knowledgeGraph: SVGSVGElement;
  knowledgeZoomOut: HTMLButtonElement;
  knowledgeZoomFit: HTMLButtonElement;
  knowledgeZoomIn: HTMLButtonElement;
  knowledgeZoomLevel: HTMLOutputElement;
  knowledgeDetailDrawer: HTMLElement;
  knowledgeDetail: HTMLElement;
  knowledgeDetailResizer: HTMLElement;
  knowledgeDetailTrigger: HTMLButtonElement;
  knowledgeCreate: HTMLButtonElement;
  knowledgeContextMenu: HTMLElement;
  knowledgeContextCreate: HTMLButtonElement;
  knowledgeContextDelete: HTMLButtonElement;
  knowledgeClose: HTMLButtonElement;
};

export function mountShell(app: HTMLElement): ShellElements {
  app.innerHTML = `
    <div class="shell">
      <main class="workspace">
        <section class="reader" id="reader" aria-label="阅读区域">
          <div class="empty-state" id="empty-state">
            <img class="empty-mark" src="${appIconUrl}" alt="" />
            <button class="primary-command" id="empty-open" type="button">打开书籍</button>
          </div>
          <div class="page-stage" id="page-stage" hidden></div>
          <div class="loading" id="loading" hidden>正在打开…</div>
          <div class="error" id="error" role="alert" hidden></div>
        </section>

        <div class="selection-actions" id="selection-actions" role="menu" hidden>
          <button id="selection-think" type="button" role="menuitem">思考</button>
          <button id="selection-record" type="button" role="menuitem">记录</button>
          <button id="selection-annotate" type="button" role="menuitem" hidden>添加批注</button>
          <button id="selection-translate" type="button" role="menuitem">翻译</button>
          <button id="selection-explain" type="button" role="menuitem">解释</button>
        </div>

        <dialog class="lookup-dialog" id="lookup-dialog" aria-labelledby="lookup-title">
          <header>
            <h2 id="lookup-title">解释</h2>
            <button class="icon-command" id="lookup-close" type="button" aria-label="关闭窗口" title="关闭">×</button>
          </header>
          <div class="lookup-dialog-content">
            <section class="lookup-section">
              <h3>所选内容</h3>
              <div class="lookup-source" id="lookup-source"></div>
            </section>
            <section class="lookup-section">
              <div class="lookup-result-heading">
                <h3 id="lookup-result-title">解释结果</h3>
                <output class="ai-status" id="lookup-status" aria-live="polite"></output>
              </div>
              <article class="markdown-body" id="lookup-body" aria-live="polite"></article>
            </section>
          </div>
        </dialog>

        <aside class="chapter-drawer" id="chapter-drawer" aria-label="章节目录" aria-hidden="true">
          <header>
            <h2>目录</h2>
            <button class="icon-command" id="chapter-close" type="button" aria-label="关闭目录" title="关闭">×</button>
          </header>
          <nav class="chapter-list" id="chapter-list" aria-label="章节列表"></nav>
        </aside>

        <div class="reader-header-zone">
          <button class="chapter-toggle" id="chapter-toggle" type="button" aria-controls="chapter-drawer" aria-expanded="false" aria-label="打开目录" title="目录">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M8 6h12M8 12h12M8 18h12" />
              <circle cx="4" cy="6" r="1" />
              <circle cx="4" cy="12" r="1" />
              <circle cx="4" cy="18" r="1" />
            </svg>
          </button>
        </div>

        <div class="reader-footer-zone">
          <div class="reader-controls" aria-label="阅读控制">
            <label class="page-number">
              <input id="page-input" type="number" min="1" value="1" aria-label="当前页" />
              <span>/</span>
              <span id="page-total">0</span>
            </label>
            <label class="zoom-slider">
              <button id="zoom-out" type="button" aria-label="缩小页面" title="缩小">−</button>
              <input id="zoom-slider" type="range" min="0.6" max="2.4" step="0.1" value="1" aria-label="页面缩放" />
              <button id="zoom-in" type="button" aria-label="放大页面" title="放大">＋</button>
              <output id="zoom-level">100%</output>
            </label>
          </div>
        </div>

        <aside class="left-drawer drawer" id="left-drawer" aria-label="主菜单" aria-hidden="true">
          <nav class="drawer-menu">
            <button class="drawer-command" id="open-book" type="button"><span aria-hidden="true">＋</span>打开</button>
            <button class="drawer-command" id="open-chapters" type="button"><span aria-hidden="true">☷</span>目录</button>
            <button class="drawer-command" id="open-library" type="button"><span aria-hidden="true">▤</span>书库</button>
            <button class="drawer-command" id="open-knowledge" type="button"><span aria-hidden="true">◇</span>知识库</button>
            <button class="drawer-command" id="open-settings" type="button"><span aria-hidden="true">⚙</span>设置</button>
            <button class="drawer-command" id="exit-app" type="button"><span aria-hidden="true">↪</span>退出</button>
          </nav>
          <button class="drawer-command theme-command" id="theme-toggle" type="button"></button>
        </aside>
        <button class="drawer-trigger left-drawer-trigger" id="left-drawer-toggle" type="button" aria-controls="left-drawer" aria-expanded="false" aria-label="打开主菜单"></button>

        <aside class="annotation-drawer drawer" id="annotation-drawer" aria-label="批注侧栏" aria-hidden="true">
          <div class="annotation-resizer" id="annotation-resizer" role="separator" tabindex="0" aria-label="调整批注栏宽度" aria-orientation="vertical" aria-valuemin="240" aria-valuenow="300"></div>
          <header class="companion-header">
            <div class="mode-switch" role="tablist" aria-label="伴读模式">
              <button id="thought-mode" type="button" role="tab" aria-selected="true">思考</button>
              <button id="record-mode" type="button" role="tab" aria-selected="false">记录</button>
              <button id="margin-note-mode" type="button" role="tab" aria-selected="false">批注</button>
            </div>
            <div class="companion-header-actions">
              <button class="icon-command" id="pin-margin-notes" type="button" aria-label="固定批注侧栏" title="固定批注侧栏" aria-pressed="false" hidden>⌖</button>
              <button class="clear-conversation" id="clear-conversation" type="button" title="开始新对话，保留历史记录">新对话</button>
              <button class="icon-command capture-page" id="capture-page" type="button" aria-label="截取当前页" title="截取当前页">▣</button>
            </div>
          </header>
          <div class="companion-body">
            <div class="selection-context" id="selection-context" hidden>
              <blockquote class="selection-quote" id="selection-quote"></blockquote>
              <button class="selection-clear" id="selection-clear" type="button" aria-label="清除所选内容" title="清除所选内容">×</button>
            </div>
            <section class="thought-panel" id="thought-panel">
              <div class="thread-toolbar"><span id="thread-title">新对话</span><button class="clear-conversation" id="thread-history" type="button" aria-expanded="false" aria-controls="thread-list">历史</button></div>
              <div class="thread-list" id="thread-list" aria-label="本书历史对话" hidden></div>
              <div class="conversation" id="conversation"></div>
              <form class="question-form" id="question-form">
                <button class="save-answer" id="save-answer" type="button" aria-label="录入知识库" title="录入知识库" hidden>
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M20.7 3.3c-4.8-.5-8.8 1-11.8 4.1-2.5 2.6-3.8 5.8-4.4 9.2l2.9-2.8 2.8 2.8-2.8 2.9c3.4-.6 6.6-1.9 9.2-4.4 3.1-3 4.6-7 4.1-11.8Z" />
                    <path d="m4 20 8.4-8.4" />
                  </svg>
                </button>
                <textarea id="question-input" rows="3" placeholder="写下你的问题或想法" aria-label="问题或想法"></textarea>
                <div class="question-resizer" id="question-resizer" role="separator" tabindex="0" aria-label="调整输入框高度" aria-orientation="vertical"></div>
              </form>
            </section>
            <section class="record-panel" id="record-panel" hidden>
              <input id="note-title" type="text" placeholder="标题" aria-label="记录标题" />
              <div class="note-editor">
                <div id="note-body" class="markdown-body"></div>
                <div class="note-command-menu" id="note-command-menu" role="listbox" aria-label="内容类型" hidden></div>
              </div>
              <div class="record-actions">
                <button class="secondary-command current-book-records" id="current-book-records" type="button" disabled>当前书籍记录</button>
                <button class="secondary-command" id="summarize-notes" type="button">总结本书思考</button>
                <button class="primary-command" id="save-note" type="button">保存记录</button>
              </div>
            </section>
            <output class="companion-status" id="companion-status" aria-live="polite"></output>
            <section id="margin-notes-panel" hidden>
              <div class="margin-notes-toolbar"><select id="margin-notes-scope" aria-label="批注范围"><option value="page">当前页</option><option value="book">本书</option></select><span id="margin-notes-count"></span></div>
              <div id="margin-notes-list"></div>
              <section id="margin-note-editor" hidden>
                <button class="text-command" id="margin-note-source" type="button" title="回到原文"></button>
                <blockquote id="margin-note-quote"></blockquote>
                <div class="note-editor"><div id="margin-note-body" class="markdown-body"></div><div class="note-command-menu" id="margin-note-commands" hidden></div></div>
                <div class="margin-note-actions"><button id="margin-note-delete" class="secondary-command" type="button">删除</button><button id="margin-note-back" class="secondary-command" type="button">返回列表</button><button id="margin-note-save" class="primary-command" type="button">保存批注</button></div>
              </section>
              <output id="margin-note-status" aria-live="polite"></output>
            </section>
          </div>
          <div class="related-knowledge" id="related-knowledge" hidden></div>
        </aside>
        <button class="drawer-trigger annotation-trigger" id="annotation-toggle" type="button" aria-controls="annotation-drawer" aria-expanded="false" aria-label="展开批注"></button>

        <aside class="settings-panel drawer" id="settings-panel" aria-labelledby="settings-title" aria-hidden="true" inert>
          <div class="settings-inner">
            <header class="settings-header">
              <h1 id="settings-title">设置</h1>
              <button class="icon-command" id="settings-close" type="button" aria-label="关闭设置" title="关闭">×</button>
            </header>
            <nav class="settings-tabs" role="tablist" aria-label="设置分类">
              <button type="button" role="tab" aria-selected="true" data-settings-tab="appearance">外观</button>
              <button type="button" role="tab" aria-selected="false" data-settings-tab="ai">AI</button>
              <button type="button" role="tab" aria-selected="false" data-settings-tab="shortcuts">快捷键</button>
              <button type="button" role="tab" aria-selected="false" data-settings-tab="data">数据</button>
            </nav>
            <section class="settings-page" data-settings-page="shortcuts" hidden>
              <div class="settings-section-heading">
                <h2>快捷键</h2>
                <button class="text-command" id="reset-shortcuts" type="button">恢复默认</button>
              </div>
              <div class="shortcut-settings" id="shortcut-settings"></div>
              <output class="shortcut-status" id="shortcut-status" aria-live="polite"></output>
            </section>
            <section class="settings-page" data-settings-page="appearance">
              <h2>外观</h2>
              <div class="appearance-settings">
                <label><span>浅色主题色</span><input id="light-accent" type="color" aria-label="浅色主题色" /></label>
                <label><span>深色主题色</span><input id="dark-accent" type="color" aria-label="深色主题色" /></label>
                <label><span>UI 字体</span><select id="ui-font-family"><option value="system">系统默认</option></select></label>
                <label><span>UI 字号</span><span class="font-size-control"><input id="ui-font-size" type="range" min="12" max="18" step="1" /><output id="ui-font-size-value"></output></span></label>
              </div>
              <h2>阅读配色</h2>
              <div class="appearance-settings">
                <label><span>页面配色</span><select id="reading-color-mode"><option value="original">原色</option><option value="comfort">护眼</option><option value="night">夜间</option><option value="custom">自定义</option></select></label>
                <label><span>自定义背景</span><input id="reading-color-background" type="color" aria-label="自定义阅读背景色" /></label>
                <label><span>PDF 页面调色</span><input id="reading-color-pdf" type="checkbox" title="同时调整 PDF 的文字与插图颜色；关闭后恢复原色" /></label>
                <label><span>PDF 调色强度</span><span class="font-size-control"><input id="reading-color-strength" type="range" min="0" max="100" step="5" /><output id="reading-color-value"></output></span></label>
              </div>
            </section>
            <section class="settings-page" data-settings-page="ai" hidden>
            <form class="ai-settings" id="ai-settings-form">
              <h2>AI 服务</h2>
              <label>
                <span>协议</span>
                <select id="ai-protocol">
                  <option value="open_ai_chat_completions">OpenAI Chat Completions</option>
                  <option value="open_ai_responses">OpenAI Responses</option>
                  <option value="anthropic_messages">Anthropic Messages</option>
                  <option value="gemini_generate_content">Gemini GenerateContent</option>
                </select>
              </label>
              <label>
                <span>服务地址</span>
                <input id="ai-base-url" type="url" required spellcheck="false" />
              </label>
              <label>
                <span>模型</span>
                <input id="ai-model" type="text" required spellcheck="false" />
              </label>
              <label>
                <span>最大输出 Token</span>
                <input id="ai-max-output-tokens" type="number" min="1" max="131072" step="1" required />
              </label>
              <label>
                <span>API Key</span>
                <input id="ai-api-key" type="password" autocomplete="off" spellcheck="false" />
              </label>
              <output class="settings-status" id="ai-settings-status" aria-live="polite"></output>
              <div class="settings-actions">
                <button class="secondary-command" id="ai-test" type="button">测试连接</button>
                <button class="primary-command" type="submit">保存</button>
              </div>
            </form>
            <form class="ai-settings dsh-settings" id="ai-prompts-form" aria-labelledby="ai-prompts-title">
              <h2 id="ai-prompts-title">内置提示词</h2>
              <div class="system-prompt-setting">
                <div class="prompt-heading">
                  <label for="ai-system-prompt">伴读提示词</label>
                  <button class="secondary-command" id="reset-system-prompt" type="button" aria-label="恢复默认伴读提示词">恢复默认</button>
                </div>
                <textarea id="ai-system-prompt" rows="5" aria-label="伴读系统提示词"></textarea>
              </div>
              <div class="system-prompt-setting">
                <div class="prompt-heading">
                  <label for="ai-translate-prompt">翻译提示词</label>
                  <button class="secondary-command" id="reset-translate-prompt" type="button" aria-label="恢复默认翻译提示词">恢复默认</button>
                </div>
                <textarea id="ai-translate-prompt" rows="5"></textarea>
              </div>
              <label>
                <span>翻译语言</span>
                <select id="translation-language">
                  <option value="简体中文">简体中文</option>
                  <option value="繁体中文">繁体中文</option>
                  <option value="English">English</option>
                  <option value="日本語">日本語</option>
                  <option value="한국어">한국어</option>
                </select>
              </label>
              <div class="system-prompt-setting">
                <div class="prompt-heading">
                  <label for="ai-explain-prompt">解释提示词</label>
                  <button class="secondary-command" id="reset-explain-prompt" type="button" aria-label="恢复默认解释提示词">恢复默认</button>
                </div>
                <textarea id="ai-explain-prompt" rows="5"></textarea>
              </div>
              <div class="system-prompt-setting">
                <div class="prompt-heading">
                  <label for="ai-summary-prompt">总结提示词</label>
                  <button class="secondary-command" id="reset-summary-prompt" type="button" aria-label="恢复默认总结提示词">恢复默认</button>
                </div>
                <textarea id="ai-summary-prompt" rows="5"></textarea>
              </div>
              <output class="settings-status" id="ai-prompts-status" aria-live="polite"></output>
              <div class="settings-actions">
                <button class="primary-command" type="submit">保存提示词</button>
              </div>
            </form>
            <section class="dsh-settings">
              <h2>DSH 运行时</h2>
              <label>
                <span>npm 源</span>
                <input id="dsh-registry" type="url" required spellcheck="false" />
              </label>
              <div class="dsh-runtime-row">
                <output id="dsh-status" aria-live="polite">正在检测…</output>
                <button class="secondary-command" id="dsh-update" type="button">检查更新</button>
              </div>
              <progress class="dsh-progress" id="dsh-progress" aria-label="DSH 任务进度" hidden></progress>
              <output id="reader-plugin-status" aria-live="polite"></output>
              <div class="settings-actions">
                <button class="secondary-command" id="reader-plugin-import" type="button" title="选择可信的兼容阅读器插件目录，不支持任意 DSH 插件">更新阅读器插件</button>
                <button class="secondary-command" id="reader-plugin-restore" type="button">恢复内置插件</button>
              </div>
            </section>
            </section>
            <section class="settings-page" data-settings-page="data" hidden>
            <section class="vault-settings">
              <h2>个人知识库</h2>
              <label>
                <span>存储位置</span>
                <input id="vault-path" type="text" readonly />
              </label>
              <div class="settings-actions">
                <button class="secondary-command" id="choose-vault" type="button">选择目录</button>
              </div>
            </section>
            </section>
          </div>
        </aside>

        <section class="collection-panel" id="library-panel" aria-labelledby="library-title" hidden>
          <header class="collection-header">
            <h1 id="library-title">书库</h1>
            <div>
              <button class="primary-command" id="library-import" type="button">导入书籍</button>
              <button class="icon-command" id="library-close" type="button" aria-label="关闭书库" title="关闭">×</button>
            </div>
          </header>
          <div class="library-list" id="library-list"></div>
        </section>

        <section class="collection-panel knowledge-panel" id="knowledge-panel" aria-labelledby="knowledge-title" hidden>
          <header class="collection-header">
            <h1 id="knowledge-title">知识库</h1>
            <label class="knowledge-search"><span aria-hidden="true">⌕</span><input id="knowledge-search" type="search" placeholder="搜索知识" aria-label="搜索知识" /></label>
            <div class="knowledge-header-actions">
              <button class="icon-command" id="knowledge-close" type="button" aria-label="关闭知识库" title="关闭">×</button>
            </div>
          </header>
          <div class="knowledge-workspace">
            <aside class="knowledge-left-drawer" id="knowledge-left-drawer" aria-label="知识分类和条目" aria-hidden="true" inert>
              <div class="knowledge-category-column">
                <button class="knowledge-create" id="knowledge-create" type="button"><span aria-hidden="true">＋</span>新建知识</button>
                <nav class="knowledge-categories" id="knowledge-categories" aria-label="知识分类"></nav>
              </div>
              <div class="knowledge-list" id="knowledge-list"></div>
              <div class="knowledge-context-menu" id="knowledge-context-menu" role="menu" hidden>
                <button id="knowledge-context-create" type="button" role="menuitem">新建</button>
                <button id="knowledge-context-delete" type="button" role="menuitem">删除</button>
              </div>
            </aside>
            <button class="knowledge-drawer-trigger knowledge-left-trigger" id="knowledge-left-trigger" type="button" aria-controls="knowledge-left-drawer" aria-expanded="false" aria-label="展开知识分类"></button>
            <svg class="knowledge-graph" id="knowledge-graph" role="img" aria-label="知识关联图"></svg>
            <div class="knowledge-canvas-controls" aria-label="知识画板缩放控制">
              <button id="knowledge-zoom-out" type="button" aria-label="缩小画板" title="缩小">−</button>
              <output id="knowledge-zoom-level">100%</output>
              <button id="knowledge-zoom-in" type="button" aria-label="放大画板" title="放大">＋</button>
              <button id="knowledge-zoom-fit" type="button" aria-label="适应画板内容" title="适应内容">⌂</button>
            </div>
            <aside class="knowledge-detail-drawer" id="knowledge-detail-drawer" aria-label="知识编辑器" aria-hidden="true" inert>
              <div class="knowledge-detail-resizer" id="knowledge-detail-resizer" role="separator" tabindex="0" aria-label="调整知识编辑栏宽度" aria-orientation="vertical" aria-valuemin="280" aria-valuenow="340"></div>
              <article class="knowledge-detail" id="knowledge-detail"></article>
            </aside>
            <button class="knowledge-drawer-trigger knowledge-detail-trigger" id="knowledge-detail-trigger" type="button" aria-controls="knowledge-detail-drawer" aria-expanded="false" aria-label="展开知识编辑器"></button>
          </div>
        </section>
      </main>
    </div>
  `;

  const get = <T extends Element>(selector: string): T => {
    const element = app.querySelector<T>(selector);
    if (!element) throw new Error(`缺少界面元素：${selector}`);
    return element;
  };

  return {
    openBook: get("#open-book"),
    openChapters: get("#open-chapters"),
    openLibrary: get("#open-library"),
    openKnowledge: get("#open-knowledge"),
    openSettings: get("#open-settings"),
    emptyOpen: get("#empty-open"),
    exitApp: get("#exit-app"),
    pageInput: get("#page-input"),
    pageTotal: get("#page-total"),
    zoomOut: get("#zoom-out"),
    zoomSlider: get("#zoom-slider"),
    zoomIn: get("#zoom-in"),
    zoomLevel: get("#zoom-level"),
    chapterToggle: get("#chapter-toggle"),
    chapterDrawer: get("#chapter-drawer"),
    chapterList: get("#chapter-list"),
    chapterClose: get("#chapter-close"),
    themeToggle: get("#theme-toggle"),
    leftDrawer: get("#left-drawer"),
    leftDrawerToggle: get("#left-drawer-toggle"),
    annotationDrawer: get("#annotation-drawer"),
    annotationResizer: get("#annotation-resizer"),
    annotationToggle: get("#annotation-toggle"),
    thoughtMode: get("#thought-mode"),
    recordMode: get("#record-mode"),
    thoughtPanel: get("#thought-panel"),
    recordPanel: get("#record-panel"),
    selectionContext: get("#selection-context"),
    selectionQuote: get("#selection-quote"),
    selectionClear: get("#selection-clear"),
    conversation: get("#conversation"),
    questionInput: get("#question-input"),
    questionResizer: get("#question-resizer"),
    saveAnswer: get("#save-answer"),
    relatedKnowledge: get("#related-knowledge"),
    noteTitle: get("#note-title"),
    noteBody: get("#note-body"),
    noteCommandMenu: get("#note-command-menu"),
    currentBookRecords: get("#current-book-records"),
    saveNote: get("#save-note"),
    summarizeNotes: get("#summarize-notes"),
    capturePage: get("#capture-page"),
    clearConversation: get("#clear-conversation"),
    threadHistory: get("#thread-history"),
    threadTitle: get("#thread-title"),
    threadList: get("#thread-list"),
    companionStatus: get("#companion-status"),
    emptyState: get("#empty-state"),
    pageStage: get("#page-stage"),
    loading: get("#loading"),
    error: get("#error"),
    reader: get("#reader"),
    selectionActions: get("#selection-actions"),
    selectionThink: get("#selection-think"),
    selectionRecord: get("#selection-record"),
    selectionTranslate: get("#selection-translate"),
    selectionExplain: get("#selection-explain"),
    lookupDialog: get("#lookup-dialog"),
    lookupTitle: get("#lookup-title"),
    lookupSource: get("#lookup-source"),
    lookupResultTitle: get("#lookup-result-title"),
    lookupStatus: get("#lookup-status"),
    lookupBody: get("#lookup-body"),
    lookupClose: get("#lookup-close"),
    settingsPanel: get("#settings-panel"),
    vaultPath: get("#vault-path"),
    chooseVault: get("#choose-vault"),
    libraryPanel: get("#library-panel"),
    libraryList: get("#library-list"),
    libraryImport: get("#library-import"),
    libraryClose: get("#library-close"),
    knowledgePanel: get("#knowledge-panel"),
    knowledgeLeftDrawer: get("#knowledge-left-drawer"),
    knowledgeLeftTrigger: get("#knowledge-left-trigger"),
    knowledgeCategories: get("#knowledge-categories"),
    knowledgeList: get("#knowledge-list"),
    knowledgeSearch: get("#knowledge-search"),
    knowledgeGraph: get("#knowledge-graph"),
    knowledgeZoomOut: get("#knowledge-zoom-out"),
    knowledgeZoomFit: get("#knowledge-zoom-fit"),
    knowledgeZoomIn: get("#knowledge-zoom-in"),
    knowledgeZoomLevel: get("#knowledge-zoom-level"),
    knowledgeDetailDrawer: get("#knowledge-detail-drawer"),
    knowledgeDetail: get("#knowledge-detail"),
    knowledgeDetailResizer: get("#knowledge-detail-resizer"),
    knowledgeDetailTrigger: get("#knowledge-detail-trigger"),
    knowledgeCreate: get("#knowledge-create"),
    knowledgeContextMenu: get("#knowledge-context-menu"),
    knowledgeContextCreate: get("#knowledge-context-create"),
    knowledgeContextDelete: get("#knowledge-context-delete"),
    knowledgeClose: get("#knowledge-close"),
  };
}
