import type { AiMessage, ThreadConversation } from "./api";

export type MessageSource = { page: number; content: AiMessage["content"] };

export function parseMessageSource(value?: string | null): MessageSource | undefined {
  if (!value) return undefined;
  try {
    const source = JSON.parse(value);
    if (!Number.isInteger(source.page) || source.page < 0 || !Array.isArray(source.content)) return undefined;
    if (!source.content.every((part: AiMessage["content"][number]) => part && (
      part.type === "text" ? typeof part.text === "string" :
        part.type === "image" && /^image\/(png|jpeg|webp|gif)$/.test(part.media_type) && typeof part.data === "string"
    ))) return undefined;
    return source;
  } catch {
    return undefined;
  }
}

export function restoreConversation(saved: ThreadConversation): AiMessage[] {
  return saved.messages.filter((message) => message.state === "complete").map((message) => ({
    role: message.role,
    content: [...(message.role === "user" ? parseMessageSource(message.contextJson)?.content ?? [] : []), { type: "text", text: message.body }],
  }));
}
