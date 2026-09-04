type SlashMatch = { start: number; query: string };

type NoteCommand = {
  id: string;
  label: string;
  description: string;
  keywords: string;
  markdown: string;
};

const commands: NoteCommand[] = [
  { id: "text", label: "正文", description: "普通段落", keywords: "text plain 正文 段落", markdown: "" },
  { id: "h1", label: "一级标题", description: "主要章节", keywords: "h1 heading 标题 一级", markdown: "# " },
  { id: "h2", label: "二级标题", description: "章节分组", keywords: "h2 heading 标题 二级", markdown: "## " },
  { id: "h3", label: "三级标题", description: "小节标题", keywords: "h3 heading 标题 三级", markdown: "### " },
  { id: "bullet", label: "项目列表", description: "无序条目", keywords: "bullet list 列表 项目", markdown: "- " },
  { id: "number", label: "编号列表", description: "有序条目", keywords: "number list 编号 有序", markdown: "1. " },
  { id: "todo", label: "待办事项", description: "可勾选条目", keywords: "todo checkbox 待办", markdown: "- [ ] " },
  { id: "quote", label: "引用", description: "摘录或重点", keywords: "quote 引用 摘录", markdown: "> " },
  { id: "divider", label: "分割线", description: "分隔内容", keywords: "divider 分割线", markdown: "---\n" },
];

export function noteSlashMatch(value: string, cursor: number): SlashMatch | undefined {
  const start = value.lastIndexOf("\n", Math.max(0, cursor - 1)) + 1;
  const match = value.slice(start, cursor).match(/^\/([^\s/]*)$/);
  return match ? { start, query: match[1].toLowerCase() } : undefined;
}

export function applyNoteCommand(value: string, cursor: number, markdown: string): { value: string; cursor: number } {
  const match = noteSlashMatch(value, cursor);
  if (!match) return { value, cursor };
  const next = value.slice(0, match.start) + markdown + value.slice(cursor);
  return { value: next, cursor: match.start + markdown.length };
}

export function setupNoteEditor(input: HTMLTextAreaElement, menu: HTMLElement): void {
  let visible: NoteCommand[] = [];
  let activeIndex = 0;

  const close = (): void => {
    menu.hidden = true;
    input.setAttribute("aria-expanded", "false");
    input.removeAttribute("aria-activedescendant");
  };
  const choose = (command: NoteCommand): void => {
    const result = applyNoteCommand(input.value, input.selectionStart, command.markdown);
    input.value = result.value;
    input.setSelectionRange(result.cursor, result.cursor);
    close();
    input.focus({ preventScroll: true });
    input.dispatchEvent(new Event("input", { bubbles: true }));
  };
  const render = (): void => {
    const match = noteSlashMatch(input.value, input.selectionStart);
    if (!match) return close();
    visible = commands.filter((command) => command.keywords.includes(match.query));
    if (!visible.length) return close();
    activeIndex = Math.min(activeIndex, visible.length - 1);
    menu.replaceChildren();
    visible.forEach((command, index) => {
      const button = document.createElement("button");
      button.id = `note-command-${command.id}`;
      button.type = "button";
      button.role = "option";
      button.setAttribute("aria-selected", String(index === activeIndex));
      button.innerHTML = `<strong>${command.label}</strong><small>${command.description}</small>`;
      button.addEventListener("pointerdown", (event) => event.preventDefault());
      button.addEventListener("click", () => choose(command));
      menu.append(button);
    });
    menu.hidden = false;
    input.setAttribute("aria-expanded", "true");
    input.setAttribute("aria-activedescendant", `note-command-${visible[activeIndex].id}`);
    menu.children[activeIndex]?.scrollIntoView({ block: "nearest" });
  };

  input.addEventListener("input", () => {
    activeIndex = 0;
    render();
  });
  input.addEventListener("click", render);
  input.addEventListener("keydown", (event) => {
    if (event.isComposing || menu.hidden) return;
    if (event.key === "Escape") {
      event.preventDefault();
      close();
      return;
    }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      activeIndex = (activeIndex + (event.key === "ArrowDown" ? 1 : visible.length - 1)) % visible.length;
      render();
      return;
    }
    if (event.key === "Enter" || event.key === "Tab") {
      event.preventDefault();
      choose(visible[activeIndex]);
    }
  });
  input.addEventListener("blur", () => window.setTimeout(close));
}
