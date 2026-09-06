import assert from "node:assert/strict";
import test from "node:test";
import { readPdfText } from "./reader/pdf-text.ts";

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
