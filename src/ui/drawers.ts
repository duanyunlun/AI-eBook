type DrawerElements = {
  leftDrawer: HTMLElement;
  leftDrawerToggle: HTMLButtonElement;
  settingsPanel: HTMLElement;
  annotationDrawer: HTMLElement;
  annotationToggle: HTMLButtonElement;
  reader: HTMLElement;
};

export type DrawerController = {
  closeAll: () => void;
  openAnnotation: () => void;
  toggleAnnotation: () => void;
  toggleLeft: () => void;
  openSettings: () => void;
  closeSettings: () => void;
};

export function setupDrawers(elements: DrawerElements): DrawerController {
  let leftTimer = 0;
  let annotationTimer = 0;

  const clearTimers = (): void => {
    window.clearTimeout(leftTimer);
    window.clearTimeout(annotationTimer);
  };
  const setSettingsOpen = (open: boolean): void => {
    elements.settingsPanel.setAttribute("aria-hidden", String(!open));
    elements.settingsPanel.inert = !open;
  };
  const setLeftOpen = (open: boolean): void => {
    elements.leftDrawer.setAttribute("aria-hidden", String(!open));
    elements.leftDrawerToggle.hidden = open;
    elements.leftDrawerToggle.setAttribute("aria-expanded", String(open));
    elements.leftDrawerToggle.setAttribute("aria-label", open ? "关闭主菜单" : "打开主菜单");
    if (!open) setSettingsOpen(false);
  };
  const setAnnotationOpen = (open: boolean): void => {
    if (!open && elements.annotationDrawer.contains(document.activeElement) && document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
    elements.annotationDrawer.setAttribute("aria-hidden", String(!open));
    elements.annotationToggle.hidden = open;
    elements.annotationToggle.setAttribute("aria-expanded", String(open));
    elements.annotationToggle.setAttribute("aria-label", open ? "收起批注" : "展开批注");
  };
  const closeAll = (): void => {
    clearTimers();
    setLeftOpen(false);
    setAnnotationOpen(false);
  };
  const annotationLocked = (): boolean =>
    (elements.annotationDrawer.dataset.mode === "annotation" && elements.annotationDrawer.dataset.pinned === "true") ||
    elements.annotationDrawer.getAttribute("aria-busy") === "true" ||
    elements.annotationDrawer.contains(document.activeElement) ||
    Boolean(elements.annotationDrawer.querySelector('[data-note-dirty="true"]')) ||
    [...elements.annotationDrawer.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>("input, textarea")].some(
      (input) => input.value.trim(),
    );
  const openLeftSoon = (): void => {
    if (window.matchMedia("(hover: none)").matches) return;
    window.clearTimeout(leftTimer);
    leftTimer = window.setTimeout(() => {
      setAnnotationOpen(false);
      setLeftOpen(true);
    }, 150);
  };
  const openAnnotationSoon = (): void => {
    if (window.matchMedia("(hover: none)").matches) return;
    window.clearTimeout(annotationTimer);
    annotationTimer = window.setTimeout(() => {
      setLeftOpen(false);
      setAnnotationOpen(true);
    }, 150);
  };
  const closeLeftSoon = (): void => {
    if (window.matchMedia("(hover: none)").matches) return;
    window.clearTimeout(leftTimer);
    leftTimer = window.setTimeout(() => {
      if (elements.settingsPanel.getAttribute("aria-hidden") === "true") setLeftOpen(false);
    }, 300);
  };
  const closeAnnotationSoon = (): void => {
    if (window.matchMedia("(hover: none)").matches) return;
    window.clearTimeout(annotationTimer);
    annotationTimer = window.setTimeout(() => {
      if (!annotationLocked()) setAnnotationOpen(false);
    }, 300);
  };

  document.getElementById("left-drawer-close")?.addEventListener("click", () => setLeftOpen(false));
  document.getElementById("annotation-close")?.addEventListener("click", () => setAnnotationOpen(false));
  elements.leftDrawerToggle.addEventListener("click", () => {
    clearTimers();
    setAnnotationOpen(false);
    setLeftOpen(true);
  });
  elements.annotationToggle.addEventListener("click", () => {
    clearTimers();
    setLeftOpen(false);
    setAnnotationOpen(true);
  });
  elements.leftDrawerToggle.addEventListener("pointerenter", openLeftSoon);
  elements.leftDrawerToggle.addEventListener("pointerleave", closeLeftSoon);
  elements.leftDrawer.addEventListener("pointerenter", () => window.clearTimeout(leftTimer));
  elements.leftDrawer.addEventListener("pointerleave", closeLeftSoon);
  elements.settingsPanel.addEventListener("pointerenter", () => window.clearTimeout(leftTimer));
  elements.annotationToggle.addEventListener("pointerenter", openAnnotationSoon);
  elements.annotationToggle.addEventListener("pointerleave", closeAnnotationSoon);
  elements.annotationDrawer.addEventListener("pointerenter", () => window.clearTimeout(annotationTimer));
  elements.annotationDrawer.addEventListener("pointerleave", closeAnnotationSoon);
  elements.reader.addEventListener("pointerdown", (event) => {
    if ((event.target as Element).closest(".margin-note-mark, .margin-note-highlight")) return;
    clearTimers();
    setLeftOpen(false);
    if (!annotationLocked()) setAnnotationOpen(false);
  });
  window.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeAll();
  });

  return {
    closeAll,
    openAnnotation: () => {
      clearTimers();
      setLeftOpen(false);
      setAnnotationOpen(true);
    },
    toggleAnnotation: () => {
      clearTimers();
      const open = elements.annotationDrawer.getAttribute("aria-hidden") === "true";
      setLeftOpen(false);
      setAnnotationOpen(open);
    },
    toggleLeft: () => {
      clearTimers();
      const open = elements.leftDrawer.getAttribute("aria-hidden") === "true";
      setAnnotationOpen(false);
      setLeftOpen(open);
    },
    openSettings: () => {
      clearTimers();
      setAnnotationOpen(false);
      setLeftOpen(true);
      setSettingsOpen(true);
    },
    closeSettings: () => setSettingsOpen(false),
  };
}
