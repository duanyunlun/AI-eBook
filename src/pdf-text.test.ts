import assert from "node:assert/strict";
import test from "node:test";
import { readPdfText, reflowPdfText } from "./reader/pdf-text.ts";

test("PDF 重排合并印刷换行但保留段落和英文词间距", () => {
  const line = (str: string, top: number, left = 40, width = 400, height = 16) => ({ str, hasEOL: true, transform: [height, 0, 0, height, left, top], width, height });
  assert.equal(reflowPdfText([
    line("章节标题", 760, 180, 100, 24),
    line("这是第一段的印刷换行", 716, 72, 368),
    line("接着阅读。", 692, 40, 100),
    line("这是新段落", 668, 72, 368),
    line("仍属于这一段。", 644, 40, 400),
    line("Next line", 596), line("continues here.", 572),
  ]), "章节标题\n\n这是第一段的印刷换行接着阅读。\n\n这是新段落仍属于这一段。\n\nNext line continues here.");
  assert.equal(reflowPdfText([{str:"无法判断结构的第一行",hasEOL:true},{str:"第二行",hasEOL:true}]), "无法判断结构的第一行\n\n第二行");
});

test("PDF 提取不依赖 WebView 的流式异步迭代支持", async () => {
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue({ items: [{ str: "第一行", hasEOL: true }, { type: "beginMarkedContent" }] });
      controller.enqueue({ items: [{ str: "第二行", hasEOL: false }] });
      controller.close();
    },
  });
  Object.defineProperty(stream, Symbol.asyncIterator, { value: undefined });
  assert.equal(await readPdfText({ streamTextContent: () => stream }), "第一行\n第二行");
  assert.equal(stream.locked, false);
  const broken = new ReadableStream({ start(controller) { controller.error(new Error("解析失败")); } });
  await assert.rejects(readPdfText({ streamTextContent: () => broken }), /解析失败/);
  assert.equal(broken.locked, false);
});
