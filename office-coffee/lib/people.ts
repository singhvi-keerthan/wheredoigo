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
  override: Choice | null;
  skip: boolean;
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

export async function setDay(personId: number, day: string, value: { choice: Choice } | { skip: true } | { clear: true }): Promise<void> {
  await ensureSchema();
  if ("clear" in value) {
    await sql()`delete from coffee_day_choice where day = ${day} and person_id = ${personId}`;
    return;
  }
  const choice = "choice" in value ? JSON.stringify(value.choice) : null;
  const skip = "skip" in value;
  await sql()`insert into coffee_day_choice (day, person_id, choice, skip) values (${day}, ${personId}, ${choice}::jsonb, ${skip})
    on conflict (day, person_id) do update set choice = excluded.choice, skip = excluded.skip, updated_at = now()`;
}

// Only if the person has no row for that day yet; null regular → skip.
export async function pinDayIfUnset(personId: number, day: string, choice: Choice | null): Promise<void> {
  await ensureSchema();
  await sql()`insert into coffee_day_choice (day, person_id, choice, skip)
    values (${day}, ${personId}, ${choice ? JSON.stringify(choice) : null}::jsonb, ${choice === null})
    on conflict (day, person_id) do nothing`;
}

export async function dayEntries(day: string): Promise<DayEntry[]> {
  await ensureSchema();
  const rows = (await sql()`select p.id, p.name, p.regular, d.choice, coalesce(d.skip, false) as skip
    from coffee_people p
    left join coffee_day_choice d on d.person_id = p.id and d.day = ${day}
    where p.active order by lower(p.name)`) as {
    id: number;
    name: string;
    regular: Choice | null;
    choice: Choice | null;
    skip: boolean;
  }[];
  return rows.map((r) => ({
    person: { id: r.id, name: r.name, regular: r.regular },
    override: r.choice,
    skip: r.skip,
    effective: r.skip ? null : r.choice ?? r.regular,
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
