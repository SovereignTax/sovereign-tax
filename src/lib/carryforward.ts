/**
 * Capital Loss Carryforward Calculator
 *
 * IRS rules: Net capital losses can offset up to $3,000 of ordinary income per year
 * ($1,500 if Married Filing Separately). Any excess carries forward to future years.
 * See IRS Publication 550 and Schedule D instructions.
 */

export interface CarryforwardResult {
  /** Net capital gain/loss for the year (ST + LT) */
  netGainLoss: number;
  /** Amount of net loss deductible this year (max -$3,000, or $0 if net gain) */
  deductibleLoss: number;
  /** Excess loss to carry forward to future tax years (negative number, or $0) */
  carryforwardAmount: number;
  /** Short-term gain/loss subtotal */
  shortTermGL: number;
  /** Long-term gain/loss subtotal */
  longTermGL: number;
}

/**
 * Compute capital loss carryforward for a given tax year.
 *
 * @param shortTermGL  — Net short-term gain/loss (negative = loss)
 * @param longTermGL   — Net long-term gain/loss (negative = loss)
 * @param priorCarryforward — Carryforward from prior year (negative number, default 0)
 * @param limit — Annual deduction limit (default $3,000)
 * @returns CarryforwardResult with deductible loss and carryforward amounts
 */
export function computeCarryforward(
  shortTermGL: number,
  longTermGL: number,
  priorCarryforward: number = 0,
  limit: number = 3000
): CarryforwardResult {
  // Total net gain/loss including any prior-year carryforward
  const totalWithCarry = shortTermGL + longTermGL + priorCarryforward;

  if (totalWithCarry >= 0) {
    // Net gain — no deduction limit applies, no carryforward
    return {
      netGainLoss: totalWithCarry,
      deductibleLoss: 0,
      carryforwardAmount: 0,
      shortTermGL,
      longTermGL,
    };
  }

  // Net loss — cap deduction at the annual limit ($3,000)
  const deductibleLoss = Math.max(totalWithCarry, -limit);
  const carryforwardAmount = totalWithCarry - deductibleLoss; // negative remainder

  return {
    netGainLoss: totalWithCarry,
    deductibleLoss,
    carryforwardAmount,
    shortTermGL,
    longTermGL,
  };
}
