/**
 * What counts as a usable delivery address, checked when the order form is
 * submitted. Customers were sending one word ("Dhaka") or just a number, so
 * the rule is: at least three words, and not only numbers. Mirrors
 * api/address.py, which is the real guard; this copy exists so the customer
 * is asked to fix it before the request leaves the browser. Autosaved drafts
 * are never checked: an abandoned form is a lead, however rough.
 */

export const ADDRESS_MIN_WORDS = 3;

// A word is a run of non-space characters containing a letter or a digit, so
// stray punctuation ("-", ",") does not count. Bangla letters and digits
// count like Latin ones.
const WORD = /\S*[\p{L}\p{N}]\S*/gu;
const LETTER = /\p{L}/u;

export function isValidAddress(raw: string): boolean {
  const words = raw.match(WORD) ?? [];
  if (words.length < ADDRESS_MIN_WORDS) return false;
  return words.some((w) => LETTER.test(w));
}
