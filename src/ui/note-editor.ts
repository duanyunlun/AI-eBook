import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { Markdown } from "@tiptap/markdown";
import { TaskItem, TaskList } from "@tiptap/extension-list";
import { EditorState } from "@tiptap/pm/state";
import DOMPurify from "dompurify";

type SlashMatch = { start: number; query: string };

export type NoteEditorController = {
  getMarkdown(): string;
  setMarkdown(markdown: string): void;
  clear(): void;
  focus(): void;
};

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

export function setupNoteEditor(host: HTMLElement, menu: HTMLElement): NoteEditorController {
  let visible: NoteCommand[] = [];
  let activeIndex = 0;
  let composing = false;
  menu.id ||= `note-command-menu-${crypto.randomUUID()}`;
  menu.setAttribute("role", "listbox");

  const close = (): void => {
    menu.hidden = true;
    const input = editor.view.dom;
    input.setAttribute("aria-expanded", "false");
    input.removeAttribute("aria-activedescendant");
  };
  const slash = (): (SlashMatch & { end: number }) | undefined => {
    const { empty, $from } = editor.state.selection;
    if (!empty || !$from.parent.isTextblock) return;
    const text = $from.parent.textBetween(0, $from.parentOffset, "\n", "\ufffc");
    const match = noteSlashMatch(text, text.length);
    return match ? { start: $from.start() + match.start, end: $from.pos, query: match.query } : undefined;
  };
  const choose = (command: NoteCommand): void => {
    if (composing || editor.view.composing) return;
    const match = slash();
    if (!match) return close();
    const chain = editor.chain().focus(undefined, { scrollIntoView: false })
      .deleteRange({ from: match.start, to: match.end }).clearNodes();
    switch (command.id) {
      case "h1": chain.setHeading({ level: 1 }); break;
      case "h2": chain.setHeading({ level: 2 }); break;
      case "h3": chain.setHeading({ level: 3 }); break;
      case "bullet": chain.toggleBulletList(); break;
      case "number": chain.toggleOrderedList(); break;
      case "todo": chain.toggleTaskList(); break;
      case "quote": chain.setBlockquote(); break;
      case "divider": chain.setHorizontalRule(); break;
      default: chain.setParagraph();
    }
    chain.run();
    close();
  };
  const render = (): void => {
    if (!editor.view.hasFocus() || composing || editor.view.composing) return;
    const input = editor.view.dom;
    const match = slash();
    if (!match) return close();
    visible = commands.filter((command) => command.keywords.includes(match.query));
    if (!visible.length) return close();
    activeIndex = Math.min(activeIndex, visible.length - 1);
    menu.replaceChildren();
    visible.forEach((command, index) => {
      const button = document.createElement("button");
      button.id = `${menu.id}-${command.id}`;
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
    input.setAttribute("aria-activedescendant", `${menu.id}-${visible[activeIndex].id}`);
    menu.children[activeIndex]?.scrollIntoView({ block: "nearest" });
  };

  const syncDirty = (): void => {
    host.dataset.noteDirty = String(!editor.isEmpty);
  };
  const editor: Editor = new Editor({
    element: host,
    content: "",
    contentType: "markdown",
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
        underline: false,
        trailingNode: false,
        link: { openOnClick: false },
      }),
      TaskList,
      TaskItem.configure({ nested: true, a11y: { checkboxLabel: (node) => `待办事项：${node.textContent || "未命名"}` } }),
      Markdown.configure({ markedOptions: { breaks: true } }),
    ],
    editorProps: {
      attributes: {
        role: "textbox",
        "aria-label": "记录正文",
        "aria-multiline": "true",
        "aria-controls": menu.id,
        "aria-haspopup": "listbox",
        "aria-expanded": "false",
      },
      transformPastedHTML: (html) => DOMPurify.sanitize(html, {
        ALLOWED_TAGS: ["p", "h1", "h2", "h3", "ul", "ol", "li", "blockquote", "hr", "br", "strong", "b", "em", "i", "s", "del", "pre", "code", "a", "input", "label", "div", "span"],
        ALLOWED_ATTR: ["href", "title", "start", "type", "checked", "data-type", "data-checked"],
        ALLOW_DATA_ATTR: false,
        ALLOW_ARIA_ATTR: false,
      }),
      handlePaste: (view, event): boolean => {
        if (view.state.selection.$from.parent.type.spec.code || event.clipboardData?.getData("text/html")) return false;
        const text = event.clipboardData?.getData("text/plain");
        if (!text) return false;
        return editor.commands.insertContent(text, { contentType: "markdown" });
      },
      handleDOMEvents: {
        compositionstart: () => { composing = true; return false; },
        compositionend: () => {
          composing = false;
          window.setTimeout(render);
          return false;
        },
        keydown: (view, event) => {
          if (event.isComposing || composing || view.composing || event.keyCode === 229) return true;
          if (menu.hidden || !visible.length || event.ctrlKey || event.metaKey || event.altKey) return false;
          if (event.key === "Escape") {
            event.preventDefault();
            close();
            return true;
          }
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            activeIndex = (activeIndex + (event.key === "ArrowDown" ? 1 : visible.length - 1)) % visible.length;
            render();
            return true;
          }
          if (event.key === "Enter" || event.key === "Tab") {
            event.preventDefault();
            choose(visible[activeIndex]);
            return true;
          }
          return false;
        },
      },
    },
    onUpdate: () => {
      syncDirty();
      activeIndex = 0;
      render();
      host.dispatchEvent(new Event("input", { bubbles: true }));
    },
    onSelectionUpdate: render,
    onFocus: render,
    onBlur: close,
  });
  const setMarkdown = (markdown: string): void => {
    editor.commands.setContent(markdown, { contentType: "markdown", emitUpdate: false });
    editor.view.updateState(EditorState.create({
      schema: editor.schema,
      doc: editor.state.doc,
      plugins: editor.state.plugins,
    }));
    syncDirty();
    close();
  };
  syncDirty();
  close();
  return {
    getMarkdown: () => editor.isEmpty ? "" : editor.getMarkdown(),
    setMarkdown,
    clear: () => setMarkdown(""),
    focus: () => { editor.commands.focus(undefined, { scrollIntoView: false }); },
  };
}
