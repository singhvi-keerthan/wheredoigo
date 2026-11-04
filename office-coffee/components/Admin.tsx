"use client";

import { useActionState, useState, useTransition } from "react";
import { adminSignIn, chooseRestaurant, searchRestaurants, setUpToday, skipToday, type RestaurantHit } from "@/app/actions";

export function AdminSignIn() {
  const [state, action, pending] = useActionState(adminSignIn, undefined);
  return (
    <form action={action} className="card">
      <div className="field" style={{ marginTop: 0 }}>
        <label htmlFor="code">Admin code</label>
        <input id="code" name="code" type="password" className="input" required />
      </div>
      {state?.error && <p className="err" style={{ marginTop: 12 }}>{state.error}</p>}
      <div className="row">
        <button className="btn primary" disabled={pending}>
          Open settings
        </button>
      </div>
    </form>
  );
}

export function CafeSearch({ hasAddress }: { hasAddress: boolean }) {
  const [q, setQ] = useState("coffee");
  const [hits, setHits] = useState<RestaurantHit[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  if (!hasAddress) return <p className="hero-extras">Pick the office address first, then search cafés near it.</p>;

  return (
    <div style={{ marginTop: 12 }}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          start(async () => {
            setError(null);
            const r = await searchRestaurants(q);
            if ("error" in r) setError(r.error);
            else setHits(r.hits);
          });
        }}
        style={{ display: "flex", gap: 8 }}
      >
        <input className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Café or cuisine" />
        <button className="btn" disabled={pending}>
          {pending ? "…" : "Search"}
        </button>
      </form>
      {error && <p className="err" style={{ marginTop: 8 }}>{error}</p>}
      {hits?.map((h) => (
        <form key={h.id} action={chooseRestaurant} className="hit">
          <div>
            <div style={{ fontWeight: 600 }}>{h.name}</div>
            <div className="sub">
              {[h.area, h.distanceKm !== null ? `${h.distanceKm} km` : null, h.rating ? `${h.rating}★` : null, h.open ? "open" : "closed now"]
                .filter(Boolean)
                .join(" · ")}
            </div>
          </div>
          <input type="hidden" name="restaurantId" value={h.id} />
          <input type="hidden" name="restaurantName" value={h.name} />
          <button className="btn">Use this</button>
        </form>
      ))}
    </div>
  );
}

export function TodayButtons() {
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  const run = (fn: () => Promise<{ ok: boolean; error?: string }>, ok: string) =>
    start(async () => {
      const r = await fn();
      setMsg(r.ok ? { ok: true, text: ok } : { ok: false, text: r.error ?? "Didn't work" });
    });
  return (
    <>
      <div className="row">
        <button className="btn" disabled={pending} onClick={() => run(setUpToday, "Today's Slack messages are set up.")}>
          Set up today now
        </button>
        <button className="btn quiet" disabled={pending} onClick={() => run(skipToday, "Today is cancelled.")}>
          Skip today
        </button>
      </div>
      {msg && <p className={msg.ok ? "hero-extras" : "err"} style={{ marginTop: 10 }}>{msg.text}</p>}
    </>
  );
}
