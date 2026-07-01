import { buildDecideInstruction, DECIDE_SCHEMA, sanitizeQuery } from "@/lib/decide-prompt";

// Optional NL layer for Decide mode. Parses free text ("date night, something
// new, under 1500, open now") into a structured DecideQuery using Gemini with a
// constrained response schema. The rule-based engine in lib/decide.ts does the
// actual ranking — Gemini only translates intent into filters. Degrades to
// { error } so the client can fall back to keyword parsing.
//
// Prompt, schema, and sanitizer live in lib/decide-prompt.ts so the eval harness
// (scripts/eval-decide.ts) exercises exactly what ships here.
export async function POST(request: Request) {
  const key = process.env.GOOGLE_GENERATIVE_AI_API_KEY;
  if (!key) return Response.json({ error: "no_key" }, { status: 200 });

  let prompt = "";
  try {
    prompt = (await request.json())?.prompt?.trim() ?? "";
  } catch {
    return Response.json({ error: "bad_request" }, { status: 400 });
  }
  if (!prompt) return Response.json({ error: "empty" }, { status: 200 });

  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${key}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: buildDecideInstruction(prompt) }] }],
          generationConfig: {
            responseMimeType: "application/json",
            responseSchema: DECIDE_SCHEMA,
            // Deterministic: a parser should map the same request the same way,
            // and it keeps the eval harness reproducible.
            temperature: 0,
          },
        }),
      }
    );

    if (!res.ok) {
      const detail = await res.text();
      return Response.json({ error: "gemini_error", status: res.status, detail }, { status: 200 });
    }

    const data = await res.json();
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) return Response.json({ error: "no_output" }, { status: 200 });

    // Sanitizer is the backstop even though the schema enforces enums.
    const query = sanitizeQuery(JSON.parse(text));
    return Response.json({ query });
  } catch {
    return Response.json({ error: "fetch_failed" }, { status: 200 });
  }
}
