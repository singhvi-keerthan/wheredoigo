"use client";

import { useEffect, useRef, useState } from "react";
import {
  X, Navigation, Heart, Ban, Star, Plus, ImagePlus, Camera, Trash2, MapPin, Check, Clapperboard, Play, Pencil,
} from "lucide-react";
import {
  usePlace, updatePlace, toggleFavorite, toggleNeverAgain, setTags, addPhoto, removePhoto,
  removePlace, useCustomTags, addCustomTag,
} from "@/lib/store";
import { TAG_OPTIONS, NAMESPACE_LABELS, isOpenNow, namespacesFor, type TagNamespace, type Tag } from "@/lib/types";
import { stateMeta, priceSigns, directionsUrl, relativeDate, photosSorted } from "@/lib/format";
import { enrichPlaceFromGoogle } from "@/lib/places";
import { resizeImage } from "@/lib/image";
import PlaceWizard from "./PlaceWizard";
import PhotoViewer from "./PhotoViewer";
import { useSheetDrag } from "./useSheetDrag";

const STALE_MS = 30 * 24 * 60 * 60 * 1000; // re-enrich after ~30 days

export default function PlaceDetail({ id, onClose }: { id: string | null; onClose: () => void }) {
  const place = usePlace(id);
  const customTags = useCustomTags();
  const uploadRef = useRef<HTMLInputElement>(null); // place photo — library
  const cameraRef = useRef<HTMLInputElement>(null); // place photo — camera
  const enrichedRef = useRef<string | null>(null);
  const [editingTags, setEditingTags] = useState(false);
  const [editingNote, setEditingNote] = useState(false);
  const [editingReel, setEditingReel] = useState(false); // add/edit the Instagram reel link
  const [visitWizard, setVisitWizard] = useState(false); // guided watchlist → visited form
  const [revealId, setRevealId] = useState<string | null>(null); // tap a photo → reveal its delete icon
  const [viewerIndex, setViewerIndex] = useState<number | null>(null); // tap again → full-screen swipe
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

  if (!place) return null;
  const meta = stateMeta(place);
  const visited = place.status === "visited";
  const open = isOpenNow(place.openingPeriods);
  const todayHours = place.hoursText?.[(new Date().getDay() + 6) % 7]; // Google lists Mon-first

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

  // Place-scoped photos (library multi-select or camera — same handler). Each
  // file is resized sequentially (low peak memory) and added; bad frames skip.
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

  return (
    <>
    <div className="fixed inset-0 z-40" style={{ background: "rgba(6,7,10,0.62)" }} onClick={onClose}>
      <div
        ref={sheetRef}
        className="scroll-quiet absolute inset-x-0 bottom-0 max-h-[92dvh] overflow-y-auto pb-[max(1.5rem,env(safe-area-inset-bottom))]"
        style={{ background: "var(--sheet)", borderTopLeftRadius: "var(--radius-lg)", borderTopRightRadius: "var(--radius-lg)", boxShadow: "var(--shadow-sheet)" }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* state-colour top wash: the ONE place colour in the sheet — 20% of the
            state hue, fading over ~210px. */}
        <div
          className="pointer-events-none absolute inset-x-0 top-0"
          style={{
            height: 210,
            background: `linear-gradient(180deg, color-mix(in srgb, ${meta.color} 20%, transparent), transparent)`,
            borderTopLeftRadius: "var(--radius-lg)",
            borderTopRightRadius: "var(--radius-lg)",
          }}
        />
        {/* handle + close */}
        <div className="sticky top-0 z-10 px-5 pt-2">
          <div {...handleProps} className="flex cursor-grab touch-none justify-center pb-2 pt-0.5">
            <div className="h-[5px] w-10 rounded-full" style={{ background: "var(--ink-line)" }} />
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="press absolute right-4 top-3 grid h-7 w-7 place-items-center rounded-full"
            style={{ background: "rgba(255,255,255,0.08)", color: "var(--text-secondary)" }}
          >
            <X size={14} strokeWidth={2.25} />
          </button>
        </div>

        <div className="relative px-5">
          {/* header */}
          <span
            className="inline-flex items-center gap-1.5 px-2.5 py-[4px] text-[10.5px] font-bold uppercase tracking-[0.06em]"
            style={{ borderRadius: "var(--radius-chip)", background: "rgba(255,255,255,0.08)", color: "var(--text-secondary)" }}
          >
            <span className="h-[6px] w-[6px] rounded-full" style={{ background: meta.color }} />
            {meta.label}
          </span>
          <h1
            className="mt-2 text-[34px] leading-[1.02] tracking-[-0.005em]"
            style={{ fontFamily: "var(--font-serif)", color: "var(--text-primary)" }}
          >
            {place.name}
          </h1>
          {place.address && (
            <p className="mt-0.5 text-[12.5px]" style={{ color: "var(--text-tertiary)" }}>{place.address}</p>
          )}
          {(place.area || open !== null || todayHours) && (
            <div className="mt-1.5 flex items-center gap-1.5 text-[12px]">
              {place.area && (
                <span className="inline-flex items-center gap-1 font-semibold" style={{ color: "var(--text-secondary)" }}>
                  <MapPin size={12} strokeWidth={2.25} style={{ color: "var(--text-tertiary)" }} />
                  {place.area}
                </span>
              )}
              {open !== null && (
                <span className="font-semibold" style={{ color: open ? "var(--text-primary)" : "var(--text-tertiary)" }}>
                  {place.area ? "· " : ""}{open ? "Open now" : "Closed"}
                </span>
              )}
              {todayHours && (
                <span style={{ color: "var(--text-tertiary)" }}>
                  {open !== null || place.area ? "· " : ""}{todayHours.replace(/^[A-Za-z]+:\s*/, "")}
                </span>
              )}
            </div>
          )}

          {/* photos — a swipeable carousel (not a scroll-past stack), shown at
              normal size with no delete icon by default. Tap a photo to
              reveal its delete icon; tap it again (anywhere but that icon)
              opens the full-screen swipeable viewer. */}
          <div className="mt-3.5 flex flex-col gap-2">
            {photosSorted(place).length > 0 && (
              <>
                <div className="scroll-quiet flex snap-x snap-mandatory gap-2 overflow-x-auto">
                  {photosSorted(place).map((ph, i) => {
                    const revealed = revealId === ph.id;
                    return (
                      <div
                        key={ph.id}
                        onClick={() => {
                          if (revealed) {
                            setViewerIndex(i);
                            setRevealId(null);
                          } else {
                            setRevealId(ph.id);
                          }
                        }}
                        className="relative h-[50vh] w-full shrink-0 cursor-pointer snap-center overflow-hidden"
                        style={{ borderRadius: "var(--radius)", background: "var(--bg-elevated)" }}
                      >
                        <img src={ph.dataUrl} alt="" className="h-full w-full object-contain" />
                        {revealed && (
                          <button
                            onClick={(e) => { e.stopPropagation(); removePhoto(place.id, ph.id); setRevealId(null); }}
                            aria-label="Remove photo"
                            className="absolute right-2 top-2 grid h-7 w-7 place-items-center rounded-full"
                            style={{ background: "rgba(6,8,13,0.7)", color: "#fff" }}
                          >
                            <Trash2 size={13} />
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
                {photosSorted(place).length > 1 && (
                  <div className="flex justify-center gap-1">
                    {photosSorted(place).map((ph) => (
                      <span key={ph.id} className="h-1 w-1 rounded-full" style={{ background: "var(--border-strong)" }} />
                    ))}
                  </div>
                )}
              </>
            )}

            {place.photos.length === 0 ? (
              <div
                className="grid w-full place-items-center gap-3 px-4"
                style={{ minHeight: 172, borderRadius: "var(--radius)", border: "1px dashed var(--border-strong)" }}
              >
                <div className="flex items-center gap-1.5" style={{ color: "var(--text-tertiary)" }}>
                  <ImagePlus size={18} /> <span className="text-[13px]">Add a photo</span>
                </div>
                <div className="flex w-full max-w-[320px] flex-col gap-2 sm:flex-row">
                  <PhotoBtn onClick={() => uploadRef.current?.click()} icon={<ImagePlus size={15} />} label="Upload" />
                  <PhotoBtn onClick={() => cameraRef.current?.click()} icon={<Camera size={15} />} label="Take photo" />
                </div>
              </div>
            ) : (
              <div className="flex flex-col gap-2 sm:flex-row">
                <PhotoBtn onClick={() => uploadRef.current?.click()} icon={<ImagePlus size={15} />} label="Upload" />
                <PhotoBtn onClick={() => cameraRef.current?.click()} icon={<Camera size={15} />} label="Take photo" />
              </div>
            )}
            <input ref={uploadRef} type="file" accept="image/*" multiple hidden onChange={onFile} />
            <input ref={cameraRef} type="file" accept="image/*" capture="environment" hidden onChange={onFile} />
          </div>

          {/* primary + preference actions */}
          <div className="mt-4 grid grid-cols-[1fr_auto_auto] gap-2">
            <a
              href={directionsUrl(place)} target="_blank" rel="noreferrer"
              className="press flex items-center justify-center gap-2 py-3 text-[14px] font-bold"
              style={{ background: "oklch(0.97 0 0)", color: "oklch(0.16 0.006 260)", borderRadius: "var(--radius-chip)" }}
            >
              <Navigation size={15} strokeWidth={2.5} fill="currentColor" /> Directions
            </a>
            <button
              onClick={() => toggleFavorite(place.id)} aria-label="Favorite"
              className="press grid w-12 place-items-center" style={pillStyle(place.favorite, "var(--s-favorite)")}
            >
              <Heart size={18} fill={place.favorite ? "currentColor" : "none"} />
            </button>
            <button
              onClick={() => toggleNeverAgain(place.id)} aria-label="Never again"
              className="press grid w-12 place-items-center" style={pillStyle(place.neverAgain, "var(--s-never)")}
            >
              <Ban size={18} />
            </button>
          </div>

          {/* the reel it came from — most saves start on a reel, so this is the
              "go back and see why" jump. Editable so any place can get a link. */}
          {editingReel ? (
            <div
              className="mt-2 flex items-center gap-2.5 px-3.5"
              style={{ background: "var(--bg-elevated)", border: "1px solid var(--border-strong)", borderRadius: "var(--radius-sm)" }}
            >
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
          ) : place.reelUrl ? (
            <div className="mt-2 flex items-center gap-2">
              <a
                href={place.reelUrl}
                target="_blank"
                rel="noreferrer"
                className="press flex flex-1 items-center justify-center gap-2 py-3 text-[14px] font-bold"
                style={{ borderRadius: "var(--radius-chip)", background: "var(--bg-elevated)", color: "var(--text-primary)", border: "1px solid var(--border-strong)" }}
              >
                <span className="grid h-5 w-5 place-items-center rounded-[7px]" style={{ background: "linear-gradient(45deg,#feda75,#fa7e1e,#d62976,#962fbf,#4f5bd5)" }}>
                  <Play size={11} strokeWidth={0} fill="#fff" style={{ color: "#fff" }} />
                </span>
                Watch on Instagram
              </a>
              <button
                onClick={() => setEditingReel(true)}
                aria-label="Edit reel link"
                className="press grid h-11 w-11 shrink-0 place-items-center"
                style={{ borderRadius: "var(--radius-chip)", border: "1px solid var(--border-strong)", color: "var(--text-tertiary)" }}
              >
                <Pencil size={14} />
              </button>
            </div>
          ) : (
            <button
              onClick={() => setEditingReel(true)}
              className="press mt-2 flex w-full items-center justify-center gap-2 py-2.5 text-[13px] font-semibold"
              style={{ borderRadius: "var(--radius-chip)", border: "1px dashed var(--border-strong)", color: "var(--text-secondary)" }}
            >
              <Clapperboard size={15} strokeWidth={2.25} /> Add Instagram reel link
            </button>
          )}

          {/* the lowdown — Google's editorial line, the initial research on a
              place you haven't been to yet. Reference info (not your note). */}
          {place.summary && (
            <Section title="The lowdown">
              <p className="text-[14.5px] leading-relaxed" style={{ color: "var(--text-secondary)" }}>
                {place.summary}
              </p>
              <p className="mt-1.5 text-[11px] uppercase tracking-[0.06em]" style={{ color: "var(--text-tertiary)" }}>
                via Google
              </p>
            </Section>
          )}

          {/* lifecycle + ratings */}
          <Section title="Your take">
            {!visited ? (
              <button
                onClick={() => setVisitWizard(true)}
                className="press flex w-full items-center justify-center gap-2 py-3 text-[14px] font-semibold"
                style={{ borderRadius: "var(--radius-chip)", border: "1px solid var(--border-strong)", color: "var(--text-primary)" }}
              >
                Mark as been
              </button>
            ) : (
              <div className="flex flex-col gap-3">
                <Row label="Your rating">
                  <Stars value={place.myRating} onSet={(n) => updatePlace(place.id, { myRating: n })} />
                </Row>
                <Row label="Spend / person">
                  <div className="flex items-center gap-1">
                    <span style={{ color: "var(--text-tertiary)" }}>₹</span>
                    <input
                      type="number" inputMode="numeric" defaultValue={place.myBudgetPerPerson ?? ""}
                      onBlur={(e) => updatePlace(place.id, { myBudgetPerPerson: e.target.value ? +e.target.value : null })}
                      placeholder="—"
                      className="w-24 bg-transparent text-right font-[family-name:var(--font-mono)] text-[13px] outline-none"
                      style={{ color: "var(--text-primary)" }}
                    />
                  </div>
                </Row>
              </div>
            )}
            <div className="mt-2.5 flex items-center justify-between text-[12px]" style={{ color: "var(--text-tertiary)" }}>
              <span>{place.source === "swiggy" ? "Swiggy reference" : "Google reference"}</span>
              <span className="font-[family-name:var(--font-mono)]">
                {place.googleRating != null ? `★ ${place.googleRating.toFixed(1)}` : "—"} · {priceSigns(place.googlePriceLevel)}
              </span>
            </div>
          </Section>

          {/* tags — compact chips + Edit reveals the full editor */}
          <Section
            title="Tags"
            action={
              <button onClick={() => setEditingTags((v) => !v)} className="press text-[12px] font-semibold" style={{ color: "var(--text-secondary)" }}>
                {editingTags ? "Done" : "Edit"}
              </button>
            }
          >
            {editingTags ? (
              <div className="flex flex-col gap-3.5">
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
            ) : place.tags.length > 0 ? (
              <div className="flex flex-wrap gap-1.5">
                {place.tags.map((t) => (
                  <span
                    key={t.namespace + t.value}
                    className="px-3 py-[6px] text-[12px] font-medium"
                    style={{ borderRadius: "var(--radius-chip)", background: "oklch(0.97 0 0)", color: "oklch(0.16 0.006 260)" }}
                  >
                    {t.value}
                  </span>
                ))}
              </div>
            ) : (
              <p className="text-[12.5px]" style={{ color: "var(--text-tertiary)" }}>No tags yet — Edit to add.</p>
            )}
          </Section>

          {/* note — italic serif quote, tap to edit */}
          <Section title="Note">
            {editingNote || !place.notes ? (
              <textarea
                autoFocus={editingNote}
                defaultValue={place.notes}
                onBlur={(e) => { updatePlace(place.id, { notes: e.target.value }); setEditingNote(false); }}
                placeholder="What to order, who to bring, when to go…"
                rows={3}
                className="w-full resize-none bg-transparent text-[13.5px] leading-relaxed outline-none"
                style={{ color: "var(--text-primary)" }}
              />
            ) : (
              <p
                onClick={() => setEditingNote(true)}
                className="cursor-text text-[16px] italic leading-snug"
                style={{ fontFamily: "var(--font-serif)", color: "var(--text-primary)" }}
              >
                “{place.notes}”
              </p>
            )}
          </Section>

          {/* timeline */}
          <Section title="Visits">
            {place.visits.length > 0 && (
              <ul className="mb-1 flex flex-col">
                {place.visits.map((v) => (
                  <li key={v.id} className="border-l py-2 pl-3" style={{ borderColor: "var(--ink-line)" }}>
                    <div className="flex items-center gap-2 text-[12px]">
                      <span className="font-semibold" style={{ color: "var(--text-primary)" }}>
                        {relativeDate(v.visitedOn)}
                      </span>
                      {v.whoWith && <span style={{ color: "var(--text-tertiary)" }}>· {v.whoWith}</span>}
                      {v.rating != null && (
                        <span className="ml-auto inline-flex items-center gap-0.5" style={{ color: "var(--star)" }}>
                          <Star size={11} fill="currentColor" strokeWidth={0} /> {v.rating}
                        </span>
                      )}
                    </div>
                    {v.notes && <p className="mt-0.5 text-[13px]" style={{ color: "var(--text-secondary)" }}>{v.notes}</p>}
                  </li>
                ))}
              </ul>
            )}

            <button
              onClick={() => setVisitWizard(true)}
              className="press mt-1 flex items-center gap-2 text-[13px] font-semibold"
              style={{ color: "var(--text-secondary)" }}
            >
              <Plus size={15} strokeWidth={2.5} /> Log a visit
            </button>
          </Section>

          {/* the only destructive action — quiet, at the very bottom */}
          <button
            onClick={() => {
              if (window.confirm(`Remove “${place.name}” and its photos from your map?`)) {
                removePlace(place.id);
                onClose();
              }
            }}
            className="press mt-6 flex w-full items-center justify-center gap-1.5 py-3 text-[13px] font-semibold"
            style={{ borderRadius: "var(--radius-chip)", border: "1px solid var(--border)", color: "var(--text-tertiary)" }}
          >
            <Trash2 size={14} /> Remove from map
          </button>
        </div>
      </div>
    </div>
    {visitWizard && (
      <PlaceWizard placeId={place.id} onClose={() => setVisitWizard(false)} />
    )}
    {viewerIndex !== null && (
      <PhotoViewer
        photos={photosSorted(place)}
        startIndex={viewerIndex}
        onClose={() => setViewerIndex(null)}
        onDelete={(id) => removePhoto(place.id, id)}
      />
    )}
    </>
  );
}

function pillStyle(on: boolean, color: string): React.CSSProperties {
  return {
    borderRadius: "var(--radius-chip)",
    background: on ? color : "rgba(255,255,255,0.06)",
    color: on ? "#fff" : "var(--text-secondary)",
    border: `1px solid ${on ? color : "var(--border-strong)"}`,
  };
}

function Section({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="mt-5 border-t pt-4" style={{ borderColor: "var(--ink-line)" }}>
      <div className="mb-2.5 flex items-center justify-between">
        <h2 className="text-[11px] font-semibold uppercase tracking-[0.08em]" style={{ color: "var(--text-tertiary)" }}>
          {title}
        </h2>
        {action}
      </div>
      {children}
    </section>
  );
}

// Upload / Take-photo button — pair stacks on mobile, rows on desktop.
function PhotoBtn({ onClick, icon, label }: { onClick: () => void; icon: React.ReactNode; label: string }) {
  return (
    <button
      onClick={onClick}
      className="press flex flex-1 items-center justify-center gap-1.5 py-2.5 text-[12.5px] font-semibold"
      style={{
        borderRadius: "var(--radius-chip)",
        background: "var(--bg-elevated)",
        color: "var(--text-primary)",
        border: "1px solid var(--border-strong)",
      }}
    >
      {icon} {label}
    </button>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-[13px]" style={{ color: "var(--text-secondary)" }}>{label}</span>
      {children}
    </div>
  );
}

function Stars({ value, onSet }: { value: number | null; onSet: (n: number) => void }) {
  return (
    <div className="flex gap-1">
      {[1, 2, 3, 4, 5].map((n) => (
        <button key={n} onClick={() => onSet(n)} aria-label={`${n} stars`} className="press">
          <Star
            size={20}
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
      <p className="mb-2 text-[11px] font-bold uppercase tracking-[0.07em]" style={{ color: "var(--text-tertiary)" }}>
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
                background: on ? "oklch(0.97 0 0)" : "var(--bg-elevated)",
                color: on ? "oklch(0.16 0.006 260)" : "var(--text-secondary)",
                border: `1px solid ${on ? "oklch(0.97 0 0)" : "var(--border)"}`,
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
              background: "var(--bg-elevated)",
              color: "var(--text-primary)",
              border: "1px solid var(--border-strong)",
            }}
          />
        ) : (
          <button
            onClick={() => setAdding(true)}
            className="press inline-flex items-center gap-1 px-3 py-[7px] text-[12px] font-semibold"
            style={{
              borderRadius: "var(--radius-chip)",
              background: "transparent",
              color: "var(--text-secondary)",
              border: "1px dashed var(--border-strong)",
            }}
          >
            <Plus size={12} strokeWidth={2.5} /> add
          </button>
        )}
      </div>
    </div>
  );
}
