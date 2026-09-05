type SummaryItem = { id: string; bodyMd: string };
export const defaultSummaryPrompt = "只总结以下由我亲自记录的思考，提炼主题、论证脉络和仍待解决的问题：";

export function buildBookSummary(items: SummaryItem[], maxSourceChars = 40_000, instruction = defaultSummaryPrompt): {
  prompt: string;
  itemIds: string[];
} {
  const sources: string[] = [];
  const itemIds: string[] = [];
  let remaining = maxSourceChars;
  for (const item of items) {
    const body = item.bodyMd.trim();
    if (!body || remaining <= 0) continue;
    const excerpt = body.slice(0, remaining);
    sources.push(`- ${excerpt}`);
    itemIds.push(item.id);
    remaining -= excerpt.length;
    if (excerpt.length < body.length) break;
  }
  return {
    prompt: `${instruction}\n\n${sources.join("\n")}`,
    itemIds,
  };
}
