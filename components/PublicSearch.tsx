"use client";

import { useState } from "react";
import { Command } from "cmdk";
import { Search, X } from "lucide-react";
import { displayState, type Place } from "@/lib/types";
import { stateMeta } from "@/lib/format";
import { useSheetDrag } from "./useSheetDrag";

// Search for the share view. Deliberately NOT CommandPalette with a flag:
// that one geocodes the query through /api/places/search to offer the "around
// Jayanagar" radius view, which spends Keerthan's billed Google quota on every
// keystroke — fine for one person, not for a link he sends to a group. This is
// pure text over the ~20 places already on the page, so it costs nothing and
// works offline.
//
// It is also how someone checks a place they already had in mind: type the
// name, and either it comes back with his verdict on it, or it doesn't and
// it simply isn't on his map.
export default function PublicSearch({
  open,
  places,
  onClose,
  onPick,
}: {
  open: boolean;
  places: Place[];
  onClose: () => void;
  onPick: (id: string) => void;
}) {
  const [q, setQ] = useState("");
  const close = () => {
    setQ("");
    onClose();
  };
  const { sheetRef, handleProps } = useSheetDrag(close);

  if (!open) return null;

  const ql = q.trim().toLowerCase();
  const matches = (p: Place) =>
    p.name.toLowerCase().includes(ql) ||
    !!p.area?.toLowerCase().includes(ql) ||
    p.address.toLowerCase().includes(ql) ||
    p.tags.some((t) => t.value.toLowerCase().includes(ql));
  const results = ql ? places.filter(matches) : places;

  const pick = (id: string) => {
    onPick(id);
    close();
  };

  return (
    <div className="fixed inset-0 z-50" style={{ background: "rgba(6,7,10,0.62)" }} onClick={close}>
      <div
        ref={sheetRef}
        className="absolute inset-x-0 bottom-0 pb-[max(1rem,env(safe-area-inset-bottom))]"
        style={{
          background: "var(--bg-raised)",
          borderTopLeftRadius: "var(--radius-lg)",
          borderTopRightRadius: "var(--radius-lg)",
          boxShadow: "var(--shadow-sheet)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <Command label="Search these places" shouldFilter={false} onKeyDown={(e) => e.key === "Escape" && close()} className="flex flex-col">
          <div className="shrink-0 px-4 pt-2">
            <div {...handleProps} className="flex cursor-grab touch-none justify-center pb-2.5 pt-0.5">
              <div className="h-[4px] w-9 rounded-full" style={{ background: "var(--ink-line)" }} />
            </div>
            <div
              className="flex items-center gap-2.5 px-3.5"
              style={{ background: "var(--bg-elevated)", border: "1px solid var(--border-strong)", borderRadius: "var(--radius-sm)" }}
            >
              <Search size={16} strokeWidth={2.25} style={{ color: "var(--accent)" }} />
              <Command.Input
                autoFocus
                value={q}
                onValueChange={setQ}
                placeholder="Name, tag, or area — “toit”, “pizza”…"
                className="min-w-0 flex-1 bg-transparent py-3 text-[15px] outline-none"
                style={{ color: "var(--text-primary)" }}
              />
              <button
                onClick={close}
                aria-label="Close"
                className="press grid h-6 w-6 shrink-0 place-items-center rounded-full"
                style={{ background: "var(--bg-raised)", color: "var(--text-tertiary)" }}
              >
                <X size={13} strokeWidth={2.25} />
              </button>
            </div>
          </div>

          <Command.List className="scroll-quiet h-[44vh] overflow-y-auto px-3 pb-1 pt-2">
            {results.length === 0 ? (
              <p className="px-2 py-6 text-center text-[13px]" style={{ color: "var(--text-tertiary)" }}>
                Not on Keerthan’s map.
              </p>
            ) : (
              results.map((p) => {
                const meta = stateMeta(p);
                return (
                  <Command.Item
                    key={p.id}
                    value={p.id}
                    onSelect={() => pick(p.id)}
                    className="mb-1 flex cursor-pointer items-center gap-2.5 rounded-[var(--radius-sm)] px-3 py-2"
                    style={{ background: "var(--bg-elevated)" }}
                  >
                    <span className="h-2 w-2 shrink-0 rounded-[2px]" style={{ background: meta.color }} />
                    <span className="min-w-0 flex-1 truncate text-[14px]">
                      <span style={{ color: "var(--text-primary)" }}>{p.name}</span>
                      {p.area && <span style={{ color: "var(--text-tertiary)" }}> · {p.area}</span>}
                    </span>
                    <span className="shrink-0 text-[11.5px]" style={{ color: "var(--text-tertiary)" }}>
                      {displayState(p) === "visited" ? "been" : meta.label.toLowerCase()}
                    </span>
                  </Command.Item>
                );
              })
            )}
          </Command.List>
        </Command>
      </div>
    </div>
  );
}
