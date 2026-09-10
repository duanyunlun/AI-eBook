import type { PdfTextItem } from "./pdf-text";

type Line = { text: string; left: number; right: number; top: number; size: number; positioned: boolean };

const CHAPTER_PATTERN = /^(第[零〇一二三四五六七八九十百千万两\d]+[章节卷部篇回集]|[卷部篇][零〇一二三四五六七八九十百千万两\d]+|\d+(?:\.\d+)+)\s/;
const PAGE_NUMBER = /^[\s\-—·—]*(?:\d+|[ivxlcIVXLC]+)[\s\-—·—]*$/;
const SENTENCE_END = /[。！？…；!?;:]["”’」』）)】\]]*\s*$/;

/** 把 PDF 文本项按位置合并成行，沿用旧重排实现的判行规则。 */
export function pdfLines(items: PdfTextItem[]): Line[] {
  const lines: Line[] = [];
  let line: Line | undefined;
  const finish = (): void => {
    if (line?.text.trim()) lines.push(line);
    line = undefined;
  };
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
  return lines.map((current) => ({ ...current, text: current.text.trim() }));
}

/** 按位置与字号把整本书的 PDF 文本还原成章节 Markdown。 */
export function pdfMarkdown(pages: PdfTextItem[][]): string {
  const pageLines = pages.map((items) => pdfLines(items).filter((line) => !PAGE_NUMBER.test(line.text)));
  const repeated = new Set<string>();
  const counts = new Map<string, number>();
  for (const lines of pageLines) {
    for (const edge of [lines[0]?.text, lines[lines.length - 1]?.text]) {
      if (edge && edge.length <= 40) counts.set(edge, (counts.get(edge) || 0) + 1);
    }
  }
  const threshold = Math.max(2, Math.ceil(pageLines.length * 0.5));
  for (const [text, count] of counts) if (count >= threshold) repeated.add(text);
  const body = bodySize(pageLines.flat());
  let markdown = "";
  let paragraph = "";
  const flush = (): void => {
    if (paragraph.trim()) markdown += `${paragraph.trim()}\n\n`;
    paragraph = "";
  };
  let previous: Line | undefined;
  for (const lines of pageLines) {
    const kept = lines.filter((line) => !repeated.has(line.text));
    const leftEdge = Math.min(...kept.map((line) => line.left), 0);
    const rightEdge = Math.max(...kept.map((line) => line.right), 0);
    const gaps = kept
      .slice(1)
      .map((current, index) => Math.abs(current.top - kept[index].top))
      .filter((gap) => gap > 0)
      .sort((left, right) => left - right);
    const spacing = gaps[Math.floor((gaps.length - 1) / 2)] || body * 1.4;
    kept.forEach((line, index) => {
      if ((body > 0 && line.size >= body * 1.2 && line.text.length <= 60) || CHAPTER_PATTERN.test(line.text)) {
        flush();
        markdown += `# ${line.text}\n\n`;
        previous = line;
        return;
      }
      const before = index > 0 ? kept[index - 1] : previous;
      // 跨页时按上一页末行的句末标点决定续接，同页内继续使用位置规则
      const breaks = !before || (index === 0 ? SENTENCE_END.test(before.text) : newParagraph(before, line, spacing, leftEdge, rightEdge));
      if (breaks) flush();
      paragraph = paragraph ? join(paragraph, line.text) : line.text;
    });
    if (kept.length) previous = kept[kept.length - 1];
  }
  flush();
  return markdown.trim();
}

function newParagraph(previous: Line, line: Line, spacing: number, leftEdge: number, rightEdge: number): boolean {
  if (!line.positioned || !previous.positioned) return true;
  const size = Math.min(line.size, previous.size);
  return (
    Math.abs(line.top - previous.top) > spacing * 1.3 ||
    line.top >= previous.top ||
    Math.abs(line.size - previous.size) > size * 0.15 ||
    line.left - leftEdge > line.size * 0.8 ||
    (rightEdge - previous.right > previous.size * 2 && SENTENCE_END.test(previous.text))
  );
}

function join(left: string, right: string): string {
  return /[\p{Script=Han}，。！？；：、）”’】]$/u.test(left) || /^[，。！？；：、）】”’]/u.test(right)
    ? left + right
    : `${left} ${right}`;
}

/** 正文行数加权的中位字号，用来判断标题。 */
function bodySize(lines: Line[]): number {
  const sizes = lines.map((line) => line.size).filter((size) => Number.isFinite(size) && size > 0).sort((left, right) => left - right);
  return sizes[Math.floor((sizes.length - 1) / 2)] || 0;
}
