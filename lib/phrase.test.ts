import { describe, it, expect } from "vitest";
import { WORDS, PHRASE_WORDS, generatePhrase, normalizePhrase, phraseWeak } from "./phrase";

describe("wordlist", () => {
  // The entropy claim is 8 bits per word, and it is only true at exactly 256.
  // A 255th or 257th word would quietly make every "48 bits" comment a lie.
  it("is exactly 256 words", () => {
    expect(WORDS.length).toBe(256);
  });

  it("has no duplicates", () => {
    expect(new Set(WORDS).size).toBe(WORDS.length);
  });

  // Everything hashed is normalised first, so a word that does not survive
  // normalisation would generate a phrase that cannot be typed back in.
  it("survives its own normaliser", () => {
    for (const w of WORDS) expect(normalizePhrase(w)).toBe(w);
  });
});

describe("generatePhrase", () => {
  it("returns PHRASE_WORDS words, all from the list", () => {
    for (let i = 0; i < 50; i++) {
      const words = generatePhrase().split(" ");
      expect(words).toHaveLength(PHRASE_WORDS);
      for (const w of words) expect(WORDS).toContain(w);
    }
  });

  it("does not repeat itself", () => {
    const seen = new Set(Array.from({ length: 200 }, generatePhrase));
    expect(seen.size).toBe(200); // 48 bits — a collision in 200 draws would be a broken RNG
  });

  it("is already normalised", () => {
    for (let i = 0; i < 20; i++) {
      const p = generatePhrase();
      expect(normalizePhrase(p)).toBe(p);
    }
  });
});

describe("normalizePhrase", () => {
  // The whole point: someone reading six words off another phone's screen adds
  // capitals and stray spaces, and must still open the SAME library.
  it("folds case, trims, and collapses inner whitespace", () => {
    expect(normalizePhrase("  Amber   Pine\tTiger ")).toBe("amber pine tiger");
    expect(normalizePhrase("AMBER PINE")).toBe("amber pine");
  });

  it("is idempotent", () => {
    const once = normalizePhrase("  Amber   Pine ");
    expect(normalizePhrase(once)).toBe(once);
  });

  it("keeps distinct phrases distinct", () => {
    expect(normalizePhrase("amber pine")).not.toBe(normalizePhrase("amber pines"));
  });
});

describe("phraseWeak", () => {
  it("rejects what shipped as legal before", () => {
    expect(phraseWeak("cafe")).toBeTruthy(); // the old 4-character floor
    expect(phraseWeak("food")).toBeTruthy();
  });

  it("rejects too few distinct words", () => {
    expect(phraseWeak("amber amber amber amber")).toBeTruthy();
    expect(phraseWeak("averylongsinglewordphrase")).toBeTruthy();
  });

  it("accepts a generated phrase", () => {
    for (let i = 0; i < 20; i++) expect(phraseWeak(generatePhrase())).toBeNull();
  });

  it("accepts a reasonable hand-written phrase", () => {
    expect(phraseWeak("my favourite dosa place")).toBeNull();
  });

  it("judges the normalised form, not the raw input", () => {
    expect(phraseWeak("  Amber   Pine   Tiger  ")).toBeNull();
  });
});
