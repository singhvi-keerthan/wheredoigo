"use client";

import { useRef } from "react";
import { X, Images, Store, UtensilsCrossed, MapPinned, Pizza, Download, Upload, ChevronRight } from "lucide-react";
import { usePlaces, downloadBackup, importData } from "@/lib/store";
import type { TagNamespace } from "@/lib/types";
import type { BrowseMode } from "./BrowseSheet";
import { useSheetDrag } from "./useSheetDrag";
import SyncSection from "./SyncSection";
import { PoweredBySwiggy } from "./PoweredBySwiggy";

// The menu — one hub over the map. Top half is Browse (five lenses on the same
// library the map can't give you at a glance); bottom is the v1 backup story.
export default function MenuSheet({
  onClose,
  onOpenBrowse,
  onToast,
}: {
  onClose: () => void;
  onOpenBrowse: (mode: BrowseMode) => void;
  onToast: (msg: string) => void;
}) {
  const places = usePlaces();
  const fileRef = useRef<HTMLInputElement>(null);
  const { sheetRef, handleProps } = useSheetDrag(onClose);

  const photoCount = places.reduce((n, p) => n + p.photos.filter((ph) => ph.dataUrl).length, 0);
  const distinct = (ns: TagNamespace) =>
    new Set(places.flatMap((p) => p.tags.filter((t) => t.namespace === ns).map((t) => t.value))).size;
  const areaCount = new Set(places.map((p) => p.area?.trim()).filter(Boolean)).size;

  const tiles: { mode: BrowseMode; icon: React.ReactNode; label: string; count: number }[] = [
    { mode: "gallery", icon: <Images size={20} strokeWidth={2} />, label: "Gallery", count: photoCount },
    { mode: "type", icon: <Store size={19} strokeWidth={2} />, label: "Types", count: distinct("type") },
    { mode: "cuisine", icon: <UtensilsCrossed size={19} strokeWidth={2} />, label: "Cuisines", count: distinct("cuisine") },
    { mode: "staple", icon: <Pizza size={19} strokeWidth={2} />, label: "Staples", count: distinct("staple") },
    { mode: "area", icon: <MapPinned size={19} strokeWidth={2} />, label: "Areas", count: areaCount },
  ];

  const doExport = () => {
    onToast(`Exported ${downloadBackup()} places`);
    onClose();
  };

  const doImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (!window.confirm("Importing replaces everything currently on your map. Continue?")) return;
    try {
      const count = importData(await file.text());
      onToast(`Imported ${count} places`);
      onClose();
    } catch (err) {
      window.alert((err as Error).message);
    }
  };

  return (
    <div className="fixed inset-0 z-50" style={{ background: "rgba(10,8,12,0.64)" }} onClick={onClose}>
      <div
        ref={sheetRef}
        className="absolute inset-x-0 bottom-0 px-5 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-2"
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
        <div className="flex items-center justify-between pb-3">
          <h1
            className="text-[22px] font-medium leading-none tracking-[-0.01em]"
            style={{ fontFamily: "var(--font-display)", color: "var(--text-primary)" }}
          >
            Menu
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

        {/* browse — four lenses */}
        <p className="mb-2 text-[11px] font-bold uppercase tracking-[0.08em]" style={{ color: "var(--text-tertiary)" }}>
          Browse
        </p>
        <div className="grid grid-cols-2 gap-2.5">
          {tiles.map((t) => (
            <button
              key={t.mode}
              onClick={() => onOpenBrowse(t.mode)}
              className="press group flex items-center gap-3 rounded-[var(--radius)] px-3.5 py-3.5 text-left"
              style={{ background: "var(--bg-elevated)", border: "1px solid var(--ink-line)" }}
            >
              <span
                className="grid h-10 w-10 shrink-0 place-items-center rounded-[13px] border border-[var(--ink-line)] bg-[var(--bg-raised)] text-[var(--text-secondary)] transition-colors group-hover:border-transparent group-hover:bg-[oklch(0.97_0_0)] group-hover:text-[oklch(0.16_0.006_260)] group-active:border-transparent group-active:bg-[oklch(0.97_0_0)] group-active:text-[oklch(0.16_0.006_260)]"
              >
                {t.icon}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[15px] font-semibold tracking-[-0.01em]" style={{ color: "var(--text-primary)" }}>
                  {t.label}
                </span>
                <span className="block font-[family-name:var(--font-mono)] text-[11.5px]" style={{ color: "var(--text-tertiary)" }}>
                  {t.count}
                </span>
              </span>
            </button>
          ))}
        </div>

        {/* sync — records follow you across devices */}
        <p className="mb-2 mt-5 text-[11px] font-bold uppercase tracking-[0.08em]" style={{ color: "var(--text-tertiary)" }}>
          Sync
        </p>
        <SyncSection onToast={onToast} />

        {/* backup — the v1 insurance policy */}
        <p className="mb-2 mt-5 text-[11px] font-bold uppercase tracking-[0.08em]" style={{ color: "var(--text-tertiary)" }}>
          Backup
        </p>
        <div className="flex flex-col gap-2.5">
          <button
            onClick={doExport}
            className="press flex w-full items-center gap-3 rounded-[var(--radius)] px-3.5 py-3 text-left"
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
            <ChevronRight size={17} style={{ color: "var(--text-tertiary)" }} />
          </button>
          <button
            onClick={() => fileRef.current?.click()}
            className="press flex w-full items-center gap-3 rounded-[var(--radius)] px-3.5 py-3 text-left"
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
            <ChevronRight size={17} style={{ color: "var(--text-tertiary)" }} />
          </button>
        </div>

        {/* Dining attribution — same reason as the map one below: Cl. 3.4(ii) of
            the Swiggy agreement. This is the standing app-level notation; the
            per-surface ones live on the cards and sheets that show MCP data. */}
        <div className="mt-4 flex flex-wrap items-baseline gap-x-1.5 px-1">
          <span className="text-[11px]" style={{ color: "var(--text-tertiary)" }}>
            Dining discovery and table booking —
          </span>
          <PoweredBySwiggy />
        </div>

        {/* Map attribution is legally required to stay visible. */}
        <p className="mt-3 px-1 text-[11px]" style={{ color: "var(--text-tertiary)" }}>
          Map data ©{" "}
          <a href="https://carto.com/about-carto/" target="_blank" rel="noreferrer" className="underline">
            CARTO
          </a>
          , ©{" "}
          <a href="https://www.openstreetmap.org/about/" target="_blank" rel="noreferrer" className="underline">
            OpenStreetMap
          </a>{" "}
          contributors
        </p>
        <input ref={fileRef} type="file" accept="application/json,.json" hidden onChange={doImport} />
      </div>
    </div>
  );
}
