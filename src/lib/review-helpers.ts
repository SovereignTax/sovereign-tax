import { Transaction, SaleRecord } from "./models";
import { TransactionType } from "./types";

/**
 * Get TransferIn transactions that have no sourceWallet assigned.
 * If year is provided, only returns transfers within that tax year.
 */
export function getUnassignedTransfers(transactions: Transaction[], year?: number): Transaction[] {
  return transactions.filter(
    (t) =>
      t.transactionType === TransactionType.TransferIn &&
      !t.sourceWallet &&
      (year === undefined || new Date(t.date).getFullYear() === year)
  );
}

/**
 * Get the count of TransferIn transactions with a sourceWallet assigned.
 * If year is provided, only counts transfers within that tax year.
 */
export function getAssignedTransferCount(transactions: Transaction[], year?: number): number {
  return transactions.filter(
    (t) =>
      t.transactionType === TransactionType.TransferIn &&
      t.sourceWallet &&
      (year === undefined || new Date(t.date).getFullYear() === year)
  ).length;
}

/**
 * Get sale records with wallet mismatch for a given year.
 */
export function getWalletMismatchSales(sales: SaleRecord[], year: number): SaleRecord[] {
  return sales.filter(
    (s) => s.walletMismatch && new Date(s.saleDate).getFullYear() === year
  );
}

/**
 * Build a Set of transaction IDs that have wallet mismatches (for row highlighting).
 */
export function getWalletMismatchIds(sales: SaleRecord[]): Set<string> {
  const ids = new Set<string>();
  for (const sale of sales) {
    if (sale.walletMismatch && sale.sourceTransactionId) {
      ids.add(sale.sourceTransactionId);
    }
  }
  return ids;
}

/**
 * Get sells/donations in the given year that don't have effective Specific ID elections.
 * Elections that fell back to FIFO at calc time (in fallbackTxnIds) are treated as optimizable.
 */
export function getOptimizableSells(
  transactions: Transaction[],
  recordedByTxnId: Map<string, SaleRecord>,
  year: number,
  fallbackTxnIds?: string[]
): Transaction[] {
  const fallbackSet = fallbackTxnIds ? new Set(fallbackTxnIds) : new Set<string>();
  return transactions.filter((t) => {
    if (t.transactionType !== TransactionType.Sell && t.transactionType !== TransactionType.Donation) return false;
    if (new Date(t.date).getFullYear() !== year) return false;
    // Not recorded, or recorded but fell back to FIFO → optimizable
    if (!recordedByTxnId.has(t.id)) return true;
    return fallbackSet.has(t.id);
  });
}

/**
 * Get sells/donations in the given year that DO have effective Specific ID elections.
 * Elections that fell back to FIFO at calc time (in fallbackTxnIds) are excluded.
 */
export function getAssignedSells(
  transactions: Transaction[],
  recordedByTxnId: Map<string, SaleRecord>,
  year: number,
  fallbackTxnIds?: string[]
): Transaction[] {
  const fallbackSet = fallbackTxnIds ? new Set(fallbackTxnIds) : new Set<string>();
  return transactions.filter((t) => {
    if (t.transactionType !== TransactionType.Sell && t.transactionType !== TransactionType.Donation) return false;
    if (new Date(t.date).getFullYear() !== year) return false;
    return recordedByTxnId.has(t.id) && !fallbackSet.has(t.id);
  });
}

/**
 * Last tax year covered by the temporary Specific ID relief for broker-held units:
 * Notice 2025-07, extended through December 31, 2026 by Notice 2026-20.
 * The relief lets taxpayers identify units in their own books and records instead of
 * with the broker — the identification must still be made no later than the sale.
 */
export const SPECIFIC_ID_RELIEF_FIRST_YEAR = 2025;
export const SPECIFIC_ID_RELIEF_LAST_YEAR = 2026;

export function hasSpecificIdRelief(year: number): boolean {
  return year >= SPECIFIC_ID_RELIEF_FIRST_YEAR && year <= SPECIFIC_ID_RELIEF_LAST_YEAR;
}

const RELIEF_CITATION = "Notice 2025-07 (extended through 2026 by Notice 2026-20)";

/**
 * "What to do" guidance for the Optimize All confirmation modals
 * (TransactionsView, TaxReportView, ReviewView — keep them identical).
 */
export function getBatchOptimizeGuidance(year: number): string {
  if (hasSpecificIdRelief(year)) {
    return `For ${year} transactions, ${RELIEF_CITATION} lets you record lot identifications for exchange-held bitcoin in your own records instead of with your exchange. The identification must still be made no later than each sale. If you chose lots at the time of each sale, this records them. If not, consider keeping FIFO or consulting a tax professional.`;
  }
  const reliefNote = year > SPECIFIC_ID_RELIEF_LAST_YEAR
    ? ` The temporary relief in ${RELIEF_CITATION} covers only 2025–2026 — for exchange-held bitcoin, lots must be identified with your exchange at the time of sale.`
    : "";
  return `You are optimizing ${year} transactions.${reliefNote} If you made contemporaneous lot identifications at the time of each original sale, this records them. If not, consider reverting to FIFO or consulting a tax professional.`;
}

/**
 * Relief note + "What to do" guidance for a single disposition's lot editor (EditLotsModal).
 */
export function getLotEditGuidance(year: number): { note: string; action: string } {
  if (hasSpecificIdRelief(year)) {
    return {
      note: ` For ${year} transactions, ${RELIEF_CITATION} lets you record identifications for exchange-held bitcoin in your own records — your lot selections are saved as that record.`,
      action: "If you chose these lots at or before the time of the sale, record them here. If not, FIFO is the safer method. Consult a tax professional if unsure.",
    };
  }
  return {
    note: year > SPECIFIC_ID_RELIEF_LAST_YEAR
      ? ` This transaction is from ${year}. The temporary relief in ${RELIEF_CITATION} covers only 2025–2026.`
      : ` This transaction is from ${year}, before the temporary relief in ${RELIEF_CITATION} began.`,
    action: "If you made a contemporaneous lot identification at the time of the original sale (e.g., written records or broker confirmation), you can record it here. If not, FIFO is the safer method. Consult a tax professional if unsure.",
  };
}
