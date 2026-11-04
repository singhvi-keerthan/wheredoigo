import { signOut } from "@/app/actions";
import { Order } from "@/components/Order";
import { PoweredBySwiggy } from "@/components/PoweredBySwiggy";
import { SignIn } from "@/components/SignIn";
import { currentPersonId } from "@/lib/auth";
import { getSettings } from "@/lib/db";
import { getMenu } from "@/lib/menu";
import { dayEntries, getPerson, listPeople } from "@/lib/people";
import { getRun } from "@/lib/run";
import { humanError } from "@/lib/swiggy";
import { dayLabel, formatHm, nextRunDay, parseHm } from "@/lib/time";
import type { Menu } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function Home() {
  const personId = await currentPersonId();
  const person = personId ? await getPerson(personId) : null;
  const s = await getSettings();

  if (!person) {
    const people = await listPeople();
    return (
      <main className="wrap">
        <header className="top">
          <div className="brand">
            Coffee <em>run</em>
          </div>
        </header>
        <SignIn people={people.map((p) => ({ id: p.id, name: p.name }))} />
        <PoweredBySwiggy />
      </main>
    );
  }

  const orderMin = parseHm(s.orderTime);
  const day = nextRunDay(s.days, orderMin);
  let menu: Menu | null = null;
  let menuError: string | null = null;
  try {
    menu = await getMenu(s);
  } catch (err) {
    menuError = humanError(err);
  }
  const entries = day ? await dayEntries(day) : [];
  const run = day ? await getRun(day) : null;
  const locked = !!run && ["reviewing", "reviewed", "placing", "placed", "unknown"].includes(run.status);
  const mine = entries.find((e) => e.person.id === person.id) ?? null;

  return (
    <main className="wrap">
      <header className="top">
        <div className="brand">
          Coffee <em>run</em>
        </div>
        <div className="meta">
          {s.restaurantName ?? "No café picked yet"}
          <br />
          {day ? `${dayLabel(day)} · locks ${formatHm(orderMin)}` : "No run days set"}
          <br />
          <form action={signOut}>
            <button className="link" type="submit">
              Not {person.name.split(" ")[0]}?
            </button>
          </form>
        </div>
      </header>

      {menuError && <div className="banner bad">Couldn&apos;t load the menu: {menuError}</div>}
      {!s.restaurantId && <div className="banner">No café is set up yet. The admin picks one on /admin.</div>}

      <Order
        day={day}
        dayName={day ? dayLabel(day) : null}
        locked={locked}
        menu={menu}
        me={{
          id: person.id,
          regular: person.regular,
          override: mine?.override ?? null,
          skip: mine?.skip ?? false,
        }}
        everyone={entries.map((e) => ({
          id: e.person.id,
          name: e.person.name,
          effective: e.effective,
          changed: !!e.override,
          skip: e.skip,
        }))}
      />
      <PoweredBySwiggy />
    </main>
  );
}
