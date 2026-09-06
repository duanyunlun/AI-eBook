import { invoke } from "@tauri-apps/api/core";
import { saveKnowledge, updateKnowledge, deleteKnowledge, type BookRecord, type KnowledgeItem } from "../api";
import { selectionAnchor, annotationRects, type AnnotationAnchor } from "../reader/annotation-anchor";
import { setupNoteEditor } from "./note-editor";

export type BookAnnotation = { item: KnowledgeItem; quote: string; locator: AnnotationAnchor };
export function setupMarginNotes(stage: HTMLElement, drawer: HTMLElement, openDrawer: () => void, toggleDrawer: () => void, onSaved: () => void) {
  const get = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
  const panel = get("margin-notes-panel"), list = get("margin-notes-list"), editorPanel = get("margin-note-editor");
  const host = get("margin-note-body"), quote = get("margin-note-quote"), status = get("margin-note-status");
  const source = get<HTMLButtonElement>("margin-note-source"), save = get<HTMLButtonElement>("margin-note-save");
  const remove = get<HTMLButtonElement>("margin-note-delete"), back = get<HTMLButtonElement>("margin-note-back");
  const scope = get<HTMLSelectElement>("margin-notes-scope"), tab = get<HTMLButtonElement>("margin-note-mode");
  const pin = get<HTMLButtonElement>("pin-margin-notes"), action = get<HTMLButtonElement>("selection-annotate");
  const editor = setupNoteEditor(host, get("margin-note-commands"));
  host.querySelector('[role="textbox"]')?.setAttribute("aria-label", "批注正文");
  let book: BookRecord | undefined, page = 1, entries: BookAnnotation[] = [], revision = 0;
  let selected: BookAnnotation | undefined, draft: ReturnType<typeof selectionAnchor>, selection: ReturnType<typeof selectionAnchor>;
  let baseline = "", saving = false;
  const drafts = new Map<string, { selected?: BookAnnotation; draft: NonNullable<typeof draft>; body: string; baseline: string }>();
  drawer.dataset.pinned = String(localStorage.getItem("annotations-pinned") === "true");
  const dirty = (): boolean => editor.getMarkdown().trim() !== baseline.trim();
  const syncDirty = (): void => { host.dataset.noteDirty = String(dirty()); };
  host.addEventListener("input", syncDirty);
  const changeAllowed = (): boolean => !saving && (!dirty() || window.confirm("放弃尚未保存的批注修改？"));
  const show = (): void => {
    drawer.dataset.mode = "annotation";
    get("thought-panel").hidden = true; get("record-panel").hidden = true; get("clear-conversation").hidden = true;
    get("thought-mode").setAttribute("aria-selected", "false"); get("record-mode").setAttribute("aria-selected", "false");
    tab.setAttribute("aria-selected", "true"); panel.hidden = false; pin.hidden = false;
    pin.setAttribute("aria-pressed", drawer.dataset.pinned || "false");
    openDrawer();
  };
  const locate = (anchor: AnnotationAnchor): void => {
    const target = stage.querySelector<HTMLElement>(`[data-page="${anchor.page}"]`);
    target?.scrollIntoView({ block: "start", behavior: "smooth" });
  };
  const edit = (entry?: BookAnnotation, nextDraft = entry && { quote: entry.quote, locator: entry.locator }): void => {
    if (!nextDraft || !changeAllowed()) return;
    selected = entry; draft = nextDraft; baseline = entry?.item.bodyMd || "";
    editor.setMarkdown(baseline); syncDirty(); quote.textContent = draft.quote;
    source.textContent = `第 ${draft.locator.page} ${book?.format === "pdf" ? "页" : "章"} · 原文`;
    editorPanel.hidden = false; list.hidden = true; remove.hidden = !entry; status.textContent = "";
    show(); if (entry) locate(entry.locator); else editor.focus();
  };
  const renderList = (): void => {
    list.replaceChildren();
    const visible = entries.filter((entry) => scope.value === "book" || entry.locator.page === page);
    get("margin-notes-count").textContent = `${visible.length} 条批注`;
    if (!visible.length) { const empty = document.createElement("p"); empty.className = "margin-note-empty"; empty.textContent = book ? "暂无批注" : "尚未打开书籍"; list.append(empty); }
    for (const entry of visible) {
      const row = document.createElement("button"); row.type = "button"; row.className = "margin-note-row";
      const location = document.createElement("small"); location.textContent = `第 ${entry.locator.page} ${book?.format === "pdf" ? "页" : "章"}`;
      const excerpt = document.createElement("blockquote"); excerpt.textContent = entry.quote;
      const body = document.createElement("p"); body.textContent = entry.item.bodyMd;
      row.append(location, excerpt, body); row.addEventListener("click", () => edit(entry)); list.append(row);
    }
  };
  const renderMarks = (): void => {
    stage.querySelectorAll(".margin-note-overlay").forEach((element) => element.remove());
    for (const entry of entries) {
      if (entry.locator.editionId && entry.locator.editionId !== book?.editionId) continue;
      const target = stage.querySelector<HTMLElement>(`[data-page="${entry.locator.page}"]`);
      if (!target) continue;
      const rects = annotationRects(target, entry.locator, entry.quote);
      if (!rects.length) continue;
      const overlay = document.createElement("div"); overlay.className = "margin-note-overlay";
      for (const rect of rects) {
        const highlight = document.createElement("span"); highlight.className = "margin-note-highlight";
        highlight.style.cssText = `left:${rect.x * 100}%;top:${rect.y * 100}%;width:${rect.width * 100}%;height:${rect.height * 100}%`;
        overlay.append(highlight);
      }
      const marker = document.createElement("button"); marker.type = "button"; marker.className = "margin-note-mark";
      marker.textContent = "▤"; marker.title = entry.item.bodyMd.slice(0, 100); marker.setAttribute("aria-label", `打开批注：${entry.quote.slice(0, 30)}`);
      marker.style.top = `${rects[0].y * 100}%`;
      marker.addEventListener("click", () => {
        if (selected?.item.id === entry.item.id && drawer.dataset.mode === "annotation" && drawer.getAttribute("aria-hidden") === "false") toggleDrawer();
        else edit(entry);
      });
      overlay.append(marker); target.append(overlay);
    }
  };
  const refresh = async (): Promise<void> => {
    const current = book?.id, version = ++revision;
    if (!current) { entries = []; renderList(); renderMarks(); return; }
    try {
      const result = await invoke<BookAnnotation[]>("list_book_annotations", { bookId: current });
      if (version !== revision || current !== book?.id) return;
      entries = result.sort((left, right) => left.locator.page - right.locator.page || (left.locator.start ?? left.locator.rects[0]?.y ?? 0) - (right.locator.start ?? right.locator.rects[0]?.y ?? 0)); renderList(); renderMarks();
    } catch { if (version === revision) status.textContent = "批注加载失败，请重新打开批注栏重试"; }
  };
  const capture = (): void => {
    selection = book ? selectionAnchor(stage, book.format, book.editionId) : undefined;
    action.hidden = !selection;
  };
  document.addEventListener("selectionchange", () => { if (window.getSelection()?.toString()) capture(); });
  stage.addEventListener("contextmenu", capture, true);
  stage.addEventListener("pointerup", () => { if (!window.getSelection()?.toString()) selection = undefined; });
  const annotate = (): void => {
    if (selection) { edit(undefined, structuredClone(selection)); get("selection-actions").hidden = true; selection = undefined; }
    else if (drawer.dataset.mode === "annotation" && drawer.getAttribute("aria-hidden") === "false") toggleDrawer();
    else { show(); void refresh(); }
  };
  action.addEventListener("pointerdown", (event) => event.preventDefault());
  action.addEventListener("click", annotate);
  tab.addEventListener("click", () => { show(); void refresh(); });
  scope.addEventListener("change", renderList);
  pin.addEventListener("click", () => {
    drawer.dataset.pinned = String(drawer.dataset.pinned !== "true");
    localStorage.setItem("annotations-pinned", drawer.dataset.pinned); pin.setAttribute("aria-pressed", drawer.dataset.pinned);
  });
  source.addEventListener("click", () => { if (draft) locate(draft.locator); });
  back.addEventListener("click", () => {
    if (!changeAllowed()) return;
    selected = undefined; draft = undefined; baseline = ""; editor.clear(); syncDirty(); editorPanel.hidden = true; list.hidden = false; renderList();
    if (book) drafts.delete(book.id);
  });
  const busy = (value: boolean): void => { saving = value; save.disabled = value; remove.disabled = value; back.disabled = value; };
  save.addEventListener("click", async () => {
    if (!draft || !book || saving) return;
    const body = editor.getMarkdown().trim();
    if (!body) { status.textContent = "请输入批注内容"; return; }
    const current = book.id, anchor = structuredClone(draft), entry = selected;
    busy(true); status.textContent = "保存中…";
    try {
      const item = entry ? await updateKnowledge({ id: entry.item.id, kind: entry.item.kind, bookId: current, category: entry.item.category, title: entry.item.title, bodyMd: body })
        : await saveKnowledge({ item: { kind: "thought", bookId: current, title: anchor.quote.slice(0, 60), bodyMd: body, creator: "user", basis: "book", reviewState: "confirmed" }, evidence: { kind: "text", bookId: current, locator: anchor.locator, textSnapshot: anchor.quote } });
      onSaved();
      if (book?.id !== current) {
        const pending = drafts.get(current);
        if (pending && pending.body.trim() !== body) drafts.set(current, { ...pending, selected: { item, ...anchor }, baseline: body });
        else drafts.delete(current);
        return;
      }
      selected = { item, ...anchor }; baseline = body; syncDirty(); remove.hidden = false;
      status.textContent = "已保存"; drafts.delete(current); await refresh();
    } catch { if (book?.id === current) status.textContent = "保存失败，内容已保留，请重试"; }
    finally { busy(false); }
  });
  remove.addEventListener("click", async () => {
    if (!selected || saving || !window.confirm("删除这条批注及其页面标记？")) return;
    const id = selected.item.id, current = book?.id;
    busy(true);
    try {
      await deleteKnowledge(id); onSaved();
      if (current !== book?.id) return;
      baseline = ""; editor.clear(); syncDirty(); selected = undefined; draft = undefined; editorPanel.hidden = true; list.hidden = false;
      await refresh(); status.textContent = "已删除";
    } catch { status.textContent = "删除失败，请重试"; } finally { busy(false); }
  });
  let frame = 0;
  const scheduleMarks = (): void => { cancelAnimationFrame(frame); frame = requestAnimationFrame(renderMarks); };
  new ResizeObserver(scheduleMarks).observe(stage);
  stage.addEventListener("reader-page-rendered", scheduleMarks);
  window.addEventListener("knowledge-changed", () => void refresh());
  return {
    annotate, refresh,
    setPage(next: number) { page = next; renderList(); },
    setBook(next: BookRecord) {
      if (book && draft && dirty()) drafts.set(book.id, { selected, draft, body: editor.getMarkdown(), baseline });
      book = next; page = next.lastPage; selection = undefined; entries = []; revision++; status.textContent = "";
      selected = undefined; draft = undefined; baseline = ""; editor.clear(); syncDirty(); editorPanel.hidden = true; list.hidden = false;
      const saved = drafts.get(next.id);
      if (saved) { selected = saved.selected; draft = saved.draft; baseline = saved.baseline; editor.setMarkdown(saved.body); syncDirty(); quote.textContent = draft.quote; source.textContent = `第 ${draft.locator.page} ${book.format === "pdf" ? "页" : "章"} · 原文`; editorPanel.hidden = false; list.hidden = true; remove.hidden = !selected; }
      void refresh();
    },
  };
}
