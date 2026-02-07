import { Transaction } from "./models";
import { TransactionType } from "./types";

export interface TransferPair {
  transferOut: Transaction;
  transferIn: Transaction;
  amountBTC: number;
  daysBetween: number;
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

const BTC_TOLERANCE = 0.00000001;
const MAX_DAYS_WINDOW = 7;

function daysBetweenDates(d1: string, d2: string): number {
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

  // Try to match transfers by amount and date window
  for (const out of transferOuts) {
    if (usedOuts.has(out.id)) continue;

    let bestMatch: Transaction | null = null;
    let bestDays = Infinity;

    for (const inp of transferIns) {
      if (usedIns.has(inp.id)) continue;
      if (inp.exchange === out.exchange) continue; // Same exchange transfers aren't cross-exchange

      const amountDiff = Math.abs(out.amountBTC - inp.amountBTC);
      if (amountDiff > BTC_TOLERANCE) continue;

      const days = daysBetweenDates(out.date, inp.date);
      if (days > MAX_DAYS_WINDOW) continue;

      // Transfer in should be after transfer out
      if (new Date(inp.date) < new Date(out.date)) continue;

      if (days < bestDays) {
        bestDays = days;
        bestMatch = inp;
      }
    }

    if (bestMatch) {
      usedOuts.add(out.id);
      usedIns.add(bestMatch.id);
      matchedTransfers.push({
        transferOut: out,
        transferIn: bestMatch,
        amountBTC: out.amountBTC,
        daysBetween: bestDays,
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
    } else if (t.transactionType === TransactionType.Sell || t.transactionType === TransactionType.TransferOut) {
      balances[ex].totalOut += t.amountBTC;
    }
  }
  for (const b of Object.values(balances)) {
    b.netBalance = b.totalIn - b.totalOut;
  }

  // Suggest missing imports
  const suggestedMissing: string[] = [];
  for (const b of Object.values(balances)) {
    if (b.netBalance < -BTC_TOLERANCE) {
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
