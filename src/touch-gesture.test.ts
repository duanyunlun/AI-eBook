import assert from "node:assert/strict";
import { test } from "node:test";
import { readingGesture, swipeEdge } from "./touch-gesture.ts";

test("阅读手势区分快点、横滑、纵向滚动与长按，禁区保持有效范围", () => {
  assert.equal(readingGesture(2, 3, 120), "tap");
  assert.equal(readingGesture(-90, 20, 250), "left");
  assert.equal(readingGesture(90, 20, 250), "right");
  assert.equal(readingGesture(20, 90, 250), undefined);
  assert.equal(readingGesture(80, 60, 250), undefined);
  assert.equal(readingGesture(0, 0, 750), undefined);
  assert.equal(readingGesture(100, 0, 750), undefined);
  assert.equal(swipeEdge(NaN), 32);
  assert.equal(swipeEdge(-1), 24);
  assert.equal(swipeEdge(500), 120);
});
