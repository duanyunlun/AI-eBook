export function swipeEdge(value: number): number {
  return Number.isFinite(value) ? Math.min(120, Math.max(24, value)) : 32;
}

export function readingGesture(dx: number, dy: number, duration: number): "tap" | "left" | "right" | undefined {
  if (duration > 600) return;
  if (Math.hypot(dx, dy) < 10 && duration < 300) return "tap";
  if (Math.abs(dx) >= 64 && Math.abs(dx) > Math.abs(dy) * 2) return dx < 0 ? "left" : "right";
}
