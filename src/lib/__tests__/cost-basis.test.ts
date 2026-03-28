import { describe, it, expect } from "vitest";
import { calculate, calculateUpTo, simulateSale, resolveRecordedSales, batchOptimizeSpecificId, optimizeLotSelections, daysBetween, isMoreThanOneYear, LotSelection } from "../cost-basis";
import { createTransaction, SaleRecord } from "../models";
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

function transferIn(date: string, amount: number, opts?: { exchange?: string; wallet?: string; sourceWallet?: string }): ReturnType<typeof createTransaction> {
  return {
    ...createTransaction({
      date: new Date(date + "T12:00:00").toISOString(),
      transactionType: TransactionType.TransferIn,
      amountBTC: amount,
      pricePerBTC: 0,
      totalUSD: 0,
      exchange: opts?.exchange ?? "Ledger",
      wallet: opts?.wallet ?? opts?.exchange ?? "Ledger",
      notes: "",
    }),
    sourceWallet: opts?.sourceWallet,
  };
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
    expect(result.warnings.some((w) => w.message.includes("Fell back to global"))).toBe(true);
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
  it("transfers without sourceWallet do not create lots or sales", () => {
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
// TRANSFER-IN LOT RE-TAGGING (sourceWallet)
// ═══════════════════════════════════════════════════════

describe("TransferIn lot re-tagging", () => {
  it("re-tags lots from sourceWallet to destination wallet", () => {
    const txns = [
      buy("2024-01-01", 1.0, 40000, { wallet: "Coinbase" }),
      transferIn("2024-03-01", 1.0, { wallet: "River", sourceWallet: "Coinbase" }),
    ];
    const result = calculate(txns, AccountingMethod.FIFO);
    // The lot should now be tagged "River" instead of "Coinbase"
    const lot = result.lots.find((l) => l.remainingBTC > 0);
    expect(lot).toBeDefined();
    expect(lot!.wallet).toBe("River");
    // No sales, no warnings
    expect(result.sales).toHaveLength(0);
    expect(result.warnings).toHaveLength(0);
  });

  it("re-tagged lots are usable for sell from destination wallet", () => {
    const txns = [
      buy("2024-01-01", 1.0, 40000, { wallet: "Coinbase" }),
      transferIn("2024-02-01", 1.0, { wallet: "River", sourceWallet: "Coinbase" }),
      sell("2024-06-01", 0.5, 60000, { wallet: "River" }),
    ];
    const result = calculate(txns, AccountingMethod.FIFO);
    expect(result.sales).toHaveLength(1);
    // Should sell from the re-tagged lot without wallet mismatch
    expect(result.sales[0].amountSold).toBeCloseTo(0.5, 8);
    expect(result.sales[0].costBasis).toBeCloseTo(20000, 2); // 0.5 * 40000
    expect(result.sales[0].walletMismatch).toBeFalsy();
  });

  it("preserves cost basis and holding period through transfer", () => {
    const txns = [
      buy("2023-01-01", 1.0, 30000, { wallet: "Coinbase" }),
      transferIn("2024-03-01", 1.0, { wallet: "River", sourceWallet: "Coinbase" }),
      sell("2024-06-01", 1.0, 60000, { wallet: "River" }),
    ];
    const result = calculate(txns, AccountingMethod.FIFO);
    expect(result.sales).toHaveLength(1);
    // Cost basis carries over from original buy
    expect(result.sales[0].costBasis).toBeCloseTo(30000, 2);
    // Holding period should be from Jan 2023 to Jun 2024 (long-term)
    expect(result.sales[0].isLongTerm).toBe(true);
  });

  it("partial transfer splits lot and re-tags only the transferred portion", () => {
    const txns = [
      buy("2024-01-01", 1.0, 40000, { wallet: "Coinbase" }),
      transferIn("2024-03-01", 0.6, { wallet: "River", sourceWallet: "Coinbase" }),
    ];
    const result = calculate(txns, AccountingMethod.FIFO);
    // Should have 2 lots now: 0.4 at Coinbase, 0.6 at River
    const coinbaseLots = result.lots.filter(
      (l) => l.remainingBTC > 0 && (l.wallet || "").toLowerCase() === "coinbase"
    );
    const riverLots = result.lots.filter(
      (l) => l.remainingBTC > 0 && (l.wallet || "").toLowerCase() === "river"
    );
    expect(coinbaseLots.reduce((s, l) => s + l.remainingBTC, 0)).toBeCloseTo(0.4, 8);
    expect(riverLots.reduce((s, l) => s + l.remainingBTC, 0)).toBeCloseTo(0.6, 8);
    // Cost basis carries over proportionally
    const riverLot = riverLots[0];
    expect(riverLot.totalCost).toBeCloseTo(0.6 * 40000, 2);
  });

  it("FIFO order: re-tags oldest lots first", () => {
    const txns = [
      buy("2024-01-01", 0.5, 30000, { wallet: "Coinbase" }),
      buy("2024-02-01", 0.5, 50000, { wallet: "Coinbase" }),
      transferIn("2024-03-01", 0.5, { wallet: "River", sourceWallet: "Coinbase" }),
      sell("2024-06-01", 0.5, 60000, { wallet: "River" }),
    ];
    const result = calculate(txns, AccountingMethod.FIFO);
    // Should have transferred the Jan lot (older, $30k), not the Feb lot ($50k)
    expect(result.sales).toHaveLength(1);
    expect(result.sales[0].costBasis).toBeCloseTo(15000, 2); // 0.5 * 30000
    expect(result.sales[0].walletMismatch).toBeFalsy();
  });

  it("multiple transfers chain correctly", () => {
    const txns = [
      buy("2024-01-01", 1.0, 40000, { wallet: "Coinbase" }),
      transferIn("2024-02-01", 1.0, { wallet: "ColdStorage", sourceWallet: "Coinbase" }),
      transferIn("2024-03-01", 1.0, { wallet: "River", sourceWallet: "ColdStorage" }),
      sell("2024-06-01", 1.0, 60000, { wallet: "River" }),
    ];
    const result = calculate(txns, AccountingMethod.FIFO);
    expect(result.sales).toHaveLength(1);
    expect(result.sales[0].costBasis).toBeCloseTo(40000, 2);
    expect(result.sales[0].walletMismatch).toBeFalsy();
  });

  it("warns when sourceWallet has insufficient lots", () => {
    const txns = [
      buy("2024-01-01", 0.5, 40000, { wallet: "Coinbase" }),
      transferIn("2024-03-01", 1.0, { wallet: "River", sourceWallet: "Coinbase" }),
    ];
    const result = calculate(txns, AccountingMethod.FIFO);
    // Should re-tag what's available (0.5) and warn about the missing 0.5
    expect(result.warnings.some((w) => w.message.includes("Could not find"))).toBe(true);
    const riverLots = result.lots.filter(
      (l) => l.remainingBTC > 0 && (l.wallet || "").toLowerCase() === "river"
    );
    expect(riverLots.reduce((s, l) => s + l.remainingBTC, 0)).toBeCloseTo(0.5, 8);
  });

  it("case-insensitive wallet matching for sourceWallet", () => {
    const txns = [
      buy("2024-01-01", 1.0, 40000, { wallet: "coinbase" }),
      transferIn("2024-03-01", 1.0, { wallet: "River", sourceWallet: "Coinbase" }),
      sell("2024-06-01", 1.0, 60000, { wallet: "River" }),
    ];
    const result = calculate(txns, AccountingMethod.FIFO);
    expect(result.sales).toHaveLength(1);
    expect(result.sales[0].walletMismatch).toBeFalsy();
  });

  it("without sourceWallet, TransferIn does nothing (backward compat)", () => {
    const txns = [
      buy("2024-01-01", 1.0, 40000, { wallet: "Coinbase" }),
      transferIn("2024-03-01", 1.0, { wallet: "River" }), // no sourceWallet
      sell("2024-06-01", 0.5, 60000, { wallet: "River" }),
    ];
    const result = calculate(txns, AccountingMethod.FIFO);
    // No lots at River, should fall back to global pool with mismatch warning
    expect(result.sales).toHaveLength(1);
    expect(result.sales[0].walletMismatch).toBe(true);
  });

  it("re-tagging works with batchOptimizeSpecificId", () => {
    const txns = [
      buy("2025-01-01", 1.0, 40000, { wallet: "Coinbase" }),
      transferIn("2025-02-01", 1.0, { wallet: "River", sourceWallet: "Coinbase" }),
      sell("2025-06-01", 0.5, 60000, { wallet: "River" }),
    ];
    const result = batchOptimizeSpecificId(txns, [], 2025);
    expect(result.records).toHaveLength(1);
    // Should not have wallet mismatches since lots are properly re-tagged
    expect(result.walletMismatches).toHaveLength(0);
  });
});

// ═══════════════════════════════════════════════════════
// TRANSFER-IN WITH SPECIFIC LOT SELECTIONS
// ═══════════════════════════════════════════════════════

describe("TransferIn with specific lot selections", () => {
  it("re-tags user-selected lots instead of FIFO oldest", () => {
    const b1 = buy("2024-01-01", 0.5, 30000, { wallet: "Coinbase" });
    const b2 = buy("2024-02-01", 0.5, 50000, { wallet: "Coinbase" });
    const xfer = {
      ...transferIn("2024-03-01", 0.5, { wallet: "River", sourceWallet: "Coinbase" }),
      transferLotSelections: [{ lotId: b2.id, amountBTC: 0.5 }], // Pick the NEWER lot
    };
    const result = calculate([b1, b2, xfer], AccountingMethod.FIFO);
    // The Feb lot ($50k) should be at River, Jan lot ($30k) stays at Coinbase
    const riverLots = result.lots.filter((l) => l.remainingBTC > 0 && l.wallet === "River");
    expect(riverLots).toHaveLength(1);
    expect(riverLots[0].pricePerBTC).toBeCloseTo(50000, 2);
    const coinbaseLots = result.lots.filter((l) => l.remainingBTC > 0 && (l.wallet || "").toLowerCase() === "coinbase");
    expect(coinbaseLots).toHaveLength(1);
    expect(coinbaseLots[0].pricePerBTC).toBeCloseTo(30000, 2);
  });

  it("partial transfer with selections splits correctly", () => {
    const b1 = buy("2024-01-01", 1.0, 40000, { wallet: "Coinbase" });
    const xfer = {
      ...transferIn("2024-03-01", 0.3, { wallet: "River", sourceWallet: "Coinbase" }),
      transferLotSelections: [{ lotId: b1.id, amountBTC: 0.3 }],
    };
    const result = calculate([b1, xfer], AccountingMethod.FIFO);
    const riverLots = result.lots.filter((l) => l.remainingBTC > 0 && l.wallet === "River");
    const coinbaseLots = result.lots.filter((l) => l.remainingBTC > 0 && (l.wallet || "").toLowerCase() === "coinbase");
    expect(riverLots.reduce((s, l) => s + l.remainingBTC, 0)).toBeCloseTo(0.3, 8);
    expect(coinbaseLots.reduce((s, l) => s + l.remainingBTC, 0)).toBeCloseTo(0.7, 8);
    // Cost basis proportional
    expect(riverLots[0].totalCost).toBeCloseTo(0.3 * 40000, 2);
  });

  it("FIFO fallback when no selections (backward compat)", () => {
    const b1 = buy("2024-01-01", 0.5, 30000, { wallet: "Coinbase" });
    const b2 = buy("2024-02-01", 0.5, 50000, { wallet: "Coinbase" });
    const xfer = transferIn("2024-03-01", 0.5, { wallet: "River", sourceWallet: "Coinbase" });
    // No transferLotSelections — should use FIFO (oldest = Jan lot)
    const result = calculate([b1, b2, xfer], AccountingMethod.FIFO);
    const riverLots = result.lots.filter((l) => l.remainingBTC > 0 && l.wallet === "River");
    expect(riverLots).toHaveLength(1);
    expect(riverLots[0].pricePerBTC).toBeCloseTo(30000, 2); // FIFO = oldest
  });

  it("mixed: selections + FIFO remainder", () => {
    const b1 = buy("2024-01-01", 0.5, 30000, { wallet: "Coinbase" });
    const b2 = buy("2024-02-01", 0.5, 50000, { wallet: "Coinbase" });
    const xfer = {
      ...transferIn("2024-03-01", 0.8, { wallet: "River", sourceWallet: "Coinbase" }),
      transferLotSelections: [{ lotId: b2.id, amountBTC: 0.5 }], // Pick 0.5 from Feb lot
    };
    // Needs 0.3 more — FIFO fills from Jan lot
    const result = calculate([b1, b2, xfer], AccountingMethod.FIFO);
    const riverLots = result.lots.filter((l) => l.remainingBTC > 0 && l.wallet === "River");
    const totalAtRiver = riverLots.reduce((s, l) => s + l.remainingBTC, 0);
    expect(totalAtRiver).toBeCloseTo(0.8, 8);
    // Both lots should be at River
    expect(riverLots).toHaveLength(2);
  });

  it("lot not found in selections — skip with warning, FIFO fills", () => {
    const b1 = buy("2024-01-01", 1.0, 40000, { wallet: "Coinbase" });
    const xfer = {
      ...transferIn("2024-03-01", 0.5, { wallet: "River", sourceWallet: "Coinbase" }),
      transferLotSelections: [{ lotId: "nonexistent-id", amountBTC: 0.5 }],
    };
    const result = calculate([b1, xfer], AccountingMethod.FIFO);
    // Should warn about the missing lot
    expect(result.warnings.some((w) => w.message.includes("not found"))).toBe(true);
    // FIFO fallback should still transfer the BTC
    const riverLots = result.lots.filter((l) => l.remainingBTC > 0 && l.wallet === "River");
    expect(riverLots.reduce((s, l) => s + l.remainingBTC, 0)).toBeCloseTo(0.5, 8);
  });

  it("selected lot in wrong wallet is skipped", () => {
    const b1 = buy("2024-01-01", 1.0, 40000, { wallet: "Coinbase" });
    const b2 = buy("2024-02-01", 0.5, 50000, { wallet: "Kraken" });
    const xfer = {
      ...transferIn("2024-03-01", 0.5, { wallet: "River", sourceWallet: "Coinbase" }),
      transferLotSelections: [{ lotId: b2.id, amountBTC: 0.5 }], // Kraken lot, not Coinbase
    };
    const result = calculate([b1, b2, xfer], AccountingMethod.FIFO);
    // b2 is at Kraken, not Coinbase — should skip and use FIFO from Coinbase
    expect(result.warnings.some((w) => w.message.includes("not found"))).toBe(true);
    const riverLots = result.lots.filter((l) => l.remainingBTC > 0 && l.wallet === "River");
    expect(riverLots).toHaveLength(1);
    // FIFO picked the Coinbase lot at $40k
    expect(riverLots[0].pricePerBTC).toBeCloseTo(40000, 2);
  });

  it("empty transferLotSelections treated same as absent", () => {
    const b1 = buy("2024-01-01", 1.0, 40000, { wallet: "Coinbase" });
    const xfer = {
      ...transferIn("2024-03-01", 1.0, { wallet: "River", sourceWallet: "Coinbase" }),
      transferLotSelections: [], // explicit empty
    };
    const result = calculate([b1, xfer], AccountingMethod.FIFO);
    const riverLots = result.lots.filter((l) => l.remainingBTC > 0 && l.wallet === "River");
    expect(riverLots).toHaveLength(1);
    expect(riverLots[0].pricePerBTC).toBeCloseTo(40000, 2);
  });

  it("multi-hop provenance: exchange → cold storage → exchange → sell with correct cost basis", () => {
    const b1 = buy("2024-01-01", 0.5, 30000, { wallet: "Coinbase" });
    const b2 = buy("2024-02-01", 0.5, 50000, { wallet: "Coinbase" });
    // Move the $50k lot to cold storage (specific pick)
    const xfer1 = {
      ...transferIn("2024-03-01", 0.5, { wallet: "Ledger", sourceWallet: "Coinbase" }),
      transferLotSelections: [{ lotId: b2.id, amountBTC: 0.5 }],
    };
    // Move it from cold storage to Kraken for sale
    // The lot now has a split ID from the first transfer — need to find it
    const result1 = calculate([b1, b2, xfer1], AccountingMethod.FIFO);
    const ledgerLot = result1.lots.find((l) => l.remainingBTC > 0 && l.wallet === "Ledger");
    expect(ledgerLot).toBeDefined();

    const xfer2 = {
      ...transferIn("2024-05-01", 0.5, { wallet: "Kraken", sourceWallet: "Ledger" }),
      transferLotSelections: [{ lotId: ledgerLot!.id, amountBTC: 0.5 }],
    };
    const s1 = sell("2024-06-01", 0.5, 60000, { wallet: "Kraken" });
    const result = calculate([b1, b2, xfer1, xfer2, s1], AccountingMethod.FIFO);

    expect(result.sales).toHaveLength(1);
    // Should use the $50k cost basis that traveled Coinbase → Ledger → Kraken
    expect(result.sales[0].costBasis).toBeCloseTo(25000, 2); // 0.5 * 50000
    expect(result.sales[0].walletMismatch).toBeFalsy();
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

// ═══════════════════════════════════════════════════════
// SHARED RESOLVER — resolveRecordedSales()
// ═══════════════════════════════════════════════════════

describe("resolveRecordedSales — legacy collision handling", () => {
  /** Helper to build a legacy SaleRecord (no sourceTransactionId) */
  function legacyRecord(saleDate: string, amountSold: number, opts?: { isDonation?: boolean; costBasis?: number }): SaleRecord {
    return {
      id: crypto.randomUUID(),
      saleDate: new Date(saleDate + "T12:00:00").toISOString(),
      amountSold,
      salePricePerBTC: opts?.isDonation ? 0 : 50000,
      totalProceeds: opts?.isDonation ? 0 : amountSold * 50000,
      costBasis: opts?.costBasis ?? amountSold * 30000,
      gainLoss: opts?.isDonation ? 0 : amountSold * 50000 - (opts?.costBasis ?? amountSold * 30000),
      lotDetails: [{ id: crypto.randomUUID(), purchaseDate: "2024-01-01T12:00:00.000Z", amountBTC: amountSold, costBasisPerBTC: 30000, totalCost: amountSold * 30000, daysHeld: 180, exchange: "Coinbase", isLongTerm: false }],
      holdingPeriodDays: 180,
      isLongTerm: false,
      isMixedTerm: false,
      method: AccountingMethod.SpecificID,
      isDonation: opts?.isDonation || undefined,
      // No sourceTransactionId — this is the legacy format
    };
  }

  it("two legacy records with same date|amount|type map one-to-one deterministically", () => {
    // Two sells on the same day for the same amount — each should get its own legacy record
    const s1 = sell("2024-06-15", 0.5, 50000);
    const s2 = sell("2024-06-15", 0.5, 50000);
    const b1 = buy("2024-01-01", 2.0, 30000);

    const rec1 = legacyRecord("2024-06-15", 0.5);
    const rec2 = legacyRecord("2024-06-15", 0.5);

    const resolved = resolveRecordedSales([b1, s1, s2], [rec1, rec2]);

    // Both sells should be matched, each to a different record
    expect(resolved.has(s1.id)).toBe(true);
    expect(resolved.has(s2.id)).toBe(true);
    expect(resolved.get(s1.id)!.id).not.toBe(resolved.get(s2.id)!.id);
    // First chronological sell gets the first record (shift order)
    expect(resolved.get(s1.id)!.id).toBe(rec1.id);
    expect(resolved.get(s2.id)!.id).toBe(rec2.id);
  });

  it("legacy type discrimination — sell record does not match donation transaction", () => {
    const s1 = sell("2024-06-15", 0.5, 50000);
    const d1 = donation("2024-06-15", 0.5, 50000);
    const b1 = buy("2024-01-01", 2.0, 30000);

    // Only a sale-type legacy record exists (no donation record)
    const saleRec = legacyRecord("2024-06-15", 0.5, { isDonation: false });

    const resolved = resolveRecordedSales([b1, s1, d1], [saleRec]);

    expect(resolved.has(s1.id)).toBe(true); // Sale matches sale record
    expect(resolved.has(d1.id)).toBe(false); // Donation does NOT match sale record
  });

  it("delete cascade — resolver does not match Buy transaction to legacy sale record", () => {
    // A Buy with the same date+amount as a legacy sale record should NOT be matched
    const b1 = buy("2024-06-15", 0.5, 50000);
    const s1 = sell("2024-06-15", 0.5, 50000);
    const b2 = buy("2024-01-01", 2.0, 30000);

    const saleRec = legacyRecord("2024-06-15", 0.5);

    const resolved = resolveRecordedSales([b2, b1, s1], [saleRec]);

    // Only the sell should be matched, not the buy
    expect(resolved.has(s1.id)).toBe(true);
    expect(resolved.has(b1.id)).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════
// calculateUpTo — excludeSaleRecordId
// ═══════════════════════════════════════════════════════

describe("calculateUpTo — legacy record exclusion", () => {
  it("excludes target transaction's own SaleRecord to prevent legacy key contamination", () => {
    // Setup: buy 2 BTC, then two sells of 0.5 BTC on the same day
    const b1 = buy("2024-01-01", 2.0, 30000);
    const s1 = sell("2024-06-15", 0.5, 50000);
    const s2 = sell("2024-06-15", 0.5, 50000);

    // Both sells have legacy Specific ID records (no sourceTransactionId)
    const rec1: SaleRecord = {
      id: crypto.randomUUID(),
      saleDate: s1.date,
      amountSold: 0.5,
      salePricePerBTC: 50000,
      totalProceeds: 25000,
      costBasis: 15000,
      gainLoss: 10000,
      lotDetails: [{ id: crypto.randomUUID(), lotId: b1.id, purchaseDate: b1.date, amountBTC: 0.5, costBasisPerBTC: 30000, totalCost: 15000, daysHeld: 166, exchange: "Coinbase", isLongTerm: false }],
      holdingPeriodDays: 166,
      isLongTerm: false,
      isMixedTerm: false,
      method: AccountingMethod.SpecificID,
    };
    const rec2: SaleRecord = {
      id: crypto.randomUUID(),
      saleDate: s2.date,
      amountSold: 0.5,
      salePricePerBTC: 50000,
      totalProceeds: 25000,
      costBasis: 15000,
      gainLoss: 10000,
      lotDetails: [{ id: crypto.randomUUID(), lotId: b1.id, purchaseDate: b1.date, amountBTC: 0.5, costBasisPerBTC: 30000, totalCost: 15000, daysHeld: 166, exchange: "Coinbase", isLongTerm: false }],
      holdingPeriodDays: 166,
      isLongTerm: false,
      isMixedTerm: false,
      method: AccountingMethod.SpecificID,
    };

    const allTxns = [b1, s1, s2];
    const allRecords = [rec1, rec2];

    // Calculate up to s2, excluding s2's own record (rec2).
    // Without exclusion, rec2 could be consumed by s1 (same legacy key),
    // making s1 consume 2 records and s2 consume 0.
    const result = calculateUpTo(allTxns, AccountingMethod.FIFO, s2.id, allRecords, rec2.id);

    // s1 should consume 0.5 BTC via rec1 (Specific ID), leaving 1.5 BTC available
    const availableBTC = result.lots.reduce((sum, l) => sum + l.remainingBTC, 0);
    expect(availableBTC).toBeCloseTo(1.5, 8);
  });
});

// ═══════════════════════════════════════════════════════
// AUDIT FIX: batchOptimizeSpecificId rejects partial fills
// ═══════════════════════════════════════════════════════

describe("batchOptimizeSpecificId — partial fill rejection", () => {
  it("skips a sell when available lots cannot fully cover the disposition", () => {
    // Buy 0.5 BTC, then try to sell 1.0 BTC — insufficient inventory
    const b1 = buy("2025-01-01", 0.5, 40000);
    const s1 = sell("2025-06-01", 1.0, 50000);
    const txns = [b1, s1];

    const result = batchOptimizeSpecificId(txns, [], 2025);

    // Should skip (not create a partial record)
    expect(result.records).toHaveLength(0);
    expect(result.skipped).toBe(1);
    expect(result.failed).toContain(s1.id);
  });

  it("succeeds when lots fully cover the disposition", () => {
    const b1 = buy("2025-01-01", 1.0, 40000);
    const s1 = sell("2025-06-01", 0.5, 50000);
    const txns = [b1, s1];

    const result = batchOptimizeSpecificId(txns, [], 2025);

    expect(result.records).toHaveLength(1);
    expect(result.skipped).toBe(0);
    expect(result.failed).toHaveLength(0);
  });

  it("skips partially-coverable sells but succeeds on fully-coverable ones", () => {
    // Buy 0.8 BTC total, sell 0.5 then sell 0.5 — second sell only has 0.3 left
    const b1 = buy("2025-01-01", 0.8, 40000);
    const s1 = sell("2025-06-01", 0.5, 50000);
    const s2 = sell("2025-06-02", 0.5, 50000);
    const txns = [b1, s1, s2];

    const result = batchOptimizeSpecificId(txns, [], 2025);

    // First sell succeeds (0.5 <= 0.8), second fails (0.5 > 0.3 remaining)
    expect(result.records).toHaveLength(1);
    expect(result.records[0].sourceTransactionId).toBe(s1.id);
    expect(result.skipped).toBe(1);
    expect(result.failed).toContain(s2.id);
  });
});

// ═══════════════════════════════════════════════════════
// AUDIT FIX: optimizeLotSelections returns partial when insufficient
// ═══════════════════════════════════════════════════════

describe("optimizeLotSelections — partial fill behavior", () => {
  it("returns partial selections when lots are insufficient", () => {
    const b1 = buy("2025-01-01", 0.5, 40000);
    const result = calculate([b1], AccountingMethod.FIFO, []);
    const lots = result.lots;

    // Request 1.0 BTC but only 0.5 available
    const selections = optimizeLotSelections(lots, 1.0, 50000, "2025-06-01");

    const totalSelected = selections.reduce((sum, s) => sum + s.amountBTC, 0);
    expect(totalSelected).toBeCloseTo(0.5, 8);
    expect(totalSelected).toBeLessThan(1.0);
  });
});

// ═══════════════════════════════════════════════════════
// Donation optimization: lowest cost basis first
// ═══════════════════════════════════════════════════════

describe("optimizeLotSelections — donation mode (isDonation=true)", () => {
  it("picks lowest cost basis lot first for donations", () => {
    const bLow = buy("2024-01-01", 1.0, 10000);   // low basis
    const bHigh = buy("2024-02-01", 1.0, 50000);   // high basis
    const result = calculate([bLow, bHigh], AccountingMethod.FIFO, []);

    // Donate 1.0 BTC — should pick the low-basis lot to eliminate more embedded gain
    const selections = optimizeLotSelections(result.lots, 1.0, undefined, "2025-06-01", true);

    expect(selections).toHaveLength(1);
    expect(selections[0].lotId).toBe(bLow.id);
    expect(selections[0].amountBTC).toBeCloseTo(1.0, 8);
  });

  it("prefers long-term lots over short-term for donations", () => {
    const bLongTerm = buy("2023-01-01", 1.0, 30000);  // long-term, higher basis
    const bShortTerm = buy("2025-03-01", 1.0, 10000);  // short-term, lower basis
    const result = calculate([bLongTerm, bShortTerm], AccountingMethod.FIFO, []);

    // Donate 1.0 BTC — long-term should win (FMV deduction) even though short-term has lower basis
    const selections = optimizeLotSelections(result.lots, 1.0, undefined, "2025-06-01", true);

    expect(selections).toHaveLength(1);
    expect(selections[0].lotId).toBe(bLongTerm.id);
  });

  it("within long-term lots, picks lowest basis first for donations", () => {
    const bLow = buy("2023-01-01", 1.0, 10000);   // long-term, low basis
    const bHigh = buy("2023-06-01", 1.0, 50000);   // long-term, high basis
    const result = calculate([bLow, bHigh], AccountingMethod.FIFO, []);

    // Donate 1.0 BTC — both long-term, should pick lowest basis
    const selections = optimizeLotSelections(result.lots, 1.0, undefined, "2025-06-01", true);

    expect(selections).toHaveLength(1);
    expect(selections[0].lotId).toBe(bLow.id);
  });

  it("sale optimization (isDonation=false) still picks highest basis", () => {
    const bLow = buy("2024-01-01", 1.0, 10000);
    const bHigh = buy("2024-02-01", 1.0, 50000);
    const result = calculate([bLow, bHigh], AccountingMethod.FIFO, []);

    // Sale fallback (no salePrice) — should pick highest basis
    const selections = optimizeLotSelections(result.lots, 1.0, undefined, "2025-06-01", false);

    expect(selections).toHaveLength(1);
    expect(selections[0].lotId).toBe(bHigh.id);
  });
});

// ═══════════════════════════════════════════════════════
// Engine Guard: stale lotId in extractLotSelections → FIFO fallback
// ═══════════════════════════════════════════════════════

describe("extractLotSelections engine guard (stale lotId fallback)", () => {
  it("falls back to FIFO with warning when recorded election references a deleted Buy", () => {
    const b1 = buy("2024-01-01", 1.0, 30000);
    const b2 = buy("2024-02-01", 1.0, 35000);
    const s1 = sell("2024-06-15", 0.5, 50000);

    // Create a Specific ID election referencing b1
    const record: SaleRecord = {
      id: crypto.randomUUID(),
      saleDate: s1.date,
      amountSold: 0.5,
      salePricePerBTC: 50000,
      totalProceeds: 25000,
      costBasis: 15000,
      gainLoss: 10000,
      lotDetails: [{ id: crypto.randomUUID(), lotId: b1.id, purchaseDate: b1.date, amountBTC: 0.5, costBasisPerBTC: 30000, totalCost: 15000, daysHeld: 166, exchange: "Coinbase", isLongTerm: false }],
      holdingPeriodDays: 166,
      isLongTerm: false,
      isMixedTerm: false,
      method: AccountingMethod.SpecificID,
      sourceTransactionId: s1.id,
    };

    // Calculate WITHOUT b1 (simulating it was deleted) — election references a missing lot
    const result = calculate([b2, s1], AccountingMethod.FIFO, [record]);

    // Should fall back to FIFO (using b2), not silently produce wrong cost basis
    expect(result.sales).toHaveLength(1);
    expect(result.sales[0].costBasis).toBeCloseTo(0.5 * 35000, 2); // b2 cost basis, not b1's
    expect(result.warnings.some((w) => w.message.includes("could not be applied") && w.message.includes("Edit Lots"))).toBe(true);
  });

  it("applies election normally when all referenced lots exist", () => {
    const b1 = buy("2024-01-01", 1.0, 30000);
    const b2 = buy("2024-02-01", 1.0, 35000);
    const s1 = sell("2024-06-15", 0.5, 50000);

    const record: SaleRecord = {
      id: crypto.randomUUID(),
      saleDate: s1.date,
      amountSold: 0.5,
      salePricePerBTC: 50000,
      totalProceeds: 25000,
      costBasis: 15000,
      gainLoss: 10000,
      lotDetails: [{ id: crypto.randomUUID(), lotId: b1.id, purchaseDate: b1.date, amountBTC: 0.5, costBasisPerBTC: 30000, totalCost: 15000, daysHeld: 166, exchange: "Coinbase", isLongTerm: false }],
      holdingPeriodDays: 166,
      isLongTerm: false,
      isMixedTerm: false,
      method: AccountingMethod.SpecificID,
      sourceTransactionId: s1.id,
    };

    // Both buys present — election should apply correctly using b1
    const result = calculate([b1, b2, s1], AccountingMethod.FIFO, [record]);

    expect(result.sales).toHaveLength(1);
    expect(result.sales[0].costBasis).toBeCloseTo(0.5 * 30000, 2); // b1 cost basis
    expect(result.warnings.filter((w) => w.message.includes("could not be applied"))).toHaveLength(0);
  });

  it("falls back when one of multiple referenced lots is missing", () => {
    const b1 = buy("2024-01-01", 1.0, 30000);
    const b2 = buy("2024-02-01", 1.0, 35000);
    const s1 = sell("2024-06-15", 1.0, 50000);

    // Election references BOTH b1 and b2
    const record: SaleRecord = {
      id: crypto.randomUUID(),
      saleDate: s1.date,
      amountSold: 1.0,
      salePricePerBTC: 50000,
      totalProceeds: 50000,
      costBasis: 32500,
      gainLoss: 17500,
      lotDetails: [
        { id: crypto.randomUUID(), lotId: b1.id, purchaseDate: b1.date, amountBTC: 0.5, costBasisPerBTC: 30000, totalCost: 15000, daysHeld: 166, exchange: "Coinbase", isLongTerm: false },
        { id: crypto.randomUUID(), lotId: b2.id, purchaseDate: b2.date, amountBTC: 0.5, costBasisPerBTC: 35000, totalCost: 17500, daysHeld: 135, exchange: "Coinbase", isLongTerm: false },
      ],
      holdingPeriodDays: 150,
      isLongTerm: false,
      isMixedTerm: false,
      method: AccountingMethod.SpecificID,
      sourceTransactionId: s1.id,
    };

    // Only b2 present (b1 deleted) — entire election should fail, fall back to FIFO
    const result = calculate([b2, s1], AccountingMethod.FIFO, [record]);

    expect(result.sales).toHaveLength(1);
    // FIFO with only b2 available: 1.0 BTC at $35k
    expect(result.sales[0].costBasis).toBeCloseTo(1.0 * 35000, 2);
    expect(result.warnings.some((w) => w.message.includes("could not be applied"))).toBe(true);
  });

  it("warning message tells user to use Edit Lots button", () => {
    const b1 = buy("2024-01-01", 1.0, 30000);
    const s1 = sell("2024-06-15", 0.5, 50000);

    const record: SaleRecord = {
      id: crypto.randomUUID(),
      saleDate: s1.date,
      amountSold: 0.5,
      salePricePerBTC: 50000,
      totalProceeds: 25000,
      costBasis: 15000,
      gainLoss: 10000,
      lotDetails: [{ id: crypto.randomUUID(), lotId: b1.id, purchaseDate: b1.date, amountBTC: 0.5, costBasisPerBTC: 30000, totalCost: 15000, daysHeld: 166, exchange: "Coinbase", isLongTerm: false }],
      holdingPeriodDays: 166,
      isLongTerm: false,
      isMixedTerm: false,
      method: AccountingMethod.SpecificID,
      sourceTransactionId: s1.id,
    };

    // b1 is missing — triggers the fallback warning
    const result = calculate([sell("2024-03-01", 0.1, 40000), s1], AccountingMethod.FIFO, [record]);

    const warning = result.warnings.find((w) => w.message.includes("could not be applied"));
    expect(warning).toBeDefined();
    expect(warning!.message).toContain("Edit Lots");
    expect(warning!.message).toContain("no longer exist or were modified");
  });
});

// ═══════════════════════════════════════════════════════
// Cross-wallet Specific ID — engine must honor elections
// ═══════════════════════════════════════════════════════

describe("cross-wallet Specific ID elections", () => {
  it("calculate() honors cross-wallet lot selections via recorded SaleRecord", () => {
    const b1 = buy("2024-01-01", 1.0, 30000, { wallet: "Coinbase" });
    const b2 = buy("2024-02-01", 1.0, 40000, { wallet: "Ledger" });
    const s1 = sell("2024-06-01", 0.5, 60000, { wallet: "Coinbase" });

    // User explicitly elected the Ledger lot for a Coinbase sale (cross-wallet)
    const record: SaleRecord = {
      id: "rec-cross-1",
      saleDate: s1.date,
      amountSold: 0.5,
      salePricePerBTC: 60000,
      totalProceeds: 30000,
      costBasis: 20000,
      gainLoss: 10000,
      holdingPeriodDays: 150,
      isLongTerm: false,
      isMixedTerm: false,
      method: AccountingMethod.SpecificID,
      sourceTransactionId: s1.id,
      lotDetails: [{
        id: "ld-1",
        lotId: b2.id, // Ledger lot — different wallet than sale
        purchaseDate: b2.date,
        amountBTC: 0.5,
        costBasisPerBTC: 40000,
        totalCost: 20000,
        daysHeld: 150,
        exchange: "Ledger",
        wallet: "Ledger",
        isLongTerm: false,
      }],
    };

    const result = calculate([b1, b2, s1], AccountingMethod.FIFO, [record]);

    expect(result.sales).toHaveLength(1);
    // Must use the Ledger lot ($40k basis), NOT fall back to Coinbase FIFO ($30k basis)
    expect(result.sales[0].costBasis).toBeCloseTo(20000, 0); // 0.5 * 40000
    expect(result.sales[0].gainLoss).toBeCloseTo(10000, 0); // 30000 - 20000
    expect(result.sales[0].method).toBe(AccountingMethod.SpecificID);
    expect(result.sales[0].walletMismatch).toBe(true); // tagged for warning
    expect(result.sales[0].lotDetails[0].wallet).toBe("Ledger");
  });

  it("simulateSale() honors cross-wallet lots when wallet is undefined", () => {
    const b1 = buy("2024-01-01", 1.0, 30000, { wallet: "Coinbase" });
    const b2 = buy("2024-02-01", 1.0, 50000, { wallet: "Ledger" });

    const lots = calculate([b1, b2], AccountingMethod.FIFO).lots;
    const selections: LotSelection[] = [{ lotId: b2.id, amountBTC: 0.5 }];

    // wallet=undefined simulates showAllWallets=true
    const sim = simulateSale(0.5, 60000, lots, AccountingMethod.SpecificID, selections, undefined, "2024-06-01");

    expect(sim).not.toBeNull();
    expect(sim!.amountSold).toBeCloseTo(0.5, 8);
    expect(sim!.costBasis).toBeCloseTo(25000, 0); // 0.5 * 50000
  });

  it("simulateSale() honors cross-wallet lots when wallet IS specified", () => {
    const b1 = buy("2024-01-01", 1.0, 30000, { wallet: "Coinbase" });
    const b2 = buy("2024-02-01", 1.0, 50000, { wallet: "Ledger" });

    const lots = calculate([b1, b2], AccountingMethod.FIFO).lots;
    const selections: LotSelection[] = [{ lotId: b2.id, amountBTC: 0.5 }];

    // wallet="Coinbase" — sale is from Coinbase but user elected Ledger lot
    const sim = simulateSale(0.5, 60000, lots, AccountingMethod.SpecificID, selections, "Coinbase", "2024-06-01");

    expect(sim).not.toBeNull();
    expect(sim!.amountSold).toBeCloseTo(0.5, 8);
    expect(sim!.costBasis).toBeCloseTo(25000, 0); // must use Ledger lot, not Coinbase
    expect(sim!.walletMismatch).toBe(true);
  });

  it("FIFO auto-selection still wallet-filters correctly", () => {
    const b1 = buy("2024-01-01", 1.0, 30000, { wallet: "Coinbase" });
    const b2 = buy("2024-02-01", 1.0, 50000, { wallet: "Ledger" });
    const s1 = sell("2024-06-01", 0.5, 60000, { wallet: "Coinbase" });

    // No recorded sales — FIFO should pick from Coinbase only
    const result = calculate([b1, b2, s1], AccountingMethod.FIFO);

    expect(result.sales).toHaveLength(1);
    expect(result.sales[0].costBasis).toBeCloseTo(15000, 0); // 0.5 * 30000 (Coinbase lot)
    expect(result.sales[0].walletMismatch).toBeFalsy();
  });

  it("cross-wallet election with mixed wallets in lotDetails", () => {
    const b1 = buy("2024-01-01", 1.0, 30000, { wallet: "Coinbase" });
    const b2 = buy("2024-02-01", 1.0, 50000, { wallet: "Ledger" });
    const s1 = sell("2024-06-01", 0.8, 60000, { wallet: "Coinbase" });

    // User elected lots from BOTH wallets
    const record: SaleRecord = {
      id: "rec-mixed-1",
      saleDate: s1.date,
      amountSold: 0.8,
      salePricePerBTC: 60000,
      totalProceeds: 48000,
      costBasis: 29000,
      gainLoss: 19000,
      holdingPeriodDays: 150,
      isLongTerm: false,
      isMixedTerm: false,
      method: AccountingMethod.SpecificID,
      sourceTransactionId: s1.id,
      lotDetails: [
        {
          id: "ld-m1", lotId: b1.id, purchaseDate: b1.date, amountBTC: 0.5,
          costBasisPerBTC: 30000, totalCost: 15000, daysHeld: 150,
          exchange: "Coinbase", wallet: "Coinbase", isLongTerm: false,
        },
        {
          id: "ld-m2", lotId: b2.id, purchaseDate: b2.date, amountBTC: 0.3,
          costBasisPerBTC: 50000, totalCost: 15000, daysHeld: 120,
          exchange: "Ledger", wallet: "Ledger", isLongTerm: false,
        },
      ],
    };

    const result = calculate([b1, b2, s1], AccountingMethod.FIFO, [record]);

    expect(result.sales).toHaveLength(1);
    // Cost = 0.5 * 30000 + 0.3 * 50000 = 15000 + 15000 = 30000
    expect(result.sales[0].costBasis).toBeCloseTo(30000, 0);
    expect(result.sales[0].amountSold).toBeCloseTo(0.8, 8);
    expect(result.sales[0].lotDetails).toHaveLength(2);
    expect(result.sales[0].walletMismatch).toBe(true);
  });

  it("cross-wallet donation election is honored", () => {
    const b1 = buy("2024-01-01", 1.0, 30000, { wallet: "Coinbase" });
    const b2 = buy("2024-02-01", 1.0, 50000, { wallet: "Ledger" });
    const d1 = donation("2024-06-01", 0.5, 60000, { wallet: "Coinbase" });

    const record: SaleRecord = {
      id: "rec-don-1",
      saleDate: d1.date,
      amountSold: 0.5,
      salePricePerBTC: 0,
      totalProceeds: 0,
      costBasis: 25000,
      gainLoss: 0,
      holdingPeriodDays: 150,
      isLongTerm: false,
      isMixedTerm: false,
      isDonation: true,
      method: AccountingMethod.SpecificID,
      sourceTransactionId: d1.id,
      lotDetails: [{
        id: "ld-d1", lotId: b2.id, purchaseDate: b2.date, amountBTC: 0.5,
        costBasisPerBTC: 50000, totalCost: 25000, daysHeld: 150,
        exchange: "Ledger", wallet: "Ledger", isLongTerm: false,
      }],
    };

    const result = calculate([b1, b2, d1], AccountingMethod.FIFO, [record]);

    expect(result.sales).toHaveLength(1);
    expect(result.sales[0].costBasis).toBeCloseTo(25000, 0); // Ledger lot honored
    expect(result.sales[0].isDonation).toBe(true);
    expect(result.sales[0].walletMismatch).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════
// P1 #1: extractLotSelections remaining amount check
// A Specific ID election that requests more BTC than the lot has remaining
// must trigger atomic fallback (return null → FIFO), NOT a silent partial fill.
// ═══════════════════════════════════════════════════════

describe("extractLotSelections rejects insufficient remaining amount", () => {
  it("falls back to FIFO when lot has less BTC than election requests (transfer amount reduced)", () => {
    // Buy 1.0 BTC in Coinbase, transfer 0.5 to Ledger (was 0.8, now reduced)
    const b1 = buy("2024-01-01", 1.0, 30000, { wallet: "Coinbase" });
    const b2 = buy("2024-02-01", 1.0, 50000, { wallet: "Ledger" });
    const t1 = transferIn("2024-03-01", 0.5, { wallet: "Ledger", sourceWallet: "Coinbase" });
    const s1 = sell("2024-06-15", 0.8, 60000, { wallet: "Ledger" });

    // Election was created when transfer was 0.8 BTC — references the split lot for 0.8 BTC
    // The split lot ID would be `b1.id + "-xfer-" + t1.id.slice(0,8)`
    const splitLotId = b1.id + "-xfer-" + t1.id.slice(0, 8);
    const record: SaleRecord = {
      id: crypto.randomUUID(),
      saleDate: s1.date,
      amountSold: 0.8,
      salePricePerBTC: 60000,
      totalProceeds: 48000,
      costBasis: 24000,
      gainLoss: 24000,
      lotDetails: [{
        id: crypto.randomUUID(),
        lotId: splitLotId,
        purchaseDate: b1.date,
        amountBTC: 0.8, // Election requested 0.8 BTC
        costBasisPerBTC: 30000,
        totalCost: 24000,
        daysHeld: 166,
        exchange: "Coinbase",
        wallet: "Ledger", // Lot was in Ledger when election was made
        isLongTerm: false,
      }],
      holdingPeriodDays: 166,
      isLongTerm: false,
      isMixedTerm: false,
      method: AccountingMethod.SpecificID,
      sourceTransactionId: s1.id,
    };

    // Transfer is now 0.5 BTC → split lot only has 0.5 remaining
    // Election requests 0.8 → must fail atomically, not silently sell 0.5
    const result = calculate([b1, b2, t1, s1], AccountingMethod.FIFO, [record]);

    expect(result.sales).toHaveLength(1);
    // FIFO fallback: should use Ledger lots (b2 has 1.0 BTC + split lot has 0.5)
    // NOT a partial 0.5 BTC sale — must sell the full 0.8 BTC via FIFO
    expect(result.sales[0].amountSold).toBeCloseTo(0.8, 8);
    expect(result.warnings.some((w) => w.message.includes("could not be applied"))).toBe(true);
  });

  it("applies election normally when lot has exactly enough remaining", () => {
    const b1 = buy("2024-01-01", 1.0, 30000, { wallet: "Coinbase" });
    const s1 = sell("2024-06-15", 0.5, 60000, { wallet: "Coinbase" });

    const record: SaleRecord = {
      id: crypto.randomUUID(),
      saleDate: s1.date,
      amountSold: 0.5,
      salePricePerBTC: 60000,
      totalProceeds: 30000,
      costBasis: 15000,
      gainLoss: 15000,
      lotDetails: [{
        id: crypto.randomUUID(),
        lotId: b1.id,
        purchaseDate: b1.date,
        amountBTC: 0.5,
        costBasisPerBTC: 30000,
        totalCost: 15000,
        daysHeld: 166,
        exchange: "Coinbase",
        wallet: "Coinbase",
        isLongTerm: false,
      }],
      holdingPeriodDays: 166,
      isLongTerm: false,
      isMixedTerm: false,
      method: AccountingMethod.SpecificID,
      sourceTransactionId: s1.id,
    };

    const result = calculate([b1, s1], AccountingMethod.FIFO, [record]);
    expect(result.sales).toHaveLength(1);
    expect(result.sales[0].costBasis).toBeCloseTo(15000, 2);
    expect(result.sales[0].method).toBe(AccountingMethod.SpecificID);
    expect(result.warnings.filter((w) => w.message.includes("could not be applied"))).toHaveLength(0);
  });
});

// ═══════════════════════════════════════════════════════
// P1 #2: extractLotSelections wallet stability check
// When a lot's wallet has changed since the election was recorded (e.g., transfer
// re-routing), the election is stale and must fall back to FIFO.
// Intentional cross-wallet elections (lot wallet matches recorded wallet) are NOT affected.
// ═══════════════════════════════════════════════════════

describe("extractLotSelections detects stale wallet after transfer re-routing", () => {
  it("falls back to FIFO when lot wallet changed since election (transfer re-routed)", () => {
    // Setup: Coinbase lot ($30k) and Kraken lot ($50k)
    const b1 = buy("2024-01-01", 1.0, 30000, { wallet: "Coinbase" });
    const b2 = buy("2024-02-01", 1.0, 50000, { wallet: "Kraken" });
    // Transfer was from Coinbase→Ledger, but is now Kraken→Ledger
    const t1 = transferIn("2024-03-01", 1.0, { wallet: "Ledger", sourceWallet: "Kraken" });
    const s1 = sell("2024-06-15", 0.5, 60000, { wallet: "Ledger" });

    // Election was made when transfer source was Coinbase — b1 lot was in Ledger
    // Now transfer source is Kraken — b1 lot is back in Coinbase, b2 lot is in Ledger
    const record: SaleRecord = {
      id: crypto.randomUUID(),
      saleDate: s1.date,
      amountSold: 0.5,
      salePricePerBTC: 60000,
      totalProceeds: 30000,
      costBasis: 15000,
      gainLoss: 15000,
      lotDetails: [{
        id: crypto.randomUUID(),
        lotId: b1.id, // Coinbase lot — was in Ledger, now back in Coinbase
        purchaseDate: b1.date,
        amountBTC: 0.5,
        costBasisPerBTC: 30000,
        totalCost: 15000,
        daysHeld: 166,
        exchange: "Coinbase",
        wallet: "Ledger", // Recorded when lot was in Ledger
        isLongTerm: false,
      }],
      holdingPeriodDays: 166,
      isLongTerm: false,
      isMixedTerm: false,
      method: AccountingMethod.SpecificID,
      sourceTransactionId: s1.id,
    };

    const result = calculate([b1, b2, t1, s1], AccountingMethod.FIFO, [record]);

    expect(result.sales).toHaveLength(1);
    // Must NOT use the Coinbase lot ($30k) — it's no longer in Ledger
    // FIFO fallback should use the Kraken lot (now in Ledger after transfer) at $50k
    expect(result.sales[0].costBasis).toBeCloseTo(0.5 * 50000, 0);
    expect(result.warnings.some((w) => w.message.includes("could not be applied"))).toBe(true);
  });

  it("does NOT reject intentional cross-wallet elections (lot wallet unchanged)", () => {
    // User explicitly picked a Coinbase lot for a Ledger sale via "Show all wallets"
    const b1 = buy("2024-01-01", 1.0, 30000, { wallet: "Coinbase" });
    const b2 = buy("2024-02-01", 1.0, 50000, { wallet: "Ledger" });
    const s1 = sell("2024-06-15", 0.5, 60000, { wallet: "Ledger" });

    // lotDetail.wallet = "Coinbase" (where the lot actually is)
    // lot's current wallet = "Coinbase" (unchanged)
    // These match → not stale, just intentionally cross-wallet
    const record: SaleRecord = {
      id: crypto.randomUUID(),
      saleDate: s1.date,
      amountSold: 0.5,
      salePricePerBTC: 60000,
      totalProceeds: 30000,
      costBasis: 15000,
      gainLoss: 15000,
      lotDetails: [{
        id: crypto.randomUUID(),
        lotId: b1.id,
        purchaseDate: b1.date,
        amountBTC: 0.5,
        costBasisPerBTC: 30000,
        totalCost: 15000,
        daysHeld: 166,
        exchange: "Coinbase",
        wallet: "Coinbase", // Matches lot's current wallet
        isLongTerm: false,
      }],
      holdingPeriodDays: 166,
      isLongTerm: false,
      isMixedTerm: false,
      method: AccountingMethod.SpecificID,
      sourceTransactionId: s1.id,
    };

    const result = calculate([b1, b2, s1], AccountingMethod.FIFO, [record]);

    expect(result.sales).toHaveLength(1);
    // Must use the Coinbase lot ($30k) — intentional cross-wallet election
    expect(result.sales[0].costBasis).toBeCloseTo(15000, 0);
    expect(result.sales[0].method).toBe(AccountingMethod.SpecificID);
    expect(result.sales[0].walletMismatch).toBe(true); // tagged for warning
    expect(result.warnings.filter((w) => w.message.includes("could not be applied"))).toHaveLength(0);
  });

  it("skips wallet check when lotDetail has no wallet recorded (legacy records)", () => {
    const b1 = buy("2024-01-01", 1.0, 30000, { wallet: "Coinbase" });
    const s1 = sell("2024-06-15", 0.5, 60000, { wallet: "Coinbase" });

    // Legacy record without wallet field
    const record: SaleRecord = {
      id: crypto.randomUUID(),
      saleDate: s1.date,
      amountSold: 0.5,
      salePricePerBTC: 60000,
      totalProceeds: 30000,
      costBasis: 15000,
      gainLoss: 15000,
      lotDetails: [{
        id: crypto.randomUUID(),
        lotId: b1.id,
        purchaseDate: b1.date,
        amountBTC: 0.5,
        costBasisPerBTC: 30000,
        totalCost: 15000,
        daysHeld: 166,
        exchange: "Coinbase",
        // wallet intentionally omitted (legacy record)
        isLongTerm: false,
      }],
      holdingPeriodDays: 166,
      isLongTerm: false,
      isMixedTerm: false,
      method: AccountingMethod.SpecificID,
      sourceTransactionId: s1.id,
    };

    const result = calculate([b1, s1], AccountingMethod.FIFO, [record]);

    expect(result.sales).toHaveLength(1);
    expect(result.sales[0].costBasis).toBeCloseTo(15000, 0);
    expect(result.sales[0].method).toBe(AccountingMethod.SpecificID);
    expect(result.warnings.filter((w) => w.message.includes("could not be applied"))).toHaveLength(0);
  });
});
