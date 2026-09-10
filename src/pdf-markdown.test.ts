import assert from "node:assert/strict";
import test from "node:test";
import { pdfMarkdown, pdfLines } from "./reader/pdf-markdown.ts";

const item = (str: string, x: number, y: number, size = 10) => ({ str, transform: [size, 0, 0, size, x, y], width: str.length * size, height: size });

test("同类文本合并成行并保留行序", () => {
  assert.deepEqual(pdfLines([item("第一行", 0, 100), item("接续", 60, 100), item("第二行", 0, 88)]).map((line) => line.text), [
    "第一行 接续",
    "第二行",
  ]);
});

test("去掉重复页眉页码并跨页续接段落", () => {
  const markdown = pdfMarkdown([
    [item("某某文集", 0, 100), item("正文开始，", 0, 80), item("这一页没有结束", 0, 68)],
    [item("某某文集", 0, 100), item("12", 0, 60), item("第二页接着写。", 0, 40)],
  ]);
  assert.equal(markdown, "正文开始，这一页没有结束第二页接着写。");
});

test("大字号与章节样式识别为标题", () => {
  const markdown = pdfMarkdown([
    [item("第一章 起点", 0, 100, 20), item("正文内容。", 0, 80), item("第二章 转折", 0, 60, 20), item("后续内容。", 0, 40)],
  ]);
  assert.equal(markdown, "# 第一章 起点\n\n正文内容。\n\n# 第二章 转折\n\n后续内容。");
});
