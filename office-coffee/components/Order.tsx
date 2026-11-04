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
// "Brewed Coffee · Hot Coffee" → "Hot Coffee": the full name only matters to
// the drinks filter, the short one reads better.
const shortCat = (t: string) => t.split(" · ").pop() ?? t;
const extrasOf = (c: Choice) => [...c.variants, ...c.addons].map((s) => s.name).join(", ");

export function Order(props: {
  day: string | null;
  dayName: string | null;
  lockLabel: string | null;
  locked: boolean;
  paused: boolean;
  menu: Menu | null;
  photos: Record<string, string>;
  me: Me;
  everyone: Someone[];
}) {
  const { day, dayName, lockLabel, locked, paused, menu, photos, me, everyone } = props;
  const [sheet, setSheet] = useState<{ scope: Scope } | null>(null);
  const [item, setItem] = useState<{ scope: Scope; item: MenuItem } | null>(null);
  const [flash, setFlash] = useState<{ ok: boolean; text: string } | null>(null);
  const [stamped, setStamped] = useState(false); // stamp lands only on the tap, not on every visit
  const [imgReady, setImgReady] = useState(false);
  const [pending, start] = useTransition();

  // While paused there's no day to order for, so the ticket shows the usual.
  const drink = paused ? me.regular : me.override ?? me.regular;
  const when = dayName?.toLowerCase() ?? "the next run";
  const canEditToday = !paused && !!day && !locked && !!menu;
  const photo = drink ? photos[drink.itemId] : undefined;

  const act = (fn: () => Promise<{ ok: boolean; error?: string }>, okText: string | null, stamp = false) =>
    start(async () => {
      const r = await fn();
      if (r.ok && stamp) setStamped(true);
      if (!r.ok) setFlash({ ok: false, text: r.error ?? "That didn't save. Try again." });
      else setFlash(okText ? { ok: true, text: okText } : null);
    });

  const inList = everyone.filter((e) => e.in && e.effective);
  const notIn = everyone.filter((e) => !e.in);
  const estTotal = inList.reduce((s, e) => s + (e.effective?.unitPrice ?? 0), 0);

  return (
    <>
      {flash && <p className={`flash ${flash.ok ? "" : "bad"}`} role="status">{flash.text}</p>}

      <section className="ticket" aria-live="polite">
        {me.in && drink && !paused && <div className={`stamp ${stamped ? "fresh" : ""}`} aria-hidden>IN</div>}

        <p className="ticket-day">
          {paused ? (
            "The coffee run hasn't started yet"
          ) : locked ? (
            <>
              <b>{dayName}</b>, with the approver now
            </>
          ) : (
            <>
              <b>{dayName}</b>, order locks at {lockLabel}
            </>
          )}
        </p>

        {drink ? (
          <div className={`drink ${photo ? "" : "no-photo"}`}>
            {photo && (
              <img
                src={photo}
                alt=""
                className={imgReady ? "ready" : ""}
                onLoad={() => setImgReady(true)}
                // A server-rendered image can finish before React attaches onLoad.
                ref={(el) => {
                  if (el?.complete && el.naturalWidth > 0 && !imgReady) setImgReady(true);
                }}
              />
            )}
            <div>
              <h1 className="drink-name">{drink.name}</h1>
              <p className="drink-extras">
                {extrasOf(drink) || "As it comes"}
                {drink.note ? `, “${drink.note}”` : ""}
                {", "}
                <span className="price">{rupees(drink.unitPrice)}</span>
              </p>
            </div>
          </div>
        ) : (
          <>
            <h1 className="ask">What do you drink?</h1>
            <p className="ask-sub">
              {paused ? "Pick your usual now. Tapping in opens when the coffee run starts." : "Pick a usual once. After that, getting coffee is one tap."}
            </p>
          </>
        )}

        {!paused && drink && !me.in && !locked && (
          <p className="ask-sub">You&apos;re not on {when}&apos;s order until you tap in.</p>
        )}
        {paused && drink && <p className="ask-sub">That&apos;s your usual. Tapping in opens when the coffee run starts.</p>}

        <div className="perf" aria-hidden />

        <div className="actions">
          {canEditToday && !me.in && drink && (
            <button className="btn go" disabled={pending} onClick={() => act(() => setToday("in", day), null, true)}>
              Tap in for {when}
            </button>
          )}
          {canEditToday && !drink && (
            <button className="btn go" onClick={() => setSheet({ scope: "today" })}>
              Pick a drink and tap in
            </button>
          )}
          {(paused || !canEditToday) && !drink && menu && (
            <button className="btn go" onClick={() => setSheet({ scope: "regular" })}>
              Pick my usual
            </button>
          )}
          {canEditToday && drink && (
            <button className="btn" onClick={() => setSheet({ scope: "today" })}>
              {me.in ? "Change drink" : "Something else"}
            </button>
          )}
          {canEditToday && me.in && me.override && me.regular && (
            <button className="btn" disabled={pending} onClick={() => act(() => setToday("regular", day), `Back to your usual for ${when}.`)}>
              Back to my usual
            </button>
          )}
          {canEditToday && me.in && (
            <button className="btn plain" disabled={pending} onClick={() => { setStamped(false); act(() => setToday("out", day), `You're off ${when}'s order.`); }}>
              I&apos;m out {when}
            </button>
          )}
          {(paused || !canEditToday) && drink && menu && (
            <button className="btn" onClick={() => setSheet({ scope: "regular" })}>
              Change my usual
            </button>
          )}
        </div>
      </section>

      {me.regular && canEditToday && (
        <p className="note">
          Your usual is <b>{me.regular.name}</b>
          {extrasOf(me.regular) ? ` (${extrasOf(me.regular)})` : ""}.
          <button className="btn plain" onClick={() => setSheet({ scope: "regular" })}>
            Change it
          </button>
        </p>
      )}

      {day && !paused && (
        <section className="docket" aria-label={`Going in ${when}`}>
          <h2>
            Going in {when} <span>{inList.length}</span>
          </h2>
          {inList.length === 0 ? (
            <p className="empty">Nobody has tapped in yet.</p>
          ) : (
            <>
              <ul>
                {inList.map((e) => (
                  <li key={e.id} className={e.id === me.id ? "me" : ""}>
                    <span className="who">{e.name}</span>
                    <span className="what">{e.effective!.name}</span>
                    <span className="price">{rupees(e.effective!.unitPrice)}</span>
                  </li>
                ))}
              </ul>
              <div className="sum">
                <span>Before delivery and taxes</span>
                <span className="price">about {rupees(estTotal)}</span>
              </div>
            </>
          )}
          {notIn.length > 0 && <p className="waiting">Not in yet: {notIn.map((e) => e.name).join(", ")}</p>}
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
                {shortCat(c.title)}
              </button>
            ))}
          </div>
        </div>
        <div className="sheet-body">
          {shown.length === 0 && <p className="muted" style={{ marginTop: 16 }}>Nothing on the menu matches “{q}”.</p>}
          {shown.map((c) => (
            <div key={c.title}>
              <p className="cat">{shortCat(c.title)}</p>
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
      if (r.ok) onSaved(target === "regular" ? `${item.name} is your usual now. You still tap in each day.` : `You're in for ${when}: ${item.name}.`);
      else setError(r.error);
    });

  return (
    <>
      <div className="scrim" onClick={onBack} />
      <div className="sheet" role="dialog" aria-modal="true" aria-label={item.name}>
        <div className="sheet-head">
          <div className="sheet-title">
            <button className="back" onClick={onBack}>
              Back to the menu
            </button>
            <button className="x" onClick={onBack} aria-label="Close">
              ×
            </button>
          </div>
          <h2 className="drink-name" style={{ marginTop: 12 }}>{item.name}</h2>
          {item.description && <p className="lede">{item.description}</p>}
        </div>
        <div className="sheet-body">
          {loading && <p className="muted" style={{ marginTop: 16 }}>Loading options…</p>}
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
              <textarea className="notefield" rows={2} maxLength={80} placeholder="Less sugar, extra hot…" value={note} onChange={(e) => setNote(e.target.value)} />
            </div>
          )}
        </div>
        <div className="sheet-foot">
          {error && <p className="err">{error}</p>}
          {details && !details.unavailable && (
            <>
              {scope === "today" && canToday && (
                <button className="btn go" disabled={pending} onClick={() => save("today")}>
                  {pending ? "Saving…" : `Tap in with this, ${rupees(price)}`}
                </button>
              )}
              <button className={scope === "regular" ? "btn go" : "btn"} disabled={pending} onClick={() => save("regular")}>
                {scope === "regular" ? (pending ? "Saving…" : `Make it my usual, ${rupees(price)}`) : "Make it my usual instead"}
              </button>
            </>
          )}
        </div>
      </div>
    </>
  );
}

