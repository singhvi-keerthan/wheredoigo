"use client";

import { useState } from "react";
import { RefreshCw, ChevronRight } from "lucide-react";
import { useSyncStatus, connect, disconnect, sync } from "@/lib/sync/client";

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

// The Sync row in the Menu: connect this device with a secret phrase, then show
// live status. Records (places, visits, tags, notes) follow you across devices;
// photos stay local until the Blob phase.
export default function SyncSection({ onToast }: { onToast: (m: string) => void }) {
  const status = useSyncStatus();
  const [open, setOpen] = useState(false);
  const [pass, setPass] = useState("");
  const [busy, setBusy] = useState(false);

  const doConnect = async () => {
    const phrase = pass.trim();
    if (phrase.length < 4) {
      onToast("Use a longer phrase (4+ characters)");
      return;
    }
    setBusy(true);
    try {
      await connect(phrase);
      setPass("");
      setOpen(false);
      onToast("This device is now syncing");
    } catch {
      onToast("Couldn’t connect — try again");
    } finally {
      setBusy(false);
    }
  };

  const doDisconnect = () => {
    if (!window.confirm("Stop syncing on this device? Your places stay here; other devices keep theirs.")) return;
    disconnect();
    onToast("Stopped syncing on this device");
  };

  if (status.connected) {
    const detail =
      status.state === "idle" && status.lastSyncedAt ? `Last synced ${relTime(status.lastSyncedAt)}` : LABEL[status.state] ?? "";
    return (
      <div
        className="flex w-full items-center gap-3 rounded-[var(--radius)] px-3.5 py-3"
        style={{ background: "var(--bg-elevated)", border: "1px solid var(--ink-line)" }}
      >
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
          onClick={doDisconnect}
          className="press shrink-0 rounded-full px-2.5 py-1 text-[12px] font-semibold"
          style={{ color: "var(--text-tertiary)", background: "var(--bg-raised)", border: "1px solid var(--ink-line)" }}
        >
          Disconnect
        </button>
      </div>
    );
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="press flex w-full items-center gap-3 rounded-[var(--radius)] px-3.5 py-3 text-left"
        style={{ background: "var(--bg-elevated)", border: "1px solid var(--ink-line)" }}
      >
        <RefreshCw size={18} style={{ color: "var(--text-secondary)" }} />
        <span className="min-w-0 flex-1">
          <span className="block text-[15px] font-semibold" style={{ color: "var(--text-primary)" }}>
            Sync across devices
          </span>
          <span className="block text-[12.5px]" style={{ color: "var(--text-tertiary)" }}>
            One secret phrase shares this library everywhere
          </span>
        </span>
        <ChevronRight size={17} style={{ color: "var(--text-tertiary)" }} />
      </button>
    );
  }

  return (
    <div className="rounded-[var(--radius)] px-3.5 py-3" style={{ background: "var(--bg-elevated)", border: "1px solid var(--ink-line)" }}>
      <p className="text-[12.5px] leading-snug" style={{ color: "var(--text-tertiary)" }}>
        Enter a secret phrase. Type the <em>same</em> phrase on your other devices to share this library. There’s no recovery if
        you forget it.
      </p>
      <div className="mt-2.5 flex items-center gap-2">
        <input
          type="password"
          value={pass}
          onChange={(e) => setPass(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && doConnect()}
          autoFocus
          placeholder="your secret phrase"
          className="min-w-0 flex-1 rounded-[10px] px-3 py-2 text-[15px] outline-none"
          style={{ background: "var(--bg-raised)", border: "1px solid var(--ink-line)", color: "var(--text-primary)" }}
        />
        <button
          onClick={doConnect}
          disabled={busy}
          className="press shrink-0 rounded-[10px] px-3.5 py-2 text-[14px] font-semibold disabled:opacity-60"
          style={{ background: "var(--text-primary)", color: "var(--bg-raised)" }}
        >
          {busy ? "…" : "Connect"}
        </button>
      </div>
    </div>
  );
}
