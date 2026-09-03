import assert from "node:assert/strict";
import test from "node:test";
import { clampDrawerWidth } from "./ui/annotation-resize.ts";

test("批注抽屉宽度不超过窗口一半", () => {
  assert.equal(clampDrawerWidth(900, 1200), 600);
  assert.equal(clampDrawerWidth(100, 1200), 240);
});

test("窄窗口优先保证一半上限", () => {
  assert.equal(clampDrawerWidth(300, 400), 200);
  assert.equal(clampDrawerWidth(Number.NaN, 1000), 300);
});
