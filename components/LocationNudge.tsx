"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { Navigation, X, Settings } from "lucide-react";
import { getGeoStatus, subscribeGeoStatus, requestLocation, type GeoStatus } from "@/lib/bias";
import { useSheetDrag } from "./useSheetDrag";

// The app saying "I can't see where you are" instead of quietly rendering a map
// of nowhere in particular.
//
// Without a fix the map cannot open on you, "Pin where I am" cannot work, and
// Swiggy has no coordinates to search from — so the failure is not cosmetic, it
// is most of what the app does. Before this, all of that failed in silence: no
// marker, no message, no way back.
//
// It does not stay dismissed. Tapping X hides it for a few minutes, not
// forever, because the thing it is reporting has not gone away — the app is
// still half-working, and a nudge you can permanently silence is a nudge that
// stops telling you why nothing works. It reappears on the next map view.
//
// The two cases are genuinely different and get different treatment:
//
//   unavailable — a timeout, a failed fix, or no API. Retryable, so the button
//                 retries.
//   denied      — the person refused, in this session or long ago. NOTHING a
//                 page can do will re-open that dialog; only browser settings
//                 can. So it explains where to go rather than offering a button
//                 that would silently do nothing, which is the worse failure:
//                 a control that looks like it works.

const SNOOZE_MS = 5 * 60_000;

// A grace period before the nudge appears at all. A cold GPS fix routinely
// takes several seconds, and a warning that flashes up during normal, working
// startup teaches people to ignore it.
const GRACE_MS = 6_000;

function useGeoStatus(): GeoStatus {
  return useSyncExternalStore(subscribeGeoStatus, getGeoStatus, () => "locating" as GeoStatus);
}

export default function LocationNudge() {
  const status = useGeoStatus();
  const [snoozedUntil, setSnoozedUntil] = useState(0);
  const [graceOver, setGraceOver] = useState(false);
  const [explain, setExplain] = useState(false);
  const { sheetRef, handleProps } = useSheetDrag(() => setExplain(false));

  useEffect(() => {
    const t = setTimeout(() => setGraceOver(true), GRACE_MS);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    if (!explain) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setExplain(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [explain]);

  // "locating" is not a problem worth reporting until it has gone on too long —
  // that is what the grace period decides.
  const broken = status === "denied" || status === "unavailable" || (status === "locating" && graceOver);
  const show = broken && Date.now() >= snoozedUntil;

  if (!show && !explain) return null;

  const denied = status === "denied";
  const line = denied
    ? "Location is off for this site"
    : status === "unavailable"
      ? "Couldn’t get your location"
      : "Still looking for your location";

  return (
    <>
      {show && (
        <div className="pointer-events-none px-[18px] pb-2">
          <div
            className="pointer-events-auto flex items-center gap-2.5 rounded-[14px] px-3 py-2.5"
            style={{
              background: "var(--glass)",
              backdropFilter: "blur(22px) saturate(1.3)",
              WebkitBackdropFilter: "blur(22px) saturate(1.3)",
              border: "1px solid rgba(255,255,255,0.1)",
              boxShadow: "inset 0 1px 0 rgba(255,255,255,0.08), 0 10px 28px -12px rgba(0,0,0,0.5)",
            }}
          >
            <Navigation size={16} className="shrink-0" style={{ color: "oklch(0.75 0.15 85)" }} />
            <span className="min-w-0 flex-1">
              <span className="block text-[13px] font-semibold" style={{ color: "oklch(0.96 0 0)" }}>
                {line}
              </span>
              <span className="block text-[11.5px] leading-snug" style={{ color: "oklch(0.72 0.01 260)" }}>
                The map can’t open where you are, and adding a place can’t use your position.
              </span>
            </span>
            <button
              onClick={() => (denied ? setExplain(true) : requestLocation())}
              className="press shrink-0 rounded-full px-3 py-1.5 text-[12px] font-bold"
              style={{ background: "oklch(0.97 0 0)", color: "oklch(0.16 0.006 260)" }}
            >
              {denied ? "How to fix" : "Retry"}
            </button>
            <button
              onClick={() => setSnoozedUntil(Date.now() + SNOOZE_MS)}
              aria-label="Hide for now"
              className="press grid h-6 w-6 shrink-0 place-items-center rounded-full"
              style={{ background: "rgba(255,255,255,0.1)", color: "oklch(0.8 0.01 260)" }}
            >
              <X size={12} strokeWidth={2.5} />
            </button>
          </div>
        </div>
      )}

      {explain && (
        <div className="fixed inset-0 z-50" style={{ background: "rgba(10,8,12,0.64)" }} onClick={() => setExplain(false)}>
          <div
            ref={sheetRef}
            className="scroll-quiet absolute inset-x-0 bottom-0 max-h-[92dvh] overflow-y-auto overscroll-contain px-5 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-2"
            style={{
              background: "var(--bg-raised)",
              borderTopLeftRadius: "var(--radius-lg)",
              borderTopRightRadius: "var(--radius-lg)",
              boxShadow: "var(--shadow-sheet)",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div {...handleProps} className="mx-auto mb-3 flex cursor-grab touch-none justify-center pt-0.5">
              <div className="h-[4px] w-10 rounded-full" style={{ background: "var(--ink-line)" }} />
            </div>
            <div className="flex items-center justify-between pb-1">
              <h1
                className="text-[22px] font-medium leading-none tracking-[-0.01em]"
                style={{ fontFamily: "var(--font-display)", color: "var(--text-primary)" }}
              >
                Turn location back on
              </h1>
              <button
                onClick={() => setExplain(false)}
                aria-label="Close"
                className="press grid h-7 w-7 place-items-center rounded-full"
                style={{ background: "var(--bg-elevated)", color: "var(--text-tertiary)" }}
              >
                <X size={14} strokeWidth={2.25} />
              </button>
            </div>
            <p className="pb-3 pt-1.5 text-[13px] leading-snug" style={{ color: "var(--text-tertiary)" }}>
              This site was told no once, and a page can’t ask again — the browser only lets you undo that from its own
              settings.
            </p>

            {[
              {
                head: "iPhone — Safari",
                steps: 'Tap "aA" in the address bar → Website Settings → Location → Ask or Allow. Then reload.',
              },
              {
                head: "iPhone — added to Home Screen",
                steps:
                  "Settings → Apps → Safari → Location. If it's off there, nothing on the page can override it. A home-screen app keeps its own answer, so deleting and re-adding it also resets the question.",
              },
              {
                head: "Android — Chrome",
                steps: "Tap the lock icon beside the address → Permissions → Location → Allow. Then reload.",
              },
            ].map((b) => (
              <div
                key={b.head}
                className="mb-2 flex gap-3 rounded-[var(--radius)] px-3.5 py-3"
                style={{ background: "var(--bg-elevated)", border: "1px solid var(--ink-line)" }}
              >
                <Settings size={17} className="mt-[2px] shrink-0" style={{ color: "var(--text-secondary)" }} />
                <span className="min-w-0 flex-1">
                  <span className="block text-[14px] font-semibold" style={{ color: "var(--text-primary)" }}>
                    {b.head}
                  </span>
                  <span className="mt-0.5 block text-[12.5px] leading-snug" style={{ color: "var(--text-tertiary)" }}>
                    {b.steps}
                  </span>
                </span>
              </div>
            ))}

            <button
              onClick={() => {
                // Costs nothing, and on a browser whose answer has since changed
                // — or one that never really denied — it just works.
                requestLocation();
                setExplain(false);
              }}
              className="press mt-1 w-full rounded-[12px] py-3 text-[15px] font-semibold"
              style={{ background: "var(--text-primary)", color: "var(--bg-raised)" }}
            >
              I’ve changed it — try again
            </button>
          </div>
        </div>
      )}
    </>
  );
}
