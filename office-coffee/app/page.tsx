import { Order } from "@/components/Order";
import { PoweredBySwiggy } from "@/components/PoweredBySwiggy";
import { SignIn } from "@/components/SignIn";
import { currentPersonId } from "@/lib/auth";
import { getSettings } from "@/lib/db";
import { getMenu } from "@/lib/menu";
import { dayEntries, getPerson, listPeople } from "@/lib/people";
import { getRun, todayCutoff } from "@/lib/run";
import { humanError } from "@/lib/swiggy";
import { dayLabel, formatHm, nextRunDay } from "@/lib/time";
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
        <header className="masthead">
          <p className="wordmark">Coffee run</p>
          {s.restaurantName && <p className="where">from <b>{s.restaurantName}</b></p>}
        </header>
        <SignIn people={people.map((p) => ({ id: p.id, name: p.name }))} />
        <PoweredBySwiggy />
      </main>
    );
  }

  const { orderMin } = await todayCutoff(s);
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
  const photos: Record<string, string> = {};
  for (const c of menu?.categories ?? []) for (const i of c.items) if (i.imageUrl) photos[i.id] = i.imageUrl;

  return (
    <main className="wrap">
      <header className="masthead">
        <p className="wordmark">Coffee run</p>
        <p className="where">
          {s.restaurantName ? (
            <>
              from <b>{s.restaurantName}</b>
            </>
          ) : (
            "No café picked yet"
          )}
        </p>
      </header>

      {menuError && <p className="flash bad">The menu didn&apos;t load: {menuError}</p>}
      {!s.restaurantId && <p className="flash">No café is set up yet. The admin picks one at /admin.</p>}

      <Order
        day={day}
        dayName={day ? dayLabel(day) : null}
        lockLabel={formatHm(orderMin)}
        locked={locked}
        paused={s.paused}
        menu={menu}
        photos={photos}
        me={{
          id: person.id,
          regular: person.regular,
          override: mine?.override ?? null,
          in: mine?.in ?? false,
        }}
        everyone={entries.map((e) => ({
          id: e.person.id,
          name: e.person.name,
          effective: e.effective,
          changed: !!e.override,
          in: e.in,
        }))}
      />
      <PoweredBySwiggy />
    </main>
  );
}
