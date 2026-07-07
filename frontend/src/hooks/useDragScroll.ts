import { useEffect, useRef } from "react";

/**
 * Grab-to-pan for a scrollable element (a "hand tool"): click and drag empty
 * space to scroll the timeline left/right (and up/down). Mousedowns on
 * interactive or draggable children are ignored so it never fights buttons,
 * inputs, links, or drag-and-drop cards (dnd-kit marks draggables role="button").
 * Mouse-only; touch devices already pan natively.
 */
export function useDragScroll<T extends HTMLElement>() {
  const ref = useRef<T>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    let panning = false;
    let startX = 0;
    let startY = 0;
    let startLeft = 0;
    let startTop = 0;

    const isInteractive = (target: EventTarget | null): boolean =>
      target instanceof Element &&
      target.closest(
        'button, a, input, select, textarea, [role="button"], [data-no-pan]',
      ) !== null;

    const onMouseDown = (e: MouseEvent) => {
      if (e.button !== 0 || isInteractive(e.target)) return;
      panning = true;
      startX = e.clientX;
      startY = e.clientY;
      startLeft = el.scrollLeft;
      startTop = el.scrollTop;
      el.style.cursor = "grabbing";
      el.style.userSelect = "none";
    };
    const onMouseMove = (e: MouseEvent) => {
      if (!panning) return;
      el.scrollLeft = startLeft - (e.clientX - startX);
      el.scrollTop = startTop - (e.clientY - startY);
    };
    const onMouseUp = () => {
      if (!panning) return;
      panning = false;
      el.style.cursor = "";
      el.style.userSelect = "";
    };

    el.addEventListener("mousedown", onMouseDown);
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    return () => {
      el.removeEventListener("mousedown", onMouseDown);
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };
  }, []);

  return ref;
}
