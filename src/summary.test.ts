import assert from "node:assert/strict";
import test from "node:test";
import { buildBookSummary } from "./summary.ts";

test("本书总结只引用实际送入模型的记录并限制长度", () => {
  const result = buildBookSummary([
    { id: "one", bodyMd: "第一条思考" },
    { id: "two", bodyMd: "第二条很长的思考" },
  ], 10);
  assert.deepEqual(result.itemIds, ["one", "two"]);
  assert.match(result.prompt, /第一条思考/);
  assert.ok(result.prompt.length < 100);
  assert.equal(buildBookSummary([{ id: "one", bodyMd: "材料" }], undefined, "自定义总结").prompt, "自定义总结\n\n- 材料");
});
