export type AnnotationRect = { x: number; y: number; width: number; height: number };
export type AnnotationAnchor = { annotation: true; page: number; format: string; editionId?: string; rects: AnnotationRect[]; start?: number; end?: number };

export function selectionAnchor(stage: HTMLElement, format: string, editionId?: string): { quote: string; locator: AnnotationAnchor } | undefined {
  const selection = window.getSelection();
  if (!selection?.rangeCount || selection.isCollapsed) return;
  const range = selection.getRangeAt(0);
  const element = range.startContainer instanceof Element ? range.startContainer : range.startContainer.parentElement;
  const page = element?.closest<HTMLElement>(".reader-page");
  if (!page || !stage.contains(page) || !page.contains(range.endContainer)) return;
  const quote = range.toString().trim();
  if (!quote || quote.length > 20_000) return;
  const rects = rangeRects(range, page);
  if (!rects.length) return;
  const locator: AnnotationAnchor = { annotation: true, page: Number(page.dataset.page), format, editionId, rects };
  if (format !== "pdf") {
    const content = page.querySelector(".text-page-content");
    if (!content?.contains(range.startContainer) || !content.contains(range.endContainer)) return;
    const prefix = document.createRange();
    prefix.selectNodeContents(content);
    prefix.setEnd(range.startContainer, range.startOffset);
    locator.start = prefix.toString().length;
    locator.end = locator.start + range.toString().length;
  }
  return { quote, locator };
}

function rangeRects(range: Range, page: HTMLElement): AnnotationRect[] {
  const bounds = page.getBoundingClientRect();
  if (!bounds.width || !bounds.height) return [];
  return Array.from(range.getClientRects()).filter((rect) => rect.width > 0 && rect.height > 0).map((rect) => ({
    x: Math.max(0, (rect.left - bounds.left) / bounds.width), y: Math.max(0, (rect.top - bounds.top) / bounds.height),
    width: Math.min(rect.width / bounds.width, 1), height: Math.min(rect.height / bounds.height, 1),
  }));
}

export function annotationRects(page: HTMLElement, anchor: AnnotationAnchor, quote: string): AnnotationRect[] {
  if (anchor.format === "pdf" && anchor.rects?.length) return anchor.rects;
  const content = page.querySelector(".text-page-content, .textLayer");
  if (!content) return [];
  let start = anchor.start ?? -1, end = anchor.end ?? -1;
  const text = content.textContent || "";
  if (start < 0 || text.slice(start, end).trim() !== quote) {
    const offsets: number[] = [];
    let normalized = "";
    for (let index = 0; index < text.length; index++) {
      if (/\s/.test(text[index])) continue;
      normalized += text[index];
      offsets.push(index);
    }
    const needle = quote.replace(/\s/g, "");
    const match = normalized.indexOf(needle);
    if (!needle || match < 0 || normalized.indexOf(needle, match + 1) >= 0) return [];
    start = offsets[match];
    end = offsets[match + needle.length - 1] + 1;
  }
  const walker = document.createTreeWalker(content, NodeFilter.SHOW_TEXT);
  const range = document.createRange();
  let offset = 0, started = false;
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const length = node.textContent?.length || 0;
    if (!started && start <= offset + length) { range.setStart(node, start - offset); started = true; }
    if (started && end <= offset + length) { range.setEnd(node, end - offset); return rangeRects(range, page); }
    offset += length;
  }
  return [];
}
