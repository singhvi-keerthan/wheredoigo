"use client";

import { useEffect, useState } from "react";
import { X, AlertTriangle, KeyRound, Copy, Check } from "lucide-react";
import { useSheetDrag } from "./useSheetDrag";
import {
  connectAs,
  resolveAccount,
  resolveOwner,
  type PhraseProbe,
} from "@/lib/sync/client";
import { phoneProblem, passwordProblem, displayPhone } from "@/lib/account";
import { generatePhrase } from "@/lib/phrase";

// Sign-up, asked for at the moment it starts mattering — never on arrival.
//
// The share view is the front door and it needs nothing: a friend opens the
// link, reads the map, leaves. This sheet is what appears the first time they
// try to do something that has to belong to SOMEBODY — save a place, open swipe
// mode — because until then there is nothing to keep and nobody to keep it for.
//
// A phone number and a password, no OTP. The number is not verified and is not
// an identity (see lib/account.ts); it is the half of the key nobody has to
// write down. The password is the half that actually protects the library, and
// passwordProblem refuses the ones that would not.
//
// Sign-up and sign-in are ONE form. The server is asked what the phone and
// password open before anything commits, so the sheet can say "welcome back,
// 12 places" or "this creates a new map" instead of making someone declare
// which one they meant and silently doing the wrong thing if they were wrong.

export type SignUpReason = "add" | "swipe" | "ask";

const WHY: Record<SignUpReason, { title: string; line: string }> = {
  add: {
    title: "Save it to your map",
    line: "You’re about to add your first place. A map has to belong to someone — this takes a phone number and a password.",
  },
  swipe: {
    title: "Swipe needs a map",
    line: "Swipe mode keeps what you like and drops what you don’t, so it needs somewhere to keep it.",
  },
  ask: {
    title: "Ask your own map",
    line: "Ask searches places you’ve saved. Make a map first and it has something to search.",
  },
};

type Step = "form" | "confirm" | "phrase" | "recovery";

export default function SignUpSheet({
  reason,
  onClose,
  onDone,
  onToast,
}: {
  reason: SignUpReason;
  onClose: () => void;
  onDone: () => void;
  onToast: (m: string) => void;
}) {
  const { sheetRef, handleProps } = useSheetDrag(onClose);
  const [step, setStep] = useState<Step>("form");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [phrase, setPhrase] = useState("");
  const [probe, setProbe] = useState<PhraseProbe | null>(null);
  const [busy, setBusy] = useState(false);
  const [recovery, setRecovery] = useState("");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Ask what this phone and password open. Nothing is committed here — the
  // answer is shown first, which is the difference between joining your own map
  // and silently starting a second empty one next to it.
  const check = async () => {
    const bad = phoneProblem(phone) ?? passwordProblem(password, phone);
    if (bad) {
      onToast(bad);
      return;
    }
    setBusy(true);
    try {
      setProbe(await resolveAccount(phone, password));
      setStep("confirm");
    } catch {
      onToast("Couldn’t reach the server — check your connection");
    } finally {
      setBusy(false);
    }
  };

  // No strength check: this path only ever JOINS a map that already exists (a
  // phrase that opens nothing is refused below), and screening the input first
  // would lock out every library made under the old 4-character floor.
  const checkPhrase = async () => {
    setBusy(true);
    try {
      const found = await resolveOwner(phrase);
      if (!found.exists) {
        onToast("No map opens with that phrase");
        return;
      }
      setProbe(found);
      setStep("confirm");
    } catch {
      onToast("Couldn’t reach the server — check your connection");
    } finally {
      setBusy(false);
    }
  };

  const commit = async () => {
    if (!probe) return;
    setBusy(true);
    try {
      if (phrase) {
        await connectAs(probe.owner, { phrase, legacy: probe.legacy });
        onToast("Signed in — merging your map in");
        onDone();
        return;
      }
      if (probe.exists) {
        await connectAs(probe.owner, { phone });
        onToast("Signed in — merging your map in");
        onDone();
        return;
      }
      // A NEW map. Mint a recovery phrase in the same breath and register it
      // against this owner, so "there is no password reset" stops being the end
      // of the story — a phone number and a password are two things a person
      // can lose at once, and everything they save is behind both.
      const mint = generatePhrase();
      await connectAs(probe.owner, { phone, recovery: mint });
      setRecovery(mint);
      setStep("recovery");
    } catch {
      onToast("Couldn’t sign in — try again");
    } finally {
      setBusy(false);
    }
  };

  const copyRecovery = async () => {
    try {
      await navigator.clipboard.writeText(recovery);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      /* clipboard blocked — the words are on screen anyway */
    }
  };

  const field = {
    background: "var(--bg-elevated)",
    border: "1px solid var(--ink-line)",
    color: "var(--text-primary)",
  } as const;
  const primary = { background: "var(--text-primary)", color: "var(--bg-raised)" } as const;
  const quiet = {
    background: "var(--bg-elevated)",
    border: "1px solid var(--ink-line)",
    color: "var(--text-secondary)",
  } as const;

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

        <div className="flex items-center justify-between pb-1">
          <h1
            className="text-[22px] font-medium leading-none tracking-[-0.01em]"
            style={{ fontFamily: "var(--font-display)", color: "var(--text-primary)" }}
          >
            {step === "confirm" && probe?.exists ? "Welcome back" : WHY[reason].title}
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

        {/* ---- the form ------------------------------------------------- */}
        {step === "form" && (
          <>
            <p className="pb-3 pt-1.5 text-[13px] leading-snug" style={{ color: "var(--text-tertiary)" }}>
              {WHY[reason].line}
            </p>
            <input
              type="tel"
              inputMode="numeric"
              autoComplete="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="Phone number"
              className="mb-2 w-full rounded-[12px] px-3.5 py-3 text-[16px] outline-none"
              style={field}
            />
            <input
              // A password people will retype on a second phone, so nothing that
              // silently rewrites it: no autocapitalise, no autocorrect.
              type="password"
              autoCapitalize="none"
              autoCorrect="off"
              autoComplete="current-password"
              spellCheck={false}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && void check()}
              placeholder="Password"
              className="w-full rounded-[12px] px-3.5 py-3 text-[16px] outline-none"
              style={field}
            />
            <p className="mt-2 flex gap-1.5 text-[12px] leading-snug" style={{ color: "var(--text-tertiary)" }}>
              <AlertTriangle size={13} className="mt-[1px] shrink-0" style={{ color: "oklch(0.75 0.15 85)" }} />
              <span>
                No code is sent and your number isn’t verified — it just names your map. There’s no password reset, so pick one
                you’ll remember.
              </span>
            </p>
            <button
              onClick={() => void check()}
              disabled={busy}
              className="press mt-3 w-full rounded-[12px] py-3 text-[15px] font-semibold disabled:opacity-60"
              style={primary}
            >
              {busy ? "…" : "Continue"}
            </button>
            <button
              onClick={() => setStep("phrase")}
              className="press mt-2.5 flex w-full items-center justify-center gap-1.5 text-[12.5px]"
              style={{ color: "var(--text-tertiary)" }}
            >
              <KeyRound size={13} />
              I have a recovery phrase
            </button>
          </>
        )}

        {/* ---- the recovery-phrase way in -------------------------------- */}
        {step === "phrase" && (
          <>
            <p className="pb-3 pt-1.5 text-[13px] leading-snug" style={{ color: "var(--text-tertiary)" }}>
              The six words from your other device.
            </p>
            <input
              type="text"
              autoCapitalize="none"
              autoCorrect="off"
              autoComplete="off"
              spellCheck={false}
              value={phrase}
              onChange={(e) => setPhrase(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && void checkPhrase()}
              placeholder="amber pine tiger …"
              className="w-full rounded-[12px] px-3.5 py-3 text-[16px] outline-none"
              style={field}
            />
            <button
              onClick={() => void checkPhrase()}
              disabled={busy}
              className="press mt-3 w-full rounded-[12px] py-3 text-[15px] font-semibold disabled:opacity-60"
              style={primary}
            >
              {busy ? "…" : "Check"}
            </button>
            <button onClick={() => setStep("form")} className="press mt-2.5 w-full text-[12.5px]" style={{ color: "var(--text-tertiary)" }}>
              Back
            </button>
          </>
        )}

        {/* ---- the recovery phrase, shown once, after the map exists ------ */}
        {step === "recovery" && (
          <>
            <p className="pb-1 pt-1.5 text-[13px] leading-snug" style={{ color: "var(--text-tertiary)" }}>
              Your map is ready. If you ever forget your password, these six words are the way back in — they’re the only way.
            </p>
            <div
              className="mt-2 rounded-[12px] p-3"
              style={{ background: "var(--bg-elevated)", border: "1px solid var(--ink-line)" }}
            >
              <p
                className="select-all break-words text-[15px] leading-relaxed"
                style={{ fontFamily: "var(--font-mono)", color: "var(--text-primary)", letterSpacing: "0.01em" }}
              >
                {recovery}
              </p>
              <button
                onClick={copyRecovery}
                className="press mt-2 inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px] font-semibold"
                style={{ background: "var(--bg-raised)", border: "1px solid var(--ink-line)", color: "var(--text-secondary)" }}
              >
                {copied ? <Check size={13} /> : <Copy size={13} />}
                {copied ? "Copied" : "Copy"}
              </button>
            </div>
            <p className="mt-2 text-[12px] leading-snug" style={{ color: "var(--text-tertiary)" }}>
              You can see them again any time under Sync in the menu, on this phone.
            </p>
            <button
              onClick={onDone}
              className="press mt-3 w-full rounded-[12px] py-3 text-[15px] font-semibold"
              style={primary}
            >
              Saved it — let’s go
            </button>
          </>
        )}

        {/* ---- what that actually opens ---------------------------------- */}
        {step === "confirm" && probe && (
          <>
            <p className="pb-3 pt-1.5 text-[13px] leading-snug" style={{ color: "var(--text-tertiary)" }}>
              {probe.exists ? (
                <>
                  <span style={{ fontFamily: "var(--font-mono)", color: "var(--text-secondary)" }}>{probe.places}</span>{" "}
                  {probe.places === 1 ? "place" : "places"} already saved
                  {phone && !phrase ? ` under ${displayPhone(phone)}` : ""}. Signing in merges that map with anything on this
                  device.
                </>
              ) : (
                <>
                  This creates a new map{phone ? ` for ${displayPhone(phone)}` : ""}. Nothing is saved under it yet — what you
                  add from here is yours.
                </>
              )}
            </p>
            <button
              onClick={() => void commit()}
              disabled={busy}
              className="press w-full rounded-[12px] py-3 text-[15px] font-semibold disabled:opacity-60"
              style={primary}
            >
              {busy ? "…" : probe.exists ? "Sign in" : "Create my map"}
            </button>
            <button
              onClick={() => {
                setProbe(null);
                setStep(phrase ? "phrase" : "form");
              }}
              disabled={busy}
              className="press mt-2 w-full rounded-[12px] py-2.5 text-[14px] font-semibold"
              style={quiet}
            >
              Back
            </button>
          </>
        )}
      </div>
    </div>
  );
}
