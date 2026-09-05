import assert from "node:assert/strict";
import test from "node:test";
import { parseMessageSource, restoreConversation } from "./conversation-state.ts";

test("恢复历史材料并排除未完成回答，兼容无来源旧消息", () => {
  const source = { page: 20, content: [{ type: "text", text: "昨天的选区" }] };
  const saved = { id: "thread", title: "问题", messages: [
    { id: "1", role: "user", body: "这是什么意思", createdAt: 1, state: "complete", contextJson: JSON.stringify(source) },
    { id: "2", role: "assistant", body: "半截", createdAt: 2, state: "interrupted" },
    { id: "3", role: "assistant", body: "旧回答", createdAt: 3, state: "complete" },
  ] };
  assert.deepEqual(parseMessageSource(JSON.stringify(source)), source);
  assert.deepEqual(restoreConversation(saved), [
    { role: "user", content: [...source.content, { type: "text", text: "这是什么意思" }] },
    { role: "assistant", content: [{ type: "text", text: "旧回答" }] },
  ]);
  for (const invalid of [null, "{", '{"page":-1,"content":[]}', '{"page":1,"content":[null]}', '{"page":1,"content":[{"type":"image","media_type":"text/html","data":"bad"}]}']) {
    assert.equal(parseMessageSource(invalid), undefined);
  }
});
