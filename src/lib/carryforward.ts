/**
 * Capital Loss Carryforward Calculator
 *
 * IRS rules: Net capital losses can offset up to $3,000 of ordinary income per year
 * ($1,500 if Married Filing Separately). Any excess carries forward to future years.
 * Per IRS Schedule D instructions, carryforward is split into short-term and long-term
 * components using the Capital Loss Carryover Worksheet.
 * See IRS Publication 550 and Schedule D instructions.
 */

export interface CarryforwardResult {
  /** Net capital gain/loss for the year (ST + LT + prior carryforward) */
  netGainLoss: number;
  /** Amount of net loss deductible this year (max -$3,000, or $0 if net gain) */
  deductibleLoss: number;
  /** Total excess loss to carry forward (negative number, or $0) */
  carryforwardAmount: number;
  /** Short-term carryforward to next year (negative or $0) per IRS worksheet */
  carryforwardST: number;
  /** Long-term carryforward to next year (negative or $0) per IRS worksheet */
  carryforwardLT: number;
  /** Net short-term gain/loss (this year + prior ST carryforward) */
  shortTermGL: number;
  /** Net long-term gain/loss (this year + prior LT carryforward) */
  longTermGL: number;
}

/**
 * Compute capital loss carryforward for a given tax year.
 *
 * Accepts separate short-term and long-term prior carryforwards per IRS Schedule D.
 * Prior carryforwards are applied to their respective categories (lines 6 and 14).
 * Output carryforward is split per the IRS Capital Loss Carryover Worksheet.
 *
 * @param shortTermGL — Net short-term gain/loss for this year (negative = loss)
 * @param longTermGL — Net long-term gain/loss for this year (negative = loss)
 * @param priorCarryforwardST — Short-term carryforward from prior year (negative, default 0)
 * @param priorCarryforwardLT — Long-term carryforward from prior year (negative, default 0)
 * @param limit — Annual deduction limit (default $3,000)
 */
export function computeCarryforward(
  shortTermGL: number,
  longTermGL: number,
  priorCarryforwardST: number = 0,
  priorCarryforwardLT: number = 0,
  limit: number = 3000
): CarryforwardResult {
  // Apply prior carryforwards to their respective categories (Schedule D lines 6 & 14)
  const netST = shortTermGL + priorCarryforwardST;
  const netLT = longTermGL + priorCarryforwardLT;
  const total = netST + netLT;

  if (total >= 0) {
    return {
      netGainLoss: total,
      deductibleLoss: 0,
      carryforwardAmount: 0,
      carryforwardST: 0,
      carryforwardLT: 0,
      shortTermGL: netST,
      longTermGL: netLT,
    };
  }

  // Net loss — cap deduction at the annual limit ($3,000)
  const deductibleLoss = Math.max(total, -limit);
  const carryforwardAmount = total - deductibleLoss;

  // Split carryforward into ST/LT per IRS Capital Loss Carryover Worksheet
  const split = splitCarryforward(netST, netLT, -deductibleLoss);

  return {
    netGainLoss: total,
    deductibleLoss,
    carryforwardAmount,
    carryforwardST: split.carryforwardST,
    carryforwardLT: split.carryforwardLT,
    shortTermGL: netST,
    longTermGL: netLT,
  };
}

/**
 * IRS Capital Loss Carryover Worksheet (Schedule D instructions).
 *
 * Splits the total carryforward into short-term and long-term components.
 * The deduction ($3,000) is consumed by short-term losses first, with any
 * remaining capacity applied to long-term losses.
 *
 * @param netST — Net short-term (after prior carryforward applied)
 * @param netLT — Net long-term (after prior carryforward applied)
 * @param deduction — Absolute value of the deductible loss (e.g., 3000)
 */
function splitCarryforward(
  netST: number,
  netLT: number,
  deduction: number
): { carryforwardST: number; carryforwardLT: number } {
  // Part I: Short-Term Capital Loss Carryover
  let stCarryover = 0;
  let line3 = 0;

  if (netST < 0) {
    const stLoss = -netST;                    // Line 1: ST loss as positive
    const ltGain = Math.max(netLT, 0);        // Line 2: LT gain (0 if LT is also a loss)
    line3 = stLoss - ltGain;                   // Line 3: ST loss minus LT offset
    if (line3 > 0) {
      const stDeducted = Math.min(line3, deduction); // Line 4 vs 3
      stCarryover = line3 - stDeducted;               // Line 5
    }
  }

  // Part II: Long-Term Capital Loss Carryover
  let ltCarryover = 0;

  if (netLT < 0) {
    const ltLoss = -netLT;                                     // Line 6
    const stGain = Math.max(netST, 0);                         // Line 7
    const excessDeduction = Math.max(deduction - Math.max(line3, 0), 0); // Line 9
    const ltAbsorbed = stGain + excessDeduction;                // Line 10
    ltCarryover = Math.max(ltLoss - ltAbsorbed, 0);            // Line 11
  }

  return {
    carryforwardST: stCarryover > 0 ? -stCarryover : 0,
    carryforwardLT: ltCarryover > 0 ? -ltCarryover : 0,
  };
}
