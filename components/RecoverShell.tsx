"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, RotateCcw, Download, HardDriveDownload, Check } from "lucide-react";
import { snapshotForSync, restorePlaces } from "@/lib/store";
import { scanForLostData, hydratePhotos, type RecoveryReport, type OrphanPhoto } from "@/lib/recover";
import { sync } from "@/lib/sync/client";
import type { Place } from "@/lib/types";

// The screen that looks in the places the app writes to and never reads back.
//
// It exists because on 2026-09-06 an evening's entries were lost and there was
// no way to ask the only device that could still have had them. The server was
// provably clean and the phone had no interface for its own leftovers, so the
// honest answer was "gone" without anyone ever having looked.
//
// It is deliberately a whole screen at a typed URL rather than a Menu row: this
// is a thing you reach for on a bad day, from a phone, possibly reading the URL
// off another screen — and it should not cost a row in a menu everyone else
// sees on a good day.
//
// Nothing here writes until you press Put back. The scan is read-only.

const CARD = {
  background: "var(--bg-elevated)",
  border: "1px solid var(--ink-line)",
  borderRadius: "var(--radius)",
} as const;

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString(undefined, {
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
  });
}

const KIND_LABEL: Record<string, string> = {
  live: "the current library",
  corrupt: "an unreadable copy the app set aside",
  legacy: "the pre-rename library",
  "legacy-corrupt": "an unreadable pre-rename copy",
};

function Eyebrow({ children }: { children: React.ReactNode }) {
  return (
    <p
      className="mb-2 text-[11px] uppercase"
      style={{ fontFamily: "var(--font-mono)", letterSpacing: "0.08em", color: "var(--accent)" }}
    >
      {children}
    </p>
  );
}

// One found place, shown the way the map would show it: the name in the serif
// that means "a place", the facts in mono under it.
//
// The name gets the full width and is allowed to wrap. It shared a line with
// the status column first, and a long one lost — "Legacy Brewing Comp…" beside
// a roomy "been · 1 photo · 1 visit". On a screen whose entire job is telling
// someone which of their places came back, the name is the subject and the
// count is the footnote; the layout should not let the footnote win.
function FoundPlace({ place }: { place: Place }) {
  const photos = place.photos?.length ?? 0;
  const visits = place.visits?.length ?? 0;
  const facts = [
    place.status === "visited" ? "been" : "watchlist",
    photos > 0 ? `${photos} photo${photos > 1 ? "s" : ""}` : null,
    visits > 0 ? `${visits} visit${visits > 1 ? "s" : ""}` : null,
    place.area || place.city || null,
    `added ${fmtDate(place.createdAt)}`,
  ].filter(Boolean);

  return (
    <li className="py-2.5">
      <p
        className="text-[17px] leading-tight"
        style={{ fontFamily: "var(--font-serif)", color: "var(--text-primary)" }}
      >
        {place.name}
      </p>
      <p
        className="mt-1 text-[11.5px] leading-snug"
        style={{ fontFamily: "var(--font-mono)", color: "var(--text-tertiary)" }}
      >
        {facts.join(" · ")}
      </p>
    </li>
  );
}

export default function RecoverShell() {
  const [report, setReport] = useState<RecoveryReport | null>(null);
  const [scanning, setScanning] = useState(true);
  const [restored, setRestored] = useState<number | null>(null);
  const [viewing, setViewing] = useState<OrphanPhoto | null>(null);
  const [failed, setFailed] = useState<string | null>(null);

  // Measured against the FULL local set, tombstones included — a place deleted
  // on purpose is not a place that went missing, and offering to put it back
  // would undo a decision.
  const scan = useCallback(async (alive: () => boolean) => {
    try {
      const r = await scanForLostData(snapshotForSync());
      if (alive()) setReport(r);
    } catch (e) {
      if (alive()) setFailed(e instanceof Error ? e.message : String(e));
    } finally {
      if (alive()) setScanning(false);
    }
  }, []);

  // No state written before the first await, and nothing written after the
  // screen is gone: an unmounted scan resolving into setState is a cascade the
  // component can neither see nor use. Same shape as SwipeMode's deck load —
  // the async work is declared inside the effect and only awaited results
  // reach setState.
  useEffect(() => {
    let cancelled = false;
    const first = async () => {
      await scan(() => !cancelled);
    };
    void first();
    return () => {
      cancelled = true;
    };
  }, [scan]);

  // The Scan again button — an event handler, so the flip to "scanning" here is
  // a response to a press rather than a render-time write.
  const run = useCallback(async () => {
    setScanning(true);
    setFailed(null);
    await scan(() => true);
  }, [scan]);

  const putBack = async () => {
    if (!report?.missing.length) return;
    // Photo bytes come back with the record. They are in IndexedDB keyed by
    // photo id and the recovered record still names them, so a restore without
    // this step would return a set of empty frames.
    const withPhotos = await hydratePhotos(report.missing);
    const n = restorePlaces(withPhotos);
    setRestored(n);
    void sync(); // these never reached the server — send them now
    await run();
  };

  const downloadFound = () => {
    if (!report) return;
    const payload = {
      app: "wheredoigokeerthan",
      kind: "recovery-scan",
      scannedAt: new Date().toISOString(),
      missing: report.missing,
      danglingDirty: report.danglingDirty,
      orphanPhotos: report.photos.orphans,
      stores: report.stores.map((s) => ({
        key: s.key,
        kind: s.kind,
        savedAt: s.savedAt,
        places: s.places.length,
        bytes: s.bytes,
        salvaged: s.salvaged,
      })),
    };
    const blob = new Blob([JSON.stringify(payload)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `wheredoigo-recovery-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const nothing =
    report && !report.missing.length && !report.photos.orphans.length && !report.danglingDirty.length;

  return (
    <main
      className="min-h-full w-full"
      style={{ background: "var(--bg-base)", color: "var(--text-primary)" }}
    >
      <div className="mx-auto w-full max-w-[560px] px-5 pb-24 pt-[max(1rem,env(safe-area-inset-top))]">
        <Link
          href="/app"
          className="press mb-5 inline-flex items-center gap-1.5 text-[13px]"
          style={{ color: "var(--text-secondary)" }}
        >
          <ArrowLeft size={15} /> Back to the map
        </Link>

        <h1
          className="text-[28px] leading-none"
          style={{ fontFamily: "var(--font-display)", fontWeight: 500 }}
        >
          Recovery
        </h1>
        <p className="mt-2 text-[13.5px] leading-snug" style={{ color: "var(--text-secondary)" }}>
          Looks in the places this app writes to and never reads back — set-aside copies of an
          unreadable library, photos whose place is gone, and anything queued to sync that has
          nothing behind it. Nothing is changed until you press Put back.
        </p>

        {scanning && (
          <p className="mt-8 text-[13px]" style={{ color: "var(--text-tertiary)" }}>
            Reading this device…
          </p>
        )}

        {failed && (
          <div className="mt-6 p-4" style={{ ...CARD, borderColor: "oklch(0.62 0.2 25)" }}>
            <p className="text-[13.5px]">The scan itself failed: {failed}</p>
          </div>
        )}

        {report && !scanning && (
          <>
            {restored !== null && (
              <div
                className="mt-6 flex items-center gap-2 p-4"
                style={{ ...CARD, borderColor: "var(--s-visited)" }}
              >
                <Check size={16} style={{ color: "var(--s-visited)" }} />
                <p className="text-[13.5px]">
                  {restored > 0
                    ? `${restored} put back on your map and pushed to sync.`
                    : "Nothing needed putting back — the map already had the newer copy."}
                </p>
              </div>
            )}

            {nothing && (
              <div className="mt-6 p-4" style={{ ...CARD }}>
                <p className="text-[14px]">This device is holding nothing the map isn&rsquo;t showing.</p>
                <p className="mt-1.5 text-[13px] leading-snug" style={{ color: "var(--text-secondary)" }}>
                  No set-aside copy, no orphaned photos, no queued record without a place behind it.
                  Whatever was lost was gone from here before this screen existed — it is not hiding
                  somewhere the app can reach.
                </p>
              </div>
            )}

            {report.missing.length > 0 && (
              <section className="mt-8">
                <Eyebrow>
                  {report.missing.length} place{report.missing.length > 1 ? "s" : ""} not on your map
                </Eyebrow>
                <div className="px-4 py-1" style={CARD}>
                  <ul className="divide-y" style={{ borderColor: "var(--ink-line)" }}>
                    {report.missing.map((p) => (
                      <FoundPlace key={p.id} place={p} />
                    ))}
                  </ul>
                </div>
                <button
                  onClick={putBack}
                  className="press mt-3 inline-flex w-full items-center justify-center gap-2 py-3 text-[14px] font-bold"
                  style={{
                    background: "oklch(0.97 0 0)",
                    color: "oklch(0.16 0.006 260)",
                    border: "none",
                    borderRadius: "var(--radius-chip)",
                    cursor: "pointer",
                  }}
                >
                  <RotateCcw size={15} /> Put {report.missing.length} back on the map
                </button>
              </section>
            )}

            {report.photos.orphans.length > 0 && (
              <section className="mt-8">
                <Eyebrow>
                  {report.photos.orphans.length} photo{report.photos.orphans.length > 1 ? "s" : ""}{" "}
                  belonging to nothing
                </Eyebrow>
                <p className="mb-3 text-[13px] leading-snug" style={{ color: "var(--text-secondary)" }}>
                  Still on this device, but no place on the map claims them. Tap one to open it full
                  size, then press and hold to save it to your camera roll.
                </p>
                <div className="grid grid-cols-3 gap-2">
                  {report.photos.orphans.map((ph) => (
                    <button
                      key={ph.id}
                      onClick={() => setViewing(ph)}
                      className="press overflow-hidden"
                      style={{
                        borderRadius: "var(--radius-sm)",
                        border: "1px solid var(--ink-line)",
                        aspectRatio: "1",
                        padding: 0,
                        cursor: "pointer",
                        background: "var(--bg-raised)",
                      }}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={ph.dataUrl}
                        alt=""
                        className="h-full w-full object-cover"
                        draggable={false}
                      />
                    </button>
                  ))}
                </div>
              </section>
            )}

            {report.danglingDirty.length > 0 && (
              <section className="mt-8">
                <Eyebrow>{report.danglingDirty.length} queued to sync with nothing behind them</Eyebrow>
                <div className="p-4" style={CARD}>
                  <p className="text-[13px] leading-snug" style={{ color: "var(--text-secondary)" }}>
                    The app still has these marked as needing to be pushed, but the records
                    themselves are not on this device. Each one is a place that was added and then
                    lost before it went up — this is the loss, in the app&rsquo;s own bookkeeping.
                    The ids are all that survive; they carry no name.
                  </p>
                  <p
                    className="mt-2.5 break-all text-[11px]"
                    style={{ fontFamily: "var(--font-mono)", color: "var(--text-tertiary)" }}
                  >
                    {report.danglingDirty.join(", ")}
                  </p>
                </div>
              </section>
            )}

            <section className="mt-8">
              <Eyebrow>Where it looked</Eyebrow>
              <div className="p-4" style={CARD}>
                <ul className="space-y-2.5">
                  {report.stores.map((s) => (
                    <li key={s.key} className="text-[12.5px] leading-snug">
                      <span style={{ fontFamily: "var(--font-mono)", color: "var(--text-secondary)" }}>
                        {s.places.length}
                      </span>{" "}
                      <span style={{ color: "var(--text-secondary)" }}>
                        place{s.places.length === 1 ? "" : "s"} in {KIND_LABEL[s.kind] ?? s.kind}
                      </span>
                      <span style={{ color: "var(--text-tertiary)" }}>
                        {" · "}
                        {fmtBytes(s.bytes)}
                        {s.savedAt ? ` · set aside ${fmtDate(s.savedAt)}` : ""}
                        {s.salvaged ? " · recovered object-by-object" : ""}
                      </span>
                    </li>
                  ))}
                  <li className="text-[12.5px]" style={{ color: "var(--text-secondary)" }}>
                    <span style={{ fontFamily: "var(--font-mono)" }}>{report.photos.total}</span>
                    {` photo${report.photos.total === 1 ? "" : "s"} in this device’s photo store`}
                  </li>
                </ul>
                {report.errors.length > 0 && (
                  <p className="mt-3 text-[12px]" style={{ color: "oklch(0.75 0.15 60)" }}>
                    Could not read: {report.errors.join("; ")}
                  </p>
                )}
              </div>
            </section>

            <div className="mt-6 flex gap-2">
              {/* Offered only when there is something to save. A download button
                  over an empty result is a promise the file cannot keep. */}
              {!nothing && (
                <button
                  onClick={downloadFound}
                  className="press flex flex-1 items-center justify-center gap-2 py-2.5 text-[13px] font-semibold"
                  style={{
                    background: "var(--bg-elevated)",
                    color: "var(--text-primary)",
                    border: "1px solid var(--ink-line)",
                    borderRadius: "var(--radius-chip)",
                    cursor: "pointer",
                  }}
                >
                  <Download size={14} /> Save what it found
                </button>
              )}
              <button
                onClick={run}
                className="press flex items-center justify-center gap-2 px-4 py-2.5 text-[13px] font-semibold"
                style={{
                  background: "var(--bg-elevated)",
                  color: "var(--text-primary)",
                  border: "1px solid var(--ink-line)",
                  borderRadius: "var(--radius-chip)",
                  cursor: "pointer",
                }}
              >
                <HardDriveDownload size={14} /> Scan again
              </button>
            </div>
          </>
        )}
      </div>

      {viewing && (
        <div
          className="fixed inset-0 z-50 grid place-items-center p-4"
          style={{ background: "rgba(6,7,10,0.92)" }}
          onClick={() => setViewing(null)}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={viewing.dataUrl}
            alt=""
            className="max-h-full max-w-full object-contain"
            style={{ borderRadius: "var(--radius-sm)" }}
          />
          <p
            className="absolute inset-x-0 bottom-[max(1.5rem,env(safe-area-inset-bottom))] text-center text-[12px]"
            style={{ color: "var(--text-secondary)" }}
          >
            Press and hold to save · tap anywhere to close
          </p>
        </div>
      )}

    </main>
  );
}
