"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { clearPerson, codeMatches, currentPersonId, isAdmin, setAdmin, setPerson } from "@/lib/auth";
import { validateChoice } from "@/lib/cart";
import { cacheDropPrefix, ensureSchema, getSettings, sql } from "@/lib/db";
import { findItem, getItemDetails, getMenu } from "@/lib/menu";
import { dayEntries as dayEntriesFor, getPerson, pinRegularIntoDay, removePerson, setDay, setRegular, upsertPerson } from "@/lib/people";
import { cancelDay, getRun, rescheduleToday, scheduleDay, todayCutoff } from "@/lib/run";
import { humanError, read } from "@/lib/swiggy";
import { istClock, isRunDay, nextRunDay, parseHm } from "@/lib/time";

export type ActionResult = { ok: true } | { ok: false; error: string };

// ── People ───────────────────────────────────────────────────────────────

export async function signIn(_: unknown, form: FormData): Promise<{ error: string } | undefined> {
  if (!codeMatches(String(form.get("code") ?? ""), "ACCESS_CODE")) return { error: "That office code isn't right." };
  const existing = String(form.get("personId") ?? "");
  const name = String(form.get("name") ?? "").trim();
  let id: number;
  if (existing && existing !== "new") {
    const p = await getPerson(Number(existing));
    if (!p) return { error: "Pick your name again." };
    id = p.id;
  }
  else if (name.length >= 2) id = (await upsertPerson(name)).id;
  else return { error: "Pick your name, or type it if you're new." };
  await setPerson(id);
  redirect("/");
}

export async function signOut(): Promise<void> {
  await clearPerson();
  redirect("/");
}

interface Picked {
  itemId: string;
  variants: Record<string, string>;
  addons: Record<string, string[]>;
  note?: string | null;
}

// The day the page showed must still be the day open for changes. A page
// left open across the cutoff must not silently edit the next run instead.
async function openDay(shown: string | null): Promise<{ day: string } | { error: string }> {
  const s = await getSettings();
  const day = nextRunDay(s.days, (await todayCutoff(s)).orderMin);
  if (!day) return { error: "No run days are set up." };
  if (shown && shown !== day) return { error: "That order just locked. Refresh to change the next one." };
  const run = await getRun(day);
  if (run && ["reviewing", "reviewed", "placing", "placed", "unknown"].includes(run.status)) {
    return { error: "This order is already with the approver. Refresh to change the next one." };
  }
  return { day };
}

// Changing a regular after today's cutoff must not change today's locked
// order: someone who's in on their regular keeps the old one for today.
async function protectLockedToday(personId: number): Promise<void> {
  const s = await getSettings();
  const clock = istClock();
  const { orderMin, active } = await todayCutoff(s);
  if (!isRunDay(s.days, clock.day) && !active) return; // a forced run counts
  if (clock.minutes < orderMin) return;
  const run = await getRun(clock.day);
  if (run && ["placed", "cancelled"].includes(run.status)) return;
  const person = await getPerson(personId);
  await pinRegularIntoDay(personId, clock.day, person?.regular ?? null);
}

export async function saveChoice(scope: "today" | "regular", picked: Picked, shownDay: string | null): Promise<ActionResult> {
  const personId = await currentPersonId();
  if (!personId) return { ok: false, error: "Sign in first." };
  try {
    const s = await getSettings();
    const menu = await getMenu(s);
    const item = menu && findItem(menu, picked.itemId);
    if (!item) return { ok: false, error: "That item isn't on the menu any more." };
    if (!item.inStock) return { ok: false, error: `${item.name} is out of stock right now.` };
    const details = await getItemDetails(s, item);
    const v = validateChoice(details, picked);
    if (!v.ok) return v;
    if (scope === "regular") {
      await protectLockedToday(personId);
      await setRegular(personId, v.choice);
    } else {
      const open = await openDay(shownDay);
      if ("error" in open) return { ok: false, error: open.error };
      await setDay(personId, open.day, { in: true, choice: v.choice });
    }
    revalidatePath("/");
    return { ok: true };
  } catch (err) {
    return { ok: false, error: humanError(err) };
  }
}

// in = "I'm in" (keeps any change already made), out = not today,
// regular = in, but drop today's change and have the regular.
export async function setToday(mode: "in" | "out" | "regular", shownDay: string | null): Promise<ActionResult> {
  try {
    return await setTodayInner(mode, shownDay);
  } catch (err) {
    console.error("[setToday]", err);
    return { ok: false, error: "Couldn't save that. Try again in a moment." };
  }
}

async function setTodayInner(mode: "in" | "out" | "regular", shownDay: string | null): Promise<ActionResult> {
  const personId = await currentPersonId();
  if (!personId) return { ok: false, error: "Sign in first." };
  const open = await openDay(shownDay);
  if ("error" in open) return { ok: false, error: open.error };
  if (mode !== "out") {
    const me = await getPerson(personId);
    const day = (await dayEntriesFor(open.day)).find((e) => e.person.id === personId);
    if (mode === "regular" && !me?.regular) return { ok: false, error: "Pick a regular first." };
    if (mode === "in" && !day?.override && !me?.regular) return { ok: false, error: "Pick a drink first." };
  }
  await setDay(personId, open.day, mode === "out" ? { out: true } : mode === "regular" ? { in: true, useRegular: true } : { in: true });
  revalidatePath("/");
  return { ok: true };
}

export async function clearRegular(): Promise<ActionResult> {
  const personId = await currentPersonId();
  if (!personId) return { ok: false, error: "Sign in first." };
  await protectLockedToday(personId);
  await setRegular(personId, null);
  revalidatePath("/");
  return { ok: true };
}

// ── Admin ────────────────────────────────────────────────────────────────

async function requireAdmin(): Promise<void> {
  if (!(await isAdmin())) throw new Error("Admin only");
}

export async function adminSignIn(_: unknown, form: FormData): Promise<{ error: string } | undefined> {
  if (!codeMatches(String(form.get("code") ?? ""), "ADMIN_CODE")) return { error: "Wrong admin code." };
  await setAdmin();
  redirect("/admin");
}

export async function saveSchedule(form: FormData): Promise<void> {
  await requireAdmin();
  const orderTime = String(form.get("orderTime") ?? "11:30");
  const lead = Math.min(60, Math.max(0, Number(form.get("lead") ?? 10) || 0));
  const days = form.getAll("days").map(Number).filter((d) => d >= 0 && d <= 6);
  const payment = form.get("payment") === "Cash" ? "Cash" : "SwiggyPay";
  const channel = String(form.get("channel") ?? "").trim() || null;
  const before = await getSettings();
  await ensureSchema();
  await sql()`update coffee_settings set order_time = ${/^\d{1,2}:\d{2}$/.test(orderTime) ? orderTime : "11:30"},
    reminder_lead_min = ${lead}, days = ${days}, payment = ${payment}, channel_id = ${channel}, updated_at = now() where id = 1`;
  const after = await getSettings();
  // Keep today's Slack messages on the same clock as the site.
  if (after.orderTime !== before.orderTime || after.reminderLeadMin !== before.reminderLeadMin || after.channelId !== before.channelId) {
    await rescheduleToday();
  }
  revalidatePath("/admin");
  revalidatePath("/");
}

export async function chooseAddress(form: FormData): Promise<void> {
  await requireAdmin();
  const [id, label] = String(form.get("address") ?? "").split("::");
  if (!id) return;
  await sql()`update coffee_settings set address_id = ${id}, address_label = ${label || "Office"}, updated_at = now() where id = 1`;
  await cacheDropPrefix("menu:");
  revalidatePath("/admin");
}

export async function chooseRestaurant(form: FormData): Promise<void> {
  await requireAdmin();
  const id = String(form.get("restaurantId") ?? "");
  const name = String(form.get("restaurantName") ?? "");
  if (!id) return;
  await sql()`update coffee_settings set restaurant_id = ${id}, restaurant_name = ${name}, updated_at = now() where id = 1`;
  await cacheDropPrefix("menu:");
  revalidatePath("/admin");
  revalidatePath("/");
}

export interface RestaurantHit {
  id: string;
  name: string;
  area: string;
  distanceKm: number | null;
  rating: number | null;
  open: boolean;
}

export async function searchRestaurants(query: string): Promise<{ hits: RestaurantHit[] } | { error: string }> {
  await requireAdmin();
  const s = await getSettings();
  if (!s.addressId) return { error: "Pick the office address first." };
  try {
    const { data } = await read("search_restaurants", { addressId: s.addressId, query: query.slice(0, 100) || "coffee" });
    const list = Array.isArray(data?.restaurants) ? (data!.restaurants as Record<string, unknown>[]) : [];
    return {
      hits: list.map((r) => ({
        id: String(r.id),
        name: String(r.name ?? "").replace(/\s*\(Ad\)$/, ""),
        area: String(r.areaName ?? ""),
        distanceKm: Number.isFinite(Number(r.distanceKm)) ? Number(r.distanceKm) : null,
        rating: Number.isFinite(Number(r.avgRating)) ? Number(r.avgRating) : null,
        open: r.availabilityStatus === "OPEN",
      })),
    };
  } catch (err) {
    return { error: humanError(err) };
  }
}

export async function refreshMenu(): Promise<void> {
  await requireAdmin();
  await cacheDropPrefix("item:");
  await getMenu(await getSettings(), { force: true });
  revalidatePath("/");
  revalidatePath("/admin");
}

export async function setUpToday(): Promise<ActionResult> {
  await requireAdmin();
  try {
    await scheduleDay(istClock().day, { force: true });
    revalidatePath("/admin");
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String((err as Error).message) };
  }
}

export async function skipToday(): Promise<ActionResult> {
  await requireAdmin();
  const ok = await cancelDay(istClock().day, null);
  revalidatePath("/admin");
  return ok ? { ok: true } : { ok: false, error: "Nothing to cancel (not set up, or already ordered)." };
}

export async function deactivatePerson(form: FormData): Promise<void> {
  await requireAdmin();
  await removePerson(Number(form.get("personId")));
  revalidatePath("/admin");
}
