import { onBackButtonPress } from "@tauri-apps/api/app";
import { invoke } from "@tauri-apps/api/core";
import type { DrawerController } from "./drawers";
import type { KnowledgeDrawerController } from "./knowledge-drawers";

export function closeMobilePage(drawers: DrawerController, knowledge: KnowledgeDrawerController): boolean {
  const visible = (element: HTMLElement | null): element is HTMLElement => Boolean(element &&
    !element.closest('[hidden], [aria-hidden="true"], dialog:not([open])') && element.getClientRects().length);
  const click = (id: string): void => { document.getElementById(id)?.click(); };
  const lookup = document.getElementById("lookup-dialog");
  const confirmation = document.querySelector<HTMLDialogElement>(".reader-tool-confirm[open]");
  if (confirmation) { confirmation.dispatchEvent(new Event("cancel", { cancelable: true })); return true; }
  if (visible(lookup)) { click("lookup-close"); return true; }
  for (const menu of document.querySelectorAll<HTMLElement>(".thread-delete-confirmation")) {
    if (!visible(menu)) continue;
    [...menu.querySelectorAll("button")].find(button => button.textContent === "取消")?.click();
    return true;
  }
  for (const id of ["knowledge-context-menu", "note-command-menu", "margin-note-commands", "selection-actions"]) {
    const menu = document.getElementById(id);
    if (visible(menu)) { menu.hidden = true; return true; }
  }
  if (visible(document.getElementById("knowledge-panel"))) {
    if (visible(document.getElementById("knowledge-detail-drawer")) || visible(document.getElementById("knowledge-left-drawer"))) knowledge.closeAll();
    else click("knowledge-close");
    return true;
  }
  if (visible(document.getElementById("library-panel"))) { click("library-close"); return true; }
  if (visible(document.getElementById("settings-panel"))) { drawers.closeSettings(); return true; }
  const history = document.getElementById("thread-list");
  if (visible(history)) {
    history.hidden = true;
    document.getElementById("thread-history")?.setAttribute("aria-expanded", "false");
    return true;
  }
  if (visible(document.getElementById("margin-note-editor"))) { click("margin-note-back"); return true; }
  if (visible(document.getElementById("annotation-drawer"))) { click("annotation-close"); return true; }
  if (visible(document.getElementById("chapter-drawer"))) { click("chapter-close"); return true; }
  if (visible(document.getElementById("left-drawer"))) { click("left-drawer-close"); return true; }
  if (document.documentElement.classList.contains("reading-controls-visible")) {
    document.documentElement.classList.remove("reading-controls-visible");
    return true;
  }
  if (window.getSelection()?.toString()) { window.getSelection()?.removeAllRanges(); return true; }
  return false;
}

export async function setupMobileBack(
  drawers: DrawerController,
  knowledge: KnowledgeDrawerController,
  flush: () => Promise<void>,
  showError: (error: unknown) => void,
): Promise<void> {
  let leaving = false;
  const back = async (): Promise<void> => {
    if (leaving || closeMobilePage(drawers, knowledge)) return;
    leaving = true;
    try { await flush(); await invoke("background_app"); }
    catch (error) { showError(error); }
    finally { leaving = false; }
  };
  await onBackButtonPress(() => { void back(); });
  window.addEventListener("keydown", event => {
    if (event.key !== "Escape") return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (!event.repeat) closeMobilePage(drawers, knowledge);
  }, true);
}
