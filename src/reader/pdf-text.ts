import type { PDFPageProxy } from "pdfjs-dist";

export type PdfTextItem = { str: string; hasEOL?: boolean; transform?: number[]; width?: number; height?: number };

/** 读取带位置的文本项，供 PDF 重排还原段落使用。 */
export async function readPdfItems(page: Pick<PDFPageProxy, "streamTextContent">): Promise<PdfTextItem[]> {
  const reader = page.streamTextContent().getReader();
  const items: PdfTextItem[] = [];
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      for (const item of value.items) {
        if ("str" in item) items.push(item);
      }
    }
  } finally { reader.releaseLock(); }
  return items;
}

export async function readPdfText(page: Pick<PDFPageProxy, "streamTextContent">): Promise<string> {
  const reader = page.streamTextContent().getReader();
  const parts: string[] = [];
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      for (const item of value.items) {
        if ("str" in item) parts.push(`${item.str}${item.hasEOL ? "\n" : " "}`);
      }
    }
  } finally { reader.releaseLock(); }
  return parts.join("").replace(/[ \t]+/g, " ").replace(/ *\n */g, "\n").trim();
}
