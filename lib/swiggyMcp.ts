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

function textOf(result: ToolResult): string {
  const parts = Array.isArray(result.content) ? result.content : [];
  return parts
    .filter((p) => p?.type === "text" && typeof p.text === "string")
    .map((p) => p.text as string)
    .join("\n")
    .trim();
}

// MCP servers may answer with `structuredContent` or with JSON stuffed into a
// text block; Swiggy's docs show the payload shape but not which envelope, so
// accept both.
function unwrap<T>(raw: unknown): T {
  const result = (raw ?? {}) as ToolResult;
  if (result.isError) throw new Error(textOf(result) || "swiggy_tool_error");
  if (result.structuredContent !== undefined) return result.structuredContent as T;

  const text = textOf(result);
  if (!text) throw new Error("swiggy_empty_result");
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error("swiggy_unparsable_result");
  }
}

async function callOnce(bearer: string, name: string, args: Record<string, unknown>) {
  const client = await clientFor(bearer);
  return client.callTool({ name, arguments: args });
}

export async function callSwiggyTool<T>(
  name: string,
  args: Record<string, unknown>
): Promise<T> {
  const bearer = token();
  if (!bearer) throw new Error("swiggy_not_configured");

  try {
    return unwrap<T>(await callOnce(bearer, name, args));
  } catch (err) {
    // Drop the session either way: a 401 invalidates it, and a transport error
    // usually means the server expired a session this instance still holds.
    cached = null;
    if (isAuthFailure(err)) throw new SwiggyAuthError();
    try {
      return unwrap<T>(await callOnce(bearer, name, args));
    } catch (retryErr) {
      cached = null;
      if (isAuthFailure(retryErr)) throw new SwiggyAuthError();
      throw retryErr;
    }
  }
}
