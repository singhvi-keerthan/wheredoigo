"use client";

import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { Search, Plus, MoreHorizontal, Download, Upload, MapPin, TriangleAlert, X } from "lucide-react";
import { usePlaces, usePersistError, exportData, importData } from "@/lib/store";
import { displayState, type DisplayState } from "@/lib/types";
import MapView from "./MapView";
import PlaceCard from "./PlaceCard";
import PlaceDetail from "./PlaceDetail";
import CommandPalette from "./CommandPalette";
import AddPlaceSheet from "./AddPlaceSheet";
import DecideSheet from "./DecideSheet";
import PlaceWizard from "./PlaceWizard";

type FilterKey = "all" | DisplayState;

const FILTERS: { key: FilterKey; label: string }[] = [
  { key: "all", label: "All" },
  { key: "watchlist", label: "Watchlist" },
  { key: "visited", label: "Been" },
  { key: "favorite", label: "Favorites" },
  { key: "never_again", label: "Skip" },
];

// Underline colour per filter — the locked V1 pin-system tokens (not the mock's
// guessed hues). "all" is neutral white.
const UNDERLINE: Record<FilterKey, string> = {
  all: "rgba(255,255,255,0.85)",
  watchlist: "var(--s-watchlist)",
  visited: "var(--s-visited)",
  favorite: "var(--s-favorite)",
  never_again: "var(--s-never)",
};

// Dark frosted glass — floats over the light map.
const GLASS: CSSProperties = {
  background: "rgba(22,24,30,0.66)",
  backdropFilter: "blur(22px) saturate(1.3)",
  WebkitBackdropFilter: "blur(22px) saturate(1.3)",
  border: "1px solid rgba(255,255,255,0.1)",
  boxShadow: "inset 0 1px 0 rgba(255,255,255,0.08), 0 10px 28px -12px rgba(0,0,0,0.5)",
};
// Solid white action (Decide + Add).
const WHITE_ACTION: CSSProperties = {
  background: "oklch(0.97 0 0)",
  color: "oklch(0.16 0.006 260)",
  boxShadow: "0 8px 22px -8px rgba(0,0,0,0.5)",
  border: "none",
};

export default function AppShell() {
  const places = usePlaces();
  const persistError = usePersistError();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [filter, setFilter] = useState<FilterKey>("all");
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [addQuery, setAddQuery] = useState<string | null>(null); // palette → + sheet carry-over
  const [decideOpen, setDecideOpen] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);
  // Guided form that opens right after a fresh add — "capture" enriches a new
  // watchlist place (type/cuisine/vibe/.../note), "visit" logs a retroactive
  // been-here in one go. Never opens for a duplicate (already-known place).
  const [wizard, setWizard] = useState<{ placeId: string; mode: "capture" | "visit" } | null>(null);
  const [menuOpen, setMenuOpen] = useState(false); // backup menu
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showToast = (msg: string) => {
    setToast(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 2800);
  };

  // ⌘K / Ctrl-K opens the search palette (matches the badge on the search dock).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const visible = useMemo(
    () => (filter === "all" ? places : places.filter((p) => displayState(p) === filter)),
    [places, filter]
  );
  const selected = useMemo(
    () => visible.find((p) => p.id === selectedId) ?? null,
    [visible, selectedId]
  );

  return (
    <main
      className="relative w-full overflow-hidden"
      style={{ height: "100dvh", background: "var(--bg-base)" }}
    >
      <MapView places={visible} selectedId={selectedId} onSelect={setSelectedId} />

      {/* top scrim — light wash so the dark-ink masthead reads over the map */}
      <div
        className="pointer-events-none fixed inset-x-0 top-0 z-[2] h-28"
        style={{ background: "linear-gradient(180deg, rgba(243,243,240,0.95), rgba(243,243,240,0))" }}
      />

      {/* ===================== MASTHEAD — dark ink on the light map ===================== */}
      <header className="fixed inset-x-0 top-0 z-10 flex items-end justify-between px-5 pt-[max(0.9rem,env(safe-area-inset-top))]">
        <div>
          <h1
            className="text-[26px] font-medium leading-none tracking-[-0.015em]"
            style={{ fontFamily: "var(--font-display)", color: "#16181d" }}
          >
            im hungry
          </h1>
          <p className="mt-1.5 text-[11px]" style={{ color: "#5b6470" }}>
            <span style={{ fontFamily: "var(--font-mono)", color: "#16181d", fontWeight: 500 }}>
              {places.length}
            </span>{" "}
            places · Bengaluru
          </p>
        </div>
        <button
          onClick={() => setMenuOpen(true)}
          aria-label="Backup menu"
          className="press grid h-9 w-9 place-items-center rounded-full"
          style={GLASS}
        >
          <MoreHorizontal size={17} style={{ color: "oklch(0.9 0 0)" }} />
        </button>
      </header>

      {/* storage failure — silent persist loss is the one unforgivable state */}
      {persistError && (
        <div
          className="fixed inset-x-4 top-[max(4.6rem,calc(env(safe-area-inset-top)+3.6rem))] z-20 flex items-start gap-2 px-3.5 py-3"
          style={{ ...GLASS, borderRadius: "var(--radius-sm)", border: "1px solid oklch(0.6 0.17 15 / 0.5)" }}
        >
          <TriangleAlert size={15} className="mt-0.5 shrink-0" style={{ color: "var(--s-favorite)" }} />
          <p className="text-[12.5px] leading-snug" style={{ color: "oklch(0.92 0 0)" }}>
            {persistError}
          </p>
        </div>
      )}

      {/* empty state — real data only; no more sample pins */}
      {places.length === 0 && !addOpen && (
        <div className="pointer-events-none fixed inset-0 z-[5] grid place-items-center px-8">
          <div
            className="pointer-events-auto flex max-w-[320px] flex-col items-center px-6 py-7 text-center"
            style={{ ...GLASS, borderRadius: "var(--radius)" }}
          >
            <MapPin size={22} style={{ color: "var(--accent)" }} />
            <p className="mt-3 text-[17px] font-semibold" style={{ color: "oklch(0.95 0 0)" }}>
              Nothing pinned yet
            </p>
            <p className="mt-1 text-[13px] leading-snug" style={{ color: "oklch(0.72 0.01 260)" }}>
              Save the places you hear about — and never argue about where to go again.
            </p>
            <button
              onClick={() => setAddOpen(true)}
              className="press mt-4 inline-flex items-center gap-1.5 px-4 py-2.5 text-[13.5px] font-bold"
              style={{ ...WHITE_ACTION, borderRadius: "var(--radius-chip)", cursor: "pointer" }}
            >
              <Plus size={15} strokeWidth={2.75} /> Add your first place
            </button>
          </div>
        </div>
      )}

      {/* toast */}
      {toast && (
        <div className="pointer-events-none fixed inset-x-0 top-[max(4.4rem,calc(env(safe-area-inset-top)+3.4rem))] z-[60] flex justify-center px-6">
          <div
            className="animate-rise px-4 py-2.5 text-[13px] font-medium"
            style={{ ...GLASS, borderRadius: "var(--radius-chip)", color: "oklch(0.93 0 0)" }}
          >
            {toast}
          </div>
        </div>
      )}

      {/* ===================== BOTTOM DOCK — controls in the thumb zone ===================== */}
      {selected ? (
        <div className="fixed inset-x-0 bottom-0 z-10">
          <PlaceCard place={selected} onClose={() => setSelectedId(null)} onOpen={() => setDetailId(selected.id)} />
        </div>
      ) : (
        <div className="fixed inset-x-0 bottom-0 z-10">
          {/* filter rail — Decide (white action) + a dark-glass underline tray */}
          <div className="flex items-center gap-2.5 overflow-x-auto px-5 pb-2 scroll-quiet">
            <button
              onClick={() => setDecideOpen(true)}
              className="press shrink-0"
              style={{
                ...WHITE_ACTION,
                display: "inline-flex",
                alignItems: "center",
                height: 40,
                padding: "0 17px",
                borderRadius: 18,
                fontSize: 14,
                fontWeight: 640,
                letterSpacing: "-0.01em",
                cursor: "pointer",
              }}
            >
              Decide
            </button>

            {/* Filter tray — one dark-glass control, underline-select chips */}
            <div
              className="shrink-0"
              style={{
                ...GLASS,
                display: "inline-flex",
                alignItems: "center",
                gap: 4,
                padding: 5,
                borderRadius: 20,
              }}
            >
              {FILTERS.map((f) => {
                const on = filter === f.key;
                return (
                  <button
                    key={f.key}
                    onClick={() => setFilter(f.key)}
                    className="press shrink-0"
                    style={{
                      display: "inline-flex",
                      flexDirection: "column",
                      alignItems: "center",
                      justifyContent: "center",
                      gap: 3,
                      height: 34,
                      padding: "0 13px",
                      borderRadius: 13,
                      background: "transparent",
                      border: "none",
                      cursor: "pointer",
                      fontSize: 14,
                      letterSpacing: "-0.01em",
                      fontWeight: on ? 600 : 500,
                      color: on ? "oklch(0.98 0 0)" : "oklch(0.74 0.01 260)",
                    }}
                  >
                    {f.label}
                    <span
                      style={{
                        width: 18,
                        height: 3,
                        borderRadius: 2,
                        background: on ? UNDERLINE[f.key] : "transparent",
                      }}
                    />
                  </button>
                );
              })}
            </div>
          </div>

          {/* search dock — glass search + white add */}
          <div className="flex items-center gap-2.5 px-[18px] pb-[max(1.25rem,env(safe-area-inset-bottom))]">
            <button
              onClick={() => setPaletteOpen(true)}
              className="press flex flex-1 items-center gap-2.5 text-left"
              style={{ ...GLASS, height: 50, padding: "0 7px", borderRadius: 18, cursor: "text" }}
            >
              <span
                className="flex shrink-0 items-center justify-center"
                style={{ width: 36, height: 36, borderRadius: "50%", background: "oklch(0.32 0.01 260)", color: "oklch(0.95 0 0)" }}
              >
                <Search size={17} strokeWidth={2.25} />
              </span>
              <span className="flex-1" style={{ fontSize: 15, color: "oklch(0.6 0.01 260)", letterSpacing: "-0.01em" }}>
                Search your places
              </span>
              <kbd
                className="inline-flex items-center pointer-coarse:hidden"
                style={{
                  height: 24,
                  padding: "0 8px",
                  borderRadius: 7,
                  background: "rgba(255,255,255,0.08)",
                  color: "oklch(0.62 0.01 260)",
                  fontSize: 12,
                  fontWeight: 600,
                  marginRight: 6,
                }}
              >
                ⌘K
              </kbd>
            </button>
            <button
              onClick={() => setAddOpen(true)}
              aria-label="Add a place"
              className="press flex shrink-0 items-center justify-center"
              style={{ ...WHITE_ACTION, width: 50, height: 50, borderRadius: 18, cursor: "pointer" }}
            >
              <Plus size={24} strokeWidth={2.5} />
            </button>
          </div>
        </div>
      )}

      <CommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        onPick={(id) => setSelectedId(id)}
        onAddNew={(carry) => {
          setPaletteOpen(false);
          setAddQuery(carry);
          setAddOpen(true);
        }}
      />

      {addOpen && (
        <AddPlaceSheet
          open={addOpen}
          onClose={() => {
            setAddOpen(false);
            setAddQuery(null);
          }}
          initialQuery={addQuery ?? undefined}
          // Adding drops the pin, selects it, then opens the guided form: a
          // duplicate just reopens what's already there, "been already" goes
          // straight into logging that visit, otherwise it's a fresh capture.
          onAdded={(id, opts) => {
            setSelectedId(id);
            if (opts?.duplicate) showToast("Already on your map — opened it");
            else setWizard({ placeId: id, mode: opts?.beenAlready ? "visit" : "capture" });
          }}
        />
      )}

      {wizard && (
        <PlaceWizard placeId={wizard.placeId} mode={wizard.mode} onClose={() => setWizard(null)} />
      )}

      {menuOpen && <BackupMenu onClose={() => setMenuOpen(false)} onDone={showToast} />}

      {decideOpen && (
        <DecideSheet
          open={decideOpen}
          onClose={() => setDecideOpen(false)}
          onView={(id) => {
            setSelectedId(id);
            setDetailId(id);
          }}
        />
      )}

      <PlaceDetail id={detailId} onClose={() => setDetailId(null)} />
    </main>
  );
}

// Export / import the whole library as one JSON file — the v1 backup story
// (localStorage + IndexedDB are one "Clear Website Data" away from gone).
function BackupMenu({ onClose, onDone }: { onClose: () => void; onDone: (msg: string) => void }) {
  const fileRef = useRef<HTMLInputElement>(null);

  const doExport = () => {
    const data = exportData();
    const blob = new Blob([JSON.stringify(data)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `im-hungry-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
    onDone(`Exported ${data.places.length} places`);
    onClose();
  };

  const doImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (!window.confirm("Importing replaces everything currently on your map. Continue?")) return;
    try {
      const count = importData(await file.text());
      onDone(`Imported ${count} places`);
      onClose();
    } catch (err) {
      window.alert((err as Error).message);
    }
  };

  return (
    <div className="fixed inset-0 z-50" style={{ background: "rgba(10,8,12,0.64)" }} onClick={onClose}>
      <div
        className="absolute inset-x-0 bottom-0 px-5 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-2"
        style={{
          background: "var(--bg-raised)",
          borderTopLeftRadius: "var(--radius-lg)",
          borderTopRightRadius: "var(--radius-lg)",
          boxShadow: "var(--shadow-sheet)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mx-auto mb-3 h-[4px] w-10 rounded-full" style={{ background: "var(--ink-line)" }} />
        <div className="flex items-center justify-between pb-3">
          <h1
            className="text-[22px] font-medium leading-none tracking-[-0.01em]"
            style={{ fontFamily: "var(--font-display)", color: "var(--text-primary)" }}
          >
            Backup
          </h1>
          <button
            onClick={onClose}
            aria-label="Close"
            className="press grid h-7 w-7 place-items-center rounded-full"
            style={{ background: "var(--bg-elevated)", color: "var(--text-tertiary)" }}
          >
            <X size={14} strokeWidth={2.25} />
          </button>
        </div>

        <div className="flex flex-col gap-2.5 pb-1">
          <button
            onClick={doExport}
            className="press flex w-full items-center gap-3 rounded-[var(--radius)] px-3.5 py-3.5 text-left"
            style={{ background: "var(--bg-elevated)", border: "1px solid var(--ink-line)" }}
          >
            <Download size={18} style={{ color: "var(--text-secondary)" }} />
            <span className="min-w-0 flex-1">
              <span className="block text-[15px] font-semibold" style={{ color: "var(--text-primary)" }}>
                Export backup
              </span>
              <span className="block text-[12.5px]" style={{ color: "var(--text-tertiary)" }}>
                Everything — places, visits, photos — as one file
              </span>
            </span>
          </button>
          <button
            onClick={() => fileRef.current?.click()}
            className="press flex w-full items-center gap-3 rounded-[var(--radius)] px-3.5 py-3.5 text-left"
            style={{ background: "var(--bg-elevated)", border: "1px solid var(--ink-line)" }}
          >
            <Upload size={18} style={{ color: "var(--text-secondary)" }} />
            <span className="min-w-0 flex-1">
              <span className="block text-[15px] font-semibold" style={{ color: "var(--text-primary)" }}>
                Import backup
              </span>
              <span className="block text-[12.5px]" style={{ color: "var(--text-tertiary)" }}>
                Replaces the current library with a backup file
              </span>
            </span>
          </button>
        </div>
        <input ref={fileRef} type="file" accept="application/json,.json" hidden onChange={doImport} />
      </div>
    </div>
  );
}
