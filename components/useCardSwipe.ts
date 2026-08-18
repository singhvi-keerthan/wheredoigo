"use client";

import { useRef, useState, type PointerEvent as ReactPointerEvent } from "react";

// Axis-locked card gesture. The card is now a SCROLLING surface, so a pointer
// press can mean two different things and we can't know which until the finger
// moves: down-the-page is a scroll the browser must own, sideways is a swipe we
// must own. Getting this wrong in either direction is the whole feel of the
// feature — a card that hijacks scrolling, or a swipe that scrolls instead.
//
// The rules that make it work, in order:
//
//  1. Do NOTHING on pointerdown. No pointer capture, no drag state. Capturing
//     on down (what the old deck did) steals every gesture from the scroller
//     before it can start.
//  2. Let the FIRST ~8px decide, then commit to that axis for the rest of the
//     gesture. No re-deciding mid-drag — that's what makes a swipe feel like it
//     slips.
//  3. Horizontal has to beat vertical by a margin (H_BIAS) to win. Thumbs arc,
//     so a "sideways" swipe carries real dy; a scroll almost never carries much
//     dx. Ties go to scrolling, which is the more common intent.
//  4. Only once horizontal wins do we capture the pointer — from then on the
//     card owns the gesture even if the finger wanders off it.
//  5. If vertical wins we bail out entirely and never touch the event again.
//     The scroll container's `touch-action: pan-y` means the browser is already
//     scrolling; it will fire pointercancel at us, which just resets.
//
// The card's scroll container must set `touch-action: pan-y` for this to hold:
// that lets the browser scroll vertically on its own while guaranteeing it will
// never pan horizontally, so a horizontal lock can never race a started scroll.

export type SwipeDir = "left" | "right";

const LOCK_PX = 8; // travel before the axis is decided
const H_BIAS = 1.15; // horizontal must out-travel vertical by this to win
// Once horizontal, the card follows the finger vertically only a little — a
// swipe stays level, which is what reads as "confident".
export const DY_DAMP = 0.15;

export function useCardSwipe({
  enabled,
  threshold,
  flickVelocity,
  flickMin,
  onCommit,
}: {
  enabled: boolean;
  threshold: number; // px past which a release commits
  flickVelocity: number; // px/ms — a fast flick commits before the distance
  flickMin: number; // px — ignore taps / jitter below this travel
  onCommit: (dir: SwipeDir) => void;
}) {
  const [drag, setDrag] = useState<{ dx: number; dy: number } | null>(null);
  const start = useRef<{ x: number; y: number; id: number } | null>(null);
  // Did the gesture that just ended turn into a drag? Read by tap targets
  // sitting on the card (the photo pager) so a swipe can't also register as a
  // tap. Pointer capture already retargets `click` to the wrapper, so in
  // practice the pager never fires after a locked drag — but that protection is
  // an emergent side effect of the capture call, and it would vanish silently
  // if the capture ever moved. This makes the invariant explicit instead.
  // Deliberately NOT cleared by reset(): reset runs on pointerup, and the click
  // it needs to suppress arrives after that. Cleared on the next pointerdown.
  const moved = useRef(false);
  const axis = useRef<"horizontal" | "vertical" | null>(null);
  const sample = useRef<{ x: number; t: number } | null>(null);
  const vel = useRef(0);

  const reset = () => {
    start.current = null;
    axis.current = null;
    sample.current = null;
    vel.current = 0;
    setDrag(null);
  };

  const onPointerDown = (e: ReactPointerEvent) => {
    // First finger down owns the gesture until it lifts. Without this a second
    // finger landing mid-swipe overwrote the origin and cleared the axis lock,
    // so the in-flight dx jumped and the release was judged against a point the
    // user never started from — a two-thumb grip could commit a swipe by itself.
    if (start.current) return;
    // Cleared before the `enabled` check, not after: a press arriving while the
    // deck is mid-exit still begins a NEW gesture, and leaving the previous
    // drag's flag set would make the tap it becomes get swallowed as a swipe.
    moved.current = false;
    if (!enabled) return;
    // Deliberately no setPointerCapture and no setDrag here — see rule 1.
    start.current = { x: e.clientX, y: e.clientY, id: e.pointerId };
    axis.current = null;
    sample.current = { x: e.clientX, t: e.timeStamp };
    vel.current = 0;
  };

  const onPointerMove = (e: ReactPointerEvent) => {
    const s = start.current;
    if (!s || e.pointerId !== s.id) return; // not the finger that started this
    const dx = e.clientX - s.x;
    const dy = e.clientY - s.y;

    if (axis.current === null) {
      const adx = Math.abs(dx);
      const ady = Math.abs(dy);
      if (Math.max(adx, ady) < LOCK_PX) return; // not enough travel to tell yet
      if (adx > ady * H_BIAS) {
        axis.current = "horizontal";
        moved.current = true;
        (e.currentTarget as Element).setPointerCapture?.(s.id);
        setDrag({ dx, dy });
      } else {
        axis.current = "vertical";
        start.current = null; // hands the gesture back to the scroller, for good
      }
      return;
    }
    if (axis.current !== "horizontal") return;

    // Smoothed instantaneous x-velocity from the last sample (guard tiny dt).
    if (sample.current) {
      const dt = e.timeStamp - sample.current.t;
      if (dt > 0) {
        const v = (e.clientX - sample.current.x) / dt;
        vel.current = vel.current * 0.4 + v * 0.6;
      }
    }
    sample.current = { x: e.clientX, t: e.timeStamp };
    setDrag({ dx, dy });
  };

  const onPointerUp = (e: ReactPointerEvent) => {
    const s = start.current;
    if (s && e.pointerId !== s.id) return; // a second finger lifting is not a release
    if (!s || axis.current !== "horizontal") {
      reset(); // a tap, or a gesture the scroller took
      return;
    }
    const dx = e.clientX - s.x;
    const adx = Math.abs(dx);
    const ady = Math.abs(e.clientY - s.y);
    const vx = vel.current;
    (e.currentTarget as Element).releasePointerCapture?.(s.id);
    reset();

    // Commit on distance OR a fast horizontal flick, whichever lands first.
    const flick = adx > flickMin && Math.abs(vx) > flickVelocity && adx > ady;
    if (dx > threshold || (flick && vx > 0)) return onCommit("right");
    if (dx < -threshold || (flick && vx < 0)) return onCommit("left");
    // otherwise: spring back (reset already cleared the drag)
  };

  return {
    drag,
    reset,
    wasDrag: () => moved.current,
    handlers: {
      onPointerDown,
      onPointerMove,
      onPointerUp,
      onPointerCancel: (e: ReactPointerEvent) => {
        if (!start.current || e.pointerId === start.current.id) reset();
      },
    },
  };
}
