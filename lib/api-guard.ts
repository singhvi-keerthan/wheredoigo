// Cheap same-origin gate for the API routes. The app's data is client-local;
// the only thing these routes expose is billed Google quota, so reject requests
// that carry a cross-site Origin/Referer. Requests without either header
// (same-origin GETs, PWA fetches) pass — this blocks casual abuse, not a
// determined attacker; the Google Cloud budget alert is the real backstop.
export function crossOrigin(request: Request): boolean {
  const host = request.headers.get("host");
  if (!host) return false;
  for (const header of ["origin", "referer"]) {
    const value = request.headers.get(header);
    if (!value) continue;
    try {
      if (new URL(value).host !== host) return true;
    } catch {
      return true; // malformed header — treat as foreign
    }
  }
  return false;
}

export function forbidden(): Response {
  return Response.json({ error: "forbidden" }, { status: 403 });
}
