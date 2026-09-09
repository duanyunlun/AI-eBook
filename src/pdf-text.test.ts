import assert from "node:assert/strict";
import test from "node:test";
import { readPdfText, reflowPdfText } from "./reader/pdf-text.ts";

test("PDF 重排合并印刷换行但保留段落和英文词间距", () => {
  assert.equal(reflowPdfText("这是第一行\n接着阅读。\n\nNext line\ncontinues here."), "这是第一行接着阅读。\n\nNext line continues here.");
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
