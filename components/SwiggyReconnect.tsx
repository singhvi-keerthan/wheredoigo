"use client";

import { useEffect, useState } from "react";
import { RefreshCw, ChevronRight } from "lucide-react";
import { startSwiggyRenew } from "@/lib/swiggyClient";

// The menu's "Renew Swiggy" row — the same consent the #renew-swiggy link and
// the deck's Reconnect start (phone + OTP on Swiggy's page, then
// /api/swiggy/renew/callback), reachable any time instead of only after a
// search has already failed. Shows how long the current token has left, from
// the ungated /api/swiggy/token-status (an expiry instant, nothing else).
function left(hours: number | null): string {
  if (hours == null) return "Not connected — renew to turn on New";
  if (hours <= 0) return "Expired — renew to turn New back on";
  if (hours < 24) return `Expires in ${Math.max(1, Math.round(hours))} h`;
  const days = Math.round(hours / 24);
  return `Expires in ${days} day${days === 1 ? "" : "s"}`;
}

export default function SwiggyReconnect() {
  const [hours, setHours] = useState<number | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let off = false;
    fetch("/api/swiggy/token-status")
      .then((r) => r.json())
      .then((d: { hoursLeft: number | null }) => !off && setHours(d.hoursLeft))
      .catch(() => !off && setHours(undefined));
    return () => {
      off = true;
    };
  }, []);

  const renew = async () => {
    setBusy(true);
    setFailed(false);
    const { url } = await startSwiggyRenew();
    if (url) return window.location.assign(url);
    setBusy(false);
    setFailed(true);
  };

  const sub = failed
    ? "Couldn’t start the renewal — try again"
    : busy
      ? "Opening Swiggy…"
      : hours === undefined
        ? "Phone + OTP on Swiggy’s page"
        : left(hours);

  return (
    <button
      onClick={renew}
      disabled={busy}
      className="press flex w-full items-center gap-3 rounded-[var(--radius)] px-3.5 py-3 text-left"
      style={{ background: "var(--bg-elevated)", border: "1px solid var(--ink-line)" }}
    >
      <RefreshCw size={18} style={{ color: "var(--text-secondary)" }} />
      <span className="min-w-0 flex-1">
        <span className="block text-[15px] font-semibold" style={{ color: "var(--text-primary)" }}>
          Renew Swiggy connection
        </span>
        <span className="block text-[12.5px]" style={{ color: "var(--text-tertiary)" }}>
          {sub}
        </span>
      </span>
      <ChevronRight size={17} style={{ color: "var(--text-tertiary)" }} />
    </button>
  );
}
