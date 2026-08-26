// Server-only transport for Swiggy's Dineout MCP server. Everything about the
// wire format is fixed by mcp.swiggy.com/builders/docs:
//
//   - JSON-RPC over *streamable HTTP* to POST mcp.swiggy.com/dineout
//   - OAuth 2.1 + PKCE; the access token rides in `Authorization: Bearer …`
//   - access tokens last 5 days and THERE ARE NO REFRESH TOKENS in v1.0 —
//     the docs are explicit: "always treat 401 as 're-run authorization';
//     never cache success assumptions".
//
// That last point is the whole reason this file has a typed SwiggyAuthError:
// a 401 is a normal, roughly-weekly event, not an exception. It has to travel
// up to the UI as "reconnect Swiggy", not as a generic failure. Minting a new
// token is `npm run swiggy:auth` (scripts/swiggy-auth.ts).

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const SERVER_URL = process.env.SWIGGY_MCP_URL ?? "https://mcp.swiggy.com/dineout";

// Thrown when Swiggy rejects the token. Callers turn this into a "reconnect"
// affordance rather than an error toast — see the API routes.
export class SwiggyAuthError extends Error {
  constructor(message = "swiggy_reauth_required") {
    super(message);
    this.name = "SwiggyAuthError";
  }
}

function token(): string | null {
  return process.env.SWIGGY_MCP_TOKEN?.trim() || null;
}

// No token configured → lib/swiggy.ts serves mock data instead, so the deck and
// the booking flow stay usable in dev exactly as they were before access landed.
export function swiggyLive(): boolean {
  return token() !== null;
}

// One MCP session per warm lambda instance. Connecting costs an `initialize`
// round-trip, so re-doing it per tool call would double the latency of every
// search. The promise itself is cached so concurrent requests share one connect.
let cached: { token: string; client: Promise<Client> } | null = null;

async function connect(bearer: string): Promise<Client> {
  const transport = new StreamableHTTPClientTransport(new URL(SERVER_URL), {
    requestInit: { headers: { Authorization: `Bearer ${bearer}` } },
  });
  const client = new Client({ name: "wheredoigokeerthan", version: "0.1.0" });
  await client.connect(transport);
  return client;
}

function clientFor(bearer: string): Promise<Client> {
  if (!cached || cached.token !== bearer) {
    cached = { token: bearer, client: connect(bearer) };
  }
  return cached.client;
}

function isAuthFailure(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return /\b401\b|unauthoriz|invalid[_ ]token|forbidden/i.test(message);
}

type ToolContent = { type?: string; text?: string };
type ToolResult = { isError?: boolean; structuredContent?: unknown; content?: ToolContent[] };

// Both halves of a Swiggy answer. Which half carries the payload is a property
// of the TOOL, not of success or failure — see unwrapReply.
export type SwiggyReply<T> = { data: T | null; text: string };

function textOf(result: ToolResult): string {
  const parts = Array.isArray(result.content) ? result.content : [];
  return parts
    .filter((p) => p?.type === "text" && typeof p.text === "string")
    .map((p) => p.text as string)
    .join("\n")
    .trim();
}

const isFilledRecord = (v: unknown): boolean =>
  typeof v === "object" && v !== null && !Array.isArray(v) && Object.keys(v).length > 0;

// Swiggy fills exactly ONE of the two envelopes, and which one depends on the
// tool — verified live against mcp.swiggy.com/dineout, not inferred:
//
//   structuredContent  render_restaurants_dineout, get_restaurant_details,
//                      get_saved_locations, get_available_slots (when slots exist)
//   text block         search_restaurants_dineout, get_available_slots (when none)
//
// The text-block tools still SEND `structuredContent` — as `{}`. An empty
// object, not an absent one. So "is structuredContent defined?" is the wrong
// question: `{}` is defined and carries nothing, and taking it is what silently
// emptied the deck. Treat an empty object as absent and hand the caller both
// halves, so each tool binding reads the envelope Swiggy actually filled.
export function unwrapReply<T>(raw: unknown): SwiggyReply<T> {
  const result = (raw ?? {}) as ToolResult;
  const text = textOf(result);

  // Tool-level failures come back as isError + the reason as prose.
  if (result.isError) throw new Error(text || "swiggy_tool_error");

  if (isFilledRecord(result.structuredContent)) {
    return { data: result.structuredContent as T, text };
  }
  // Some MCP servers stuff JSON into the text block instead. Swiggy's prose
  // never starts with a brace, so this can't misfire on a prose answer.
  if (text.startsWith("{") || text.startsWith("[")) {
    try {
      return { data: JSON.parse(text) as T, text };
    } catch {
      // Not JSON after all — fall through and let the caller read the prose.
    }
  }
  return { data: null, text };
}

async function callOnce(bearer: string, name: string, args: Record<string, unknown>) {
  const client = await clientFor(bearer);
  return client.callTool({ name, arguments: args });
}

// Both envelopes, for the bindings that need to read Swiggy's prose.
export async function callSwiggyReply<T>(
  name: string,
  args: Record<string, unknown>
): Promise<SwiggyReply<T>> {
  const bearer = token();
  if (!bearer) throw new Error("swiggy_not_configured");

  try {
    return unwrapReply<T>(await callOnce(bearer, name, args));
  } catch (err) {
    // Drop the session either way: a 401 invalidates it, and a transport error
    // usually means the server expired a session this instance still holds.
    cached = null;
    if (isAuthFailure(err)) throw new SwiggyAuthError();
    try {
      return unwrapReply<T>(await callOnce(bearer, name, args));
    } catch (retryErr) {
      cached = null;
      if (isAuthFailure(retryErr)) throw new SwiggyAuthError();
      throw retryErr;
    }
  }
}

// Structured-or-throw, for the tools that genuinely do fill structuredContent.
// A prose answer here means Swiggy changed shape under us — and quietly
// returning an empty object on that is exactly what emptied the deck, so this
// fails loudly instead, carrying Swiggy's own words into the error.
export async function callSwiggyTool<T>(
  name: string,
  args: Record<string, unknown>
): Promise<T> {
  const { data, text } = await callSwiggyReply<T>(name, args);
  if (data === null) {
    throw new Error(text ? `swiggy_unstructured_result: ${text.slice(0, 160)}` : "swiggy_empty_result");
  }
  return data;
}
