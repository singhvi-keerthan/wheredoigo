"use client";

import { useEffect, useRef, useState } from "react";
import { Sparkles, RefreshCw } from "lucide-react";
import { parseFallback } from "@/lib/decide-fallback";
import { geocodeArea } from "@/lib/places";
import type { DecideQuery } from "@/lib/decide";

// Ask, back on the map.
//
// It used to live here as a mascot you tapped — "Can't decide? Ask me" — and it
// left on 2026-08-19 with DecideSheet, when swipe became a mode and Ask moved
// inside the deck's filter panel. That was a fair place for it to live and the
// wrong place for it to ONLY live: the map is where you are when you don't know
// where you're going, and the answer to "somewhere cheap in Indiranagar" is a
// map with three pins on it, not a deck you have to enter first.
//
// So this is not a way into the deck. It narrows the map you are already
// looking at. Same mechanism as the deck's Ask — /api/decide parses the
// sentence, parseFallback catches it when Gemini is out of quota or unreachable
// — so the two can't drift into meaning different things by the same name.
export default function AskSheet({
  open,
  onClose,
  onApply,
}: {
  open: boolean;
  onClose: () => void;
  onApply: (q: DecideQuery, said: string) => void;
}) {
  const [nl, setNl] = useState("");
  const [thinking, setThinking] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Opens empty and focused: an ask is a fresh sentence, not an edit of the
  // last one, and the keyboard should already be up when the sheet lands.
  useEffect(() => {
    if (!open) return;
    const t = window.setTimeout(() => {
      setNl("");
      setThinking(false);
      inputRef.current?.focus();
    }, 60);
    return () => window.clearTimeout(t);
  }, [open]);

  // The same Escape idiom every other sheet here uses.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const ask = async () => {
    const text = nl.trim();
    if (!text || thinking) return;
    setThinking(true);
    let q: DecideQuery;
    try {
      const res = await fetch("/api/decide", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: text }),
      });
      const data = await res.json();
      q = data.query ?? parseFallback(text);
    } catch {
      q = parseFallback(text);
    }
    // Prefer a centroid when Google can resolve the locality, but keep the
    // area name when it cannot. rankPlaces has a name fallback, and dropping
    // the area turns "Ashok Nagar" into a generic keyword ask.
    if (q.area) {
      try {
        const hit = await geocodeArea(q.area);
        if (hit) {
          q.areaCenter = { lat: hit.lat, lng: hit.lng };
          q.area = hit.name;
        }
      } catch {
        // Keep the area name fallback.
      }
    }
    setThinking(false);
    onApply(q, text);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50" style={{ background: "rgba(10,8,12,0.64)" }} onClick={onClose}>
      <div
        className="animate-rise absolute inset-x-0 bottom-0 px-5 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-4"
        style={{
          background: "var(--bg-raised)",
          borderTopLeftRadius: "var(--radius-lg)",
          borderTopRightRadius: "var(--radius-lg)",
          boxShadow: "var(--shadow-sheet)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <p className="text-[13px]" style={{ color: "var(--text-tertiary)" }}>
          Say what you feel like. It narrows the map.
        </p>

        <div
          className="mt-3 flex items-center gap-2 px-3"
          style={{
            background: "var(--bg-elevated)",
            border: "1px solid var(--border-strong)",
            borderRadius: "var(--radius-sm)",
          }}
        >
          <Sparkles size={15} strokeWidth={2.25} style={{ color: "var(--accent)" }} />
          <input
            ref={inputRef}
            value={nl}
            onChange={(e) => setNl(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && ask()}
            placeholder="Somewhere cheap in Indiranagar…"
            className="flex-1 bg-transparent py-2.5 text-[14px] outline-none"
            style={{ color: "var(--text-primary)" }}
          />
          <button
            onClick={ask}
            disabled={thinking || !nl.trim()}
            className="press flex items-center gap-1.5 px-3 py-1.5 text-[12.5px] font-bold disabled:opacity-40"
            style={{
              background: "oklch(0.97 0 0)",
              color: "oklch(0.16 0.006 260)",
              borderRadius: "var(--radius-chip)",
            }}
          >
            {thinking ? <RefreshCw size={13} className="animate-spin" /> : <Sparkles size={13} strokeWidth={2.25} />}
            Ask
          </button>
        </div>
      </div>
    </div>
  );
}
