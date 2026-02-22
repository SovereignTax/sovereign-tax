import { describe, it, expect } from "vitest";
import { isMaterialChange } from "../app-state";
import { createTransaction } from "../models";
import { TransactionType } from "../types";

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
});
