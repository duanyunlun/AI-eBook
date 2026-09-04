import * as pdfjs from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import type { PDFDocumentLoadingTask, PDFDocumentProxy, PDFPageProxy, PageViewport, RenderTask, TextLayer } from "pdfjs-dist";
import { bookUrl, saveReadingPage, type BookRecord, type ReadingContext } from "../api";
import { clampPage, parseTextChapters, type TextChapter } from "../reader-state";

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

type ReaderElements = {
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
  emptyState: HTMLElement;
  pageStage: HTMLElement;
  loading: HTMLElement;
  error: HTMLElement;
  reader: HTMLElement;
};

type OutlineNode = {
  title: string;
  dest: string | unknown[] | null;
  items: OutlineNode[];
};

export type PdfReader = {
  open: (book: BookRecord) => Promise<number>;
  openChapters: () => void;
  currentBook: () => BookRecord | undefined;
  currentPageContext: () => Promise<Pick<ReadingContext, "page" | "pageText" | "pageImage">>;
  beginCapture: (onCaptured: (context: ReadingContext) => void) => boolean;
  flush: () => Promise<void>;
  destroy: () => void;
};

export function setupPdfReader(
  elements: ReaderElements,
  onSelection: (text: string, page: number) => void,
  onPageChanged: (page: number) => void,
): PdfReader {
  let documentProxy: PDFDocumentProxy | undefined;
  let loadingTask: PDFDocumentLoadingTask | undefined;
  let book: BookRecord | undefined;
  let currentPage = 1;
  let scale = 1;
  let pageWidth = 0;
  let pageHeight = 0;
  let saveTimer = 0;
  let textChapters: TextChapter[] = [];
  const pageElements = new Map<number, HTMLElement>();
  const renderTasks = new Map<number, RenderTask>();
  const textLayers = new Map<number, TextLayer>();
  const renderedPages = new Set<number>();
  const renderQueue = new Set<number>();
  let renderingQueue = false;
  const visibility = new Map<number, number>();
  let renderObserver: IntersectionObserver | undefined;
  let positionObserver: IntersectionObserver | undefined;
  let captureCallback: ((context: ReadingContext) => void) | undefined;

  const setLoading = (loading: boolean): void => {
    elements.loading.hidden = !loading;
    elements.error.hidden = true;
  };
  const showError = (error: unknown): void => {
    elements.error.textContent = error instanceof Error ? error.message : "无法打开文件";
    elements.error.hidden = false;
    elements.loading.hidden = true;
  };
  const updateControls = (): void => {
    const total = documentProxy?.numPages ?? textChapters.length;
    elements.pageInput.value = String(currentPage);
    elements.pageInput.max = String(Math.max(total, 1));
    elements.pageInput.disabled = total === 0;
    elements.pageTotal.textContent = String(total);
    elements.zoomOut.disabled = !documentProxy || scale <= 0.6;
    elements.zoomSlider.disabled = !documentProxy;
    elements.zoomIn.disabled = !documentProxy || scale >= 2.4;
    elements.zoomSlider.value = String(scale);
    elements.zoomLevel.textContent = `${Math.round(scale * 100)}%`;
  };
  const pageElement = (page: number): HTMLElement | null =>
    pageElements.get(page) ?? null;

  const setChapterDrawerOpen = (open: boolean): void => {
    elements.chapterDrawer.setAttribute("aria-hidden", String(!open));
    elements.chapterToggle.setAttribute("aria-expanded", String(open));
  };

  const renderChapterButtons = (
    chapters: Array<{ title: string; depth: number; open: () => void }>,
  ): void => {
    elements.chapterList.replaceChildren();
    elements.chapterToggle.disabled = chapters.length === 0;
    for (const chapter of chapters) {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = chapter.title;
      button.style.setProperty("--chapter-depth", String(chapter.depth));
      button.addEventListener("click", () => {
        chapter.open();
        setChapterDrawerOpen(false);
      });
      elements.chapterList.append(button);
    }
  };

  const renderOutline = (outline: OutlineNode[]): void => {
    const chapters: Array<{ title: string; depth: number; open: () => void }> = [];
    const visit = (items: OutlineNode[], depth: number): void => {
      for (const item of items) {
        if (item.dest) chapters.push({
          title: item.title,
          depth,
          open: () => void goToDestination(item.dest as string | unknown[]),
        });
        visit(item.items || [], depth + 1);
      }
    };
    visit(outline, 0);
    renderChapterButtons(chapters);
  };

  const goToDestination = async (target: string | unknown[]): Promise<void> => {
    const document = documentProxy;
    if (!document) return;
    const destination = typeof target === "string" ? await document.getDestination(target) : target;
    if (!destination?.length || document !== documentProxy) return;
    const reference = destination[0];
    const pageIndex = typeof reference === "number"
      ? reference
      : await document.getPageIndex(reference as { num: number; gen: number });
    goToPage(pageIndex + 1);
  };

  const renderInternalLinks = async (
    page: PDFPageProxy,
    viewport: PageViewport,
    container: HTMLElement,
  ): Promise<void> => {
    container.replaceChildren();
    const annotations = await page.getAnnotations({ intent: "display" });
    for (const annotation of annotations) {
      if (annotation.subtype !== "Link" || !annotation.dest || !Array.isArray(annotation.rect)) continue;
      const [x1, y1] = viewport.convertToViewportPoint(annotation.rect[0], annotation.rect[1]);
      const [x2, y2] = viewport.convertToViewportPoint(annotation.rect[2], annotation.rect[3]);
      const link = document.createElement("button");
      link.className = "pdf-internal-link";
      link.type = "button";
      link.setAttribute("aria-label", annotation.titleObj?.str || "跳转到 PDF 章节");
      link.style.left = `${Math.min(x1, x2)}px`;
      link.style.top = `${Math.min(y1, y2)}px`;
      link.style.width = `${Math.abs(x2 - x1)}px`;
      link.style.height = `${Math.abs(y2 - y1)}px`;
      link.addEventListener("click", (event) => {
        event.stopPropagation();
        void goToDestination(annotation.dest);
      });
      container.append(link);
    }
  };

  const renderPage = async (pageNumber: number): Promise<void> => {
    if (!documentProxy) return;
    const container = pageElement(pageNumber);
    if (!container) return;
    if (!container.querySelector("canvas")) {
      container.innerHTML = `<canvas></canvas><div class="textLayer"></div><div class="annotationLayer"></div><span class="page-label">${pageNumber}</span>`;
    }
    const canvas = container.querySelector("canvas")!;
    const textContainer = container.querySelector<HTMLElement>(".textLayer")!;
    const annotationContainer = container.querySelector<HTMLElement>(".annotationLayer")!;
    if (canvas.dataset.rendering === "true") {
      await renderTasks.get(pageNumber)?.promise.catch(() => undefined);
      return;
    }
    if (canvas.dataset.scale === String(scale)) return;
    canvas.dataset.rendering = "true";
    try {
      const page = await documentProxy.getPage(pageNumber);
      const viewport = page.getViewport({ scale });
      const outputScale = Math.min(window.devicePixelRatio || 1, 1.5);
      const context = canvas.getContext("2d", { alpha: false });
      if (!context) throw new Error("无法创建 PDF 画布");
      container.dataset.width = String(viewport.width / scale);
      container.dataset.height = String(viewport.height / scale);
      container.style.width = `${Math.floor(viewport.width)}px`;
      container.style.height = `${Math.floor(viewport.height)}px`;
      container.style.setProperty("--total-scale-factor", String(scale));
      canvas.width = Math.floor(viewport.width * outputScale);
      canvas.height = Math.floor(viewport.height * outputScale);
      const renderTask = page.render({
        canvas,
        canvasContext: context,
        viewport,
        transform: outputScale === 1 ? undefined : [outputScale, 0, 0, outputScale, 0, 0],
      });
      renderTasks.set(pageNumber, renderTask);
      textLayers.get(pageNumber)?.cancel();
      textContainer.replaceChildren();
      const textLayer = new pdfjs.TextLayer({
        textContentSource: page.streamTextContent({ includeMarkedContent: true }),
        container: textContainer,
        viewport,
      });
      textLayers.set(pageNumber, textLayer);
      await renderTask.promise;
      canvas.dataset.scale = String(scale);
      renderedPages.add(pageNumber);
      await Promise.all([
        textLayer.render(),
        renderInternalLinks(page, viewport, annotationContainer).catch(() => undefined),
      ]);
    } catch (error) {
      if (error instanceof pdfjs.RenderingCancelledException || error instanceof pdfjs.AbortException) return;
      showError(error);
    } finally {
      delete canvas.dataset.rendering;
      renderTasks.delete(pageNumber);
    }
  };

  const queuePage = (pageNumber: number): void => {
    if (!documentProxy || pageNumber < 1 || pageNumber > documentProxy.numPages) return;
    renderQueue.add(pageNumber);
    if (renderingQueue) return;
    renderingQueue = true;
    void (async () => {
      while (renderQueue.size && documentProxy) {
        const pageNumber = [...renderQueue].reduce((best, page) =>
          Math.abs(page - currentPage) < Math.abs(best - currentPage) ? page : best);
        renderQueue.delete(pageNumber);
        if (Math.abs(pageNumber - currentPage) <= 2) await renderPage(pageNumber);
      }
      renderingQueue = false;
    })();
  };

  const releaseDistantPages = (): void => {
    for (const pageNumber of renderQueue) {
      if (Math.abs(pageNumber - currentPage) > 2) renderQueue.delete(pageNumber);
    }
    for (const [pageNumber, task] of renderTasks) {
      if (Math.abs(pageNumber - currentPage) > 2) {
        task.cancel();
        textLayers.get(pageNumber)?.cancel();
        textLayers.delete(pageNumber);
        pageElement(pageNumber)?.replaceChildren();
      }
    }
    for (const pageNumber of renderedPages) {
      if (Math.abs(pageNumber - currentPage) <= 2) continue;
      const page = pageElement(pageNumber);
      textLayers.get(pageNumber)?.cancel();
      textLayers.delete(pageNumber);
      page?.replaceChildren();
      renderedPages.delete(pageNumber);
    }
  };
  const persistPage = (): void => {
    if (!book) return;
    window.clearTimeout(saveTimer);
    saveTimer = window.setTimeout(() => {
      if (book) void saveReadingPage(book.id, currentPage).catch(showError);
    }, 350);
  };
  const flushPage = async (): Promise<void> => {
    window.clearTimeout(saveTimer);
    if (book) await saveReadingPage(book.id, currentPage);
  };
  const updateCurrentPage = (): void => {
    const visible = [...visibility.entries()].filter(([, ratio]) => ratio > 0);
    if (!visible.length) return;
    const next = visible.reduce((best, item) => (item[1] > best[1] ? item : best))[0];
    if (next === currentPage) return;
    currentPage = next;
    updateControls();
    onPageChanged(currentPage);
    persistPage();
    releaseDistantPages();
    queuePage(currentPage);
    queuePage(currentPage + 1);
    queuePage(currentPage - 1);
  };
  const buildPages = (total: number): void => {
    renderObserver?.disconnect();
    positionObserver?.disconnect();
    elements.pageStage.replaceChildren();
    pageElements.clear();
    visibility.clear();
    renderedPages.clear();
    const fragment = document.createDocumentFragment();
    for (let pageNumber = 1; pageNumber <= total; pageNumber += 1) {
      const page = document.createElement("article");
      page.className = "pdf-page reader-page";
      page.dataset.page = String(pageNumber);
      page.dataset.width = String(pageWidth);
      page.dataset.height = String(pageHeight);
      page.style.width = `${Math.floor(pageWidth * scale)}px`;
      page.style.height = `${Math.floor(pageHeight * scale)}px`;
      page.setAttribute("aria-label", `第 ${pageNumber} 页`);
      pageElements.set(pageNumber, page);
      fragment.append(page);
    }
    elements.pageStage.append(fragment);
    renderObserver = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) queuePage(Number((entry.target as HTMLElement).dataset.page));
        }
      },
      { root: elements.reader, rootMargin: "40% 0px" },
    );
    positionObserver = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          visibility.set(Number((entry.target as HTMLElement).dataset.page), entry.intersectionRatio);
        }
        updateCurrentPage();
      },
      { root: elements.reader, threshold: [0, 0.5, 1] },
    );
    for (const page of elements.pageStage.children) {
      renderObserver.observe(page);
      positionObserver.observe(page);
    }
  };
  function goToPage(page: number, smooth = true): void {
    const total = documentProxy?.numPages ?? textChapters.length;
    if (!total) return;
    currentPage = clampPage(page, total);
    updateControls();
    onPageChanged(currentPage);
    persistPage();
    pageElement(currentPage)?.scrollIntoView({ behavior: smooth ? "smooth" : "instant", block: "start" });
    if (documentProxy) {
      releaseDistantPages();
      queuePage(currentPage);
      queuePage(currentPage + 1);
      queuePage(currentPage - 1);
    }
  }
  const changeScale = (nextScale: number): void => {
    if (!documentProxy) return;
    scale = Math.min(Math.max(Math.round(nextScale * 10) / 10, 0.6), 2.4);
    for (const task of renderTasks.values()) task.cancel();
    for (const layer of textLayers.values()) layer.cancel();
    renderTasks.clear();
    textLayers.clear();
    for (const page of elements.pageStage.children) {
      const element = page as HTMLElement;
      element.style.width = `${Math.floor(Number(element.dataset.width) * scale)}px`;
      element.style.height = `${Math.floor(Number(element.dataset.height) * scale)}px`;
      const canvas = element.querySelector("canvas");
      if (canvas) delete canvas.dataset.scale;
      element.querySelector(".annotationLayer")?.replaceChildren();
    }
    updateControls();
    goToPage(currentPage, false);
    for (const pageNumber of renderedPages) {
      if (Math.abs(pageNumber - currentPage) <= 2) queuePage(pageNumber);
    }
  };
  const destroyDocument = async (): Promise<void> => {
    for (const task of renderTasks.values()) task.cancel();
    for (const layer of textLayers.values()) layer.cancel();
    renderTasks.clear();
    textLayers.clear();
    renderQueue.clear();
    await loadingTask?.destroy();
    documentProxy = undefined;
    loadingTask = undefined;
    textChapters = [];
  };

  const buildTextPages = (chapters: TextChapter[]): void => {
    renderObserver?.disconnect();
    positionObserver?.disconnect();
    elements.pageStage.replaceChildren();
    pageElements.clear();
    visibility.clear();
    const fragment = document.createDocumentFragment();
    chapters.forEach((chapter, index) => {
      const pageNumber = index + 1;
      const page = document.createElement("article");
      page.className = "text-page reader-page";
      page.dataset.page = String(pageNumber);
      const heading = document.createElement("h1");
      heading.textContent = chapter.title;
      const content = document.createElement("div");
      content.className = "text-page-content";
      content.textContent = chapter.body;
      page.append(heading, content);
      pageElements.set(pageNumber, page);
      fragment.append(page);
    });
    elements.pageStage.append(fragment);
    positionObserver = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          visibility.set(Number((entry.target as HTMLElement).dataset.page), entry.intersectionRatio);
        }
        updateCurrentPage();
      },
      { root: elements.reader, threshold: [0, 0.5, 1] },
    );
    for (const page of elements.pageStage.children) positionObserver.observe(page);
    renderChapterButtons(chapters.map((chapter, index) => ({
      title: chapter.title,
      depth: 0,
      open: () => goToPage(index + 1),
    })));
  };

  const open = async (nextBook: BookRecord): Promise<number> => {
    setLoading(true);
    await flushPage().catch(showError);
    await destroyDocument();
    book = nextBook;
    setChapterDrawerOpen(false);
    renderChapterButtons([]);
    try {
      if (nextBook.format !== "pdf") {
        const response = await fetch(bookUrl(nextBook));
        if (!response.ok) throw new Error(`无法读取文本文件（${response.status}）`);
        textChapters = parseTextChapters(await response.text());
        currentPage = clampPage(nextBook.lastPage, textChapters.length);
        scale = 1;
        elements.emptyState.hidden = true;
        elements.pageStage.hidden = false;
        buildTextPages(textChapters);
        setLoading(false);
        updateControls();
        goToPage(currentPage, false);
        return textChapters.length;
      }
      loadingTask = pdfjs.getDocument({ url: bookUrl(nextBook) });
      documentProxy = await loadingTask.promise;
      const viewport = (await documentProxy.getPage(1)).getViewport({ scale: 1 });
      pageWidth = viewport.width;
      pageHeight = viewport.height;
      currentPage = clampPage(nextBook.lastPage, documentProxy.numPages);
      scale = 1;
      elements.emptyState.hidden = true;
      elements.pageStage.hidden = false;
      buildPages(documentProxy.numPages);
      setLoading(false);
      updateControls();
      const openedDocument = documentProxy;
      void openedDocument.getOutline().then((outline) => {
        if (documentProxy === openedDocument) renderOutline((outline || []) as OutlineNode[]);
      });
      goToPage(currentPage, false);
      return documentProxy.numPages;
    } catch (error) {
      documentProxy = undefined;
      elements.pageStage.hidden = true;
      elements.emptyState.hidden = false;
      setLoading(false);
      showError(error);
      throw error;
    }
  };
  const capturedContext = (
    source: HTMLCanvasElement,
    page: number,
    sourceRect: { x: number; y: number; width: number; height: number },
  ): ReadingContext | undefined => {
    if (!book || sourceRect.width < 4 || sourceRect.height < 4) return undefined;
    const ratio = Math.min(1, 1600 / Math.max(sourceRect.width, sourceRect.height));
    const output = document.createElement("canvas");
    output.width = Math.round(sourceRect.width * ratio);
    output.height = Math.round(sourceRect.height * ratio);
    output.getContext("2d")?.drawImage(
      source,
      sourceRect.x,
      sourceRect.y,
      sourceRect.width,
      sourceRect.height,
      0,
      0,
      output.width,
      output.height,
    );
    return {
      bookId: book.id,
      bookTitle: book.title,
      bookFormat: book.format,
      page,
      totalPages: documentProxy?.numPages ?? page,
      image: { mediaType: "image/webp", data: output.toDataURL("image/webp", 0.82).split(",")[1] },
    };
  };

  const currentPageContext = async (): Promise<Pick<ReadingContext, "page" | "pageText" | "pageImage">> => {
    if (!book) return { page: currentPage };
    if (!documentProxy) {
      const text = textChapters[currentPage - 1]?.body || "";
      return {
        page: currentPage,
        pageText: text.length > 20_000 ? `${text.slice(0, 20_000)}\n[当前章节文本过长，已截断]` : text,
      };
    }
    const pageNumber = currentPage;
    const page = await documentProxy.getPage(pageNumber);
    const content = await page.getTextContent();
    const text = content.items
      .map((item) => ("str" in item ? `${item.str}${item.hasEOL ? "\n" : " "}` : ""))
      .join("")
      .replace(/[ \t]+/g, " ")
      .replace(/ *\n */g, "\n")
      .trim();
    const pageText = text.length > 20_000 ? `${text.slice(0, 20_000)}\n[当前页文本过长，已截断]` : text;
    if (pageText.length >= 40) return { page: pageNumber, pageText };
    // ponytail: 少于 40 字按扫描页处理；需要更准时再接 OCR 或版面检测。
    await renderPage(pageNumber);
    const canvas = pageElement(pageNumber)?.querySelector("canvas");
    const pageImage = canvas?.width && canvas.height
      ? capturedContext(canvas, pageNumber, { x: 0, y: 0, width: canvas.width, height: canvas.height })?.image
      : undefined;
    return { page: pageNumber, pageText: pageText || undefined, pageImage };
  };

  elements.pageInput.addEventListener("change", () => goToPage(elements.pageInput.valueAsNumber));
  elements.zoomOut.addEventListener("click", () => changeScale(scale - 0.1));
  elements.zoomSlider.addEventListener("input", () => {
    elements.zoomLevel.textContent = `${Math.round(elements.zoomSlider.valueAsNumber * 100)}%`;
  });
  elements.zoomSlider.addEventListener("change", () => changeScale(elements.zoomSlider.valueAsNumber));
  elements.zoomIn.addEventListener("click", () => changeScale(scale + 0.1));
  elements.reader.addEventListener("pointerup", (event) => {
    if (captureCallback) return;
    const selection = window.getSelection();
    const text = selection?.toString().replace(/\s+/g, " ").trim() || "";
    const anchor = selection?.anchorNode instanceof Element ? selection.anchorNode : selection?.anchorNode?.parentElement;
    const target = event.target instanceof Element ? event.target : null;
    const page = anchor?.closest<HTMLElement>(".reader-page") || target?.closest<HTMLElement>(".reader-page");
    if (page) onSelection(text, Number(page.dataset.page));
  });
  elements.reader.addEventListener("pointerdown", (event) => {
    if (!captureCallback || event.button !== 0) return;
    const page = (event.target as Element).closest<HTMLElement>(".pdf-page");
    const canvas = page?.querySelector("canvas");
    if (!page || !canvas?.width || !canvas.height) return;
    event.preventDefault();
    const bounds = page.getBoundingClientRect();
    const startX = Math.min(Math.max(event.clientX - bounds.left, 0), bounds.width);
    const startY = Math.min(Math.max(event.clientY - bounds.top, 0), bounds.height);
    const marker = document.createElement("div");
    marker.className = "capture-selection";
    marker.style.left = `${startX}px`;
    marker.style.top = `${startY}px`;
    page.append(marker);
    const move = (moveEvent: PointerEvent): void => {
      const x = Math.min(Math.max(moveEvent.clientX - bounds.left, 0), bounds.width);
      const y = Math.min(Math.max(moveEvent.clientY - bounds.top, 0), bounds.height);
      marker.style.left = `${Math.min(startX, x)}px`;
      marker.style.top = `${Math.min(startY, y)}px`;
      marker.style.width = `${Math.abs(x - startX)}px`;
      marker.style.height = `${Math.abs(y - startY)}px`;
    };
    const finish = (upEvent: PointerEvent): void => {
      move(upEvent);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", finish);
      const x = Number.parseFloat(marker.style.left);
      const y = Number.parseFloat(marker.style.top);
      const width = Number.parseFloat(marker.style.width);
      const height = Number.parseFloat(marker.style.height);
      marker.remove();
      elements.reader.classList.remove("is-capturing");
      const callback = captureCallback;
      captureCallback = undefined;
      const scaleX = canvas.width / bounds.width;
      const scaleY = canvas.height / bounds.height;
      const captured = capturedContext(canvas, Number(page.dataset.page), {
        x: x * scaleX,
        y: y * scaleY,
        width: width * scaleX,
        height: height * scaleY,
      });
      if (captured) callback?.(captured);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", finish);
  });

  updateControls();
  elements.chapterToggle.addEventListener("click", () => {
    setChapterDrawerOpen(elements.chapterDrawer.getAttribute("aria-hidden") === "true");
  });
  elements.chapterClose.addEventListener("click", () => setChapterDrawerOpen(false));
  elements.reader.addEventListener("pointerdown", () => setChapterDrawerOpen(false));
  window.addEventListener("keydown", (event) => {
    if (event.key === "Escape") setChapterDrawerOpen(false);
  });
  return {
    open,
    openChapters: () => {
      if (!elements.chapterToggle.disabled) setChapterDrawerOpen(true);
    },
    currentBook: () => book,
    currentPageContext,
    beginCapture: (callback) => {
      if (!book || !documentProxy) return false;
      captureCallback = callback;
      elements.reader.classList.add("is-capturing");
      window.getSelection()?.removeAllRanges();
      return true;
    },
    flush: flushPage,
    destroy: () => {
      window.clearTimeout(saveTimer);
      renderObserver?.disconnect();
      positionObserver?.disconnect();
      void destroyDocument();
    },
  };
}
