"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { saveChoice, setToday } from "@/app/actions";
import type { Choice, ItemDetails, Menu, MenuItem } from "@/lib/types";

type Scope = "today" | "regular";

interface Me {
  id: number;
  regular: Choice | null;
  override: Choice | null;
  in: boolean;
}

interface Someone {
  id: number;
  name: string;
  effective: Choice | null;
  changed: boolean;
  in: boolean;
}

const rupees = (n: number) => `₹${Math.round(n)}`;
const extrasOf = (c: Choice) => [...c.variants, ...c.addons].map((s) => s.name).join(" · ");

export function Order(props: { day: string | null; dayName: string | null; lockLabel: string | null; locked: boolean; menu: Menu | null; me: Me; everyone: Someone[] }) {
  const { day, dayName, lockLabel, locked, menu, me, everyone } = props;
  const [sheet, setSheet] = useState<{ scope: Scope } | null>(null);
  const [item, setItem] = useState<{ scope: Scope; item: MenuItem } | null>(null);
  const [flash, setFlash] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();

  // What they'd get if they're in: today's change, else their usual.
  const drink = me.override ?? me.regular;
  const when = dayName?.toLowerCase() ?? "the next run";
  const canEditToday = !!day && !locked && !!menu;

  const act = (fn: () => Promise<{ ok: boolean; error?: string }>, okText: string) =>
    start(async () => {
      const r = await fn();
      setFlash(r.ok ? { ok: true, text: okText } : { ok: false, text: r.error ?? "Didn't work" });
    });

  const inList = everyone.filter((e) => e.in && e.effective);
  const notIn = everyone.filter((e) => !e.in);
  const estTotal = inList.reduce((s, e) => s + (e.effective?.unitPrice ?? 0), 0);

  return (
    <>
      {flash && <div className={`banner ${flash.ok ? "ok" : "bad"}`}>{flash.text}</div>}
      {locked && <div className="banner">{dayName}&apos;s order is with the approver now. Changes count for the next run.</div>}

      <section className={`card ${me.in ? "is-in" : ""}`} aria-live="polite">
        <p className="eyebrow">{dayName ? `${dayName}'s coffee` : "Your coffee"}</p>
        {me.in && drink ? (
          <>
            <span className="chip in">✓ You&apos;re in</span>
            <h1 className="hero-name">{drink.name}</h1>
            <p className="hero-extras">
              {extrasOf(drink) || "As it comes"}
              {drink.note ? ` · “${drink.note}”` : ""} · <span className="price">{rupees(drink.unitPrice)}</span>
              {me.override ? ` · changed for ${when}` : ""}
            </p>
          </>
        ) : (
          <>
            <span className="chip">Not in yet</span>
            <h1 className="hero-name">Coffee {when}?</h1>
            <p className="hero-extras">
              You&apos;re only on the order if you tap in{lockLabel ? ` before ${lockLabel}` : ""}.
              {drink ? (
                <>
                  {" "}
                  {me.override ? "Your pick" : "Your usual"}: <b>{drink.name}</b>
                  {extrasOf(drink) ? ` (${extrasOf(drink)})` : ""}.
                </>
              ) : null}
            </p>
          </>
        )}

        {canEditToday && (
          <div className="row">
            {!me.in && drink && (
              <button className="btn accent block" disabled={pending} onClick={() => act(() => setToday("in", day), `You're in for ${when}: ${drink.name}.`)}>
                I&apos;m in · {drink.name}
              </button>
            )}
            {!me.in && !drink && (
              <button className="btn accent block" onClick={() => setSheet({ scope: "today" })}>
                Pick a drink and I&apos;m in
              </button>
            )}
            {drink && (
              <button className="btn" onClick={() => setSheet({ scope: "today" })}>
                {me.in ? "Change drink" : "Something else"}
              </button>
            )}
            {me.in && me.override && me.regular && (
              <button className="btn" disabled={pending} onClick={() => act(() => setToday("regular", day), `Back to your usual for ${when}.`)}>
                Back to my usual
              </button>
            )}
            {me.in && (
              <button className="btn quiet" disabled={pending} onClick={() => act(() => setToday("out", day), `You're out for ${when}.`)}>
                I&apos;m out {when}
              </button>
            )}
          </div>
        )}
      </section>

      <section className="card regular">
        <div>
          <p className="eyebrow" style={{ margin: 0 }}>Your usual</p>
          {me.regular ? (
            <>
              <div className="name">{me.regular.name}</div>
              <div className="sub">{extrasOf(me.regular) || "As it comes"} · pre-picked each day, you still tap in</div>
            </>
          ) : (
            <div className="sub">Set one so tapping in is one tap.</div>
          )}
        </div>
        {menu && (
          <button className="btn" onClick={() => setSheet({ scope: "regular" })}>
            {me.regular ? "Edit" : "Set"}
          </button>
        )}
      </section>

      {day && (
        <section className="section">
          <p className="eyebrow">
            In {when} · {inList.length}
          </p>
          <div className="card">
            {inList.length === 0 ? (
              <p className="hero-extras">Nobody&apos;s in yet.</p>
            ) : (
              <ul className="receipt">
                {inList.map((e) => (
                  <li key={e.id} className={e.id === me.id ? "me" : ""}>
                    <span className="who">{e.name}</span>
                    <span className="what">{e.effective!.name + (e.changed ? " (changed)" : "")}</span>
                    <span className="price">{rupees(e.effective!.unitPrice)}</span>
                  </li>
                ))}
              </ul>
            )}
            {inList.length > 0 && (
              <div className="total">
                <span>Before delivery &amp; taxes</span>
                <span className="price">~{rupees(estTotal)}</span>
              </div>
            )}
            {notIn.length > 0 && <p className="not-in">Not in yet: {notIn.map((e) => e.name).join(", ")}</p>}
          </div>
        </section>
      )}

      {sheet && menu && !item && (
        <MenuSheet
          menu={menu}
          title={sheet.scope === "regular" ? "Your usual" : `For ${when}`}
          onClose={() => setSheet(null)}
          onPick={(it) => setItem({ scope: sheet.scope, item: it })}
        />
      )}
      {item && (
        <ItemSheet
          item={item.item}
          scope={item.scope}
          when={when}
          canToday={canEditToday}
          current={(item.scope === "regular" ? me.regular : drink) ?? null}
          day={day}
          onBack={() => setItem(null)}
          onSaved={(text) => {
            setItem(null);
            setSheet(null);
            setFlash({ ok: true, text });
          }}
        />
      )}
    </>
  );
}

function MenuSheet({ menu, title, onClose, onPick }: { menu: Menu; title: string; onClose: () => void; onPick: (i: MenuItem) => void }) {
  const [q, setQ] = useState("");
  const [cat, setCat] = useState<string | null>(null);
  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return menu.categories
      .filter((c) => !cat || c.title === cat)
      .map((c) => ({ ...c, items: c.items.filter((i) => !needle || i.name.toLowerCase().includes(needle)) }))
      .filter((c) => c.items.length);
  }, [menu, q, cat]);

  return (
    <>
      <div className="scrim" onClick={onClose} />
      <div className="sheet" role="dialog" aria-modal="true" aria-label={title}>
        <div className="sheet-head">
          <div className="sheet-title">
            <h2>{title}</h2>
            <button className="x" onClick={onClose} aria-label="Close">
              ×
            </button>
          </div>
          <input className="search" placeholder={`Search ${menu.restaurantName}`} value={q} onChange={(e) => setQ(e.target.value)} />
          <div className="chips">
            <button className={!cat ? "on" : ""} onClick={() => setCat(null)}>
              All
            </button>
            {menu.categories.map((c) => (
              <button key={c.title} className={cat === c.title ? "on" : ""} onClick={() => setCat(c.title)}>
                {c.title}
              </button>
            ))}
          </div>
        </div>
        <div className="sheet-body">
          {shown.length === 0 && <p className="hero-extras" style={{ marginTop: 16 }}>Nothing matches “{q}”.</p>}
          {shown.map((c) => (
            <div key={c.title}>
              <p className="cat">{c.title}</p>
              {c.items.map((i) => (
                <button key={`${c.title}-${i.id}`} className="item" disabled={!i.inStock} onClick={() => onPick(i)}>
                  {i.imageUrl ? <img src={i.imageUrl} alt="" loading="lazy" /> : <span className="ph" />}
                  <span className="t">
                    <span className="n">
                      <span className={`veg ${i.isVeg ? "" : "non"}`} aria-label={i.isVeg ? "Veg" : "Non-veg"} />
                      {i.name}
                    </span>
                    <span className="d">{i.inStock ? i.description ?? (i.hasVariants || i.hasAddons ? "Customisable" : "") : "Out of stock"}</span>
                  </span>
                  <span className="price">{rupees(i.price)}</span>
                </button>
              ))}
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

function ItemSheet(props: {
  item: MenuItem;
  scope: Scope;
  when: string;
  canToday: boolean;
  current: Choice | null;
  day: string | null;
  onBack: () => void;
  onSaved: (text: string) => void;
}) {
  const { item, scope, when, canToday, current, day, onBack, onSaved } = props;
  const [details, setDetails] = useState<ItemDetails | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [variants, setVariants] = useState<Record<string, string>>({});
  const [addons, setAddons] = useState<Record<string, string[]>>({});
  const [note, setNote] = useState(current?.itemId === item.id ? current.note ?? "" : "");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let live = true;
    fetch(`/api/item?id=${encodeURIComponent(item.id)}`)
      .then(async (r) => {
        const d = await r.json();
        if (!r.ok) throw new Error(d.error ?? "Couldn't load options");
        if (!live) return;
        const det = d as ItemDetails;
        const same = current?.itemId === item.id ? current : null;
        const v: Record<string, string> = {};
        for (const g of det.variantGroups) {
          const fallback = g.options.find((o) => o.isDefault && o.inStock) ?? g.options.find((o) => o.inStock) ?? g.options[0];
          v[g.id] = same?.variants.find((x) => x.groupId === g.id)?.optionId ?? fallback.id;
        }
        const a: Record<string, string[]> = {};
        for (const g of det.addonGroups) {
          const prior = same?.addons.filter((x) => x.groupId === g.id).map((x) => x.optionId);
          const free = g.options.find((o) => o.price === 0 && o.inStock);
          a[g.id] = prior?.length ? prior : g.min > 0 && free ? [free.id] : [];
        }
        setVariants(v);
        setAddons(a);
        setDetails(det);
      })
      .catch((e: Error) => live && setLoadError(e.message))
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
    // Load once per item; `current` only seeds the first selection.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item.id]);

  const price = details
    ? details.basePrice +
      details.variantGroups.reduce((s, g) => s + (g.options.find((o) => o.id === variants[g.id])?.price ?? 0), 0) +
      details.addonGroups.reduce((s, g) => s + (addons[g.id] ?? []).reduce((t, id) => t + (g.options.find((o) => o.id === id)?.price ?? 0), 0), 0)
    : item.price;

  const toggleAddon = (gid: string, oid: string, max: number) =>
    setAddons((prev) => {
      const cur = prev[gid] ?? [];
      if (cur.includes(oid)) return { ...prev, [gid]: cur.filter((x) => x !== oid) };
      if (max === 1) return { ...prev, [gid]: [oid] };
      if (max >= 0 && cur.length >= max) return prev;
      return { ...prev, [gid]: [...cur, oid] };
    });

  const save = (target: Scope) =>
    start(async () => {
      setError(null);
      const r = await saveChoice(target, { itemId: item.id, variants, addons, note }, day);
      if (r.ok) onSaved(target === "regular" ? `${item.name} is your usual now. You still tap in each day.` : `${item.name} for ${when}. You're in.`);
      else setError(r.error);
    });

  return (
    <>
      <div className="scrim" onClick={onBack} />
      <div className="sheet" role="dialog" aria-modal="true" aria-label={item.name}>
        <div className="sheet-head">
          <div className="sheet-title">
            <button className="link" onClick={onBack}>
              ← Menu
            </button>
            <button className="x" onClick={onBack} aria-label="Close">
              ×
            </button>
          </div>
          <h2 className="hero-name" style={{ fontSize: 28, marginTop: 10 }}>
            {item.name}
          </h2>
          {item.description && <p className="hero-extras">{item.description}</p>}
        </div>
        <div className="sheet-body">
          {loading && <p className="hero-extras" style={{ marginTop: 16 }}>Loading options…</p>}
          {loadError && <p className="err" style={{ marginTop: 16 }}>{loadError}</p>}
          {details?.unavailable && <p className="err" style={{ marginTop: 16 }}>{details.unavailable}</p>}
          {details?.variantGroups.map((g) => (
            <div className="group" key={g.id}>
              <h3>
                {g.label} <small>pick one</small>
              </h3>
              <div className="opts">
                {g.options.map((o) => (
                  <button key={o.id} className={`opt ${variants[g.id] === o.id ? "on" : ""}`} disabled={!o.inStock} onClick={() => setVariants((p) => ({ ...p, [g.id]: o.id }))}>
                    {o.name}
                    {o.price > 0 && <small>+{rupees(o.price)}</small>}
                  </button>
                ))}
              </div>
            </div>
          ))}
          {details?.addonGroups.map((g) => (
            <div className="group" key={g.id}>
              <h3>
                {g.label}
                <small>{g.min > 0 ? (g.max === 1 ? "pick one" : `pick ${g.min}+`) : g.max === 1 ? "optional, one" : "optional"}</small>
              </h3>
              <div className="opts">
                {g.options.map((o) => (
                  <button key={o.id} className={`opt ${(addons[g.id] ?? []).includes(o.id) ? "on" : ""}`} disabled={!o.inStock} onClick={() => toggleAddon(g.id, o.id, g.max)}>
                    {o.name}
                    {o.price > 0 && <small>+{rupees(o.price)}</small>}
                  </button>
                ))}
              </div>
            </div>
          ))}
          {details && !details.unavailable && (
            <div className="group">
              <h3>
                Note <small>goes to the café</small>
              </h3>
              <textarea className="note" rows={2} maxLength={80} placeholder="Less sugar, extra hot…" value={note} onChange={(e) => setNote(e.target.value)} />
            </div>
          )}
        </div>
        <div className="sheet-foot">
          {error && <p className="err">{error}</p>}
          {details && !details.unavailable && (
            <>
              {scope === "today" && canToday && (
                <button className="btn accent block" disabled={pending} onClick={() => save("today")}>
                  {pending ? "Saving…" : `I'm in with this · ${rupees(price)}`}
                </button>
              )}
              <button className={`btn block ${scope === "regular" ? "accent" : ""}`} disabled={pending} onClick={() => save("regular")}>
                {scope === "regular" ? (pending ? "Saving…" : `Make it my usual · ${rupees(price)}`) : "Save as my usual instead"}
              </button>
            </>
          )}
        </div>
      </div>
    </>
  );
}

