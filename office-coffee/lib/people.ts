// People, their regulars, and per-day changes.

import { ensureSchema, sql } from "./db";
import type { Choice, PersonPick } from "./types";

export interface Person {
  id: number;
  name: string;
  regular: Choice | null;
}

export interface DayEntry {
  person: Person;
  override: Choice | null; // a change for that day (null = regular)
  in: boolean; // opted in for that day
  effective: Choice | null; // what will actually be ordered
}

export async function listPeople(): Promise<Person[]> {
  await ensureSchema();
  return (await sql()`select id, name, regular from coffee_people where active order by lower(name)`) as Person[];
}

export async function getPerson(id: number): Promise<Person | null> {
  await ensureSchema();
  const rows = (await sql()`select id, name, regular from coffee_people where id = ${id} and active`) as Person[];
  return rows[0] ?? null;
}

export async function upsertPerson(name: string): Promise<Person> {
  await ensureSchema();
  const clean = name.trim().replace(/\s+/g, " ").slice(0, 40);
  const [p] = (await sql()`insert into coffee_people (name) values (${clean})
    on conflict (name) do update set active = true
    returning id, name, regular`) as Person[];
  return p;
}

export async function removePerson(id: number): Promise<void> {
  await ensureSchema();
  await sql()`update coffee_people set active = false where id = ${id}`;
}

export async function setRegular(personId: number, choice: Choice | null): Promise<void> {
  await ensureSchema();
  await sql()`update coffee_people set regular = ${choice ? JSON.stringify(choice) : null}::jsonb where id = ${personId}`;
}

// A day row means "I'm in": nobody is ordered for unless they opted in that
// day (people aren't in the office every day). `choice` is an optional
// change for that day; null = their regular.
export type DayAction = { in: true } | { in: true; choice: Choice } | { in: true; useRegular: true } | { choice: Choice } | { out: true };

export async function setDay(personId: number, day: string, action: DayAction): Promise<void> {
  await ensureSchema();
  if ("out" in action) {
    await sql()`delete from coffee_day_choice where day = ${day} and person_id = ${personId}`;
    return;
  }
  if ("choice" in action && !("in" in action)) {
    // A drink picked ahead of the day: saved, but not tapped in.
    await sql()`insert into coffee_day_choice (day, person_id, choice, confirmed) values (${day}, ${personId}, ${JSON.stringify(action.choice)}::jsonb, false)
      on conflict (day, person_id) do update set choice = excluded.choice, updated_at = now()`;
  } else if ("choice" in action) {
    await sql()`insert into coffee_day_choice (day, person_id, choice, confirmed) values (${day}, ${personId}, ${JSON.stringify(action.choice)}::jsonb, true)
      on conflict (day, person_id) do update set choice = excluded.choice, confirmed = true, skip = false, updated_at = now()`;
  } else if ("useRegular" in action) {
    await sql()`insert into coffee_day_choice (day, person_id, choice, confirmed) values (${day}, ${personId}, null, true)
      on conflict (day, person_id) do update set choice = null, confirmed = true, skip = false, updated_at = now()`;
  } else {
    await sql()`insert into coffee_day_choice (day, person_id, choice, confirmed) values (${day}, ${personId}, null, true)
      on conflict (day, person_id) do update set confirmed = true, skip = false, updated_at = now()`;
  }
}

// Someone who's in on their regular changes the regular after cutoff: keep
// today's order as it was by writing the old regular into today's row.
export async function pinRegularIntoDay(personId: number, day: string, oldRegular: Choice | null): Promise<void> {
  await ensureSchema();
  if (!oldRegular) return;
  await sql()`update coffee_day_choice set choice = ${JSON.stringify(oldRegular)}::jsonb, updated_at = now()
    where day = ${day} and person_id = ${personId} and confirmed and choice is null`;
}

export function effectiveOf(row: { regular: Choice | null; choice: Choice | null; confirmed: boolean; skip: boolean }): Choice | null {
  if (!row.confirmed || row.skip) return null;
  return row.choice ?? row.regular;
}

export async function dayEntries(day: string): Promise<DayEntry[]> {
  await ensureSchema();
  const rows = (await sql()`select p.id, p.name, p.regular, d.choice,
      coalesce(d.confirmed, false) as confirmed, coalesce(d.skip, false) as skip
    from coffee_people p
    left join coffee_day_choice d on d.person_id = p.id and d.day = ${day}
    where p.active order by lower(p.name)`) as {
    id: number;
    name: string;
    regular: Choice | null;
    choice: Choice | null;
    confirmed: boolean;
    skip: boolean;
  }[];
  return rows.map((r) => ({
    person: { id: r.id, name: r.name, regular: r.regular },
    override: r.choice,
    in: r.confirmed && !r.skip,
    effective: effectiveOf(r),
  }));
}

// Only picks from the configured restaurant can go in the cart — a regular
// saved before the restaurant was switched would otherwise break it.
export function picksFor(entries: DayEntry[], validItemIds: Set<string>): { picks: PersonPick[]; stale: string[] } {
  const picks: PersonPick[] = [];
  const stale: string[] = [];
  for (const e of entries) {
    if (!e.effective) continue;
    if (!validItemIds.has(e.effective.itemId)) {
      stale.push(e.person.name);
      continue;
    }
    picks.push({ personId: e.person.id, personName: e.person.name, choice: e.effective });
  }
  return { picks, stale };
}
