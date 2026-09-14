import { describe, it, expect } from "vitest";
import { refill, takeLocalToken } from "./ratelimit";

// The bucket's arithmetic, which the Neon statement and the in-process
// fallback share. Swiggy's rule: 70 a minute, a 10-second burst of 2x the
// steady rate (~23); ours sits under it at 1 a second from a bucket of 10.
const o = { rate: 1, capacity: 10 };

describe("token bucket", () => {
  it("never admits more than the bucket plus ten seconds of refill in any ten seconds", () => {
    // The adversary: drain the bucket, then hammer once a millisecond. Swiggy's
    // ten-second window allows ~23; this must stay at 20.
    const b = `window-${Math.random()}`;
    const t0 = 1_000_000;
    let admitted = 0;
    for (let ms = 0; ms < 10_000; ms += 1) if (takeLocalToken(b, o, t0 + ms).ok) admitted++;
    // Ten from the bucket, then one a second — the tenth refill lands at the
    // window's own edge, so nineteen inside it.
    expect(admitted).toBe(19);
    expect(admitted).toBeLessThanOrEqual(20);
    // And the minute holds at the rate: sixty more seconds admit sixty more.
    let minute = 0;
    for (let ms = 10_000; ms < 70_000; ms += 1) if (takeLocalToken(b, o, t0 + ms).ok) minute++;
    expect(minute).toBe(60);
  });

  it("lets a burst spend the capacity and not one more", () => {
    const b = `burst-${Math.random()}`;
    const t0 = 1_000_000;
    for (let i = 0; i < 10; i++) expect(takeLocalToken(b, o, t0).ok).toBe(true);
    const refused = takeLocalToken(b, o, t0);
    expect(refused.ok).toBe(false);
    expect(refused.retryAfterSec).toBe(1);
  });

  it("refills at the rate, so sixty in a minute is the ceiling however the minute is drawn", () => {
    const b = `rate-${Math.random()}`;
    const t0 = 1_000_000;
    for (let i = 0; i < 10; i++) takeLocalToken(b, o, t0);
    expect(takeLocalToken(b, o, t0 + 500).ok).toBe(false); // half a token is not a token
    expect(takeLocalToken(b, o, t0 + 1000).ok).toBe(true);
    expect(takeLocalToken(b, o, t0 + 1000).ok).toBe(false);
    // Forty seconds of idling refills forty, capped at the capacity.
    expect(refill(0, 40, o)).toBe(10);
  });

  it("names the wait to the next whole token", () => {
    const b = `wait-${Math.random()}`;
    const t0 = 1_000_000;
    for (let i = 0; i < 10; i++) takeLocalToken(b, o, t0);
    takeLocalToken(b, o, t0 + 200); // 0.2 of a token back
    expect(takeLocalToken(b, o, t0 + 200).retryAfterSec).toBe(1);
  });
});
