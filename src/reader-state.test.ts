import assert from "node:assert/strict";
import test from "node:test";
import { clampPage, parseTextChapters } from "./reader-state.ts";

test("页码始终限制在文档范围内", () => {
  assert.equal(clampPage(-4, 10), 1);
  assert.equal(clampPage(4.9, 10), 4);
  assert.equal(clampPage(99, 10), 10);
  assert.equal(clampPage(Number.NaN, 10), 1);
});

test("纯文本与 Markdown 标题生成章节", () => {
  assert.deepEqual(parseTextChapters("前言\n# 第一章 开始\n正文\n第二章 继续\n内容"), [
    { title: "全文", body: "前言" },
    { title: "第一章 开始", body: "正文" },
    { title: "第二章 继续", body: "内容" },
  ]);
});
