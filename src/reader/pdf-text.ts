import type { PDFPageProxy } from "pdfjs-dist";

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
