import { invoke } from "@tauri-apps/api/core";
import type { DrawerController } from "./drawers";
import { readingGesture, swipeEdge } from "../touch-gesture";

export function setupTouchReader(reader: HTMLElement, drawers: DrawerController): void {
  const root = document.documentElement;
  const coarse = window.matchMedia("(pointer: coarse)");
  const enabled = (): boolean => coarse.matches || root.classList.contains("platform-mobile");
  const settings = document.getElementById("touch-settings")!;
  const edgeInput = document.getElementById("swipe-edge") as HTMLInputElement;
  const edgeValue = document.getElementById("swipe-edge-value")!;
  const hiddenInput = document.getElementById("hide-status-bar") as HTMLInputElement;
  let edge = swipeEdge(Number(localStorage.getItem("swipe-edge") ?? 32));
  let start: { x: number; y: number; time: number; moved: number } | undefined;
  const updateMode = (): void => {
    root.classList.toggle("touch-reader", enabled());
    settings.hidden = !enabled();
  };
  updateMode();
  coarse.addEventListener("change", updateMode);
  window.addEventListener("reader-platform-ready", updateMode);
  const renderEdge = (): void => {
    edgeInput.value = String(edge);
    edgeValue.textContent = `${edge} px`;
  };
  renderEdge();
  edgeInput.addEventListener("input", () => {
    edge = swipeEdge(edgeInput.valueAsNumber);
    localStorage.setItem("swipe-edge", String(edge));
    renderEdge();
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
    if (!enabled() || event.touches.length !== 1 || excluded(event.target) || reader.classList.contains("is-capturing")) return;
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
      if (action === "left") drawers.toggleLeft();
      else drawers.openAnnotation();
    }
  }, { passive: true });
}
