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
  starter:  { connects: 10,  priceInPaise: 14900  },  // ₹149 (was ₹99, ~+50%)
  pro:      { connects: 30,  priceInPaise: 37500 },   // ₹375 (was ₹249, ~+50%)
  power:    { connects: 60,  priceInPaise: 67500 },   // ₹675 (was ₹449, ~+50%)
  elite:    { connects: 120, priceInPaise: 119900 },  // ₹1199 (was ₹799, ~+50%)
  bulk:     { connects: 200, priceInPaise: 179900 },  // ₹1799 (was ₹1199, ~+50%) — best per-connect rate
} as const;

export type PackageKey = keyof typeof CONNECT_PACKAGES;
