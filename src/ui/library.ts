import { importBook, listBooks, removeBook, renameBook, type BookRecord } from "../api";

type LibraryElements = {
  openLibrary: HTMLButtonElement;
  libraryPanel: HTMLElement;
  libraryList: HTMLElement;
  libraryImport: HTMLButtonElement;
  libraryClose: HTMLButtonElement;
};

export type LibraryController = {
  initialize: () => Promise<void>;
  importAndOpen: () => Promise<void>;
  refresh: () => Promise<void>;
};

export function setupLibrary(
  elements: LibraryElements,
  closeDrawers: () => void,
  onOpenBook: (book: BookRecord) => Promise<void>,
  currentBookId: () => string | undefined,
  onError: (error: unknown) => void,
): LibraryController {
  let books: BookRecord[] = [];

  const render = (): void => {
    elements.libraryList.replaceChildren();
    if (!books.length) {
      const empty = document.createElement("p");
      empty.className = "collection-empty";
      empty.textContent = "书库为空";
      elements.libraryList.append(empty);
      return;
    }
    for (const book of books) {
      const row = document.createElement("article");
      row.className = "library-row";
      if (book.id === currentBookId()) row.dataset.current = "true";
      const open = document.createElement("button");
      open.className = "library-open";
      open.type = "button";
      const title = document.createElement("strong");
      title.textContent = book.title;
      const meta = document.createElement("span");
      meta.textContent = `${book.format.toUpperCase()} · 第 ${book.lastPage} ${book.format === "pdf" ? "页" : "章"}`;
      open.append(title, meta);
      open.addEventListener("click", () => {
        elements.libraryPanel.hidden = true;
        void onOpenBook(book).catch(onError);
      });
      const rename = document.createElement("button");
      rename.className = "icon-command library-rename";
      rename.type = "button";
      rename.textContent = "✎";
      rename.title = "修改书名";
      rename.setAttribute("aria-label", `修改《${book.title}》的书名`);
      rename.addEventListener("click", () => {
        const form = document.createElement("form");
        form.className = "library-rename-form";
        const input = document.createElement("input");
        input.type = "text";
        input.value = book.title;
        input.maxLength = 200;
        input.setAttribute("aria-label", "新书名");
        const save = document.createElement("button");
        save.className = "primary-command";
        save.type = "submit";
        save.textContent = "保存";
        form.append(input, save);
        row.replaceChild(form, open);
        rename.hidden = true;
        input.focus();
        input.select();
        input.addEventListener("keydown", (event) => {
          if (event.key === "Escape") render();
        });
        form.addEventListener("submit", async (event) => {
          event.preventDefault();
          save.disabled = true;
          try {
            const renamed = await renameBook(book.id, input.value);
            if (book.id === currentBookId()) await onOpenBook(renamed);
            await refresh();
          } catch (error) {
            save.disabled = false;
            onError(error);
          }
        });
      });
      const remove = document.createElement("button");
      remove.className = "icon-command library-remove";
      remove.type = "button";
      remove.textContent = "×";
      remove.title = "移出书库";
      remove.setAttribute("aria-label", `将《${book.title}》移出书库`);
      let removeArmed = false;
      remove.addEventListener("click", () => {
        if (!removeArmed) {
          removeArmed = true;
          remove.dataset.armed = "true";
          remove.textContent = "✓";
          remove.title = "再次点击确认移出";
          remove.setAttribute("aria-label", `确认将《${book.title}》移出书库`);
          return;
        }
        void removeBook(book.id).then(refresh).catch(onError);
      });
      remove.addEventListener("blur", () => {
        removeArmed = false;
        delete remove.dataset.armed;
        remove.textContent = "×";
        remove.title = "移出书库";
        remove.setAttribute("aria-label", `将《${book.title}》移出书库`);
      });
      row.append(open, rename, remove);
      elements.libraryList.append(row);
    }
  };

  const refresh = async (): Promise<void> => {
    books = await listBooks();
    render();
  };
  const importAndOpen = async (): Promise<void> => {
    closeDrawers();
    const book = await importBook();
    if (!book) return;
    await refresh();
    elements.libraryPanel.hidden = true;
    await onOpenBook(book);
  };

  elements.openLibrary.addEventListener("click", () => {
    closeDrawers();
    elements.libraryPanel.hidden = false;
    void refresh();
  });
  elements.libraryClose.addEventListener("click", () => {
    elements.libraryPanel.hidden = true;
  });
  elements.libraryImport.addEventListener("click", () => void importAndOpen().catch(onError));

  return {
    refresh,
    importAndOpen,
    initialize: async () => {
      await refresh();
      if (books[0]) await onOpenBook(books[0]);
    },
  };
}
