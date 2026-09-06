import { permanentRedirect } from "next/navigation";

// /go moved to / on 2026-09-06.
//
// This file stays because the /go link was already handed out, and a link
// someone else is holding is not ours to break. A 308 keeps every one of them
// working and tells caches the move is permanent.
//
// Do not delete this until those links have plausibly aged out.
export default function GoPage(): never {
  permanentRedirect("/");
}
