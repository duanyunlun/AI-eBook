const storedWidthKey = "annotation-drawer-width";

export function clampDrawerWidth(width: number, viewportWidth: number, minimum = 240): number {
  const maximum = Math.max(Math.floor(viewportWidth / 2), 1);
  const effectiveMinimum = Math.min(minimum, maximum);
  if (!Number.isFinite(width)) return Math.min(300, maximum);
  return Math.min(Math.max(Math.round(width), effectiveMinimum), maximum);
}

export function setupAnnotationResize(resizer: HTMLElement): void {
  setupRightDrawerResize(resizer, storedWidthKey, "--annotation-drawer-width", 300, 240);
}

export function setupKnowledgeResize(resizer: HTMLElement): void {
  setupRightDrawerResize(resizer, "knowledge-detail-width", "--knowledge-detail-width", 340, 280);
}

function setupRightDrawerResize(
  resizer: HTMLElement,
  storageKey: string,
  cssProperty: string,
  initialWidth: number,
  minimum: number,
): void {
  let width = Number.parseFloat(localStorage.getItem(storageKey) ?? String(initialWidth));
  let pointerId: number | undefined;
  let startX = 0;
  let startWidth = 0;

  const applyWidth = (nextWidth: number, remember = false): void => {
    width = clampDrawerWidth(nextWidth, window.innerWidth, minimum);
    document.documentElement.style.setProperty(cssProperty, `${width}px`);
    const maximum = Math.max(Math.floor(window.innerWidth / 2), 1);
    resizer.setAttribute("aria-valuemin", String(Math.min(minimum, maximum)));
    resizer.setAttribute("aria-valuemax", String(maximum));
    resizer.setAttribute("aria-valuenow", String(width));
    if (remember) localStorage.setItem(storageKey, String(width));
  };

  resizer.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    event.preventDefault();
    window.getSelection()?.removeAllRanges();
    pointerId = event.pointerId;
    startX = event.clientX;
    startWidth = width;
    resizer.setPointerCapture(pointerId);
    document.body.classList.add("is-resizing-drawer");
  });
  resizer.addEventListener("pointermove", (event) => {
    if (event.pointerId !== pointerId) return;
    event.preventDefault();
    applyWidth(startWidth + startX - event.clientX);
  });
  const finishResize = (event: PointerEvent): void => {
    if (event.pointerId !== pointerId) return;
    pointerId = undefined;
    document.body.classList.remove("is-resizing-drawer");
    window.getSelection()?.removeAllRanges();
    applyWidth(width, true);
  };
  resizer.addEventListener("pointerup", finishResize);
  resizer.addEventListener("pointercancel", finishResize);
  resizer.addEventListener("lostpointercapture", finishResize);
  resizer.addEventListener("keydown", (event) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    applyWidth(width + (event.key === "ArrowLeft" ? 20 : -20), true);
  });
  window.addEventListener("resize", () => applyWidth(width));
  applyWidth(width);
}

export function setupQuestionResize(resizer: HTMLElement, input: HTMLTextAreaElement): void {
  let pointerId: number | undefined;
  let startY = 0;
  let startHeight = 0;

  const applyHeight = (height: number): void => {
    input.style.height = `${Math.max(76, Math.round(height))}px`;
  };

  const clearSelection = (): void => {
    const selection = window.getSelection();
    if (selection?.rangeCount) selection.removeAllRanges();
  };

  const finishResize = (): void => {
    if (pointerId === undefined) return;
    pointerId = undefined;
    document.body.classList.remove("is-resizing-question");
    clearSelection();
  };

  resizer.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    clearSelection();
    pointerId = event.pointerId;
    startY = event.clientY;
    startHeight = input.getBoundingClientRect().height;
    resizer.setPointerCapture(pointerId);
    document.body.classList.add("is-resizing-question");
  });
  window.addEventListener("pointermove", (event) => {
    if (event.pointerId !== pointerId) return;
    if ((event.buttons & 1) === 0) {
      finishResize();
      return;
    }
    event.preventDefault();
    clearSelection();
    applyHeight(startHeight + startY - event.clientY);
  });
  window.addEventListener("pointerup", (event) => {
    if (event.pointerId === pointerId) finishResize();
  });
  window.addEventListener("pointercancel", (event) => {
    if (event.pointerId === pointerId) finishResize();
  });
  window.addEventListener("blur", finishResize);
  document.addEventListener("selectstart", (event) => {
    if (pointerId !== undefined) event.preventDefault();
  });
  resizer.addEventListener("keydown", (event) => {
    if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
    event.preventDefault();
    applyHeight(input.getBoundingClientRect().height + (event.key === "ArrowUp" ? 20 : -20));
  });
}
