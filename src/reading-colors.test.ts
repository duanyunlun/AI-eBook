import assert from "node:assert/strict";
import test from "node:test";
import { normalizeReadingColors, pdfColorFilter, customReadingPalette } from "./reading-colors.ts";

test("阅读配色默认保留 PDF 原色并限制调色参数", () => {
  assert.deepEqual(normalizeReadingColors(null), { mode: "original", pdf: false, strength: 60, background: "#dce5dc" });
  assert.equal(normalizeReadingColors({ strength: Infinity }).strength, 60);
  assert.equal(normalizeReadingColors({ strength: -10 }).strength, 0);
  assert.equal(normalizeReadingColors({ strength: 110 }).strength, 100);
  assert.equal(pdfColorFilter({ mode: "night", pdf: false, strength: 60 }), "none");
  assert.equal(pdfColorFilter({ mode: "original", pdf: true, strength: 60 }), "none");
  assert.equal(pdfColorFilter({ mode: "comfort", pdf: true, strength: 0 }), "none");
  assert.match(pdfColorFilter({ mode: "comfort", pdf: true, strength: 60 }), /brightness/);
  assert.match(pdfColorFilter({ mode: "night", pdf: true, strength: 60 }), /invert\(1\)/);
});

test("自定义背景保持对比度并将 PDF 白色映射到所选颜色", () => {
  assert.equal(customReadingPalette("#ffffff").ink, "#000000");
  assert.equal(customReadingPalette("#101010").ink, "#ffffff");
  for (const color of ["#e8ddc4", "#203040"]) {
    const matrix = customReadingPalette(color).matrix.split(" ").map(Number);
    for (let channel = 0; channel < 3; channel++) {
      assert.ok(Math.abs(matrix[channel * 5 + channel] + matrix[channel * 5 + 4] - parseInt(color.slice(1 + channel * 2, 3 + channel * 2), 16) / 255) < 1e-6);
    }
  }
  assert.equal(normalizeReadingColors({ background: "invalid" }).background, "#dce5dc");
});
