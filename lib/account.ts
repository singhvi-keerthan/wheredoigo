// Sign-up: a phone number and a password, which together name a library.
//
// This replaces "invent a secret phrase" as the way in. People were typing a
// password anyway, and a phone number is the one string nobody has to write
// down — so an account is two things you already know instead of one thing you
// have to keep.
//
// ---- what this is NOT ------------------------------------------------------
// There is no OTP, so the phone number is NOT verified and NOT an identity. It
// is a namespace component: typing someone else's number does not reach their
// library, it just puts you in a different namespace where their password would
// also be needed. Nothing here proves who anybody is, nothing is billed to a
// number, and no message is ever sent to one.
//
// The security consequence is worth stating plainly, because it decides the
// password floor: a phone number is semi-public and often guessable, so the
// PASSWORD carries the whole secret. That is why `passwordProblem` refuses the
// short and obvious ones, and why the sync route's guessing budget (20 failed
// lookups per address per hour) matters more now than it did for a generated
// phrase. Someone who knows your number and your password has your library —
// exactly as much protection as any password-only login, and no more.

import { normalizePhrase } from "./phrase";

// Digits only, last ten.
//
// The same person will type "+91 98765 43210", "098765 43210" and
// "9876543210" on different days, and every one of those must open the same
// library — a normaliser that disagreed with itself would strand people in
// namespaces they could not find again. Ten digits is India's subscriber
// number, which is what this app's users have; a number from elsewhere still
// works, it just keys on its last ten digits.
export function normalizePhone(input: string): string {
  return input.replace(/\D/g, "").slice(-10);
}

export function phoneProblem(input: string): string | null {
  const digits = input.replace(/\D/g, "");
  if (digits.length < 10) return "Enter a 10-digit phone number.";
  if (digits.length > 15) return "That doesn’t look like a phone number."; // E.164's ceiling
  return null;
}

// The handful a dictionary tries first, plus the ones this app specifically
// invites: a password equal to the phone number, or to the app's own name.
const OBVIOUS = new Set([
  "password", "12345678", "123456789", "1234567890", "qwertyui", "iloveyou",
  "password1", "abc12345", "11111111", "00000000", "wheredoigo", "keerthan",
]);

// Deliberately a floor, not a strength meter. The job is to refuse what would
// fall to a first guess, not to lecture anyone about symbols.
export function passwordProblem(password: string, phone = ""): string | null {
  const p = password.trim();
  if (p.length < 8) return "Use at least 8 characters.";
  if (OBVIOUS.has(p.toLowerCase())) return "That password is too easy to guess.";
  if (/^\d+$/.test(p)) return "Use letters too, not only numbers.";
  // Your own number is the first thing anyone who has your number would try.
  if (phone && normalizePhone(p) && normalizePhone(p) === normalizePhone(phone)) {
    return "Don’t use your phone number as the password.";
  }
  if (new Set(p).size < 4) return "Use a few more different characters.";
  return null;
}

// The string that gets hashed into an owner key.
//
// The "acct:v1:" prefix keeps this namespace disjoint from the phrase-derived
// keys that already exist, so no phone-and-password can ever land on a library
// somebody opened with a recovery phrase. The version segment is there so a
// future change to this format can be migrated deliberately rather than
// silently orphaning every account — do not edit the existing shape.
//
// The password is case-SENSITIVE (only trimmed); the phone is reduced to
// digits. Passwords are chosen and retyped deliberately, so folding their case
// would throw away entropy the phone number cannot spare.
export function accountSecret(phone: string, password: string): string {
  return `acct:v1:${normalizePhone(phone)}:${password.trim()}`;
}

// A phone number as it should be shown back to someone: the last ten digits,
// grouped. Used to say WHICH account a device is signed into, which is the only
// account detail this app can safely remind anyone of — the password is theirs
// and is never stored.
export function displayPhone(phone: string): string {
  const d = normalizePhone(phone);
  return d.length === 10 ? `${d.slice(0, 5)} ${d.slice(5)}` : d;
}

// Re-exported so callers that handle both ways in (account, recovery phrase)
// have one import for the normalisers.
export { normalizePhrase };
