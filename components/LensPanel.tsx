"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X, Search, ChevronLeft, Map as MapIcon, Clock } from "lucide-react";
import type { DecideQuery } from "@/lib/decide";
import { buildSearchPlan, type SwiggySearchPlan } from "@/lib/swiggyTerms";
import type { DeckSource } from "@/lib/deck";
import { useIsSiteOwner } from "@/lib/sync/client";
import { askOnOpen, setAskOnOpen } from "@/lib/entryPref";
import { parseFallback } from "@/lib/decide-fallback";
import { geocodeArea } from "@/lib/places";
import {
  BUDGETS,
  EMPTY_FILTERS,
  LIFECYCLES,
  RATINGS,
  TAG_GROUPS,
  appliedOf,
  askBites,
  buildQuery,
  fromAsk,
  withAsk,
  type Applied,
  type AskExtras,
  chipsFor,
  labelOf,
  pruneFor,
  searchablePicks,
  suggest,
  toggleTag,
  type Filters,
  type Suggestion,
} from "@/lib/filterVocab";

// The lens — what the deck is looking at: a source (Saved / New / Both) and a
// set of filters. State lives in the hook so the mode keeps its lens while the
// editor is shut, and so the deck's own header can show and edit it.
//
// There is no free-text box any more. "Tell me the mood…" accepted anything
// and the New deck could act on a fraction of it — Swiggy's search takes one
// term, and most moods have none — so the deck over-promised on every ask.
// The editor offers only what the deck can act on, a short list per group,
// and a search across the full vocabulary for the rest (lib/filterVocab.ts).

export type Lens = ReturnType<typeof useLens>;

export function useLens() {
  // New by default: "go wild" is a promise of somewhere you haven't been, and
  // opening it on your own saved places breaks it on the first card. Only
  // where New can run, though — Swiggy answers to the owner's device alone
  // (lib/swiggy-gate.ts), so anyone else would open on a refusal. The owner
  // check resolves after mount, so the default is derived, not stored: until
  // someone picks, the source follows it.
  const owner = useIsSiteOwner();
  const [picked, setSource] = useState<DeckSource | null>(null);
  const source: DeckSource = picked ?? (owner ? "new" : "saved");
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  // What a Saved-deck ask understood beyond the chips (lib/filterVocab.ts
  // AskExtras). Saved only — it is ignored, and dropped, anywhere else.
  const [extras, setExtras] = useState<AskExtras | null>(null);
  const liveExtras = source === "saved" ? extras : null;

  // Built for every source. The tag half only lands on saved cards (buildDeck
  // never ranks Swiggy through rankPlaces), but area/budget/rating gate the
  // Swiggy half too.
  const query = useMemo<DecideQuery>(() => withAsk(buildQuery(filters), liveExtras), [filters, liveExtras]);
  const applied = useMemo<Applied[]>(() => {
    const chips = appliedOf(filters);
    // Everything else the ask said, as one chip: keywords and "not a bar"
    // narrow the deck too, and a filter you can't see is one you can't undo.
    if (askBites(liveExtras)) {
      const said = liveExtras!.said;
      chips.push({ key: "ask", label: `“${said.length > 24 ? `${said.slice(0, 23)}…` : said}”`, remove: (f) => f });
    }
    return chips;
  }, [filters, liveExtras]);
  const dirty = applied.length > 0;

  // Switching to New drops the picks New can't act on (lib/filterVocab.ts
  // pruneFor) — the applied row must only ever show filters that bite.
  const pickSource = (s: DeckSource) => {
    setSource(s);
    setFilters((f) => pruneFor(f, s));
    if (s !== "saved") setExtras(null);
  };

  return {
    source,
    setSource: pickSource,
    filters,
    setFilters,
    query,
    area: filters.area || null,
    // What New mode should actually ask Swiggy for, built from the structured
    // query. See lib/swiggyTerms.ts.
    searchPlan: (source === "saved" ? { terms: [] } : buildSearchPlan(query)) as SwiggySearchPlan,
    extras,
    setExtras,
    applied,
    // One chip's ×. The ask's chip clears the ask's extras; every other chip
    // edits the filters.
    removeApplied: (a: Applied) => (a.key === "ask" ? setExtras(null) : setFilters((f) => a.remove(f))),
    summary: applied.map((a) => a.label),
    dirty,
    clear: () => {
      setFilters(EMPTY_FILTERS);
      setExtras(null);
    },
  };
}

export const SOURCES: { key: DeckSource; label: string }[] = [
  { key: "saved", label: "Saved" },
  { key: "new", label: "New" },
  { key: "both", label: "Both" },
];

// The one control that says which deck this is. Shared by the deck's header
// and the editor so the two read as the same switch.
export function SourceSwitch({
  source,
  onPick,
  dense = false,
}: {
  source: DeckSource;
  onPick: (s: DeckSource) => void;
  dense?: boolean;
}) {
  return (
    <div
      role="radiogroup"
      aria-label="Which places"
      // A radio group moves with the arrow keys — and has to keep them: on the
      // deck the same keys swipe the card, so an arrow meant for the switch
      // must never reach the deck's shortcuts (it would skip or add a place).
      onKeyDown={(e) => {
        const step = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0;
        if (!step) return;
        e.preventDefault();
        e.stopPropagation();
        const i = SOURCES.findIndex((x) => x.key === source);
        const next = SOURCES[(i + step + SOURCES.length) % SOURCES.length].key;
        onPick(next);
        const btn = e.currentTarget.querySelectorAll<HTMLButtonElement>("[role=radio]")[SOURCES.findIndex((x) => x.key === next)];
        btn?.focus();
      }}
      className="grid w-full grid-cols-3 gap-1"
      style={{
        background: "var(--bg-elevated)",
        border: "1px solid var(--border-strong)",
        borderRadius: "var(--radius-chip)",
        padding: 3,
      }}
    >
      {SOURCES.map((s) => {
        const on = source === s.key;
        return (
          <button
            key={s.key}
            role="radio"
            aria-checked={on}
            tabIndex={on ? 0 : -1}
            onClick={() => onPick(s.key)}
            className={`press ${dense ? "py-1.5 text-[13px]" : "py-2 text-[13.5px]"} font-semibold transition-colors`}
            style={{
              borderRadius: "calc(var(--radius-chip) - 3px)",
              background: on ? "oklch(0.97 0 0)" : "transparent",
              color: on ? "oklch(0.16 0.006 260)" : "var(--text-secondary)",
            }}
          >
            {s.label}
          </button>
        );
      })}
    </div>
  );
}

// The filter editor. Two presentations of the same thing:
//   "sheet" — the deck's filter sheet, over the cards.
//   "form"  — the "I know what I want" door: full screen, every question
//             optional, and the button reads "Just show me places" untouched.
// Both edit a DRAFT; nothing reaches the deck until Apply, and closing or Back
// throws the draft away — so a half-made change never refetches Swiggy under
// you, and "never mind" means never mind.
export default function LensPanel({
  lens,
  areasFor,
  variant = "sheet",
  onClose,
  onApply,
  onOpenMap,
}: {
  lens: Lens;
  // Every locality the pool for a source holds, most-held first.
  areasFor: (source: DeckSource) => string[];
  variant?: "sheet" | "form";
  onClose: () => void; // cancel — the draft is discarded
  onApply: () => void; // after the draft is committed to the lens
  // Leave the mode entirely, back to the map. The sheet is the deck's only
  // menu, so the way out lives on it.
  onOpenMap?: () => void;
}) {
  const [draft, setDraft] = useState<Filters>(lens.filters);
  const [source, setSource] = useState<DeckSource>(lens.source);
  const [text, setText] = useState("");
  const [askDoors, setAskDoors] = useState(askOnOpen);
  // The Saved-deck ask: free text → the same picks the chips make, plus the
  // extras no chip expresses. Edits the draft like everything else here.
  const [draftExtras, setDraftExtras] = useState<AskExtras | null>(lens.extras);
  const [thinking, setThinking] = useState(false);
  const [basic, setBasic] = useState(false);
  // Bumped by every ask and every source change, so an answer that lands
  // after you've moved on (switched off Saved, asked again) is dropped
  // instead of overwriting what you did since.
  const askSeq = useRef(0);
  const areas = useMemo(() => areasFor(source), [areasFor, source]);
  const suggestions = useMemo(() => suggest(text, source, areas), [text, source, areas]);
  // On Saved the search box also takes a sentence: your own places can
  // answer one (rankPlaces reads the whole query), Swiggy's search can't.
  const canAsk = source === "saved" && text.trim().length >= 3;
  const picked = appliedOf(draft).length;
  // The words chip counts as a pick when it narrows anything a chip doesn't.
  const picks = picked + (source === "saved" && askBites(draftExtras) ? 1 : 0);
  const isForm = variant === "form";
  // A dialog takes focus when it opens, so the keyboard is in it rather than
  // on the deck it covers.
  const dialogRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    dialogRef.current?.focus();
  }, []);
  const onDialogKey = (e: React.KeyboardEvent) => {
    if (e.key !== "Escape") return;
    e.preventDefault();
    e.stopPropagation();
    onClose();
  };
  // New searches at most MAX_TERMS terms at once (lib/swiggyTerms.ts). Picking
  // more is allowed — they still narrow your saved places on Both — but the
  // editor says which ones New will search rather than dropping the rest
  // silently.
  const plan = source === "saved" ? null : buildSearchPlan(buildQuery(draft));
  const overCap = plan && searchablePicks(draft) > plan.terms.length && plan.terms.length >= 4 ? plan.terms : null;

  const apply = () => {
    lens.setFilters(draft);
    lens.setSource(source);
    lens.setExtras(source === "saved" ? draftExtras : null);
    onApply();
  };

  // Same route the map's Ask uses (/api/decide). The prompt is only what was
  // typed — never a place, never anything Swiggy sent. A model failure falls
  // back to the keyword parser, and the editor says so rather than looking
  // like it understood.
  const ask = async () => {
    const words = text.trim();
    if (!canAsk || thinking) return;
    const mine = ++askSeq.current;
    setThinking(true);
    let q: DecideQuery;
    let byModel = false;
    try {
      const res = await fetch("/api/decide", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: text }),
      });
      const data = await res.json();
      q = data.query ?? parseFallback(words);
      byModel = Boolean(data.query) && data.parsedBy === "model";
    } catch {
      q = parseFallback(words);
    }
    if (q.area && !q.areaCenter) {
      try {
        const hit = await geocodeArea(q.area);
        if (hit) q = { ...q, area: hit.name, areaCenter: { lat: hit.lat, lng: hit.lng } };
      } catch {
        // The area name still gates by name.
      }
    }
    setThinking(false);
    if (mine !== askSeq.current) return;
    // Merged into the draft as it is NOW — edits made while it was reading
    // stay, except where the ask named the same thing.
    const parsed = q;
    setDraft((d) => fromAsk(d, parsed, words).filters);
    setDraftExtras(fromAsk(EMPTY_FILTERS, parsed, words).extras);
    setBasic(!byModel);
    // Back to the picks, so what it understood is the next thing you see.
    setText("");
  };

  const takeSuggestion = (s: Suggestion) => {
    setDraft((d) =>
      s.kind === "area" ? { ...d, area: d.area === s.value ? "" : s.value } : toggleTag(d, s.field, s.value)
    );
    setText("");
  };

  const isPicked = (s: Suggestion) => (s.kind === "area" ? draft.area === s.value : draft[s.field].includes(s.value));

  // Area is single-select: the Swiggy search runs from one locality. The chips
  // are the few the pool holds most of, plus the current pick.
  const areaChips = useMemo(() => {
    const shown = areas.slice(0, 5);
    if (draft.area && !shown.includes(draft.area)) shown.push(draft.area);
    return shown;
  }, [areas, draft.area]);

  const body = (
    <>
      <Section title={isForm ? "From" : "Showing"}>
        <SourceSwitch
          source={source}
          onPick={(s) => {
            setSource(s);
            setDraft((d) => pruneFor(d, s));
            if (s !== "saved") {
              setDraftExtras(null);
              askSeq.current++;
              setThinking(false);
            }
          }}
        />
      </Section>

      {source === "saved" && draftExtras && (
        <div className="mt-3">
          {draftExtras && (
            <p className="mt-1.5 text-[12px] leading-snug" style={{ color: "var(--text-tertiary)" }}>
              {basic ? "Basic matching — the assistant was unavailable. " : ""}
              Picked below from “{draftExtras.said}”
              {askBites(draftExtras) ? "; the rest of what you said narrows it too" : ""}.{" "}
              <button
                onClick={() => setDraftExtras(null)}
                className="underline"
                style={{ color: "var(--text-secondary)" }}
              >
                Forget the words
              </button>
            </p>
          )}
        </div>
      )}

      {areaChips.length > 0 && (
        <Section title="Where" hint="one">
          {areaChips.map((a) => (
            <Chip
              key={a}
              label={a}
              on={draft.area === a}
              onClick={() => setDraft((d) => ({ ...d, area: d.area === a ? "" : a }))}
            />
          ))}
        </Section>
      )}

      {TAG_GROUPS.map((g) => {
        const chips = chipsFor(g, source, draft[g.field]);
        if (chips.length === 0) return null;
        return (
          <Section key={g.field} title={g.title} hint="pick any">
            {chips.map((v) => (
              <Chip
                key={v}
                label={labelOf(v)}
                on={draft[g.field].includes(v)}
                onClick={() => setDraft((d) => toggleTag(d, g.field, v))}
              />
            ))}
          </Section>
        );
      })}

      <Section title="Budget per person" hint="one">
        {withValue(BUDGETS, draft.maxBudget).map((n) => (
          <Chip
            key={n}
            label={`Under ₹${n.toLocaleString("en-IN")}`}
            on={draft.maxBudget === n}
            onClick={() => setDraft((d) => ({ ...d, maxBudget: d.maxBudget === n ? null : n }))}
          />
        ))}
      </Section>

      <Section title="Rating" hint="one">
        {withValue(RATINGS, draft.minRating).map((n) => (
          <Chip
            key={n}
            label={`${n.toFixed(1)}+`}
            on={draft.minRating === n}
            onClick={() => setDraft((d) => ({ ...d, minRating: d.minRating === n ? null : n }))}
          />
        ))}
      </Section>

      {/* Your own places' facts: their lifecycle, and hours (Google's, on a
          saved place). Swiggy cards carry neither yet, so a New deck doesn't
          offer them. */}
      {source !== "new" && (
        <Section title="Your places" hint="one">
          {LIFECYCLES.filter((l) => l.value !== "any").map((l) => (
            <Chip
              key={l.value}
              label={l.label}
              on={draft.lifecycle === l.value}
              onClick={() => setDraft((d) => ({ ...d, lifecycle: d.lifecycle === l.value ? "any" : l.value }))}
            />
          ))}
          <Chip
            label="Open now"
            icon={<Clock size={12} strokeWidth={2.5} />}
            on={draft.openNow}
            onClick={() => setDraft((d) => ({ ...d, openNow: !d.openNow }))}
          />
        </Section>
      )}

      {onOpenMap && !isForm && (
        <div className="mt-5 pt-3" style={{ borderTop: "1px solid var(--border)" }}>
          <button
            onClick={onOpenMap}
            className="press flex w-full items-center gap-2.5 px-3 py-2.5 text-left"
            style={{
              background: "var(--bg-elevated)",
              border: "1px solid var(--border-strong)",
              borderRadius: "var(--radius-sm)",
            }}
          >
            <MapIcon size={15} strokeWidth={2.25} style={{ color: "var(--accent)" }} />
            <span className="flex-1 text-[13.5px] font-semibold" style={{ color: "var(--text-primary)" }}>
              Open map mode
            </span>
            <span className="text-[11.5px]" style={{ color: "var(--text-tertiary)" }}>
              or <span className="pointer-fine:hidden">double-tap</span>
              <span className="pointer-coarse:hidden">double-click</span> the name
            </span>
          </button>
        </div>
      )}

      {/* The way back to the two doors once "Don't ask me again" was ticked.
          It lives in swipe mode's own sheet, not the map's menu: it is a
          setting of this mode. A device preference, so it saves on the tap
          rather than waiting for Apply. */}
      {!isForm && (
        <label className="mt-3 flex min-h-[44px] cursor-pointer items-center gap-3 px-1">
          <span className="min-w-0 flex-1 text-[13px]" style={{ color: "var(--text-secondary)" }}>
            Ask “go wild or I know what I want” when swipe opens
          </span>
          <input
            type="checkbox"
            checked={askDoors}
            onChange={(e) => {
              setAskDoors(e.target.checked);
              setAskOnOpen(e.target.checked);
            }}
            className="h-5 w-5 shrink-0"
            style={{ accentColor: "var(--accent)" }}
          />
        </label>
      )}
    </>
  );

  const searchBox = (
    <label
      className="flex items-center gap-2 px-3"
      style={{
        background: "var(--bg-elevated)",
        border: `1px solid ${text ? "var(--accent)" : "var(--border-strong)"}`,
        borderRadius: "var(--radius-sm)",
      }}
    >
      <Search size={15} strokeWidth={2.25} style={{ color: "var(--accent)" }} />
      <span className="sr-only">Search areas, cuisines, dishes and vibes</span>
      <input
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape" && text) {
            e.stopPropagation();
            setText("");
            return;
          }
          if (e.key !== "Enter") return;
          // A sentence asks; a word takes its best match.
          if (canAsk && (/\s/.test(text.trim()) || !suggestions[0])) void ask();
          else if (suggestions[0]) takeSuggestion(suggestions[0]);
        }}
        placeholder={source === "saved" ? "Area, cuisine — or just say it…" : "Area, cuisine, dish, vibe…"}
        className="min-w-0 flex-1 bg-transparent py-2.5 text-[14px] outline-none"
        style={{ color: "var(--text-primary)" }}
      />
      {text && (
        <button
          onClick={() => setText("")}
          aria-label="Clear search"
          className="press grid h-7 w-7 place-items-center rounded-full"
          style={{ background: "var(--bg-hover)", color: "var(--text-tertiary)" }}
        >
          <X size={12} strokeWidth={2.5} />
        </button>
      )}
    </label>
  );

  const results = (
    <ul className="mt-1" aria-label="Suggestions">
      {canAsk && (
        <li>
          <button
            onClick={() => void ask()}
            disabled={thinking}
            className="press flex min-h-[48px] w-full items-center justify-between gap-3 px-1 text-left"
            style={{ borderBottom: "1px solid var(--border)" }}
          >
            <span className="min-w-0 truncate text-[15px]" style={{ color: "var(--accent)" }}>
              {thinking ? "Reading…" : `Ask “${text.trim()}”`}
            </span>
            <span className="shrink-0 text-[11px] uppercase tracking-[0.06em]" style={{ color: "var(--text-tertiary)", fontFamily: "var(--font-mono)" }}>
              your words
            </span>
          </button>
        </li>
      )}
      {suggestions.length === 0 && !canAsk && (
        <li className="px-1 py-4 text-[13px]" style={{ color: "var(--text-tertiary)" }}>
          Nothing by that name{source === "new" ? " that Swiggy can search for" : ""}.
        </li>
      )}
      {suggestions.map((s) => (
        <li key={`${s.kind}:${s.kind === "tag" ? s.field : ""}:${s.value}:${s.label}`}>
          <button
            onClick={() => takeSuggestion(s)}
            className="press flex min-h-[48px] w-full items-center justify-between gap-3 px-1 text-left"
            style={{ borderBottom: "1px solid var(--border)" }}
          >
            <span className="text-[15px]" style={{ color: "var(--text-primary)" }}>
              {s.label}
              {isPicked(s) && (
                <span className="ml-2 text-[12px]" style={{ color: "var(--accent)" }}>
                  picked
                </span>
              )}
            </span>
            <span className="shrink-0 text-[11px] uppercase tracking-[0.06em]" style={{ color: "var(--text-tertiary)", fontFamily: "var(--font-mono)" }}>
              {s.group}
            </span>
          </button>
        </li>
      ))}
    </ul>
  );

  const footer = (
    <>
    {overCap && (
      <p className="pt-3 text-[12.5px] leading-snug" style={{ color: "var(--text-tertiary)" }}>
        New searches 4 picks at a time:{" "}
        <span style={{ color: "var(--text-secondary)" }}>{overCap.join(", ")}</span>. Remove one to swap another in.
      </p>
    )}
    <div className="flex items-center gap-2 pt-3">
      {(picked > 0 || draftExtras) && (
        <button
          onClick={() => {
            setDraft(EMPTY_FILTERS);
            setDraftExtras(null);
            askSeq.current++;
            setThinking(false);
          }}
          className="press px-4 py-3 text-[13.5px] font-semibold"
          style={{ color: "var(--text-tertiary)" }}
        >
          Clear all
        </button>
      )}
      <button
        onClick={apply}
        disabled={thinking}
        className="press flex-1 py-3 text-[15px] font-bold disabled:opacity-60"
        style={{ background: "oklch(0.97 0 0)", color: "oklch(0.16 0.006 260)", borderRadius: "var(--radius-chip)" }}
      >
        {thinking
          ? "Reading your words…"
          : isForm && picks === 0
            ? "Just show me places"
            : picks > 0
              ? `Show places · ${picks} picked`
              : "Show places"}
      </button>
    </div>
    </>
  );

  if (isForm) {
    // Portalled to the page root: rendered inside the deck, the form would sit
    // in the deck's stacking layer and the masthead (a sibling layer above it)
    // would draw its wordmark across the form's header.
    // The form only ever opens from a tap, so there is always a document.
    if (typeof document === "undefined") return null;
    return createPortal(
      <div
        className="fixed inset-0 z-[60] flex flex-col"
        style={{ background: "var(--deck-bg)", height: "var(--app-viewport-h)" }}
        role="dialog"
        aria-modal="true"
        aria-label="What are you in the mood for?"
        ref={dialogRef}
        tabIndex={-1}
        onKeyDown={onDialogKey}
      >
        <div className="mx-auto flex w-full max-w-[430px] min-h-0 flex-1 flex-col px-5 pt-[max(1rem,env(safe-area-inset-top))]">
          <div className="flex items-center justify-between py-2">
            <button
              onClick={onClose}
              aria-label="Back"
              className="press grid h-10 w-10 place-items-center rounded-full"
              style={{ background: "var(--bg-elevated)", color: "var(--text-primary)" }}
            >
              <ChevronLeft size={18} strokeWidth={2.25} />
            </button>
            <span
              className="px-3 py-1.5 text-[11.5px]"
              style={{ fontFamily: "var(--font-mono)", color: "var(--accent)", background: "var(--accent-soft)", borderRadius: "var(--radius-chip)" }}
            >
              every question is optional
            </span>
          </div>
          <h2 className="mt-2 text-[28px] leading-tight" style={{ fontFamily: "var(--font-display)", color: "var(--text-primary)" }}>
            What are you in the mood for?
          </h2>
          <p className="mt-1 text-[13.5px]" style={{ color: "var(--text-tertiary)" }}>
            Pick what you know, skip what you don&rsquo;t.
          </p>
          <div className="mt-4">{searchBox}</div>
          <div className="scroll-quiet min-h-0 flex-1 overflow-y-auto pb-4">{text ? results : body}</div>
          <div className="pb-[max(1.25rem,env(safe-area-inset-bottom))]" style={{ borderTop: "1px solid var(--border)" }}>
            {footer}
          </div>
        </div>
      </div>,
      document.body
    );
  }

  return (
    <div className="fixed inset-0 z-[54] flex flex-col justify-end" style={{ background: "rgba(6,7,10,0.6)" }} onClick={onClose}>
      <div
        className="animate-rise mx-auto flex max-h-[88dvh] w-full max-w-[560px] flex-col px-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-3"
        style={{
          background: "var(--bg-raised)",
          borderTopLeftRadius: "var(--radius-lg)",
          borderTopRightRadius: "var(--radius-lg)",
          boxShadow: "var(--shadow-sheet)",
        }}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Filters"
        ref={dialogRef}
        tabIndex={-1}
        onKeyDown={onDialogKey}
      >
        <div className="mb-3 flex items-center justify-between">
          <span className="eyebrow" style={{ color: "var(--accent)" }}>
            Filters
          </span>
          <button
            onClick={onClose}
            aria-label="Close filters"
            className="press grid h-8 w-8 place-items-center rounded-full"
            style={{ background: "var(--bg-elevated)", color: "var(--text-tertiary)" }}
          >
            <X size={15} strokeWidth={2.25} />
          </button>
        </div>
        {searchBox}
        <div className="scroll-quiet min-h-0 flex-1 overflow-y-auto pb-2">{text ? results : body}</div>
        <div style={{ borderTop: "1px solid var(--border)" }}>{footer}</div>
      </div>
    </div>
  );
}

// The preset ladder, plus a value an ask set that isn't on it ("under 800")
// — a pick you can't see is a pick you can't take off.
function withValue(presets: number[], v: number | null): number[] {
  return v == null || presets.includes(v) ? presets : [...presets, v].sort((a, b) => a - b);
}

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="mt-4">
      <div className="mb-2 flex items-baseline justify-between">
        <span className="text-[11px] font-bold uppercase tracking-[0.08em]" style={{ color: "var(--text-tertiary)" }}>
          {title}
        </span>
        {hint && (
          <span className="text-[11.5px]" style={{ color: "var(--text-tertiary)" }}>
            {hint}
          </span>
        )}
      </div>
      <div className="flex flex-wrap gap-1.5">{children}</div>
    </div>
  );
}

function Chip({
  label,
  on,
  onClick,
  icon,
}: {
  label: string;
  on: boolean;
  onClick: () => void;
  icon?: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      aria-pressed={on}
      className="press flex min-h-[36px] items-center gap-1.5 px-3.5 text-[13px] font-semibold transition-colors"
      style={{
        borderRadius: "var(--radius-chip)",
        background: on ? "oklch(0.97 0 0)" : "transparent",
        color: on ? "oklch(0.16 0.006 260)" : "var(--text-secondary)",
        border: `1px solid ${on ? "oklch(0.97 0 0)" : "var(--border-strong)"}`,
      }}
    >
      {icon}
      {label}
    </button>
  );
}
