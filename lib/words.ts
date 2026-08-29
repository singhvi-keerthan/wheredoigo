// Whole-word matching against free text. One implementation, because two
// places need it and they must agree: the fallback parser reads the user's
// SENTENCE for vocabulary words (lib/decide-fallback.ts), and the facet layer
// reads a PLACE's own text for the same words (lib/facets.ts). If those two
// drifted, "no bars" could exclude a place that "bar" never matched.
//
// Vocabulary is matched on WORD BOUNDARIES, not raw substrings. Plain
// `includes` made "barbecue" match `bar`, "working" match `work`, and would
// have made "parking" match any value starting "park". A TRAILING PLURAL still
// counts as a hit, because "no bars" has to keep excluding `bar` — that phrase
// is the canonical example, and a naive \b…\b fix silently breaks it.

const WORD = /[\p{L}\p{N}]/u;

// Every index at which `needle` occurs as a whole word in `hay`.
// Both are expected lowercase; the caller normalises.
export function wordHits(hay: string, needle: string): number[] {
  const out: number[] = [];
  if (!needle) return out;
  for (let i = hay.indexOf(needle); i !== -1; i = hay.indexOf(needle, i + 1)) {
    if (i > 0 && WORD.test(hay[i - 1])) continue; // starts mid-word ("rebar")
    // A HYPHENATED PREFIX is part of the word, and it usually reverses it.
    // "non-vegetarian" is not "vegetarian" — the hyphen counts as a boundary,
    // so without this a steakhouse whose summary read "famous non-vegetarian
    // grills" was a confident match for a vegetarian ask. Same for "un-",
    // "anti-", "ex-". Only a hyphen preceded by a LETTER counts, so a phrase
    // that legitimately begins after punctuation or a dash still matches.
    if (i > 1 && hay[i - 1] === "-" && WORD.test(hay[i - 2])) continue;
    let end = i + needle.length;
    if (hay.slice(end, end + 2) === "es") end += 2; // "dosas" / "boxes"
    else if (hay[end] === "s") end += 1;
    if (end < hay.length && WORD.test(hay[end])) continue; // runs on ("barbecue")
    out.push(i);
  }
  return out;
}

// Does `hay` contain `phrase` as whole words? A multi-word phrase ("live
// music", "fine dining") is matched on its first and last word being present
// as a contiguous run, which the single indexOf already gives us — the phrase
// is searched verbatim and only its edges need the boundary check.
export function hasWord(hay: string, phrase: string): boolean {
  return wordHits(hay, phrase).length > 0;
}

// The word immediately before position `i`, or "" at the start.
function wordBefore(hay: string, i: number): string {
  const m = /([\p{L}\p{N}]+)[^\p{L}\p{N}]*$/u.exec(hay.slice(0, i));
  return m ? m[1] : "";
}

// Like hasWord, but an occurrence doesn't count when the word in front of it
// turns it into something else. A few of our vocabulary words are common
// SUFFIXES of unrelated compounds: a "salad bar" is not a bar, a "coffee bar"
// is a café, a "car park" is not a park. Word boundaries alone can't see that —
// the needle really is a whole word there — so the qualifier has to be read.
export function hasWordUnless(
  hay: string,
  phrase: string,
  cancellingPrefixes: readonly string[]
): boolean {
  const hits = wordHits(hay, phrase);
  if (!hits.length) return false;
  if (!cancellingPrefixes.length) return true;
  // One clean occurrence anywhere is enough; only ALL of them being qualified
  // away means the place never really claimed the word.
  return hits.some((i) => !cancellingPrefixes.includes(wordBefore(hay, i)));
}

// Any of them.
export function hasAnyWord(hay: string, phrases: readonly string[]): boolean {
  return phrases.some((p) => hasWord(hay, p));
}
