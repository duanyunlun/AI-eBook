import { saveKnowledge, searchKnowledge, type ReadingContext } from "../api";
import type { PdfReader } from "../reader/pdf-reader";

export type ReaderToolHandler = (name: string, args: Record<string, unknown>, signal: AbortSignal) => Promise<unknown>;

function confirmNote(title: string, body: string, signal: AbortSignal): Promise<boolean> {
  return new Promise((resolve) => {
    const dialog = document.createElement("dialog");
    dialog.className = "reader-tool-confirm";
    const heading = document.createElement("h2");
    heading.textContent = "保存 AI 记录";
    const label = document.createElement("h3");
    label.textContent = title;
    const content = document.createElement("div");
    content.className = "reader-tool-note";
    content.textContent = body;
    const actions = document.createElement("div");
    actions.className = "settings-actions";
    const cancel = document.createElement("button");
    cancel.textContent = "取消";
    const save = document.createElement("button");
    save.className = "primary-command";
    save.textContent = "确认保存";
    const finish = (approved: boolean): void => {
      signal.removeEventListener("abort", abort);
      dialog.close();
      dialog.remove();
      resolve(approved);
    };
    const abort = (): void => finish(false);
    cancel.addEventListener("click", () => finish(false));
    save.addEventListener("click", () => finish(true));
    dialog.addEventListener("cancel", (event) => { event.preventDefault(); finish(false); });
    actions.append(cancel, save);
    dialog.append(heading, label, content, actions);
    document.body.append(dialog);
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) return finish(false);
    dialog.showModal();
    cancel.focus();
  });
}

export function readerToolHandler(context: ReadingContext, bookBound: boolean, reader: Pick<PdfReader, "readPage" | "searchBook"> | undefined, onSaved: () => void): ReaderToolHandler {
  context = structuredClone(context);
  const textArg = (args: Record<string, unknown>, key: string, limit: number): string => {
    const value = args[key];
    if (typeof value !== "string" || !value.trim() || value.length > limit) throw new Error("工具参数无效");
    return value.trim();
  };
  return async (name, args, signal) => {
    signal.throwIfAborted();
    if (name === "reading_context") return {
      bookId: bookBound ? context.bookId : null, title: bookBound ? context.bookTitle : null,
      page: bookBound ? context.page : null, totalPages: bookBound ? context.totalPages : null,
      selection: context.text?.slice(0, 20_000), pageText: context.pageText?.slice(0, 20_000),
    };
    if (name === "read_page" || name === "search_book") {
      if (!bookBound || !reader) throw new Error("当前请求没有可访问的书籍");
      const result = name === "read_page"
        ? await reader.readPage(context.bookId, Number(args.page))
        : await reader.searchBook(context.bookId, textArg(args, "query", 200), Number(args.startPage ?? 1), signal);
      signal.throwIfAborted();
      return result;
    }
    if (name === "search_knowledge") {
      if (!bookBound) throw new Error("当前请求没有可访问的书籍知识");
      const items = await searchKnowledge(textArg(args, "query", 200), context.bookId);
      signal.throwIfAborted();
      return items.filter((item) => item.bookId === context.bookId).slice(0, 10).map((item) => ({ id: item.id, title: item.title, text: item.bodyMd.slice(0, 4000), creator: item.creator }));
    }
    if (name === "save_note") {
      const title = textArg(args, "title", 160);
      const body = textArg(args, "body", 20_000);
      if (!await confirmNote(title, body, signal)) return { saved: false, reason: "用户取消" };
      signal.throwIfAborted();
      const item = await saveKnowledge({ item: {
        kind: "concept", bookId: bookBound ? context.bookId : undefined, title, bodyMd: body,
        creator: "ai", basis: bookBound ? "book" : "external", reviewState: "confirmed",
      } });
      onSaved();
      return { saved: true, id: item.id };
    }
    throw new Error("未授权的阅读工具");
  };
}
