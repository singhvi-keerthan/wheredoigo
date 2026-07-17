"use client";

import { useEffect, useRef, useState } from "react";
import {
  X, ArrowLeft, ArrowRight, Check, Star, ImagePlus, Camera, Trash2,
  Heart, Ban, ChevronLeft, ChevronRight,
} from "lucide-react";
import {
  usePlace,
  updatePlace,
  addVisit,
  addPhoto,
  setTags,
  useCustomTags,
  addCustomTag,
} from "@/lib/store";
import {
  TAG_OPTIONS,
  RATING_DIMENSIONS,
  RATING_LABELS,
  type TagNamespace,
  type Tag,
  type RatingDimension,
} from "@/lib/types";
import { resizeImage } from "@/lib/image";

// The guided, one-question-at-a-time form for logging a visit — the
// watchlist → visited transition (when → … → photos). A fresh watchlist
// CAPTURE no longer uses a form: the place's details come from Google, and the
// only human input (a one-line note) is taken on the add sheet. Editing an
// already-known place stays on the free-form PlaceDetail sheet; this is only
// for logging a visit, where a form fits.

const today = () => new Date().toISOString().slice(0, 10);

const VISIT_STEPS = ["when", "who", "rating", "spend", "notes", "tags", "photo", "verdict"] as const;

const PROMPTS: Record<string, { title: string; sub?: string }> = {
  when: { title: "When did you go?" },
  who: { title: "Who was with you?", sub: "Optional." },
  rating: { title: "How was it?" },
  spend: { title: "Spend per person?", sub: "Roughly — optional." },
  notes: { title: "Anything to remember?", sub: "What you ate, what to order again." },
  tags: { title: "Tweak the tags?", sub: "Now that you've actually been." },
  photo: { title: "Add photos", sub: "Optional — shots from the visit. Pick as many as you like." },
  verdict: { title: "So — what's the verdict?", sub: "Optional. Tuck it into Favorites, or skip it for good." },
};

export default function PlaceWizard({
  placeId,
  onClose,
}: {
  placeId: string;
  onClose: () => void;
}) {
  const place = usePlace(placeId);
  const customTags = useCustomTags();
  const uploadRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);

  const steps = VISIT_STEPS;
  const [step, setStep] = useState(0);

  // Draft — everything is held locally and committed on submit.
  const [draftTags, setDraftTags] = useState<Tag[]>(() => place?.tags ?? []);
  const [photos, setPhotos] = useState<string[]>([]);
  const [vDate, setVDate] = useState(today());
  const [vWho, setVWho] = useState("");
  const [vRating, setVRating] = useState<number | null>(null);
  const [subRatings, setSubRatings] = useState<Partial<Record<RatingDimension, number>>>(
    () => place?.ratings ?? {}
  );
  const [vSpend, setVSpend] = useState("");
  const [vNotes, setVNotes] = useState("");
  // Final verdict — optionally files the place under Favorites or Skip on submit.
  const [verdict, setVerdict] = useState<"favorite" | "skip" | null>(null);

  const key = steps[step];
  const last = step === steps.length - 1;

  const commitVisit = () => {
    if (!place) return;
    const v = addVisit(place.id, {
      visitedOn: vDate,
      whoWith: vWho.trim(),
      notes: vNotes.trim(),
      rating: vRating,
    });
    if (v) {
      for (const dataUrl of photos) {
        addPhoto(place.id, { dataUrl, source: "mine", scope: "visit", visitId: v.id });
      }
    }
    const patch: Partial<NonNullable<typeof place>> = {};
    if (vSpend.trim()) patch.myBudgetPerPerson = Math.round(+vSpend) || null;
    // Private sub-ratings (assistant-only) — merge onto whatever's there.
    if (Object.keys(subRatings).length) patch.ratings = { ...place.ratings, ...subRatings };
    // Verdict → file it. Favorite and Skip are mutually exclusive flags here;
    // leaving it unset touches neither (stays a plain "been").
    if (verdict === "favorite") { patch.favorite = true; patch.neverAgain = false; }
    else if (verdict === "skip") { patch.neverAgain = true; patch.favorite = false; }
    // Tags may have been adjusted on the "tags" step.
    setTags(place.id, draftTags);
    if (Object.keys(patch).length) updatePlace(place.id, patch);
  };

  // A half-logged visit is meaningless, so closing cancels it.
  const submit = () => {
    commitVisit();
    onClose();
  };

  const next = () => (last ? submit() : setStep((s) => s + 1));
  const back = () => setStep((s) => Math.max(0, s - 1));

  // Enter advances — but only from "empty" focus (chips / rating / photo).
  // Inside a text field Enter belongs to that field (newline, or committing a
  // new tag), so never hijack it there.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      const inField = e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement;
      if (e.key === "Enter" && !inField) {
        e.preventDefault();
        next();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  // Resize every picked file (sequentially — keeps peak memory low on a big
  // multi-select) and append. Bad frames are skipped, not fatal.
  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    e.target.value = "";
    for (const file of files) {
      try {
        const dataUrl = await resizeImage(file);
        setPhotos((prev) => [...prev, dataUrl]);
      } catch {
        /* ignore bad image */
      }
    }
  };

  if (!place) return null;

  const toggleTag = (ns: TagNamespace, value: string) =>
    setDraftTags((prev) =>
      prev.some((t) => t.namespace === ns && t.value === value)
        ? prev.filter((t) => !(t.namespace === ns && t.value === value))
        : [...prev, { namespace: ns, value }]
    );
  const tagOn = (ns: TagNamespace, value: string) =>
    draftTags.some((t) => t.namespace === ns && t.value === value);

  const prompt = PROMPTS[key];
  const pct = ((step + 1) / steps.length) * 100;

  return (
    <div className="fixed inset-0 z-50" style={{ background: "rgba(6,7,10,0.72)" }} onClick={onClose}>
      <div
        className="absolute inset-x-0 bottom-0 flex flex-col"
        style={{
          height: "94dvh",
          background: "var(--sheet)",
          borderTopLeftRadius: "var(--radius-lg)",
          borderTopRightRadius: "var(--radius-lg)",
          boxShadow: "var(--shadow-sheet)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* header — progress + step count + close */}
        <div className="shrink-0 px-5 pt-3">
          <div className="flex items-center gap-3">
            <div className="h-[4px] flex-1 overflow-hidden rounded-full" style={{ background: "var(--ink-line)" }}>
              <div
                className="h-full rounded-full transition-[width] duration-300"
                style={{ width: `${pct}%`, background: "oklch(0.97 0 0)" }}
              />
            </div>
            <span className="font-[family-name:var(--font-mono)] text-[11px]" style={{ color: "var(--text-tertiary)" }}>
              {step + 1}/{steps.length}
            </span>
            <button
              onClick={onClose}
              aria-label="Close"
              className="press grid h-7 w-7 place-items-center rounded-full"
              style={{ background: "var(--bg-elevated)", color: "var(--text-tertiary)" }}
            >
              <X size={14} strokeWidth={2.25} />
            </button>
          </div>
          <p className="mt-3 text-[11px] font-bold uppercase tracking-[0.08em]" style={{ color: "var(--text-tertiary)" }}>
            Log a visit · {place.name}
          </p>
        </div>

        {/* body — one question */}
        <div key={key} className="animate-rise scroll-quiet flex-1 overflow-y-auto px-5 pt-5">
          <h1
            className="text-[27px] leading-[1.08] tracking-[-0.01em]"
            style={{ fontFamily: "var(--font-serif)", color: "var(--text-primary)" }}
          >
            {prompt.title}
          </h1>
          {prompt.sub && (
            <p className="mt-1.5 text-[13px]" style={{ color: "var(--text-tertiary)" }}>
              {prompt.sub}
            </p>
          )}

          <div className="mt-5 pb-4">
            {key === "tags" && (
              <div className="flex flex-col gap-4">
                {(Object.keys(TAG_OPTIONS) as TagNamespace[]).map((ns) => (
                  <div key={ns}>
                    <p className="mb-2 text-[11px] font-bold uppercase tracking-[0.07em]" style={{ color: "var(--text-tertiary)" }}>
                      {ns}
                    </p>
                    <ChipMulti
                      options={Array.from(new Set([...TAG_OPTIONS[ns], ...customTags[ns]]))}
                      isOn={(v) => tagOn(ns, v)}
                      onToggle={(v) => toggleTag(ns, v)}
                      onAdd={(raw) => {
                        const v = addCustomTag(ns, raw);
                        if (v && !tagOn(ns, v)) toggleTag(ns, v);
                      }}
                    />
                  </div>
                ))}
              </div>
            )}

            {key === "when" && (
              <MiniCalendar value={vDate} max={today()} onChange={setVDate} />
            )}

            {key === "who" && (
              <input
                autoFocus
                value={vWho}
                onChange={(e) => setVWho(e.target.value)}
                placeholder="e.g. Aisha, the usual crew…"
                className="input-dark w-full"
              />
            )}

            {key === "rating" && (
              <div>
                <Stars value={vRating} onSet={setVRating} size={38} />

                <div className="mt-6 border-t pt-4" style={{ borderColor: "var(--ink-line)" }}>
                  <p className="mb-3 text-[11px] font-semibold uppercase tracking-[0.07em]" style={{ color: "var(--text-tertiary)" }}>
                    Break it down · only you see these
                  </p>
                  <div className="flex flex-col gap-3">
                    {RATING_DIMENSIONS.map((dim) => (
                      <div key={dim} className="flex items-center justify-between">
                        <span className="text-[14px]" style={{ color: "var(--text-secondary)" }}>
                          {RATING_LABELS[dim]}
                        </span>
                        <Stars
                          value={subRatings[dim] ?? null}
                          onSet={(n) => setSubRatings((s) => ({ ...s, [dim]: n }))}
                          size={22}
                        />
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {key === "spend" && (
              <div className="flex items-center gap-2 text-[22px]" style={{ color: "var(--text-primary)" }}>
                <span style={{ color: "var(--text-tertiary)" }}>₹</span>
                <input
                  autoFocus
                  type="number"
                  inputMode="numeric"
                  value={vSpend}
                  onChange={(e) => setVSpend(e.target.value)}
                  placeholder="—"
                  className="w-40 bg-transparent font-[family-name:var(--font-mono)] outline-none"
                  style={{ color: "var(--text-primary)", borderBottom: "1px solid var(--border-strong)" }}
                />
                <span className="text-[13px]" style={{ color: "var(--text-tertiary)" }}>/ person</span>
              </div>
            )}

            {key === "notes" && (
              <textarea
                autoFocus
                value={vNotes}
                onChange={(e) => setVNotes(e.target.value)}
                placeholder="What you ate, how it was, what to order again…"
                rows={5}
                className="w-full resize-none bg-transparent text-[16px] leading-relaxed outline-none"
                style={{ color: "var(--text-primary)" }}
              />
            )}

            {key === "photo" && (
              <div>
                {photos.length > 0 && (
                  <div className="scroll-quiet mb-2.5 flex gap-2 overflow-x-auto pb-1">
                    {photos.map((src, i) => (
                      <div
                        key={i}
                        className="relative shrink-0 overflow-hidden"
                        style={{ width: 128, height: 160, borderRadius: "var(--radius-sm)", background: "var(--bg-elevated)" }}
                      >
                        <img src={src} alt="" className="h-full w-full object-cover" />
                        <button
                          onClick={() => setPhotos((prev) => prev.filter((_, j) => j !== i))}
                          aria-label="Remove photo"
                          className="press absolute right-1.5 top-1.5 grid h-7 w-7 place-items-center rounded-full"
                          style={{ background: "rgba(6,8,13,0.7)", color: "#fff" }}
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
                <div className="flex flex-col gap-2.5 sm:flex-row">
                  <WideBtn onClick={() => uploadRef.current?.click()} icon={<ImagePlus size={17} />} label={photos.length ? "Add more" : "Upload"} />
                  <WideBtn onClick={() => cameraRef.current?.click()} icon={<Camera size={17} />} label="Take photo" />
                </div>
                <input ref={uploadRef} type="file" accept="image/*" multiple hidden onChange={onFile} />
                <input ref={cameraRef} type="file" accept="image/*" capture="environment" hidden onChange={onFile} />
              </div>
            )}

            {key === "verdict" && (
              <div className="flex flex-col gap-2.5">
                <VerdictButton
                  active={verdict === "favorite"}
                  onClick={() => setVerdict((v) => (v === "favorite" ? null : "favorite"))}
                  icon={<Heart size={20} fill={verdict === "favorite" ? "currentColor" : "none"} />}
                  color="var(--s-favorite)"
                  title="Favorite"
                  sub="One of your places — keep it close."
                />
                <VerdictButton
                  active={verdict === "skip"}
                  onClick={() => setVerdict((v) => (v === "skip" ? null : "skip"))}
                  icon={<Ban size={20} />}
                  color="var(--s-never)"
                  title="Skip"
                  sub="Been, not again — hide it from picks."
                />
              </div>
            )}
          </div>
        </div>

        {/* footer — Back / Next|Submit */}
        <div
          className="shrink-0 border-t px-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-3"
          style={{ borderColor: "var(--ink-line)" }}
        >
          <div className="flex items-center gap-2.5">
            {step > 0 && (
              <button
                onClick={back}
                className="press grid h-12 w-12 shrink-0 place-items-center"
                style={{ borderRadius: "var(--radius-chip)", border: "1px solid var(--border-strong)", color: "var(--text-secondary)" }}
                aria-label="Back"
              >
                <ArrowLeft size={18} strokeWidth={2.25} />
              </button>
            )}
            <button
              onClick={next}
              className="press flex flex-1 items-center justify-center gap-2 text-[15px] font-bold"
              style={{ height: 48, borderRadius: "var(--radius-chip)", background: "oklch(0.97 0 0)", color: "oklch(0.16 0.006 260)" }}
            >
              {last ? (
                <>
                  <Check size={17} strokeWidth={2.75} />
                  Log visit
                </>
              ) : (
                <>
                  Next
                  <ArrowRight size={17} strokeWidth={2.5} />
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// Selectable chip grid + inline "add" that persists a new value (neutral, never
// a state/accent hue — a tag is not a state).
function ChipMulti({
  options,
  isOn,
  onToggle,
  onAdd,
}: {
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
    <div className="flex flex-wrap gap-2">
      {options.map((v) => {
        const on = isOn(v);
        return (
          <button
            key={v}
            onClick={() => onToggle(v)}
            className="press inline-flex items-center gap-1.5 px-3.5 py-2 text-[13.5px] font-medium transition-colors"
            style={{
              borderRadius: "var(--radius-chip)",
              background: on ? "oklch(0.97 0 0)" : "var(--bg-elevated)",
              color: on ? "oklch(0.16 0.006 260)" : "var(--text-secondary)",
              border: `1px solid ${on ? "oklch(0.97 0 0)" : "var(--border)"}`,
            }}
          >
            {on && <Check size={12} strokeWidth={3} />}
            {v}
          </button>
        );
      })}
      {adding ? (
        <input
          autoFocus
          value={val}
          onChange={(e) => setVal(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") { e.preventDefault(); commit(); }
            if (e.key === "Escape") { setVal(""); setAdding(false); }
          }}
          onBlur={commit}
          placeholder="new tag"
          className="px-3.5 py-2 text-[13.5px] outline-none"
          style={{
            width: 112,
            borderRadius: "var(--radius-chip)",
            background: "var(--bg-elevated)",
            color: "var(--text-primary)",
            border: "1px solid var(--border-strong)",
          }}
        />
      ) : (
        <button
          onClick={() => setAdding(true)}
          className="press inline-flex items-center gap-1 px-3.5 py-2 text-[13.5px] font-semibold"
          style={{ borderRadius: "var(--radius-chip)", background: "transparent", color: "var(--text-secondary)", border: "1px dashed var(--border-strong)" }}
        >
          + add
        </button>
      )}
    </div>
  );
}

function Stars({ value, onSet, size }: { value: number | null; onSet: (n: number) => void; size: number }) {
  return (
    <div className="flex" style={{ gap: size >= 32 ? 8 : 4 }}>
      {[1, 2, 3, 4, 5].map((n) => (
        <button key={n} onClick={() => onSet(n)} aria-label={`${n} stars`} className="press">
          <Star
            size={size}
            strokeWidth={1.5}
            fill={value != null && n <= value ? "var(--star)" : "none"}
            style={{ color: value != null && n <= value ? "var(--star)" : "var(--star-empty)" }}
          />
        </button>
      ))}
    </div>
  );
}

function WideBtn({ onClick, icon, label }: { onClick: () => void; icon: React.ReactNode; label: string }) {
  return (
    <button
      onClick={onClick}
      className="press flex flex-1 items-center justify-center gap-2 py-4 text-[14px] font-semibold"
      style={{ borderRadius: "var(--radius)", background: "var(--bg-elevated)", color: "var(--text-primary)", border: "1px dashed var(--border-strong)" }}
    >
      {icon} {label}
    </button>
  );
}

const pad2 = (n: number) => (n < 10 ? `0${n}` : `${n}`);
const ymd = (y: number, m: number, d: number) => `${y}-${pad2(m + 1)}-${pad2(d)}`;

// Always-open month calendar for the "when" step — no click-to-open native
// picker. Future days are disabled (you can't have been somewhere tomorrow), and
// the month can't page past the one containing `max` (today).
function MiniCalendar({
  value,
  max,
  onChange,
}: {
  value: string; // yyyy-mm-dd
  max: string; // yyyy-mm-dd — today
  onChange: (v: string) => void;
}) {
  const [sy, sm] = value.split("-").map(Number);
  const [view, setView] = useState<{ y: number; m: number }>({ y: sy, m: sm - 1 });

  const [maxY, maxM] = max.split("-").map(Number);
  const maxM0 = maxM - 1;

  const lead = new Date(view.y, view.m, 1).getDay(); // 0=Sun … 6=Sat
  const days = new Date(view.y, view.m + 1, 0).getDate();
  const nextDisabled = view.y > maxY || (view.y === maxY && view.m >= maxM0);
  const label = new Date(view.y, view.m, 1).toLocaleString(undefined, { month: "long", year: "numeric" });
  const cells: (number | null)[] = [
    ...Array(lead).fill(null),
    ...Array.from({ length: days }, (_, i) => i + 1),
  ];

  const shift = (delta: number) =>
    setView((v) => {
      const d = new Date(v.y, v.m + delta, 1);
      return { y: d.getFullYear(), m: d.getMonth() };
    });

  return (
    <div
      className="p-3.5"
      style={{ borderRadius: "var(--radius-sm)", border: "1px solid var(--border-strong)", background: "var(--bg-elevated)" }}
    >
      <div className="mb-3 flex items-center justify-between">
        <button
          onClick={() => shift(-1)}
          aria-label="Previous month"
          className="press grid h-8 w-8 place-items-center rounded-full"
          style={{ border: "1px solid var(--border-strong)", color: "var(--text-secondary)" }}
        >
          <ChevronLeft size={16} />
        </button>
        <span className="text-[14.5px] font-semibold" style={{ color: "var(--text-primary)" }}>
          {label}
        </span>
        <button
          onClick={() => !nextDisabled && shift(1)}
          disabled={nextDisabled}
          aria-label="Next month"
          className="press grid h-8 w-8 place-items-center rounded-full"
          style={{
            border: "1px solid var(--border-strong)",
            color: "var(--text-secondary)",
            opacity: nextDisabled ? 0.3 : 1,
            cursor: nextDisabled ? "default" : "pointer",
          }}
        >
          <ChevronRight size={16} />
        </button>
      </div>

      <div className="mb-1 grid grid-cols-7 gap-1">
        {["S", "M", "T", "W", "T", "F", "S"].map((d, i) => (
          <span key={i} className="grid h-7 place-items-center text-[11px] font-semibold" style={{ color: "var(--text-tertiary)" }}>
            {d}
          </span>
        ))}
      </div>

      <div className="grid grid-cols-7 gap-1">
        {cells.map((d, i) => {
          if (d == null) return <span key={`b${i}`} />;
          const ds = ymd(view.y, view.m, d);
          const disabled = ds > max;
          const selected = ds === value;
          const isToday = ds === max;
          return (
            <button
              key={ds}
              onClick={() => !disabled && onChange(ds)}
              disabled={disabled}
              className="press grid h-9 place-items-center text-[13.5px]"
              style={{
                borderRadius: 10,
                background: selected ? "oklch(0.97 0 0)" : "transparent",
                color: selected ? "oklch(0.16 0.006 260)" : "var(--text-primary)",
                fontWeight: selected ? 700 : isToday ? 600 : 500,
                border: `1px solid ${isToday && !selected ? "var(--border-strong)" : "transparent"}`,
                opacity: disabled ? 0.28 : 1,
                cursor: disabled ? "default" : "pointer",
              }}
            >
              {d}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// One tap-to-toggle verdict option (Favorite / Skip) on the final step.
function VerdictButton({
  active,
  onClick,
  icon,
  color,
  title,
  sub,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  color: string;
  title: string;
  sub: string;
}) {
  return (
    <button
      onClick={onClick}
      className="press flex items-center gap-3.5 px-4 py-3.5 text-left"
      style={{
        borderRadius: "var(--radius)",
        background: active ? color : "var(--bg-elevated)",
        border: `1px solid ${active ? color : "var(--border-strong)"}`,
        color: active ? "#fff" : "var(--text-primary)",
      }}
    >
      <span
        className="grid h-10 w-10 shrink-0 place-items-center rounded-full"
        style={{ background: active ? "rgba(255,255,255,0.18)" : "var(--bg-raised)", color: active ? "#fff" : color }}
      >
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[15.5px] font-semibold">{title}</span>
        <span className="block text-[12.5px]" style={{ color: active ? "rgba(255,255,255,0.8)" : "var(--text-tertiary)" }}>
          {sub}
        </span>
      </span>
      {active && <Check size={18} strokeWidth={2.75} />}
    </button>
  );
}
