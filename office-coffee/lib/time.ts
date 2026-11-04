// The office runs on IST and so does every rule here. India has no DST, so
// IST is a fixed +05:30 and plain arithmetic is exact — no tz database needed.

const IST_OFFSET_MIN = 330;

export interface IstClock {
  day: string; // YYYY-MM-DD in IST
  minutes: number; // minutes since IST midnight
  weekday: number; // 0 = Sunday … 6 = Saturday, in IST
}

export function istClock(now: Date = new Date()): IstClock {
  const shifted = new Date(now.getTime() + IST_OFFSET_MIN * 60_000);
  return {
    day: shifted.toISOString().slice(0, 10),
    minutes: shifted.getUTCHours() * 60 + shifted.getUTCMinutes(),
    weekday: shifted.getUTCDay(),
  };
}

// "11:30" → 690. Anything malformed falls back to 11:30 rather than throwing:
// a typo in settings must not silently stop the coffee run.
export function parseHm(hm: string | null | undefined, fallback = 690): number {
  const m = /^(\d{1,2}):(\d{2})$/.exec((hm ?? "").trim());
  if (!m) return fallback;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return fallback;
  return h * 60 + min;
}

export function formatHm(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  const suffix = h >= 12 ? "pm" : "am";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, "0")}${suffix}`;
}

// Unix seconds for an IST wall-clock moment on an IST date.
export function istEpochSec(day: string, minutes: number): number {
  const midnightUtcMs = Date.parse(`${day}T00:00:00Z`) - IST_OFFSET_MIN * 60_000;
  return Math.floor(midnightUtcMs / 1000) + minutes * 60;
}

function weekdayOf(day: string): number {
  return new Date(`${day}T00:00:00Z`).getUTCDay();
}

function addDays(day: string, n: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

// The run people are choosing for: today if today is a run day and the order
// time hasn't passed, otherwise the next run day. Choices are always "for the
// next run", so an edit at 3pm lands on tomorrow, not on an order already sent.
export function nextRunDay(days: number[], orderMinutes: number, now: Date = new Date()): string | null {
  if (days.length === 0) return null;
  const clock = istClock(now);
  for (let i = 0; i < 8; i++) {
    const day = addDays(clock.day, i);
    if (!days.includes(weekdayOf(day))) continue;
    if (i === 0 && clock.minutes >= orderMinutes) continue;
    return day;
  }
  return null;
}

export function isRunDay(days: number[], day: string): boolean {
  return days.includes(weekdayOf(day));
}

export function dayLabel(day: string, now: Date = new Date()): string {
  const today = istClock(now).day;
  if (day === today) return "Today";
  if (day === addDays(today, 1)) return "Tomorrow";
  return new Date(`${day}T00:00:00Z`).toLocaleDateString("en-IN", {
    weekday: "long",
    timeZone: "UTC",
  });
}
