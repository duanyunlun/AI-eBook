import assert from "node:assert/strict";
import test from "node:test";
import { normalizeReadingColors, pdfColorFilter } from "./reading-colors.ts";

test("阅读配色默认保留 PDF 原色并限制调色参数", () => {
  assert.deepEqual(normalizeReadingColors(null), { mode: "original", pdf: false, strength: 60 });
  assert.equal(normalizeReadingColors({ strength: Infinity }).strength, 60);
  assert.equal(normalizeReadingColors({ strength: -10 }).strength, 0);
  assert.equal(normalizeReadingColors({ strength: 110 }).strength, 100);
  assert.equal(pdfColorFilter({ mode: "night", pdf: false, strength: 60 }), "none");
  assert.equal(pdfColorFilter({ mode: "original", pdf: true, strength: 60 }), "none");
  assert.equal(pdfColorFilter({ mode: "comfort", pdf: true, strength: 0 }), "none");
  assert.match(pdfColorFilter({ mode: "comfort", pdf: true, strength: 60 }), /brightness/);
  assert.match(pdfColorFilter({ mode: "night", pdf: true, strength: 60 }), /invert\(1\)/);
});
