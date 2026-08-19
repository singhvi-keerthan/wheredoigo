// Clause 3.4(ii) of the Swiggy Integration Agreement (signed 2026-08-19) requires
// the notation "powered by Swiggy" to be prominently displayed at "each and every
// location, interface, screen, page and/or point of access where the MCP solution
// is ... made available to or accessible by its end users" — and, the part that
// shapes this file, "in such form and style as may be prescribed by Swiggy".
//
// Swiggy has prescribed no style yet. So the wording AND the styling both live
// here and nowhere else: when a brand spec does arrive, this file is the entire
// change. Never inline the notation at a call site.
//
// Every surface that shows Swiggy MCP data has to render this:
//   • SwipeCard     — the deck card for a `new` (Swiggy) result
//   • NewCardDetail — the Swiggy detail sheet + table booking
//   • PlaceDetail   — a saved place whose `source` is "swiggy"
//   • MenuSheet     — standing app-level credit, beside the map attribution
// Add a surface, add a call. See memory/swiggy-integration-agreement.md.

export const SWIGGY_NOTATION = "Powered by Swiggy";

type Tone = "sheet" | "overlay";

export function PoweredBySwiggy({
  tone = "sheet",
  className = "",
}: {
  tone?: Tone;
  className?: string;
}) {
  const overlay = tone === "overlay";
  return (
    <p
      className={`text-[11px] font-semibold tracking-[0.02em] ${className}`}
      style={{
        color: overlay ? "rgba(255,255,255,0.72)" : "var(--text-tertiary)",
        // the card credit sits over an arbitrary remote photo — it has to stay
        // legible on a blown-out one, hence the shadow rather than a lighter grey
        textShadow: overlay ? "0 1px 3px rgba(0,0,0,0.55)" : undefined,
      }}
    >
      {SWIGGY_NOTATION}
    </p>
  );
}
