export function clampPage(page: number, total: number): number {
  if (!Number.isFinite(page)) return 1;
  return Math.min(Math.max(Math.trunc(page), 1), Math.max(total, 1));
}

export function clampScale(scale: number): number {
  if (!Number.isFinite(scale)) return 1;
  return Math.min(Math.max(Math.round(scale * 10) / 10, 0.6), 2.4);
}

export type TextChapter = {
  title: string;
  body: string;
};

export function parseTextChapters(source: string): TextChapter[] {
  const chapters: TextChapter[] = [];
  let title = "全文";
  let lines: string[] = [];
  const flush = (): void => {
    const body = lines.join("\n").trim();
    if (body || title !== "全文") chapters.push({ title, body });
  };

  for (const line of source.replace(/\r\n?/g, "\n").split("\n")) {
    const markdown = line.match(/^\s{0,3}#{1,6}\s+(.+?)\s*#*\s*$/);
    const plain = line.match(/^\s*((?:第[零〇一二三四五六七八九十百千万两\d]+[章节卷部篇回集]|[卷部篇][零〇一二三四五六七八九十百千万两\d]+)(?:\s+.*)?)\s*$/);
    const nextTitle = markdown?.[1] || plain?.[1];
    if (nextTitle) {
      flush();
      title = nextTitle.trim();
      lines = [];
    } else {
      lines.push(line);
    }
  }
  flush();
  return chapters.length ? chapters : [{ title: "全文", body: source.trim() }];
}
