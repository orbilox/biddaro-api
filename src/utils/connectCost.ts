// Approximate USD exchange rates for tier bucketing (not for financial calculation)
const USD_RATES: Record<string, number> = { USD: 1, INR: 0.012, AED: 0.272, SGD: 0.74 };

/**
 * Returns the connect cost for a job based on its budget.
 * - Negotiable budget  → 2 connects (or 4 if priority)
 * - < $500 equivalent → 2 connects (small)
 * - $500–$5,000       → 4 connects (medium)
 * - > $5,000          → 6 connects (large)
 * Priority adds +2 to base cost.
 */
export function getConnectCost(budget: number, budgetType: string, currency: string, isPriority = false): number {
  if (budgetType === 'negotiable') return isPriority ? 4 : 2;
  const usd = budget * (USD_RATES[currency] ?? 1);
  let base = usd < 500 ? 2 : usd <= 5000 ? 4 : 6;
  return isPriority ? base + 2 : base;
}

export const CONNECT_PACKAGES = {
  starter:  { connects: 10,  priceInPaise: 9900  },   // ₹99
  pro:      { connects: 30,  priceInPaise: 24900 },   // ₹249
  power:    { connects: 60,  priceInPaise: 44900 },   // ₹449
  elite:    { connects: 120, priceInPaise: 79900 },   // ₹799
  bulk:     { connects: 200, priceInPaise: 119900 },  // ₹1199 — 20% off vs starter rate
} as const;

export type PackageKey = keyof typeof CONNECT_PACKAGES;
