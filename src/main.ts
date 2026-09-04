import { getCurrentWindow } from "@tauri-apps/api/window";
import type { BookRecord } from "./api";
import { setupPdfReader } from "./reader/pdf-reader";
import { setupAnnotationResize, setupKnowledgeResize, setupQuestionResize } from "./ui/annotation-resize";
import { setupAiSettings } from "./ui/ai-settings";
import { setupCompanion, type CompanionController } from "./ui/companion";
import { setupDrawers } from "./ui/drawers";
import { setupKnowledge } from "./ui/knowledge";
import { setupKnowledgeDrawers } from "./ui/knowledge-drawers";
import { setupLibrary } from "./ui/library";
import { setupNoteEditor } from "./ui/note-editor";
import { mountShell } from "./ui/shell";
import { setupPreferences } from "./ui/preferences";
import { setupTheme } from "./ui/theme";
import "./styles.css";

const app = document.querySelector<HTMLDivElement>("#app");
if (!app) throw new Error("缺少应用挂载节点");

const elements = mountShell(app);
setupNoteEditor(elements.noteBody, elements.noteCommandMenu);
const showError = (error: unknown): void => {
  elements.error.textContent = error instanceof Error ? error.message : String(error);
  elements.error.hidden = false;
};
const drawers = setupDrawers(elements);
setupAnnotationResize(elements.annotationResizer);
setupKnowledgeResize(elements.knowledgeDetailResizer);
setupQuestionResize(elements.questionResizer, elements.questionInput);
setupAiSettings(
  elements.openSettings,
  elements.settingsPanel,
  drawers.openSettings,
  drawers.closeSettings,
  elements.vaultPath,
  elements.chooseVault,
);
const theme = setupTheme(elements.themeToggle);

let companion: CompanionController | undefined;
const reader = setupPdfReader(
  elements,
  (text, page) => companion?.selectText(text, page),
  (page) => companion?.setPage(page),
);
const knowledgeDrawers = setupKnowledgeDrawers(elements);
const knowledge = setupKnowledge(
  elements,
  drawers.closeAll,
  knowledgeDrawers.openDetail,
  knowledgeDrawers.closeAll,
);
const openCompanion = (): void => {
  elements.libraryPanel.hidden = true;
  elements.knowledgePanel.hidden = true;
  knowledgeDrawers.closeAll();
  drawers.openAnnotation();
};
companion = setupCompanion(
  elements,
  openCompanion,
  reader.beginCapture,
  reader.currentPageContext,
  () => void knowledge.refresh(),
  knowledge.openForBook,
  knowledge.openItem,
);

const openBook = async (book: BookRecord): Promise<void> => {
  const totalPages = await reader.open(book);
  companion?.setBook({
    bookId: book.id,
    bookTitle: book.title,
    bookFormat: book.format,
    page: book.lastPage,
    totalPages,
  });
};
const library = setupLibrary(
  elements,
  drawers.closeAll,
  openBook,
  () => reader.currentBook()?.id,
  showError,
);

setupPreferences(elements.settingsPanel, elements.openSettings, elements.questionInput, theme, {
  toggleLeft: drawers.toggleLeft,
  toggleRight: drawers.toggleAnnotation,
  openChapters: () => {
    drawers.closeAll();
    reader.openChapters();
  },
  openLibrary: () => elements.openLibrary.click(),
  openKnowledge: () => elements.openKnowledge.click(),
  openBook: () => elements.openBook.click(),
  openSettings: () => elements.openSettings.click(),
  think: () => companion?.openThought(),
  record: () => companion?.openRecord(),
  translate: () => companion?.translate(),
  explain: () => companion?.explain(),
  capture: () => companion?.capture(),
  sendQueue: () => companion?.submit("queue"),
  interrupt: () => companion?.submit("interrupt"),
});

elements.openBook.addEventListener("click", () => void library.importAndOpen().catch(showError));
elements.openChapters.addEventListener("click", () => {
  drawers.closeAll();
  reader.openChapters();
});
elements.emptyOpen.addEventListener("click", () => void library.importAndOpen().catch(showError));
elements.exitApp.addEventListener("click", () => void getCurrentWindow().close().catch(showError));
window.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    elements.libraryPanel.hidden = true;
    elements.knowledgePanel.hidden = true;
  }
});
let closing = false;
let allowClose = false;
void getCurrentWindow().onCloseRequested(async (event) => {
  if (allowClose) {
    reader.destroy();
    return;
  }
  event.preventDefault();
  if (closing) return;
  closing = true;
  elements.loading.textContent = "正在保存阅读进度…";
  elements.loading.hidden = false;
  try {
    await reader.flush();
    allowClose = true;
    window.setTimeout(() => {
      void getCurrentWindow().close().catch(showError);
    }, 0);
  } catch (error) {
    closing = false;
    elements.loading.hidden = true;
    showError(new Error(`关闭前保存失败：${error instanceof Error ? error.message : String(error)}`));
  }
});

void library.initialize().catch(showError);
