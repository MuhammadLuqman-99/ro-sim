// Money: which currency the player pays in, and what one Starstone costs there.
// Each default is the 12,980-Starstone top-up (the cheapest per Starstone) from
// a seller in that country, since pack prices differ by country and are not
// just the exchange rate. Players can type their own price.

export const CURRENCIES = {
  MYR: { sym: "RM", name: "Malaysia (RM)", perStar: 0.0655, src: "12,980 Starstones for RM 850 (top-up seller, Jul 2026)" },
  THB: { sym: "฿", name: "Thailand (฿)", perStar: 0.5263, src: "12,980 Starstones for ฿6,831 (Over Topup TH, Nov 2026)" },
  SGD: { sym: "S$", name: "Singapore (S$)", perStar: 0.02052, src: "12,980 Starstones for S$266.29 (Joytify SG, Nov 2026)" },
  IDR: { sym: "Rp", name: "Indonesia (Rp)", perStar: 302, src: "12,980 Starstones for Rp3,919,894 (hktopup.id, Nov 2026)", whole: true },
  PHP: { sym: "₱", name: "Philippines (₱)", perStar: 0.9994, src: "12,980 Starstones for ₱12,972 (Joytify PH, Nov 2026)" },
  USD: { sym: "US$", name: "US dollar (US$)", perStar: 0.0164, src: "12,980 Starstones for US$212 (SEAGM, Nov 2026)" },
};

// One number formatter for the whole page: fixed decimals, Malaysian grouping.
export const fmt = (n, d = 0) => Number(n).toLocaleString("en-MY", { maximumFractionDigits: d, minimumFractionDigits: d });

// A first guess from the device's time zone: the five SEA countries by zone,
// US$ anywhere else, Malaysia when the zone is unknown.
const ZONES = { "Asia/Bangkok": "THB", "Asia/Singapore": "SGD", "Asia/Jakarta": "IDR", "Asia/Makassar": "IDR",
  "Asia/Jayapura": "IDR", "Asia/Pontianak": "IDR", "Asia/Manila": "PHP", "Asia/Kuala_Lumpur": "MYR", "Asia/Kuching": "MYR" };
export function guessCurrency(timeZone) {
  if (!timeZone) return "MYR";
  return ZONES[timeZone] || "USD";
}

// "RM 12.50", "RM 1,250", "Rp 37,801", and small amounts keep two significant
// digits ("S$ 0.0062") so they never read as free.
export function formatMoney(n, code) {
  const c = CURRENCIES[code] || CURRENCIES.MYR;
  const v = Number(n) || 0, a = Math.abs(v);
  if (!c.whole && a > 0 && a < 1) return `${c.sym} ${v.toLocaleString("en-MY", { maximumSignificantDigits: 2 })}`;
  return `${c.sym} ${fmt(v, c.whole || a >= 100 ? 0 : 2)}`;
}

// 1, 2 or 5 × a power of ten, at most x (and at least 1).
export function niceStep(x) {
  if (!(x >= 1)) return 1;
  const p = 10 ** Math.floor(Math.log10(x)), m = x / p;
  return (m >= 5 ? 5 : m >= 2 ? 2 : 1) * p;
}

// The budget box: its arrow step (about RM 10 worth) and its starting value
// (about RM 200 worth), both from the default prices so a custom price never
// moves them.
const BASE_BUDGET_RM = 200;
export function budgetStep(code) {
  const c = CURRENCIES[code] || CURRENCIES.MYR;
  return niceStep(10 * c.perStar / CURRENCIES.MYR.perStar);
}
export function defaultBudget(code) {
  const c = CURRENCIES[code] || CURRENCIES.MYR;
  const step = budgetStep(code);
  return Math.max(step, Math.round(BASE_BUDGET_RM * c.perStar / CURRENCIES.MYR.perStar / step) * step);
}
