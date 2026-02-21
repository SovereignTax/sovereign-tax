import { describe, it, expect } from "vitest";
import { calculate, simulateSale, daysBetween, isMoreThanOneYear, LotSelection } from "../cost-basis";
import { createTransaction } from "../models";
import { AccountingMethod, TransactionType } from "../types";

// ═══════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════

function buy(date: string, amount: number, price: number, opts?: { exchange?: string; wallet?: string; fee?: number }): ReturnType<typeof createTransaction> {
  const total = amount * price + (opts?.fee ?? 0);
  return createTransaction({
    date: new Date(date + "T12:00:00").toISOString(),
    transactionType: TransactionType.Buy,
    amountBTC: amount,
    pricePerBTC: total / amount,
    totalUSD: total,
    fee: opts?.fee,
    exchange: opts?.exchange ?? "Coinbase",
    wallet: opts?.wallet ?? opts?.exchange ?? "Coinbase",
    notes: "",
  });
}

function sell(date: string, amount: number, price: number, opts?: { exchange?: string; wallet?: string; fee?: number }): ReturnType<typeof createTransaction> {
  const total = amount * price - (opts?.fee ?? 0);
  return createTransaction({
    date: new Date(date + "T12:00:00").toISOString(),
    transactionType: TransactionType.Sell,
    amountBTC: amount,
    pricePerBTC: price,
    totalUSD: Math.max(0, total),
    fee: opts?.fee,
    exchange: opts?.exchange ?? "Coinbase",
    wallet: opts?.wallet ?? opts?.exchange ?? "Coinbase",
    notes: "",
  });
}

function donation(date: string, amount: number, fmv: number, opts?: { exchange?: string; wallet?: string }): ReturnType<typeof createTransaction> {
  return createTransaction({
    date: new Date(date + "T12:00:00").toISOString(),
    transactionType: TransactionType.Donation,
    amountBTC: amount,
    pricePerBTC: fmv,
    totalUSD: amount * fmv,
    exchange: opts?.exchange ?? "Coinbase",
    wallet: opts?.wallet ?? opts?.exchange ?? "Coinbase",
    notes: "",
  });
}

function transferOut(date: string, amount: number, opts?: { exchange?: string; wallet?: string }): ReturnType<typeof createTransaction> {
  return createTransaction({
    date: new Date(date + "T12:00:00").toISOString(),
    transactionType: TransactionType.TransferOut,
    amountBTC: amount,
    pricePerBTC: 0,
    totalUSD: 0,
    exchange: opts?.exchange ?? "Coinbase",
    wallet: opts?.wallet ?? opts?.exchange ?? "Coinbase",
    notes: "",
  });
}

function transferIn(date: string, amount: number, opts?: { exchange?: string; wallet?: string }): ReturnType<typeof createTransaction> {
  return createTransaction({
    date: new Date(date + "T12:00:00").toISOString(),
    transactionType: TransactionType.TransferIn,
    amountBTC: amount,
    pricePerBTC: 0,
    totalUSD: 0,
    exchange: opts?.exchange ?? "Ledger",
    wallet: opts?.wallet ?? opts?.exchange ?? "Ledger",
    notes: "",
  });
}

// ═══════════════════════════════════════════════════════
// daysBetween & isMoreThanOneYear
// ═══════════════════════════════════════════════════════

describe("daysBetween", () => {
  it("calculates days correctly", () => {
    expect(daysBetween("2024-01-01T12:00:00Z", "2024-01-02T12:00:00Z")).toBe(1);
    expect(daysBetween("2024-01-01T12:00:00Z", "2024-12-31T12:00:00Z")).toBe(365); // 2024 is leap year
    expect(daysBetween("2025-01-01T12:00:00Z", "2025-12-31T12:00:00Z")).toBe(364); // 2025 non-leap
  });

  it("returns 0 for same day", () => {
    expect(daysBetween("2024-06-15T10:00:00Z", "2024-06-15T22:00:00Z")).toBe(0);
  });
});

describe("isMoreThanOneYear", () => {
  it("exactly one year is NOT long-term", () => {
    // Acquired Jan 15 2024, sold Jan 15 2025 = exactly one year later = NOT long-term
    expect(isMoreThanOneYear("2024-01-15T12:00:00Z", "2025-01-15T12:00:00Z")).toBe(false);
  });

  it("one year + one day IS long-term", () => {
    expect(isMoreThanOneYear("2024-01-15T12:00:00Z", "2025-01-16T12:00:00Z")).toBe(true);
  });

  it("less than one year is short-term", () => {
    expect(isMoreThanOneYear("2024-06-01T12:00:00Z", "2025-01-01T12:00:00Z")).toBe(false);
  });

  it("handles leap year — acquired Feb 29", () => {
    // 2024 is leap year, acquired Feb 29 2024 → one year later = Mar 1 2025
    // Sold Feb 28 2025: NOT long-term
    expect(isMoreThanOneYear("2024-02-29T12:00:00Z", "2025-02-28T12:00:00Z")).toBe(false);
    // Sold Mar 1 2025: exactly one year → NOT long-term
    expect(isMoreThanOneYear("2024-02-29T12:00:00Z", "2025-03-01T12:00:00Z")).toBe(false);
    // Sold Mar 2 2025: IS long-term
    expect(isMoreThanOneYear("2024-02-29T12:00:00Z", "2025-03-02T12:00:00Z")).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════
// FIFO BASICS
// ═══════════════════════════════════════════════════════

describe("FIFO — basic scenarios", () => {
  it("single buy → single sell, full lot", () => {
    const txns = [
      buy("2024-01-15", 1.0, 40000),
      sell("2024-06-15", 1.0, 60000),
    ];
    const result = calculate(txns, AccountingMethod.FIFO);
    expect(result.sales).toHaveLength(1);
    expect(result.sales[0].amountSold).toBe(1.0);
    expect(result.sales[0].costBasis).toBeCloseTo(40000, 2);
    expect(result.sales[0].totalProceeds).toBeCloseTo(60000, 2);
    expect(result.sales[0].gainLoss).toBeCloseTo(20000, 2);
    expect(result.sales[0].isLongTerm).toBe(false); // < 1 year
  });

  it("multiple buys → FIFO sells oldest first", () => {
    const txns = [
      buy("2024-01-01", 0.5, 30000), // $15,000
      buy("2024-03-01", 0.5, 50000), // $25,000
      sell("2024-06-01", 0.5, 60000), // Should use Jan lot
    ];
    const result = calculate(txns, AccountingMethod.FIFO);
    expect(result.sales).toHaveLength(1);
    expect(result.sales[0].costBasis).toBeCloseTo(15000, 2); // Jan lot @ $30k
    expect(result.sales[0].totalProceeds).toBeCloseTo(30000, 2);
    expect(result.sales[0].gainLoss).toBeCloseTo(15000, 2);
  });

  it("sell spanning multiple lots", () => {
    const txns = [
      buy("2024-01-01", 0.3, 30000), // $9,000
      buy("2024-02-01", 0.3, 40000), // $12,000
      buy("2024-03-01", 0.4, 50000), // $20,000
      sell("2024-06-01", 0.7, 60000), // Uses all of lot 1 + all of lot 2 + 0.1 from lot 3
    ];
    const result = calculate(txns, AccountingMethod.FIFO);
    expect(result.sales).toHaveLength(1);
    const sale = result.sales[0];
    expect(sale.amountSold).toBeCloseTo(0.7, 8);
    expect(sale.lotDetails).toHaveLength(3);
    expect(sale.lotDetails[0].amountBTC).toBeCloseTo(0.3, 8); // all of lot 1
    expect(sale.lotDetails[1].amountBTC).toBeCloseTo(0.3, 8); // all of lot 2
    expect(sale.lotDetails[2].amountBTC).toBeCloseTo(0.1, 8); // partial lot 3
    // Cost: 0.3*30k + 0.3*40k + 0.1*50k = 9k + 12k + 5k = $26,000
    expect(sale.costBasis).toBeCloseTo(26000, 2);
  });

  it("partial lot leaves remaining for next sale", () => {
    const txns = [
      buy("2024-01-01", 1.0, 40000),
      sell("2024-03-01", 0.3, 50000), // Uses 0.3 of lot
      sell("2024-06-01", 0.5, 60000), // Uses remaining 0.7 → only 0.5 needed
    ];
    const result = calculate(txns, AccountingMethod.FIFO);
    expect(result.sales).toHaveLength(2);
    // First sale
    expect(result.sales[0].amountSold).toBeCloseTo(0.3, 8);
    expect(result.sales[0].costBasis).toBeCloseTo(12000, 2); // 0.3 * 40k
    // Second sale
    expect(result.sales[1].amountSold).toBeCloseTo(0.5, 8);
    expect(result.sales[1].costBasis).toBeCloseTo(20000, 2); // 0.5 * 40k
    // Remaining lot
    const remaining = result.lots.find((l) => l.remainingBTC > 0.00000001);
    expect(remaining).toBeDefined();
    expect(remaining!.remainingBTC).toBeCloseTo(0.2, 8);
  });

  it("sell more than available → partial fill with warning", () => {
    const txns = [
      buy("2024-01-01", 0.5, 40000),
      sell("2024-06-01", 1.0, 60000), // Wants 1.0 but only 0.5 available
    ];
    const result = calculate(txns, AccountingMethod.FIFO);
    expect(result.sales).toHaveLength(1);
    expect(result.sales[0].amountSold).toBeCloseTo(0.5, 8); // Partial fill
    // Proceeds should be pro-rated: 0.5 * 60000 = 30000
    expect(result.sales[0].totalProceeds).toBeCloseTo(30000, 2);
  });

  it("no lots available → warning, no sale", () => {
    const txns = [
      sell("2024-06-01", 1.0, 60000), // No buys at all
    ];
    const result = calculate(txns, AccountingMethod.FIFO);
    expect(result.sales).toHaveLength(0);
    expect(result.warnings.length).toBeGreaterThan(0);
  });
});

// ═══════════════════════════════════════════════════════
// FIFO — Fee-inclusive cost basis
// ═══════════════════════════════════════════════════════

describe("FIFO — fee handling", () => {
  it("buy fee increases cost basis", () => {
    const txns = [
      buy("2024-01-01", 1.0, 40000, { fee: 50 }), // total = 40000 + 50 = 40050
      sell("2024-06-01", 1.0, 60000),
    ];
    const result = calculate(txns, AccountingMethod.FIFO);
    expect(result.sales[0].costBasis).toBeCloseTo(40050, 2);
    expect(result.sales[0].gainLoss).toBeCloseTo(19950, 2); // 60000 - 40050
  });

  it("fee-inclusive cost basis uses totalCost/amountBTC, not pricePerBTC", () => {
    // Buy 0.5 BTC @ $40k with $100 fee → totalCost = 20000 + 100 = 20100
    // costBasisPerBTC should be 20100/0.5 = 40200, not 40000
    const txns = [
      buy("2024-01-01", 0.5, 40000, { fee: 100 }),
      sell("2024-06-01", 0.25, 60000), // Sell half the lot
    ];
    const result = calculate(txns, AccountingMethod.FIFO);
    // Cost for 0.25 BTC = 0.25 * (20100/0.5) = 0.25 * 40200 = 10050
    expect(result.sales[0].costBasis).toBeCloseTo(10050, 2);
  });
});

// ═══════════════════════════════════════════════════════
// FIFO — Long-term vs Short-term
// ═══════════════════════════════════════════════════════

describe("FIFO — holding period classification", () => {
  it("short-term (held < 1 year)", () => {
    const txns = [
      buy("2024-01-15", 1.0, 40000),
      sell("2024-06-15", 1.0, 50000),
    ];
    const result = calculate(txns, AccountingMethod.FIFO);
    expect(result.sales[0].isLongTerm).toBe(false);
    expect(result.sales[0].isMixedTerm).toBe(false);
  });

  it("long-term (held > 1 year)", () => {
    const txns = [
      buy("2023-01-15", 1.0, 40000),
      sell("2024-06-15", 1.0, 50000), // ~17 months
    ];
    const result = calculate(txns, AccountingMethod.FIFO);
    expect(result.sales[0].isLongTerm).toBe(true);
    expect(result.sales[0].isMixedTerm).toBe(false);
  });

  it("mixed-term (spans short and long-term lots)", () => {
    const txns = [
      buy("2023-01-01", 0.5, 30000),  // Long-term by June 2024
      buy("2024-03-01", 0.5, 50000),  // Short-term by June 2024
      sell("2024-06-15", 1.0, 60000),
    ];
    const result = calculate(txns, AccountingMethod.FIFO);
    expect(result.sales[0].isMixedTerm).toBe(true);
    expect(result.sales[0].lotDetails[0].isLongTerm).toBe(true);
    expect(result.sales[0].lotDetails[1].isLongTerm).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════
// FIFO — Per-wallet cost basis (IRS TD 9989)
// ═══════════════════════════════════════════════════════

describe("FIFO — per-wallet enforcement", () => {
  it("sells from the correct wallet", () => {
    const txns = [
      buy("2024-01-01", 1.0, 30000, { wallet: "Coinbase" }),
      buy("2024-02-01", 1.0, 50000, { wallet: "Kraken" }),
      sell("2024-06-01", 0.5, 60000, { wallet: "Kraken" }),
    ];
    const result = calculate(txns, AccountingMethod.FIFO);
    expect(result.sales).toHaveLength(1);
    // Should sell from Kraken lot (@ $50k), not Coinbase (@ $30k)
    expect(result.sales[0].costBasis).toBeCloseTo(25000, 2); // 0.5 * 50000
  });

  it("wallet matching is case-insensitive", () => {
    const txns = [
      buy("2024-01-01", 1.0, 40000, { wallet: "coinbase" }),
      sell("2024-06-01", 0.5, 60000, { wallet: "Coinbase" }),
    ];
    const result = calculate(txns, AccountingMethod.FIFO);
    expect(result.sales).toHaveLength(1);
    expect(result.sales[0].amountSold).toBeCloseTo(0.5, 8);
  });

  it("falls back to global pool with warning if wallet has no lots", () => {
    const txns = [
      buy("2024-01-01", 1.0, 40000, { wallet: "Coinbase" }),
      sell("2024-06-01", 0.5, 60000, { wallet: "NonexistentWallet" }),
    ];
    const result = calculate(txns, AccountingMethod.FIFO);
    expect(result.sales).toHaveLength(1);
    expect(result.sales[0].amountSold).toBeCloseTo(0.5, 8);
    expect(result.warnings.some((w) => w.includes("Fell back to global"))).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════
// SPECIFIC ID
// ═══════════════════════════════════════════════════════

describe("Specific ID — lot selection", () => {
  it("uses selected lots instead of FIFO order", () => {
    const b1 = buy("2024-01-01", 0.5, 30000);
    const b2 = buy("2024-03-01", 0.5, 50000);
    const s1 = sell("2024-06-01", 0.3, 60000);
    const txns = [b1, b2, s1];

    // Record a Specific ID election picking lot 2 (the more expensive one)
    const recorded = [{
      id: "rec-1",
      saleDate: s1.date,
      amountSold: 0.3,
      salePricePerBTC: 60000,
      totalProceeds: 18000,
      costBasis: 15000,
      gainLoss: 3000,
      lotDetails: [{
        id: "d1",
        lotId: b2.id, // Picking lot 2
        purchaseDate: b2.date,
        amountBTC: 0.3,
        costBasisPerBTC: 50000,
        totalCost: 15000,
        daysHeld: 92,
        exchange: "Coinbase",
        isLongTerm: false,
      }],
      holdingPeriodDays: 92,
      isLongTerm: false,
      isMixedTerm: false,
      method: AccountingMethod.SpecificID,
      sourceTransactionId: s1.id,
    }];

    const result = calculate(txns, AccountingMethod.FIFO, recorded);
    expect(result.sales).toHaveLength(1);
    // Should use lot 2 cost ($50k), not lot 1 ($30k)
    expect(result.sales[0].costBasis).toBeCloseTo(15000, 2); // 0.3 * 50000
  });
});

// ═══════════════════════════════════════════════════════
// DONATIONS
// ═══════════════════════════════════════════════════════

describe("Donations (IRC §170)", () => {
  it("donation has zero proceeds and zero gain/loss", () => {
    const txns = [
      buy("2024-01-01", 1.0, 40000),
      donation("2024-06-01", 0.5, 60000),
    ];
    const result = calculate(txns, AccountingMethod.FIFO);
    expect(result.sales).toHaveLength(1);
    const sale = result.sales[0];
    expect(sale.isDonation).toBe(true);
    expect(sale.totalProceeds).toBe(0);
    expect(sale.gainLoss).toBe(0);
    expect(sale.salePricePerBTC).toBe(0);
  });

  it("donation stores FMV on SaleRecord", () => {
    const txns = [
      buy("2024-01-01", 1.0, 40000),
      donation("2024-06-01", 0.5, 65000),
    ];
    const result = calculate(txns, AccountingMethod.FIFO);
    const sale = result.sales[0];
    expect(sale.donationFmvPerBTC).toBeCloseTo(65000, 2);
    expect(sale.donationFmvTotal).toBeCloseTo(32500, 2); // 0.5 * 65000
  });

  it("donation consumes lots (reduces remainingBTC)", () => {
    const txns = [
      buy("2024-01-01", 1.0, 40000),
      donation("2024-03-01", 0.3, 50000),
      sell("2024-06-01", 0.5, 60000),
    ];
    const result = calculate(txns, AccountingMethod.FIFO);
    expect(result.sales).toHaveLength(2);
    // Donation consumed 0.3 from the lot
    expect(result.sales[0].isDonation).toBe(true);
    expect(result.sales[0].amountSold).toBeCloseTo(0.3, 8);
    // Sale gets the remaining 0.7, but only needs 0.5
    expect(result.sales[1].amountSold).toBeCloseTo(0.5, 8);
    // Remaining: 1.0 - 0.3 - 0.5 = 0.2
    const remaining = result.lots[0].remainingBTC;
    expect(remaining).toBeCloseTo(0.2, 8);
  });
});

// ═══════════════════════════════════════════════════════
// EPSILON SNAP — IEEE 754 float drift
// ═══════════════════════════════════════════════════════

describe("Epsilon snap — no phantom lots", () => {
  it("selling entire lot doesn't leave dust", () => {
    const txns = [
      buy("2024-01-01", 0.1, 40000),
      sell("2024-06-01", 0.1, 60000),
    ];
    const result = calculate(txns, AccountingMethod.FIFO);
    const lot = result.lots[0];
    expect(lot.remainingBTC).toBe(0);
  });

  it("multiple partial sells don't accumulate phantom dust", () => {
    const txns = [
      buy("2024-01-01", 1.0, 40000),
      sell("2024-02-01", 0.1, 50000),
      sell("2024-03-01", 0.1, 50000),
      sell("2024-04-01", 0.1, 50000),
      sell("2024-05-01", 0.1, 50000),
      sell("2024-06-01", 0.1, 50000),
      sell("2024-07-01", 0.1, 50000),
      sell("2024-08-01", 0.1, 50000),
      sell("2024-09-01", 0.1, 50000),
      sell("2024-10-01", 0.1, 50000),
      sell("2024-11-01", 0.1, 50000), // Should consume entire lot
    ];
    const result = calculate(txns, AccountingMethod.FIFO);
    expect(result.sales).toHaveLength(10);
    // The lot should be fully consumed — no phantom dust
    expect(result.lots[0].remainingBTC).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════
// TRANSFERS — non-taxable
// ═══════════════════════════════════════════════════════

describe("Transfers — non-taxable", () => {
  it("transfers do not create lots or sales", () => {
    const txns = [
      buy("2024-01-01", 1.0, 40000),
      transferOut("2024-03-01", 0.5, { wallet: "Coinbase" }),
      transferIn("2024-03-01", 0.5, { wallet: "Ledger" }),
    ];
    const result = calculate(txns, AccountingMethod.FIFO);
    expect(result.lots).toHaveLength(1); // Only the buy creates a lot
    expect(result.sales).toHaveLength(0);
    // The lot is untouched
    expect(result.lots[0].remainingBTC).toBeCloseTo(1.0, 8);
  });
});

// ═══════════════════════════════════════════════════════
// SIMULATE SALE
// ═══════════════════════════════════════════════════════

describe("simulateSale", () => {
  it("simulates without mutating original lots", () => {
    const b1 = buy("2024-01-01", 1.0, 40000);
    const txns = [b1];
    const result = calculate(txns, AccountingMethod.FIFO);
    const originalRemaining = result.lots[0].remainingBTC;

    const sim = simulateSale(0.5, 60000, result.lots, AccountingMethod.FIFO);
    expect(sim).not.toBeNull();
    expect(sim!.amountSold).toBeCloseTo(0.5, 8);

    // Original lot should be unchanged
    expect(result.lots[0].remainingBTC).toBeCloseTo(originalRemaining, 8);
  });

  it("simulates with wallet filter", () => {
    const txns = [
      buy("2024-01-01", 1.0, 30000, { wallet: "Coinbase" }),
      buy("2024-02-01", 1.0, 50000, { wallet: "Kraken" }),
    ];
    const result = calculate(txns, AccountingMethod.FIFO);

    const sim = simulateSale(0.5, 60000, result.lots, AccountingMethod.FIFO, undefined, "Kraken");
    expect(sim).not.toBeNull();
    // Should use Kraken lot
    expect(sim!.costBasis).toBeCloseTo(25000, 2); // 0.5 * 50000
  });

  it("simulates with Specific ID selections", () => {
    const txns = [
      buy("2024-01-01", 1.0, 30000, { wallet: "Coinbase" }),
      buy("2024-02-01", 1.0, 50000, { wallet: "Coinbase" }),
    ];
    const result = calculate(txns, AccountingMethod.FIFO);
    const lot2Id = result.lots[1].id;

    const selections: LotSelection[] = [{ lotId: lot2Id, amountBTC: 0.5 }];
    const sim = simulateSale(0.5, 60000, result.lots, AccountingMethod.SpecificID, selections, "Coinbase");
    expect(sim).not.toBeNull();
    expect(sim!.costBasis).toBeCloseTo(25000, 2); // 0.5 * 50000 (lot 2)
  });
});

// ═══════════════════════════════════════════════════════
// CAPITAL GAINS MATH
// ═══════════════════════════════════════════════════════

describe("Capital gains calculations", () => {
  it("correctly calculates a gain", () => {
    const txns = [
      buy("2024-01-01", 1.0, 40000),
      sell("2024-06-01", 1.0, 60000),
    ];
    const result = calculate(txns, AccountingMethod.FIFO);
    expect(result.sales[0].gainLoss).toBeCloseTo(20000, 2);
  });

  it("correctly calculates a loss", () => {
    const txns = [
      buy("2024-01-01", 1.0, 60000),
      sell("2024-06-01", 1.0, 40000),
    ];
    const result = calculate(txns, AccountingMethod.FIFO);
    expect(result.sales[0].gainLoss).toBeCloseTo(-20000, 2);
  });

  it("zero gain (sell at cost)", () => {
    const txns = [
      buy("2024-01-01", 1.0, 50000),
      sell("2024-06-01", 1.0, 50000),
    ];
    const result = calculate(txns, AccountingMethod.FIFO);
    expect(result.sales[0].gainLoss).toBeCloseTo(0, 2);
  });

  it("multiple sales in same year accumulate correctly", () => {
    const txns = [
      buy("2024-01-01", 2.0, 40000),
      sell("2024-03-01", 0.5, 50000), // Gain: 0.5*(50k-40k) = +$5k
      sell("2024-06-01", 0.5, 30000), // Loss: 0.5*(30k-40k) = -$5k
      sell("2024-09-01", 0.5, 60000), // Gain: 0.5*(60k-40k) = +$10k
    ];
    const result = calculate(txns, AccountingMethod.FIFO);
    expect(result.sales).toHaveLength(3);
    const totalGainLoss = result.sales.reduce((a, s) => a + s.gainLoss, 0);
    expect(totalGainLoss).toBeCloseTo(10000, 2); // +5k - 5k + 10k
  });
});

// ═══════════════════════════════════════════════════════
// EDGE CASES
// ═══════════════════════════════════════════════════════

describe("Edge cases", () => {
  it("very small amounts (satoshi-level)", () => {
    const txns = [
      buy("2024-01-01", 0.00000001, 100000), // 1 satoshi
      sell("2024-06-01", 0.00000001, 150000),
    ];
    const result = calculate(txns, AccountingMethod.FIFO);
    expect(result.sales).toHaveLength(1);
    expect(result.sales[0].amountSold).toBeCloseTo(0.00000001, 8);
  });

  it("very large BTC amount", () => {
    const txns = [
      buy("2024-01-01", 21000000, 0.01), // All BTC that will ever exist
      sell("2024-06-01", 100, 100000),
    ];
    const result = calculate(txns, AccountingMethod.FIFO);
    expect(result.sales).toHaveLength(1);
    expect(result.sales[0].amountSold).toBe(100);
  });

  it("buy and sell on same day", () => {
    const txns = [
      buy("2024-06-01", 1.0, 40000),
      sell("2024-06-01", 1.0, 40000),
    ];
    const result = calculate(txns, AccountingMethod.FIFO);
    expect(result.sales).toHaveLength(1);
    expect(result.sales[0].holdingPeriodDays).toBe(0);
    expect(result.sales[0].isLongTerm).toBe(false);
  });

  it("chronological ordering — sell before buy in same set (by date)", () => {
    // If transactions are provided out of order, calculate() should sort by date
    const b = buy("2024-03-01", 1.0, 40000);
    const s = sell("2024-01-01", 0.5, 50000); // Earlier date, no lots available
    const result = calculate([b, s], AccountingMethod.FIFO);
    // The sell on Jan 1 happens before the buy on Mar 1 → no lots available
    expect(result.sales).toHaveLength(0);
    expect(result.warnings.length).toBeGreaterThan(0);
  });
});
