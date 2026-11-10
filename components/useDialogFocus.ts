"use client";

import { useEffect, useRef, useState } from "react";

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

// A sheet that says aria-modal has to behave like one for a keyboard: it takes
// focus when it opens, Tab and Shift-Tab cycle inside it instead of walking out
// onto the deck or the map behind it, and focus goes back to whatever opened it
// when it closes. Attach the ref to the dialog element (tabIndex={-1}).
export function useDialogFocus<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  // Read on the first render, before this sheet's commit: the same commit
  // makes the opener `inert`, which drops focus to <body> before any effect
  // could see where it was.
  const [prev] = useState(() =>
    typeof document === "undefined" ? null : (document.activeElement as HTMLElement | null)
  );
  useEffect(() => {
    const el = ref.current;
    el?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Tab" || !el) return;
      const items = [...el.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
        (n) => n.offsetParent !== null || n === document.activeElement
      );
      if (!items.length) {
        e.preventDefault();
        el.focus();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      const at = document.activeElement;
      const inside = at instanceof Node && el.contains(at);
      if (e.shiftKey && (at === first || at === el || !inside)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (at === last || !inside)) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      // A frame later: the opener usually sits under the sheet's `inert` cover,
      // which is lifted in the same commit that unmounts the sheet — focusing
      // it now would be refused and leave focus on <body>.
      requestAnimationFrame(() => prev?.focus?.());
    };
  }, [prev]);
  return ref;
}
