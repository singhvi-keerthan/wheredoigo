import type { Place, TagNamespace } from "./types";
import { tagsFromGoogleTypes } from "./googleTags";
import { hasWordUnless } from "./words";

// ---------------------------------------------------------------------------
// What do we actually KNOW about a place?
//
// The map used to answer "is this an italian place?" by looking at one thing:
// the `cuisine` tags on the record. That is a fine question and a terrible
// single source, because of who fills those tags in. `type` is dense (93 Google
// types map onto it) but `cuisine` covered 6 of 10 values, `staple` 5 of 14,
// `practical` 2 of 7, and `occasion` and `vibe` had NO automatic source at all —
// they are hand-set, and almost nothing is hand-set.
//
// So the gate was asking a question the data could not answer, and reading
// "no tag" as "no". Ask for "somewhere romantic" over a library tagged purely
// from Google and every place answered no: five places in, zero out.
//
// This module separates the two things that were conflated:
//
//   true   we have positive evidence this place matches
//   false  we have a filled-in tag set for this namespace and it says otherwise
//   null   we know nothing either way
//
// `null` is the one that was missing. Absence of evidence is not evidence of
// absence, and a filter that treats it as such deletes your whole map.
//
// Evidence comes from three places, widest first:
//   1. the tags on the record (the user's own, plus whatever was derived at save)
//   2. tags re-derived from Google's raw `types` (covers records saved before a
//      mapping existed — backfill without a migration)
//   3. the place's own words: its name, Google's editorial summary, your notes
//
// Only 1 and 2 can produce `false`. Text can say "this IS cozy"; it cannot say
// "this is NOT rooftop", because a summary that doesn't mention the roof is
// silent, not negative.
// ---------------------------------------------------------------------------

export type Verdict = true | false | null;

// Words that would appear in a place's NAME, Google's summary, or your notes if
// it carried this tag value. Deliberately concrete: a phrase earns its place
// only if seeing it really does imply the value.
//
// Matched as whole words (lib/words.ts), so "bar" does not fire on "barbecue"
// and "work" does not fire on "artwork". Trailing plurals count, so "tacos"
// finds `tacos` and "momos" finds `momos`.
const PHRASES: Record<TagNamespace, Record<string, readonly string[]>> = {
  type: {
    restaurant: ["restaurant", "eatery", "dining room", "bistro"],
    "café": ["cafe", "café", "coffee", "espresso", "roastery", "tea room", "coffee shop"],
    bar: ["bar", "pub", "brewery", "brewpub", "taproom", "tavern", "cocktail", "nightclub", "lounge"],
    dessert: ["dessert", "bakery", "patisserie", "ice cream", "gelato", "creamery", "chocolaterie"],
    "street-food": ["street food", "chaat", "food court", "food truck", "stall"],
    museum: ["museum", "gallery", "planetarium", "exhibition"],
    landmark: ["temple", "fort", "palace", "monument", "church", "mosque", "cathedral", "memorial", "heritage site"],
    viewpoint: ["viewpoint", "lookout", "observation deck", "panoramic view", "sunset point"],
    "park-garden": ["park", "garden", "botanical", "lake"],
    activity: ["bowling", "go-karting", "karting", "arcade", "escape room", "trampoline", "paintball", "climbing gym"],
    theatre: ["theatre", "cinema", "multiplex", "playhouse", "auditorium"],
    shopping: ["mall", "bazaar", "boutique", "shopping centre", "flea market"],
  },
  cuisine: {
    italian: ["italian", "pizzeria", "trattoria", "osteria"],
    // The dish words matter more here than anywhere else in this table: Google
    // labels most of these places `indian_restaurant` with no region, which is
    // deliberately unmapped (see googleTags.ts), so their own words are the
    // only thing that can identify them.
    "south-indian": [
      "south indian", "udupi", "andhra", "chettinad", "mangalorean", "kerala",
      "idli", "sambar", "dosa", "vada", "filter coffee", "benne", "uttapam",
    ],
    "north-indian": ["north indian", "punjabi", "tandoor", "dhaba", "awadhi"],
    japanese: ["japanese", "izakaya", "teppanyaki", "yakitori"],
    chinese: ["chinese", "sichuan", "szechuan", "cantonese", "dim sum", "hakka"],
    thai: ["thai"],
    mexican: ["mexican", "taqueria", "cantina"],
    continental: ["continental", "european", "french"],
    korean: ["korean", "kimchi"],
    mughlai: ["mughlai", "kebab", "lucknowi", "tandoori"],
  },
  staple: {
    pizza: ["pizza"],
    pasta: ["pasta", "spaghetti", "lasagne", "lasagna"],
    burger: ["burger"],
    burrito: ["burrito"],
    tacos: ["taco"],
    dosa: ["dosa"],
    biryani: ["biryani", "biriyani", "dum biryani"],
    ramen: ["ramen"],
    sushi: ["sushi", "sashimi", "maki"],
    noodles: ["noodle", "hakka noodles", "chow mein"],
    sandwich: ["sandwich", "panini"],
    momos: ["momo", "dumpling"],
    wings: ["wings", "chicken wings"],
    shawarma: ["shawarma"],
  },
  occasion: {
    // Not bare "date" — "up to date" is not a date night.
    date: ["date night", "romantic", "couples", "candlelit"],
    family: ["family", "kid friendly", "kids", "children"],
    friends: ["friends", "hangout", "catch up", "group outing"],
    solo: ["solo", "counter seating", "bar seating"],
    work: ["work", "laptop", "wifi", "co-working", "meeting"],
    celebration: ["celebration", "birthday", "anniversary", "party", "banquet"],
  },
  vibe: {
    quiet: ["quiet", "calm", "peaceful", "serene", "laid back", "laid-back"],
    lively: ["lively", "buzzing", "vibrant", "energetic", "bustling", "live music"],
    romantic: ["romantic", "intimate", "candlelit", "date night"],
    outdoor: ["outdoor", "alfresco", "al fresco", "patio", "terrace", "open air", "courtyard"],
    instagrammable: ["instagrammable", "photogenic", "aesthetic", "quirky decor", "mural"],
    cozy: ["cozy", "cosy", "snug", "homely", "charming", "warm interiors"],
    // Bare "terrace" is deliberately absent — a ground-floor terrace is not a
    // rooftop, and with it here "a leafy ground-floor terrace" was a confident
    // rooftop match (and an excludeVibes:rooftop dropped it).
    rooftop: ["rooftop", "roof top", "roof terrace", "rooftop terrace", "sky bar", "skyline"],
    "fine-dining": ["fine dining", "fine-dining", "upscale", "michelin", "degustation", "tasting menu", "haute"],
  },
  practical: {
    groups: ["groups", "large parties", "banquet", "private dining"],
    vegetarian: ["vegetarian", "pure veg", "satvik", "jain food"],
    "vegan-options": ["vegan"],
    "reservation-needed": ["reservation", "reservations", "booking required"],
    "pet-friendly": ["pet friendly", "pet-friendly", "dog friendly", "dog-friendly"],
    "late-night": ["late night", "late-night", "open late", "till late", "midnight"],
    parking: ["parking", "valet"],
  },
};

// Words in the table above that are also the tail of an unrelated compound.
// Without these, a cafe whose summary mentions "a salad bar" was a CONFIDENT
// match for an ask about bars, and a listing that mentions "car park" claimed
// to be a park. Keyed by the phrase, not the value, because it is the phrase
// that is ambiguous.
const CANCELLING_PREFIXES: Record<string, readonly string[]> = {
  bar: ["salad", "coffee", "juice", "sushi", "oyster", "snack", "tea", "milk", "espresso", "sandwich", "dessert", "breakfast", "chocolate"],
  park: ["car", "theme", "amusement", "water", "tech", "business"],
  gallery: ["shooting"],
  kids: ["no"],
};

const norm = (s: string) => s.toLowerCase();

// One lowercase haystack per place, built from everything it says about itself.
// Google's editorial summary is the richest of the three and the only one that
// is there without anyone typing it, which is exactly why vibe and occasion —
// the two namespaces nothing else can fill — lean on it.
function textOf(p: Place): string {
  return norm(`${p.name} ${p.summary ?? ""} ${p.notes ?? ""}`);
}

// Every tag value the record carries for a namespace, including the ones
// Google's raw types imply. Re-derived rather than trusted from `tags` alone so
// a place saved before a mapping existed picks it up on read — the widened
// cuisine/staple/vibe table in googleTags.ts reaches old records this way,
// with no migration and no write.
export function knownValues(p: Place, ns: TagNamespace): Set<string> {
  const out = new Set<string>();
  for (const t of p.tags) if (t.namespace === ns) out.add(t.value);
  for (const t of tagsFromGoogleTypes(p.googleTypes)) if (t.namespace === ns) out.add(t.value);
  return out;
}

// Does the place's own text claim this value?
function textSays(hay: string, ns: TagNamespace, value: string): boolean {
  const phrases = PHRASES[ns]?.[value];
  if (!phrases?.length) return false;
  return phrases.some((phrase) => hasWordUnless(hay, phrase, CANCELLING_PREFIXES[phrase] ?? []));
}

// Which of the asked values this place actually answers to, if any. Separate
// from the verdict because the ranker needs to NAME the match ("Good for
// korean"), and naming the first thing asked for is how a place matched on
// "kimchi and bibimbap" came to be reported as "Good for japanese".
export function matchedValue(
  p: Place,
  ns: TagNamespace,
  wanted: readonly string[]
): string | null {
  if (!wanted.length) return null;
  const known = knownValues(p, ns);
  const tagged = wanted.find((w) => known.has(w));
  if (tagged) return tagged;
  const hay = textOf(p);
  return wanted.find((w) => textSays(hay, ns, w)) ?? null;
}

// The verdict for one namespace against the values an ask named.
export function facetVerdict(p: Place, ns: TagNamespace, wanted: readonly string[]): Verdict {
  if (!wanted.length) return null; // not asked for → not a constraint
  if (matchedValue(p, ns, wanted) !== null) return true;
  // A filled-in tag set that doesn't include what was asked is a real "no".
  // An empty one is silence.
  return knownValues(p, ns).size > 0 ? false : null;
}

// Hard negatives. Same evidence, opposite question: does the place carry
// anything the ask said to avoid?
//
// TAGS ONLY — deliberately narrower than facetVerdict, and the asymmetry is the
// point. A text hit is good enough to SURFACE a place (a wrong extra pin costs
// you a glance) and nowhere near good enough to DELETE one. Letting text drop
// places was measurably wrong in three different ways: "an all-day salad bar"
// was excluded by "no bars" — this module's own canonical example, inverted;
// "free wifi" made a café an excluded `work` place; and "non-vegetarian"
// matched `vegetarian` before words.ts learned about hyphenated prefixes.
//
// A phrase table precise enough to hide things would have to be much better
// than this one, so the rule is simply: text may confirm, never delete.
export function carriesAny(p: Place, ns: TagNamespace, avoid: readonly string[]): boolean {
  if (!avoid.length) return false;
  const known = knownValues(p, ns);
  return avoid.some((a) => known.has(a));
}

// How well a place answers the whole ask across every namespace it named.
// `matched` counts confident yeses, `contradicted` counts real noes, and
// anything else is silence. rankPlaces turns this into score; the map turns it
// into membership.
export interface FacetScore {
  matched: number;
  contradicted: number;
  asked: number;
}

const NS_ORDER: TagNamespace[] = ["type", "cuisine", "staple", "occasion", "vibe", "practical"];

export function scoreFacets(
  p: Place,
  wantedBy: Partial<Record<TagNamespace, readonly string[]>>
): FacetScore {
  let matched = 0;
  let contradicted = 0;
  let asked = 0;
  for (const ns of NS_ORDER) {
    const want = wantedBy[ns];
    if (!want?.length) continue;
    asked++;
    const v = facetVerdict(p, ns, want);
    if (v === true) matched++;
    else if (v === false) contradicted++;
  }
  return { matched, contradicted, asked };
}
