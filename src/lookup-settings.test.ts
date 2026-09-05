import assert from "node:assert/strict";
import test from "node:test";
import { defaultLookupPrompts, getLookupInstruction } from "./ui/ai-settings.ts";

test("翻译和解释提示词支持自定义、空白回退及目标语言", () => {
  const stored = new Map<string, string>();
  const original = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: { getItem: (key: string) => stored.get(key) ?? null },
  });
  try {
    assert.equal(getLookupInstruction("translate"), `目标语言是简体中文。${defaultLookupPrompts.translate}`);
    assert.equal(getLookupInstruction("explain"), defaultLookupPrompts.explain);
    stored.set("lookup-prompt-translate", "逐句翻译");
    stored.set("translation-language", "English");
    assert.equal(getLookupInstruction("translate"), "目标语言是English。逐句翻译");
    stored.set("lookup-prompt-explain", "举例解释");
    assert.equal(getLookupInstruction("explain"), "举例解释");
    stored.set("lookup-prompt-explain", "  ");
    assert.equal(getLookupInstruction("explain"), defaultLookupPrompts.explain);
  } finally {
    if (original) Object.defineProperty(globalThis, "localStorage", original);
    else Reflect.deleteProperty(globalThis, "localStorage");
  }
});
