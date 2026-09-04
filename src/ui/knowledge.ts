import DOMPurify from "dompurify";
import { marked } from "marked";
import {
  deleteKnowledge,
  getKnowledgeGraph,
  listKnowledgeBooks,
  searchKnowledge,
  saveKnowledge,
  updateKnowledge,
  type KnowledgeEdge,
  type KnowledgeGraph,
  type KnowledgeItem,
} from "../api";
import { setupKnowledgeCanvas } from "./knowledge-canvas";

type KnowledgeElements = {
  openKnowledge: HTMLButtonElement;
  knowledgePanel: HTMLElement;
  knowledgeLeftDrawer: HTMLElement;
  knowledgeCategories: HTMLElement;
  knowledgeList: HTMLElement;
  knowledgeSearch: HTMLInputElement;
  knowledgeGraph: SVGSVGElement;
  knowledgeZoomOut: HTMLButtonElement;
  knowledgeZoomFit: HTMLButtonElement;
  knowledgeZoomIn: HTMLButtonElement;
  knowledgeZoomLevel: HTMLOutputElement;
  knowledgeDetail: HTMLElement;
  knowledgeCreate: HTMLButtonElement;
  knowledgeContextMenu: HTMLElement;
  knowledgeContextCreate: HTMLButtonElement;
  knowledgeContextDelete: HTMLButtonElement;
  knowledgeClose: HTMLButtonElement;
};

type BookReference = { id: string; title: string };
type Filter =
  | { kind: "all" }
  | { kind: "uncategorized" }
  | { kind: "book"; value: string }
  | { kind: "category"; value: string };

export type KnowledgeController = {
  refresh: () => Promise<void>;
  openForBook: (bookId: string) => void;
  openItem: (itemId: string) => void;
};

const labels: Record<KnowledgeItem["kind"], string> = {
  thought: "思考",
  question: "问题",
  answer: "AI 回答",
  concept: "概念",
  conclusion: "结论",
  summary: "总结",
};

const relationLabels: Record<string, string> = {
  quotes: "引用",
  asks_about: "询问",
  derived_from: "源自",
  summarizes: "总结",
  supports: "支持",
  contradicts: "矛盾",
  related_to: "相关",
  mentioned_in: "提及",
};

export function setupKnowledge(
  elements: KnowledgeElements,
  closeDrawers: () => void,
  openDetail: () => void,
  closeKnowledgeDrawers: () => void,
): KnowledgeController {
  let graph: KnowledgeGraph = { items: [], edges: [] };
  let books: BookReference[] = [];
  let searchResults: KnowledgeItem[] | undefined;
  let filter: Filter = { kind: "all" };
  let selectedId: string | undefined;
  let contextItemId: string | undefined;

  const showError = (error: unknown): void => {
    elements.knowledgeDetail.textContent = String(error);
    elements.knowledgeDetail.dataset.state = "error";
    openDetail();
  };

  const matchesFilter = (item: KnowledgeItem): boolean => {
    if (filter.kind === "all") return true;
    if (filter.kind === "uncategorized") return !item.bookId && !item.category;
    if (filter.kind === "book") return item.bookId === filter.value;
    return item.category === filter.value;
  };

  const visibleItems = (): KnowledgeItem[] =>
    (searchResults ?? graph.items).filter(matchesFilter);

  const hideContextMenu = (): void => {
    elements.knowledgeContextMenu.hidden = true;
    elements.knowledgeContextDelete.dataset.armed = "false";
    elements.knowledgeContextDelete.textContent = "删除";
  };

  const removeItem = async (item: KnowledgeItem, status?: HTMLOutputElement): Promise<void> => {
    if (status) status.textContent = "正在删除…";
    await deleteKnowledge(item.id);
    selectedId = undefined;
    await refresh();
  };

  const setupDelete = (
    button: HTMLButtonElement,
    item: KnowledgeItem,
    status: HTMLOutputElement,
  ): void => {
    let armed = false;
    button.addEventListener("click", async () => {
      if (!armed) {
        armed = true;
        button.textContent = "确认删除";
        status.textContent = "再次点击将删除，可从知识库 Git 历史恢复";
        return;
      }
      button.disabled = true;
      try {
        await removeItem(item, status);
      } catch (error) {
        status.textContent = String(error);
        button.disabled = false;
      }
    });
  };

  const showViewer = (item: KnowledgeItem, reveal = false): void => {
    delete elements.knowledgeDetail.dataset.state;
    selectedId = item.id;
    elements.knowledgeDetail.innerHTML = `
      <div class="knowledge-viewer">
        <small></small>
        <h2></h2>
        <div class="markdown-body"></div>
        <output aria-live="polite"></output>
        <div class="knowledge-editor-actions">
          <button class="danger-command" type="button">删除</button>
          <button class="primary-command" type="button">编辑</button>
        </div>
      </div>`;
    const viewer = elements.knowledgeDetail.querySelector<HTMLElement>(".knowledge-viewer")!;
    const book = books.find((candidate) => candidate.id === item.bookId)?.title;
    const context = [labels[item.kind], item.creator === "user" ? "我的内容" : "AI 内容", book, item.category]
      .filter(Boolean)
      .join(" · ");
    viewer.querySelector("small")!.textContent = context;
    viewer.querySelector("h2")!.textContent = item.title || "未命名知识";
    const content = viewer.querySelector<HTMLElement>(".markdown-body")!;
    content.innerHTML = DOMPurify.sanitize(marked.parse(item.bodyMd, { async: false }));
    for (const link of content.querySelectorAll<HTMLAnchorElement>("a")) {
      link.target = "_blank";
      link.rel = "noreferrer";
    }
    const [remove, edit] = viewer.querySelectorAll<HTMLButtonElement>("button");
    const status = viewer.querySelector<HTMLOutputElement>("output")!;
    setupDelete(remove, item, status);
    edit.addEventListener("click", () => showEditor(item, true));
    for (const button of elements.knowledgeList.querySelectorAll("button")) {
      button.dataset.active = String(button.dataset.id === item.id);
    }
    if (reveal) openDetail();
  };

  const showEditor = (item?: KnowledgeItem, reveal = false): void => {
    delete elements.knowledgeDetail.dataset.state;
    selectedId = item?.id;
    elements.knowledgeDetail.innerHTML = `
      <form class="knowledge-editor">
        <small>${item ? `${labels[item.kind]} · ${item.creator === "user" ? "我的内容" : "AI 内容"}` : "独立知识"}</small>
        <label><span>类型</span><select name="kind"></select></label>
        <label><span>所属书籍</span><select name="book"><option value="">不关联书籍</option></select></label>
        <label><span>自定义分类</span><input name="category" type="text" placeholder="例如：方法论" /></label>
        <label><span>标题</span><input name="title" type="text" placeholder="知识标题" /></label>
        <label class="knowledge-body"><span>正文</span><textarea name="body" placeholder="写下知识内容" required></textarea></label>
        <output aria-live="polite"></output>
        <div class="knowledge-editor-actions">
          <button class="danger-command" name="delete" type="button">删除</button>
          <button class="primary-command" type="submit">保存</button>
        </div>
      </form>`;
    const form = elements.knowledgeDetail.querySelector<HTMLFormElement>("form")!;
    const kind = form.elements.namedItem("kind") as HTMLSelectElement;
    const book = form.elements.namedItem("book") as HTMLSelectElement;
    const category = form.elements.namedItem("category") as HTMLInputElement;
    const title = form.elements.namedItem("title") as HTMLInputElement;
    const body = form.elements.namedItem("body") as HTMLTextAreaElement;
    const remove = form.elements.namedItem("delete") as HTMLButtonElement;
    const status = form.querySelector<HTMLOutputElement>("output")!;

    for (const [value, label] of Object.entries(labels)) kind.add(new Option(label, value));
    for (const reference of books) book.add(new Option(reference.title, reference.id));
    kind.value = item?.kind ?? "thought";
    book.value = item?.bookId ?? "";
    category.value = item?.category ?? "";
    title.value = item?.title ?? "";
    body.value = item?.bodyMd ?? "";
    remove.hidden = !item;

    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const submit = form.querySelector<HTMLButtonElement>('button[type="submit"]')!;
      submit.disabled = true;
      status.textContent = "正在保存…";
      try {
        const common = {
          kind: kind.value as KnowledgeItem["kind"],
          bookId: book.value || undefined,
          category: category.value.trim() || undefined,
          title: title.value.trim() || undefined,
          bodyMd: body.value,
        };
        const saved = item
          ? await updateKnowledge({ id: item.id, ...common })
          : await saveKnowledge({
              item: {
                ...common,
                creator: "user",
                basis: "user_thought",
                reviewState: "confirmed",
              },
            });
        selectedId = saved.id;
        await refresh();
      } catch (error) {
        status.textContent = String(error);
        submit.disabled = false;
      }
    });
    if (item) setupDelete(remove, item, status);
    for (const button of elements.knowledgeList.querySelectorAll("button")) {
      button.dataset.active = String(button.dataset.id === item?.id);
    }
    if (reveal) openDetail();
    if (!item && reveal) title.focus();
  };

  const showRelation = (edge: KnowledgeEdge): void => {
    const from = graph.items.find((item) => item.id === edge.fromItemId);
    const to = graph.items.find((item) => item.id === edge.toItemId);
    if (!from || !to) return;
    selectedId = undefined;
    elements.knowledgeDetail.innerHTML = `
      <div class="knowledge-relation-viewer">
        <small>知识关系</small>
        <h2></h2>
        <button type="button"><span>起点</span><strong></strong><p></p></button>
        <button type="button"><span>终点</span><strong></strong><p></p></button>
      </div>`;
    elements.knowledgeDetail.querySelector("h2")!.textContent = relationLabels[edge.relation] || edge.relation;
    const endpoints = elements.knowledgeDetail.querySelectorAll<HTMLButtonElement>(".knowledge-relation-viewer button");
    [from, to].forEach((item, index) => {
      endpoints[index].querySelector("strong")!.textContent = item.title || "未命名知识";
      endpoints[index].querySelector("p")!.textContent = item.bodyMd.slice(0, 240);
      endpoints[index].addEventListener("click", () => showViewer(item, true));
    });
    for (const button of elements.knowledgeList.querySelectorAll("button")) {
      button.dataset.active = "false";
    }
    openDetail();
  };

  const canvas = setupKnowledgeCanvas(
    elements,
    (item) => showViewer(item, true),
    showRelation,
  );

  const renderList = (items: KnowledgeItem[]): void => {
    elements.knowledgeList.replaceChildren();
    if (!items.length) {
      const empty = document.createElement("p");
      empty.className = "collection-empty";
      empty.textContent = "此分类暂无知识";
      elements.knowledgeList.append(empty);
      if (selectedId) elements.knowledgeDetail.replaceChildren();
      return;
    }
    for (const item of items) {
      const button = document.createElement("button");
      button.type = "button";
      button.dataset.id = item.id;
      const kind = document.createElement("span");
      kind.textContent = item.category ? `${labels[item.kind]} · ${item.category}` : labels[item.kind];
      const title = document.createElement("strong");
      title.textContent = item.title || item.bodyMd.slice(0, 36);
      button.append(kind, title);
      button.addEventListener("click", () => showViewer(item, true));
      elements.knowledgeList.append(button);
    }
    showViewer(items.find((item) => item.id === selectedId) ?? items[0]);
  };

  const filterKey = (value: Filter): string =>
    value.kind === "all" || value.kind === "uncategorized" ? value.kind : `${value.kind}:${value.value}`;

  const renderCategories = (): void => {
    elements.knowledgeCategories.replaceChildren();
    const addFilter = (label: string, next: Filter, count: number): void => {
      const button = document.createElement("button");
      button.type = "button";
      button.dataset.active = String(filterKey(filter) === filterKey(next));
      button.append(document.createTextNode(label));
      const badge = document.createElement("span");
      badge.textContent = String(count);
      button.append(badge);
      button.addEventListener("click", () => {
        filter = next;
        renderCategories();
        const items = visibleItems();
        renderList(items);
        canvas.render(items, graph.edges, books);
      });
      elements.knowledgeCategories.append(button);
    };
    const heading = (text: string): void => {
      const title = document.createElement("h2");
      title.textContent = text;
      elements.knowledgeCategories.append(title);
    };
    addFilter("全部知识", { kind: "all" }, graph.items.length);
    addFilter(
      "未分类",
      { kind: "uncategorized" },
      graph.items.filter((item) => !item.bookId && !item.category).length,
    );
    heading("书籍");
    for (const book of books) {
      const count = graph.items.filter((item) => item.bookId === book.id).length;
      if (count) addFilter(book.title, { kind: "book", value: book.id }, count);
    }
    const categories = [...new Set(graph.items.map((item) => item.category).filter(Boolean) as string[])].sort();
    if (categories.length) heading("自定义分类");
    for (const category of categories) {
      addFilter(
        category,
        { kind: "category", value: category },
        graph.items.filter((item) => item.category === category).length,
      );
    }
  };

  const refresh = async (): Promise<void> => {
    [graph, books] = await Promise.all([getKnowledgeGraph(), listKnowledgeBooks()]);
    searchResults = elements.knowledgeSearch.value.trim()
      ? await searchKnowledge(elements.knowledgeSearch.value.trim())
      : undefined;
    renderCategories();
    const items = visibleItems();
    renderList(items);
    canvas.render(items, graph.edges, books);
  };

  let searchTimer = 0;
  elements.knowledgeSearch.addEventListener("input", () => {
    window.clearTimeout(searchTimer);
    searchTimer = window.setTimeout(() => void refresh().catch(showError), 180);
  });
  elements.knowledgeCreate.addEventListener("click", () => showEditor(undefined, true));
  elements.knowledgeLeftDrawer.addEventListener("contextmenu", (event) => {
    event.preventDefault();
    const itemButton = event.target instanceof Element
      ? event.target.closest<HTMLButtonElement>(".knowledge-list button")
      : null;
    contextItemId = itemButton?.dataset.id;
    elements.knowledgeContextDelete.disabled = !contextItemId;
    elements.knowledgeContextDelete.dataset.armed = "false";
    elements.knowledgeContextDelete.textContent = "删除";
    elements.knowledgeContextMenu.hidden = false;
    const bounds = elements.knowledgeLeftDrawer.getBoundingClientRect();
    elements.knowledgeContextMenu.style.left = `${Math.max(4, Math.min(event.clientX - bounds.left, bounds.width - 130))}px`;
    elements.knowledgeContextMenu.style.top = `${Math.max(4, Math.min(event.clientY - bounds.top, bounds.height - 78))}px`;
  });
  elements.knowledgeContextCreate.addEventListener("click", () => {
    hideContextMenu();
    showEditor(undefined, true);
  });
  elements.knowledgeContextDelete.addEventListener("click", () => {
    const item = graph.items.find((candidate) => candidate.id === contextItemId);
    if (!item) return;
    if (elements.knowledgeContextDelete.dataset.armed !== "true") {
      elements.knowledgeContextDelete.dataset.armed = "true";
      elements.knowledgeContextDelete.textContent = "确认删除";
      return;
    }
    hideContextMenu();
    void removeItem(item).catch(showError);
  });
  document.addEventListener("pointerdown", (event) => {
    if (!elements.knowledgeContextMenu.contains(event.target as Node)) hideContextMenu();
  });
  elements.openKnowledge.addEventListener("click", () => {
    closeDrawers();
    closeKnowledgeDrawers();
    elements.knowledgePanel.hidden = false;
    elements.knowledgeSearch.focus();
    void refresh().catch(showError);
  });
  elements.knowledgeClose.addEventListener("click", () => {
    hideContextMenu();
    closeKnowledgeDrawers();
    elements.knowledgePanel.hidden = true;
  });

  return {
    refresh,
    openForBook(bookId) {
      filter = { kind: "book", value: bookId };
      selectedId = undefined;
      elements.knowledgeSearch.value = "";
      searchResults = undefined;
      closeDrawers();
      closeKnowledgeDrawers();
      elements.knowledgePanel.hidden = false;
      void refresh().catch(showError);
    },
    openItem(itemId) {
      filter = { kind: "all" };
      selectedId = itemId;
      elements.knowledgeSearch.value = "";
      searchResults = undefined;
      closeDrawers();
      closeKnowledgeDrawers();
      elements.knowledgePanel.hidden = false;
      void refresh().then(openDetail).catch(showError);
    },
  };
}
