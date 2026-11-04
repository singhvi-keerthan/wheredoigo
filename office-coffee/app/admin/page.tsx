import { chooseAddress, deactivatePerson, refreshMenu, saveSchedule } from "@/app/actions";
import { AdminSignIn, CafeSearch, TodayButtons } from "@/components/Admin";
import { PoweredBySwiggy } from "@/components/PoweredBySwiggy";
import { isAdmin } from "@/lib/auth";
import { getSettings } from "@/lib/db";
import { listPeople } from "@/lib/people";
import { getRun } from "@/lib/run";
import { approvers } from "@/lib/slack";
import { humanError, read, tokenStatus } from "@/lib/swiggy";
import { istClock } from "@/lib/time";

export const dynamic = "force-dynamic";

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export default async function Admin() {
  if (!(await isAdmin())) {
    return (
      <main className="wrap">
        <header className="top">
          <div className="brand">
            Coffee <em>run</em> · admin
          </div>
        </header>
        <AdminSignIn />
      </main>
    );
  }

  const s = await getSettings();
  const today = istClock().day;
  const [tok, run, people] = await Promise.all([tokenStatus(), getRun(today), listPeople()]);

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
      <header className="top">
        <div className="brand">
          Coffee <em>run</em> · admin
        </div>
        <div className="meta">
          <a href="/">Order page</a>
        </div>
      </header>

      <section className="card">
        <p className="eyebrow">Health</p>
        <dl className="kv">
          {health.map(([k, v, ok]) => (
            <div key={k} style={{ display: "contents" }}>
              <dt>{k}</dt>
              <dd style={{ color: ok ? undefined : "var(--chili)" }}>{v}</dd>
            </div>
          ))}
        </dl>
        <TodayButtons />
      </section>

      <section className="card">
        <p className="eyebrow">Deliver to</p>
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
            <div className="row">
              <button className="btn">Save address</button>
            </div>
          </form>
        )}
      </section>

      <section className="card">
        <p className="eyebrow">Café</p>
        <p style={{ margin: "0 0 4px", fontWeight: 600 }}>{s.restaurantName ?? "None picked"}</p>
        <form action={refreshMenu}>
          <button className="link">Refresh menu from Swiggy</button>
        </form>
        <CafeSearch hasAddress={!!s.addressId} />
      </section>

      <section className="card">
        <p className="eyebrow">Schedule</p>
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
          <div className="row">
            <button className="btn primary">Save schedule</button>
          </div>
        </form>
      </section>

      <section className="card">
        <p className="eyebrow">People · {people.length}</p>
        <ul className="receipt">
          {people.map((p) => (
            <li key={p.id}>
              <span className="who">{p.name}</span>
              <span className="what">{p.regular?.name ?? "no regular"}</span>
              <form action={deactivatePerson}>
                <input type="hidden" name="personId" value={p.id} />
                <button className="link">Remove</button>
              </form>
            </li>
          ))}
        </ul>
      </section>
      <PoweredBySwiggy />
    </main>
  );
}
