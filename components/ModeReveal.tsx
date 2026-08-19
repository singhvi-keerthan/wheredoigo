"use client";

import { useEffect, useRef } from "react";

// The map → swipe reveal. Not a transition: a six-beat sequence that takes the
// places off your map and makes the deck out of them.
//
//   1 · the tell        the title compresses, every pin flinches. Nothing has
//                       moved yet — anticipation is what separates a reveal
//                       from a cut, and it costs 200ms.
//   2 · the stage clears night washes out from the point you touched; the
//                       masthead lifts off, the dock drops through the floor.
//                       The mode switch does NOT move (AppShell owns it, above
//                       everything) — it's the anchor that says same app.
//   3 · lights on       your pins are the only lit thing left, and hairlines
//                       briefly wire them together: they're a set.
//   4 · the gathering   they arc inward on curves, stretching into comets.
//   5 · collapse        they hit one point and go off like a flashbulb.
//   6 · the deal        SwipeMode mounts and fans its cards out of the flare
//                       (see the `fan` entrance there).
//
// Beats 1–5 are drawn here, over everything, with pointer-events off. Beat 6
// belongs to the deck itself — this layer just keeps painting the flash, the
// shockwave and the embers on top of it while it arrives.
export type RevealPin = { x: number; y: number; size: number; color: string };
export type RevealSpec = { ox: number; oy: number; pins: RevealPin[] };

// The beat sheet, in ms. Kept here as one readable object rather than scattered
// through the code, because the whole thing is a timing decision.
export const BEATS = {
  tell: 0,
  wash: 180,
  ignite: 460,
  gather: 660,
  flash: 1000,
  deal: 1060, // AppShell mounts SwipeMode here; the switch's thumb crosses now
  end: 1900,
};

const SPRING = "cubic-bezier(0.34, 1.56, 0.64, 1)";
const OUT = "cubic-bezier(0.22, 1, 0.36, 1)";

// A pin's flight: sampled off a quadratic whose control point is pushed
// perpendicular to the straight line, so it travels on a curve and stretches
// into a comet through the fast middle of the arc. A straight tween between two
// points is exactly the machinery this sequence exists to avoid.
function arcFrames(dx: number, dy: number): Keyframe[] {
  const cx = dx / 2 - dy * 0.44;
  const cy = dy / 2 + dx * 0.44;
  const N = 8;
  const out: Keyframe[] = [];
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    const x = 2 * (1 - t) * t * cx + t * t * dx;
    const y = 2 * (1 - t) * t * cy + t * t * dy;
    const tx = 2 * (1 - t) * cx + 2 * t * (dx - cx);
    const ty = 2 * (1 - t) * cy + 2 * t * (dy - cy);
    const ang = (Math.atan2(ty, tx) * 180) / Math.PI;
    const bell = Math.sin(Math.PI * t);
    const sx = i === N ? 0 : 1 + 3.4 * bell;
    const sy = i === N ? 0 : 1 - 0.32 * bell;
    out.push({
      offset: t,
      transform: `translate(${x}px, ${y}px) rotate(${ang}deg) scale(${sx}, ${sy})`,
    });
  }
  return out;
}

const EMBER_SPREAD = [-14, 0, 14];

export default function ModeReveal({
  spec,
  onDeal,
  onDone,
}: {
  spec: RevealSpec;
  onDeal: () => void; // the flash — mount the deck
  onDone: () => void; // the room has settled — unmount this layer
}) {
  const root = useRef<HTMLDivElement>(null);
  // Both callbacks go through refs: AppShell passes fresh closures every render,
  // and a re-armed timer would never fire.
  const onDealRef = useRef(onDeal);
  const onDoneRef = useRef(onDone);
  useEffect(() => {
    onDealRef.current = onDeal;
    onDoneRef.current = onDone;
  });

  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const cx = window.innerWidth / 2;
    const cy = window.innerHeight / 2;
    const anims: Animation[] = [];
    const timers: number[] = [];
    let finished = false;

    const at = (ms: number, fn: () => void) => timers.push(window.setTimeout(fn, ms));
    const play = (
      target: Element | null,
      frames: Keyframe[],
      opts: { d: number; at?: number; e?: string }
    ) => {
      if (!target) return;
      anims.push(
        target.animate(frames, {
          duration: opts.d,
          delay: opts.at ?? 0,
          easing: opts.e ?? OUT,
          fill: "both",
        })
      );
    };

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    // Anyone who taps mid-reveal has seen enough: land in the deck immediately
    // rather than making them wait out a piece of theatre they didn't want.
    const skip = () => {
      if (finished) return;
      finished = true;
      timers.forEach(clearTimeout);
      anims.forEach((a) => a.finish());
      onDealRef.current();
      window.setTimeout(() => onDoneRef.current(), 140);
    };

    if (reduced) {
      // Reduced motion still gets the change, it just doesn't travel: a plain
      // darkening, then the deck.
      play(el.querySelector("[data-night]"), [{ opacity: 0 }, { opacity: 1 }], { d: 180 });
      at(180, () => onDealRef.current());
      at(420, () => onDoneRef.current());
      return () => timers.forEach(clearTimeout);
    }

    // 1 · the tell — the lights flinch where they stand
    el.querySelectorAll("[data-light]").forEach((p) => {
      play(p, [{ transform: "scale(1)" }, { transform: "scale(1.55)", offset: 0.45 }, { transform: "scale(1)" }], {
        d: 210,
        at: BEATS.tell + 30,
      });
    });

    // 2 · the stage clears — night spreads from where you touched
    play(
      el.querySelector("[data-night]"),
      [{ "--wash": "0%" } as Keyframe, { "--wash": "175%" } as Keyframe],
      { d: 470, at: BEATS.wash, e: "cubic-bezier(0.4,0,0.25,1)" }
    );

    // 3 · lights on — and briefly wired to each other
    el.querySelectorAll("[data-light]").forEach((p, i) => {
      play(
        p,
        [
          { filter: "drop-shadow(0 0 0 rgba(255,168,80,0))" },
          { filter: "drop-shadow(0 0 10px rgba(255,196,120,0.95))" },
        ],
        { d: 240, at: BEATS.ignite + i * 30 }
      );
    });
    play(
      el.querySelector("[data-lines]"),
      [{ opacity: 0 }, { opacity: 1, offset: 0.45 }, { opacity: 1, offset: 0.75 }, { opacity: 0 }],
      { d: 460, at: BEATS.ignite + 20 }
    );
    el.querySelectorAll<SVGLineElement>("[data-lines] line").forEach((ln, i) => {
      const len = ln.getTotalLength();
      ln.style.strokeDasharray = String(len);
      play(ln, [{ strokeDashoffset: len }, { strokeDashoffset: 0 }], { d: 300, at: BEATS.ignite + 40 + i * 34 });
    });

    // 4 · the gathering
    spec.pins.forEach((p, i) => {
      const node = el.querySelector(`[data-light="${i}"]`);
      play(node, arcFrames(cx - p.x, cy - p.y), {
        d: 400,
        at: BEATS.gather + i * 42,
        e: "cubic-bezier(0.55,0,0.35,1)",
      });
    });

    // 5 · collapse
    play(
      el.querySelector("[data-flash]"),
      [
        { opacity: 0, transform: "translate(-50%,-50%) scale(0.35)" },
        { opacity: 0.95, transform: "translate(-50%,-50%) scale(1.1)", offset: 0.3 },
        { opacity: 0, transform: "translate(-50%,-50%) scale(2.2)" },
      ],
      { d: 340, at: BEATS.flash }
    );
    play(
      el.querySelector("[data-ring]"),
      [
        { opacity: 0, transform: "translate(-50%,-50%) scale(0.1)", borderWidth: "3px" },
        { opacity: 1, transform: "translate(-50%,-50%) scale(0.6)", offset: 0.18 },
        { opacity: 0, transform: "translate(-50%,-50%) scale(4.4)", borderWidth: "1px" },
      ],
      { d: 560, at: BEATS.flash + 20, e: SPRING }
    );

    // 6 · embers drifting up behind the deal, then the veil hands the screen
    // over to the deck's own surface (both near-black, so there's no seam)
    el.querySelectorAll("[data-ember]").forEach((e, i) => {
      play(
        e,
        [
          { opacity: 0, transform: "translate(0,0) scale(0.6)" },
          { opacity: 0.95, offset: 0.2 },
          { opacity: 0, transform: `translate(${EMBER_SPREAD[i % 3]}px, -70px) scale(0.2)` },
        ],
        { d: 900, at: BEATS.flash + 80 + i * 55, e: "cubic-bezier(0.3,0,0.5,1)" }
      );
    });
    play(el.querySelector("[data-night]"), [{ opacity: 1 }, { opacity: 0 }], {
      d: 340,
      at: BEATS.end - 420,
    });

    at(BEATS.deal, () => onDealRef.current());
    at(BEATS.end, () => {
      finished = true;
      onDoneRef.current();
    });

    window.addEventListener("pointerdown", skip, { once: true });
    return () => {
      timers.forEach(clearTimeout);
      anims.forEach((a) => a.cancel());
      window.removeEventListener("pointerdown", skip);
    };
  }, [spec]);

  const cx = typeof window === "undefined" ? 0 : window.innerWidth / 2;
  const cy = typeof window === "undefined" ? 0 : window.innerHeight / 2;

  return (
    <div ref={root} className="pointer-events-none fixed inset-0 z-[58]" aria-hidden>
      <div
        data-night
        className="reveal-night"
        style={{ "--ox": `${spec.ox}px`, "--oy": `${spec.oy}px` } as React.CSSProperties}
      />

      {/* the constellation: your places, briefly drawn as one set */}
      <svg data-lines className="absolute inset-0 h-full w-full" style={{ opacity: 0 }}>
        {spec.pins.map((p, i) => (
          <line
            key={i}
            x1={p.x}
            y1={p.y}
            x2={cx}
            y2={cy}
            stroke="rgba(255,196,130,0.5)"
            strokeWidth={0.75}
          />
        ))}
      </svg>

      {/* the lights themselves — drawn here rather than animating the map's own
          markers, which are React-owned and change shape by zoom band */}
      {spec.pins.map((p, i) => (
        <i
          key={i}
          data-light={i}
          className="reveal-light"
          style={{
            left: p.x - p.size / 2,
            top: p.y - p.size / 2,
            width: p.size,
            height: p.size,
            background: p.color,
          }}
        />
      ))}

      {spec.pins.length > 0 &&
        Array.from({ length: 8 }, (_, i) => (
          <i
            key={`e${i}`}
            data-ember
            className="reveal-ember"
            style={{ left: cx + ((i % 4) - 1.5) * 26, top: cy + (i < 4 ? 18 : -14) }}
          />
        ))}

      <div data-ring className="reveal-ring" style={{ left: cx, top: cy }} />
      <div data-flash className="reveal-flash" style={{ left: cx, top: cy }} />
    </div>
  );
}
