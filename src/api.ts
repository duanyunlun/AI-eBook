import { Channel, convertFileSrc, invoke } from "@tauri-apps/api/core";
import { getAiSettings } from "./ui/ai-settings";
import type { ReaderToolHandler } from "./ui/reader-tools";

export type BookRecord = {
  id: string;
  editionId: string;
  title: string;
  storedPath: string;
  format: string;
  lastPage: number;
  updatedAt: number;
};

export type KnowledgeItem = {
  id: string;
  kind: "thought" | "question" | "answer" | "concept" | "conclusion" | "summary";
  bookId?: string;
  chapterId?: string;
  category?: string;
  title?: string;
  bodyMd: string;
  creator: "user" | "ai";
  basis: "user_thought" | "book" | "external" | "mixed";
  reviewState: "draft" | "confirmed" | "rejected";
  createdAt: number;
  updatedAt: number;
};

export type KnowledgeEdge = {
  id: string;
  fromItemId: string;
  toItemId: string;
  relation: string;
};

export type KnowledgeGraph = {
  items: KnowledgeItem[];
  edges: KnowledgeEdge[];
};

export type ThreadConversation = {
  id: string;
  title: string;
  messages: Array<{ id: string; role: "user" | "assistant"; body: string; createdAt: number; contextJson?: string | null; state: "complete" | "interrupted" | "failed" }>;
};

export type ThreadSummary = { id: string; title: string; updatedAt: number; page: number };
export const listThreadsForBook = (bookId: string, mode = "thought"): Promise<ThreadSummary[]> =>
  invoke("list_threads_for_book", { bookId, mode });
export const createThreadForBook = (bookId: string, mode = "thought"): Promise<ThreadConversation> =>
  invoke("create_thread_for_book", { bookId, mode });
export const selectThread = (threadId: string, bookId: string): Promise<ThreadConversation> =>
  invoke("select_thread", { threadId, bookId });
export const deleteThread = (threadId: string, bookId: string): Promise<void> =>
  invoke("delete_thread", { threadId, bookId });

export type ReadingContext = {
  bookId: string;
  bookTitle: string;
  bookFormat: string;
  page: number;
  totalPages: number;
  text?: string;
  image?: { mediaType: string; data: string };
  pageText?: string;
  pageImage?: { mediaType: string; data: string };
};

export type SaveKnowledgeRequest = {
  item: {
    kind: KnowledgeItem["kind"];
    bookId?: string;
    chapterId?: string;
    category?: string;
    title?: string;
    bodyMd: string;
    creator: KnowledgeItem["creator"];
    basis: KnowledgeItem["basis"];
    reviewState: "confirmed";
  };
  evidence?: {
    kind: "text" | "image" | "external";
    bookId?: string;
    chapterId?: string;
    locator: Record<string, unknown>;
    textSnapshot?: string;
    assetHash?: string;
    sourceUrl?: string;
  };
  assetData?: string;
  links?: Array<{ targetId: string; relation: string }>;
};

export type AiMessage = {
  role: "system" | "user" | "assistant";
  content: Array<{ type: "text"; text: string } | { type: "image"; media_type: string; data: string }>;
};

type AiOutput = { type: "delta"; data: string } | { type: "finished" | "reset" } | { type: "tool"; data: { callId: string; name: string; arguments: Record<string, unknown> } };

export const bookUrl = (book: BookRecord): string => convertFileSrc(book.storedPath);
export const importBook = (): Promise<BookRecord | null> => invoke("import_book");
export const listBooks = (): Promise<BookRecord[]> => invoke("list_books");
export const renameBook = (bookId: string, title: string): Promise<BookRecord> =>
  invoke("rename_book", { bookId, title });
export const removeBook = (bookId: string): Promise<void> => invoke("remove_book", { bookId });
export const saveReadingPage = (bookId: string, page: number): Promise<void> =>
  invoke("save_reading_page", { bookId, page });

export const saveKnowledge = (request: SaveKnowledgeRequest): Promise<KnowledgeItem> =>
  invoke<KnowledgeItem>("save_knowledge_item", { request }).then((item) => { window.dispatchEvent(new Event("knowledge-changed")); return item; });
export const updateKnowledge = (request: {
  id: string;
  kind: KnowledgeItem["kind"];
  bookId?: string;
  category?: string;
  title?: string;
  bodyMd: string;
}): Promise<KnowledgeItem> => invoke<KnowledgeItem>("update_knowledge_item", { request }).then((item) => { window.dispatchEvent(new Event("knowledge-changed")); return item; });
export const deleteKnowledge = (id: string): Promise<void> =>
  invoke<void>("delete_knowledge_item", { id }).then(() => { window.dispatchEvent(new Event("knowledge-changed")); });
export const listKnowledge = (bookId?: string): Promise<KnowledgeItem[]> =>
  invoke("list_knowledge", { bookId });
export const listKnowledgeBooks = (): Promise<Array<{ id: string; title: string }>> =>
  invoke("list_knowledge_books");
export const searchKnowledge = (query: string, bookId?: string): Promise<KnowledgeItem[]> =>
  invoke("search_knowledge", { query, bookId });
export const getKnowledgeGraph = (): Promise<KnowledgeGraph> => invoke("get_knowledge_graph");
export const appendThreadMessage = (request: {
  threadId?: string;
  mode: "thought" | "record";
  bookId: string;
  page: number;
  role: "user" | "assistant";
  body: string;
  contextJson?: string;
  state?: "complete" | "interrupted" | "failed";
}): Promise<ThreadConversation> => invoke("append_thread_message", { request });
export const loadLatestThread = (
  bookId: string,
  mode: "thought" | "record",
): Promise<ThreadConversation | null> => invoke("load_latest_thread", { bookId, mode });
export const closeThread = (threadId: string, bookId: string): Promise<void> =>
  invoke("close_thread", { threadId, bookId });

export const getVaultPath = (): Promise<string> => invoke("get_vault_path");
export const chooseVault = (): Promise<string | null> => invoke("choose_vault");

export const cancelAi = (requestId: string): Promise<void> => invoke("cancel_ai", { requestId });

export async function streamAi(
  requestId: string,
  messages: AiMessage[],
  onDelta: (text: string) => void,
  options?: { onReset?: () => void; onActivity?: (message: string) => void; toolHandler?: ReaderToolHandler },
): Promise<void> {
  const controller = new AbortController();
  const onEvent = new Channel<AiOutput>((event) => {
    if (event.type === "delta") onDelta(event.data);
    if (event.type === "reset") options?.onReset?.();
    if (event.type === "tool") {
      const labels: Record<string, string> = { reading_context: "读取阅读上下文", read_page: "读取书籍页面", search_book: "检索本书", search_knowledge: "检索本书知识", save_note: "等待保存确认" };
      options?.onActivity?.(labels[event.data.name] || "执行阅读工具");
      const reply = async (): Promise<void> => {
        let result;
        try {
          if (!options?.toolHandler) throw new Error("本次请求未开放阅读工具");
          result = { value: await options.toolHandler(event.data.name, event.data.arguments, controller.signal) };
        } catch { result = { error: "工具执行失败或用户取消" }; }
        if (!controller.signal.aborted) await invoke("resolve_reader_tool", { requestId, callId: event.data.callId, reply: result });
      };
      void reply().catch(() => undefined);
    }
  });
  try {
    await invoke("generate_ai", {
      request: { requestId, provider: getAiSettings(), messages },
      onEvent,
    });
  } finally { controller.abort(); }
}
