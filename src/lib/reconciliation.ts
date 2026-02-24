import { Transaction } from "./models";
import { TransactionType } from "./types";

/** Confidence level for auto-matched transfer pairs */
export enum MatchConfidence {
  /** Fee below auto-threshold — high confidence this is the same transfer */
  Confident = "confident",
  /** Fee between auto-threshold and ceiling — likely the same transfer but fee is unusually high */
  Flagged = "flagged",
}

export interface TransferPair {
  transferOut: Transaction;
  transferIn: Transaction;
  amountBTC: number;
  daysBetween: number;
  /** Implied miner fee: out.amountBTC - in.amountBTC (always >= 0 for valid matches) */
  impliedFeeBTC: number;
  /** Match confidence based on implied fee size */
  confidence: MatchConfidence;
}

export interface ExchangeBalance {
  exchange: string;
  totalIn: number;  // BTC bought + transferred in
  totalOut: number; // BTC sold + transferred out
  netBalance: number;
}

export interface ReconciliationResult {
  matchedTransfers: TransferPair[];
  unmatchedTransferOuts: Transaction[];
  unmatchedTransferIns: Transaction[];
  exchangeBalances: ExchangeBalance[];
  suggestedMissing: string[];
}

/**
 * Fee thresholds for transfer matching:
 * - Below FEE_AUTO_THRESHOLD: auto-match with high confidence (green)
 * - Between FEE_AUTO_THRESHOLD and FEE_MAX_CEILING: auto-match but flagged for review (orange)
 * - Above FEE_MAX_CEILING: no auto-match (stays in unmatched list)
 */
const FEE_AUTO_THRESHOLD = 0.0005; // ~$50 at $100k/BTC — normal miner fee range
const FEE_MAX_CEILING = 0.01;      // ~$1000 at $100k/BTC — above this is likely not the same transfer
const NEGATIVE_FEE_TOLERANCE = 0.00000001; // 1 sat — allow for rounding in "in > out" edge cases
const MAX_DAYS_WINDOW = 7;

export function daysBetweenDates(d1: string, d2: string): number {
  const date1 = new Date(d1);
  const date2 = new Date(d2);
  return Math.abs(Math.floor((date2.getTime() - date1.getTime()) / (1000 * 60 * 60 * 24)));
}

export function reconcileTransfers(transactions: Transaction[]): ReconciliationResult {
  const transferOuts = transactions
    .filter((t) => t.transactionType === TransactionType.TransferOut)
    .map((t) => ({ ...t }));
  const transferIns = transactions
    .filter((t) => t.transactionType === TransactionType.TransferIn)
    .map((t) => ({ ...t }));

  const matchedTransfers: TransferPair[] = [];
  const usedOuts = new Set<string>();
  const usedIns = new Set<string>();

  // Try to match transfers by amount (with fee tolerance) and date window
  for (const out of transferOuts) {
    if (usedOuts.has(out.id)) continue;

    let bestMatch: Transaction | null = null;
    let bestFee = Infinity;
    let bestDays = Infinity;

    for (const inp of transferIns) {
      if (usedIns.has(inp.id)) continue;
      if ((inp.exchange || "").trim().toLowerCase() === (out.exchange || "").trim().toLowerCase()) continue; // Same exchange transfers aren't cross-exchange

      // Implied fee: amount sent minus amount received
      // Should be >= 0 (miner fee reduces the received amount)
      const impliedFee = out.amountBTC - inp.amountBTC;

      // Reject if "in" is more than "out" (beyond rounding tolerance)
      if (impliedFee < -NEGATIVE_FEE_TOLERANCE) continue;

      // Reject if implied fee exceeds ceiling
      if (impliedFee > FEE_MAX_CEILING) continue;

      const days = daysBetweenDates(out.date, inp.date);
      if (days > MAX_DAYS_WINDOW) continue;

      // Transfer in should be after transfer out
      if (new Date(inp.date) < new Date(out.date)) continue;

      // Best-fit: prefer smallest implied fee, then smallest days
      const fee = Math.max(0, impliedFee);
      if (fee < bestFee || (fee === bestFee && days < bestDays)) {
        bestFee = fee;
        bestDays = days;
        bestMatch = inp;
      }
    }

    if (bestMatch) {
      const impliedFee = Math.max(0, out.amountBTC - bestMatch.amountBTC);
      const confidence = impliedFee < FEE_AUTO_THRESHOLD
        ? MatchConfidence.Confident
        : MatchConfidence.Flagged;

      usedOuts.add(out.id);
      usedIns.add(bestMatch.id);
      matchedTransfers.push({
        transferOut: out,
        transferIn: bestMatch,
        amountBTC: out.amountBTC,
        daysBetween: bestDays,
        impliedFeeBTC: impliedFee,
        confidence,
      });
    }
  }

  const unmatchedTransferOuts = transferOuts.filter((t) => !usedOuts.has(t.id));
  const unmatchedTransferIns = transferIns.filter((t) => !usedIns.has(t.id));

  // Calculate per-exchange balances
  const balances: Record<string, ExchangeBalance> = {};
  for (const t of transactions) {
    const ex = t.exchange;
    if (!balances[ex]) {
      balances[ex] = { exchange: ex, totalIn: 0, totalOut: 0, netBalance: 0 };
    }
    if (t.transactionType === TransactionType.Buy || t.transactionType === TransactionType.TransferIn) {
      balances[ex].totalIn += t.amountBTC;
    } else if (t.transactionType === TransactionType.Sell || t.transactionType === TransactionType.TransferOut || t.transactionType === TransactionType.Donation) {
      balances[ex].totalOut += t.amountBTC;
    }
  }
  for (const b of Object.values(balances)) {
    b.netBalance = b.totalIn - b.totalOut;
  }

  // Suggest missing imports
  const suggestedMissing: string[] = [];
  for (const b of Object.values(balances)) {
    if (b.netBalance < -NEGATIVE_FEE_TOLERANCE) {
      suggestedMissing.push(
        `${b.exchange}: Balance is negative (${b.netBalance.toFixed(8)} BTC). You may be missing buy/transfer-in transactions.`
      );
    }
  }
  if (unmatchedTransferOuts.length > 0) {
    const exchanges = new Set(unmatchedTransferOuts.map((t) => t.exchange));
    suggestedMissing.push(
      `${unmatchedTransferOuts.length} unmatched outgoing transfers from ${Array.from(exchanges).join(", ")}. Check destination exchanges for missing imports.`
    );
  }
  if (unmatchedTransferIns.length > 0) {
    const exchanges = new Set(unmatchedTransferIns.map((t) => t.exchange));
    suggestedMissing.push(
      `${unmatchedTransferIns.length} unmatched incoming transfers to ${Array.from(exchanges).join(", ")}. Check source exchanges for missing exports.`
    );
  }

  return {
    matchedTransfers,
    unmatchedTransferOuts,
    unmatchedTransferIns,
    exchangeBalances: Object.values(balances).sort((a, b) => a.exchange.localeCompare(b.exchange)),
    suggestedMissing,
  };
}

export interface SourceWalletSuggestion {
  wallet: string;
  reason: string;
  confidence: MatchConfidence;
}

/**
 * Given a TransferIn transaction, checks if the reconciliation engine can identify
 * a matching TransferOut. If so, returns the source wallet as a suggestion.
 * Returns null if no match is found.
 */
export function suggestSourceWallet(
  txn: Transaction,
  allTransactions: Transaction[]
): SourceWalletSuggestion | null {
  if (txn.transactionType !== TransactionType.TransferIn) return null;

  const { matchedTransfers } = reconcileTransfers(allTransactions);
  const match = matchedTransfers.find((p) => p.transferIn.id === txn.id);
  if (!match) return null;

  const sourceWallet = match.transferOut.wallet || match.transferOut.exchange;
  const amount = match.transferOut.amountBTC.toFixed(8);
  const date = new Date(match.transferOut.date).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });

  return {
    wallet: sourceWallet,
    reason: `Matches ${amount} BTC withdrawal from ${sourceWallet} on ${date}`,
    confidence: match.confidence,
  };
}
