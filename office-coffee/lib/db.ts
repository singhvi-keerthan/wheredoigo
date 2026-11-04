// Storage: the same Neon database the wheredoigo app uses for sync
// (SYNC_DATABASE_URL), because the Swiggy token lives there and that app's
// Reconnect flow keeps it renewed. This app READS `swiggy_credentials` and
// never writes it; everything it owns is prefixed `coffee_`.

import { neon, type NeonQueryFunction } from "@neondatabase/serverless";
import type { Settings } from "./types";

let client: NeonQueryFunction<false, false> | null = null;

export function sql(): NeonQueryFunction<false, false> {
  if (!client) {
    const url = process.env.SYNC_DATABASE_URL;
    if (!url) throw new Error("SYNC_DATABASE_URL is not set");
    client = neon(url);
  }
  return client;
}

let ready: Promise<void> | null = null;

export function ensureSchema(): Promise<void> {
  if (!ready) {
    ready = (async () => {
      const q = sql();
      await q`create table if not exists coffee_settings (
        id int primary key check (id = 1),
        address_id text, address_label text,
        restaurant_id text, restaurant_name text,
        order_time text not null default '11:30',
        reminder_lead_min int not null default 10,
        days int[] not null default '{1,2,3,4,5}',
        payment text not null default 'SwiggyPay',
        channel_id text,
        updated_at timestamptz not null default now())`;
      await q`insert into coffee_settings (id) values (1) on conflict (id) do nothing`;
      await q`create table if not exists coffee_people (
        id serial primary key,
        name text not null unique,
        regular jsonb,
        active boolean not null default true,
        created_at timestamptz not null default now())`;
      await q`create table if not exists coffee_day_choice (
        day date not null,
        person_id int not null references coffee_people(id) on delete cascade,
        choice jsonb,
        skip boolean not null default false,
        updated_at timestamptz not null default now(),
        primary key (day, person_id))`;
      await q`create table if not exists coffee_runs (
        day date primary key,
        status text not null,
        channel_id text,
        scheduled_ids jsonb not null default '[]',
        message_ts text,
        picks jsonb,
        picks_hash text,
        cart jsonb,
        order_result jsonb,
        error text,
        updated_at timestamptz not null default now())`;
      await q`alter table coffee_runs add column if not exists order_min int`;
      await q`alter table coffee_day_choice add column if not exists confirmed boolean not null default false`;
      // Paused = no Slack messages, no tap-ins, no orders until an admin resumes.
      await q`alter table coffee_settings add column if not exists paused boolean not null default false`;
      await q`create table if not exists coffee_cache (
        key text primary key,
        data jsonb not null,
        fetched_at timestamptz not null default now())`;
      await q`create table if not exists coffee_meter (
        id int primary key check (id = 1),
        window_start timestamptz not null,
        count int not null)`;
    })().catch((err) => {
      ready = null;
      throw err;
    });
  }
  return ready;
}

interface SettingsRow {
  address_id: string | null;
  address_label: string | null;
  restaurant_id: string | null;
  restaurant_name: string | null;
  order_time: string;
  reminder_lead_min: number;
  days: number[];
  payment: string;
  channel_id: string | null;
  paused: boolean;
}

export async function getSettings(): Promise<Settings> {
  await ensureSchema();
  const [r] = (await sql()`select * from coffee_settings where id = 1`) as SettingsRow[];
  return {
    addressId: r.address_id,
    addressLabel: r.address_label,
    restaurantId: r.restaurant_id,
    restaurantName: r.restaurant_name,
    orderTime: r.order_time,
    reminderLeadMin: r.reminder_lead_min,
    days: r.days,
    payment: r.payment === "Cash" ? "Cash" : "SwiggyPay",
    channelId: r.channel_id ?? process.env.SLACK_CHANNEL_ID ?? null,
    // DEV_IGNORE_PAUSE lets a local dev server show the running UI against
    // the shared DB without un-pausing production. Never set it on Vercel.
    paused: r.paused && !(process.env.NODE_ENV !== "production" && process.env.DEV_IGNORE_PAUSE === "1"),
  };
}

export async function cacheGet<T>(key: string, maxAgeMin: number): Promise<T | null> {
  await ensureSchema();
  const rows = (await sql()`select data from coffee_cache
    where key = ${key} and fetched_at > now() - make_interval(mins => ${maxAgeMin})`) as { data: T }[];
  return rows[0]?.data ?? null;
}

export async function cachePut(key: string, data: unknown): Promise<void> {
  await ensureSchema();
  await sql()`insert into coffee_cache (key, data) values (${key}, ${JSON.stringify(data)}::jsonb)
    on conflict (key) do update set data = excluded.data, fetched_at = now()`;
}

export async function cacheDropPrefix(prefix: string): Promise<void> {
  await ensureSchema();
  await sql()`delete from coffee_cache where key like ${prefix + "%"}`;
}
