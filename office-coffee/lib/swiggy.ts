// Swiggy Food MCP (mcp.swiggy.com/food) on Keerthan's own Swiggy account.
//
// The token is the one the wheredoigo app stores in `swiggy_credentials` and
// keeps renewed (5-day tokens, no refresh grant). Verified 2026-11-04: that
// token lists all 20 /food tools. This file only reads it.
//
// Swiggy's published ceiling is 70 req/min per user per server for reads and
// 30 for writes, with the connect + initialize handshakes counted. Everything
// goes through one metered fetch capped at 30 a minute, shared by every lambda
// through Neon, and a 429 is never retried.

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { ensureSchema, sql } from "./db";

const SERVER_URL = "https://mcp.swiggy.com/food";
const CALLS_PER_MIN = 30;

export class SwiggyAuthError extends Error {
  constructor() {
    super("Swiggy token expired: renew it with Reconnect Swiggy in the wheredoigo app");
    this.name = "SwiggyAuthError";
  }
}

export class SwiggyRateLimitError extends Error {
  constructor(public retryAfterSec: number) {
    super(`Swiggy rate limit: try again in ${retryAfterSec}s`);
    this.name = "SwiggyRateLimitError";
  }
}

export class SwiggyToolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SwiggyToolError";
  }
}

export async function tokenStatus(): Promise<{ expiresAt: Date | null; hoursLeft: number | null } | null> {
  await ensureSchema();
  try {
    const rows = (await sql()`select expires_at from swiggy_credentials where id = 1`) as {
      expires_at: string | null;
    }[];
    if (!rows[0]) return null;
    const expiresAt = rows[0].expires_at ? new Date(rows[0].expires_at) : null;
    return {
      expiresAt,
      hoursLeft: expiresAt ? Math.round(((expiresAt.getTime() - Date.now()) / 3_600_000) * 10) / 10 : null,
    };
  } catch {
    return null;
  }
}

async function bearer(): Promise<string> {
  const rows = (await sql()`select access_token from swiggy_credentials where id = 1`) as {
    access_token: string;
  }[];
  const t = rows[0]?.access_token;
  if (!t) throw new SwiggyAuthError();
  return t;
}

// Fixed one-minute window in one row. Fail-closed: if the meter can't be
// read, the call doesn't go out.
async function takeCall(): Promise<void> {
  const [r] = (await sql()`insert into coffee_meter (id, window_start, count) values (1, now(), 1)
    on conflict (id) do update set
      window_start = case when coffee_meter.window_start < now() - interval '60 seconds'
                          then now() else coffee_meter.window_start end,
      count = case when coffee_meter.window_start < now() - interval '60 seconds'
                   then 1 else coffee_meter.count + 1 end
    returning count, extract(epoch from (window_start + interval '60 seconds' - now()))::int as wait`) as {
    count: number;
    wait: number;
  }[];
  if (r.count > CALLS_PER_MIN) throw new SwiggyRateLimitError(Math.max(1, r.wait));
}

let blockedUntil = 0;

const meteredFetch = async (url: string | URL, init?: RequestInit): Promise<Response> => {
  const wait = Math.ceil((blockedUntil - Date.now()) / 1000);
  if (wait > 0) throw new SwiggyRateLimitError(wait);
  await takeCall();
  const res = await fetch(url, init);
  if (res.status === 429) {
    const sec = Number(res.headers.get("retry-after")) || 60;
    blockedUntil = Date.now() + sec * 1000;
    throw new SwiggyRateLimitError(sec);
  }
  if (res.status === 401) throw new SwiggyAuthError();
  return res;
};

let cached: { token: string; client: Promise<Client> } | null = null;

function clientFor(token: string): Promise<Client> {
  if (!cached || cached.token !== token) {
    const transport = new StreamableHTTPClientTransport(new URL(SERVER_URL), {
      requestInit: { headers: { Authorization: `Bearer ${token}` } },
      fetch: meteredFetch,
    });
    const client = new Client({ name: "office-coffee", version: "0.1.0" });
    const connecting = client.connect(transport).then(() => client);
    connecting.catch(() => {
      if (cached?.client === connecting) cached = null;
    });
    cached = { token, client: connecting };
  }
  return cached.client;
}

type ToolResult = { isError?: boolean; structuredContent?: unknown; content?: { type?: string; text?: string }[] };

export interface Reply {
  data: Record<string, unknown> | null;
  text: string;
}

function unwrap(raw: unknown): Reply {
  const r = (raw ?? {}) as ToolResult;
  const text = (r.content ?? [])
    .filter((c) => c?.type === "text" && typeof c.text === "string")
    .map((c) => c.text as string)
    .join("\n")
    .trim();
  if (r.isError) throw new SwiggyToolError(text || "Swiggy returned an error");
  const sc = r.structuredContent;
  if (sc && typeof sc === "object" && !Array.isArray(sc) && Object.keys(sc).length) {
    return { data: sc as Record<string, unknown>, text };
  }
  if (text.startsWith("{")) {
    try {
      return { data: JSON.parse(text), text };
    } catch {
      /* prose */
    }
  }
  return { data: null, text };
}

const isAuth = (e: unknown) =>
  e instanceof SwiggyAuthError || /\b401\b|unauthori[sz]ed|invalid[_ ]token/i.test(String((e as Error)?.message ?? e));
const isRate = (e: unknown) =>
  e instanceof SwiggyRateLimitError || /RATE_LIMITED|rate.?limit|\b429\b/i.test(String((e as Error)?.message ?? e));

// `retrySafe` = a read. Writes (cart updates, placing the order) are never
// retried here: a retry after an ambiguous failure could double an order.
export async function callTool(name: string, args: Record<string, unknown>, retrySafe: boolean): Promise<Reply> {
  await ensureSchema();
  const token = await bearer();
  const attempt = async () => unwrap(await (await clientFor(token)).callTool({ name, arguments: args }));
  try {
    return await attempt();
  } catch (err) {
    if (err instanceof SwiggyToolError) throw err;
    cached = null;
    if (isAuth(err)) throw new SwiggyAuthError();
    if (isRate(err)) throw err instanceof SwiggyRateLimitError ? err : new SwiggyRateLimitError(60);
    if (!retrySafe) throw err;
    return await attempt();
  }
}

export const read = (name: string, args: Record<string, unknown>) => callTool(name, args, true);
export const write = (name: string, args: Record<string, unknown>) => callTool(name, args, false);

export function humanError(err: unknown): string {
  if (err instanceof SwiggyAuthError || err instanceof SwiggyRateLimitError || err instanceof SwiggyToolError) {
    return err.message.slice(0, 300);
  }
  return `Something went wrong talking to Swiggy (${String((err as Error)?.message ?? err).slice(0, 160)})`;
}
