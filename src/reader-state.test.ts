import assert from "node:assert/strict";
import test from "node:test";
import { clampPage, clampScale, parseBase64DataUrl, parseTextChapters, readingContextMaterial } from "./reader-state.ts";

test("页码始终限制在文档范围内", () => {
  assert.equal(clampPage(-4, 10), 1);
  assert.equal(clampPage(4.9, 10), 4);
  assert.equal(clampPage(99, 10), 10);
  assert.equal(clampPage(Number.NaN, 10), 1);
});

test("缩放比例按十个百分点调整并限制范围", () => {
  assert.equal(clampScale(0.2), 0.6);
  assert.equal(clampScale(1.26), 1.3);
  assert.equal(clampScale(3), 2.4);
  assert.equal(clampScale(0.3, 0.2), 0.3);
  assert.equal(clampScale(0.1, 0.2), 0.2);
});

test("页面截图使用浏览器实际返回的图片格式", () => {
  assert.deepEqual(parseBase64DataUrl("data:image/png;base64,AAAA"), { mediaType: "image/png", data: "AAAA" });
  assert.equal(parseBase64DataUrl("data:image/png,not-base64"), undefined);
});

test("知识证据优先使用选区并回退到当前页材料", () => {
  const pageImage = { mediaType: "image/png", data: "page" };
  assert.deepEqual(readingContextMaterial({ text: "选区", pageText: "整页", pageImage }), { text: "选区" });
  assert.deepEqual(readingContextMaterial({ pageImage }), { image: pageImage });
  assert.equal(readingContextMaterial({}), undefined);
});

test("纯文本与 Markdown 标题生成章节", () => {
  assert.deepEqual(parseTextChapters("前言\n# 第一章 开始\n正文\n第二章 继续\n内容"), [
    { title: "全文", body: "前言" },
    { title: "第一章 开始", body: "正文" },
    { title: "第二章 继续", body: "内容" },
  ]);
});
