import type { KnowledgeEdge, KnowledgeItem } from "../api";

type CanvasElements = {
  knowledgeGraph: SVGSVGElement;
  knowledgeZoomOut: HTMLButtonElement;
  knowledgeZoomFit: HTMLButtonElement;
  knowledgeZoomIn: HTMLButtonElement;
  knowledgeZoomLevel: HTMLOutputElement;
};

type BookReference = { id: string; title: string };
type NodePosition = { x: number; y: number; item: KnowledgeItem };

export type KnowledgeCanvasController = {
  render: (items: KnowledgeItem[], edges: KnowledgeEdge[], books: BookReference[]) => void;
  focusItem: (itemId: string) => void;
};

const SVG_NS = "http://www.w3.org/2000/svg";
const NODE_DIAMETER = 58;
const NODE_RADIUS = NODE_DIAMETER / 2;
const colorStorageKey = "knowledge-node-colors";
const nodeColors = ["#4f8f78", "#4f78a8", "#7969a8", "#a06b79", "#a17a43", "#66777b"];
const relationLabels: Record<string, string> = {
  quotes: "引用",
  asks_about: "询问",
  derived_from: "源自",
  summarizes: "总结",
  supports: "支持",
  contradicts: "矛盾",
  related_to: "相关",
  mentioned_in: "提及",
};
const createSvg = <T extends SVGElement>(name: string): T =>
  document.createElementNS(SVG_NS, name) as T;

export const knowledgeNodeLabel = (item: KnowledgeItem): string =>
  Array.from((item.title || item.bodyMd || "知识").replace(/[#*_`>《》“”‘’。，、！？：；\s]/g, "")).slice(0, 2).join("") || "知识";

const groupLabel = (label: string, count: number): string => {
  const characters = Array.from(label);
  return `${characters.length > 14 ? `${characters.slice(0, 14).join("")}…` : label} · ${count}`;
};

const loadColors = (): Record<string, string> => {
  try {
    return JSON.parse(localStorage.getItem(colorStorageKey) ?? "{}") as Record<string, string>;
  } catch {
    return {};
  }
};

export function setupKnowledgeCanvas(
  elements: CanvasElements,
  onItem: (item: KnowledgeItem) => void,
  onEdge: (edge: KnowledgeEdge) => void,
): KnowledgeCanvasController {
  const svg = elements.knowledgeGraph;
  let viewport: SVGGElement | undefined;
  let bounds = { width: 800, height: 520 };
  let scale = 1;
  let offsetX = 0;
  let offsetY = 0;
  let layoutFrame = 0;
  const positions = new Map<string, NodePosition>();
  let pointerId: number | undefined;
  let startX = 0;
  let startY = 0;
  let startOffsetX = 0;
  let startOffsetY = 0;
  const colors = loadColors();
  const workspace = svg.parentElement!;
  const colorMenu = document.createElement("div");
  colorMenu.className = "knowledge-node-colors";
  colorMenu.setAttribute("role", "menu");
  colorMenu.hidden = true;
  workspace.append(colorMenu);

  const hideColorMenu = (): void => {
    colorMenu.hidden = true;
  };
  document.addEventListener("pointerdown", (event) => {
    if (!colorMenu.contains(event.target as Node)) hideColorMenu();
  });

  const applyTransform = (): void => {
    viewport?.setAttribute("transform", `translate(${offsetX} ${offsetY}) scale(${scale})`);
    svg.dataset.detail = String(scale >= 0.72);
    elements.knowledgeZoomLevel.textContent = `${Math.round(scale * 100)}%`;
  };

  const zoomAt = (nextScale: number, x: number, y: number): void => {
    const clamped = Math.min(2.4, Math.max(0.28, nextScale));
    const worldX = (x - offsetX) / scale;
    const worldY = (y - offsetY) / scale;
    offsetX = x - worldX * clamped;
    offsetY = y - worldY * clamped;
    scale = clamped;
    applyTransform();
  };

  const fit = (): void => {
    const rect = svg.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    scale = Math.min(1.2, Math.max(0.28, Math.min((rect.width - 96) / bounds.width, (rect.height - 96) / bounds.height)));
    offsetX = (rect.width - bounds.width * scale) / 2;
    offsetY = (rect.height - bounds.height * scale) / 2;
    applyTransform();
  };

  const focusItem = (itemId: string): void => {
    cancelAnimationFrame(layoutFrame);
    layoutFrame = requestAnimationFrame(() => {
      const position = positions.get(itemId);
      const rect = svg.getBoundingClientRect();
      if (!position || !rect.width || !rect.height) return;
      const left = workspace.querySelector<HTMLElement>('.knowledge-left-drawer[aria-hidden="false"]')?.offsetWidth ?? 0;
      const right = workspace.querySelector<HTMLElement>('.knowledge-detail-drawer[aria-hidden="false"]')?.offsetWidth ?? 0;
      offsetX = (rect.width + left - right) / 2 - position.x * scale;
      offsetY = rect.height / 2 - position.y * scale;
      applyTransform();
    });
  };

  svg.addEventListener("wheel", (event) => {
    event.preventDefault();
    const rect = svg.getBoundingClientRect();
    zoomAt(scale * (event.deltaY < 0 ? 1.12 : 0.89), event.clientX - rect.left, event.clientY - rect.top);
  }, { passive: false });
  svg.addEventListener("pointerdown", (event) => {
    if (event.button !== 0 || (event.target as Element).closest(".graph-node, .graph-edge-group")) return;
    event.preventDefault();
    window.getSelection()?.removeAllRanges();
    pointerId = event.pointerId;
    startX = event.clientX;
    startY = event.clientY;
    startOffsetX = offsetX;
    startOffsetY = offsetY;
    svg.setPointerCapture(pointerId);
    svg.classList.add("is-panning");
  });
  svg.addEventListener("pointermove", (event) => {
    if (event.pointerId !== pointerId) return;
    offsetX = startOffsetX + event.clientX - startX;
    offsetY = startOffsetY + event.clientY - startY;
    applyTransform();
  });
  const finishPan = (event: PointerEvent): void => {
    if (event.pointerId !== pointerId) return;
    pointerId = undefined;
    svg.classList.remove("is-panning");
  };
  svg.addEventListener("pointerup", finishPan);
  svg.addEventListener("pointercancel", finishPan);
  elements.knowledgeZoomOut.addEventListener("click", () => {
    const rect = svg.getBoundingClientRect();
    zoomAt(scale / 1.2, rect.width / 2, rect.height / 2);
  });
  elements.knowledgeZoomIn.addEventListener("click", () => {
    const rect = svg.getBoundingClientRect();
    zoomAt(scale * 1.2, rect.width / 2, rect.height / 2);
  });
  elements.knowledgeZoomFit.addEventListener("click", fit);
  svg.addEventListener("dblclick", fit);

  const render = (items: KnowledgeItem[], edges: KnowledgeEdge[], _books: BookReference[]): void => {
    cancelAnimationFrame(layoutFrame);
    positions.clear();
    hideColorMenu();
    svg.replaceChildren();
    svg.removeAttribute("viewBox");
    const definitions = createSvg<SVGDefsElement>("defs");
    definitions.innerHTML = `
      <marker id="knowledge-arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto" markerUnits="strokeWidth">
        <path class="graph-arrow" d="M 0 0 L 8 4 L 0 8 z" />
      </marker>`;
    viewport = createSvg<SVGGElement>("g");
    svg.append(definitions, viewport);

    if (!items.length) {
      bounds = { width: 800, height: 520 };
      applyTransform();
      return;
    }

    const groups = new Map<string, { label: string; items: KnowledgeItem[] }>();
    for (const item of items) {
      const key = item.category
        ? `category:${item.category}`
        : item.bookId
          ? `book:${item.bookId}`
          : "uncategorized";
      const label = item.category || (item.bookId ? "" : "未分类");
      const group = groups.get(key) ?? { label, items: [] };
      group.items.push(item);
      groups.set(key, group);
    }

    let groupX = 48;
    let groupY = 48;
    let rowHeight = 0;
    let maxX = 0;
    let maxY = 0;
    for (const group of groups.values()) {
      const columns = Math.min(3, Math.max(1, Math.ceil(Math.sqrt(group.items.length))));
      const rows = Math.ceil(group.items.length / columns);
      const headingHeight = group.label ? 36 : 0;
      const width = Math.max(210, 32 + columns * NODE_DIAMETER + (columns - 1) * 34);
      const height = 12 + headingHeight + rows * NODE_DIAMETER + (rows - 1) * 34;
      if (groupX > 48 && groupX + width > 1400) {
        groupX = 48;
        groupY += rowHeight + 34;
        rowHeight = 0;
      }
      if (group.label) {
        const heading = createSvg<SVGTextElement>("text");
        heading.setAttribute("x", String(groupX + 16));
        heading.setAttribute("y", String(groupY + 20));
        heading.classList.add("graph-cluster-title");
        heading.textContent = groupLabel(group.label, group.items.length);
        viewport.append(heading);
      }
      group.items.forEach((item, index) => {
        const x = groupX + 16 + NODE_RADIUS + (index % columns) * (NODE_DIAMETER + 34);
        const y = groupY + headingHeight + NODE_RADIUS + Math.floor(index / columns) * (NODE_DIAMETER + 34);
        positions.set(item.id, { x, y, item });
      });
      maxX = Math.max(maxX, groupX + width);
      maxY = Math.max(maxY, groupY + height);
      groupX += width + 34;
      rowHeight = Math.max(rowHeight, height);
    }
    bounds = { width: maxX + 48, height: maxY + 48 };

    for (const edge of edges) {
      const from = positions.get(edge.fromItemId);
      const to = positions.get(edge.toItemId);
      if (!from || !to) continue;
      const group = createSvg<SVGGElement>("g");
      group.classList.add("graph-edge-group");
      group.setAttribute("tabindex", "0");
      group.setAttribute("role", "button");
      group.setAttribute("aria-label", `${from.item.title || "未命名知识"} ${relationLabels[edge.relation] || edge.relation} ${to.item.title || "未命名知识"}`);
      const dx = to.x - from.x;
      const dy = to.y - from.y;
      const distance = Math.hypot(dx, dy) || 1;
      const attributes = {
        x1: from.x + dx / distance * NODE_RADIUS,
        y1: from.y + dy / distance * NODE_RADIUS,
        x2: to.x - dx / distance * NODE_RADIUS,
        y2: to.y - dy / distance * NODE_RADIUS,
      };
      const hit = createSvg<SVGLineElement>("line");
      const line = createSvg<SVGLineElement>("line");
      for (const [name, value] of Object.entries(attributes)) {
        hit.setAttribute(name, String(value));
        line.setAttribute(name, String(value));
      }
      hit.classList.add("graph-edge-hit");
      line.classList.add("graph-edge");
      line.setAttribute("marker-end", "url(#knowledge-arrow)");
      const label = createSvg<SVGTextElement>("text");
      label.setAttribute("x", String((attributes.x1 + attributes.x2) / 2));
      label.setAttribute("y", String((attributes.y1 + attributes.y2) / 2 - 7));
      label.classList.add("graph-edge-label");
      label.textContent = relationLabels[edge.relation] || edge.relation;
      group.append(hit, line, label);
      group.addEventListener("click", () => onEdge(edge));
      group.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onEdge(edge);
        }
      });
      viewport.append(group);
    }

    for (const { x, y, item } of positions.values()) {
      const group = createSvg<SVGGElement>("g");
      group.classList.add("graph-node");
      group.setAttribute("transform", `translate(${x} ${y})`);
      group.setAttribute("tabindex", "0");
      group.setAttribute("role", "button");
      group.setAttribute("aria-label", item.title || "未命名知识");
      const frame = createSvg<SVGCircleElement>("circle");
      frame.setAttribute("r", String(NODE_RADIUS));
      frame.dataset.creator = item.creator;
      if (colors[item.id]) group.style.setProperty("--node-color", colors[item.id]);
      const title = createSvg<SVGTextElement>("text");
      title.classList.add("graph-node-title");
      title.setAttribute("y", "1");
      title.textContent = knowledgeNodeLabel(item);
      group.append(frame, title);
      group.addEventListener("click", () => onItem(item));
      group.addEventListener("contextmenu", (event) => {
        event.preventDefault();
        event.stopPropagation();
        colorMenu.replaceChildren();
        const addColor = (color: string | undefined, label: string): void => {
          const button = document.createElement("button");
          button.type = "button";
          button.title = label;
          button.setAttribute("aria-label", label);
          button.style.setProperty("--swatch", color || "var(--surface)");
          button.addEventListener("click", () => {
            if (color) {
              colors[item.id] = color;
              group.style.setProperty("--node-color", color);
            } else {
              delete colors[item.id];
              group.style.removeProperty("--node-color");
            }
            localStorage.setItem(colorStorageKey, JSON.stringify(colors));
            hideColorMenu();
          });
          colorMenu.append(button);
        };
        addColor(undefined, "恢复默认颜色");
        nodeColors.forEach((color, index) => addColor(color, `填充色 ${index + 1}`));
        const workspaceBounds = workspace.getBoundingClientRect();
        colorMenu.style.left = `${Math.max(4, Math.min(event.clientX - workspaceBounds.left, workspaceBounds.width - 226))}px`;
        colorMenu.style.top = `${Math.max(4, Math.min(event.clientY - workspaceBounds.top, workspaceBounds.height - 48))}px`;
        colorMenu.hidden = false;
      });
      group.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onItem(item);
        }
      });
      viewport.append(group);
    }
    layoutFrame = requestAnimationFrame(fit);
  };

  return { render, focusItem };
}
