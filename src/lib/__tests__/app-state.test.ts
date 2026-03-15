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

  // ── Wallet normalization (case + whitespace) ──

  it("returns false when wallet differs only in case", () => {
    const txn = makeSell({ wallet: "Coinbase" });
    expect(isMaterialChange(txn, { wallet: "coinbase" })).toBe(false);
  });

  it("returns false when wallet differs only in whitespace", () => {
    const txn = makeSell({ wallet: "Coinbase" });
    expect(isMaterialChange(txn, { wallet: "  Coinbase  " })).toBe(false);
  });

  it("returns false when sourceWallet differs only in case", () => {
    const txn = makeSell();
    (txn as any).sourceWallet = "Ledger Nano";
    expect(isMaterialChange(txn, { sourceWallet: "ledger nano" } as any)).toBe(false);
  });

  it("returns true when wallet has a real change despite case difference", () => {
    const txn = makeSell({ wallet: "Coinbase" });
    expect(isMaterialChange(txn, { wallet: "Kraken" })).toBe(true);
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

  it("matches wallets case-insensitively (trim + lowercase)", () => {
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

  it("does NOT catch multi-hop descendant sales (wallet-scoped only — Pass 2 in updateTransaction covers this)", () => {
    // Coinbase → Ledger (t1) → Kraken (t2) → sell at Kraken
    // Editing t1: affected wallets = {Coinbase, Ledger} — Kraken is NOT included
    // findStaleDownstreamRecords misses the Kraken sale. The lot-ID-scoped Pass 2
    // in updateTransaction catches it via lotDetails.includes("-xfer-" + t1.id[:8]).
    const t1 = makeTransferIn({ wallet: "Ledger", sourceWallet: "Coinbase" });
    const sellAtKraken = createTransaction({
      date: new Date("2025-06-01T12:00:00").toISOString(),
      transactionType: TransactionType.Sell,
      amountBTC: 0.5,
      pricePerBTC: 70000,
      totalUSD: 35000,
      exchange: "Kraken",
      wallet: "Kraken",
      notes: "",
    });
    // Sale record with a descendant lot ID: buyId-xfer-t1[:8]-xfer-t2[:8]
    const descendantLotId = "someBuyId-xfer-" + t1.id.slice(0, 8) + "-xfer-" + crypto.randomUUID().slice(0, 8);
    const record = makeSaleRecord(sellAtKraken, {
      lotDetails: [{
        id: crypto.randomUUID(),
        lotId: descendantLotId,
        amountBTC: 0.5,
        costBasisPerBTC: 30000,
        totalCost: 15000,
        purchaseDate: "2024-01-01T12:00:00.000Z",
        daysHeld: 500,
        exchange: "Kraken",
        isLongTerm: true,
      }],
    });

    // findStaleDownstreamRecords only checks Coinbase + Ledger wallets — misses Kraken
    const walletScopedIds = findStaleDownstreamRecords(
      t1,
      { sourceWallet: "Binance" },
      [t1, sellAtKraken],
      [record]
    );
    expect(walletScopedIds).toHaveLength(0); // Kraken not in affected wallets

    // The lot-ID-scoped sweep (Pass 2 in updateTransaction) would catch this:
    const xferSuffix = "-xfer-" + t1.id.slice(0, 8);
    const lotScopedIds = [record]
      .filter((s) => s.method === AccountingMethod.SpecificID && s.lotDetails.some((d) => d.lotId && d.lotId.includes(xferSuffix)))
      .map((s) => s.id);
    expect(lotScopedIds).toContain(record.id);
  });
});

// ═══════════════════════════════════════════════════════
// Buy edit/delete → Specific ID election invalidation
// Tests the filtering logic used by deleteTransaction and updateTransaction
// ═══════════════════════════════════════════════════════

describe("Buy delete cascades to Specific ID elections", () => {
  function makeBuy(overrides?: Partial<Parameters<typeof createTransaction>[0]>) {
    return createTransaction({
      date: new Date("2024-01-15T12:00:00").toISOString(),
      transactionType: TransactionType.Buy,
      amountBTC: 1.0,
      pricePerBTC: 30000,
      totalUSD: 30000,
      exchange: "Coinbase",
      wallet: "Coinbase",
      notes: "",
      ...overrides,
    });
  }

  function makeSaleRecordWithLot(buyId: string, overrides?: Partial<SaleRecord>): SaleRecord {
    return {
      id: crypto.randomUUID(),
      saleDate: new Date("2024-06-15T12:00:00").toISOString(),
      amountSold: 0.5,
      salePricePerBTC: 50000,
      totalProceeds: 25000,
      costBasis: 15000,
      gainLoss: 10000,
      lotDetails: [{
        id: crypto.randomUUID(),
        lotId: buyId,
        purchaseDate: "2024-01-15T12:00:00.000Z",
        amountBTC: 0.5,
        costBasisPerBTC: 30000,
        totalCost: 15000,
        daysHeld: 152,
        exchange: "Coinbase",
        isLongTerm: false,
      }],
      holdingPeriodDays: 152,
      isLongTerm: false,
      isMixedTerm: false,
      method: AccountingMethod.SpecificID,
      sourceTransactionId: crypto.randomUUID(),
      ...overrides,
    };
  }

  // Simulates the filtering logic from deleteTransaction's Buy/TransferIn cascade block
  function simulateDeleteCascade(deletedId: string, deletedType: string, allSales: SaleRecord[]): SaleRecord[] {
    if (deletedType !== TransactionType.Buy && deletedType !== TransactionType.TransferIn) return allSales;
    const xferSuffix = "-xfer-" + deletedId.slice(0, 8);
    const isStaleRef = (lotId: string) =>
      deletedType === TransactionType.Buy
        ? lotId === deletedId || lotId.startsWith(deletedId + "-xfer-")
        : lotId.includes(xferSuffix);
    const staleSaleIds = allSales
      .filter((s) => s.method === AccountingMethod.SpecificID && s.lotDetails.some((d) => d.lotId && isStaleRef(d.lotId)))
      .map((s) => s.id);
    if (staleSaleIds.length === 0) return allSales;
    const staleSet = new Set(staleSaleIds);
    return allSales.filter((s) => !staleSet.has(s.id));
  }

  it("removes Specific ID elections referencing deleted Buy", () => {
    const b1 = makeBuy();
    const record = makeSaleRecordWithLot(b1.id);
    const remaining = simulateDeleteCascade(b1.id, TransactionType.Buy, [record]);
    expect(remaining).toHaveLength(0);
  });

  it("removes ALL elections referencing the same deleted Buy", () => {
    const b1 = makeBuy();
    const r1 = makeSaleRecordWithLot(b1.id);
    const r2 = makeSaleRecordWithLot(b1.id);
    const remaining = simulateDeleteCascade(b1.id, TransactionType.Buy, [r1, r2]);
    expect(remaining).toHaveLength(0);
  });

  it("only removes elections referencing the deleted Buy, leaves others intact", () => {
    const b1 = makeBuy();
    const b2 = makeBuy({ date: new Date("2024-02-01T12:00:00").toISOString() });
    const r1 = makeSaleRecordWithLot(b1.id);
    const r2 = makeSaleRecordWithLot(b2.id);
    const remaining = simulateDeleteCascade(b1.id, TransactionType.Buy, [r1, r2]);
    expect(remaining).toHaveLength(1);
    expect(remaining[0].id).toBe(r2.id);
  });

  it("does NOT remove FIFO sale records when Buy is deleted", () => {
    const b1 = makeBuy();
    const fifoRecord = makeSaleRecordWithLot(b1.id, { method: AccountingMethod.FIFO });
    const remaining = simulateDeleteCascade(b1.id, TransactionType.Buy, [fifoRecord]);
    expect(remaining).toHaveLength(1);
  });

  it("does NOT cascade for Sell deletions (only Buy/TransferIn)", () => {
    const b1 = makeBuy();
    const record = makeSaleRecordWithLot(b1.id);
    const remaining = simulateDeleteCascade(b1.id, TransactionType.Sell, [record]);
    expect(remaining).toHaveLength(1);
  });

  it("cascades for TransferIn deletions (direct split lot)", () => {
    const ti = createTransaction({
      date: new Date("2024-01-15T12:00:00").toISOString(),
      transactionType: TransactionType.TransferIn,
      amountBTC: 1.0,
      pricePerBTC: 0,
      totalUSD: 0,
      exchange: "Ledger",
      wallet: "Ledger",
      notes: "",
    });
    // Split lots created by a transfer have IDs like: buyId-xfer-transferId[:8]
    const splitLotId = "someBuyId-xfer-" + ti.id.slice(0, 8);
    const record = makeSaleRecordWithLot(splitLotId);
    const remaining = simulateDeleteCascade(ti.id, TransactionType.TransferIn, [record]);
    expect(remaining).toHaveLength(0);
  });

  it("Buy deletion cascades to elections referencing split lots (buyId-xfer-...)", () => {
    const b1 = makeBuy();
    const splitLotId = b1.id + "-xfer-" + crypto.randomUUID().slice(0, 8);
    const record = makeSaleRecordWithLot(splitLotId);
    const remaining = simulateDeleteCascade(b1.id, TransactionType.Buy, [record]);
    expect(remaining).toHaveLength(0);
  });

  it("TransferIn deletion cascades to elections referencing descendant split lots (multi-hop)", () => {
    // Simulate: Buy → Transfer t1 (creates buyId-xfer-t1[:8]) → Transfer t2 (creates buyId-xfer-t1[:8]-xfer-t2[:8])
    // Deleting t1 should invalidate a sale that references the descendant lot
    const t1 = createTransaction({
      date: new Date("2024-02-01T12:00:00").toISOString(),
      transactionType: TransactionType.TransferIn,
      amountBTC: 0.5,
      pricePerBTC: 0,
      totalUSD: 0,
      exchange: "Ledger",
      wallet: "Ledger",
      notes: "",
    });
    const t2 = createTransaction({
      date: new Date("2024-03-01T12:00:00").toISOString(),
      transactionType: TransactionType.TransferIn,
      amountBTC: 0.5,
      pricePerBTC: 0,
      totalUSD: 0,
      exchange: "Kraken",
      wallet: "Kraken",
      notes: "",
    });
    // Descendant lot ID: buyId-xfer-t1[:8]-xfer-t2[:8]
    const descendantLotId = "someBuyId-xfer-" + t1.id.slice(0, 8) + "-xfer-" + t2.id.slice(0, 8);
    const record = makeSaleRecordWithLot(descendantLotId);
    const remaining = simulateDeleteCascade(t1.id, TransactionType.TransferIn, [record]);
    expect(remaining).toHaveLength(0);
  });
});

describe("Buy edit invalidates Specific ID elections", () => {
  function makeBuy(overrides?: Partial<Parameters<typeof createTransaction>[0]>) {
    return createTransaction({
      date: new Date("2024-01-15T12:00:00").toISOString(),
      transactionType: TransactionType.Buy,
      amountBTC: 1.0,
      pricePerBTC: 30000,
      totalUSD: 30000,
      exchange: "Coinbase",
      wallet: "Coinbase",
      notes: "",
      ...overrides,
    });
  }

  function makeSaleRecordWithLot(buyId: string, overrides?: Partial<SaleRecord>): SaleRecord {
    return {
      id: crypto.randomUUID(),
      saleDate: new Date("2024-06-15T12:00:00").toISOString(),
      amountSold: 0.5,
      salePricePerBTC: 50000,
      totalProceeds: 25000,
      costBasis: 15000,
      gainLoss: 10000,
      lotDetails: [{
        id: crypto.randomUUID(),
        lotId: buyId,
        purchaseDate: "2024-01-15T12:00:00.000Z",
        amountBTC: 0.5,
        costBasisPerBTC: 30000,
        totalCost: 15000,
        daysHeld: 152,
        exchange: "Coinbase",
        isLongTerm: false,
      }],
      holdingPeriodDays: 152,
      isLongTerm: false,
      isMixedTerm: false,
      method: AccountingMethod.SpecificID,
      sourceTransactionId: crypto.randomUUID(),
      ...overrides,
    };
  }

  // Simulates the Buy edit invalidation logic from updateTransaction
  function simulateBuyEditInvalidation(
    original: ReturnType<typeof createTransaction>,
    updates: Partial<Omit<ReturnType<typeof createTransaction>, "id">>,
    allSales: SaleRecord[]
  ): SaleRecord[] {
    if (original.transactionType !== TransactionType.Buy) return allSales;
    const btcDecreased = updates.amountBTC !== undefined && Math.round(updates.amountBTC * 1e8) < Math.round(original.amountBTC * 1e8);
    const walletChanged = updates.wallet !== undefined && updates.wallet !== original.wallet;
    const typeChanged = updates.transactionType !== undefined && updates.transactionType !== TransactionType.Buy;
    if (!btcDecreased && !walletChanged && !typeChanged) return allSales;
    const staleSaleIds = allSales
      .filter((s) => s.method === AccountingMethod.SpecificID && s.lotDetails.some((d) => d.lotId === original.id))
      .map((s) => s.id);
    if (staleSaleIds.length === 0) return allSales;
    const staleSet = new Set(staleSaleIds);
    return allSales.filter((s) => !staleSet.has(s.id));
  }

  // ── Invalidating changes ──

  it("invalidates elections when Buy amount is decreased", () => {
    const b1 = makeBuy({ amountBTC: 1.0 });
    const record = makeSaleRecordWithLot(b1.id);
    const remaining = simulateBuyEditInvalidation(b1, { amountBTC: 0.8 }, [record]);
    expect(remaining).toHaveLength(0);
  });

  it("invalidates elections when Buy wallet changes", () => {
    const b1 = makeBuy({ wallet: "Coinbase" });
    const record = makeSaleRecordWithLot(b1.id);
    const remaining = simulateBuyEditInvalidation(b1, { wallet: "Ledger" }, [record]);
    expect(remaining).toHaveLength(0);
  });

  it("invalidates elections when Buy type changes away from Buy", () => {
    const b1 = makeBuy();
    const record = makeSaleRecordWithLot(b1.id);
    const remaining = simulateBuyEditInvalidation(b1, { transactionType: TransactionType.TransferIn }, [record]);
    expect(remaining).toHaveLength(0);
  });

  // ── Non-invalidating changes ──

  it("does NOT invalidate when Buy price changes", () => {
    const b1 = makeBuy({ pricePerBTC: 30000 });
    const record = makeSaleRecordWithLot(b1.id);
    const remaining = simulateBuyEditInvalidation(b1, { pricePerBTC: 31000 }, [record]);
    expect(remaining).toHaveLength(1);
  });

  it("does NOT invalidate when Buy date changes", () => {
    const b1 = makeBuy();
    const record = makeSaleRecordWithLot(b1.id);
    const remaining = simulateBuyEditInvalidation(b1, { date: new Date("2024-01-20T12:00:00").toISOString() }, [record]);
    expect(remaining).toHaveLength(1);
  });

  it("does NOT invalidate when Buy notes change", () => {
    const b1 = makeBuy();
    const record = makeSaleRecordWithLot(b1.id);
    const remaining = simulateBuyEditInvalidation(b1, { notes: "updated note" } as any, [record]);
    expect(remaining).toHaveLength(1);
  });

  it("does NOT invalidate when Buy amount INCREASES", () => {
    const b1 = makeBuy({ amountBTC: 1.0 });
    const record = makeSaleRecordWithLot(b1.id);
    const remaining = simulateBuyEditInvalidation(b1, { amountBTC: 1.5 }, [record]);
    expect(remaining).toHaveLength(1);
  });

  it("does NOT invalidate when Buy exchange changes (non-material for lots)", () => {
    const b1 = makeBuy({ exchange: "Coinbase" });
    const record = makeSaleRecordWithLot(b1.id);
    const remaining = simulateBuyEditInvalidation(b1, { exchange: "Kraken" } as any, [record]);
    expect(remaining).toHaveLength(1);
  });

  // ── Selective invalidation ──

  it("only invalidates elections referencing the edited Buy", () => {
    const b1 = makeBuy();
    const b2 = makeBuy({ date: new Date("2024-02-01T12:00:00").toISOString() });
    const r1 = makeSaleRecordWithLot(b1.id);
    const r2 = makeSaleRecordWithLot(b2.id);
    const remaining = simulateBuyEditInvalidation(b1, { amountBTC: 0.5 }, [r1, r2]);
    expect(remaining).toHaveLength(1);
    expect(remaining[0].id).toBe(r2.id);
  });

  it("invalidates ALL elections referencing the same edited Buy", () => {
    const b1 = makeBuy();
    const r1 = makeSaleRecordWithLot(b1.id);
    const r2 = makeSaleRecordWithLot(b1.id);
    const remaining = simulateBuyEditInvalidation(b1, { wallet: "Ledger" }, [r1, r2]);
    expect(remaining).toHaveLength(0);
  });
});
