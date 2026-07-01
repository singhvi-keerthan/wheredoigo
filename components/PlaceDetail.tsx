"use client";

import { useEffect, useRef, useState } from "react";
import {
  X, Navigation, Heart, Ban, Star, Plus, ImagePlus, Trash2, CalendarPlus, Clock, Check,
} from "lucide-react";
import {
  usePlace, updatePlace, addVisit, toggleFavorite, toggleNeverAgain, setTags, addPhoto, removePhoto,
  useCustomTags, addCustomTag,
} from "@/lib/store";
import { TAG_OPTIONS, NAMESPACE_LABELS, isOpenNow, type TagNamespace, type Tag } from "@/lib/types";
import { stateMeta, priceSigns, directionsUrl, relativeDate } from "@/lib/format";
import { getPlaceDetails } from "@/lib/places";
import { resizeImage } from "@/lib/image";

const today = () => new Date().toISOString().slice(0, 10);
const STALE_MS = 30 * 24 * 60 * 60 * 1000; // re-enrich after ~30 days

export default function PlaceDetail({ id, onClose }: { id: string | null; onClose: () => void }) {
  const place = usePlace(id);
  const customTags = useCustomTags();
  const fileRef = useRef<HTMLInputElement>(null);
  const enrichedRef = useRef<string | null>(null);
  const [vDate, setVDate] = useState(today());
  const [vWho, setVWho] = useState("");
  const [vNotes, setVNotes] = useState("");
  const [vRating, setVRating] = useState<number | null>(null);

  // Refresh Google rating / price / hours when a linked place opens and its
  // cached data is missing or stale (~30 days). Runs once per place per open.
  const placeId = place?.id ?? null;
  const googleId = place?.googlePlaceId ?? null;
  const enrichedAt = place?.enrichedAt ?? null;
  useEffect(() => {
    if (!placeId || !googleId) return;
    if (enrichedRef.current === placeId) return;
    const fresh = enrichedAt && Date.now() - new Date(enrichedAt).getTime() < STALE_MS;
    if (fresh) return;
    enrichedRef.current = placeId;
    getPlaceDetails(googleId).then((g) => {
      if (!g) return;
      updatePlace(placeId, {
        googleRating: g.googleRating,
        googlePriceLevel: g.googlePriceLevel,
        googleTypes: g.googleTypes,
        openingPeriods: g.openingPeriods,
        hoursText: g.hoursText,
        enrichedAt: new Date().toISOString(),
      });
    });
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

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const dataUrl = await resizeImage(file);
      addPhoto(place.id, { dataUrl, source: "mine", scope: "place", visitId: null });
    } catch {
      /* ignore bad image */
    }
    e.target.value = "";
  };

  const logVisit = () => {
    addVisit(place.id, { visitedOn: vDate, whoWith: vWho.trim(), notes: vNotes.trim(), rating: vRating });
    setVWho(""); setVNotes(""); setVRating(null); setVDate(today());
  };

  return (
    <div className="fixed inset-0 z-40" style={{ background: "rgba(10,8,12,0.6)" }} onClick={onClose}>
      <div
        className="scroll-quiet absolute inset-x-0 bottom-0 max-h-[92dvh] overflow-y-auto pb-[max(1.5rem,env(safe-area-inset-bottom))]"
        style={{ background: "var(--bg-raised)", borderTopLeftRadius: "var(--radius-lg)", borderTopRightRadius: "var(--radius-lg)", boxShadow: "var(--shadow-sheet)" }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* handle + close */}
        <div className="sticky top-0 z-10 px-5 pt-2" style={{ background: "var(--bg-raised)" }}>
          <div className="mx-auto mb-2 h-[5px] w-10 rounded-full" style={{ background: "var(--ink-line)" }} />
          <button
            onClick={onClose}
            aria-label="Close"
            className="press absolute right-4 top-3 grid h-7 w-7 place-items-center rounded-full"
            style={{ background: "var(--bg-elevated)", color: "var(--text-tertiary)" }}
          >
            <X size={14} strokeWidth={2.25} />
          </button>
        </div>

        <div className="px-5">
          {/* header */}
          <span
            className="inline-flex items-center gap-1.5 px-2.5 py-[4px] text-[11px] font-bold"
            style={{ borderRadius: "var(--radius-chip)", background: meta.color, color: "#fff" }}
          >
            {meta.label}
          </span>
          <h1
            className="mt-1 text-[27px] font-medium leading-[1.05] tracking-[-0.01em]"
            style={{ fontFamily: "var(--font-display)", color: "var(--text-primary)" }}
          >
            {place.name}
          </h1>
          {place.address && (
            <p className="mt-1 text-[12.5px]" style={{ color: "var(--text-tertiary)" }}>{place.address}</p>
          )}
          {(open !== null || todayHours) && (
            <div className="mt-1.5 flex items-center gap-1.5 text-[12px]">
              <Clock size={12} style={{ color: "var(--text-tertiary)" }} />
              {open !== null && (
                <span className="font-semibold" style={{ color: open ? "var(--s-watchlist)" : "var(--text-tertiary)" }}>
                  {open ? "Open now" : "Closed"}
                </span>
              )}
              {todayHours && (
                <span style={{ color: "var(--text-tertiary)" }}>
                  {open !== null ? "· " : ""}{todayHours.replace(/^[A-Za-z]+:\s*/, "")}
                </span>
              )}
            </div>
          )}

          {/* photos */}
          <div className="scroll-quiet mt-3.5 flex gap-2 overflow-x-auto pb-1">
            {place.photos.map((ph) => (
              <div key={ph.id} className="relative h-24 w-24 shrink-0 overflow-hidden" style={{ borderRadius: "var(--radius-sm)" }}>
                <img src={ph.dataUrl} alt="" className="h-full w-full object-cover" />
                <button
                  onClick={() => removePhoto(place.id, ph.id)}
                  aria-label="Remove photo"
                  className="absolute right-1 top-1 grid h-6 w-6 place-items-center rounded-full"
                  style={{ background: "rgba(6,8,13,0.7)", color: "#fff" }}
                >
                  <Trash2 size={12} />
                </button>
              </div>
            ))}
            <button
              onClick={() => fileRef.current?.click()}
              className="grid h-24 w-24 shrink-0 place-items-center"
              style={{ borderRadius: "var(--radius-sm)", border: "1px dashed var(--border-strong)", color: "var(--text-tertiary)" }}
            >
              <ImagePlus size={20} />
            </button>
            <input ref={fileRef} type="file" accept="image/*" hidden onChange={onFile} />
          </div>

          {/* primary + preference actions */}
          <div className="mt-4 grid grid-cols-[1fr_auto_auto] gap-2">
            <a
              href={directionsUrl(place)} target="_blank" rel="noreferrer"
              className="press flex items-center justify-center gap-2 py-3 text-[14px] font-bold"
              style={{ background: "var(--accent)", color: "var(--accent-ink)", borderRadius: "var(--radius-chip)" }}
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

          {/* lifecycle + ratings */}
          <Section title="Your take">
            {!visited ? (
              <button
                onClick={() => updatePlace(place.id, { status: "visited" })}
                className="press flex w-full items-center justify-center gap-2 py-3 text-[14px] font-semibold"
                style={{ borderRadius: "var(--radius-chip)", border: "1px solid var(--border-strong)", color: "var(--text-primary)" }}
              >
                <CalendarPlus size={15} /> Mark as been
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
              <span>Google reference</span>
              <span className="font-[family-name:var(--font-mono)]">
                {place.googleRating != null ? `★ ${place.googleRating.toFixed(1)}` : "—"} · {priceSigns(place.googlePriceLevel)}
              </span>
            </div>
          </Section>

          {/* tags — fixed options + custom values you add on the fly */}
          <Section title="Tags">
            <div className="flex flex-col gap-3.5">
              {(Object.keys(TAG_OPTIONS) as TagNamespace[]).map((ns) => {
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
          </Section>

          {/* notes */}
          <Section title="Notes">
            <textarea
              defaultValue={place.notes}
              onBlur={(e) => updatePlace(place.id, { notes: e.target.value })}
              placeholder="What to order, who to bring, when to go…"
              rows={3}
              className="w-full resize-none bg-transparent text-[13.5px] leading-relaxed outline-none"
              style={{ color: "var(--text-primary)" }}
            />
          </Section>

          {/* timeline */}
          <Section title="Visits">
            <div className="flex flex-col gap-2">
              <div className="flex gap-2">
                <input type="date" value={vDate} onChange={(e) => setVDate(e.target.value)} className="input-dark" />
                <input value={vWho} onChange={(e) => setVWho(e.target.value)} placeholder="Who with" className="input-dark flex-1" />
              </div>
              <input value={vNotes} onChange={(e) => setVNotes(e.target.value)} placeholder="What you ate, how it was…" className="input-dark" />
              <div className="flex items-center justify-between">
                <Stars value={vRating} onSet={setVRating} />
                <button
                  onClick={logVisit}
                  className="press flex items-center gap-1.5 px-4 py-2 text-[12.5px] font-bold"
                  style={{ background: "var(--accent)", color: "var(--accent-ink)", borderRadius: "var(--radius-chip)" }}
                >
                  <Plus size={13} strokeWidth={2.5} /> Log visit
                </button>
              </div>

              {place.visits.length > 0 && (
                <ul className="mt-2 flex flex-col">
                  {place.visits.map((v) => (
                    <li key={v.id} className="border-l py-2 pl-3" style={{ borderColor: "var(--ink-line)" }}>
                      <div className="flex items-center gap-2 text-[12px]">
                        <span className="font-[family-name:var(--font-mono)]" style={{ color: "var(--text-secondary)" }}>
                          {relativeDate(v.visitedOn)}
                        </span>
                        {v.whoWith && <span style={{ color: "var(--text-tertiary)" }}>· {v.whoWith}</span>}
                        {v.rating != null && (
                          <span className="ml-auto inline-flex items-center gap-0.5" style={{ color: "var(--accent)" }}>
                            <Star size={11} fill="currentColor" strokeWidth={0} /> {v.rating}
                          </span>
                        )}
                      </div>
                      {v.notes && <p className="mt-0.5 text-[13px]" style={{ color: "var(--text-primary)" }}>{v.notes}</p>}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </Section>
        </div>
      </div>
    </div>
  );
}

function pillStyle(on: boolean, color: string): React.CSSProperties {
  return {
    borderRadius: "var(--radius-chip)",
    background: on ? color : "transparent",
    color: on ? "#fff" : "var(--text-secondary)",
    border: `1px solid ${on ? color : "var(--border-strong)"}`,
  };
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-5 border-t pt-4" style={{ borderColor: "var(--ink-line)" }}>
      <h2 className="mb-2.5 text-[11px] font-semibold uppercase tracking-[0.08em]" style={{ color: "var(--text-tertiary)" }}>
        {title}
      </h2>
      {children}
    </section>
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
            fill={value != null && n <= Math.round(value) ? "var(--accent)" : "none"}
            style={{ color: value != null && n <= Math.round(value) ? "var(--accent)" : "var(--text-tertiary)" }}
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
                borderRadius: "var(--radius-chip)",
                background: on ? "var(--accent)" : "var(--bg-elevated)",
                color: on ? "var(--accent-ink)" : "var(--text-secondary)",
                border: `1px solid ${on ? "var(--accent)" : "var(--border)"}`,
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
              border: "1px solid var(--accent)",
            }}
          />
        ) : (
          <button
            onClick={() => setAdding(true)}
            className="press inline-flex items-center gap-1 px-3 py-[7px] text-[12px] font-semibold"
            style={{
              borderRadius: "var(--radius-chip)",
              background: "transparent",
              color: "var(--accent)",
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
