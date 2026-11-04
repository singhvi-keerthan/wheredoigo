// Light auth for an office tool: one shared office code to get in, then you
// pick your name. Admin settings take a separate admin code. Cookies are
// HMAC-signed with SESSION_SECRET so they can't be edited to become someone
// else or an admin.

import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";

const PERSON = "oc_person";
const ADMIN = "oc_admin";
const YEAR = 60 * 60 * 24 * 365;

function secret(): string {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 16) throw new Error("SESSION_SECRET must be set (16+ chars)");
  return s;
}

const sign = (v: string) => `${v}.${createHmac("sha256", secret()).update(v).digest("base64url")}`;

function unsign(signed: string | undefined): string | null {
  if (!signed) return null;
  const i = signed.lastIndexOf(".");
  if (i < 1) return null;
  const v = signed.slice(0, i);
  const a = Buffer.from(sign(v));
  const b = Buffer.from(signed);
  return a.length === b.length && timingSafeEqual(a, b) ? v : null;
}

export function codeMatches(given: string, envName: "ACCESS_CODE" | "ADMIN_CODE"): boolean {
  const want = process.env[envName];
  if (!want) return false;
  const a = Buffer.from(createHmac("sha256", "cmp").update(given.trim()).digest());
  const b = Buffer.from(createHmac("sha256", "cmp").update(want).digest());
  return timingSafeEqual(a, b);
}

const opts = { httpOnly: true, sameSite: "lax" as const, secure: process.env.NODE_ENV === "production", path: "/", maxAge: YEAR };

export async function currentPersonId(): Promise<number | null> {
  const v = unsign((await cookies()).get(PERSON)?.value);
  return v && /^\d+$/.test(v) ? Number(v) : null;
}

export async function setPerson(id: number): Promise<void> {
  (await cookies()).set(PERSON, sign(String(id)), opts);
}

export async function clearPerson(): Promise<void> {
  (await cookies()).delete(PERSON);
}

export async function isAdmin(): Promise<boolean> {
  return unsign((await cookies()).get(ADMIN)?.value) === "admin";
}

export async function setAdmin(): Promise<void> {
  (await cookies()).set(ADMIN, sign("admin"), { ...opts, maxAge: 60 * 60 * 24 * 30 });
}
