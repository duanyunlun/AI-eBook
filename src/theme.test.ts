import assert from "node:assert/strict";
import test from "node:test";
import { oppositeTheme, preferredTheme } from "./ui/theme.ts";

test("已保存的主题优先于系统主题", () => {
  assert.equal(preferredTheme("light", true), "light");
  assert.equal(preferredTheme("dark", false), "dark");
});

test("未保存主题时跟随系统并可切换", () => {
  assert.equal(preferredTheme(null, true), "dark");
  assert.equal(oppositeTheme("dark"), "light");
});
