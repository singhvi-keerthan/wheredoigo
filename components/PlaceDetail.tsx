"use client";

import { useEffect, useRef, useState } from "react";
import {
  X, Navigation, Heart, Ban, Star, Plus, Camera, Trash2, MapPinOff, Check, Clapperboard, Pencil,
} from "lucide-react";
import {
  usePlace, updatePlace, toggleFavorite, toggleNeverAgain, setTags, addPhoto, removePhoto,
  removePlace, useCustomTags, addCustomTag,
} from "@/lib/store";
import { TAG_OPTIONS, NAMESPACE_LABELS, namespacesFor, type TagNamespace, type Tag } from "@/lib/types";
import { stateMeta, priceSigns, directionsUrl, relativeDate, photosSorted, hoursPill } from "@/lib/format";
import { enrichPlaceFromGoogle } from "@/lib/places";
import { resizeImage } from "@/lib/image";
import PlaceWizard from "./PlaceWizard";
import PhotoViewer from "./PhotoViewer";
import PlaceGlyph from "./PlaceGlyph";
import { useSheetDrag } from "./useSheetDrag";
import { PoweredBySwiggy } from "./PoweredBySwiggy";
import OpenInSwiggy from "./OpenInSwiggy";
import { StateLine, MetaLine, IgDot, WHITE_ACTION, INK_PILL, TAG_CHIP, litPill } from "./placeChrome";

const STALE_MS = 30 * 24 * 60 * 60 * 1000; // re-enrich after ~30 days

// The photo box takes the cover's own shape, clamped — the swipe card's rule,
// so a place's photo sits the same way here as on the deck. A portrait phone
// shot (3:4) lands near square rather than cropped to a letterbox; the whole
// picture is one tap away in the viewer.
const PHOTO_MIN = 0.85;
const PHOTO_MAX = 1.5;
const PHOTO_DEFAULT = 1.33;

// The place screen — the pin, opened. It starts on the photo, full-bleed to
// the sheet's own edges (the card's hero), and everything else reads down from
// the name in the type hierarchy: serif name, mono data, sans prose. No
// section eyebrows, no rules, no boxed fields: the rhythm is spacing and
// weight, and every edit happens in place on the thing being edited.
export default function PlaceDetail({ id, onClose }: { id: string | null; onClose: () => void }) {
  const place = usePlace(id);
  const customTags = useCustomTags();
  const uploadRef = useRef<HTMLInputElement>(null);
  const enrichedRef = useRef<string | null>(null);
  const [editingTags, setEditingTags] = useState(false);
  const [editingNote, setEditingNote] = useState(false);
  const [editingReel, setEditingReel] = useState(false);
  const [visitWizard, setVisitWizard] = useState(false); // guided watchlist → visited form
  const [viewerIndex, setViewerIndex] = useState<number | null>(null);
  const [shot, setShot] = useState(0); // which photo the hero is on
  const [ratio, setRatio] = useState<number | null>(null);
  const { sheetRef, handleProps } = useSheetDrag(onClose);

  // Refresh Google rating / price / hours / lowdown + cover photo when a linked
  // place opens and its cached data is missing or stale (~30 days). Runs once
  // per place per open; never overwrites your own data.
  const placeId = place?.id ?? null;
  const googleId = place?.googlePlaceId ?? null;
  const enrichedAt = place?.enrichedAt ?? null;
  useEffect(() => {
    if (!placeId || !googleId) return;
    if (enrichedRef.current === placeId) return;
    const fresh = enrichedAt && Date.now() - new Date(enrichedAt).getTime() < STALE_MS;
    if (fresh) return;
    enrichedRef.current = placeId;
    void enrichPlaceFromGoogle(placeId, googleId);
  }, [placeId, googleId, enrichedAt]);

  // Escape closes the sheet — unless something that opened on top of it
  // (the viewer, the visit form) is taking that key for itself. A field being
  // typed into saves on blur, so the first Escape leaves the field (which
  // commits it) and the next one closes; closing straight away would unmount
  // the field with the edit still in it.
  const open = !!place;
  const covered = viewerIndex !== null || visitWizard;
  useEffect(() => {
    if (!open || covered) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      const el = document.activeElement;
      if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
        el.blur();
        return;
      }
      onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, covered, onClose]);

  if (!place) return null;
  const meta = stateMeta(place);
  const visited = place.status === "visited";
  const photos = photosSorted(place);
  // Google lists Mon-first. Shown only when the state line can't say the hours
  // itself (hoursText with no openingPeriods — older records).
  const todayHours = !hoursPill(place) ? place.hoursText?.[(new Date().getDay() + 6) % 7] : undefined;

  const hasTag = (t: Tag) => place.tags.some((x) => x.namespace === t.namespace && x.value === t.value);
  const toggleTag = (ns: TagNamespace, value: string) => {
    const exists = hasTag({ namespace: ns, value });
    setTags(
      place.id,
      exists
        ? place.tags.filter((x) => !(x.namespace === ns && x.value === value))
        : [...place.tags, { namespace: ns, value }]
    );
  };

  // Place-scoped photos. One picker: the OS offers the camera and the library
  // itself. Each file is resized sequentially (low peak memory); bad frames skip.
  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    e.target.value = "";
    for (const file of files) {
      try {
        const dataUrl = await resizeImage(file);
        addPhoto(place.id, { dataUrl, source: "mine", scope: "place", visitId: null });
      } catch {
        /* ignore bad image */
      }
    }
  };
  const pickPhoto = () => uploadRef.current?.click();

  return (
    <>
    <div className="fixed inset-0 z-40" style={{ background: "rgba(6,7,10,0.62)" }} onClick={onClose}>
      <div
        ref={sheetRef}
        className="scroll-quiet absolute inset-x-0 bottom-0 max-h-[92dvh] overflow-y-auto overflow-x-hidden pb-[max(1.5rem,env(safe-area-inset-bottom))]"
        style={{ background: "var(--sheet)", borderTopLeftRadius: "var(--radius-lg)", borderTopRightRadius: "var(--radius-lg)", boxShadow: "var(--shadow-sheet)" }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* The grab handle rides on the photo and scrolls away with it; only
            the close stays put, as a glass circle that reads over a picture
            and over text alike. A sticky handle would sit on the name once
            the sheet is scrolled. */}
        <div {...handleProps} className="absolute inset-x-0 top-0 z-10 flex cursor-grab touch-none justify-center pb-3 pt-2.5">
          <span className="h-[5px] w-10 rounded-full" style={{ background: "rgba(255,255,255,0.55)", boxShadow: "0 1px 4px rgba(0,0,0,0.35)" }} />
        </div>
        <div className="sticky top-0 z-10 h-0">
          <button
            onClick={onClose}
            aria-label="Close"
            className="press absolute right-4 top-3 grid h-9 w-9 place-items-center rounded-full"
            style={{ background: "rgba(10,11,16,0.45)", color: "#fff", backdropFilter: "blur(14px)", WebkitBackdropFilter: "blur(14px)" }}
          >
            <X size={15} strokeWidth={2.25} />
          </button>
        </div>

        {/* ---- the photo, the card's way: full-bleed, at its own shape ---- */}
        {photos.length > 0 ? (
          <div
            className="relative w-full overflow-hidden"
            style={{
              aspectRatio: String(ratio ?? PHOTO_DEFAULT),
              maxHeight: "46vh",
              background: "var(--bg-elevated)",
              borderTopLeftRadius: "var(--radius-lg)",
              borderTopRightRadius: "var(--radius-lg)",
            }}
          >
            <div
              onScroll={(e) => {
                const el = e.currentTarget;
                setShot(Math.round(el.scrollLeft / el.clientWidth));
              }}
              className="scroll-quiet flex h-full w-full snap-x snap-mandatory overflow-x-auto"
            >
              {photos.map((ph, i) => (
                <button
                  key={ph.id}
                  onClick={() => setViewerIndex(i)}
                  aria-label="View photo"
                  className="h-full w-full shrink-0 snap-center"
                >
                  <img
                    src={ph.dataUrl}
                    alt=""
                    draggable={false}
                    className="h-full w-full object-cover"
                    onLoad={
                      i === 0
                        ? (e) => {
                            const img = e.currentTarget;
                            if (!img.naturalWidth || !img.naturalHeight) return;
                            setRatio(Math.min(PHOTO_MAX, Math.max(PHOTO_MIN, img.naturalWidth / img.naturalHeight)));
                          }
                        : undefined
                    }
                  />
                </button>
              ))}
            </div>
            {/* feather into the sheet, so the photo ends as an edge of the
                page rather than a seam against the name */}
            <div
              className="pointer-events-none absolute inset-x-0 bottom-0 h-14"
              style={{ background: "linear-gradient(0deg, var(--sheet), transparent)" }}
            />
            {photos.length > 1 && (
              <div className="pointer-events-none absolute inset-x-0 bottom-0 flex gap-1.5 px-5 pb-3">
                {photos.map((ph, i) => (
                  <span
                    key={ph.id}
                    className="h-[3px] flex-1 rounded-full"
                    style={{
                      background: i === shot ? "rgba(255,255,255,0.95)" : "rgba(255,255,255,0.3)",
                      transition: "background 0.2s ease",
                    }}
                  />
                ))}
              </div>
            )}
          </div>
        ) : (
          // No photo yet: the pin itself, blown up on its own colour — the one
          // place colour on the sheet — and the invitation to give it one.
          <div
            className="grid h-[184px] w-full place-items-center"
            style={{
              background: `linear-gradient(180deg, color-mix(in srgb, ${meta.color} 28%, var(--sheet)), var(--sheet))`,
              borderTopLeftRadius: "var(--radius-lg)",
              borderTopRightRadius: "var(--radius-lg)",
            }}
          >
            <div className="flex flex-col items-center gap-3.5 pt-4">
              <span
                className="grid place-items-center"
                style={{ width: 62, height: 62, borderRadius: 19, background: meta.color, color: "#fff", boxShadow: "0 12px 26px -10px rgba(0,0,0,0.55)" }}
              >
                <PlaceGlyph place={place} size={28} strokeWidth={2} />
              </span>
              <button onClick={pickPhoto} className="press inline-flex h-11 items-center gap-1.5 px-4 text-[13px] font-semibold" style={INK_PILL}>
                <Camera size={14} strokeWidth={2.25} /> Add a photo
              </button>
            </div>
          </div>
        )}

        <div className="relative px-5 pt-3">
          {/* ---- who this is ---- */}
          <StateLine place={place} />
          <h1
            className="mt-1 text-[34px] leading-[1.02] tracking-[-0.01em]"
            style={{ fontFamily: "var(--font-serif)", color: "var(--text-primary)" }}
          >
            {place.name}
          </h1>
          {place.address && (
            <p className="mt-1 text-[13px]" style={{ color: "var(--text-tertiary)" }}>{place.address}</p>
          )}
          {/* No area here: the address line and the pin note above already
              say where, and the data line should not say it a third time. */}
          <MetaLine place={place} where={false} className="mt-2" />
          {/* The address can be exact while the pin isn't — Swiggy gives one and
              not the other. Directions below navigates to the pin, so this has
              to be said before someone drives to it. */}
          {place.approxLocation && (
            <p className="mt-1.5 inline-flex items-center gap-1.5 text-[12px]" style={{ color: "var(--text-tertiary)" }}>
              <MapPinOff size={12} strokeWidth={2.25} />
              Approximate pin — not the exact spot
            </p>
          )}
          {todayHours && (
            <p className="mt-1.5 text-[12px]" style={{ color: "var(--text-tertiary)" }}>
              Today {todayHours.replace(/^[A-Za-z]+:\s*/, "")}
            </p>
          )}

          {/* ---- one row: the thing to press, then your calls ---- */}
          <div className="mt-4 flex items-center gap-2">
            <a
              href={directionsUrl(place)} target="_blank" rel="noreferrer"
              className="press flex h-12 min-w-0 flex-1 items-center justify-center gap-2 text-[14px] font-bold"
              style={WHITE_ACTION}
            >
              <Navigation size={15} strokeWidth={2.5} fill="currentColor" /> Directions
            </a>
            <button
              onClick={() => toggleFavorite(place.id)} aria-label="Favorite" aria-pressed={place.favorite}
              className="press grid h-12 w-12 shrink-0 place-items-center"
              style={place.favorite ? litPill("var(--s-favorite)") : INK_PILL}
            >
              <Heart size={18} fill={place.favorite ? "currentColor" : "none"} />
            </button>
            <button
              onClick={() => toggleNeverAgain(place.id)} aria-label="Never again" aria-pressed={place.neverAgain}
              className="press grid h-12 w-12 shrink-0 place-items-center"
              style={place.neverAgain ? litPill("var(--s-never)") : INK_PILL}
            >
              <Ban size={18} />
            </button>
            {photos.length > 0 && (
              <button onClick={pickPhoto} aria-label="Add a photo" className="press grid h-12 w-12 shrink-0 place-items-center" style={INK_PILL}>
                <Camera size={17} strokeWidth={2} />
              </button>
            )}
          </div>
          <input ref={uploadRef} type="file" accept="image/*" multiple hidden onChange={onFile} />

          {/* ---- where it came from: the reel, Swiggy ---- */}
          {editingReel ? (
            <div className="mt-3 flex items-center gap-2.5" style={{ borderBottom: "1px solid var(--border-strong)" }}>
              <Clapperboard size={16} strokeWidth={2} className="shrink-0" style={{ color: "var(--text-tertiary)" }} />
              <input
                autoFocus
                defaultValue={place.reelUrl ?? ""}
                inputMode="url"
                placeholder="Paste the Instagram reel link"
                onBlur={(e) => { updatePlace(place.id, { reelUrl: e.target.value.trim() || undefined }); setEditingReel(false); }}
                onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
                className="min-w-0 flex-1 bg-transparent py-3 text-[14px] outline-none"
                style={{ color: "var(--text-primary)" }}
              />
            </div>
          ) : (
            <div className="mt-2.5 flex flex-wrap items-center gap-2">
              {place.reelUrl ? (
                <>
                  <a
                    href={place.reelUrl} target="_blank" rel="noreferrer"
                    className="press inline-flex h-11 items-center gap-2 pl-3 pr-4 text-[13.5px] font-semibold"
                    style={INK_PILL}
                  >
                    <IgDot size={20} /> Watch on Instagram
                  </a>
                  <button
                    onClick={() => setEditingReel(true)} aria-label="Edit reel link"
                    className="press grid h-11 w-11 place-items-center"
                    style={{ ...INK_PILL, color: "var(--text-tertiary)" }}
                  >
                    <Pencil size={13} />
                  </button>
                </>
              ) : (
                <button
                  onClick={() => setEditingReel(true)}
                  className="press inline-flex h-11 items-center gap-1.5 pr-2 text-[13px] font-medium"
                  style={{ color: "var(--text-tertiary)" }}
                >
                  <Clapperboard size={14} strokeWidth={2.25} /> Add the reel it came from
                </button>
              )}
              <OpenInSwiggy place={place} />
            </div>
          )}

          {/* ---- your note: the first thing in your own words ---- */}
          <div className="mt-7">
            {editingNote || !place.notes ? (
              <textarea
                autoFocus={editingNote}
                defaultValue={place.notes}
                onBlur={(e) => { updatePlace(place.id, { notes: e.target.value }); setEditingNote(false); }}
                placeholder="Why you saved it — what to order, who to bring, when to go…"
                rows={2}
                className="w-full resize-none bg-transparent pb-2 text-[17px] italic leading-snug outline-none"
                style={{ fontFamily: "var(--font-serif)", color: "var(--text-primary)", borderBottom: "1px solid var(--ink-line)" }}
              />
            ) : (
              <p
                onClick={() => setEditingNote(true)}
                className="cursor-text text-[18px] italic leading-snug"
                style={{ fontFamily: "var(--font-serif)", color: "var(--text-primary)" }}
              >
                “{place.notes}”
              </p>
            )}
          </div>

          {/* ---- the lowdown: Google's line, the research on a place you
                 haven't been to yet ---- */}
          {place.summary && (
            <div className="mt-5">
              <p className="text-[14.5px] leading-relaxed" style={{ color: "var(--text-secondary)" }}>{place.summary}</p>
              <p className="mt-1 text-[11px]" style={{ fontFamily: "var(--font-mono)", color: "var(--text-tertiary)" }}>via Google</p>
            </div>
          )}

          {/* ---- tags: the map's chips, edited in place ---- */}
          <div className="mt-6">
            <div className="flex flex-wrap items-center gap-1.5">
              {place.tags.map((t) => (
                <span key={t.namespace + t.value} className="px-3 py-[6px] text-[12.5px]" style={TAG_CHIP}>
                  {t.value}
                </span>
              ))}
              <button
                onClick={() => setEditingTags((v) => !v)}
                className="press inline-flex items-center gap-1 px-3 py-[6px] text-[12px] font-semibold"
                style={{ borderRadius: "var(--radius-chip)", border: "1px solid var(--border-strong)", color: "var(--text-secondary)" }}
              >
                {editingTags ? (
                  <><Check size={11} strokeWidth={3} /> Done</>
                ) : (
                  <><Pencil size={11} strokeWidth={2.5} /> {place.tags.length ? "Edit tags" : "Add tags"}</>
                )}
              </button>
            </div>
            {editingTags && (
              <div className="mt-4 flex flex-col gap-3.5">
                {/* Same rule the visit form uses: a viewpoint has no cuisine
                    and no staple dish, so it isn't asked for one. Tag a place
                    café or restaurant and both rows come back. */}
                {namespacesFor(place.tags).map((ns) => {
                  const options = Array.from(new Set([...TAG_OPTIONS[ns], ...customTags[ns]]));
                  return (
                    <TagGroup
                      key={ns}
                      label={NAMESPACE_LABELS[ns]}
                      options={options}
                      isOn={(value) => hasTag({ namespace: ns, value })}
                      onToggle={(value) => toggleTag(ns, value)}
                      onAdd={(raw) => {
                        const value = addCustomTag(ns, raw);
                        if (value && !hasTag({ namespace: ns, value })) toggleTag(ns, value);
                      }}
                    />
                  );
                })}
              </div>
            )}
          </div>

          {/* ---- your take, then the reference it sits against ---- */}
          <div className="mt-6">
            {visited ? (
              <div className="flex items-center justify-between gap-3">
                <Stars value={place.myRating} onSet={(n) => updatePlace(place.id, { myRating: n })} />
                <label className="flex items-center gap-1 text-[13px]" style={{ fontFamily: "var(--font-mono)" }}>
                  <span style={{ color: "var(--text-tertiary)" }}>₹</span>
                  <input
                    type="number" inputMode="numeric" defaultValue={place.myBudgetPerPerson ?? ""}
                    onBlur={(e) => updatePlace(place.id, { myBudgetPerPerson: e.target.value ? +e.target.value : null })}
                    placeholder="—"
                    className="w-16 bg-transparent text-right outline-none"
                    style={{ color: "var(--text-primary)", borderBottom: "1px solid var(--ink-line)" }}
                  />
                  <span style={{ color: "var(--text-tertiary)" }}>/ person</span>
                </label>
              </div>
            ) : (
              <button
                onClick={() => setVisitWizard(true)}
                className="press inline-flex h-11 items-center gap-2 px-4 text-[13.5px] font-semibold"
                style={INK_PILL}
              >
                <Check size={15} strokeWidth={2.5} /> Been here? Log it
              </button>
            )}
            <p className="mt-2.5 text-[12px]" style={{ fontFamily: "var(--font-mono)", color: "var(--text-tertiary)" }}>
              {[
                place.googleRating != null ? `★ ${place.googleRating.toFixed(1)}` : "Unrated",
                place.googlePriceLevel != null ? priceSigns(place.googlePriceLevel) : null,
                place.source === "swiggy" ? "Swiggy" : "Google",
              ]
                .filter(Boolean)
                .join(" · ")}
            </p>
            {/* Cl. 3.4(ii) — saved, but the reference data is still Swiggy's. */}
            {place.source === "swiggy" && <PoweredBySwiggy className="mt-1" />}
          </div>

          {/* ---- visits ---- */}
          {(place.visits.length > 0 || visited) && (
            <div className="mt-6">
              {place.visits.map((v) => (
                <div key={v.id} className="py-2.5" style={{ borderTop: "1px solid var(--ink-line)" }}>
                  <div className="flex items-center gap-2 text-[12.5px]">
                    <span className="font-semibold" style={{ color: "var(--text-primary)" }}>{relativeDate(v.visitedOn)}</span>
                    {v.whoWith && <span style={{ color: "var(--text-tertiary)" }}>with {v.whoWith}</span>}
                    {v.rating != null && (
                      <span className="ml-auto inline-flex items-center gap-0.5" style={{ fontFamily: "var(--font-mono)", color: "var(--star)" }}>
                        <Star size={11} fill="currentColor" strokeWidth={0} /> {v.rating}
                      </span>
                    )}
                  </div>
                  {v.notes && <p className="mt-0.5 text-[13.5px]" style={{ color: "var(--text-secondary)" }}>{v.notes}</p>}
                </div>
              ))}
              <button
                onClick={() => setVisitWizard(true)}
                className="press mt-1 inline-flex items-center gap-1.5 text-[13px] font-semibold"
                style={{ color: "var(--text-secondary)" }}
              >
                <Plus size={14} strokeWidth={2.5} /> Log a visit
              </button>
            </div>
          )}

          {/* the only destructive action — quiet, at the very bottom */}
          <button
            onClick={() => {
              if (window.confirm(`Remove “${place.name}” and its photos from your map?`)) {
                removePlace(place.id);
                onClose();
              }
            }}
            className="press mt-9 flex w-full items-center justify-center gap-1.5 py-3 text-[12.5px] font-medium"
            style={{ color: "var(--text-tertiary)" }}
          >
            <Trash2 size={13} /> Remove from map
          </button>
        </div>
      </div>
    </div>
    {visitWizard && (
      <PlaceWizard placeId={place.id} onClose={() => setVisitWizard(false)} />
    )}
    {viewerIndex !== null && (
      <PhotoViewer
        name={place.name}
        photos={photos}
        startIndex={viewerIndex}
        onClose={() => setViewerIndex(null)}
        onDelete={(id) => removePhoto(place.id, id)}
      />
    )}
    </>
  );
}

function Stars({ value, onSet }: { value: number | null; onSet: (n: number) => void }) {
  return (
    <div className="flex gap-1">
      {[1, 2, 3, 4, 5].map((n) => (
        <button key={n} onClick={() => onSet(n)} aria-label={`${n} stars`} className="press">
          <Star
            size={22}
            strokeWidth={1.5}
            fill={value != null && n <= Math.round(value) ? "var(--star)" : "none"}
            style={{ color: value != null && n <= Math.round(value) ? "var(--star)" : "var(--star-empty)" }}
          />
        </button>
      ))}
    </div>
  );
}

// A tag namespace: selectable chips + an inline "add" that persists a new value.
function TagGroup({
  label,
  options,
  isOn,
  onToggle,
  onAdd,
}: {
  label: string;
  options: string[];
  isOn: (v: string) => boolean;
  onToggle: (v: string) => void;
  onAdd: (v: string) => void;
}) {
  const [adding, setAdding] = useState(false);
  const [val, setVal] = useState("");
  const commit = () => {
    const v = val.trim();
    if (v) onAdd(v);
    setVal("");
    setAdding(false);
  };
  return (
    <div>
      <p className="mb-2 text-[12.5px] font-medium" style={{ color: "var(--text-tertiary)" }}>
        {label}
      </p>
      <div className="flex flex-wrap gap-1.5">
        {options.map((value) => {
          const on = isOn(value);
          return (
            <button
              key={value}
              onClick={() => onToggle(value)}
              className="press inline-flex items-center gap-1 px-3 py-[7px] text-[12px] font-medium transition-colors"
              style={{
                // tags are NEUTRAL, never a state/accent hue (tag ≠ state)
                borderRadius: "var(--radius-chip)",
                background: on ? "oklch(0.97 0 0)" : "rgba(255,255,255,0.07)",
                color: on ? "oklch(0.16 0.006 260)" : "var(--text-secondary)",
              }}
            >
              {on && <Check size={11} strokeWidth={3} />}
              {value}
            </button>
          );
        })}
        {adding ? (
          <input
            autoFocus
            value={val}
            onChange={(e) => setVal(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") commit();
              if (e.key === "Escape") {
                e.stopPropagation();
                setVal("");
                setAdding(false);
              }
            }}
            onBlur={commit}
            placeholder="new tag"
            className="px-3 py-[7px] text-[12px] outline-none"
            style={{
              width: 100,
              borderRadius: "var(--radius-chip)",
              background: "rgba(255,255,255,0.07)",
              color: "var(--text-primary)",
              border: "1px solid var(--border-strong)",
            }}
          />
        ) : (
          <button
            onClick={() => setAdding(true)}
            className="press inline-flex items-center gap-1 px-3 py-[7px] text-[12px] font-semibold"
            style={{ borderRadius: "var(--radius-chip)", border: "1px solid var(--border-strong)", color: "var(--text-secondary)" }}
          >
            <Plus size={12} strokeWidth={2.5} /> add
          </button>
        )}
      </div>
    </div>
  );
}
