// The repeat-order block: how long a phone number that has ordered is refused
// another storefront order. Set per store on the store form
// (stores.order_cooldown_hours, enforced by the API); 0 means for good.
// Shared by the admin's picker and the order form's refusal, so the two can
// never word the same setting differently.

/** The choices the store form offers, in hours. */
export const COOLDOWN_CHOICES: { hours: number; label: string }[] = [
  { hours: 0, label: "Forever (one order per number)" },
  { hours: 24, label: "1 day" },
  { hours: 72, label: "3 days" },
  { hours: 168, label: "7 days" },
  { hours: 360, label: "15 days" },
  { hours: 720, label: "30 days" },
];

const BN_DIGITS = "০১২৩৪৫৬৭৮৯";

function bn(n: number): string {
  return String(n).replace(/\d/g, (d) => BN_DIGITS[Number(d)]);
}

/** "৭ দিন", "১২ ঘণ্টা": the window as the order form says it. */
function windowBn(hours: number): string {
  return hours % 24 === 0 ? `${bn(hours / 24)} দিন` : `${bn(hours)} ঘণ্টা`;
}

/** What the order form tells a number the store refuses. */
export function cooldownMessageBn(hours: number): string {
  const base = "আপনি ইতিমধ্যে এই নাম্বার থেকে অর্ডার করেছেন। আমাদের প্রতিনিধি শিগগিরই আপনার সাথে যোগাযোগ করবেন।";
  return hours > 0 ? `${base} নতুন অর্ডারের জন্য ${windowBn(hours)} পর আবার চেষ্টা করুন।` : base;
}
