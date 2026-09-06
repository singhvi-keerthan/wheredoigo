// The sync phrase — generated, not invented.
//
// The old flow asked you to think one up behind a password field with a
// 4-character floor. Three things were wrong with that and all three are the
// same bug wearing different clothes: the phrase is not a password, it is the
// ONLY key to the library, and the app treated it like a login.
//
//   1. "cafe" was a legal phrase. sha256 of it is one dictionary lookup, and
//      /api/sync hands the whole library to whoever presents the hash.
//   2. type="password" hid what you typed, on a phone, for a string you must
//      retype exactly on another device.
//   3. A typo did not fail. It silently selected an EMPTY namespace and then
//      pushed your library into it — and if the typo collided with someone
//      else's phrase, into theirs.
//
// So: the app generates six words from a fixed 256-word list (8 bits each, 48
// bits total), shows them in plain text, and the connect flow tells you what
// the phrase actually opens before it commits. Nothing here is secret from the
// person holding the device — it is a recovery phrase, and it is meant to be
// written down.
//
// NOT a KDF change. `hashPassphrase` stays sha256 because that hash IS the
// stored owner key: every existing row, and PUBLIC_OWNER_HASH, are keyed to it.
// Swapping in PBKDF2 would orphan every library that exists today. Entropy at
// the source is what makes the plain hash safe, and generated phrases put it
// there; a typed-in phrase gets checked against `phraseWeak` instead.

// 256 words: 3-9 letters, common, no homophones, no plurals, nothing that
// sounds like another entry when read aloud down a phone line. Order is frozen
// — a phrase is only reproducible if this list never gets reordered. Append-only
// is also forbidden: 256 is the entropy claim, so a 257th word breaks the math.
export const WORDS: readonly string[] = [
  "amber", "anchor", "apple", "arch", "arrow", "atlas", "autumn", "axis",
  "badge", "bamboo", "banjo", "barn", "basil", "beach", "beacon", "bean",
  "bell", "bench", "berry", "birch", "bison", "blade", "bloom", "board",
  "bolt", "bonus", "book", "boot", "brass", "bread", "brick", "bridge",
  "brook", "brush", "bubble", "bucket", "bulb", "bunny", "cabin", "cable",
  "cactus", "camel", "candle", "canoe", "canvas", "canyon", "cargo", "carpet",
  "castle", "cedar", "chair", "chalk", "cherry", "chess", "chili", "cider",
  "circle", "cliff", "cloud", "clover", "coast", "cocoa", "coffee", "coin",
  "comet", "copper", "coral", "cotton", "crane", "crayon", "creek", "crown",
  "crystal", "cube", "curry", "dahlia", "daisy", "dance", "dawn", "deck",
  "delta", "denim", "desert", "diary", "dime", "dinner", "dolphin", "domino",
  "donut", "dragon", "dream", "drum", "dune", "eagle", "east", "echo",
  "eclipse", "elbow", "ember", "engine", "envoy", "fable", "falcon", "fang",
  "feather", "fennel", "fern", "ferry", "fiber", "fiddle", "field", "fig",
  "finch", "flame", "flint", "float", "flute", "forest", "fossil", "fox",
  "frost", "garden", "garlic", "gate", "gecko", "ginger", "glacier", "glass",
  "globe", "glove", "grape", "gravel", "grove", "guitar", "gulf", "hammer",
  "harbor", "harvest", "hawk", "hazel", "heron", "hill", "hollow", "honey",
  "horizon", "ice", "indigo", "ink", "iris", "iron", "island", "ivory",
  "jacket", "jade", "jasmine", "jelly", "jungle", "juniper", "kayak", "kettle",
  "key", "kiwi", "lagoon", "lamp", "lantern", "lark", "laurel", "lemon",
  "lentil", "lily", "linen", "lion", "lotus", "lunar", "lychee", "magnet",
  "mango", "maple", "marble", "marsh", "meadow", "melon", "mesa", "meteor",
  "mint", "mirror", "monsoon", "moss", "moth", "mountain", "mulberry", "nectar",
  "needle", "nest", "noodle", "north", "nutmeg", "oak", "oasis", "ocean",
  "olive", "onion", "opal", "orbit", "orchid", "otter", "oyster", "paddle",
  "palm", "papaya", "parrot", "pastel", "peach", "pearl", "pebble", "pepper",
  "petal", "piano", "pigeon", "pilot", "pine", "pistachio", "planet", "plum",
  "pocket", "pollen", "pond", "poppy", "prairie", "prism", "puzzle", "quartz",
  "quiver", "rabbit", "radish", "rain", "raven", "reef", "ribbon", "river",
  "robin", "rocket", "rose", "rubber", "ruby", "saffron", "sage", "sail",
  "salmon", "sand", "sapphire", "satin", "seed", "shadow", "shell", "silk",
];

export const PHRASE_WORDS = 6; // 6 x 8 bits = 48 bits of entropy

// Cryptographic randomness only. Math.random() is seeded from a clock a
// stranger can narrow to the second, which would make a "generated" phrase
// weaker than a typed one — the exact opposite of the point.
//
// Rejection sampling, not `% WORDS.length`: 256 divides 256 evenly today, but
// the modulo would silently skew the distribution if the list ever changed size,
// and a skewed wordlist is an entropy claim that quietly stops being true.
function pickWord(): string {
  const n = WORDS.length;
  const limit = Math.floor(256 / n) * n; // largest byte value that maps evenly
  const buf = new Uint8Array(1);
  for (;;) {
    crypto.getRandomValues(buf);
    if (buf[0] < limit) return WORDS[buf[0] % n];
  }
}

// Six words, space-separated — "amber pine tiger ..." Read it aloud, type it
// on the other phone. Words MAY repeat; forbidding repeats would remove
// entropy, not add it.
export function generatePhrase(): string {
  return Array.from({ length: PHRASE_WORDS }, pickWord).join(" ");
}

// Whitespace and case are not part of the secret. Someone reading a phrase off
// a screen will add a double space or capitalise the first word, and that must
// not select a different library. Applied on BOTH sides of hashing, so it has
// to stay stable forever — changing it orphans libraries.
export function normalizePhrase(input: string): string {
  return input.trim().toLowerCase().replace(/\s+/g, " ");
}

// Reject what a dictionary run would find first. This is the floor for a phrase
// someone types in themselves — generated phrases clear it by construction.
// Deliberately NOT a strength meter: the app offers a good phrase, so the only
// job here is to stop the actively dangerous ones.
export function phraseWeak(input: string): string | null {
  const p = normalizePhrase(input);
  if (p.length < 12) return "Too short — use at least 12 characters, or take the generated phrase.";
  const words = p.split(" ").filter(Boolean);
  if (words.length < 3) return "Use at least 3 words, or take the generated phrase.";
  if (new Set(words).size < 3) return "Use at least 3 different words.";
  return null;
}
