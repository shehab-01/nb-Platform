/**
 * How many packets an option's size says it holds: "৩ প্যাকেট ( ৬০ পিছ)" → 3,
 * "10 packets" → 10, "২ কেজি" → null. Only a hint for the product editor,
 * which asks before changing anything: the number stock actually uses is
 * the option's own "Packets" field (product_variants.stock_packets).
 */
const BANGLA_DIGITS = "০১২৩৪৫৬৭৮৯";

function latin(text: string): string {
  return text.replace(/[০-৯]/g, (d) => String(BANGLA_DIGITS.indexOf(d)));
}

export function packetsInLabel(label: string): number | null {
  const match = latin(label).match(/(\d+)\s*(?:প্যাকেট|প্যাকেটের|packets?|packs?|pkts?)/i);
  if (!match) return null;
  const n = Number(match[1]);
  return n >= 1 ? n : null;
}
