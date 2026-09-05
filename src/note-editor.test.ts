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

test("Slash 命令保留光标后的正文并支持中文过滤", () => {
  assert.deepEqual(noteSlashMatch("/标题", 3), { start: 0, query: "标题" });
  assert.deepEqual(noteSlashMatch("/H2", 3), { start: 0, query: "h2" });
  assert.deepEqual(applyNoteCommand("/h2保留", 3, "## "), { value: "## 保留", cursor: 3 });
  for (const value of ["正文 /h2", "//", "/h2 ", "正文"]) {
    assert.equal(noteSlashMatch(value, value.length), undefined);
    assert.deepEqual(applyNoteCommand(value, value.length, "# "), { value, cursor: value.length });
  }
});
