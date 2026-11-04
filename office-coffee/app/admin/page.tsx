import { chooseAddress, deactivatePerson, refreshMenu, saveSchedule, setPaused } from "@/app/actions";
import { AdminSignIn, CafeSearch, TodayButtons } from "@/components/Admin";
import { PoweredBySwiggy } from "@/components/PoweredBySwiggy";
import { isAdmin } from "@/lib/auth";
import { getSettings } from "@/lib/db";
import { dayEntries, listPeople } from "@/lib/people";
import { describeChoice } from "@/lib/cart";
import { getRun, openRunDay } from "@/lib/run";
import { approvers } from "@/lib/slack";
import { humanError, read, tokenStatus } from "@/lib/swiggy";
import { dayLabel, istClock } from "@/lib/time";

export const dynamic = "force-dynamic";

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export default async function Admin() {
  if (!(await isAdmin())) {
    return (
      <main className="wrap">
        <header className="masthead">
          <p className="wordmark">Coffee run</p>
          <p className="where">Admin</p>
        </header>
        <AdminSignIn />
      </main>
    );
  }

  const s = await getSettings();
  const today = istClock().day;
  const [tok, run, people] = await Promise.all([tokenStatus(), getRun(today), listPeople()]);

  // Prices live here, not on the order page. Unit prices are menu estimates;
  // Swiggy's cart total (delivery, taxes, offers) is on the Slack review card.
  const { day: orderDay } = await openRunDay(s);
  const entries = orderDay ? await dayEntries(orderDay) : [];
  const going = entries.filter((e) => e.in && e.effective);
  const waiting = entries.filter((e) => !e.in);
  const rupees = (n: number) => `₹${Math.round(n)}`;
  const estTotal = going.reduce((sum, e) => sum + (e.effective?.unitPrice ?? 0), 0);

  let addresses: { id: string; label: string; line: string }[] = [];
  let addressError: string | null = null;
  try {
    const { data } = await read("get_addresses", {});
    addresses = (Array.isArray(data?.addresses) ? (data!.addresses as Record<string, unknown>[]) : []).map((a) => ({
      id: String(a.id),
      label: String(a.addressTag ?? a.addressCategory ?? "Address"),
      line: String(a.addressLine ?? "").replace(/^[^:]+:\s*/, "").slice(0, 90),
    }));
  } catch (err) {
    addressError = humanError(err);
  }

  const health: [string, string, boolean][] = [
    ["Swiggy token", tok?.hoursLeft !== null && tok?.hoursLeft !== undefined ? `${tok.hoursLeft}h left` : "missing", (tok?.hoursLeft ?? 0) > 24],
    ["Slack bot", process.env.SLACK_BOT_TOKEN && process.env.SLACK_SIGNING_SECRET ? "set" : "not set", !!(process.env.SLACK_BOT_TOKEN && process.env.SLACK_SIGNING_SECRET)],
    ["Approvers", approvers().length ? approvers().join(", ") : "none: nobody can say yes", approvers().length > 0],
    ["Channel", s.channelId ?? "not set", !!s.channelId],
    ["Today's run", run ? `${run.status}${run.error ? ` (${run.error})` : ""}` : "not set up yet", !!run && !["failed", "error_schedule", "unknown"].includes(run.status)],
  ];

  return (
    <main className="wrap">
      <header className="masthead">
        <p className="wordmark">Coffee run</p>
        <p className="where">
          Admin, <a href="/">order page</a>
        </p>
      </header>

      <section className="panel">
        <h2>{s.paused ? <span className="paused-flag">Paused</span> : "Running"}</h2>
        <p className="muted" style={{ margin: "0 0 12px" }}>
          {s.paused
            ? "Nothing is posted to Slack and nobody can tap in or order until you start it."
            : "Each run day, Slack gets the reminder and the lock card, and people can tap in."}
        </p>
        <form action={setPaused.bind(null, !s.paused)}>
          <button className={s.paused ? "btn go" : "btn"}>{s.paused ? "Start the coffee run" : "Pause the coffee run"}</button>
        </form>
      </section>

      <section className="panel">
        <h2>Health</h2>
        <dl className="kv">
          {health.map(([k, v, ok]) => (
            <div key={k} style={{ display: "contents" }}>
              <dt>{k}</dt>
              <dd className={ok ? "" : "bad"}>{v}</dd>
            </div>
          ))}
        </dl>
        {!s.paused && <TodayButtons />}
      </section>

      <section className="panel">
        <h2>{orderDay ? `${dayLabel(orderDay)}'s order` : "Next order"}</h2>
        {going.length === 0 ? (
          <p className="muted" style={{ margin: 0 }}>{s.paused ? "Paused, so nobody can tap in yet." : "Nobody has tapped in yet."}</p>
        ) : (
          <>
            <ul className="people">
              {going.map((e) => (
                <li key={e.person.id}>
                  <b>{e.person.name}</b>
                  <span className="muted">{describeChoice(e.effective!)}</span>
                  <span className="price">{rupees(e.effective!.unitPrice)}</span>
                </li>
              ))}
            </ul>
            <p style={{ display: "flex", justifyContent: "space-between", margin: "10px 0 0", fontWeight: 600 }}>
              <span>Drinks, before delivery and taxes</span>
              <span className="price">about {rupees(estTotal)}</span>
            </p>
          </>
        )}
        {waiting.length > 0 && <p className="muted" style={{ margin: "10px 0 0", fontSize: 14 }}>Not in yet: {waiting.map((e) => e.person.name).join(", ")}</p>}
      </section>

      <section className="panel">
        <h2>Deliver to</h2>
        {addressError ? (
          <p className="err">{addressError}</p>
        ) : (
          <form action={chooseAddress}>
            <select name="address" className="input" defaultValue={s.addressId ? `${s.addressId}::${s.addressLabel ?? ""}` : ""}>
              <option value="" disabled>
                Pick the office address
              </option>
              {addresses.map((a) => (
                <option key={a.id} value={`${a.id}::${a.label}`}>
                  {a.label}: {a.line}
                </option>
              ))}
            </select>
            <div className="actions" style={{ marginTop: 10 }}>
              <button className="btn">Save address</button>
            </div>
          </form>
        )}
      </section>

      <section className="panel">
        <h2>Café</h2>
        <p style={{ margin: "0 0 4px", fontWeight: 600 }}>{s.restaurantName ?? "None picked"}</p>
        <form action={refreshMenu}>
          <button className="btn plain" style={{ paddingLeft: 0 }}>Reload the menu from Swiggy</button>
        </form>
        <CafeSearch hasAddress={!!s.addressId} />
      </section>

      <section className="panel">
        <h2>Schedule</h2>
        <form action={saveSchedule}>
          <div className="field">
            <label htmlFor="orderTime">Order time (IST)</label>
            <input id="orderTime" name="orderTime" className="input" type="time" defaultValue={s.orderTime} required />
          </div>
          <div className="field">
            <label htmlFor="lead">Reminder, minutes before</label>
            <input id="lead" name="lead" className="input" type="number" min={0} max={60} defaultValue={s.reminderLeadMin} />
          </div>
          <div className="field">
            <label>Days</label>
            <div className="days">
              {DAYS.map((d, i) => (
                <label key={d}>
                  <input type="checkbox" name="days" value={i} defaultChecked={s.days.includes(i)} /> {d}
                </label>
              ))}
            </div>
          </div>
          <div className="field">
            <label htmlFor="payment">Pay with</label>
            <select id="payment" name="payment" className="input" defaultValue={s.payment}>
              <option value="SwiggyPay">Swiggy Money (instant, no UPI tap)</option>
              <option value="Cash">Cash on delivery</option>
            </select>
          </div>
          <div className="field">
            <label htmlFor="channel">Slack channel ID</label>
            <input id="channel" name="channel" className="input" placeholder="C0123456789" defaultValue={s.channelId ?? ""} />
          </div>
          <div className="actions" style={{ marginTop: 14 }}>
            <button className="btn go">Save schedule</button>
          </div>
        </form>
      </section>

      <section className="panel">
        <h2>People ({people.length})</h2>
        <ul className="people">
          {people.map((p) => (
            <li key={p.id}>
              <b>{p.name}</b>
              <span className="muted">{p.regular?.name ?? "no usual yet"}</span>
              <form action={deactivatePerson}>
                <input type="hidden" name="personId" value={p.id} />
                <button className="btn plain">Remove</button>
              </form>
            </li>
          ))}
        </ul>
      </section>
      <PoweredBySwiggy />
    </main>
  );
}
