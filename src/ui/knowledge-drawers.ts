type KnowledgeDrawerElements = {
  knowledgePanel: HTMLElement;
  knowledgeLeftDrawer: HTMLElement;
  knowledgeLeftTrigger: HTMLButtonElement;
  knowledgeGraph: SVGSVGElement;
  knowledgeDetailDrawer: HTMLElement;
  knowledgeDetailTrigger: HTMLButtonElement;
};

export type KnowledgeDrawerController = {
  closeAll: () => void;
  openDetail: () => void;
};

export function setupKnowledgeDrawers(
  elements: KnowledgeDrawerElements,
): KnowledgeDrawerController {
  let leftTimer = 0;
  let rightTimer = 0;

  const setOpen = (
    drawer: HTMLElement,
    trigger: HTMLButtonElement,
    open: boolean,
  ): void => {
    if (!open && drawer.contains(document.activeElement) && document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
    drawer.setAttribute("aria-hidden", String(!open));
    drawer.inert = !open;
    trigger.hidden = open;
    trigger.setAttribute("aria-expanded", String(open));
  };
  const openLeft = (): void => {
    window.clearTimeout(leftTimer);
    setOpen(elements.knowledgeDetailDrawer, elements.knowledgeDetailTrigger, false);
    setOpen(elements.knowledgeLeftDrawer, elements.knowledgeLeftTrigger, true);
  };
  const openDetail = (): void => {
    window.clearTimeout(rightTimer);
    setOpen(elements.knowledgeLeftDrawer, elements.knowledgeLeftTrigger, false);
    setOpen(elements.knowledgeDetailDrawer, elements.knowledgeDetailTrigger, true);
  };
  const closeAll = (): void => {
    window.clearTimeout(leftTimer);
    window.clearTimeout(rightTimer);
    setOpen(elements.knowledgeLeftDrawer, elements.knowledgeLeftTrigger, false);
    setOpen(elements.knowledgeDetailDrawer, elements.knowledgeDetailTrigger, false);
  };
  const openSoon = (side: "left" | "right"): void => {
    if (window.matchMedia("(hover: none)").matches) return;
    const timer = side === "left" ? leftTimer : rightTimer;
    window.clearTimeout(timer);
    const next = window.setTimeout(side === "left" ? openLeft : openDetail, 150);
    if (side === "left") leftTimer = next;
    else rightTimer = next;
  };
  const closeSoon = (side: "left" | "right"): void => {
    if (window.matchMedia("(hover: none)").matches) return;
    window.clearTimeout(side === "left" ? leftTimer : rightTimer);
    const next = window.setTimeout(() => {
      const drawer = side === "left" ? elements.knowledgeLeftDrawer : elements.knowledgeDetailDrawer;
      const trigger = side === "left" ? elements.knowledgeLeftTrigger : elements.knowledgeDetailTrigger;
      if (drawer.contains(document.activeElement) || document.body.classList.contains("is-resizing-drawer")) return;
      setOpen(drawer, trigger, false);
    }, 300);
    if (side === "left") leftTimer = next;
    else rightTimer = next;
  };

  elements.knowledgeLeftTrigger.addEventListener("click", openLeft);
  elements.knowledgeDetailTrigger.addEventListener("click", openDetail);
  elements.knowledgeLeftTrigger.addEventListener("pointerenter", () => openSoon("left"));
  elements.knowledgeLeftTrigger.addEventListener("pointerleave", () => closeSoon("left"));
  elements.knowledgeDetailTrigger.addEventListener("pointerenter", () => openSoon("right"));
  elements.knowledgeDetailTrigger.addEventListener("pointerleave", () => closeSoon("right"));
  elements.knowledgeLeftDrawer.addEventListener("pointerenter", () => window.clearTimeout(leftTimer));
  elements.knowledgeLeftDrawer.addEventListener("pointerleave", () => closeSoon("left"));
  elements.knowledgeDetailDrawer.addEventListener("pointerenter", () => window.clearTimeout(rightTimer));
  elements.knowledgeDetailDrawer.addEventListener("pointerleave", () => closeSoon("right"));
  elements.knowledgeGraph.addEventListener("pointerdown", () => {
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    closeAll();
  });
  elements.knowledgePanel.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeAll();
  });

  closeAll();
  return { closeAll, openDetail };
}
