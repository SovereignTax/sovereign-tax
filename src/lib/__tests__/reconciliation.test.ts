import { describe, it, expect } from "vitest";
import { suggestSourceWallet, reconcileTransfers, MatchConfidence } from "../reconciliation";
import { createTransaction } from "../models";
import { TransactionType } from "../types";

// ═══════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════

function buy(date: string, amount: number, price: number, opts?: { exchange?: string; wallet?: string }) {
  return createTransaction({
    date: new Date(date + "T12:00:00").toISOString(),
    transactionType: TransactionType.Buy,
    amountBTC: amount,
    pricePerBTC: price,
    totalUSD: amount * price,
    exchange: opts?.exchange ?? "Coinbase",
    wallet: opts?.wallet ?? opts?.exchange ?? "Coinbase",
    notes: "",
  });
}

function transferOut(date: string, amount: number, opts?: { exchange?: string; wallet?: string }) {
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

function transferIn(date: string, amount: number, opts?: { exchange?: string; wallet?: string }) {
  return createTransaction({
    date: new Date(date + "T14:00:00").toISOString(),
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
// suggestSourceWallet
// ═══════════════════════════════════════════════════════

describe("suggestSourceWallet", () => {
  it("suggests the correct source wallet for a matched TransferOut→TransferIn pair", () => {
    const b1 = buy("2024-01-01", 1.0, 30000);
    const tOut = transferOut("2024-03-01", 1.0, { exchange: "Coinbase" });
    const tIn = transferIn("2024-03-01", 0.9999, { exchange: "Ledger" });

    const result = suggestSourceWallet(tIn, [b1, tOut, tIn]);

    expect(result).not.toBeNull();
    expect(result!.wallet).toBe("Coinbase");
    expect(result!.confidence).toBe(MatchConfidence.Confident);
    expect(result!.reason).toContain("Coinbase");
    expect(result!.reason).toContain("BTC withdrawal");
  });

  it("returns null when no matching TransferOut exists", () => {
    const b1 = buy("2024-01-01", 1.0, 30000);
    const tIn = transferIn("2024-03-01", 0.5, { exchange: "Ledger" });

    const result = suggestSourceWallet(tIn, [b1, tIn]);

    expect(result).toBeNull();
  });

  it("returns null for non-TransferIn transactions", () => {
    const b1 = buy("2024-01-01", 1.0, 30000);

    const result = suggestSourceWallet(b1, [b1]);

    expect(result).toBeNull();
  });

  it("returns flagged confidence when implied fee is high", () => {
    const b1 = buy("2024-01-01", 1.0, 30000);
    // Large fee gap: 1.0 out, 0.995 in (0.005 BTC fee > 0.0005 threshold)
    const tOut = transferOut("2024-03-01", 1.0, { exchange: "Coinbase" });
    const tIn = transferIn("2024-03-01", 0.995, { exchange: "Ledger" });

    const result = suggestSourceWallet(tIn, [b1, tOut, tIn]);

    expect(result).not.toBeNull();
    expect(result!.wallet).toBe("Coinbase");
    expect(result!.confidence).toBe(MatchConfidence.Flagged);
  });

  it("does not match same-exchange transfers", () => {
    const b1 = buy("2024-01-01", 1.0, 30000, { exchange: "Coinbase" });
    // Both on Coinbase — reconciler skips same-exchange
    const tOut = transferOut("2024-03-01", 1.0, { exchange: "Coinbase" });
    const tIn = transferIn("2024-03-01", 1.0, { exchange: "Coinbase" });

    const result = suggestSourceWallet(tIn, [b1, tOut, tIn]);

    expect(result).toBeNull();
  });

  it("does not match same-exchange transfers with different casing", () => {
    const b1 = buy("2024-01-01", 1.0, 30000, { exchange: "Coinbase" });
    // "coinbase" vs "Coinbase" — should still be treated as same exchange
    const tOut = transferOut("2024-03-01", 1.0, { exchange: "coinbase" });
    const tIn = transferIn("2024-03-01", 0.9999, { exchange: "Coinbase" });

    const result = suggestSourceWallet(tIn, [b1, tOut, tIn]);

    expect(result).toBeNull();
  });

  it("uses wallet field over exchange field when available", () => {
    const b1 = buy("2024-01-01", 1.0, 30000, { exchange: "Coinbase", wallet: "Coinbase Pro" });
    const tOut = transferOut("2024-03-01", 1.0, { exchange: "Coinbase", wallet: "Coinbase Pro" });
    const tIn = transferIn("2024-03-01", 0.9999, { exchange: "Ledger", wallet: "Ledger Nano" });

    const result = suggestSourceWallet(tIn, [b1, tOut, tIn]);

    expect(result).not.toBeNull();
    expect(result!.wallet).toBe("Coinbase Pro");
  });

  it("includes the withdrawal date in the reason", () => {
    const b1 = buy("2024-01-01", 1.0, 30000);
    const tOut = transferOut("2024-06-15", 0.5, { exchange: "Kraken" });
    const tIn = transferIn("2024-06-15", 0.4999, { exchange: "Trezor" });

    const result = suggestSourceWallet(tIn, [b1, tOut, tIn]);

    expect(result).not.toBeNull();
    expect(result!.reason).toContain("Jun");
    expect(result!.reason).toContain("2024");
  });
});

// ═══════════════════════════════════════════════════════
// Exchange balance key normalization (Batch A7)
// ═══════════════════════════════════════════════════════

describe("reconcileTransfers: exchange balance normalization", () => {
  it("merges balances for the same exchange with different casing or whitespace", () => {
    // Three buys for the same exchange under varied spellings — should land in one balance row.
    const b1 = buy("2024-01-01", 1.0, 30000, { exchange: "Coinbase" });
    const b2 = buy("2024-01-02", 0.5, 30000, { exchange: "coinbase" });
    const b3 = buy("2024-01-03", 0.25, 30000, { exchange: " Coinbase " });

    const result = reconcileTransfers([b1, b2, b3]);

    // Exactly one balance row for the merged Coinbase bucket
    expect(result.exchangeBalances).toHaveLength(1);
    expect(result.exchangeBalances[0].totalIn).toBeCloseTo(1.75, 8);
    expect(result.exchangeBalances[0].netBalance).toBeCloseTo(1.75, 8);
    // Display value uses first-seen spelling
    expect(result.exchangeBalances[0].exchange).toBe("Coinbase");
  });

  it("does not emit duplicate negative-balance warnings for case-variant exchange names", () => {
    // A TransferOut from "Coinbase" with no corresponding buy under either spelling
    // should produce at most ONE negative-balance warning (not one per spelling).
    const tOut1 = transferOut("2024-03-01", 0.5, { exchange: "Coinbase" });
    const tOut2 = transferOut("2024-03-02", 0.3, { exchange: "coinbase" });

    const result = reconcileTransfers([tOut1, tOut2]);

    const negativeWarnings = result.suggestedMissing.filter((m) => m.toLowerCase().includes("negative"));
    expect(negativeWarnings).toHaveLength(1);
    expect(result.exchangeBalances).toHaveLength(1);
    expect(result.exchangeBalances[0].netBalance).toBeCloseTo(-0.8, 8);
  });

  it("still separates genuinely different exchanges", () => {
    const b1 = buy("2024-01-01", 1.0, 30000, { exchange: "Coinbase" });
    const b2 = buy("2024-01-02", 0.5, 30000, { exchange: "Kraken" });
    const b3 = buy("2024-01-03", 0.25, 30000, { exchange: "River" });

    const result = reconcileTransfers([b1, b2, b3]);

    expect(result.exchangeBalances).toHaveLength(3);
  });
});
