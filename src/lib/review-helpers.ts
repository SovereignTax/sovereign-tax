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
