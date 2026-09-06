import { put } from "@vercel/blob";
import { crossOrigin, forbidden, unauthorized, ownerFrom, ownerTag, logEvent } from "@/lib/api-guard";
import { rateLimit, clientIp, tooMany } from "@/lib/ratelimit";
import { LIMITS, photoQuota, recordPhoto } from "@/lib/quota";

// Photo bytes for cross-device sync. The Blob store is PRIVATE, so bytes are
// never publicly reachable — uploads and reads both go through here, gated by
// the same passphrase bearer as /api/sync. Blobs are pathed `<owner>/<photoId>`
// so a caller can only touch its own owner's photos.
//
// Uploads are the expensive direction — they are the only route in the app that
// writes bytes Keerthan is billed to store, and they used to have no size cap,
// no per-owner ceiling and no throttle. All three are here now; see lib/quota.

const TOKEN = process.env.BLOB_READ_WRITE_TOKEN;

// Deliberately tighter than sync's: a person adding photos to places does so a
// handful at a time, and each one costs storage that does not get released.
const UPLOAD = { limit: 120, windowSec: 3600 };
const READ = { limit: 600, windowSec: 3600 };

// POST { id, dataUrl:"data:<type>;base64,<...>" } → { url }
export async function POST(request: Request) {
  if (crossOrigin(request)) return forbidden();
  if (!TOKEN) return Response.json({ error: "blob_disabled" }, { status: 503 });

  const own = ownerFrom(request);
  if (!own) return unauthorized();

  const limited = await rateLimit(`photo:up:${clientIp(request)}`, UPLOAD.limit, UPLOAD.windowSec);
  if (!limited.ok) {
    logEvent("photo", "rate_limited", { owner: ownerTag(own), count: limited.count, limit: limited.limit });
    return tooMany();
  }

  // base64 inflates by 4/3, so the encoded body is bigger than the stored image.
  // Checking the declared length first keeps an oversized upload from being
  // buffered and decoded before it is rejected.
  const declared = Number(request.headers.get("content-length") ?? 0);
  if (declared > Math.ceil(LIMITS.photoBytes * 1.4)) {
    logEvent("photo", "body_too_large", { owner: ownerTag(own), bytes: declared });
    return Response.json({ error: "photo_too_large", limit: LIMITS.photoBytes }, { status: 413 });
  }

  let body: { id?: string; dataUrl?: string };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "bad_request" }, { status: 400 });
  }
  const id = body.id ?? "";
  const m = /^data:([^;,]+);base64,(.+)$/.exec(body.dataUrl ?? "");
  if (!/^[A-Za-z0-9._-]+$/.test(id) || !m) return Response.json({ error: "bad_request" }, { status: 400 });

  // Only real image types get stored. Without this the route would happily hold
  // arbitrary bytes under an image content-type of the caller's choosing.
  if (!/^image\/(jpeg|png|webp|gif|heic|heif|avif)$/i.test(m[1])) {
    logEvent("photo", "bad_type", { owner: ownerTag(own), type: m[1].slice(0, 40) });
    return Response.json({ error: "bad_type" }, { status: 415 });
  }

  const bytes = Buffer.from(m[2], "base64");
  if (bytes.byteLength > LIMITS.photoBytes) {
    logEvent("photo", "too_large", { owner: ownerTag(own), bytes: bytes.byteLength });
    return Response.json({ error: "photo_too_large", limit: LIMITS.photoBytes }, { status: 413 });
  }

  try {
    const quota = await photoQuota(own, id, bytes.byteLength);
    if (!quota.ok) {
      logEvent("photo", "quota_bytes", { owner: ownerTag(own), used: quota.used, limit: quota.limit });
      return Response.json({ error: "quota_exceeded", used: quota.used, limit: quota.limit }, { status: 507 });
    }

    const res = await put(`${own}/${id}`, bytes, {
      access: "private",
      token: TOKEN,
      contentType: m[1],
      addRandomSuffix: false, // deterministic path → re-upload overwrites, idempotent
    });

    // Accounting comes after the write lands, so a failed upload never eats
    // quota — and it gets its OWN catch, because the bytes are already stored
    // and billed by this point. Failing the request here would tell the client
    // the upload failed, leave blobUrl unset, and make it re-upload the same
    // photo on every future sync. Under-counting by one photo is the cheaper
    // wrong answer, and the log line is how it gets noticed.
    try {
      await recordPhoto(own, id, bytes.byteLength);
    } catch (err) {
      logEvent("photo", "usage_write_failed", { owner: ownerTag(own), bytes: bytes.byteLength, err: String(err).slice(0, 120) });
    }

    logEvent("photo", "stored", { owner: ownerTag(own), bytes: bytes.byteLength });
    return Response.json({ url: res.url });
  } catch {
    logEvent("photo", "upload_failed", { owner: ownerTag(own) });
    return Response.json({ error: "upload_failed" }, { status: 500 });
  }
}

// GET ?url=<blobUrl> → the photo bytes (proxied; caller must own the path)
export async function GET(request: Request) {
  if (crossOrigin(request)) return forbidden();
  if (!TOKEN) return Response.json({ error: "blob_disabled" }, { status: 503 });

  const own = ownerFrom(request);
  if (!own) return unauthorized();

  const limited = await rateLimit(`photo:get:${clientIp(request)}`, READ.limit, READ.windowSec);
  if (!limited.ok) return tooMany();

  const url = new URL(request.url).searchParams.get("url") ?? "";
  let target: URL;
  try {
    target = new URL(url);
  } catch {
    return Response.json({ error: "bad_request" }, { status: 400 });
  }

  // The HOST has to be checked before the path, and this is not a nicety.
  //
  // The line below sends BLOB_READ_WRITE_TOKEN as a bearer to whatever `url`
  // names. Without a host check, `?url=https://attacker.example/<your-own-key>/x`
  // satisfies the path test — the attacker writes the path — and the route
  // hands a token with read AND write access to the whole blob store straight
  // to their server. Any signed-in caller could do it, including a stranger
  // with a library of their own.
  if (target.protocol !== "https:" || !/(^|\.)blob\.vercel-storage\.com$/.test(target.hostname)) {
    logEvent("photo", "foreign_host", { owner: ownerTag(own), host: target.hostname.slice(0, 60) });
    return forbidden();
  }
  if (!target.pathname.startsWith(`/${own}/`)) return forbidden(); // only your own owner's blobs

  try {
    const r = await fetch(target, { headers: { Authorization: `Bearer ${TOKEN}` } });
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
