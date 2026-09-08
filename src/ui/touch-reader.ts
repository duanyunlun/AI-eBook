import { invoke } from "@tauri-apps/api/core";
import type { DrawerController } from "./drawers";
import { readingGesture, swipeEdge } from "../touch-gesture";
import "../mobile.css";

export function setupTouchReader(reader: HTMLElement, drawers: DrawerController): void {
  const root = document.documentElement;
  const settings = document.getElementById("touch-settings")!;
  const edgeInput = document.getElementById("swipe-edge") as HTMLInputElement;
  const edgeValue = document.getElementById("swipe-edge-value")!;
  const hiddenInput = document.getElementById("hide-status-bar") as HTMLInputElement;
  let edge = swipeEdge(Number(localStorage.getItem("swipe-edge") ?? 32));
  let start: { x: number; y: number; time: number; moved: number } | undefined;
  root.classList.add("touch-reader");
  settings.hidden = false;
  const preview = document.createElement("div");
  preview.className = "swipe-edge-preview";
  preview.hidden = true;
  preview.setAttribute("aria-hidden", "true");
  preview.innerHTML = '<span>滑动禁区</span><span>滑动禁区</span>';
  document.body.append(preview);
  let previewTimer = 0;
  let draggingEdge = false;
  const showPreview = (): void => {
    clearTimeout(previewTimer);
    preview.style.setProperty("--swipe-edge-width", `${edge}px`);
    preview.hidden = false;
  };
  const hidePreview = (): void => { if (!draggingEdge) previewTimer = window.setTimeout(() => { preview.hidden = true; }, 600); };
  edgeInput.addEventListener("pointerdown", () => { draggingEdge = true; showPreview(); });
  edgeInput.addEventListener("focus", showPreview);
  edgeInput.addEventListener("blur", () => { preview.hidden = true; });
  const finishPreview = (): void => { draggingEdge = false; hidePreview(); };
  window.addEventListener("pointerup", finishPreview);
  window.addEventListener("pointercancel", finishPreview);
  new MutationObserver(() => { if (settings.closest('[aria-hidden="true"]')) preview.hidden = true; })
    .observe(document.getElementById("settings-panel")!, { attributes: true, attributeFilter: ["aria-hidden"] });
  const renderEdge = (): void => {
    edgeInput.value = String(edge);
    edgeValue.textContent = `${edge} px`;
  };
  renderEdge();
  edgeInput.addEventListener("input", () => {
    edge = swipeEdge(edgeInput.valueAsNumber);
    localStorage.setItem("swipe-edge", String(edge));
    renderEdge();
    showPreview();
    hidePreview();
  });
  hiddenInput.checked = localStorage.getItem("hide-status-bar") === "true";
  hiddenInput.addEventListener("change", async () => {
    hiddenInput.disabled = true;
    try {
      await invoke("set_status_bar", { hidden: hiddenInput.checked });
      localStorage.setItem("hide-status-bar", String(hiddenInput.checked));
    } catch {
      hiddenInput.checked = !hiddenInput.checked;
      edgeValue.textContent = "状态栏设置失败，请重试";
    } finally {
      hiddenInput.disabled = false;
    }
  });
  const excluded = (target: EventTarget | null): boolean => target instanceof Element && Boolean(target.closest("button, a, input, textarea, select, [contenteditable], .margin-note-mark, .margin-note-highlight"));
  reader.addEventListener("touchstart", (event) => {
    start = undefined;
    if (event.touches.length !== 1 || excluded(event.target) || reader.classList.contains("is-capturing")) return;
    const touch = event.touches[0];
    const viewport = window.visualViewport;
    const visibleX = touch.clientX - (viewport?.offsetLeft ?? 0);
    if (visibleX < edge || visibleX > (viewport?.width ?? window.innerWidth) - edge) return;
    start = { x: touch.clientX, y: touch.clientY, time: performance.now(), moved: 0 };
  }, { passive: true });
  reader.addEventListener("touchmove", (event) => {
    if (!start) return;
    if (event.touches.length !== 1 || window.getSelection()?.toString() || performance.now() - start.time > 600) {
      start = undefined;
      return;
    }
    const dx = event.touches[0].clientX - start.x;
    const dy = event.touches[0].clientY - start.y;
    start.moved = Math.max(start.moved, Math.hypot(dx, dy));
    if (Math.abs(dy) > 12 && Math.abs(dy) >= Math.abs(dx)) { start = undefined; return; }
    if (Math.abs(dx) > 12 && Math.abs(dx) > Math.abs(dy) * 2 && event.cancelable) event.preventDefault();
  }, { passive: false });
  reader.addEventListener("touchcancel", () => { start = undefined; });
  reader.addEventListener("touchend", (event) => {
    const initial = start;
    start = undefined;
    if (!initial || event.touches.length || !event.changedTouches.length || window.getSelection()?.toString()) return;
    const touch = event.changedTouches[0];
    const action = readingGesture(touch.clientX - initial.x, touch.clientY - initial.y, performance.now() - initial.time);
    if (action === "tap" && initial.moved < 10) root.classList.toggle("reading-controls-visible");
    if (action === "left" || action === "right") {
      root.classList.remove("reading-controls-visible");
      if (action === "right") drawers.toggleLeft();
      else drawers.openAnnotation();
    }
  }, { passive: true });
}
