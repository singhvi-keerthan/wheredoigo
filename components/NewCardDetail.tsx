"use client";

import { useState } from "react";
import { X, Star, MapPin, Navigation, Heart, CalendarClock, Check } from "lucide-react";
import {
  getSlots,
  bookTable,
  swiggyDirectionsUrl,
  type SwiggyRestaurant,
  type SwiggySlot,
  type SwiggyError,
  type UserCoords,
} from "@/lib/swiggyClient";
import { PoweredBySwiggy } from "./PoweredBySwiggy";

const GUESTS = 2; // this sheet books a table for two; book_table accepts 1–20

function errorNote(error: SwiggyError): string {
  if (error === "swiggy_reauth") return "Swiggy sign-in expired — run npm run swiggy:auth.";
  if (error === "fetch_failed") return "You’re offline — couldn’t reach Swiggy.";
  return "Swiggy Dineout is unreachable right now.";
}

// The ↑/tap target for a New card. PlaceDetail loads a stored Place by id, which
// a not-yet-saved Swiggy result doesn't have — so this is the second detail
// path the deck needs: a read-only view rendered straight from the raw record,
// with the save + book actions the old Swiggy panel carried. Layers above the
// deck (z-55) and returns to it on close — opening details is non-consuming.
export default function NewCardDetail({
  r,
  coords,
  onAdd,
  onClose,
}: {
  r: SwiggyRestaurant;
  coords: UserCoords; // the user's position — Swiggy wants it on slots and book
  onAdd: () => void; // deck adds to watchlist + consumes the card, then this closes
  onClose: () => void;
}) {
  const [booking, setBooking] = useState(false);
  const [slots, setSlots] = useState<SwiggySlot[]>([]);
  const [slotsLoading, setSlotsLoading] = useState(false);
  const [bookedLabel, setBookedLabel] = useState<string | null>(null);
  // One line of truth for anything that stops a booking — an expired token, an
  // unreachable server, or a slot that turned out to be a paid deal.
  const [note, setNote] = useState<string | null>(null);
  const [payUrl, setPayUrl] = useState<string | null>(null);

  const directions = swiggyDirectionsUrl(r);
  const highlights = r.highlights ?? [];
  const offers = r.offers ?? [];

  const startBooking = async () => {
    setBooking(true);
    setSlotsLoading(true);
    setNote(null);
    setPayUrl(null);
    const { results, error } = await getSlots(r.id, {
      lat: coords.lat,
      lng: coords.lng,
      guestCount: GUESTS,
    });
    setSlots(results);
    setNote(
      error ? errorNote(error) : results.length === 0 ? "No tables free today." : null
    );
    setSlotsLoading(false);
  };

  const pickSlot = async (slot: SwiggySlot) => {
    setNote(null);
    const { booking: res, error } = await bookTable(r.id, slot, GUESTS, coords);
    if (error) {
      setNote(errorNote(error));
      return;
    }
    if (res?.confirmed) {
      setBookedLabel(slot.displayTime);
      setBooking(false);
      return;
    }
    // PENDING_PAYMENT — the slot was a paid UPI prebook deal. This app never
    // sends payment details, so the table is NOT held; say so rather than
    // showing a "Booked" state for a reservation that doesn't exist.
    if (res?.status === "PENDING_PAYMENT") {
      setPayUrl(res.upiIntentUrl);
      setNote("That slot is a paid deal — finish payment in Swiggy to hold it.");
      return;
    }
    setNote("Couldn’t book that slot. Try another time.");
  };

  return (
    <div
      className="fixed inset-0 z-[55] flex items-end"
      style={{ background: "rgba(6,7,10,0.62)" }}
      onClick={onClose}
    >
      <div
        className="w-full pb-[max(1.5rem,env(safe-area-inset-bottom))]"
        style={{
          background: "var(--bg-raised)",
          borderTopLeftRadius: "var(--radius-lg)",
          borderTopRightRadius: "var(--radius-lg)",
          boxShadow: "var(--shadow-sheet)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex justify-center pb-2 pt-2.5">
          <div className="h-[4px] w-10 rounded-full" style={{ background: "var(--ink-line)" }} />
        </div>

        <div className="px-5">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <span className="text-[11.5px] font-semibold" style={{ color: "var(--accent)" }}>
                New · Swiggy Dineout
              </span>
              <h2
                className="mt-0.5 text-[26px] leading-[1.05] tracking-[-0.01em]"
                style={{ fontFamily: "var(--font-serif)", color: "var(--text-primary)" }}
              >
                {r.name}
              </h2>
            </div>
            <button
              onClick={onClose}
              aria-label="Close"
              className="press mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full"
              style={{ background: "var(--bg-elevated)", color: "var(--text-tertiary)" }}
            >
              <X size={14} strokeWidth={2.25} />
            </button>
          </div>

          <div
            className="mt-2 flex flex-wrap items-center gap-x-3.5 gap-y-1 text-[13px]"
            style={{ fontFamily: "var(--font-mono)" }}
          >
            {r.rating != null && (
              <span className="inline-flex items-center gap-1" style={{ color: "var(--text-secondary)" }}>
                <Star size={12} strokeWidth={0} fill="currentColor" style={{ color: "var(--star)" }} />
                {r.rating.toFixed(1)}
              </span>
            )}
            {r.priceForTwo != null && (
              <span style={{ color: "var(--text-secondary)" }}>
                ₹{r.priceForTwo.toLocaleString("en-IN")} for two
              </span>
            )}
            {r.area && (
              <span className="inline-flex items-center gap-1" style={{ color: "var(--text-tertiary)" }}>
                <MapPin size={11} strokeWidth={2} />
                {r.area}
              </span>
            )}
          </div>

          {r.address && (
            <p className="mt-2 text-[13px] leading-snug" style={{ color: "var(--text-tertiary)" }}>
              {r.address}
            </p>
          )}

          {(r.description || r.distance) && (
            <div className="mt-3">
              {r.description && (
                <p className="text-[13px] leading-snug" style={{ color: "var(--text-secondary)" }}>
                  {r.description}
                </p>
              )}
              {r.distance && (
                <p className="mt-1 text-[12px] leading-snug" style={{ color: "var(--text-tertiary)" }}>
                  {r.distance}
                </p>
              )}
            </div>
          )}

          <div className="mt-3 flex flex-wrap gap-1.5">
            {r.cuisines.map((c) => (
              <span
                key={c}
                className="px-2.5 py-[3px] text-[11px] capitalize"
                style={{ borderRadius: "var(--radius-chip)", background: "var(--bg-elevated)", color: "var(--text-secondary)" }}
              >
                {c}
              </span>
            ))}
            {highlights.map((h) => (
              <span
                key={h}
                className="px-2.5 py-[3px] text-[11px]"
                style={{ borderRadius: "var(--radius-chip)", background: "var(--bg-elevated)", color: "var(--text-secondary)" }}
              >
                {h}
              </span>
            ))}
          </div>

          {offers.length > 0 && (
            <div className="mt-3 flex flex-col gap-1.5">
              {offers.map((offer) => (
                <p
                  key={offer}
                  className="rounded-[6px] px-3 py-2 text-[12.5px] leading-snug"
                  style={{ background: "var(--bg-elevated)", color: "var(--text-secondary)" }}
                >
                  {offer}
                </p>
              ))}
            </div>
          )}

          {/* book a table — carried over from the old Swiggy panel */}
          {booking ? (
            <div className="mt-4">
              <p
                className="mb-1.5 text-[11.5px] font-semibold uppercase tracking-[0.06em]"
                style={{ color: "var(--text-tertiary)" }}
              >
                {slotsLoading
                  ? "Finding tables…"
                  : slots.length > 0
                    ? `Pick a time — table for ${GUESTS}`
                    : "No times available"}
              </p>
              {!slotsLoading && (
                <div className="flex flex-wrap gap-1.5">
                  {slots.map((s) => (
                    <button
                      key={`${s.slotId}-${s.itemId}`}
                      onClick={() => pickSlot(s)}
                      className="press px-3 py-[7px] text-[12.5px] font-semibold"
                      style={{ borderRadius: "var(--radius-chip)", border: "1px solid var(--border-strong)", color: "var(--text-primary)" }}
                    >
                      {s.displayTime}
                    </button>
                  ))}
                  <button
                    onClick={() => setBooking(false)}
                    className="press px-3 py-[7px] text-[12.5px] font-semibold"
                    style={{ borderRadius: "var(--radius-chip)", color: "var(--text-tertiary)" }}
                  >
                    Cancel
                  </button>
                </div>
              )}
              {note && (
                <p className="mt-2 text-[12px] leading-snug" style={{ color: "var(--text-tertiary)" }}>
                  {note}
                </p>
              )}
              {payUrl && (
                <a
                  href={payUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="press mt-2 inline-flex px-3 py-[7px] text-[12.5px] font-semibold"
                  style={{ borderRadius: "var(--radius-chip)", border: "1px solid var(--border-strong)", color: "var(--text-primary)" }}
                >
                  Pay in Swiggy
                </a>
              )}
            </div>
          ) : (
            <div className="mt-4 grid grid-cols-2 gap-2">
              <button
                onClick={onAdd}
                className="press flex items-center justify-center gap-1.5 py-3 text-[14px] font-bold"
                style={{ background: "oklch(0.97 0 0)", color: "oklch(0.16 0.006 260)", borderRadius: "var(--radius-chip)" }}
              >
                <Heart size={15} strokeWidth={2.5} fill="currentColor" /> Add to Watchlist
              </button>
              <button
                onClick={startBooking}
                disabled={!!bookedLabel}
                className="press flex items-center justify-center gap-1.5 py-3 text-[13.5px] font-semibold disabled:opacity-70"
                style={{
                  borderRadius: "var(--radius-chip)",
                  border: "1px solid var(--border-strong)",
                  background: bookedLabel ? "var(--s-visited)" : "transparent",
                  color: bookedLabel ? "#fff" : "var(--text-primary)",
                }}
              >
                {bookedLabel ? (
                  <>
                    <Check size={14} strokeWidth={3} /> Booked {bookedLabel}
                  </>
                ) : (
                  <>
                    <CalendarClock size={14} strokeWidth={2.5} /> Book a table
                  </>
                )}
              </button>
            </div>
          )}

          <a
            href={directions}
            target="_blank"
            rel="noreferrer"
            className="press mt-2 flex items-center justify-center gap-2 py-3 text-[13.5px] font-semibold"
            style={{ borderRadius: "var(--radius-chip)", border: "1px solid var(--border-strong)", color: "var(--text-primary)" }}
          >
            <Navigation size={14} strokeWidth={2.5} fill="currentColor" /> Directions
          </a>

          {/* Cl. 3.4(ii) — this sheet is the deepest MCP surface (search, slots,
              book), so the credit closes it out. */}
          <PoweredBySwiggy className="mt-3 text-center" />
        </div>
      </div>
    </div>
  );
}
