import assert from "node:assert/strict";
import test from "node:test";
import { applyNoteCommand, noteSlashMatch } from "./ui/note-editor.ts";

test("Slash 命令只匹配当前空白行并替换为 Markdown", () => {
  assert.deepEqual(noteSlashMatch("结论\n/h2", 6), { start: 3, query: "h2" });
  assert.equal(noteSlashMatch("正文 /h2", 6), undefined);
  assert.deepEqual(applyNoteCommand("结论\n/h2", 6, "## "), {
    value: "结论\n## ",
    cursor: 6,
  });
});
