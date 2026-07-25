import { useRef, useState } from "react";

// Drag handle between a docked side panel and the canvas.
//
// `side` says which panel the handle belongs to, which is what decides the sign
// of the drag: the left sidebar grows as the pointer moves right, the right
// panel grows as it moves left. Width is reported in px; `null` (via
// onReset, bound to double-click) hands the panel back to its fluid clamp().
export default function Resizer({
  side, width, min, max, onResize, onReset,
}: {
  side: "left" | "right";
  width: number | null;      // current px width, or null while fluid
  min: number;
  max: number;
  onResize: (w: number) => void;
  onReset: () => void;
}) {
  const [dragging, setDragging] = useState(false);
  const start = useRef({ x: 0, w: 0 });

  function onPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    const el = e.currentTarget;
    // A fluid panel has no px width yet — measure the neighbour we're resizing.
    const panel = side === "left" ? el.previousElementSibling : el.nextElementSibling;
    const w = width ?? (panel as HTMLElement | null)?.getBoundingClientRect().width ?? min;
    start.current = { x: e.clientX, w };
    el.setPointerCapture(e.pointerId);
    setDragging(true);
  }

  function onPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (!dragging) return;
    const dx = e.clientX - start.current.x;
    const raw = start.current.w + (side === "left" ? dx : -dx);
    onResize(Math.round(Math.min(max, Math.max(min, raw))));
  }

  function onPointerUp(e: React.PointerEvent<HTMLDivElement>) {
    if (!dragging) return;
    e.currentTarget.releasePointerCapture(e.pointerId);
    setDragging(false);
  }

  return (
    <div
      className={`resizer${dragging ? " dragging" : ""}`}
      role="separator"
      aria-orientation="vertical"
      title="Потяните, чтобы изменить ширину · двойной клик — сбросить"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onDoubleClick={onReset}
    />
  );
}
