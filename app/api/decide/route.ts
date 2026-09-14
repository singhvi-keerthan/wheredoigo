import Anthropic from "@anthropic-ai/sdk";
import { buildDecideInstruction, DECIDE_SCHEMA, sanitizeQuery } from "@/lib/decide-prompt";
import { after } from "next/server";
import { crossOrigin, forbidden } from "@/lib/api-guard";
import { logAsk } from "@/lib/askLog";

// The NL layer for Ask. Parses free text ("date night, something new, under
// 1500, open now") into a structured DecideQuery using Claude with a constrained
// output schema. The rule-based engine in lib/decide.ts does the actual ranking —
// the model only translates intent into filters.
//
// Ran on Gemini until 2026-08-30. That key was removed and the project's
// generative-AI credits were exhausted, which the old route reported as a
// harmless `{ error }` — so every ask silently fell through to the keyword
// parser in lib/decide-fallback.ts and nothing said so. Two things changed with
// the move: the transport, and the honesty. `parsedBy` now travels with every
// answer so the client can tell you it is running on basic matching.
//
// Prompt, schema, and sanitizer live in lib/decide-prompt.ts so the eval harness
// (scripts/eval-decide.ts) exercises exactly what ships here.

export const runtime = "nodejs";

// One client per warm lambda, RE-KEYED when the key changes — the same rule
// lib/swiggyMcp.ts uses for its token. Caching on nothing meant a rotated key
// kept serving through the old client until the instance recycled.
let client: Anthropic | null = null;
let clientKey: string | null = null;
function anthropic(key: string): Anthropic {
  if (!client || clientKey !== key) {
    client = new Anthropic({ apiKey: key });
    clientKey = key;
  }
  return client;
}

export async function POST(request: Request) {
  if (crossOrigin(request)) return forbidden();

  let prompt = "";
  try {
    prompt = (await request.json())?.prompt?.trim() ?? "";
  } catch {
    return Response.json({ error: "bad_request" }, { status: 400 });
  }
  if (!prompt) return Response.json({ error: "empty" }, { status: 200 });

  // Every answer leaves one row in the ask log (lib/askLog.ts): the prompt and
  // what became of it, so a bad deck can be read back from what was asked.
  // Written after the response is out — after() keeps the function alive for
  // it — so the log costs the ask nothing.
  const t0 = Date.now();
  const answer = (body: Record<string, unknown>, log: { parsedBy: string; query?: unknown; error?: string }) => {
    after(() => logAsk({ route: "decide", prompt, ms: Date.now() - t0, ...log }));
    return Response.json(body, { status: 200 });
  };

  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return answer({ error: "no_key" }, { parsedBy: "error", error: "no_key" });

  try {
    const message = await anthropic(key).messages.create({
      // Translating one sentence into a fixed vocabulary under a constrained
      // schema is shallow extraction, which is what this tier is for — and it
      // runs on every single ask, so the per-call cost is the whole cost.
      //
      // Two things follow from it being a pre-4.6 model, and both are easy to
      // get wrong: `output_config.effort` is REJECTED here (it is Opus-4.5+
      // only), so only `format` goes in output_config; and sampling params are
      // still allowed, so temperature comes back. A parser should map the same
      // sentence the same way every time — that determinism is what the
      // original Gemini binding had and what keeps the eval reproducible.
      model: "claude-haiku-4-5",
      max_tokens: 4096, // a ceiling, not a target: the answer is one small object
      temperature: 0,
      output_config: { format: { type: "json_schema", schema: DECIDE_SCHEMA } },
      messages: [{ role: "user", content: buildDecideInstruction(prompt) }],
    });

    if (message.stop_reason === "refusal") {
      return answer({ error: "refused" }, { parsedBy: "error", error: "refused" });
    }
    // A too-small ceiling truncates the JSON body. Caught here it names itself;
    // left to JSON.parse it surfaced as a generic "parse failed" and pointed at
    // the wrong thing.
    if (message.stop_reason === "max_tokens") {
      console.error("[ask] hit max_tokens before finishing the JSON");
      return answer({ error: "truncated" }, { parsedBy: "error", error: "truncated" });
    }

    const text = message.content.find((b) => b.type === "text")?.text;
    if (!text) return answer({ error: "no_output" }, { parsedBy: "error", error: "no_output" });

    // Sanitizer is the backstop even though the schema enforces enums.
    const query = sanitizeQuery(JSON.parse(text));
    return answer({ query, parsedBy: "model" }, { parsedBy: "model", query });
  } catch (err) {
    // Every failure here is the same story for the caller — it has to fall back
    // to keyword parsing — but they are very different stories for whoever has
    // to fix it, so they are named and logged rather than flattened into one.
    if (err instanceof Anthropic.AuthenticationError) {
      console.error("[ask] ANTHROPIC_API_KEY rejected");
      return answer({ error: "bad_key" }, { parsedBy: "error", error: "bad_key" });
    }
    if (err instanceof Anthropic.RateLimitError) {
      console.warn("[ask] rate limited");
      return answer({ error: "rate_limited" }, { parsedBy: "error", error: "rate_limited" });
    }
    if (err instanceof Anthropic.APIError) {
      console.error(`[ask] model error ${err.status}: ${err.message}`);
      return answer({ error: "model_error", status: err.status }, { parsedBy: "error", error: `model_error ${err.status}` });
    }
    console.error("[ask] parse failed", err);
    return answer({ error: "fetch_failed" }, { parsedBy: "error", error: err instanceof Error ? err.message : "fetch_failed" });
  }
}
