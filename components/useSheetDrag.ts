"use client";

import { useRef } from "react";

// Drag-to-dismiss for the bottom sheets. Attach `sheetRef` to the sheet
// container and spread `handleProps` on the grab-handle zone (give it the
// `touch-none` class): dragging down past the threshold slides the sheet out
// and closes; anything less springs back. Only the handle zone drags, so the
// sheet's own scrolling is untouched. Pointer events cover touch + mouse.
export function useSheetDrag(onClose: () => void) {
  const sheetRef = useRef<HTMLDivElement | null>(null);
  const startY = useRef<number | null>(null);

  const move = (dy: number, animate: boolean) => {
    const el = sheetRef.current;
    if (!el) return;
    el.style.transition = animate ? "transform 0.2s cubic-bezier(0.22, 1, 0.36, 1)" : "none";
    el.style.transform = dy > 0 ? `translateY(${dy}px)` : "";
  };

  const handleProps = {
    onPointerDown: (e: React.PointerEvent) => {
      startY.current = e.clientY;
      // A CSS entry animation with fill-mode would override the inline
      // transform — clear it once dragging starts.
      if (sheetRef.current) sheetRef.current.style.animation = "none";
      (e.target as Element).setPointerCapture?.(e.pointerId);
    },
    onPointerMove: (e: React.PointerEvent) => {
      if (startY.current == null) return;
      move(e.clientY - startY.current, false);
    },
    onPointerUp: (e: React.PointerEvent) => {
      if (startY.current == null) return;
      const dy = e.clientY - startY.current;
      startY.current = null;
      if (dy > 80) {
        move(window.innerHeight, true);
        setTimeout(onClose, 150); // let the slide-out play, then unmount
      } else {
        move(0, true);
      }
    },
    onPointerCancel: () => {
      startY.current = null;
      move(0, true);
    },
  };

  return { sheetRef, handleProps };
}
