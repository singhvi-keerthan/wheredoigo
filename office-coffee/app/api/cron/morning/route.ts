// Daily, ~09:00–09:59 IST (Vercel Hobby crons fire anywhere in their hour).
// It doesn't need minute precision: it asks Slack to post the reminder and
// the lock message at exact times, then warms the menu cache.

import { getSettings } from "@/lib/db";
import { getMenu } from "@/lib/menu";
import { scheduleDay } from "@/lib/run";
import { istClock } from "@/lib/time";

export const maxDuration = 60;

export async function GET(req: Request) {
  if (!process.env.CRON_SECRET || req.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) {
    return new Response("unauthorized", { status: 401 });
  }
  const day = istClock().day;
  const out: Record<string, string> = { day };
  try {
    out.schedule = await scheduleDay(day);
  } catch (err) {
    out.schedule = `error: ${(err as Error).message}`;
  }
  try {
    const s = await getSettings();
    const menu = await getMenu(s, { force: true });
    out.menu = menu ? `${menu.categories.length} categories` : "not configured";
  } catch (err) {
    out.menu = `error: ${(err as Error).message}`;
  }
  console.log("[cron/morning]", JSON.stringify(out));
  return Response.json(out, { status: out.schedule.startsWith("error") ? 500 : 200 });
}
