import { describe, it, expect } from "vitest";
import { isMaterialChange, findStaleDownstreamRecords } from "../app-state";
import { createTransaction, Transaction, SaleRecord } from "../models";
import { TransactionType, AccountingMethod } from "../types";

// ═══════════════════════════════════════════════════════
// HELPER
// ═══════════════════════════════════════════════════════

function makeSell(overrides?: Partial<Parameters<typeof createTransaction>[0]>) {
  return createTransaction({
    date: new Date("2024-06-15T12:00:00").toISOString(),
    transactionType: TransactionType.Sell,
    amountBTC: 0.5,
    pricePerBTC: 60000,
    totalUSD: 30000,
    exchange: "Coinbase",
    wallet: "Coinbase",
    notes: "",
    ...overrides,
  });
}

// ═══════════════════════════════════════════════════════
// isMaterialChange — material field detection
// ═══════════════════════════════════════════════════════

describe("isMaterialChange", () => {
  // ── Non-material edits (should NOT trigger) ──

  it("returns false for notes-only edit", () => {
    const txn = makeSell();
    expect(isMaterialChange(txn, { notes: "updated note" })).toBe(false);
  });

  it("returns false for exchange-only edit", () => {
    const txn = makeSell();
    expect(isMaterialChange(txn, { exchange: "Kraken" })).toBe(false);
  });

  it("returns false for empty updates object", () => {
    const txn = makeSell();
    expect(isMaterialChange(txn, {})).toBe(false);
  });

  it("returns false when amount is unchanged (same value)", () => {
    const txn = makeSell({ amountBTC: 0.5 });
    expect(isMaterialChange(txn, { amountBTC: 0.5 })).toBe(false);
  });

  it("returns false when price is unchanged (same value)", () => {
    const txn = makeSell({ pricePerBTC: 60000 });
    expect(isMaterialChange(txn, { pricePerBTC: 60000 })).toBe(false);
  });

  it("returns false when wallet is unchanged (same value)", () => {
    const txn = makeSell({ wallet: "Coinbase" });
    expect(isMaterialChange(txn, { wallet: "Coinbase" })).toBe(false);
  });

  // ── Material edits (SHOULD trigger) ──

  it("detects amountBTC change", () => {
    const txn = makeSell({ amountBTC: 0.5 });
    expect(isMaterialChange(txn, { amountBTC: 0.6 })).toBe(true);
  });

  it("detects date change", () => {
    const txn = makeSell();
    expect(isMaterialChange(txn, { date: new Date("2024-07-01T12:00:00").toISOString() })).toBe(true);
  });

  it("detects pricePerBTC change", () => {
    const txn = makeSell({ pricePerBTC: 60000 });
    expect(isMaterialChange(txn, { pricePerBTC: 60001 })).toBe(true);
  });

  it("detects totalUSD change", () => {
    const txn = makeSell({ totalUSD: 30000 });
    expect(isMaterialChange(txn, { totalUSD: 30001 })).toBe(true);
  });

  it("detects wallet change", () => {
    const txn = makeSell({ wallet: "Coinbase" });
    expect(isMaterialChange(txn, { wallet: "Ledger" })).toBe(true);
  });

  it("detects transactionType change", () => {
    const txn = makeSell();
    expect(isMaterialChange(txn, { transactionType: TransactionType.Donation })).toBe(true);
  });

  // ── IEEE 754 edge cases (the whole reason this function exists) ──

  it("detects 1-satoshi BTC change (IEEE 754 boundary)", () => {
    // 0.01026254 - 0.01026253 = 9.99999994e-9 in float, below 1e-8
    // Integer comparison: Math.round(0.01026254 * 1e8) = 1026254, Math.round(0.01026253 * 1e8) = 1026253
    const txn = makeSell({ amountBTC: 0.01026254 });
    expect(isMaterialChange(txn, { amountBTC: 0.01026253 })).toBe(true);
  });

  it("detects 1-satoshi change on small amounts", () => {
    const txn = makeSell({ amountBTC: 0.00000002 });
    expect(isMaterialChange(txn, { amountBTC: 0.00000001 })).toBe(true);
  });

  it("detects 1-cent USD change", () => {
    const txn = makeSell({ pricePerBTC: 60000.01 });
    expect(isMaterialChange(txn, { pricePerBTC: 60000.02 })).toBe(true);
  });

  it("detects 1-cent totalUSD change", () => {
    const txn = makeSell({ totalUSD: 30000.50 });
    expect(isMaterialChange(txn, { totalUSD: 30000.51 })).toBe(true);
  });

  // ── Float round-trip drift (should NOT trigger) ──

  it("tolerates BTC float round-trip drift (toFixed(8) → Number)", () => {
    // Simulate: user edits notes, edit modal sends amountBTC through toFixed(8) → Number()
    const original = 0.12345678;
    const roundTripped = Number(original.toFixed(8));
    const txn = makeSell({ amountBTC: original });
    expect(isMaterialChange(txn, { amountBTC: roundTripped })).toBe(false);
  });

  it("tolerates USD float round-trip drift (toFixed(2) → Number)", () => {
    const original = 59999.99;
    const roundTripped = Number(original.toFixed(2));
    const txn = makeSell({ pricePerBTC: original });
    expect(isMaterialChange(txn, { pricePerBTC: roundTripped })).toBe(false);
  });

  it("tolerates totalUSD float round-trip drift", () => {
    const original = 29876.54;
    const roundTripped = Number(original.toFixed(2));
    const txn = makeSell({ totalUSD: original });
    expect(isMaterialChange(txn, { totalUSD: roundTripped })).toBe(false);
  });

  // ── Mixed updates ──

  it("returns false when only non-material fields are in a mixed update", () => {
    const txn = makeSell();
    expect(isMaterialChange(txn, { notes: "new note", exchange: "Kraken" })).toBe(false);
  });

  it("returns true when material field is mixed with non-material", () => {
    const txn = makeSell({ amountBTC: 0.5 });
    expect(isMaterialChange(txn, { notes: "new note", amountBTC: 0.6 })).toBe(true);
  });

  // ── sourceWallet (TransferIn lot re-tagging) ──

  it("detects sourceWallet change", () => {
    const txn = makeSell();
    (txn as any).sourceWallet = "Coinbase";
    expect(isMaterialChange(txn, { sourceWallet: "Kraken" } as any)).toBe(true);
  });

  it("returns false when sourceWallet is unchanged", () => {
    const txn = makeSell();
    (txn as any).sourceWallet = "Coinbase";
    expect(isMaterialChange(txn, { sourceWallet: "Coinbase" } as any)).toBe(false);
  });

  it("detects sourceWallet added (undefined → value)", () => {
    const txn = makeSell();
    expect(isMaterialChange(txn, { sourceWallet: "Coinbase" } as any)).toBe(true);
  });

  it("detects sourceWallet cleared (value → undefined)", () => {
    const txn = makeSell();
    (txn as any).sourceWallet = "Coinbase";
    expect(isMaterialChange(txn, { sourceWallet: undefined } as any)).toBe(true);
  });

  it("returns false when sourceWallet cleared but was already undefined", () => {
    const txn = makeSell();
    // sourceWallet is already undefined, clearing to undefined is no-op
    expect(isMaterialChange(txn, { sourceWallet: undefined } as any)).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════
// HELPERS for findStaleDownstreamRecords
// ═══════════════════════════════════════════════════════

function makeTransferIn(overrides?: Partial<Parameters<typeof createTransaction>[0]>): Transaction {
  return createTransaction({
    date: new Date("2025-03-01T12:00:00").toISOString(),
    transactionType: TransactionType.TransferIn,
    amountBTC: 1.0,
    pricePerBTC: 50000,
    totalUSD: 50000,
    exchange: "Ledger",
    wallet: "Ledger",
    notes: "",
    ...overrides,
  });
}

function makeSaleRecord(sourceTransaction: Transaction, overrides?: Partial<SaleRecord>): SaleRecord {
  return {
    id: crypto.randomUUID(),
    saleDate: sourceTransaction.date,
    amountSold: sourceTransaction.amountBTC,
    salePricePerBTC: sourceTransaction.pricePerBTC,
    totalProceeds: sourceTransaction.totalUSD,
    costBasis: sourceTransaction.amountBTC * 40000,
    gainLoss: sourceTransaction.totalUSD - sourceTransaction.amountBTC * 40000,
    lotDetails: [],
    holdingPeriodDays: 400,
    isLongTerm: true,
    isMixedTerm: false,
    method: AccountingMethod.SpecificID,
    sourceTransactionId: sourceTransaction.id,
    ...overrides,
  };
}

// ═══════════════════════════════════════════════════════
// findStaleDownstreamRecords — TransferIn downstream invalidation
// ═══════════════════════════════════════════════════════

describe("findStaleDownstreamRecords", () => {
  // ── sourceWallet change invalidates downstream sells ──

  it("invalidates downstream Specific ID sell in destination wallet when sourceWallet changes", () => {
    const transfer = makeTransferIn({ wallet: "Ledger", sourceWallet: "Coinbase" });
    const sell = createTransaction({
      date: new Date("2025-04-01T12:00:00").toISOString(),
      transactionType: TransactionType.Sell,
      amountBTC: 0.5,
      pricePerBTC: 60000,
      totalUSD: 30000,
      exchange: "Ledger",
      wallet: "Ledger",
      notes: "",
    });
    const record = makeSaleRecord(sell);

    const staleIds = findStaleDownstreamRecords(
      transfer,
      { sourceWallet: "Kraken" },
      [transfer, sell],
      [record]
    );
    expect(staleIds).toContain(record.id);
  });

  it("invalidates downstream sell in OLD source wallet when sourceWallet changes", () => {
    const transfer = makeTransferIn({ wallet: "Ledger", sourceWallet: "Coinbase" });
    // Sell happens on Coinbase (old source wallet)
    const sell = createTransaction({
      date: new Date("2025-04-01T12:00:00").toISOString(),
      transactionType: TransactionType.Sell,
      amountBTC: 0.3,
      pricePerBTC: 60000,
      totalUSD: 18000,
      exchange: "Coinbase",
      wallet: "Coinbase",
      notes: "",
    });
    const record = makeSaleRecord(sell);

    const staleIds = findStaleDownstreamRecords(
      transfer,
      { sourceWallet: "Kraken" },
      [transfer, sell],
      [record]
    );
    expect(staleIds).toContain(record.id);
  });

  it("invalidates downstream sell in NEW source wallet when sourceWallet changes", () => {
    const transfer = makeTransferIn({ wallet: "Ledger", sourceWallet: "Coinbase" });
    // Sell happens on Kraken (the new source wallet)
    const sell = createTransaction({
      date: new Date("2025-04-01T12:00:00").toISOString(),
      transactionType: TransactionType.Sell,
      amountBTC: 0.2,
      pricePerBTC: 60000,
      totalUSD: 12000,
      exchange: "Kraken",
      wallet: "Kraken",
      notes: "",
    });
    const record = makeSaleRecord(sell);

    const staleIds = findStaleDownstreamRecords(
      transfer,
      { sourceWallet: "Kraken" },
      [transfer, sell],
      [record]
    );
    expect(staleIds).toContain(record.id);
  });

  // ── Wallet-scoped: unrelated wallets are NOT invalidated ──

  it("does NOT invalidate sells in unrelated wallets", () => {
    const transfer = makeTransferIn({ wallet: "Ledger", sourceWallet: "Coinbase" });
    // Sell on Gemini — not affected by Coinbase→Ledger transfer
    const sell = createTransaction({
      date: new Date("2025-04-01T12:00:00").toISOString(),
      transactionType: TransactionType.Sell,
      amountBTC: 0.5,
      pricePerBTC: 60000,
      totalUSD: 30000,
      exchange: "Gemini",
      wallet: "Gemini",
      notes: "",
    });
    const record = makeSaleRecord(sell);

    const staleIds = findStaleDownstreamRecords(
      transfer,
      { sourceWallet: "Kraken" },
      [transfer, sell],
      [record]
    );
    expect(staleIds).toHaveLength(0);
  });

  // ── Date boundary: only downstream (at or after transfer date) ──

  it("does NOT invalidate sells BEFORE the transfer date", () => {
    const transfer = makeTransferIn({ wallet: "Ledger", sourceWallet: "Coinbase" });
    // Sell happened before the transfer
    const sell = createTransaction({
      date: new Date("2025-02-01T12:00:00").toISOString(),
      transactionType: TransactionType.Sell,
      amountBTC: 0.5,
      pricePerBTC: 55000,
      totalUSD: 27500,
      exchange: "Ledger",
      wallet: "Ledger",
      notes: "",
    });
    const record = makeSaleRecord(sell);

    const staleIds = findStaleDownstreamRecords(
      transfer,
      { sourceWallet: "Kraken" },
      [transfer, sell],
      [record]
    );
    expect(staleIds).toHaveLength(0);
  });

  it("invalidates sell on the SAME date as the transfer", () => {
    const transfer = makeTransferIn({ wallet: "Ledger", sourceWallet: "Coinbase" });
    // Sell on same day as transfer (>= check, not >)
    const sell = createTransaction({
      date: new Date("2025-03-01T18:00:00").toISOString(),
      transactionType: TransactionType.Sell,
      amountBTC: 0.5,
      pricePerBTC: 55000,
      totalUSD: 27500,
      exchange: "Ledger",
      wallet: "Ledger",
      notes: "",
    });
    const record = makeSaleRecord(sell);

    const staleIds = findStaleDownstreamRecords(
      transfer,
      { sourceWallet: "Kraken" },
      [transfer, sell],
      [record]
    );
    expect(staleIds).toContain(record.id);
  });

  // ── Destination wallet change ──

  it("invalidates sells in NEW destination wallet when wallet changes", () => {
    const transfer = makeTransferIn({ wallet: "Ledger", sourceWallet: "Coinbase" });
    // Sell on Trezor (the new destination)
    const sell = createTransaction({
      date: new Date("2025-04-01T12:00:00").toISOString(),
      transactionType: TransactionType.Sell,
      amountBTC: 0.5,
      pricePerBTC: 60000,
      totalUSD: 30000,
      exchange: "Trezor",
      wallet: "Trezor",
      notes: "",
    });
    const record = makeSaleRecord(sell);

    const staleIds = findStaleDownstreamRecords(
      transfer,
      { wallet: "Trezor" },
      [transfer, sell],
      [record]
    );
    expect(staleIds).toContain(record.id);
  });

  // ── FIFO records are NOT invalidated ──

  it("does NOT invalidate FIFO sale records (only Specific ID)", () => {
    const transfer = makeTransferIn({ wallet: "Ledger", sourceWallet: "Coinbase" });
    const sell = createTransaction({
      date: new Date("2025-04-01T12:00:00").toISOString(),
      transactionType: TransactionType.Sell,
      amountBTC: 0.5,
      pricePerBTC: 60000,
      totalUSD: 30000,
      exchange: "Ledger",
      wallet: "Ledger",
      notes: "",
    });
    const record = makeSaleRecord(sell, { method: AccountingMethod.FIFO });

    const staleIds = findStaleDownstreamRecords(
      transfer,
      { sourceWallet: "Kraken" },
      [transfer, sell],
      [record]
    );
    expect(staleIds).toHaveLength(0);
  });

  // ── Non-material changes don't invalidate anything ──

  it("returns empty when edit is non-material (notes only)", () => {
    const transfer = makeTransferIn({ wallet: "Ledger", sourceWallet: "Coinbase" });
    const sell = createTransaction({
      date: new Date("2025-04-01T12:00:00").toISOString(),
      transactionType: TransactionType.Sell,
      amountBTC: 0.5,
      pricePerBTC: 60000,
      totalUSD: 30000,
      exchange: "Ledger",
      wallet: "Ledger",
      notes: "",
    });
    const record = makeSaleRecord(sell);

    const staleIds = findStaleDownstreamRecords(
      transfer,
      { notes: "updated note" },
      [transfer, sell],
      [record]
    );
    expect(staleIds).toHaveLength(0);
  });

  // ── Non-TransferIn transactions ──

  it("returns empty for non-TransferIn transactions", () => {
    const buy = createTransaction({
      date: new Date("2025-03-01T12:00:00").toISOString(),
      transactionType: TransactionType.Buy,
      amountBTC: 1.0,
      pricePerBTC: 50000,
      totalUSD: 50000,
      exchange: "Coinbase",
      wallet: "Coinbase",
      notes: "",
    });
    const sell = createTransaction({
      date: new Date("2025-04-01T12:00:00").toISOString(),
      transactionType: TransactionType.Sell,
      amountBTC: 0.5,
      pricePerBTC: 60000,
      totalUSD: 30000,
      exchange: "Coinbase",
      wallet: "Coinbase",
      notes: "",
    });
    const record = makeSaleRecord(sell);

    const staleIds = findStaleDownstreamRecords(
      buy,
      { amountBTC: 2.0 },
      [buy, sell],
      [record]
    );
    expect(staleIds).toHaveLength(0);
  });

  // ── Records without sourceTransactionId are ignored ──

  it("does NOT invalidate records without sourceTransactionId (legacy)", () => {
    const transfer = makeTransferIn({ wallet: "Ledger", sourceWallet: "Coinbase" });
    const sell = createTransaction({
      date: new Date("2025-04-01T12:00:00").toISOString(),
      transactionType: TransactionType.Sell,
      amountBTC: 0.5,
      pricePerBTC: 60000,
      totalUSD: 30000,
      exchange: "Ledger",
      wallet: "Ledger",
      notes: "",
    });
    const record = makeSaleRecord(sell, { sourceTransactionId: undefined });

    const staleIds = findStaleDownstreamRecords(
      transfer,
      { sourceWallet: "Kraken" },
      [transfer, sell],
      [record]
    );
    expect(staleIds).toHaveLength(0);
  });

  // ── Donations are also invalidated ──

  it("invalidates downstream Specific ID donation records", () => {
    const transfer = makeTransferIn({ wallet: "Ledger", sourceWallet: "Coinbase" });
    const donation = createTransaction({
      date: new Date("2025-04-01T12:00:00").toISOString(),
      transactionType: TransactionType.Donation,
      amountBTC: 0.1,
      pricePerBTC: 60000,
      totalUSD: 6000,
      exchange: "Ledger",
      wallet: "Ledger",
      notes: "",
    });
    const record = makeSaleRecord(donation, { isDonation: true });

    const staleIds = findStaleDownstreamRecords(
      transfer,
      { sourceWallet: "Kraken" },
      [transfer, donation],
      [record]
    );
    expect(staleIds).toContain(record.id);
  });

  // ── Case-insensitive wallet matching ──

  it("matches wallets case-insensitively", () => {
    const transfer = makeTransferIn({ wallet: "LEDGER", sourceWallet: "coinbase" });
    const sell = createTransaction({
      date: new Date("2025-04-01T12:00:00").toISOString(),
      transactionType: TransactionType.Sell,
      amountBTC: 0.5,
      pricePerBTC: 60000,
      totalUSD: 30000,
      exchange: "Ledger",
      wallet: "ledger",
      notes: "",
    });
    const record = makeSaleRecord(sell);

    const staleIds = findStaleDownstreamRecords(
      transfer,
      { sourceWallet: "KRAKEN" },
      [transfer, sell],
      [record]
    );
    expect(staleIds).toContain(record.id);
  });

  // ── Multiple records: selective invalidation ──

  it("invalidates only records in affected wallets, leaves others", () => {
    const transfer = makeTransferIn({ wallet: "Ledger", sourceWallet: "Coinbase" });
    const sellLedger = createTransaction({
      date: new Date("2025-04-01T12:00:00").toISOString(),
      transactionType: TransactionType.Sell,
      amountBTC: 0.5,
      pricePerBTC: 60000,
      totalUSD: 30000,
      exchange: "Ledger",
      wallet: "Ledger",
      notes: "",
    });
    const sellGemini = createTransaction({
      date: new Date("2025-04-01T12:00:00").toISOString(),
      transactionType: TransactionType.Sell,
      amountBTC: 0.3,
      pricePerBTC: 60000,
      totalUSD: 18000,
      exchange: "Gemini",
      wallet: "Gemini",
      notes: "",
    });
    const recordLedger = makeSaleRecord(sellLedger);
    const recordGemini = makeSaleRecord(sellGemini);

    const staleIds = findStaleDownstreamRecords(
      transfer,
      { sourceWallet: "Kraken" },
      [transfer, sellLedger, sellGemini],
      [recordLedger, recordGemini]
    );
    expect(staleIds).toContain(recordLedger.id);
    expect(staleIds).not.toContain(recordGemini.id);
  });

  // ── amountBTC material change also triggers invalidation ──

  it("invalidates downstream records when transfer amount changes", () => {
    const transfer = makeTransferIn({ wallet: "Ledger", sourceWallet: "Coinbase", amountBTC: 1.0 });
    const sell = createTransaction({
      date: new Date("2025-04-01T12:00:00").toISOString(),
      transactionType: TransactionType.Sell,
      amountBTC: 0.5,
      pricePerBTC: 60000,
      totalUSD: 30000,
      exchange: "Ledger",
      wallet: "Ledger",
      notes: "",
    });
    const record = makeSaleRecord(sell);

    const staleIds = findStaleDownstreamRecords(
      transfer,
      { amountBTC: 0.5 },
      [transfer, sell],
      [record]
    );
    expect(staleIds).toContain(record.id);
  });

  // ── Date change shifts the downstream window ──

  it("uses updated date for downstream window when transfer date changes", () => {
    const transfer = makeTransferIn({
      date: new Date("2025-03-01T12:00:00").toISOString(),
      wallet: "Ledger",
      sourceWallet: "Coinbase",
    });
    // Sell on March 15 — if transfer moves to April 1, this sell is no longer downstream
    const sell = createTransaction({
      date: new Date("2025-03-15T12:00:00").toISOString(),
      transactionType: TransactionType.Sell,
      amountBTC: 0.5,
      pricePerBTC: 60000,
      totalUSD: 30000,
      exchange: "Ledger",
      wallet: "Ledger",
      notes: "",
    });
    const record = makeSaleRecord(sell);

    // Move transfer date forward past the sell
    const staleIds = findStaleDownstreamRecords(
      transfer,
      { date: new Date("2025-04-01T12:00:00").toISOString() },
      [transfer, sell],
      [record]
    );
    // Sell is March 15, new transfer date is April 1 → sell is no longer downstream
    expect(staleIds).toHaveLength(0);
  });

  // ── Fallback to exchange when wallet is empty ──

  it("falls back to exchange name when wallet is empty", () => {
    const transfer = makeTransferIn({ wallet: "", exchange: "Ledger", sourceWallet: "Coinbase" });
    const sell = createTransaction({
      date: new Date("2025-04-01T12:00:00").toISOString(),
      transactionType: TransactionType.Sell,
      amountBTC: 0.5,
      pricePerBTC: 60000,
      totalUSD: 30000,
      exchange: "Ledger",
      wallet: "",
      notes: "",
    });
    const record = makeSaleRecord(sell);

    const staleIds = findStaleDownstreamRecords(
      transfer,
      { sourceWallet: "Kraken" },
      [transfer, sell],
      [record]
    );
    expect(staleIds).toContain(record.id);
  });
});
