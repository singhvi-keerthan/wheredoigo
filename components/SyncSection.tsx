"use client";

import { useState } from "react";
import { RefreshCw, ChevronRight, Copy, Check, Eye, EyeOff, AlertTriangle } from "lucide-react";
import {
  useSyncStatus,
  connectAs,
  disconnect,
  sync,
  resolveOwner,
  savedPhrase,
  hashPhrase,
  type PhraseProbe,
} from "@/lib/sync/client";
import { generatePhrase, phraseWeak } from "@/lib/phrase";

// The Sync row in the Menu.
//
// The old version was one password field and a Connect button, and it lost
// people in three specific ways — all of which came from treating the phrase as
// a login when it is really the only key to a library:
//
//   1. A typo did not fail. connect() hashed whatever you typed, found an empty
//      namespace, said "This device is now syncing" with a green dot, and then
//      PUSHED your library into it. If the typo happened to match someone
//      else's phrase, into theirs.
//   2. type="password" hid the string you were about to have to retype exactly
//      on another phone.
//   3. You invented it, four characters were legal, and you could never see it
//      again — so setting up a second device a week later meant remembering a
//      secret the app had deliberately forgotten.
//
// So: the app offers a generated six-word phrase in plain text, and connecting
// to an EXISTING library now tells you what it opens before it commits. The
// screen answers "am I about to join my library, or silently start a second
// empty one" every time, which is the question the old one never asked.

function relTime(iso: string | null): string {
  if (!iso) return "";
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 60_000) return "just now";
  const m = Math.floor(diff / 60_000);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

const DOT: Record<string, string> = {
  idle: "oklch(0.72 0.17 150)", // green
  syncing: "oklch(0.75 0.15 85)", // amber
  offline: "oklch(0.7 0.02 260)", // grey
  error: "oklch(0.62 0.2 25)", // red
  disabled: "var(--ink-line)",
};

const LABEL: Record<string, string> = {
  idle: "Synced",
  syncing: "Syncing…",
  offline: "Offline — will retry",
  error: "Sync failed — tap to retry",
  disabled: "Not syncing",
};

const CARD = {
  background: "var(--bg-elevated)",
  border: "1px solid var(--ink-line)",
} as const;

// The phrase, shown the way it has to be read and retyped: whole, plain, and
// spaced out enough that a word can be picked off it one at a time.
function PhraseBlock({ phrase }: { phrase: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(phrase);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      /* clipboard blocked — the words are on screen anyway */
    }
  };
  return (
    <div className="mt-2.5 rounded-[10px] p-3" style={{ background: "var(--bg-raised)", border: "1px solid var(--ink-line)" }}>
      <p
        className="select-all break-words text-[15px] leading-relaxed"
        style={{ fontFamily: "var(--font-mono)", color: "var(--text-primary)", letterSpacing: "0.01em" }}
      >
        {phrase}
      </p>
      <button
        onClick={copy}
        className="press mt-2 inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px] font-semibold"
        style={{ background: "var(--bg-elevated)", border: "1px solid var(--ink-line)", color: "var(--text-secondary)" }}
      >
        {copied ? <Check size={13} /> : <Copy size={13} />}
        {copied ? "Copied" : "Copy"}
      </button>
    </div>
  );
}

type Mode = "closed" | "choose" | "created" | "entering";

export default function SyncSection({ onToast }: { onToast: (m: string) => void }) {
  const status = useSyncStatus();
  const [mode, setMode] = useState<Mode>("closed");
  const [newPhrase, setNewPhrase] = useState("");
  const [typed, setTyped] = useState("");
  const [probe, setProbe] = useState<PhraseProbe | null>(null);
  const [busy, setBusy] = useState(false);
  const [revealed, setRevealed] = useState(false);

  const reset = () => {
    setMode("closed");
    setNewPhrase("");
    setTyped("");
    setProbe(null);
    setRevealed(false);
  };

  const startCreate = () => {
    setNewPhrase(generatePhrase());
    setMode("created");
  };

  // Check what the typed phrase opens, WITHOUT connecting to it. This is the
  // whole fix for the silent typo: the answer comes back before any data moves.
  //
  // NO strength check here. The floor rose (12 chars, 3 distinct words) and the
  // old one was 4 characters, so screening the input before the lookup would
  // refuse every library made under the old rules — telling their actual owners
  // their own phrase was invalid and putting the legacy fallback permanently
  // out of reach of the exact people it was written for. Strength is checked
  // when a phrase CREATES something, below.
  const check = async () => {
    setBusy(true);
    try {
      setProbe(await resolveOwner(typed));
    } catch {
      onToast("Couldn’t reach sync — check your connection");
    } finally {
      setBusy(false);
    }
  };

  // `ownerKey` empty means "derive it from the phrase" — the create path, where
  // the phrase was generated here and there is nothing to resolve against.
  const commit = async (ownerKey: string, phrase: string, joined: boolean, legacy = false) => {
    setBusy(true);
    try {
      await connectAs(ownerKey || (await hashPhrase(phrase)), { phrase, legacy });
      reset();
      onToast(joined ? "Connected — merging that library in" : "This device is now syncing");
    } catch {
      onToast("Couldn’t connect — try again");
    } finally {
      setBusy(false);
    }
  };

  // ---- connected ----------------------------------------------------------
  if (status.connected) {
    const detail =
      status.state === "idle" && status.lastSyncedAt ? `Last synced ${relTime(status.lastSyncedAt)}` : LABEL[status.state] ?? "";
    const phrase = savedPhrase();
    return (
      <div className="rounded-[var(--radius)]" style={CARD}>
        <div className="flex w-full items-center gap-3 px-3.5 py-3">
          <button onClick={() => sync()} className="press flex min-w-0 flex-1 items-center gap-3 text-left" aria-label="Sync now">
            <span
              className={`h-2.5 w-2.5 shrink-0 rounded-full ${status.state === "syncing" ? "animate-pulse" : ""}`}
              style={{ background: DOT[status.state] ?? DOT.idle }}
            />
            <span className="min-w-0 flex-1">
              <span className="block text-[15px] font-semibold" style={{ color: "var(--text-primary)" }}>
                {LABEL[status.state] ?? "Synced"}
              </span>
              <span className="block text-[12.5px]" style={{ color: "var(--text-tertiary)" }}>
                {detail}
                {status.pending > 0 ? ` · ${status.pending} pending` : ""}
              </span>
            </span>
          </button>
          <button
            onClick={() => {
              if (!window.confirm("Stop syncing on this device? Your places stay here; other devices keep theirs.")) return;
              disconnect();
              setRevealed(false);
              onToast("Stopped syncing on this device");
            }}
            className="press shrink-0 rounded-full px-2.5 py-1 text-[12px] font-semibold"
            style={{ color: "var(--text-tertiary)", background: "var(--bg-raised)", border: "1px solid var(--ink-line)" }}
          >
            Disconnect
          </button>
        </div>

        {/* Setting up a second device is the ONLY reason anyone needs the phrase
            after connecting, and the old build made that the one thing it could
            not help with. Devices connected before this change have no stored
            phrase, so the row simply isn't there for them. */}
        {phrase && (
          <div className="border-t px-3.5 py-2.5" style={{ borderColor: "var(--ink-line)" }}>
            <button
              onClick={() => setRevealed((v) => !v)}
              className="press flex w-full items-center gap-2 text-left"
              aria-expanded={revealed}
            >
              {revealed ? (
                <EyeOff size={15} style={{ color: "var(--text-tertiary)" }} />
              ) : (
                <Eye size={15} style={{ color: "var(--text-tertiary)" }} />
              )}
              <span className="flex-1 text-[13px] font-medium" style={{ color: "var(--text-secondary)" }}>
                {revealed ? "Hide phrase" : "Show phrase for another device"}
              </span>
            </button>
            {revealed && <PhraseBlock phrase={phrase} />}
          </div>
        )}
      </div>
    );
  }

  // ---- closed -------------------------------------------------------------
  if (mode === "closed") {
    return (
      <button
        onClick={() => setMode("choose")}
        className="press flex w-full items-center gap-3 rounded-[var(--radius)] px-3.5 py-3 text-left"
        style={CARD}
      >
        <RefreshCw size={18} style={{ color: "var(--text-secondary)" }} />
        <span className="min-w-0 flex-1">
          <span className="block text-[15px] font-semibold" style={{ color: "var(--text-primary)" }}>
            Sync across devices
          </span>
          <span className="block text-[12.5px]" style={{ color: "var(--text-tertiary)" }}>
            One phrase shares this library everywhere
          </span>
        </span>
        <ChevronRight size={17} style={{ color: "var(--text-tertiary)" }} />
      </button>
    );
  }

  const primaryBtn = {
    background: "var(--text-primary)",
    color: "var(--bg-raised)",
  } as const;
  const quietBtn = {
    background: "var(--bg-raised)",
    border: "1px solid var(--ink-line)",
    color: "var(--text-secondary)",
  } as const;

  return (
    <div className="rounded-[var(--radius)] px-3.5 py-3" style={CARD}>
      {/* ---- choose ---------------------------------------------------- */}
      {mode === "choose" && (
        <>
          <p className="text-[12.5px] leading-snug" style={{ color: "var(--text-tertiary)" }}>
            A phrase is the key to a library. Same phrase on two phones, same places on both.
          </p>
          <div className="mt-2.5 flex gap-2">
            <button onClick={startCreate} className="press flex-1 rounded-[10px] px-3 py-2 text-[14px] font-semibold" style={primaryBtn}>
              Create a library
            </button>
            <button
              onClick={() => setMode("entering")}
              className="press flex-1 rounded-[10px] px-3 py-2 text-[14px] font-semibold"
              style={quietBtn}
            >
              I have a phrase
            </button>
          </div>
          <button onClick={reset} className="press mt-2 text-[12.5px]" style={{ color: "var(--text-tertiary)" }}>
            Cancel
          </button>
        </>
      )}

      {/* ---- created: show the phrase before anything is committed ------ */}
      {mode === "created" && (
        <>
          <p className="text-[13px] font-semibold" style={{ color: "var(--text-primary)" }}>
            Your phrase
          </p>
          <PhraseBlock phrase={newPhrase} />
          <p className="mt-2.5 flex gap-1.5 text-[12.5px] leading-snug" style={{ color: "var(--text-tertiary)" }}>
            <AlertTriangle size={14} className="mt-[1px] shrink-0" style={{ color: "oklch(0.75 0.15 85)" }} />
            <span>
              Write it down. It’s the only way to open this library on another device, and there’s no reset — but you can see it
              again here any time on this phone.
            </span>
          </p>
          <div className="mt-2.5 flex gap-2">
            <button
              onClick={() => void commit("", newPhrase, false)}
              disabled={busy}
              className="press flex-1 rounded-[10px] px-3 py-2 text-[14px] font-semibold disabled:opacity-60"
              style={primaryBtn}
            >
              {busy ? "…" : "Connect this device"}
            </button>
            <button onClick={startCreate} disabled={busy} className="press rounded-[10px] px-3 py-2 text-[14px] font-semibold" style={quietBtn}>
              New one
            </button>
          </div>
          <button onClick={reset} className="press mt-2 text-[12.5px]" style={{ color: "var(--text-tertiary)" }}>
            Cancel
          </button>
        </>
      )}

      {/* ---- entering an existing phrase -------------------------------- */}
      {mode === "entering" && !probe && (
        <>
          <p className="text-[12.5px] leading-snug" style={{ color: "var(--text-tertiary)" }}>
            Type the phrase from your other device. We’ll tell you what it opens before anything moves.
          </p>
          <div className="mt-2.5 flex items-center gap-2">
            <input
              // Plain text, and every mobile keyboard "helper" turned off: this
              // is a string that has to match another device exactly, and
              // autocapitalise alone was enough to miss.
              type="text"
              inputMode="text"
              autoCapitalize="none"
              autoCorrect="off"
              autoComplete="off"
              spellCheck={false}
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && void check()}
              autoFocus
              placeholder="amber pine tiger …"
              className="min-w-0 flex-1 rounded-[10px] px-3 py-2 text-[15px] outline-none"
              style={{ background: "var(--bg-raised)", border: "1px solid var(--ink-line)", color: "var(--text-primary)" }}
            />
            <button
              onClick={() => void check()}
              disabled={busy}
              className="press shrink-0 rounded-[10px] px-3.5 py-2 text-[14px] font-semibold disabled:opacity-60"
              style={primaryBtn}
            >
              {busy ? "…" : "Check"}
            </button>
          </div>
          <button onClick={() => setMode("choose")} className="press mt-2 text-[12.5px]" style={{ color: "var(--text-tertiary)" }}>
            Back
          </button>
        </>
      )}

      {/* ---- what that phrase actually opens ---------------------------- */}
      {mode === "entering" && probe && (
        <>
          {probe.exists ? (
            <>
              <p className="text-[13px] font-semibold" style={{ color: "var(--text-primary)" }}>
                Found that library
              </p>
              <p className="mt-1 text-[12.5px] leading-snug" style={{ color: "var(--text-tertiary)" }}>
                <span style={{ fontFamily: "var(--font-mono)", color: "var(--text-secondary)" }}>{probe.places}</span>{" "}
                {probe.places === 1 ? "place" : "places"}
                {probe.updatedAt && ` · last updated ${relTime(probe.updatedAt)}`}. Connecting merges it with what’s on this
                device.
              </p>
              <div className="mt-2.5 flex gap-2">
                <button
                  onClick={() => void commit(probe.owner, typed, true, probe.legacy)}
                  disabled={busy}
                  className="press flex-1 rounded-[10px] px-3 py-2 text-[14px] font-semibold disabled:opacity-60"
                  style={primaryBtn}
                >
                  {busy ? "…" : "Connect this device"}
                </button>
                <button onClick={() => setProbe(null)} disabled={busy} className="press rounded-[10px] px-3 py-2 text-[14px] font-semibold" style={quietBtn}>
                  Back
                </button>
              </div>
            </>
          ) : (
            <>
              {/* The case the old build silently swallowed. */}
              <p className="flex items-center gap-1.5 text-[13px] font-semibold" style={{ color: "var(--text-primary)" }}>
                <AlertTriangle size={14} style={{ color: "oklch(0.75 0.15 85)" }} />
                Nothing opens with that phrase
              </p>
              <p className="mt-1 text-[12.5px] leading-snug" style={{ color: "var(--text-tertiary)" }}>
                Check it against your other device — one wrong word is a different library. Or start a new one with this phrase.
              </p>
              <div className="mt-2.5 flex gap-2">
                <button onClick={() => setProbe(null)} className="press flex-1 rounded-[10px] px-3 py-2 text-[14px] font-semibold" style={primaryBtn}>
                  Try again
                </button>
                <button
                  onClick={() => {
                    // The one place a typed phrase becomes a NEW library, so the
                    // one place the strength floor belongs.
                    const weak = phraseWeak(typed);
                    if (weak) {
                      onToast(weak);
                      return;
                    }
                    void commit(probe.owner, typed, false);
                  }}
                  disabled={busy}
                  className="press rounded-[10px] px-3 py-2 text-[14px] font-semibold disabled:opacity-60"
                  style={quietBtn}
                >
                  {busy ? "…" : "Use it anyway"}
                </button>
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
