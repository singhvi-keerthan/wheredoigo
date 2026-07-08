import { put } from "@vercel/blob";
import { crossOrigin, forbidden } from "@/lib/api-guard";

// Photo bytes for cross-device sync. The Blob store is PRIVATE, so bytes are
// never publicly reachable — uploads and reads both go through here, gated by
// the same passphrase bearer as /api/sync. Blobs are pathed `<owner>/<photoId>`
// so a caller can only touch its own owner's photos.

const TOKEN = process.env.BLOB_READ_WRITE_TOKEN;

function owner(request: Request): string | null {
  const m = /^Bearer ([0-9a-f]{64})$/.exec(request.headers.get("authorization") ?? "");
  return m ? m[1] : null;
}

// POST { id, dataUrl:"data:<type>;base64,<...>" } → { url }
export async function POST(request: Request) {
  if (crossOrigin(request)) return forbidden();
  if (!TOKEN) return Response.json({ error: "blob_disabled" }, { status: 503 });
  const own = owner(request);
  if (!own) return Response.json({ error: "unauthorized" }, { status: 401 });

  let body: { id?: string; dataUrl?: string };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "bad_request" }, { status: 400 });
  }
  const id = body.id ?? "";
  const m = /^data:([^;,]+);base64,(.+)$/.exec(body.dataUrl ?? "");
  if (!/^[A-Za-z0-9._-]+$/.test(id) || !m) return Response.json({ error: "bad_request" }, { status: 400 });

  try {
    const res = await put(`${own}/${id}`, Buffer.from(m[2], "base64"), {
      access: "private",
      token: TOKEN,
      contentType: m[1],
      addRandomSuffix: false, // deterministic path → re-upload overwrites, idempotent
    });
    return Response.json({ url: res.url });
  } catch {
    return Response.json({ error: "upload_failed" }, { status: 500 });
  }
}

// GET ?url=<blobUrl> → the photo bytes (proxied; caller must own the path)
export async function GET(request: Request) {
  if (crossOrigin(request)) return forbidden();
  if (!TOKEN) return Response.json({ error: "blob_disabled" }, { status: 503 });
  const own = owner(request);
  if (!own) return Response.json({ error: "unauthorized" }, { status: 401 });

  const url = new URL(request.url).searchParams.get("url") ?? "";
  let path: string;
  try {
    path = new URL(url).pathname;
  } catch {
    return Response.json({ error: "bad_request" }, { status: 400 });
  }
  if (!path.startsWith(`/${own}/`)) return forbidden(); // can only read your own owner's blobs

  try {
    const r = await fetch(url, { headers: { Authorization: `Bearer ${TOKEN}` } });
    if (!r.ok) return Response.json({ error: "not_found" }, { status: r.status });
    return new Response(r.body, {
      headers: {
        "Content-Type": r.headers.get("content-type") ?? "application/octet-stream",
        "Cache-Control": "private, max-age=31536000, immutable",
      },
    });
  } catch {
    return Response.json({ error: "fetch_failed" }, { status: 500 });
  }
}
