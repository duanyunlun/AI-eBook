import type { PDFPageProxy } from "pdfjs-dist";

type PdfTextItem = { str: string; hasEOL?: boolean; transform?: number[]; width?: number; height?: number };

export function reflowPdfText(items: PdfTextItem[]): string {
  const lines: Array<{ text: string; left: number; right: number; top: number; size: number; positioned: boolean }> = [];
  let line: typeof lines[number] | undefined;
  const finish = (): void => { if (line?.text.trim()) lines.push(line); line = undefined; };
  for (const item of items) {
    const positioned = !!item.transform?.every(Number.isFinite) && item.transform.length >= 6;
    const left = positioned ? item.transform![4] : 0;
    const top = positioned ? item.transform![5] : 0;
    const size = Math.abs(item.height || (positioned ? Math.hypot(item.transform![2], item.transform![3]) : 0)) || 16;
    if (line && positioned && Math.abs(top - line.top) > Math.max(size, line.size) * 0.5) finish();
    if (item.str.trim()) {
      if (!line) line = { text: "", left, right: left, top, size, positioned };
      line.text += `${item.str} `;
      line.right = Math.max(line.right, left + (item.width || 0));
      line.size = Math.max(line.size, size);
      line.positioned &&= positioned;
    }
    if (item.hasEOL) finish();
  }
  finish();
  const gaps = lines.slice(1).map((current, index) => Math.abs(current.top - lines[index].top)).filter(gap => gap > 0).sort((left, right) => left - right);
  const spacing = gaps[Math.floor((gaps.length - 1) / 2)] || 24;
  const leftEdge = Math.min(...lines.map(current => current.left));
  const rightEdge = Math.max(...lines.map(current => current.right));
  let result = "";
  lines.forEach((current, index) => {
    const previous = lines[index - 1];
    if (previous) {
      const gap = Math.abs(current.top - previous.top);
      const paragraph = !current.positioned || !previous.positioned
        || gap > spacing * 1.3 || current.top >= previous.top
        || Math.abs(current.size - previous.size) > Math.min(current.size, previous.size) * 0.15
        || current.left - leftEdge > current.size * 0.8
        || (rightEdge - previous.right > previous.size * 2 && /[。！？.!?:：；;][”’"')）]*\s*$/.test(previous.text));
      result += paragraph ? "\n\n" : " ";
    }
    result += current.text.trim();
  });
  return result.replace(/([\p{Script=Han}，。！？；：、）]) +(?=[\p{Script=Han}，。！？；：、（])/gu, "$1");
}

export async function readPdfText(page: Pick<PDFPageProxy, "streamTextContent">, reflow = false): Promise<string> {
  const reader = page.streamTextContent().getReader();
  const parts: string[] = [];
  const items: PdfTextItem[] = [];
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      for (const item of value.items) {
        if ("str" in item) {
          if (reflow) items.push(item);
          else parts.push(`${item.str}${item.hasEOL ? "\n" : " "}`);
        }
      }
    }
  } finally { reader.releaseLock(); }
  return reflow ? reflowPdfText(items) : parts.join("").replace(/[ \t]+/g, " ").replace(/ *\n */g, "\n").trim();
}
