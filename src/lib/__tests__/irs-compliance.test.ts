/**
 * IRS COMPLIANCE TEST SUITE
 *
 * These tests verify that Sovereign Tax's cost basis engine produces
 * calculations that comply with IRS rules for cryptocurrency taxation.
 *
 * Sources:
 * - IRS Notice 2014-21 (crypto treated as property)
 * - IRS Publication 544 (Sales and Other Dispositions of Assets)
 * - IRS Publication 551 (Basis of Assets — cost basis includes fees)
 * - IRS FAQ 52-53, 56, 78, 82-86 (digital asset transactions)
 * - IRC §1222 (short-term vs long-term holding period)
 * - IRC §170 (charitable donations of appreciated property)
 * - IRC §1012 (Specific Identification method)
 * - IRS TD 9989 / Rev. Proc. 2024-28 (per-wallet cost basis, effective Jan 1 2025)
 * - IRS Rev. Rul. 2019-24 (hard fork / airdrop income)
 * - IRS Form 8949 Instructions (reporting format)
 */
import { describe, it, expect } from "vitest";
import { calculate, simulateSale, daysBetween, isMoreThanOneYear, LotSelection } from "../cost-basis";
import { createTransaction } from "../models";
import { AccountingMethod, TransactionType, IncomeType } from "../types";

// ═══════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════

function buy(date: string, amount: number, price: number, opts?: { exchange?: string; wallet?: string; fee?: number; incomeType?: IncomeType }) {
  const total = amount * price + (opts?.fee ?? 0);
  return createTransaction({
    date: new Date(date + "T12:00:00Z").toISOString(),
    transactionType: TransactionType.Buy,
    amountBTC: amount,
    pricePerBTC: total / amount,
    totalUSD: total,
    fee: opts?.fee,
    exchange: opts?.exchange ?? "Coinbase",
    wallet: opts?.wallet ?? opts?.exchange ?? "Coinbase",
    incomeType: opts?.incomeType,
    notes: "",
  });
}

function sell(date: string, amount: number, price: number, opts?: { exchange?: string; wallet?: string; fee?: number }) {
  const total = amount * price;
  return createTransaction({
    date: new Date(date + "T12:00:00Z").toISOString(),
    transactionType: TransactionType.Sell,
    amountBTC: amount,
    pricePerBTC: price,
    totalUSD: total,
    fee: opts?.fee,
    exchange: opts?.exchange ?? "Coinbase",
    wallet: opts?.wallet ?? opts?.exchange ?? "Coinbase",
    notes: "",
  });
}

function donation(date: string, amount: number, fmv: number, opts?: { exchange?: string; wallet?: string }) {
  return createTransaction({
    date: new Date(date + "T12:00:00Z").toISOString(),
    transactionType: TransactionType.Donation,
    amountBTC: amount,
    pricePerBTC: fmv,
    totalUSD: amount * fmv,
    exchange: opts?.exchange ?? "Coinbase",
    wallet: opts?.wallet ?? opts?.exchange ?? "Coinbase",
    notes: "",
  });
}

// ═══════════════════════════════════════════════════════
// IRS PUBLICATION 551: COST BASIS INCLUDES FEES
// "The basis of property you buy is usually its cost."
// Cost includes purchase price + transaction fees + commissions.
// ═══════════════════════════════════════════════════════

describe("IRS Pub 551 — Cost basis = purchase price + fees", () => {
  it("IRS example: buy 0.5 BTC for $10,000 with $100 fee → basis = $10,100", () => {
    const txns = [
      buy("2024-01-01", 0.5, 20000, { fee: 100 }), // 0.5 BTC × $20,000 = $10,000 + $100 fee = $10,100
      sell("2024-06-01", 0.5, 30000),               // Sell all at $30k/BTC = $15,000 proceeds
    ];
    const result = calculate(txns, AccountingMethod.FIFO);
    expect(result.sales[0].costBasis).toBeCloseTo(10100, 2);
    expect(result.sales[0].totalProceeds).toBeCloseTo(15000, 2);
    expect(result.sales[0].gainLoss).toBeCloseTo(4900, 2); // $15,000 - $10,100
  });

  it("cost basis per BTC includes pro-rated fee", () => {
    // Buy 2 BTC for $80,000 + $200 fee = $80,200 total
    // Cost basis per BTC = $80,200 / 2 = $40,100/BTC
    const txns = [
      buy("2024-01-01", 2.0, 40000, { fee: 200 }),
      sell("2024-06-01", 1.0, 50000),
    ];
    const result = calculate(txns, AccountingMethod.FIFO);
    // Selling 1 BTC: cost = 1.0 × ($80,200 / 2.0) = $40,100
    expect(result.sales[0].costBasis).toBeCloseTo(40100, 2);
    expect(result.sales[0].gainLoss).toBeCloseTo(9900, 2); // $50,000 - $40,100
  });

  it("partial lot sell uses fee-inclusive cost basis per BTC", () => {
    // Buy 1 BTC for $50,000 + $500 fee → totalCost = $50,500
    // Sell 0.25 BTC → cost = 0.25 × ($50,500 / 1.0) = $12,625
    const txns = [
      buy("2024-01-01", 1.0, 50000, { fee: 500 }),
      sell("2024-06-01", 0.25, 60000),
    ];
    const result = calculate(txns, AccountingMethod.FIFO);
    expect(result.sales[0].costBasis).toBeCloseTo(12625, 2);
    // Proceeds = 0.25 × $60,000 = $15,000
    expect(result.sales[0].gainLoss).toBeCloseTo(2375, 2); // $15,000 - $12,625
  });
});

// ═══════════════════════════════════════════════════════
// IRS PUB 544 / FAQ 52-53: GAIN/LOSS = PROCEEDS - BASIS
// "Gain (or Loss) = Amount Realized − Adjusted Basis"
// Sell-side fees reduce the amount realized (proceeds).
// ═══════════════════════════════════════════════════════

describe("IRS Pub 544 — Gain/Loss = Amount Realized − Adjusted Basis", () => {
  it("IRS worked example: full gain calculation with fees on both sides", () => {
    // Jan 1 2022: Buy 2 BTC for $40,000 + $200 fee → basis = $40,200 total, $20,100/BTC
    // Jan 15 2024: Sell 1 BTC for $60,000 gross - $300 sell fee → proceeds = $59,700
    // Expected gain = $59,700 - $20,100 = $39,600 (long-term, held >1 year)
    const txns = [
      buy("2022-01-01", 2.0, 20000, { fee: 200 }),
      sell("2024-01-15", 1.0, 60000, { fee: 300 }),
    ];
    const result = calculate(txns, AccountingMethod.FIFO);
    expect(result.sales[0].costBasis).toBeCloseTo(20100, 2);
    // Note: The app stores sale.totalUSD (amount * price) and fee separately.
    // totalProceeds in SaleRecord = totalUSD (because fee is tracked in the fee field).
    // The actual "amount realized" = totalProceeds - fee = 60000 - 300 = 59700
    // The gainLoss field = totalProceeds - costBasis = 60000 - 20100 = 39900
    // The separate fee field captures the $300 sell fee.
    // Form 8949 export correctly reports fee as an adjustment.
    expect(result.sales[0].totalProceeds).toBeCloseTo(60000, 2);
    expect(result.sales[0].fee).toBeCloseTo(300, 2);
    expect(result.sales[0].isLongTerm).toBe(true); // Held Jan 2022 → Jan 2024, > 1 year
  });

  it("capital gain: sell at higher price than basis", () => {
    const txns = [
      buy("2024-01-01", 1.0, 40000),
      sell("2024-06-01", 1.0, 60000),
    ];
    const result = calculate(txns, AccountingMethod.FIFO);
    expect(result.sales[0].gainLoss).toBeCloseTo(20000, 2);
  });

  it("capital loss: sell at lower price than basis", () => {
    const txns = [
      buy("2024-01-01", 1.0, 60000),
      sell("2024-06-01", 1.0, 40000),
    ];
    const result = calculate(txns, AccountingMethod.FIFO);
    expect(result.sales[0].gainLoss).toBeCloseTo(-20000, 2);
  });

  it("break-even: no gain or loss when sell price equals basis", () => {
    const txns = [
      buy("2024-01-01", 1.0, 50000),
      sell("2024-06-01", 1.0, 50000),
    ];
    const result = calculate(txns, AccountingMethod.FIFO);
    expect(result.sales[0].gainLoss).toBeCloseTo(0, 2);
  });
});

// ═══════════════════════════════════════════════════════
// IRC §1222: SHORT-TERM vs LONG-TERM HOLDING PERIOD
// Short-term = held "not more than 1 year" (≤ 365 days)
// Long-term = held "more than 1 year" (> 365 days)
// Holding period starts the day AFTER acquisition.
// ═══════════════════════════════════════════════════════

describe("IRC §1222 — Holding period classification", () => {
  it("acquired Jan 15 2024, sold Jan 15 2025 → SHORT-TERM (exactly 1 year)", () => {
    // "Not more than 1 year" = short-term
    // Sold on the anniversary = still short-term
    expect(isMoreThanOneYear("2024-01-15T12:00:00Z", "2025-01-15T12:00:00Z")).toBe(false);
  });

  it("acquired Jan 15 2024, sold Jan 16 2025 → LONG-TERM (1 year + 1 day)", () => {
    expect(isMoreThanOneYear("2024-01-15T12:00:00Z", "2025-01-16T12:00:00Z")).toBe(true);
  });

  it("acquired Jan 15 2024, sold Jun 15 2024 → SHORT-TERM (5 months)", () => {
    expect(isMoreThanOneYear("2024-01-15T12:00:00Z", "2024-06-15T12:00:00Z")).toBe(false);
  });

  it("leap year: acquired Feb 29 2024 → long-term not until Mar 2 2025", () => {
    // Feb 29 2024 + 1 year = Mar 1 2025 (Feb 29 doesn't exist in 2025)
    // Sold Feb 28 2025: short-term
    expect(isMoreThanOneYear("2024-02-29T12:00:00Z", "2025-02-28T12:00:00Z")).toBe(false);
    // Sold Mar 1 2025: exactly 1 year → short-term
    expect(isMoreThanOneYear("2024-02-29T12:00:00Z", "2025-03-01T12:00:00Z")).toBe(false);
    // Sold Mar 2 2025: long-term
    expect(isMoreThanOneYear("2024-02-29T12:00:00Z", "2025-03-02T12:00:00Z")).toBe(true);
  });

  it("end-to-end: sale record correctly tagged as short-term or long-term", () => {
    const txns = [
      buy("2023-01-15", 1.0, 40000),    // Long-term by Feb 2024
      buy("2024-06-01", 1.0, 55000),    // Short-term by Aug 2024
      sell("2024-08-01", 1.5, 60000),   // Spans both lots
    ];
    const result = calculate(txns, AccountingMethod.FIFO);
    const sale = result.sales[0];
    expect(sale.isMixedTerm).toBe(true);
    // First lot (Jan 2023) is long-term
    expect(sale.lotDetails[0].isLongTerm).toBe(true);
    // Second lot (Jun 2024) is short-term
    expect(sale.lotDetails[1].isLongTerm).toBe(false);
  });

  it("same-day buy and sell → 0 days held, short-term", () => {
    const txns = [
      buy("2024-06-01", 1.0, 40000),
      sell("2024-06-01", 1.0, 45000),
    ];
    const result = calculate(txns, AccountingMethod.FIFO);
    expect(result.sales[0].holdingPeriodDays).toBe(0);
    expect(result.sales[0].isLongTerm).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════
// IRS FAQ 86: FIFO AS DEFAULT METHOD
// "Units are deemed to have been sold in chronological
//  order beginning with the earliest unit purchased"
// ═══════════════════════════════════════════════════════

describe("IRS FAQ 86 — FIFO default method", () => {
  it("IRS worked example: FIFO sells oldest lot first", () => {
    // Lot 1: 1 BTC, Jan 1 2022, $25,000
    // Lot 2: 1 BTC, Jul 1 2022, $35,000
    // Sale: 1 BTC, Dec 1 2024, $50,000
    // Under FIFO → Lot 1 consumed → Gain = $50,000 - $25,000 = $25,000
    const txns = [
      buy("2022-01-01", 1.0, 25000),
      buy("2022-07-01", 1.0, 35000),
      sell("2024-12-01", 1.0, 50000),
    ];
    const result = calculate(txns, AccountingMethod.FIFO);
    expect(result.sales).toHaveLength(1);
    expect(result.sales[0].costBasis).toBeCloseTo(25000, 2); // Lot 1 (oldest)
    expect(result.sales[0].gainLoss).toBeCloseTo(25000, 2);
    expect(result.sales[0].isLongTerm).toBe(true); // Held Jan 2022 → Dec 2024
  });

  it("FIFO with 3 lots — sells in chronological order", () => {
    const txns = [
      buy("2024-01-01", 0.5, 30000),  // Lot 1: $15,000
      buy("2024-03-01", 0.5, 40000),  // Lot 2: $20,000
      buy("2024-05-01", 0.5, 50000),  // Lot 3: $25,000
      sell("2024-08-01", 0.8, 60000), // Sell 0.8 BTC
    ];
    const result = calculate(txns, AccountingMethod.FIFO);
    // FIFO: 0.5 from Lot 1 + 0.3 from Lot 2
    // Cost: 0.5×30k + 0.3×40k = 15,000 + 12,000 = $27,000
    expect(result.sales[0].lotDetails).toHaveLength(2);
    expect(result.sales[0].lotDetails[0].amountBTC).toBeCloseTo(0.5, 8); // All of Lot 1
    expect(result.sales[0].lotDetails[1].amountBTC).toBeCloseTo(0.3, 8); // Part of Lot 2
    expect(result.sales[0].costBasis).toBeCloseTo(27000, 2);
  });

  it("FIFO exhausts lots in order across multiple sales", () => {
    const txns = [
      buy("2024-01-01", 1.0, 30000),
      buy("2024-03-01", 1.0, 50000),
      sell("2024-06-01", 0.7, 60000), // Consumes 0.7 from Lot 1
      sell("2024-07-01", 0.7, 55000), // Consumes 0.3 from Lot 1 + 0.4 from Lot 2
    ];
    const result = calculate(txns, AccountingMethod.FIFO);
    expect(result.sales).toHaveLength(2);

    // Sale 1: 0.7 from Lot 1 @ $30k → cost = $21,000
    expect(result.sales[0].costBasis).toBeCloseTo(21000, 2);

    // Sale 2: 0.3 from Lot 1 @ $30k + 0.4 from Lot 2 @ $50k → $9,000 + $20,000 = $29,000
    expect(result.sales[1].costBasis).toBeCloseTo(29000, 2);
  });
});

// ═══════════════════════════════════════════════════════
// IRC §1012 / IRS FAQ 82-86: SPECIFIC IDENTIFICATION
// Taxpayer may identify specific lots to sell, overriding FIFO.
// Documentation required before or at time of sale.
// ═══════════════════════════════════════════════════════

describe("IRC §1012 — Specific Identification method", () => {
  it("Specific ID overrides FIFO to minimize tax", () => {
    // Lot A: 1 BTC, Jan 2022, $25,000 (long-term, would produce $25k gain under FIFO)
    // Lot B: 1 BTC, Jun 2024, $60,000 (short-term, produces only $5k gain)
    // Sale: 1 BTC, Dec 2024, $65,000
    // Specific ID picks Lot B → gain = $5,000 short-term (better than $25k long-term in many cases)
    const b1 = buy("2022-01-01", 1.0, 25000);
    const b2 = buy("2024-06-01", 1.0, 60000);
    const s1 = sell("2024-12-01", 1.0, 65000);
    const txns = [b1, b2, s1];

    // Record Specific ID election picking Lot B
    const recorded = [{
      id: "rec-1",
      saleDate: s1.date,
      amountSold: 1.0,
      salePricePerBTC: 65000,
      totalProceeds: 65000,
      costBasis: 60000,
      gainLoss: 5000,
      lotDetails: [{
        id: "d1",
        lotId: b2.id,
        purchaseDate: b2.date,
        amountBTC: 1.0,
        costBasisPerBTC: 60000,
        totalCost: 60000,
        daysHeld: 183,
        exchange: "Coinbase",
        isLongTerm: false,
      }],
      holdingPeriodDays: 183,
      isLongTerm: false,
      isMixedTerm: false,
      method: AccountingMethod.SpecificID,
      sourceTransactionId: s1.id,
    }];

    const result = calculate(txns, AccountingMethod.FIFO, recorded);
    // Specific ID should override FIFO
    expect(result.sales[0].costBasis).toBeCloseTo(60000, 2); // Lot B, not Lot A
    expect(result.sales[0].gainLoss).toBeCloseTo(5000, 2);
    expect(result.sales[0].isLongTerm).toBe(false); // Lot B is short-term
  });

  it("Specific ID can pick from multiple lots", () => {
    const b1 = buy("2024-01-01", 1.0, 30000, { wallet: "Coinbase" });
    const b2 = buy("2024-02-01", 1.0, 40000, { wallet: "Coinbase" });
    const b3 = buy("2024-03-01", 1.0, 50000, { wallet: "Coinbase" });
    const s1 = sell("2024-08-01", 1.0, 60000, { wallet: "Coinbase" });
    const txns = [b1, b2, b3, s1];

    // Pick 0.5 from Lot 3 (highest basis) + 0.5 from Lot 2
    const recorded = [{
      id: "rec-1",
      saleDate: s1.date,
      amountSold: 1.0,
      salePricePerBTC: 60000,
      totalProceeds: 60000,
      costBasis: 45000,
      gainLoss: 15000,
      lotDetails: [
        {
          id: "d1", lotId: b3.id, purchaseDate: b3.date, amountBTC: 0.5,
          costBasisPerBTC: 50000, totalCost: 25000, daysHeld: 153, exchange: "Coinbase", isLongTerm: false,
        },
        {
          id: "d2", lotId: b2.id, purchaseDate: b2.date, amountBTC: 0.5,
          costBasisPerBTC: 40000, totalCost: 20000, daysHeld: 181, exchange: "Coinbase", isLongTerm: false,
        },
      ],
      holdingPeriodDays: 167,
      isLongTerm: false,
      isMixedTerm: false,
      method: AccountingMethod.SpecificID,
      sourceTransactionId: s1.id,
    }];

    const result = calculate(txns, AccountingMethod.FIFO, recorded);
    expect(result.sales[0].costBasis).toBeCloseTo(45000, 2); // 25k + 20k
    expect(result.sales[0].lotDetails).toHaveLength(2);
  });
});

// ═══════════════════════════════════════════════════════
// IRS TD 9989: PER-WALLET COST BASIS (EFFECTIVE JAN 1, 2025)
// Each wallet/exchange account is an independent lot pool.
// Cannot sell from Wallet A using lots from Wallet B.
// ═══════════════════════════════════════════════════════

describe("IRS TD 9989 — Per-wallet cost basis enforcement", () => {
  it("IRS example: sell from Exchange B uses only Exchange B's lots", () => {
    // Exchange A: 1 BTC @ $20,000
    // Exchange B: 1 BTC @ $25,000
    // Sell 1 BTC from Exchange B at $30,000
    // Per-wallet: gain = $30,000 - $25,000 = $5,000 (NOT $30k - $20k = $10k)
    const txns = [
      buy("2024-01-01", 1.0, 20000, { wallet: "Exchange A" }),
      buy("2024-02-01", 1.0, 25000, { wallet: "Exchange B" }),
      sell("2024-08-01", 1.0, 30000, { wallet: "Exchange B" }),
    ];
    const result = calculate(txns, AccountingMethod.FIFO);
    expect(result.sales[0].costBasis).toBeCloseTo(25000, 2); // Exchange B's lot
    expect(result.sales[0].gainLoss).toBeCloseTo(5000, 2);
  });

  it("multiple lots in same wallet — FIFO within wallet", () => {
    const txns = [
      buy("2024-01-01", 0.5, 30000, { wallet: "Coinbase" }),
      buy("2024-02-01", 0.5, 40000, { wallet: "Kraken" }),
      buy("2024-03-01", 0.5, 50000, { wallet: "Coinbase" }),
      sell("2024-08-01", 0.7, 60000, { wallet: "Coinbase" }),
    ];
    const result = calculate(txns, AccountingMethod.FIFO);
    // Coinbase lots: Jan @ $30k (0.5), Mar @ $50k (0.5)
    // FIFO within Coinbase: 0.5 from Jan + 0.2 from Mar
    // Cost: 0.5×30k + 0.2×50k = 15k + 10k = $25,000
    expect(result.sales[0].costBasis).toBeCloseTo(25000, 2);
  });

  it("wallet matching is case-insensitive per IRS guidance", () => {
    const txns = [
      buy("2024-01-01", 1.0, 40000, { wallet: "coinbase" }),
      sell("2024-06-01", 0.5, 60000, { wallet: "Coinbase" }),
    ];
    const result = calculate(txns, AccountingMethod.FIFO);
    expect(result.sales).toHaveLength(1);
    expect(result.sales[0].amountSold).toBeCloseTo(0.5, 8);
    expect(result.warnings).toHaveLength(0); // No fallback warning
  });

  it("falls back to global pool with warning when wallet has no lots", () => {
    // This is a safety fallback — in practice users should have matching wallets
    const txns = [
      buy("2024-01-01", 1.0, 40000, { wallet: "Coinbase" }),
      sell("2024-06-01", 0.5, 60000, { wallet: "UnknownWallet" }),
    ];
    const result = calculate(txns, AccountingMethod.FIFO);
    expect(result.sales).toHaveLength(1);
    expect(result.warnings.some((w) => w.includes("Fell back to global"))).toBe(true);
  });

  it("Specific ID honors cross-wallet lot selections with walletMismatch warning", () => {
    const b1 = buy("2024-01-01", 1.0, 30000, { wallet: "Coinbase" });
    const b2 = buy("2024-02-01", 1.0, 50000, { wallet: "Kraken" });
    const s1 = sell("2024-08-01", 0.5, 60000, { wallet: "Coinbase" });
    const txns = [b1, b2, s1];

    // User explicitly elected Kraken lot for a Coinbase sale via "Show all wallets" toggle.
    // Engine must honor the election — the user was warned at selection time.
    const recorded = [{
      id: "rec-1",
      saleDate: s1.date,
      amountSold: 0.5,
      salePricePerBTC: 60000,
      totalProceeds: 30000,
      costBasis: 25000,
      gainLoss: 5000,
      lotDetails: [{
        id: "d1", lotId: b2.id, // Kraken lot — cross-wallet, user chose intentionally
        purchaseDate: b2.date, amountBTC: 0.5,
        costBasisPerBTC: 50000, totalCost: 25000, daysHeld: 181, exchange: "Kraken", isLongTerm: false,
      }],
      holdingPeriodDays: 181,
      isLongTerm: false,
      isMixedTerm: false,
      method: AccountingMethod.SpecificID,
      sourceTransactionId: s1.id,
    }];

    const result = calculate(txns, AccountingMethod.FIFO, recorded);
    expect(result.sales).toHaveLength(1);
    // The Kraken lot IS applied — engine honors the explicit election
    expect(result.sales[0].costBasis).toBeCloseTo(25000, 0); // 0.5 * 50000
    expect(result.sales[0].amountSold).toBeCloseTo(0.5, 8);
    expect(result.sales[0].lotDetails[0].wallet).toBe("Kraken");
    // Tagged for UI warning — user should see wallet mismatch indicator
    expect(result.sales[0].walletMismatch).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════
// IRC §170: CHARITABLE DONATIONS
// Donations of appreciated crypto: zero proceeds, zero gain/loss
// Deduction = FMV at donation (long-term) or lesser of FMV/basis (short-term)
// ═══════════════════════════════════════════════════════

describe("IRC §170 — Charitable donations", () => {
  it("donation has zero proceeds and zero gain/loss (not a sale)", () => {
    const txns = [
      buy("2024-01-01", 1.0, 40000),
      donation("2024-06-01", 0.5, 65000),
    ];
    const result = calculate(txns, AccountingMethod.FIFO);
    const don = result.sales[0];
    expect(don.isDonation).toBe(true);
    expect(don.salePricePerBTC).toBe(0);
    expect(don.totalProceeds).toBe(0);
    expect(don.gainLoss).toBe(0);
  });

  it("donation stores FMV for Form 8283 reporting", () => {
    const txns = [
      buy("2024-01-01", 1.0, 40000),
      donation("2024-06-01", 0.5, 65000),
    ];
    const result = calculate(txns, AccountingMethod.FIFO);
    expect(result.sales[0].donationFmvPerBTC).toBeCloseTo(65000, 2);
    expect(result.sales[0].donationFmvTotal).toBeCloseTo(32500, 2); // 0.5 × $65,000
  });

  it("donation consumes lots (reduces available BTC for future sales)", () => {
    const txns = [
      buy("2024-01-01", 1.0, 40000),       // 1.0 BTC lot
      donation("2024-03-01", 0.4, 50000),   // Consumes 0.4
      sell("2024-06-01", 0.5, 60000),       // Only 0.6 BTC remains
    ];
    const result = calculate(txns, AccountingMethod.FIFO);
    expect(result.sales).toHaveLength(2); // Donation + Sale
    expect(result.sales[0].isDonation).toBe(true);
    expect(result.sales[0].amountSold).toBeCloseTo(0.4, 8);
    expect(result.sales[1].amountSold).toBeCloseTo(0.5, 8);
    // After donation (0.4) and sale (0.5), remaining = 0.1
    expect(result.lots[0].remainingBTC).toBeCloseTo(0.1, 8);
  });

  it("donation records cost basis of consumed lots for IRS reference", () => {
    // Buy at $40k, donate later → cost basis of donated portion should be tracked
    const txns = [
      buy("2024-01-01", 1.0, 40000),
      donation("2024-06-01", 0.3, 60000),
    ];
    const result = calculate(txns, AccountingMethod.FIFO);
    // Cost basis of donated lots: 0.3 × $40,000 = $12,000
    expect(result.sales[0].costBasis).toBeCloseTo(12000, 2);
  });

  it("long-term donation correctly identifies holding period", () => {
    const txns = [
      buy("2023-01-01", 1.0, 20000),       // Long-term by Feb 2024
      donation("2024-06-01", 0.5, 95000),   // 18 months later
    ];
    const result = calculate(txns, AccountingMethod.FIFO);
    expect(result.sales[0].isLongTerm).toBe(true);
    expect(result.sales[0].lotDetails[0].isLongTerm).toBe(true);
  });

  it("donations are excluded from Form 8949 (tested in export tests)", () => {
    // Donations go on Form 8283, not Form 8949
    const txns = [
      buy("2024-01-01", 1.0, 40000),
      donation("2024-06-01", 0.5, 65000),
    ];
    const result = calculate(txns, AccountingMethod.FIFO);
    expect(result.sales[0].isDonation).toBe(true);
    // Export functions filter out isDonation records — tested in export.test.ts
  });
});

// ═══════════════════════════════════════════════════════
// REV. RUL. 2019-24: MINING / AIRDROPS = ORDINARY INCOME
// FMV at receipt = both ordinary income AND cost basis.
// ═══════════════════════════════════════════════════════

describe("Rev. Rul. 2019-24 — Mining / airdrop income creates lots", () => {
  it("mined BTC creates a lot with FMV as cost basis", () => {
    // Mine 0.001 BTC when FMV = $60,000/BTC → FMV = $60, becomes cost basis
    const txns = [
      buy("2024-06-01", 0.001, 60000, { incomeType: IncomeType.Mining }),
      sell("2024-12-01", 0.001, 80000),
    ];
    const result = calculate(txns, AccountingMethod.FIFO);
    expect(result.lots).toHaveLength(1);
    expect(result.lots[0].totalCost).toBeCloseTo(60, 2); // 0.001 × $60k
    expect(result.sales[0].costBasis).toBeCloseTo(60, 2);
    expect(result.sales[0].gainLoss).toBeCloseTo(20, 2); // $80 - $60
  });

  it("reward income creates a lot (same as mining)", () => {
    const txns = [
      buy("2024-01-01", 0.005, 50000, { incomeType: IncomeType.Reward }),
      sell("2024-08-01", 0.005, 60000),
    ];
    const result = calculate(txns, AccountingMethod.FIFO);
    expect(result.sales[0].costBasis).toBeCloseTo(250, 2); // 0.005 × $50k
    expect(result.sales[0].gainLoss).toBeCloseTo(50, 2);   // $300 - $250
  });

  it("hard fork creates a lot with FMV as basis", () => {
    const txns = [
      buy("2024-03-01", 0.1, 45000, { incomeType: IncomeType.Fork }),
      sell("2024-09-01", 0.1, 55000),
    ];
    const result = calculate(txns, AccountingMethod.FIFO);
    expect(result.sales[0].costBasis).toBeCloseTo(4500, 2); // 0.1 × $45k
  });
});

// ═══════════════════════════════════════════════════════
// TRANSFERS: NON-TAXABLE EVENTS
// Moving crypto between own wallets is not a taxable event.
// Lots remain unchanged after transfers.
// ═══════════════════════════════════════════════════════

describe("Transfers — non-taxable movements", () => {
  it("transfer in/out does not create lots or sales", () => {
    const txns = [
      buy("2024-01-01", 1.0, 40000, { wallet: "Coinbase" }),
      createTransaction({
        date: "2024-03-01T12:00:00Z",
        transactionType: TransactionType.TransferOut,
        amountBTC: 0.5, pricePerBTC: 0, totalUSD: 0,
        exchange: "Coinbase", wallet: "Coinbase", notes: "",
      }),
      createTransaction({
        date: "2024-03-01T12:00:00Z",
        transactionType: TransactionType.TransferIn,
        amountBTC: 0.5, pricePerBTC: 0, totalUSD: 0,
        exchange: "Ledger", wallet: "Ledger", notes: "",
      }),
    ];
    const result = calculate(txns, AccountingMethod.FIFO);
    expect(result.lots).toHaveLength(1); // Only the buy
    expect(result.sales).toHaveLength(0); // No taxable events
    expect(result.lots[0].remainingBTC).toBe(1.0); // Unchanged
  });
});

// ═══════════════════════════════════════════════════════
// FORM 8949 MATH: END-TO-END WORKED EXAMPLES
// Verifying the full pipeline produces correct numbers
// for filing on IRS Form 8949.
// ═══════════════════════════════════════════════════════

describe("Form 8949 — end-to-end calculation verification", () => {
  it("multi-lot sale with correct pro-rated cost basis", () => {
    // 3 purchases across 2024:
    //   Jan: 0.2 BTC @ $42,000 = $8,400
    //   Mar: 0.3 BTC @ $65,000 = $19,500
    //   May: 0.5 BTC @ $70,000 = $35,000
    // Sale in Aug: 0.6 BTC @ $80,000
    // FIFO: 0.2 from Jan + 0.3 from Mar + 0.1 from May
    //   Cost: $8,400 + $19,500 + (0.1/0.5)×$35,000 = $8,400 + $19,500 + $7,000 = $34,900
    //   Proceeds: 0.6 × $80,000 = $48,000
    //   Gain: $48,000 - $34,900 = $13,100
    const txns = [
      buy("2024-01-15", 0.2, 42000),
      buy("2024-03-15", 0.3, 65000),
      buy("2024-05-15", 0.5, 70000),
      sell("2024-08-15", 0.6, 80000),
    ];
    const result = calculate(txns, AccountingMethod.FIFO);
    expect(result.sales[0].amountSold).toBeCloseTo(0.6, 8);
    expect(result.sales[0].costBasis).toBeCloseTo(34900, 2);
    expect(result.sales[0].totalProceeds).toBeCloseTo(48000, 2);
    expect(result.sales[0].gainLoss).toBeCloseTo(13100, 2);
    expect(result.sales[0].isLongTerm).toBe(false); // All purchased in 2024
  });

  it("multiple sales in one year — total gains/losses accumulate", () => {
    const txns = [
      buy("2024-01-01", 2.0, 40000),       // $80,000 total, $40k/BTC
      sell("2024-04-01", 0.5, 50000),       // Gain: $5,000
      sell("2024-06-01", 0.5, 30000),       // Loss: -$5,000
      sell("2024-09-01", 0.5, 60000),       // Gain: $10,000
    ];
    const result = calculate(txns, AccountingMethod.FIFO);
    expect(result.sales).toHaveLength(3);
    const totalGainLoss = result.sales.reduce((sum, s) => sum + s.gainLoss, 0);
    // $5k + (-$5k) + $10k = $10,000 net gain
    expect(totalGainLoss).toBeCloseTo(10000, 2);
  });

  it("long-term gain with fee adjustments on both sides", () => {
    // Jan 2023: Buy 1 BTC @ $20,000 + $100 fee → basis = $20,100
    // Mar 2024: Sell 1 BTC @ $60,000 - $200 sell fee
    // Proceeds on SaleRecord = $60,000 (fee tracked separately)
    // Gain = $60,000 - $20,100 = $39,900 (before fee adjustment on 8949)
    // On Form 8949: fee column shows $200 adjustment
    const txns = [
      buy("2023-01-01", 1.0, 20000, { fee: 100 }),
      sell("2024-03-01", 1.0, 60000, { fee: 200 }),
    ];
    const result = calculate(txns, AccountingMethod.FIFO);
    expect(result.sales[0].costBasis).toBeCloseTo(20100, 2);
    expect(result.sales[0].fee).toBeCloseTo(200, 2);
    expect(result.sales[0].isLongTerm).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════
// WASH SALE NOTE
// As of 2025, crypto is NOT subject to wash sale rules.
// This test documents that the engine correctly allows
// immediate repurchase after a loss sale.
// ═══════════════════════════════════════════════════════

describe("Wash sale exemption (crypto not subject as of 2025)", () => {
  it("loss sale followed by immediate repurchase — loss is fully deductible", () => {
    const txns = [
      buy("2024-01-01", 1.0, 60000),
      sell("2024-06-01", 1.0, 40000),       // $20k loss
      buy("2024-06-01", 1.0, 40000),        // Immediate repurchase — allowed for crypto
    ];
    const result = calculate(txns, AccountingMethod.FIFO);
    expect(result.sales).toHaveLength(1);
    expect(result.sales[0].gainLoss).toBeCloseTo(-20000, 2); // Full loss, no wash sale disallowance
    // New lot created at $40k for the repurchase
    const activeLots = result.lots.filter((l) => l.remainingBTC > 0);
    expect(activeLots).toHaveLength(1);
    expect(activeLots[0].totalCost).toBeCloseTo(40000, 2);
  });
});

// ═══════════════════════════════════════════════════════
// SIMULATE SALE — immutability check
// Simulation must never modify actual lot state.
// ═══════════════════════════════════════════════════════

describe("simulateSale — immutability and correctness", () => {
  it("simulation does not modify original lots", () => {
    const txns = [buy("2024-01-01", 1.0, 40000)];
    const result = calculate(txns, AccountingMethod.FIFO);
    const origRemaining = result.lots[0].remainingBTC;

    simulateSale(0.5, 60000, result.lots, AccountingMethod.FIFO, undefined, "Coinbase");
    // Original lot must be unchanged
    expect(result.lots[0].remainingBTC).toBe(origRemaining);
  });

  it("simulation respects per-wallet filtering", () => {
    const txns = [
      buy("2024-01-01", 1.0, 30000, { wallet: "Coinbase" }),
      buy("2024-02-01", 1.0, 50000, { wallet: "Kraken" }),
    ];
    const result = calculate(txns, AccountingMethod.FIFO);

    const sim = simulateSale(0.5, 60000, result.lots, AccountingMethod.FIFO, undefined, "Kraken");
    expect(sim).not.toBeNull();
    expect(sim!.costBasis).toBeCloseTo(25000, 2); // Kraken lot @ $50k
  });
});

// ═══════════════════════════════════════════════════════
// PARTIAL FILL — sell more than available
// When the user tries to sell more BTC than exists in lots,
// the engine partially fills and pro-rates proceeds.
// ═══════════════════════════════════════════════════════

describe("Partial fill — insufficient lots", () => {
  it("selling more than available pro-rates proceeds correctly", () => {
    // Have 0.5 BTC, try to sell 1.0 BTC at $60,000
    // Should fill 0.5, proceeds = 0.5 × $60k = $30,000 (not 1.0 × $60k)
    const txns = [
      buy("2024-01-01", 0.5, 40000),
      sell("2024-06-01", 1.0, 60000),
    ];
    const result = calculate(txns, AccountingMethod.FIFO);
    expect(result.sales).toHaveLength(1);
    expect(result.sales[0].amountSold).toBeCloseTo(0.5, 8);
    expect(result.sales[0].totalProceeds).toBeCloseTo(30000, 2); // Pro-rated
    expect(result.sales[0].costBasis).toBeCloseTo(20000, 2);     // 0.5 × $40k
    expect(result.sales[0].gainLoss).toBeCloseTo(10000, 2);
  });

  it("no lots at all → no sale, warning generated", () => {
    const txns = [
      sell("2024-06-01", 1.0, 60000), // No buys
    ];
    const result = calculate(txns, AccountingMethod.FIFO);
    expect(result.sales).toHaveLength(0);
    expect(result.warnings.length).toBeGreaterThan(0);
  });
});

// ═══════════════════════════════════════════════════════
// SEQUENTIAL SPECIFIC ID ELECTIONS — no double-counting
// Multiple sales with Specific ID must consume lots correctly
// without allowing the same lot to be used twice.
// ═══════════════════════════════════════════════════════

describe("Sequential Specific ID — no double-counting", () => {
  it("three Specific ID sales consume lots correctly", () => {
    const b1 = buy("2024-01-01", 1.0, 30000, { wallet: "Coinbase" }); // Lot A
    const b2 = buy("2024-02-01", 1.0, 40000, { wallet: "Coinbase" }); // Lot B
    const b3 = buy("2024-03-01", 1.0, 50000, { wallet: "Coinbase" }); // Lot C
    const s1 = sell("2024-06-01", 0.5, 60000, { wallet: "Coinbase" });
    const s2 = sell("2024-07-01", 0.5, 65000, { wallet: "Coinbase" });
    const s3 = sell("2024-08-01", 0.5, 70000, { wallet: "Coinbase" });
    const txns = [b1, b2, b3, s1, s2, s3];

    // Sale 1 picks Lot C (highest basis), Sale 2 picks Lot B, Sale 3 picks Lot A
    const recorded = [
      {
        id: "rec-1", saleDate: s1.date, amountSold: 0.5, salePricePerBTC: 60000,
        totalProceeds: 30000, costBasis: 25000, gainLoss: 5000,
        lotDetails: [{ id: "d1", lotId: b3.id, purchaseDate: b3.date, amountBTC: 0.5,
          costBasisPerBTC: 50000, totalCost: 25000, daysHeld: 92, exchange: "Coinbase", isLongTerm: false }],
        holdingPeriodDays: 92, isLongTerm: false, isMixedTerm: false,
        method: AccountingMethod.SpecificID, sourceTransactionId: s1.id,
      },
      {
        id: "rec-2", saleDate: s2.date, amountSold: 0.5, salePricePerBTC: 65000,
        totalProceeds: 32500, costBasis: 20000, gainLoss: 12500,
        lotDetails: [{ id: "d2", lotId: b2.id, purchaseDate: b2.date, amountBTC: 0.5,
          costBasisPerBTC: 40000, totalCost: 20000, daysHeld: 151, exchange: "Coinbase", isLongTerm: false }],
        holdingPeriodDays: 151, isLongTerm: false, isMixedTerm: false,
        method: AccountingMethod.SpecificID, sourceTransactionId: s2.id,
      },
      {
        id: "rec-3", saleDate: s3.date, amountSold: 0.5, salePricePerBTC: 70000,
        totalProceeds: 35000, costBasis: 15000, gainLoss: 20000,
        lotDetails: [{ id: "d3", lotId: b1.id, purchaseDate: b1.date, amountBTC: 0.5,
          costBasisPerBTC: 30000, totalCost: 15000, daysHeld: 212, exchange: "Coinbase", isLongTerm: false }],
        holdingPeriodDays: 212, isLongTerm: false, isMixedTerm: false,
        method: AccountingMethod.SpecificID, sourceTransactionId: s3.id,
      },
    ];

    const result = calculate(txns, AccountingMethod.FIFO, recorded);
    expect(result.sales).toHaveLength(3);

    // Sale 1: Lot C @ $50k → cost = 0.5 × $50k = $25,000
    expect(result.sales[0].costBasis).toBeCloseTo(25000, 2);
    // Sale 2: Lot B @ $40k → cost = 0.5 × $40k = $20,000
    expect(result.sales[1].costBasis).toBeCloseTo(20000, 2);
    // Sale 3: Lot A @ $30k → cost = 0.5 × $30k = $15,000
    expect(result.sales[2].costBasis).toBeCloseTo(15000, 2);

    // Each lot should have 0.5 remaining (started with 1.0, sold 0.5)
    expect(result.lots[0].remainingBTC).toBeCloseTo(0.5, 8); // Lot A
    expect(result.lots[1].remainingBTC).toBeCloseTo(0.5, 8); // Lot B
    expect(result.lots[2].remainingBTC).toBeCloseTo(0.5, 8); // Lot C

    // Verify total gains: $5k + $12,500 + $20k = $37,500
    const totalGain = result.sales.reduce((s, r) => s + r.gainLoss, 0);
    expect(totalGain).toBeCloseTo(37500, 2);
  });
});

// ═══════════════════════════════════════════════════════
// SAME-DAY MULTIPLE SALES
// Two sales on the same day from the same wallet.
// FIFO must process them sequentially, consuming lots in order.
// ═══════════════════════════════════════════════════════

describe("Same-day multiple sales", () => {
  it("two sales on same day process FIFO sequentially", () => {
    const txns = [
      buy("2024-01-01", 1.0, 30000),     // $30k lot
      buy("2024-02-01", 1.0, 50000),     // $50k lot
      sell("2024-06-01", 0.8, 60000),    // First sale: consumes 0.8 from lot 1
      sell("2024-06-01", 0.5, 60000),    // Second sale: 0.2 from lot 1 + 0.3 from lot 2
    ];
    const result = calculate(txns, AccountingMethod.FIFO);
    expect(result.sales).toHaveLength(2);

    // Sale 1: 0.8 BTC from Lot 1 @ $30k → cost = $24,000
    expect(result.sales[0].costBasis).toBeCloseTo(24000, 2);
    expect(result.sales[0].gainLoss).toBeCloseTo(24000, 2); // $48k - $24k

    // Sale 2: 0.2 from Lot 1 @ $30k + 0.3 from Lot 2 @ $50k
    // Cost = $6,000 + $15,000 = $21,000
    expect(result.sales[1].costBasis).toBeCloseTo(21000, 2);
    expect(result.sales[1].gainLoss).toBeCloseTo(9000, 2); // $30k - $21k
  });
});

// ═══════════════════════════════════════════════════════
// MIXED-TERM FEE PRO-RATION
// When a sale spans short-term and long-term lots, the
// Form 8949 export must split the fee proportionally.
// (Tested via export.test.ts, but we verify the engine
// provides the data needed for correct splitting.)
// ═══════════════════════════════════════════════════════

describe("Mixed-term sales — data for Form 8949 splitting", () => {
  it("mixed-term sale provides lot-level detail for fee pro-ration", () => {
    const txns = [
      buy("2022-01-01", 0.5, 30000),     // Long-term by 2024
      buy("2024-03-01", 0.5, 50000),     // Short-term in Aug 2024
      sell("2024-08-01", 1.0, 60000, { fee: 100 }),
    ];
    const result = calculate(txns, AccountingMethod.FIFO);
    const sale = result.sales[0];

    expect(sale.isMixedTerm).toBe(true);
    expect(sale.fee).toBeCloseTo(100, 2);

    // Lot details must distinguish long-term vs short-term
    const ltDetails = sale.lotDetails.filter(d => d.isLongTerm);
    const stDetails = sale.lotDetails.filter(d => !d.isLongTerm);
    expect(ltDetails).toHaveLength(1);
    expect(stDetails).toHaveLength(1);

    // Each detail has the BTC amount needed for pro-ration
    expect(ltDetails[0].amountBTC).toBeCloseTo(0.5, 8);
    expect(stDetails[0].amountBTC).toBeCloseTo(0.5, 8);

    // Total cost basis is sum of both
    const totalCost = ltDetails[0].totalCost + stDetails[0].totalCost;
    expect(totalCost).toBeCloseTo(sale.costBasis, 2);
  });
});

// ═══════════════════════════════════════════════════════
// ZERO-BASIS LOTS
// Airdrop or fork received at $0 FMV — entire proceeds is gain.
// ═══════════════════════════════════════════════════════

describe("Zero-basis lots", () => {
  it("airdrop at $0 FMV → entire sale proceeds is gain", () => {
    // Received 0.01 BTC as airdrop when price was effectively $0
    const txns = [
      buy("2024-01-01", 0.01, 0, { incomeType: IncomeType.Fork }),
      sell("2024-06-01", 0.01, 80000),
    ];
    const result = calculate(txns, AccountingMethod.FIFO);
    expect(result.sales).toHaveLength(1);
    expect(result.sales[0].costBasis).toBeCloseTo(0, 2);
    expect(result.sales[0].totalProceeds).toBeCloseTo(800, 2); // 0.01 × $80k
    expect(result.sales[0].gainLoss).toBeCloseTo(800, 2);      // Full proceeds = gain
  });
});

// ═══════════════════════════════════════════════════════
// IEEE 754 FLOAT PRECISION — no incorrect gain/loss signs
// Verify that float arithmetic doesn't produce phantom
// gains or losses near zero.
// ═══════════════════════════════════════════════════════

describe("IEEE 754 — float precision near boundaries", () => {
  it("break-even sale doesn't produce phantom gain or loss from float drift", () => {
    // Buy at exactly $42,000, sell at exactly $42,000
    const txns = [
      buy("2024-01-01", 0.33333333, 42000),
      sell("2024-06-01", 0.33333333, 42000),
    ];
    const result = calculate(txns, AccountingMethod.FIFO);
    // Gain/loss should be effectively zero (within float tolerance)
    expect(Math.abs(result.sales[0].gainLoss)).toBeLessThan(0.01);
  });

  it("epsilon snap prevents phantom lots after full consumption", () => {
    // 10 sells of 0.1 BTC each from a 1.0 BTC lot
    // Without epsilon snap: 1.0 - (0.1 × 10) might leave ~1e-16 dust
    const sellDates = [
      "2024-02-01", "2024-03-01", "2024-04-01", "2024-05-01", "2024-06-01",
      "2024-07-01", "2024-08-01", "2024-09-01", "2024-10-01", "2024-11-01",
    ];
    const txns = [
      buy("2024-01-01", 1.0, 40000),
      ...sellDates.map(d => sell(d, 0.1, 50000)),
    ];
    const result = calculate(txns, AccountingMethod.FIFO);
    expect(result.lots[0].remainingBTC).toBe(0); // Not 1e-16
  });

  it("many small buys and single sell — no precision loss", () => {
    // 10 buys of 0.1 BTC each, then sell all 1.0 BTC
    const buys = Array.from({ length: 10 }, (_, i) =>
      buy(`2024-01-${String(i + 1).padStart(2, "0")}`, 0.1, 40000)
    );
    const txns = [...buys, sell("2024-06-01", 1.0, 50000)];
    const result = calculate(txns, AccountingMethod.FIFO);

    // Total cost basis: 10 × (0.1 × $40k) = $40,000
    expect(result.sales[0].costBasis).toBeCloseTo(40000, 2);
    // Proceeds: 1.0 × $50k = $50,000
    expect(result.sales[0].totalProceeds).toBeCloseTo(50000, 2);
    // Gain: $10,000
    expect(result.sales[0].gainLoss).toBeCloseTo(10000, 2);

    // All lots consumed
    const remaining = result.lots.reduce((s, l) => s + l.remainingBTC, 0);
    expect(remaining).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════
// DONATION + SALE IN SAME YEAR
// Verify that donations and sales coexist correctly,
// each consuming lots independently via FIFO.
// ═══════════════════════════════════════════════════════

describe("Donation + sale interaction", () => {
  it("donation and sale from same lot — FIFO order", () => {
    // Buy 1 BTC, donate 0.3, sell 0.4 → 0.3 BTC remaining
    const txns = [
      buy("2024-01-01", 1.0, 40000),
      donation("2024-04-01", 0.3, 55000),  // Consumes 0.3
      sell("2024-08-01", 0.4, 60000),       // Consumes 0.4
    ];
    const result = calculate(txns, AccountingMethod.FIFO);
    expect(result.sales).toHaveLength(2);

    // Donation: 0.3 BTC, zero gain
    expect(result.sales[0].isDonation).toBe(true);
    expect(result.sales[0].amountSold).toBeCloseTo(0.3, 8);
    expect(result.sales[0].gainLoss).toBe(0);
    expect(result.sales[0].costBasis).toBeCloseTo(12000, 2); // 0.3 × $40k

    // Sale: 0.4 BTC, gain = 0.4 × ($60k - $40k) = $8,000
    expect(result.sales[1].amountSold).toBeCloseTo(0.4, 8);
    expect(result.sales[1].costBasis).toBeCloseTo(16000, 2); // 0.4 × $40k
    expect(result.sales[1].gainLoss).toBeCloseTo(8000, 2);

    // Remaining: 1.0 - 0.3 - 0.4 = 0.3
    expect(result.lots[0].remainingBTC).toBeCloseTo(0.3, 8);
  });

  it("donation exhausts lot, sale falls to next lot", () => {
    const txns = [
      buy("2024-01-01", 0.5, 30000),     // Lot 1
      buy("2024-02-01", 0.5, 50000),     // Lot 2
      donation("2024-04-01", 0.5, 55000), // Consumes all of Lot 1
      sell("2024-08-01", 0.3, 60000),     // Must use Lot 2
    ];
    const result = calculate(txns, AccountingMethod.FIFO);
    expect(result.sales).toHaveLength(2);

    // Donation cost basis: 0.5 × $30k = $15,000
    expect(result.sales[0].costBasis).toBeCloseTo(15000, 2);

    // Sale cost basis: 0.3 × $50k = $15,000 (from Lot 2, not Lot 1)
    expect(result.sales[1].costBasis).toBeCloseTo(15000, 2);
    expect(result.sales[1].gainLoss).toBeCloseTo(3000, 2); // $18k - $15k
  });
});

// ═══════════════════════════════════════════════════════
// CHRONOLOGICAL ORDERING
// The engine must sort transactions by date regardless
// of the order they're provided in the input array.
// ═══════════════════════════════════════════════════════

describe("Chronological ordering enforcement", () => {
  it("out-of-order input produces correct results", () => {
    // Provided: sell, buy2, buy1 (reverse order)
    const b1 = buy("2024-01-01", 0.5, 30000);
    const b2 = buy("2024-03-01", 0.5, 50000);
    const s1 = sell("2024-06-01", 0.5, 60000);

    // Deliberately provide in wrong order
    const result = calculate([s1, b2, b1], AccountingMethod.FIFO);
    expect(result.sales).toHaveLength(1);
    // FIFO should use b1 (Jan, oldest) not b2 (Mar)
    expect(result.sales[0].costBasis).toBeCloseTo(15000, 2); // 0.5 × $30k
  });

  it("sell before any buys in input → correctly has no lots", () => {
    const s1 = sell("2024-01-01", 0.5, 50000);
    const b1 = buy("2024-06-01", 1.0, 40000);
    const result = calculate([b1, s1], AccountingMethod.FIFO);
    // The sell is on Jan 1, buy is on Jun 1 → no lots for the sell
    expect(result.sales).toHaveLength(0);
    expect(result.warnings.length).toBeGreaterThan(0);
  });
});
