import { describe, it, expect } from "vitest";
import { suggestSourceWallet, reconcileTransfers, reconcileOptionsFromPrefs, transferPairKey, walletOf, MatchConfidence } from "../reconciliation";
import { calculate } from "../cost-basis";
import { createTransaction } from "../models";
import { TransactionType, AccountingMethod } from "../types";

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
// Wallet balance key normalization (Batch A7)
// ═══════════════════════════════════════════════════════

describe("reconcileTransfers: wallet balance normalization", () => {
  it("merges balances for the same exchange with different casing or whitespace", () => {
    // Three buys for the same exchange under varied spellings — should land in one balance row.
    const b1 = buy("2024-01-01", 1.0, 30000, { exchange: "Coinbase" });
    const b2 = buy("2024-01-02", 0.5, 30000, { exchange: "coinbase" });
    const b3 = buy("2024-01-03", 0.25, 30000, { exchange: " Coinbase " });

    const result = reconcileTransfers([b1, b2, b3]);

    // Exactly one balance row for the merged Coinbase bucket
    expect(result.walletBalances).toHaveLength(1);
    expect(result.walletBalances[0].totalIn).toBeCloseTo(1.75, 8);
    expect(result.walletBalances[0].netBalance).toBeCloseTo(1.75, 8);
    // Display value uses first-seen spelling
    expect(result.walletBalances[0].wallet).toBe("Coinbase");
  });

  it("does not emit duplicate negative-balance warnings for case-variant exchange names", () => {
    // A TransferOut from "Coinbase" with no corresponding buy under either spelling
    // should produce at most ONE negative-balance warning (not one per spelling).
    const tOut1 = transferOut("2024-03-01", 0.5, { exchange: "Coinbase" });
    const tOut2 = transferOut("2024-03-02", 0.3, { exchange: "coinbase" });

    const result = reconcileTransfers([tOut1, tOut2]);

    const negativeWarnings = result.suggestedMissing.filter((m) => m.toLowerCase().includes("negative"));
    expect(negativeWarnings).toHaveLength(1);
    expect(result.walletBalances).toHaveLength(1);
    expect(result.walletBalances[0].netBalance).toBeCloseTo(-0.8, 8);
  });

  it("still separates genuinely different exchanges", () => {
    const b1 = buy("2024-01-01", 1.0, 30000, { exchange: "Coinbase" });
    const b2 = buy("2024-01-02", 0.5, 30000, { exchange: "Kraken" });
    const b3 = buy("2024-01-03", 0.25, 30000, { exchange: "River" });

    const result = reconcileTransfers([b1, b2, b3]);

    expect(result.walletBalances).toHaveLength(3);
  });
});

// ═══════════════════════════════════════════════════════
// E14 — proportional fee guards (Batch E audit 2026-06-09)
// ═══════════════════════════════════════════════════════

describe("E14 — proportional fee tolerance", () => {
  it("does NOT match when implied fee eats most of a small transfer", () => {
    // out 0.0006 → in 0.0002: 67% "fee" — absolute threshold alone called this Confident
    const out = transferOut("2024-03-01", 0.0006, { exchange: "Coinbase" });
    const inp = transferIn("2024-03-01", 0.0002, { exchange: "Kraken" });
    const result = reconcileTransfers([out, inp]);
    expect(result.matchedTransfers).toHaveLength(0);
    expect(result.unmatchedTransferOuts).toHaveLength(1);
    expect(result.unmatchedTransferIns).toHaveLength(1);
  });

  it("does NOT match an 80% 'fee' on a 0.005 transfer", () => {
    const out = transferOut("2024-03-01", 0.005, { exchange: "Coinbase" });
    const inp = transferIn("2024-03-01", 0.001, { exchange: "Kraken" });
    const result = reconcileTransfers([out, inp]);
    expect(result.matchedTransfers).toHaveLength(0);
  });

  it("still matches a realistic miner fee on a small transfer (Flagged, not Confident)", () => {
    // out 0.002 → in 0.0018: 10% fee — plausible on-chain, but too large a share for Confident
    const out = transferOut("2024-03-01", 0.002, { exchange: "Coinbase" });
    const inp = transferIn("2024-03-01", 0.0018, { exchange: "Kraken" });
    const result = reconcileTransfers([out, inp]);
    expect(result.matchedTransfers).toHaveLength(1);
    expect(result.matchedTransfers[0].confidence).toBe(MatchConfidence.Flagged);
  });

  it("normal large transfer with small absolute fee stays Confident", () => {
    const out = transferOut("2024-03-01", 1.0, { exchange: "Coinbase" });
    const inp = transferIn("2024-03-01", 0.9998, { exchange: "Kraken" });
    const result = reconcileTransfers([out, inp]);
    expect(result.matchedTransfers).toHaveLength(1);
    expect(result.matchedTransfers[0].confidence).toBe(MatchConfidence.Confident);
  });

  it("matches chronologically: earlier out claims the in it precedes", () => {
    // Two outs could claim the same in; the chronologically sensible pairing wins
    // regardless of array order.
    const outLater = transferOut("2024-03-05", 0.5, { exchange: "Coinbase" });
    const outEarlier = transferOut("2024-03-01", 0.5, { exchange: "Coinbase" });
    const inp = transferIn("2024-03-01", 0.4999, { exchange: "Kraken" });
    // Later out listed FIRST in the array — without sorting it would claim the in
    const result = reconcileTransfers([outLater, outEarlier, inp]);
    expect(result.matchedTransfers).toHaveLength(1);
    expect(result.matchedTransfers[0].transferOut.id).toBe(outEarlier.id);
  });
});

// ═══════════════════════════════════════════════════════
// Wallet-aware matching — customer report (2026-09): two LLC accounts sending the identical
// amount on the same day to their own hardware wallets were cross-matched
// (Exchange A/Wallet A → Exchange B/Hardware Wallet B), no matter how often the user re-entered
// them. Root cause: the matcher refused any pair sharing an Exchange label, ignoring Wallet,
// so each withdrawal's real deposit was impossible and it grabbed the other account's.
// ═══════════════════════════════════════════════════════

/** Mirrors Add Transaction: every manual entry is stamped T12:00:00 on its date. */
function entry(
  type: TransactionType,
  date: string,
  amount: number,
  exchange: string,
  wallet: string,
  extra: { sourceWallet?: string; price?: number } = {}
) {
  const price = extra.price ?? (type === TransactionType.Buy ? 60000 : 0);
  return createTransaction({
    date: new Date(date + "T12:00:00").toISOString(),
    transactionType: type,
    amountBTC: amount,
    pricePerBTC: price,
    totalUSD: amount * price,
    exchange,
    wallet,
    sourceWallet: extra.sourceWallet,
    notes: "",
  });
}
const OUT = TransactionType.TransferOut;
const IN = TransactionType.TransferIn;
const BUY = TransactionType.Buy;

const pairsOf = (r: ReturnType<typeof reconcileTransfers>) =>
  [...r.manualTransfers, ...r.matchedTransfers].map((p) => `${walletOf(p.transferOut)} -> ${walletOf(p.transferIn)}`).sort();

function permutations<T>(items: T[]): T[][] {
  if (items.length <= 1) return [items];
  return items.flatMap((item, i) => permutations([...items.slice(0, i), ...items.slice(i + 1)]).map((rest) => [item, ...rest]));
}

describe("wallet-aware matching: two accounts, identical same-day transfers", () => {
  const outA = entry(OUT, "2025-03-01", 0.0001, "Exchange A", "Wallet A");
  const inA = entry(IN, "2025-03-01", 0.0001, "Exchange A", "Hardware Wallet A");
  const outB = entry(OUT, "2025-03-01", 0.0001, "Exchange B", "Wallet B");
  const inB = entry(IN, "2025-03-01", 0.0001, "Exchange B", "Hardware Wallet B");

  it("pairs each account's withdrawal with its own hardware wallet", () => {
    const r = reconcileTransfers([outA, inA, outB, inB]);
    expect(pairsOf(r)).toEqual(["Wallet A -> Hardware Wallet A", "Wallet B -> Hardware Wallet B"]);
    expect(r.unmatchedTransferOuts).toHaveLength(0);
    expect(r.unmatchedTransferIns).toHaveLength(0);
    expect(r.ambiguousTransferIds).toHaveLength(0);
  });

  it("gives the same pairs no matter what order the transfers were entered or imported", () => {
    for (const order of permutations([outA, inA, outB, inB])) {
      expect(pairsOf(reconcileTransfers(order))).toEqual(["Wallet A -> Hardware Wallet A", "Wallet B -> Hardware Wallet B"]);
    }
  });

  it("suggests each deposit's own account as its source wallet", () => {
    const all = [outA, inA, outB, inB];
    expect(suggestSourceWallet(inA, all)?.wallet).toBe("Wallet A");
    expect(suggestSourceWallet(inB, all)?.wallet).toBe("Wallet B");
  });

  it("matches a move between two wallets under the same exchange label", () => {
    const out = entry(OUT, "2025-03-01", 0.5, "Coinbase", "Coinbase");
    const inp = entry(IN, "2025-03-01", 0.4999, "Coinbase", "Coinbase Vault");
    const r = reconcileTransfers([out, inp]);
    expect(pairsOf(r)).toEqual(["Coinbase -> Coinbase Vault"]);
  });

  it("matches when the deposit's Exchange label names the source wallet", () => {
    // "Exchange = where it came from, Wallet = where it went" on the Transfer In
    const swanOut = entry(OUT, "2025-02-01", 0.25, "Swan", "Swan Personal");
    const riverOut = entry(OUT, "2025-02-01", 0.25, "River", "River");
    const coldIn = entry(IN, "2025-02-01", 0.25, "Swan Personal", "ColdCard Personal");
    const r = reconcileTransfers([riverOut, swanOut, coldIn]);
    expect(pairsOf(r)).toEqual(["Swan Personal -> ColdCard Personal"]);
  });

  it("still pairs a Transfer Out whose Wallet was set to the destination (older entries)", () => {
    // Exchange = source, Wallet = destination on both records: wallets coincide but the
    // exchange labels differ, so the pair stays matchable (and the UI warns about the label)
    const out = entry(OUT, "2025-04-01", 0.3, "ColdCard Personal", "SafeExchange Personal");
    const inp = entry(IN, "2025-04-01", 0.3, "SafeExchange Personal", "SafeExchange Personal");
    expect(reconcileTransfers([out, inp]).matchedTransfers).toHaveLength(1);
  });
});

describe("wallet-aware matching: never guess between different wallets", () => {
  // Same exchange for both accounts — nothing in the records says which deposit is whose
  const out1 = entry(OUT, "2025-03-01", 0.0001, "Swan", "Swan LLC 1");
  const out2 = entry(OUT, "2025-03-01", 0.0001, "Swan", "Swan LLC 2");
  const in1 = entry(IN, "2025-03-01", 0.0001, "ColdCard", "ColdCard LLC 1");
  const in2 = entry(IN, "2025-03-01", 0.0001, "ColdCard", "ColdCard LLC 2");

  it("leaves equally good pairings between different wallets unmatched and marks them ambiguous", () => {
    const r = reconcileTransfers([out1, out2, in1, in2]);
    expect(r.matchedTransfers).toHaveLength(0);
    expect([...r.ambiguousTransferIds].sort()).toEqual([out1.id, out2.id, in1.id, in2.id].sort());
    expect(r.suggestedMissing.filter((m) => m.includes("not auto-matched"))).toHaveLength(1);
    // ...and not also "unmatched"/"no matching withdrawal" for transfers that have two candidates
    expect(r.suggestedMissing.some((m) => m.includes("unmatched outgoing") || m.includes("no matching withdrawal"))).toBe(false);
    expect(suggestSourceWallet(in1, [out1, out2, in1, in2])).toBeNull();
  });

  it("resolves them once a source wallet is assigned on a deposit", () => {
    const in1Assigned = { ...in1, sourceWallet: "Swan LLC 1" };
    const r = reconcileTransfers([out1, out2, in1Assigned, in2]);
    expect(pairsOf(r)).toEqual(["Swan LLC 1 -> ColdCard LLC 1", "Swan LLC 2 -> ColdCard LLC 2"]);
    expect(r.ambiguousTransferIds).toHaveLength(0);
  });

  it("does not treat the default 'Manual' exchange label as an account", () => {
    const o1 = entry(OUT, "2025-03-01", 0.0001, "Manual", "Wallet 1");
    const o2 = entry(OUT, "2025-03-01", 0.0001, "Manual", "Wallet 2");
    const i1 = entry(IN, "2025-03-01", 0.0001, "Manual", "Hardware 1");
    const i2 = entry(IN, "2025-03-01", 0.0001, "Manual", "Hardware 2");
    const r = reconcileTransfers([o1, o2, i1, i2]);
    expect(r.matchedTransfers).toHaveLength(0);
    expect(r.ambiguousTransferIds).toHaveLength(4);
  });

  it("pairs identical transfers between the same two wallets (either pairing is correct)", () => {
    const a = entry(OUT, "2025-03-01", 0.1, "Coinbase", "Coinbase");
    const b = entry(OUT, "2025-03-01", 0.1, "Coinbase", "Coinbase");
    const c = entry(IN, "2025-03-01", 0.1, "Ledger", "Ledger");
    const d = entry(IN, "2025-03-01", 0.1, "Ledger", "Ledger");
    const r = reconcileTransfers([a, b, c, d]);
    expect(r.matchedTransfers).toHaveLength(2);
    expect(r.ambiguousTransferIds).toHaveLength(0);
  });

  it("an ambiguous group doesn't block unrelated clear matches", () => {
    const o = entry(OUT, "2025-06-01", 0.5, "Coinbase", "Coinbase");
    const i = entry(IN, "2025-06-01", 0.4999, "Ledger", "Ledger");
    const r = reconcileTransfers([out1, out2, in1, in2, o, i]);
    expect(pairsOf(r)).toEqual(["Coinbase -> Ledger"]);
    expect(r.ambiguousTransferIds).toHaveLength(4);
  });

  it("matches daily identical withdrawals by date (no false ambiguity)", () => {
    const txns = [1, 2, 3].flatMap((d) => [
      entry(OUT, `2025-05-0${d}`, 0.01, "Coinbase", "Coinbase"),
      entry(IN, `2025-05-0${d}`, 0.01, "Ledger", "Ledger"),
    ]);
    const r = reconcileTransfers(txns);
    expect(r.matchedTransfers).toHaveLength(3);
    for (const p of r.matchedTransfers) expect(p.daysBetween).toBe(0);
  });
});

describe("assigned source wallets constrain matching", () => {
  it("never pairs a deposit with a withdrawal from a wallet other than its assigned source", () => {
    const outB = entry(OUT, "2025-03-01", 0.0001, "Exchange B", "Wallet B");
    const inA = entry(IN, "2025-03-01", 0.0001, "Exchange A", "Hardware Wallet A", { sourceWallet: "Wallet A" });
    const r = reconcileTransfers([outB, inA]);
    expect(r.matchedTransfers).toHaveLength(0);
  });

  it("prefers the deposit whose source wallet confirms the withdrawal over a closer amount match", () => {
    const out = entry(OUT, "2025-03-01", 0.1, "Swan", "Swan");
    const assigned = entry(IN, "2025-03-01", 0.0999, "ColdCard", "ColdCard", { sourceWallet: "Swan" });
    const exact = entry(IN, "2025-03-01", 0.1, "Trezor", "Trezor");
    const r = reconcileTransfers([out, exact, assigned]);
    expect(pairsOf(r)).toEqual(["Swan -> ColdCard"]);
  });

  it("the Reconciliation pairing follows the assignment, but the suggestion comes from the records alone", () => {
    // Assignments swapped (e.g. accepted from the old, wrong suggestion). The matched pairs mirror
    // what the tax engine does with them, so the wrong routing is visible; the suggestion in
    // Assign ignores assignments and points back to the right source.
    const outA = entry(OUT, "2025-03-01", 0.0001, "Exchange A", "Wallet A");
    const outB = entry(OUT, "2025-03-01", 0.0001, "Exchange B", "Wallet B");
    const inA = entry(IN, "2025-03-01", 0.0001, "Exchange A", "Hardware Wallet A", { sourceWallet: "Wallet B" });
    const inB = entry(IN, "2025-03-01", 0.0001, "Exchange B", "Hardware Wallet B", { sourceWallet: "Wallet A" });
    const all = [outA, outB, inA, inB];
    expect(pairsOf(reconcileTransfers(all))).toEqual(["Wallet A -> Hardware Wallet B", "Wallet B -> Hardware Wallet A"]);
    expect(suggestSourceWallet(inA, all)?.wallet).toBe("Wallet A");
    expect(suggestSourceWallet(inB, all)?.wallet).toBe("Wallet B");
  });
});

describe("manual matches, Unmatch, and the auto-match switch", () => {
  const out1 = entry(OUT, "2025-03-01", 0.2, "Coinbase", "Coinbase");
  const in1 = entry(IN, "2025-03-01", 0.2, "Ledger", "Ledger");
  const in2 = entry(IN, "2025-03-02", 0.2, "Trezor", "Trezor");

  it("manual matches always win: auto-matching never reuses a manually matched transaction", () => {
    // Auto-matching alone would pair out1 with in1 (same day); the user says in2
    const r = reconcileTransfers([out1, in1, in2], { manualMatches: [{ outId: out1.id, inId: in2.id }] });
    expect(r.manualTransfers).toHaveLength(1);
    expect(r.manualTransfers[0].manual).toBe(true);
    expect(r.manualTransfers[0].transferIn.id).toBe(in2.id);
    expect(r.matchedTransfers).toHaveLength(0);
    expect(r.unmatchedTransferIns.map((t) => t.id)).toEqual([in1.id]);
  });

  it("drops manual matches whose transactions were deleted or are no longer transfers", () => {
    const retyped = { ...in1, transactionType: TransactionType.Buy };
    const r = reconcileTransfers([out1, retyped], {
      manualMatches: [{ outId: out1.id, inId: in1.id }, { outId: out1.id, inId: "deleted-id" }],
    });
    expect(r.manualTransfers).toHaveLength(0);
    expect(r.unmatchedTransferOuts).toHaveLength(1);
  });

  it("Unmatch withholds both transfers from auto-matching — they land in the unmatched lists", () => {
    const rejectedPairKeys = [transferPairKey(out1.id, in1.id)];
    const r = reconcileTransfers([out1, in1, in2], { rejectedPairKeys });
    // Not re-paired with the next-best deposit (in2) either — no whack-a-mole
    expect(r.matchedTransfers).toHaveLength(0);
    expect(r.unmatchedTransferOuts.map((t) => t.id)).toEqual([out1.id]);
    expect(r.unmatchedTransferIns.map((t) => t.id).sort()).toEqual([in1.id, in2.id].sort());
  });

  it("a stale rejection (one side deleted) doesn't withhold the surviving transfer", () => {
    const rejectedPairKeys = [transferPairKey(out1.id, "deleted-id")];
    const r = reconcileTransfers([out1, in1], { rejectedPairKeys });
    expect(r.matchedTransfers).toHaveLength(1);
  });

  it("autoMatch: false pairs nothing automatically but still honors manual matches", () => {
    const out2 = entry(OUT, "2025-04-01", 0.3, "Coinbase", "Coinbase");
    const in3 = entry(IN, "2025-04-01", 0.3, "Ledger", "Ledger");
    const r = reconcileTransfers([out1, in1, out2, in3], {
      autoMatch: false,
      manualMatches: [{ outId: out2.id, inId: in3.id }],
    });
    expect(r.matchedTransfers).toHaveLength(0);
    expect(r.manualTransfers).toHaveLength(1);
    expect(r.unmatchedTransferOuts.map((t) => t.id)).toEqual([out1.id]);
    expect(r.ambiguousTransferIds).toHaveLength(0);
  });

  it("suggestSourceWallet follows the user's manual match", () => {
    const s = suggestSourceWallet(in2, [out1, in1, in2], { manualMatches: [{ outId: out1.id, inId: in2.id }] });
    expect(s?.wallet).toBe("Coinbase");
    expect(s?.reason).toContain("You matched");
  });

  it("suggestSourceWallet makes no automatic suggestion when auto-match is off or the pair was unmatched", () => {
    expect(suggestSourceWallet(in1, [out1, in1], { autoMatch: false })).toBeNull();
    expect(suggestSourceWallet(in1, [out1, in1], { rejectedPairKeys: [transferPairKey(out1.id, in1.id)] })).toBeNull();
  });

  it("reconcileOptionsFromPrefs maps persisted preferences (auto-match defaults on)", () => {
    const opts = reconcileOptionsFromPrefs({
      manualTransferMatches: [{ outId: "o", inId: "i" }],
      reconciliationDecisions: { "a|b": "rejected", "c|d": "approved" },
    });
    expect(opts.autoMatch).toBe(true);
    expect(opts.manualMatches).toEqual([{ outId: "o", inId: "i" }]);
    expect([...(opts.rejectedPairKeys ?? [])]).toEqual(["a|b"]);
    expect(reconcileOptionsFromPrefs({ autoMatchTransfers: false }).autoMatch).toBe(false);
  });
});

describe("wallet balances", () => {
  const balance = (r: ReturnType<typeof reconcileTransfers>, wallet: string) =>
    r.walletBalances.find((b) => b.wallet.toLowerCase() === wallet.toLowerCase())?.netBalance ?? 0;

  it("keys balances by wallet, not by exchange label", () => {
    const b1 = entry(BUY, "2025-01-01", 1, "Swan", "Swan LLC 1");
    const b2 = entry(BUY, "2025-01-01", 2, "Swan", "Swan LLC 2");
    const r = reconcileTransfers([b1, b2]);
    expect(r.walletBalances.map((b) => b.wallet)).toEqual(["Swan LLC 1", "Swan LLC 2"]);
  });

  it("a Transfer In with a source wallet and no Transfer Out counts as leaving the source wallet", () => {
    // The customer's Swan → ColdCard entry: previously both amounts landed on "Swan Personal" (2 BTC)
    const buy = entry(BUY, "2025-01-01", 1, "Swan Personal", "Swan Personal");
    const tin = entry(IN, "2025-02-01", 1, "Swan Personal", "ColdCard Personal", { sourceWallet: "Swan Personal" });
    const r = reconcileTransfers([buy, tin]);
    expect(balance(r, "Swan Personal")).toBeCloseTo(0, 8);
    expect(balance(r, "ColdCard Personal")).toBeCloseTo(1, 8);
  });

  it("counts a Transfer Out + Transfer In pair once, with or without auto-matching", () => {
    const buy = entry(BUY, "2025-01-01", 1, "Swan", "Swan");
    const out = entry(OUT, "2025-02-01", 0.5, "Swan", "Swan");
    const tin = entry(IN, "2025-02-01", 0.4999, "ColdCard", "ColdCard", { sourceWallet: "Swan" });
    for (const autoMatch of [true, false]) {
      const r = reconcileTransfers([buy, out, tin], { autoMatch });
      expect(balance(r, "Swan")).toBeCloseTo(0.5, 8);
      expect(balance(r, "ColdCard")).toBeCloseTo(0.4999, 8);
    }
  });

  it("a deposit with no source wallet adds to its wallet only", () => {
    const tin = entry(IN, "2025-02-01", 0.25, "Ledger", "Ledger");
    const r = reconcileTransfers([tin]);
    expect(r.walletBalances).toHaveLength(1);
    expect(balance(r, "Ledger")).toBeCloseTo(0.25, 8);
  });

  it("the customer's Swan → ColdCard → SafeExchange chain (with a partial move) agrees with Holdings", () => {
    const txns = [
      entry(BUY, "2025-01-05", 0.6, "Swan", "Swan Personal", { price: 90000 }),
      entry(BUY, "2025-01-20", 0.4, "Swan", "Swan Personal", { price: 95000 }),
      // Transfer In only, source assigned (no Transfer Out record)
      entry(IN, "2025-02-01", 1.0, "ColdCard", "ColdCard Personal", { sourceWallet: "Swan Personal" }),
      // Partial move with both halves recorded, each on its own wallet
      entry(OUT, "2025-03-01", 0.3, "ColdCard", "ColdCard Personal"),
      entry(IN, "2025-03-01", 0.3, "SafeExchange", "SafeExchange Personal", { sourceWallet: "ColdCard Personal" }),
    ];
    const r = reconcileTransfers(txns);
    expect(r.matchedTransfers).toHaveLength(1);
    expect(r.suggestedMissing).toEqual([]);

    const held = new Map<string, number>();
    for (const lot of calculate(txns, AccountingMethod.FIFO).lots) {
      const w = (lot.wallet || lot.exchange).toLowerCase();
      held.set(w, (held.get(w) ?? 0) + lot.remainingBTC);
    }
    for (const w of ["Swan Personal", "ColdCard Personal", "SafeExchange Personal"]) {
      expect(balance(r, w)).toBeCloseTo(held.get(w.toLowerCase()) ?? 0, 8);
    }
    expect(balance(r, "ColdCard Personal")).toBeCloseTo(0.7, 8);
  });
});
