// One coffee run per day, as a small state machine in `coffee_runs`:
//
//   scheduling → scheduled ─review→ reviewing → reviewed ─yes→ placing → placed
//                                       │            │                 └→ unknown
//                                       └→ failed    └─no→ cancelled
//
// Rules this file holds to (each one is a way real money could go wrong):
//  - Every transition is a conditional UPDATE, so a double tap or two
//    approvers at once can only move the run once.
//  - Only TODAY's run can be reviewed, placed or cancelled. The Swiggy cart is
//    one shared cart on Keerthan's account; an old day's button must never
//    act on it.
//  - Once place_food_order has been sent, the run can only end `placed` or
//    `unknown` — never a retryable state. A Slack hiccup after a real order
//    must not offer "Rebuild" and a second order.
//  - A transient state older than STALE (> every route's maxDuration) is
//    recovered: reviewing → failed, scheduling → error_schedule, and
//    placing → unknown (the order may have gone out; a human checks).
//  - Yes is bound to what was reviewed: the same picks, the same cart lines
//    (item + every variant/add-on id), the same total, and the same address,
//    payment method and café.
//
// Nothing is ordered without an approver tapping Yes on a cart they have
// just seen — Swiggy's place_food_order instructions require explicit user
// confirmation, and this is that confirmation.

import { buildCartItems, describeChoice, picksHash, restaurantNote } from "./cart";
import { ensureSchema, getSettings, sql } from "./db";
import { getMenu } from "./menu";
import { dayEntries, picksFor } from "./people";
import { actions, approvers, button, context, esc, mention, postAt, section, slack } from "./slack";
import { humanError, read, tokenStatus, write } from "./swiggy";
import { formatHm, istClock, istEpochSec, isRunDay, parseHm } from "./time";
import type { PersonPick, Settings } from "./types";

type Json = Record<string, unknown>;

export interface CartLine {
  name: string;
  quantity: number;
  price: number;
  inStock: boolean;
  menuItemId: string;
  key: string; // item + sorted variant ids + sorted add-on ids
}

export interface ReviewedSettings {
  addressId: string | null;
  payment: string;
  restaurantId: string | null;
}

export interface CartSummary {
  lines: CartLine[];
  itemTotal: number | null;
  delivery: number | null;
  taxes: number | null;
  toPay: number | null;
  eta: string | null;
  replaced: string[];
  reviewed?: ReviewedSettings;
  reviewId?: string; // Yes carries it; a newer review makes older Yes buttons dead
}

interface ScheduledMsg {
  kind: "reminder" | "lock";
  id: string | null; // null = posted immediately
  channel?: string; // where it was scheduled; settings may change later
  postAt: number;
}

interface RunRow {
  day: string;
  status: string;
  channel_id: string | null;
  scheduled_ids: ScheduledMsg[];
  message_ts: string | null;
  picks: PersonPick[] | null;
  picks_hash: string | null;
  cart: CartSummary | null;
  order_result: Json | null;
  error: string | null;
  order_min: number | null;
}

const STALE_MIN = 5;
const siteUrl = () => (process.env.SITE_URL ?? "").replace(/\/$/, "");
const rupees = (n: number | null | undefined) => (n === null || n === undefined ? "—" : `₹${Math.round(n * 100) / 100}`);
const today = () => istClock().day;

export async function getRun(day: string): Promise<RunRow | null> {
  await ensureSchema();
  const rows = (await sql()`select day::text as day, status, channel_id, scheduled_ids, message_ts, picks,
      picks_hash, cart, order_result, error, order_min from coffee_runs where day = ${day}`) as RunRow[];
  return rows[0] ?? null;
}

// Today's cutoff as Slack knows it: the saved run snapshot wins over current
// settings, so changing the time after scheduling can't let the site and
// Slack disagree. `active` = today has a live run (incl. a forced one).
export async function todayCutoff(s: Settings): Promise<{ orderMin: number; active: boolean }> {
  const run = await getRun(today());
  const active = !!run && run.status !== "cancelled";
  return { orderMin: active && run!.order_min !== null ? run!.order_min : parseHm(s.orderTime), active };
}

async function recoverStale(day: string): Promise<void> {
  await ensureSchema();
  await sql()`update coffee_runs set
      status = case status when 'placing' then 'unknown' when 'reviewing' then 'failed' else 'error_schedule' end,
      error = coalesce(error || ' ', '') || '(timed out mid-step)', updated_at = now()
    where day = ${day} and status in ('placing', 'reviewing', 'scheduling')
      and updated_at < now() - make_interval(mins => ${STALE_MIN})`;
}

async function updateMessage(run: { channel_id: string | null; message_ts: string | null }, text: string, blocks: Json[]): Promise<void> {
  if (!run.channel_id || !run.message_ts) return;
  await slack("chat.update", { channel: run.channel_id, ts: run.message_ts, text, blocks });
}

function settingsProblem(s: Settings): string | null {
  if (!s.channelId) return "No Slack channel set";
  if (!s.addressId) return "No delivery address set";
  if (!s.restaurantId) return "No restaurant set";
  return null;
}

// ── Morning: schedule the two Slack messages ─────────────────────────────

export async function scheduleDay(day: string, opts: { force?: boolean } = {}): Promise<string> {
  const s = await getSettings();
  if (!opts.force && !isRunDay(s.days, day)) return "not a run day";
  const problem = settingsProblem(s);
  if (problem) throw new Error(problem);
  const orderMin = parseHm(s.orderTime);

  await recoverStale(day);
  // A cancelled day starts fresh; an errored one keeps what it already
  // scheduled so a retry only does what's missing.
  const claimed = (await sql()`insert into coffee_runs (day, status, channel_id, order_min) values (${day}, 'scheduling', ${s.channelId}, ${orderMin})
    on conflict (day) do update set status = 'scheduling', channel_id = excluded.channel_id, order_min = excluded.order_min, error = null,
      scheduled_ids = case when coffee_runs.status = 'cancelled' then '[]'::jsonb else coffee_runs.scheduled_ids end,
      message_ts = case when coffee_runs.status = 'cancelled' then null else coffee_runs.message_ts end,
      updated_at = now()
      where coffee_runs.status in ('cancelled', 'error_schedule')
    returning scheduled_ids`) as { scheduled_ids: ScheduledMsg[] }[];
  if (!claimed.length) return "already scheduled";
  const done = new Set((claimed[0].scheduled_ids ?? []).map((m) => m.kind));

  const record = async (m: ScheduledMsg, ts: string | null) => {
    await sql()`update coffee_runs set scheduled_ids = scheduled_ids || ${JSON.stringify([m])}::jsonb,
      message_ts = coalesce(${ts}, message_ts), updated_at = now() where day = ${day}`;
  };

  try {
    const remindMin = Math.max(0, orderMin - s.reminderLeadMin);
    const orderAt = istEpochSec(day, orderMin);
    const who = approvers();
    const restaurant = esc(s.restaurantName ?? "the café");

    // Say so now if the Swiggy token will die before the order goes in —
    // otherwise the first anyone hears of it is a failed cart at 11:30.
    if (!done.size) {
      const tok = await tokenStatus();
      const secsToOrder = orderAt - Date.now() / 1000;
      if (!tok || tok.hoursLeft === null || tok.hoursLeft * 3600 < secsToOrder + 1800) {
        await slack("chat.postMessage", {
          channel: s.channelId,
          text: `⚠️ ${mention(who)} the Swiggy token ${tok?.expiresAt ? `expires ${tok.expiresAt.toISOString()}` : "is missing"}. Renew it (Reconnect Swiggy in the wheredoigo app) before ${formatHm(orderMin)} or today's coffee can't be ordered.`,
        });
      }
    }

    const remindAt = istEpochSec(day, remindMin);
    if (!done.has("reminder") && s.reminderLeadMin > 0 && remindAt > Date.now() / 1000 - 60 && remindAt < orderAt) {
      const r = await postAt(s.channelId!, remindAt, `☕ Coffee run in ${s.reminderLeadMin} min from ${restaurant}. Tap "I'm in" on the site or you won't get one.`, [
        section(`☕ *Coffee run in ${s.reminderLeadMin} min* from *${restaurant}*.\nOnly people who tap *I'm in* today get coffee. Your usual is pre-picked; change it if you like.`),
        actions(button("I'm in / change my drink", "open_site", day, "primary", siteUrl() || undefined)),
      ]);
      await record({ kind: "reminder", id: r.scheduledId, postAt: remindAt, channel: s.channelId! }, null);
    }

    if (!done.has("lock")) {
      const r = await postAt(s.channelId!, orderAt, `⏰ ${formatHm(orderMin)}: coffee orders are locked for ${restaurant}.`, [
        section(`⏰ *${formatHm(orderMin)}: coffee orders are locked* for *${restaurant}*.`),
        context(`${who.length ? mention(who) : "Approver"}: review the cart, then say yes or no.`),
        actions(button("🛒 Review cart", "review", day, "primary"), button("No coffee today", "cancel", day, "danger")),
      ]);
      await record({ kind: "lock", id: r.scheduledId, postAt: orderAt, channel: s.channelId! }, r.ts);
    }

    await sql()`update coffee_runs set status = 'scheduled', updated_at = now() where day = ${day} and status = 'scheduling'`;
    return "scheduled";
  } catch (err) {
    await sql()`update coffee_runs set status = 'error_schedule', error = ${String((err as Error).message ?? err)}, updated_at = now()
      where day = ${day} and status = 'scheduling'`;
    throw err;
  }
}

// The order time changed in settings after today was scheduled: pull the
// pending Slack messages and schedule again, so Slack and the site agree.
export async function rescheduleToday(): Promise<void> {
  const day = today();
  const run = await getRun(day);
  if (!run || run.status !== "scheduled") return;
  if (run.order_min !== null && istClock().minutes >= run.order_min) return; // already locked
  await cancelDay(day, null, undefined, { quiet: true });
  await scheduleDay(day, { force: true });
}

// ── 11:30: build the cart and show it ────────────────────────────────────

const ids = (list: unknown, ...fields: string[]): string[] =>
  (Array.isArray(list) ? (list as Json[]) : [])
    .map((x) => fields.map((f) => x[f]).find((v) => v !== undefined && v !== null))
    .filter((v) => v !== undefined && v !== null)
    .map(String)
    .sort();

export function parseCart(data: Json | null, replaced: string[]): CartSummary {
  const inner = ((data?.data ?? data) ?? {}) as Json;
  const pricing = (inner.pricing ?? {}) as Json;
  const n = (v: unknown) => (v === undefined || v === null || !Number.isFinite(Number(v)) ? null : Number(v));
  const items = Array.isArray(inner.items) ? (inner.items as Json[]) : [];
  return {
    lines: items.map((i) => {
      const variants = [...(Array.isArray(i.variants) ? (i.variants as Json[]) : []), ...(Array.isArray(i.variantsV2) ? (i.variantsV2 as Json[]) : [])];
      const addons = Array.isArray(i.addons) ? (i.addons as Json[]) : [];
      const extras = [...variants, ...addons].map((x) => String(x.name ?? "")).filter(Boolean);
      const id = String(i.menu_item_id ?? "");
      return {
        name: extras.length ? `${i.name} (${extras.join(", ")})` : String(i.name ?? "item"),
        quantity: Number(i.quantity ?? 1),
        price: Number(i.final_price ?? i.total ?? 0),
        inStock: i.in_stock === undefined ? true : Number(i.in_stock) === 1,
        menuItemId: id,
        key: JSON.stringify([id, ids(variants, "variation_id", "variationId", "id"), ids(addons, "choice_id", "choiceId", "id")]),
      };
    }),
    itemTotal: n(pricing.item_total),
    delivery: n(pricing.delivery_charge),
    taxes: n(pricing.taxes_and_charges),
    toPay: n(pricing.to_pay),
    eta: ((inner.restaurant as Json | undefined)?.deliverySubtitle as string | undefined)?.split(" to ")[0] ?? null,
    replaced,
  };
}

// The same key a pick would have as a cart line.
export function pickKey(p: PersonPick): string {
  const c = p.choice;
  return JSON.stringify([c.itemId, c.variants.map((v) => v.optionId).sort(), c.addons.map((a) => a.optionId).sort()]);
}

// Does Swiggy's cart hold exactly what people picked — every line with its
// exact size, milk and add-ons? A silent drop or a substituted option must
// block Yes, not be discovered at the door.
export function cartProblems(cart: CartSummary, picks: PersonPick[]): string[] {
  const problems: string[] = [];
  const want = new Map<string, { qty: number; name: string }>();
  for (const p of picks) {
    const k = pickKey(p);
    const cur = want.get(k);
    want.set(k, { qty: (cur?.qty ?? 0) + 1, name: describeChoice(p.choice) });
  }
  const got = new Map<string, { qty: number; name: string }>();
  for (const l of cart.lines) {
    const cur = got.get(l.key);
    got.set(l.key, { qty: (cur?.qty ?? 0) + l.quantity, name: l.name });
  }
  for (const [k, w] of want) {
    const g = got.get(k)?.qty ?? 0;
    if (g !== w.qty) problems.push(`${w.name}: ${w.qty} picked, ${g} in Swiggy's cart`);
  }
  for (const [k, g] of got) if (!want.has(k)) problems.push(`Swiggy's cart has something nobody picked: ${g.qty}× ${g.name}`);
  for (const l of cart.lines) if (!l.inStock) problems.push(`${l.name} is out of stock`);
  if (cart.toPay === null) problems.push("Swiggy didn't return a total");
  return problems;
}

// Slack caps a section at 3000 chars and a message at 50 blocks. Split the
// list rather than cut it: the approver must be able to see every drink.
export function chunkLines(lines: string[], max = 2800): string[] {
  const out: string[] = [];
  let cur = "";
  for (const l of lines) {
    if (l.length > max) throw new Error("A line is too long to show in Slack");
    const line = l;
    if (cur && cur.length + 1 + line.length > max) {
      out.push(cur);
      cur = line;
    } else cur = cur ? `${cur}\n${line}` : line;
  }
  if (cur) out.push(cur);
  return out;
}

function reviewBlocks(s: Settings, day: string, picks: PersonPick[], cart: CartSummary, hash: string, problemsIn: string[], stale: string[], note: string | null): Json[] {
  const problems = [...problemsIn];
  let people: string[] = [];
  let swiggyLines: string[] = [];
  try {
    people = chunkLines(picks.map((p) => `• *${esc(p.personName)}*: ${esc(describeChoice(p.choice))}${p.choice.note ? ` _“${esc(p.choice.note)}”_` : ""}`));
    swiggyLines = chunkLines(cart.lines.map((l) => `${l.quantity}× ${esc(l.name)}  ${rupees(l.price)}`));
  } catch {
    problems.push("Something in this cart is too long to show in Slack. Order it in the Swiggy app.");
  }
  const bill = [`Items ${rupees(cart.itemTotal)}`, `Delivery ${cart.delivery === 0 ? "free" : rupees(cart.delivery)}`, `Taxes & charges ${rupees(cart.taxes)}`].join(" · ");
  const pay = s.payment === "Cash" ? "cash on delivery" : "Swiggy Money";

  const blocks: Json[] = [
    section(`🛒 *Coffee cart: ${esc(s.restaurantName ?? "")}*, ${picks.length} ${picks.length === 1 ? "drink" : "drinks"}`),
    ...people.map(section),
    context("In Swiggy's cart:"),
    ...swiggyLines.map(section),
    section(`${bill}\n*To pay ${rupees(cart.toPay)}*`),
    context(`To ${esc(s.addressLabel ?? "office")}${cart.eta ? ` · ${esc(cart.eta)}` : ""} · paying with ${pay}`),
  ];
  if (note) blocks.push(context(`ℹ️ ${esc(note)}`));
  if (stale.length) blocks.push(context(`Left out (their pick isn't on this menu any more): ${esc(stale.join(", ")).slice(0, 2900)}`));
  if (cart.replaced.length) blocks.push(context(`Replaced what was in the Swiggy cart: ${esc(cart.replaced.join(", ")).slice(0, 2900)}`));
  if (blocks.length > 46) {
    problems.push("Too many drinks to show in one Slack message. Order this one in the Swiggy app.");
    blocks.splice(1, blocks.length - 1, section(`${picks.length} drinks, to pay ${rupees(cart.toPay)}`));
  }
  if (problems.length) {
    blocks.push(section(`⚠️ *Can't place this yet:*\n${problems.map((p) => `• ${esc(p)}`).join("\n").slice(0, 2800)}`));
    blocks.push(actions(button("🔄 Rebuild cart", "review", day), button("No coffee today", "cancel", day, "danger")));
  } else {
    blocks.push(
      actions(
        button(`✅ Yes, order ${rupees(cart.toPay)}`, "place", `${day}|${hash}|${cart.toPay}|${cart.reviewId ?? ""}`, "primary"),
        button("🔄 Rebuild cart", "review", day),
        button("No", "cancel", day, "danger")
      )
    );
  }
  return blocks;
}

// Returns a message for the tapper when it can't act, or null.
export async function reviewDay(day: string, channel: string, ts: string, note: string | null = null, opts: { afterUnknown?: boolean } = {}): Promise<string | null> {
  if (day !== today()) return "That's an old coffee run; only today's can be reviewed.";
  await recoverStale(day);
  const run = await getRun(day);
  if (!run) return "Today isn't set up.";
  if (run.status === "unknown" && !opts.afterUnknown) {
    // The last attempt may have ordered. Put the warning card back and make
    // the human check before anything can be rebuilt.
    await safeUpdate({ channel_id: channel, message_ts: ts }, "Swiggy didn't confirm the last order.", unknownBlocks(day, run.error ?? "the last attempt didn't finish", "someone"));
    return "The last order attempt may have gone through. Check Swiggy orders first, then use “It didn't go through: rebuild”.";
  }
  if (run.order_min !== null && istClock().minutes < run.order_min) {
    return `Orders are still open until ${formatHm(run.order_min)}; review after that.`;
  }
  const claimed = (await sql()`update coffee_runs set status = 'reviewing', channel_id = ${channel}, message_ts = ${ts}, error = null, updated_at = now()
    where day = ${day} and status in ('scheduled', 'reviewed', 'failed', 'empty', ${opts.afterUnknown ? "unknown" : "scheduled"})
    returning day`) as unknown[];
  if (!claimed.length) return run.status === "reviewing" ? "Already building the cart, one sec." : `Can't review now (${run.status}).`;
  const msg = { channel_id: channel, message_ts: ts };

  try {
    await updateMessage(msg, "Building the cart…", [section("🛒 Building the Swiggy cart…")]);
    const s = await getSettings();
    const problem = settingsProblem(s);
    if (problem) throw new Error(problem);
    const menu = await getMenu(s);
    if (!menu) throw new Error("Couldn't load the menu");
    const valid = new Set(menu.categories.flatMap((c) => c.items.map((i) => i.id)));
    const { picks, stale } = picksFor(await dayEntries(day), valid);

    if (!picks.length) {
      await sql()`update coffee_runs set status = 'empty', picks = '[]'::jsonb, updated_at = now() where day = ${day} and status = 'reviewing'`;
      await updateMessage(msg, "Nobody's in for coffee today.", [
        section("☕ Nobody tapped in for coffee today, so there's nothing to order."),
        ...(stale.length ? [context(`Left out (pick not on this menu): ${esc(stale.join(", "))}`)] : []),
        actions(button("🔄 Check again", "review", day)),
      ]);
      return null;
    }

    // The cart is Keerthan's own Swiggy cart. Say what we replace.
    const before = await read("get_food_cart", { addressId: s.addressId });
    const replaced = parseCart(before.data, []).lines.map((l) => l.name);
    if (replaced.length) await write("flush_food_cart", {});
    await write("update_food_cart", { restaurantId: s.restaurantId, cartItems: buildCartItems(picks) });
    const live = await read("get_food_cart", { addressId: s.addressId, restaurantName: s.restaurantName ?? undefined });
    const cart: CartSummary = {
      ...parseCart(live.data, replaced),
      reviewed: { addressId: s.addressId, payment: s.payment, restaurantId: s.restaurantId },
      reviewId: crypto.randomUUID().slice(0, 8),
    };
    const problems = cartProblems(cart, picks);
    const hash = picksHash(picks);

    await sql()`update coffee_runs set status = 'reviewed', picks = ${JSON.stringify(picks)}::jsonb, picks_hash = ${hash},
      cart = ${JSON.stringify(cart)}::jsonb, updated_at = now() where day = ${day} and status = 'reviewing'`;
    await updateMessage(msg, `Coffee cart: ${picks.length} drinks, to pay ${rupees(cart.toPay)}`, reviewBlocks(s, day, picks, cart, hash, problems, stale, note));
  } catch (err) {
    const why = humanError(err);
    await sql()`update coffee_runs set status = 'failed', error = ${why}, updated_at = now() where day = ${day} and status = 'reviewing'`;
    await updateMessage(msg, `Couldn't build the cart: ${why}`, [
      section(`⚠️ *Couldn't build the cart.*\n${esc(why)}`),
      actions(button("🔄 Try again", "review", day), button("No coffee today", "cancel", day, "danger")),
    ]).catch((e) => console.error("[review] slack update failed", e));
  }
  return null;
}

// ── Yes: place the order ─────────────────────────────────────────────────

export async function placeDay(value: string, user: string, channel: string, ts: string): Promise<string | null> {
  const [day, hash, toPayStr, reviewId] = value.split("|");
  if (day !== today()) return "That's an old coffee run; it can't be ordered now.";
  await recoverStale(day);
  const claimed = (await sql()`update coffee_runs set status = 'placing', updated_at = now()
    where day = ${day} and status = 'reviewed' and picks_hash = ${hash} and cart->>'reviewId' = ${reviewId ?? ""}
    returning cart`) as { cart: CartSummary }[];
  if (!claimed.length) return "This cart was already handled or changed. Use the latest message.";
  const reviewedCart = claimed[0].cart;
  const msg = { channel_id: channel, message_ts: ts };
  let submitted = false;

  const backToReview = async (why: string) => {
    await sql()`update coffee_runs set status = 'reviewed', updated_at = now() where day = ${day} and status = 'placing'`;
    await reviewDay(day, channel, ts, why);
  };

  try {
    const s = await getSettings();
    const r = reviewedCart.reviewed;
    if (!r || r.addressId !== s.addressId || r.payment !== s.payment || r.restaurantId !== s.restaurantId) {
      await backToReview("Address, payment or café changed since the cart was shown. This is the updated cart.");
      return null;
    }

    // Someone changed their order after the cart was shown: show it again
    // rather than order something nobody approved.
    const menu = await getMenu(s);
    const valid = new Set((menu?.categories ?? []).flatMap((c) => c.items.map((i) => i.id)));
    const { picks } = picksFor(await dayEntries(day), valid);
    if (picksHash(picks) !== hash) {
      await backToReview("Orders changed after the cart was shown. This is the updated cart.");
      return null;
    }

    const live = parseCart((await read("get_food_cart", { addressId: s.addressId })).data, []);
    const sameLines = JSON.stringify(live.lines.map((l) => [l.key, l.quantity]).sort()) === JSON.stringify(reviewedCart.lines.map((l) => [l.key, l.quantity]).sort());
    if (live.toPay === null || String(live.toPay) !== toPayStr || !sameLines || cartProblems(live, picks).length) {
      await backToReview(`The Swiggy cart changed (now ${rupees(live.toPay)}). Check it again.`);
      return null;
    }

    const optsReply = await read("get_payment_options", { addressId: s.addressId });
    const view = ((optsReply.data?.data ?? optsReply.data) ?? {}) as Json;
    let paymentMethod: string;
    if (s.payment === "SwiggyPay") {
      if (!(view.swiggyMoney as { available?: boolean } | undefined)?.available) {
        throw new Error("Swiggy Money isn't offered for this cart. Top it up in the Swiggy app, or switch payment to Cash in settings.");
      }
      paymentMethod = "SwiggyPay";
    } else {
      if (!(view.cod as { available?: boolean } | undefined)?.available) throw new Error("Cash on delivery isn't available for this cart.");
      paymentMethod = "Cash";
    }

    // Cosmetic progress note: a Slack failure here must not block the order.
    await updateMessage(msg, "Placing the order…", [section(`⏳ Placing the order (${rupees(live.toPay)})…`)]).catch((e) => console.error("[place] progress update failed", e));

    // ── Past this line an order may exist. Never back to a retryable state. ──
    submitted = true;
    let placed: Json;
    try {
      const res = await write("place_food_order", {
        addressId: s.addressId,
        paymentMethod,
        ...(restaurantNote(picks) ? { noteToRestaurant: restaurantNote(picks) } : {}),
      });
      placed = ((res.data?.data ?? res.data) ?? { text: res.text }) as Json;
    } catch (err) {
      await sql()`update coffee_runs set status = 'unknown', error = ${humanError(err)}, updated_at = now() where day = ${day} and status = 'placing'`;
      await safeUpdate(msg, "Swiggy didn't confirm the order.", unknownBlocks(day, humanError(err), user));
      return null;
    }

    const ok = placed.normalizedStatus === "success" || /^CONFIRMED$/i.test(String(placed.status ?? ""));
    await sql()`update coffee_runs set status = ${ok ? "placed" : "unknown"}, order_result = ${JSON.stringify(placed)}::jsonb,
      updated_at = now() where day = ${day} and status = 'placing'`;
    if (!ok) {
      await safeUpdate(msg, "Swiggy didn't confirm the order.", unknownBlocks(day, `Swiggy answered status "${String(placed.status ?? "?")}"`, user));
      return null;
    }
    const orderId = placed.orderId ? String(placed.orderId) : null;
    const total = Number(placed.totalAmount ?? live.toPay);
    await safeUpdate(msg, `Coffee ordered: ${rupees(total)}`, [
      section(`✅ *Coffee ordered* from *${esc(s.restaurantName ?? "")}*: ${picks.length} drinks, ${rupees(total)}`),
      ...chunkLines(picks.map((p) => `• *${esc(p.personName)}*: ${esc(describeChoice(p.choice))}`)).slice(0, 40).map(section),
      context(`Approved by <@${user}>${placed.estimatedDelivery ? ` · arriving ${esc(String(placed.estimatedDelivery))}` : ""}${orderId ? ` · order ${esc(orderId)}` : ""} · to cancel: Swiggy care 080-67466729`),
      ...(orderId ? [actions(button("📍 Track", "track", orderId))] : []),
    ]);
  } catch (err) {
    const why = humanError(err);
    if (submitted) {
      // Only reachable if something between "submitted" and the status write
      // threw. The order may exist: park it as unknown, never as retryable.
      await sql()`update coffee_runs set status = 'unknown', error = ${why}, updated_at = now() where day = ${day} and status = 'placing'`;
      await safeUpdate(msg, "Swiggy didn't confirm the order.", unknownBlocks(day, why, user));
      return null;
    }
    await sql()`update coffee_runs set status = 'failed', error = ${why}, updated_at = now() where day = ${day} and status = 'placing'`;
    await safeUpdate(msg, `Didn't place the order: ${why}`, [
      section(`⚠️ *Didn't place the order* (nothing was sent to Swiggy).\n${esc(why)}`),
      actions(button("🔄 Rebuild cart", "review", day), button("No coffee today", "cancel", day, "danger")),
    ]);
  }
  return null;
}

// A failed Slack update must never change what happened to the order: log
// it, and fall back to a fresh message so the channel still hears.
async function safeUpdate(msg: { channel_id: string | null; message_ts: string | null }, text: string, blocks: Json[]): Promise<void> {
  try {
    await updateMessage(msg, text, blocks);
  } catch (err) {
    console.error("[run] chat.update failed", err);
    if (msg.channel_id) await slack("chat.postMessage", { channel: msg.channel_id, text }).catch((e) => console.error("[run] postMessage failed", e));
  }
}

function unknownBlocks(day: string, why: string, user: string): Json[] {
  return [
    section(`⚠️ *Swiggy didn't confirm the order.* It may or may not have gone through. Check before trying again, so it isn't ordered twice.\n_${esc(why)}_`),
    context(`Tapped by <@${user}>. Check orders in the Swiggy app, or below.`),
    actions(button("🔎 Check Swiggy orders", "orders", day), button("It didn't go through: rebuild", "rebuild_unknown", day, "danger")),
  ];
}

// ── No: cancel the day ───────────────────────────────────────────────────

export async function cancelDay(day: string, user: string | null, where?: { channel: string; ts: string }, opts: { quiet?: boolean } = {}): Promise<boolean> {
  if (day !== today()) return false;
  await recoverStale(day);
  const current = await getRun(day);
  const cancellable = ["scheduled", "reviewed", "failed", "empty", "error_schedule"];
  if (!current || !cancellable.includes(current.status)) return false;
  if (current.status === "reviewed") {
    // The coffee is sitting in Keerthan's own Swiggy cart; empty it before the
    // run reads as cancelled, so a fresh run can't start mid-cleanup.
    await write("flush_food_cart", {}).catch((e) => console.error("[cancel] flush failed", e));
  }
  // Conditional on the status just read, so a No that lost the race to a Yes
  // can't undo it.
  const rows = (await sql()`update coffee_runs set status = 'cancelled', updated_at = now()
    where day = ${day} and status = ${current.status}
    returning channel_id, scheduled_ids, message_ts`) as { channel_id: string | null; scheduled_ids: ScheduledMsg[]; message_ts: string | null }[];
  const r = rows[0];
  if (!r) return false;
  for (const m of r.scheduled_ids ?? []) {
    if (m.id && m.postAt > Date.now() / 1000 + 10) {
      await slack("chat.deleteScheduledMessage", { channel: m.channel ?? r.channel_id, scheduled_message_id: m.id }).catch((e) => console.error("[cancel] delete scheduled failed", e));
    }
  }
  if (!opts.quiet) {
    const target = where ? { channel_id: where.channel, message_ts: where.ts } : r;
    await updateMessage(target, "No coffee today.", [section(`❌ No coffee today${user ? ` (called by <@${user}>)` : ""}.`)]).catch(() => undefined);
  }
  return true;
}

// ── Lookups for the buttons ──────────────────────────────────────────────

export async function trackText(orderId: string): Promise<string> {
  try {
    const r = await read("track_food_order", { orderId });
    return (r.text || JSON.stringify(r.data)).slice(0, 1500);
  } catch (err) {
    return humanError(err);
  }
}

export async function recentOrdersText(): Promise<string> {
  try {
    const r = await read("get_food_orders", {});
    return (r.text || JSON.stringify(r.data)).slice(0, 2500);
  } catch (err) {
    return humanError(err);
  }
}

