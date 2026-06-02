// Approximate USD exchange rates for tier bucketing (not for financial calculation)
const USD_RATES: Record<string, number> = {
  USD: 1,
  INR: 0.012,   // 1 INR ≈ 0.012 USD
  AED: 0.272,   // 1 AED ≈ 0.272 USD
  SGD: 0.74,    // 1 SGD ≈ 0.74 USD
};

/**
 * Returns the connect cost for a job based on its budget.
 * - Negotiable budget  → 2 connects (default)
 * - < $500 equivalent → 2 connects (small)
 * - $500–$5,000       → 4 connects (medium)
 * - > $5,000          → 6 connects (large)
 */
export function getConnectCost(
  budget: number,
  budgetType: string,
  currency: string,
): number {
  if (budgetType === 'negotiable') return 2;

  const rate = USD_RATES[currency] ?? 1;
  const usdEquivalent = budget * rate;

  if (usdEquivalent < 500)  return 2;
  if (usdEquivalent <= 5000) return 4;
  return 6;
}
