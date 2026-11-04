"use client";

import { useActionState, useState } from "react";
import { signIn } from "@/app/actions";

export function SignIn({ people }: { people: { id: number; name: string }[] }) {
  const [state, action, pending] = useActionState(signIn, undefined);
  const [who, setWho] = useState<string>(people.length ? "" : "new");

  return (
    <form action={action} className="card">
      <p className="eyebrow">Join the coffee run</p>
      <h1 className="hero-name">Who&apos;s drinking?</h1>
      <p className="hero-extras">Tap in on the days you want coffee. Your usual is pre-picked, so it's one tap.</p>

      <div className="field">
        <label htmlFor="code">Office code</label>
        <input id="code" name="code" className="input" type="password" autoComplete="current-password" required />
      </div>

      {people.length > 0 && (
        <div className="field">
          <label htmlFor="personId">Your name</label>
          <select id="personId" name="personId" className="input" value={who} onChange={(e) => setWho(e.target.value)} required>
            <option value="" disabled>
              Pick your name
            </option>
            {people.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
            <option value="new">I&apos;m new here</option>
          </select>
        </div>
      )}

      {who === "new" && (
        <div className="field">
          <label htmlFor="name">Your name</label>
          <input id="name" name="name" className="input" autoComplete="name" minLength={2} maxLength={40} required />
        </div>
      )}

      {state?.error && <p className="err" style={{ marginTop: 12 }}>{state.error}</p>}
      <div className="row">
        <button className="btn primary block" disabled={pending}>
          {pending ? "Signing in…" : "Continue"}
        </button>
      </div>
    </form>
  );
}
