import { TAG_OPTIONS } from "@/lib/types";

// Optional NL layer for Decide mode. Parses free text ("date night, something
// new, under 1500, open now") into a structured DecideQuery using Gemini with a
// constrained response schema. The rule-based engine in lib/decide.ts does the
// actual ranking — Gemini only translates intent into filters. Degrades to
// { error } so the client can fall back to keyword parsing.
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

  const vocab = [
    `type: ${TAG_OPTIONS.type.join(", ")}`,
    `cuisine: ${TAG_OPTIONS.cuisine.join(", ")}`,
    `occasion: ${TAG_OPTIONS.occasion.join(", ")}`,
    `vibe: ${TAG_OPTIONS.vibe.join(", ")}`,
    `practical: ${TAG_OPTIONS.practical.join(", ")}`,
  ].join("\n");

  const instruction = `You translate a person's "where should I go out tonight?" request into structured filters for picking a place from their saved list.
Only use values from this controlled vocabulary (omit a field if nothing fits):
${vocab}

lifecycle: "watchlist" if they want somewhere new/untried, "visited" if a place they've been, "favorites" if their go-to loved spots, else "any".
maxBudget: per-person rupee number if they mention a budget, else null.
openNow: true only if they imply it must be open right now.
intent: a 2-4 word human label for the mood.

Request: "${prompt}"`;

  const schema = {
    type: "OBJECT",
    properties: {
      intent: { type: "STRING" },
      lifecycle: { type: "STRING", enum: ["any", "watchlist", "visited", "favorites"] },
      types: { type: "ARRAY", items: { type: "STRING" } },
      cuisines: { type: "ARRAY", items: { type: "STRING" } },
      occasions: { type: "ARRAY", items: { type: "STRING" } },
      vibes: { type: "ARRAY", items: { type: "STRING" } },
      practical: { type: "ARRAY", items: { type: "STRING" } },
      maxBudget: { type: "INTEGER", nullable: true },
      openNow: { type: "BOOLEAN" },
    },
  };

  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${key}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: instruction }] }],
          generationConfig: {
            responseMimeType: "application/json",
            responseSchema: schema,
            temperature: 0.2,
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

    const query = JSON.parse(text);
    return Response.json({ query });
  } catch {
    return Response.json({ error: "fetch_failed" }, { status: 200 });
  }
}
