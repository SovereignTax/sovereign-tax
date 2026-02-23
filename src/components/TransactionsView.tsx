import { useState, useMemo, useCallback } from "react";
import { useAppState } from "../lib/app-state";
import { formatUSD, formatBTC, formatDateTime, formatDate } from "../lib/utils";
import { TransactionType, TransactionTypeDisplayNames, IncomeType, IncomeTypeDisplayNames, AccountingMethod } from "../lib/types";
import { Transaction, SaleRecord } from "../lib/models";
import { calculate, calculateUpTo, simulateSale, resolveRecordedSales, batchOptimizeSpecificId, LotSelection } from "../lib/cost-basis";
import { LotPicker } from "./LotPicker";
import { HelpPanel } from "./HelpPanel";

export function TransactionsView() {
  const state = useAppState();
  const { transactions, setSelectedNav, updateTransaction, deleteTransaction } = state;
  const [sortField, setSortField] = useState<keyof Transaction>("date");
  const [sortAsc, setSortAsc] = useState(true);
  const [filterType, setFilterType] = useState<TransactionType | "">("");
  const [searchText, setSearchText] = useState("");
  const [editingTxn, setEditingTxn] = useState<Transaction | null>(null);
  const [deletingTxn, setDeletingTxn] = useState<Transaction | null>(null);
  const [editingLotsTxn, setEditingLotsTxn] = useState<Transaction | null>(null);
  const [batchOptimizeResult, setBatchOptimizeResult] = useState<{ records: SaleRecord[]; skipped: number; fifoGainLoss: number; optimizedGainLoss: number; walletMismatches: number } | null>(null);
  const [batchSaving, setBatchSaving] = useState(false);
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [clearing, setClearing] = useState(false);

  // Shared resolver: maps each disposition transaction to its recorded Specific ID SaleRecord.
  // Uses the same function as the engine — guarantees UI badges and engine use identical matching.
  const recordedByTxnId = useMemo(
    () => resolveRecordedSales(transactions, state.recordedSales),
    [state.recordedSales, transactions]
  );

  // Run calculate() to get wallet mismatch flags on sale records
  const calcResult = useMemo(
    () => calculate(state.allTransactions, AccountingMethod.FIFO, state.recordedSales),
    [state.allTransactions, state.recordedSales]
  );
  // Build set of transaction IDs with wallet mismatches for quick lookup
  const walletMismatchIds = useMemo(() => {
    const ids = new Set<string>();
    for (const sale of calcResult.sales) {
      if (sale.walletMismatch && sale.sourceTransactionId) {
        ids.add(sale.sourceTransactionId);
      }
    }
    return ids;
  }, [calcResult.sales]);
  const walletMismatchCount = useMemo(() => {
    return calcResult.sales.filter(
      (s) => s.walletMismatch && new Date(s.saleDate).getFullYear() === state.selectedYear
    ).length;
  }, [calcResult.sales, state.selectedYear]);

  // Count unassigned sells/donations in the selected year for the batch optimize button
  const unassignedCount = useMemo(() => {
    return transactions.filter((t) => {
      if (t.transactionType !== TransactionType.Sell && t.transactionType !== TransactionType.Donation) return false;
      if (new Date(t.date).getFullYear() !== state.selectedYear) return false;
      if (recordedByTxnId.has(t.id)) return false;
      return true;
    }).length;
  }, [transactions, state.selectedYear, recordedByTxnId]);

  const filtered = useMemo(() => {
    let result = [...transactions];
    if (filterType) result = result.filter((t) => t.transactionType === filterType);
    if (searchText) {
      const lower = searchText.toLowerCase();
      result = result.filter((t) =>
        t.exchange.toLowerCase().includes(lower) ||
        t.notes.toLowerCase().includes(lower) ||
        TransactionTypeDisplayNames[t.transactionType].toLowerCase().includes(lower)
      );
    }
    result.sort((a, b) => {
      let cmp = 0;
      switch (sortField) {
        case "date": cmp = new Date(a.date).getTime() - new Date(b.date).getTime(); break;
        case "amountBTC": cmp = a.amountBTC - b.amountBTC; break;
        case "pricePerBTC": cmp = a.pricePerBTC - b.pricePerBTC; break;
        case "totalUSD": cmp = a.totalUSD - b.totalUSD; break;
        case "exchange": cmp = a.exchange.localeCompare(b.exchange); break;
        default: cmp = new Date(a.date).getTime() - new Date(b.date).getTime();
      }
      return sortAsc ? cmp : -cmp;
    });
    return result;
  }, [transactions, filterType, searchText, sortField, sortAsc]);

  const counts = useMemo(() => ({
    buys: transactions.filter((t) => t.transactionType === TransactionType.Buy).length,
    sells: transactions.filter((t) => t.transactionType === TransactionType.Sell).length,
    transfers: transactions.filter((t) => t.transactionType === TransactionType.TransferIn || t.transactionType === TransactionType.TransferOut).length,
    donations: transactions.filter((t) => t.transactionType === TransactionType.Donation).length,
  }), [transactions]);

  const toggleSort = (field: keyof Transaction) => {
    if (sortField === field) setSortAsc(!sortAsc);
    else { setSortField(field); setSortAsc(true); }
  };

  const handleDelete = async () => {
    if (deletingTxn) {
      await deleteTransaction(deletingTxn.id);
      setDeletingTxn(null);
    }
  };

  const exportCSV = useCallback(() => {
    const header = "Date,Type,Amount (BTC),Price (USD),Total (USD),Fee (USD),Exchange,Wallet,Notes";
    const rows = transactions.map((t) => {
      const dateStr = new Date(t.date).toISOString().split("T")[0];
      const typeStr = TransactionTypeDisplayNames[t.transactionType];
      const notes = (t.notes || "").replace(/"/g, '""');
      const exchangeEsc = (t.exchange || "").replace(/"/g, '""');
      const walletEsc = (t.wallet || t.exchange || "").replace(/"/g, '""');
      return `${dateStr},${typeStr},${t.amountBTC.toFixed(8)},${t.pricePerBTC.toFixed(2)},${t.totalUSD.toFixed(2)},${t.fee ? t.fee.toFixed(2) : "0.00"},"${exchangeEsc}","${walletEsc}","${notes}"`;
    });
    const csv = [header, ...rows].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `sovereign-tax-transactions-${new Date().toISOString().split("T")[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }, [transactions]);

  const handleBatchOptimize = useCallback(() => {
    // Run the batch optimizer and compute FIFO baseline for comparison
    const { records, skipped, failed, walletMismatches } = batchOptimizeSpecificId(
      state.allTransactions, state.recordedSales, state.selectedYear
    );

    // Compute FIFO gain/loss for the year (current state, no new records)
    const fifoResult = calculate(state.allTransactions, AccountingMethod.FIFO, state.recordedSales);
    const fifoGainLoss = fifoResult.sales
      .filter((s: SaleRecord) => new Date(s.saleDate).getFullYear() === state.selectedYear && !s.isDonation)
      .reduce((sum: number, s: SaleRecord) => sum + s.gainLoss, 0);

    // Compute optimized gain/loss (with the new records applied)
    const allSales = [...state.recordedSales, ...records];
    const optResult = calculate(state.allTransactions, AccountingMethod.FIFO, allSales);
    const optimizedGainLoss = optResult.sales
      .filter((s: SaleRecord) => new Date(s.saleDate).getFullYear() === state.selectedYear && !s.isDonation)
      .reduce((sum: number, s: SaleRecord) => sum + s.gainLoss, 0);

    setBatchOptimizeResult({ records, skipped, fifoGainLoss, optimizedGainLoss, walletMismatches: walletMismatches.length });
  }, [state.allTransactions, state.recordedSales, state.selectedYear]);

  const handleBatchSave = useCallback(async () => {
    if (!batchOptimizeResult) return;
    setBatchSaving(true);
    await state.recordSalesBatch(batchOptimizeResult.records);
    setBatchSaving(false);
    setBatchOptimizeResult(null);
  }, [batchOptimizeResult, state.recordSalesBatch]);

  // Count assigned Specific ID elections for the year (for clear all)
  const assignedCount = useMemo(() => {
    return transactions.filter((t) => {
      if (t.transactionType !== TransactionType.Sell && t.transactionType !== TransactionType.Donation) return false;
      if (new Date(t.date).getFullYear() !== state.selectedYear) return false;
      return recordedByTxnId.has(t.id);
    }).length;
  }, [transactions, state.selectedYear, recordedByTxnId]);

  const handleClearAll = useCallback(async () => {
    setClearing(true);
    const idsToDelete: string[] = [];
    // Use transaction date (not record.saleDate) to match assignedCount filtering
    for (const t of transactions) {
      if (t.transactionType !== TransactionType.Sell && t.transactionType !== TransactionType.Donation) continue;
      if (new Date(t.date).getFullYear() !== state.selectedYear) continue;
      const record = recordedByTxnId.get(t.id);
      if (record) idsToDelete.push(record.id);
    }
    await state.deleteSaleRecordsByIds(idsToDelete);
    setClearing(false);
    setShowClearConfirm(false);
  }, [transactions, recordedByTxnId, state.selectedYear, state.deleteSaleRecordsByIds]);

  if (transactions.length === 0) {
    return (
      <div className="p-8 flex flex-col items-center justify-center h-full">
        <div className="text-5xl mb-4 opacity-50">📋</div>
        <h2 className="text-xl text-gray-500 mb-2">No transactions imported yet</h2>
        <button className="btn-secondary" onClick={() => setSelectedNav("import")}>Go to Import</button>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <div className="p-6 pb-3 text-center">
        <h1 className="text-3xl font-bold">All Transactions</h1>
        <HelpPanel subtitle={`${transactions.length} transactions imported — click any column header to sort.`} />
      </div>

      {/* Wallet Mismatch Warning */}
      {walletMismatchCount > 0 && (
        <div className="mx-6 mb-3 px-4 py-3 rounded-lg border border-yellow-300 dark:border-yellow-700 bg-yellow-50 dark:bg-yellow-900/10 flex items-start gap-3">
          <span className="text-yellow-500 text-base mt-0.5">⚠️</span>
          <div>
            <span className="text-xs font-semibold text-yellow-700 dark:text-yellow-400">
              Wallet Mismatch — {walletMismatchCount} sale{walletMismatchCount === 1 ? "" : "s"} in {state.selectedYear} used lots from a different wallet.
            </span>
            <span className="text-xs text-yellow-700 dark:text-yellow-400/80 ml-1">
              IRS requires per-wallet cost basis tracking (Treasury Reg. §1.1012-1(j)).
              Record your transfers in <button className="underline font-medium hover:text-yellow-900 dark:hover:text-yellow-300" onClick={() => state.setSelectedNav("reconciliation")}>Reconciliation</button> to fix.
            </span>
          </div>
        </div>
      )}

      {/* Toolbar */}
      <div className="flex items-center gap-4 px-6 pb-3">
        <div className="flex items-center gap-2 bg-white dark:bg-zinc-800 border border-gray-200 dark:border-zinc-700 rounded-lg px-3 py-1.5 w-72">
          <span className="text-gray-400">🔍</span>
          <input className="bg-transparent outline-none flex-1 text-sm text-gray-900 dark:text-gray-200" placeholder="Search by exchange or notes..." value={searchText} onChange={(e) => setSearchText(e.target.value)} />
        </div>
        <select className="select text-sm" value={filterType} onChange={(e) => setFilterType(e.target.value as any)}>
          <option value="">All Types</option>
          {Object.values(TransactionType).map((t) => (
            <option key={t} value={t}>{TransactionTypeDisplayNames[t]}</option>
          ))}
        </select>
        <span className="flex-1" />
        <span className="text-xs"><span className="inline-block w-2 h-2 rounded-full bg-green-500 mr-1" />{counts.buys} Buys</span>
        <span className="text-xs"><span className="inline-block w-2 h-2 rounded-full bg-red-500 mr-1" />{counts.sells} Sells</span>
        <span className="text-xs"><span className="inline-block w-2 h-2 rounded-full bg-blue-500 mr-1" />{counts.transfers} Transfers</span>
        {counts.donations > 0 && <span className="text-xs"><span className="inline-block w-2 h-2 rounded-full bg-purple-500 mr-1" />{counts.donations} Donations</span>}
        <button className="btn-secondary text-xs px-3 py-1" onClick={exportCSV} title="Export all transactions as CSV">Export CSV</button>
        <div className="flex items-center gap-1.5">
          <span className="text-xs text-gray-500">Year:</span>
          <select className="select text-xs px-2 py-1" value={state.selectedYear} onChange={(e) => state.setSelectedYear(Number(e.target.value))}>
            {state.availableYears.map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
        </div>
        {unassignedCount > 0 ? (
          <button
            className="text-xs px-3 py-1 btn-primary"
            onClick={handleBatchOptimize}
            title={`Auto-assign optimal Specific ID lots for ${unassignedCount} unassigned sells/donations in ${state.selectedYear}`}
          >
            Optimize All ({unassignedCount})
          </button>
        ) : (
          <span className="text-xs px-3 py-1 btn-secondary opacity-50 cursor-default">All Optimized</span>
        )}
        {assignedCount > 0 && (
          <button
            className="text-xs px-3 py-1 btn-secondary text-red-500 hover:text-red-600"
            onClick={() => setShowClearConfirm(true)}
            title={`Remove all ${assignedCount} Specific ID elections for ${state.selectedYear}`}
          >
            Revert to FIFO
          </button>
        )}
      </div>

      {/* Table (scrollable with sticky header) */}
      <div className="flex-1 overflow-y-auto border-t border-gray-200 dark:border-gray-700">
        <div className="px-6">
          {/* Sticky Header */}
          <div className="grid gap-2 py-2 text-xs font-semibold text-gray-500 bg-white dark:bg-zinc-900 border-b border-gray-200 dark:border-gray-700 sticky top-0 z-10" style={{ gridTemplateColumns: '1.4fr 0.9fr 1fr 1fr 0.7fr 1fr 0.8fr 0.8fr 0.8fr' }}>
            <SortHeader label="Date" field="date" current={sortField} asc={sortAsc} onClick={toggleSort} />
            <div>Type</div>
            <SortHeader label="Amount BTC" field="amountBTC" current={sortField} asc={sortAsc} onClick={toggleSort} />
            <SortHeader label="Price/BTC" field="pricePerBTC" current={sortField} asc={sortAsc} onClick={toggleSort} />
            <div>Fee</div>
            <SortHeader label="Total USD" field="totalUSD" current={sortField} asc={sortAsc} onClick={toggleSort} />
            <SortHeader label="Exchange" field="exchange" current={sortField} asc={sortAsc} onClick={toggleSort} />
            <div>Notes</div>
            <div className="text-right">Actions</div>
          </div>

          {/* Table Body */}
          {filtered.map((t, i) => (
            <div key={t.id} className={`grid gap-2 py-1.5 text-sm items-center ${i % 2 === 0 ? "" : "bg-gray-50 dark:bg-zinc-800/30"}`} style={{ gridTemplateColumns: '1.4fr 0.9fr 1fr 1fr 0.7fr 1fr 0.8fr 0.8fr 0.8fr' }}>
              <div className="tabular-nums">{formatDateTime(t.date)}</div>
              <div className={typeColor(t.transactionType)}>
                {typeIcon(t.transactionType)} {TransactionTypeDisplayNames[t.transactionType]}
              </div>
              <div className="tabular-nums">{formatBTC(t.amountBTC)}</div>
              <div className="tabular-nums">{formatUSD(t.pricePerBTC)}</div>
              <div className="tabular-nums text-gray-400">{t.fee ? formatUSD(t.fee) : ""}</div>
              <div className="tabular-nums">{formatUSD(t.totalUSD)}</div>
              <div className="truncate">{t.exchange}</div>
              <div className="text-gray-500 truncate">{t.notes}</div>
              <div className="flex gap-1 justify-end">
                {walletMismatchIds.has(t.id) && (
                  <span className="text-yellow-500 text-xs px-0.5" title="Wallet mismatch: This sale used lots from a different wallet. Record your transfers in Reconciliation so lots are tracked at the correct location.">⚠️</span>
                )}
                {(t.transactionType === TransactionType.Sell || t.transactionType === TransactionType.Donation) && (
                  <button
                    className={`text-xs px-1.5 py-0.5 rounded ${recordedByTxnId.has(t.id) ? "text-blue-500 hover:bg-blue-100 dark:hover:bg-blue-900/30" : "text-gray-400 hover:bg-gray-200 dark:hover:bg-zinc-700"}`}
                    onClick={() => setEditingLotsTxn(t)}
                    title={recordedByTxnId.has(t.id) ? "Edit Specific ID lot selections" : "Assign Specific ID lot selections"}
                  >
                    {recordedByTxnId.has(t.id) ? "Lots ✓" : "Lots"}
                  </button>
                )}
                <button
                  className="text-xs px-1.5 py-0.5 rounded hover:bg-gray-200 dark:hover:bg-zinc-700 text-gray-500"
                  onClick={() => setEditingTxn({ ...t })}
                  title="Edit"
                >
                  Edit
                </button>
                <button
                  className="text-xs px-1.5 py-0.5 rounded hover:bg-red-100 dark:hover:bg-red-900/30 text-red-400"
                  onClick={() => setDeletingTxn(t)}
                  title="Delete"
                >
                  Del
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Edit Modal */}
      {editingTxn && (
        <EditModal
          txn={editingTxn}
          onSave={async (updates) => {
            await updateTransaction(editingTxn.id, updates);
            setEditingTxn(null);
          }}
          onClose={() => setEditingTxn(null)}
        />
      )}

      {/* Delete Confirmation */}
      {deletingTxn && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setDeletingTxn(null)}>
          <div className="bg-white dark:bg-zinc-900 rounded-xl p-6 max-w-md shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-bold mb-2">Delete Transaction?</h3>
            <p className="text-gray-500 text-sm mb-1">
              {TransactionTypeDisplayNames[deletingTxn.transactionType]} of {formatBTC(deletingTxn.amountBTC)} BTC on {formatDateTime(deletingTxn.date)}
            </p>
            <p className="text-gray-500 text-sm mb-4">
              This will permanently remove this transaction. Tax calculations will be recalculated automatically.
            </p>
            <div className="flex gap-3 justify-end">
              <button className="btn-secondary text-sm" onClick={() => setDeletingTxn(null)}>Cancel</button>
              <button className="bg-red-500 hover:bg-red-600 text-white px-4 py-2 rounded-lg text-sm font-medium" onClick={async () => { await handleDelete(); }}>Delete</button>
            </div>
          </div>
        </div>
      )}

      {/* Edit Lots Modal */}
      {editingLotsTxn && (
        <EditLotsModal
          txn={editingLotsTxn}
          existingRecord={recordedByTxnId.get(editingLotsTxn.id)}
          allTransactions={state.allTransactions}
          recordedSales={state.recordedSales}
          onSave={async (saleRecord) => {
            const existing = recordedByTxnId.get(editingLotsTxn.id);
            if (existing) {
              // Atomic replace by SaleRecord.id — works for both legacy and new-style records.
              // Upgrade-on-save: the new saleRecord always has sourceTransactionId stamped,
              // so legacy records are migrated to new-style on edit.
              await state.replaceSaleRecordById(existing.id, saleRecord);
            } else {
              await state.recordSale(saleRecord);
            }
            setEditingLotsTxn(null);
          }}
          onRevert={async () => {
            const existing = recordedByTxnId.get(editingLotsTxn.id);
            if (existing) {
              // Delete by SaleRecord.id — works for both legacy and new-style records
              await state.deleteSaleRecordById(existing.id);
            }
            setEditingLotsTxn(null);
          }}
          onClose={() => setEditingLotsTxn(null)}
        />
      )}

      {/* Batch Optimize Confirmation Modal */}
      {batchOptimizeResult && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setBatchOptimizeResult(null)}>
          <div className="bg-white dark:bg-zinc-900 rounded-xl p-6 max-w-lg w-full shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-bold mb-4">Optimize All — {state.selectedYear}</h3>

            <div className="bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400 text-xs p-2 rounded-lg mb-4">
              IRS expects consistent use of one accounting method per wallet within a tax year (IRC &sect;1012, TD 9989). Applying Specific ID to all dispositions ensures consistency.
            </div>

            <div className="space-y-3 mb-4">
              <div className="flex justify-between text-sm">
                <span className="text-gray-500">Transactions to optimize:</span>
                <span className="font-medium">{batchOptimizeResult.records.length}</span>
              </div>
              {batchOptimizeResult.skipped > 0 && (
                <div className="flex justify-between text-sm">
                  <span className="text-gray-500">Skipped (insufficient lots):</span>
                  <span className="font-medium text-orange-500">{batchOptimizeResult.skipped}</span>
                </div>
              )}
              <div className="border-t border-gray-200 dark:border-gray-700 pt-3">
                <div className="flex justify-between text-sm">
                  <span className="text-gray-500">Current gain/loss ({state.selectedYear}):</span>
                  <span className={`font-medium tabular-nums ${batchOptimizeResult.fifoGainLoss >= 0 ? "text-green-600" : "text-red-500"}`}>
                    {batchOptimizeResult.fifoGainLoss >= 0 ? "+" : ""}{formatUSD(batchOptimizeResult.fifoGainLoss)}
                  </span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-gray-500">Optimized gain/loss ({state.selectedYear}):</span>
                  <span className={`font-medium tabular-nums ${batchOptimizeResult.optimizedGainLoss >= 0 ? "text-green-600" : "text-red-500"}`}>
                    {batchOptimizeResult.optimizedGainLoss >= 0 ? "+" : ""}{formatUSD(batchOptimizeResult.optimizedGainLoss)}
                  </span>
                </div>
                {batchOptimizeResult.fifoGainLoss !== batchOptimizeResult.optimizedGainLoss && (
                  <div className="flex justify-between text-sm mt-1 pt-1 border-t border-gray-100 dark:border-gray-800">
                    <span className="text-gray-500 font-medium">Estimated savings:</span>
                    <span className="font-bold tabular-nums text-green-600">
                      {formatUSD(batchOptimizeResult.fifoGainLoss - batchOptimizeResult.optimizedGainLoss)}
                    </span>
                  </div>
                )}
              </div>
            </div>

            {batchOptimizeResult.walletMismatches > 0 && (
              <div className="bg-yellow-50 dark:bg-yellow-900/20 text-yellow-700 dark:text-yellow-400 text-xs p-2 rounded-lg mb-4">
                ⚠️ <strong>{batchOptimizeResult.walletMismatches} sale{batchOptimizeResult.walletMismatches === 1 ? "" : "s"}</strong> used lots from a different wallet.
                IRS requires per-wallet cost basis (Treasury Reg. §1.1012-1(j)).
                Record your transfers in Reconciliation so lots are tracked at the correct wallet.
              </div>
            )}

            <div className="flex gap-3 justify-end">
              <button className="btn-secondary text-sm" onClick={() => setBatchOptimizeResult(null)}>Cancel</button>
              <button className="btn-primary text-sm" disabled={batchSaving || batchOptimizeResult.records.length === 0} onClick={async () => { await handleBatchSave(); }}>
                {batchSaving ? "Saving..." : `Apply Specific ID (${batchOptimizeResult.records.length})`}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Clear All Confirmation Modal */}
      {showClearConfirm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setShowClearConfirm(false)}>
          <div className="bg-white dark:bg-zinc-900 rounded-xl p-6 max-w-md w-full shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-bold mb-3">Revert to FIFO — {state.selectedYear}</h3>
            <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
              This will remove all {assignedCount} Specific ID lot election{assignedCount === 1 ? "" : "s"} for {state.selectedYear}. All sells and donations will fall back to the default FIFO method. You can re-optimize at any time.
            </p>
            <div className="flex gap-3 justify-end">
              <button className="btn-secondary text-sm" onClick={() => setShowClearConfirm(false)}>Cancel</button>
              <button className="text-sm px-4 py-1.5 bg-red-600 hover:bg-red-700 text-white rounded-lg" disabled={clearing} onClick={async () => { await handleClearAll(); }}>
                {clearing ? "Clearing..." : `Remove All (${assignedCount})`}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function EditModal({ txn, onSave, onClose }: { txn: Transaction; onSave: (updates: Partial<Omit<Transaction, "id">>) => Promise<void>; onClose: () => void }) {
  const [type, setType] = useState(txn.transactionType);
  const [date, setDate] = useState(new Date(txn.date).toISOString().split("T")[0]);
  const [amountStr, setAmountStr] = useState(txn.amountBTC.toFixed(8));
  // Back out fee from stored totals so user sees pre-fee values (fee is re-applied on save)
  const baseTotalUSD = txn.fee
    ? txn.transactionType === TransactionType.Buy
      ? txn.totalUSD - txn.fee
      : txn.transactionType === TransactionType.Sell
        ? txn.totalUSD + txn.fee
        : txn.totalUSD
    : txn.totalUSD;
  const basePricePerBTC = txn.amountBTC > 0 ? baseTotalUSD / txn.amountBTC : txn.pricePerBTC;
  // Capture initial string values to detect whether user actually touched the input
  const initPriceStr = basePricePerBTC.toFixed(2);
  const initTotalStr = baseTotalUSD.toFixed(2);
  const initFeeStr = txn.fee ? txn.fee.toFixed(2) : "";
  const [priceStr, setPriceStr] = useState(initPriceStr);
  const [totalStr, setTotalStr] = useState(initTotalStr);
  const [feeStr, setFeeStr] = useState(initFeeStr);
  const [exchange, setExchange] = useState(txn.exchange);
  const [wallet, setWallet] = useState(txn.wallet || "");
  const [notes, setNotes] = useState(txn.notes);
  const [incomeType, setIncomeType] = useState<IncomeType | "">(txn.incomeType || "");
  const [error, setError] = useState<string | null>(null);

  const handleSave = () => {
    setError(null);
    const amount = Number(amountStr);
    if (!amount || amount <= 0) { setError("Enter a valid BTC amount"); return; }
    const price = Number(priceStr);
    // Transfers can have price=0 (non-taxable movements); donations require FMV for deduction records
    const isTransfer = type === TransactionType.TransferIn || type === TransactionType.TransferOut;
    if (!isTransfer && (!price || price <= 0)) { setError(type === TransactionType.Donation ? "Enter the Fair Market Value (FMV) per BTC on the date of donation" : "Enter a valid price"); return; }
    let total = Number(totalStr);
    if (!total || total <= 0) total = amount * price;
    const fee = Number(feeStr) || 0;

    // Apply fee: buys add fee to cost basis, sells subtract from proceeds
    let adjustedTotal = total;
    let adjustedPrice = price;
    if (fee > 0) {
      if (type === TransactionType.Buy) {
        adjustedTotal = total + fee;
      } else if (type === TransactionType.Sell) {
        adjustedTotal = Math.max(0, total - fee);
      }
      if (amount > 0) adjustedPrice = adjustedTotal / amount;
    }

    // Build sparse updates — only include fields that actually changed from the original
    // to avoid round-trip drift (toFixed/Number) triggering false material-change detection.
    const updates: Partial<Omit<Transaction, "id">> = {};

    // Date: compare day-level only — modal has day precision, original may have non-noon timestamp
    const newDate = new Date(date + "T12:00:00").toISOString();
    const origDay = txn.date.split("T")[0];
    if (date !== origDay) updates.date = newDate;

    if (type !== txn.transactionType) updates.transactionType = type;
    if (amount !== txn.amountBTC) updates.amountBTC = amount;

    // Price/total: compare against initial display strings to avoid fee back-out/reapply drift.
    // Only include if the user actually changed the input value.
    if (priceStr !== initPriceStr || feeStr !== initFeeStr || amountStr !== txn.amountBTC.toFixed(8)) {
      if (adjustedPrice !== txn.pricePerBTC) updates.pricePerBTC = adjustedPrice;
    }
    if (totalStr !== initTotalStr || feeStr !== initFeeStr || amountStr !== txn.amountBTC.toFixed(8)) {
      if (adjustedTotal !== txn.totalUSD) updates.totalUSD = adjustedTotal;
    }

    const newFee = fee > 0 ? fee : undefined;
    if (newFee !== txn.fee) updates.fee = newFee;
    const newExchange = exchange || "Manual";
    if (newExchange !== txn.exchange) updates.exchange = newExchange;
    // Wallet: normalize with same fallback chain used on init to avoid undefined vs "" drift
    const newWallet = wallet || exchange || "Manual";
    if (newWallet !== (txn.wallet || txn.exchange || "Manual")) updates.wallet = newWallet;
    const newIncomeType = type === TransactionType.Buy && incomeType ? incomeType : undefined;
    if (newIncomeType !== txn.incomeType) updates.incomeType = newIncomeType;
    if (notes !== txn.notes) updates.notes = notes;

    onSave(updates);
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-white dark:bg-zinc-900 rounded-xl p-6 max-w-lg w-full shadow-2xl max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-lg font-bold mb-4">Edit Transaction</h3>

        <div className="space-y-3">
          {/* Type */}
          <div className="flex items-center gap-3">
            <span className="w-20 text-right text-gray-500 text-sm">Type:</span>
            <div className="segmented">
              {Object.values(TransactionType).map((t) => (
                <button key={t} className={`segmented-btn ${type === t ? "active" : ""}`} onClick={() => setType(t)}>
                  {TransactionTypeDisplayNames[t]}
                </button>
              ))}
            </div>
          </div>

          {/* Income Type (only for Buy) */}
          {type === TransactionType.Buy && (
            <div className="flex items-center gap-3">
              <span className="w-20 text-right text-gray-500 text-sm">Income:</span>
              <select className="select w-44 text-sm" value={incomeType} onChange={(e) => setIncomeType(e.target.value as IncomeType | "")}>
                <option value="">Not Income</option>
                {Object.values(IncomeType).map((it) => (
                  <option key={it} value={it}>{IncomeTypeDisplayNames[it]}</option>
                ))}
              </select>
            </div>
          )}

          {/* Date */}
          <div className="flex items-center gap-3">
            <span className="w-20 text-right text-gray-500 text-sm">Date:</span>
            <input type="date" className="input w-44 text-sm" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>

          {/* Amount */}
          <div className="flex items-center gap-3">
            <span className="w-20 text-right text-gray-500 text-sm">BTC Amt:</span>
            <input className="input w-44 text-sm" value={amountStr} onChange={(e) => setAmountStr(e.target.value)} />
          </div>

          {/* Price / FMV */}
          <div className="flex items-center gap-3">
            <span className="w-20 text-right text-gray-500 text-sm">{type === TransactionType.Donation ? "FMV/BTC:" : "Price/BTC:"}</span>
            <input className="input w-44 text-sm" value={priceStr} onChange={(e) => setPriceStr(e.target.value)} />
          </div>
          {type === TransactionType.Donation && (
            <div className="flex items-center gap-3">
              <span className="w-20" />
              <span className="text-xs text-purple-500">Enter the Fair Market Value per BTC on the date of donation for your charitable deduction records.</span>
            </div>
          )}

          {/* Total */}
          <div className="flex items-center gap-3">
            <span className="w-20 text-right text-gray-500 text-sm">Total USD:</span>
            <input className="input w-44 text-sm" value={totalStr} onChange={(e) => setTotalStr(e.target.value)} />
            <span className="text-xs text-gray-400">(before fee adj.)</span>
          </div>

          {/* Fee */}
          <div className="flex items-center gap-3">
            <span className="w-20 text-right text-gray-500 text-sm">Fee USD:</span>
            <input className="input w-44 text-sm" placeholder="0.00" value={feeStr} onChange={(e) => setFeeStr(e.target.value)} />
          </div>

          {/* Exchange */}
          <div className="flex items-center gap-3">
            <span className="w-20 text-right text-gray-500 text-sm">Exchange:</span>
            <input className="input w-44 text-sm" value={exchange} onChange={(e) => setExchange(e.target.value)} />
          </div>

          {/* Wallet */}
          <div className="flex items-center gap-3">
            <span className="w-20 text-right text-gray-500 text-sm">Wallet:</span>
            <input className="input w-44 text-sm" placeholder="Defaults to exchange" value={wallet} onChange={(e) => setWallet(e.target.value)} />
          </div>

          {/* Notes */}
          <div className="flex items-center gap-3">
            <span className="w-20 text-right text-gray-500 text-sm">Notes:</span>
            <input className="input w-64 text-sm" value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={100} />
            <span className="text-xs text-gray-400">{notes.length}/100</span>
          </div>
        </div>

        {error && <div className="text-red-500 text-sm mt-3">{error}</div>}

        <div className="flex gap-3 justify-end mt-5">
          <button className="btn-secondary text-sm" onClick={onClose}>Cancel</button>
          <button className="btn-primary text-sm" onClick={handleSave}>Save Changes</button>
        </div>
      </div>
    </div>
  );
}

function EditLotsModal({
  txn,
  existingRecord,
  allTransactions,
  recordedSales,
  onSave,
  onRevert,
  onClose,
}: {
  txn: Transaction;
  existingRecord?: SaleRecord;
  allTransactions: Transaction[];
  recordedSales: SaleRecord[];
  onSave: (saleRecord: SaleRecord) => Promise<void>;
  onRevert: () => Promise<void>;
  onClose: () => void;
}) {
  const [showLotPicker, setShowLotPicker] = useState(true);
  const [preview, setPreview] = useState<SaleRecord | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Calculate lot state as it existed just before this transaction.
  // Exclude the target txn's own SaleRecord (by id) to prevent legacy key contamination.
  const lotsAtPoint = useMemo(() => {
    const result = calculateUpTo(allTransactions, AccountingMethod.FIFO, txn.id, recordedSales, existingRecord?.id);
    return result.lots;
  }, [allTransactions, txn.id, recordedSales, existingRecord?.id]);

  // Filter to available lots (remainingBTC > 0), subtract BTC claimed by LATER Specific ID
  // elections (only records for transactions AFTER txn — prior records are already reflected
  // in lotsAtPoint via calculateUpTo), then wallet-filter (per-wallet cost basis, TD 9989).
  const walletName = txn.wallet || txn.exchange;
  const walletLotsResult = useMemo(() => {
    const available = lotsAtPoint.filter((l) => l.remainingBTC > 0);

    // Build set of transaction IDs that come before (or are) the target — these are already
    // handled by calculateUpTo, so their SaleRecords are already reflected in lotsAtPoint.
    const sorted = [...allTransactions].sort(
      (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()
    );
    const priorOrSelfIds = new Set<string>();
    for (const t of sorted) {
      priorOrSelfIds.add(t.id);
      if (t.id === txn.id) break;
    }

    // Only subtract claims from records linked to transactions AFTER the target.
    // Skip the current txn's own record (if editing) to avoid double-subtraction.
    const claimedByLater = new Map<string, number>();
    for (const rs of recordedSales) {
      if (rs.method !== AccountingMethod.SpecificID) continue;
      if (existingRecord && rs.id === existingRecord.id) continue; // skip own record
      // Skip legacy records without sourceTransactionId — ambiguous position, already
      // reflected in lotsAtPoint via calculateUpTo's chronological processing.
      if (!rs.sourceTransactionId) continue;
      // Skip records for transactions that come before or at the target — already in lotsAtPoint
      if (priorOrSelfIds.has(rs.sourceTransactionId)) continue;
      for (const d of rs.lotDetails) {
        if (d.lotId) {
          claimedByLater.set(d.lotId, (claimedByLater.get(d.lotId) || 0) + d.amountBTC);
        }
      }
    }

    // Reduce remainingBTC by later claims, filter out fully claimed lots
    const adjusted = available.map((l) => {
      const claimed = claimedByLater.get(l.id) || 0;
      if (claimed <= 0) return l;
      const adjusted = l.remainingBTC - claimed;
      if (adjusted < 1e-10) return null; // fully claimed — hide
      return { ...l, remainingBTC: adjusted };
    }).filter((l): l is NonNullable<typeof l> => l !== null);

    const walletNorm = (walletName || "").trim().toLowerCase();
    if (!walletNorm) return { lots: adjusted, isMismatch: false };
    const walletFiltered = adjusted.filter(
      (l) => (l.wallet || l.exchange || "").toLowerCase() === walletNorm
    );
    // Fall back to all available lots if no wallet match (same behavior as processSale)
    const isMismatch = walletFiltered.length === 0 && adjusted.length > 0;
    return { lots: walletFiltered.length > 0 ? walletFiltered : adjusted, isMismatch };
  }, [lotsAtPoint, walletName, recordedSales, existingRecord, allTransactions, txn.id]);
  const walletLots = walletLotsResult.lots;
  const isWalletMismatch = walletLotsResult.isMismatch;

  // Extract existing lot selections to pre-fill the LotPicker (if editing an existing record)
  const initialSelections = useMemo((): LotSelection[] | undefined => {
    if (!existingRecord) return undefined;
    return existingRecord.lotDetails
      .filter((d) => d.lotId)
      .map((d) => ({ lotId: d.lotId!, amountBTC: d.amountBTC }));
  }, [existingRecord]);

  const isDonation = txn.transactionType === TransactionType.Donation;

  const handleLotPickerConfirm = (selections: LotSelection[]) => {
    setError(null);
    setShowLotPicker(false);
    // Simulate the sale with the selected lots to build the SaleRecord
    const salePrice = isDonation ? 0 : txn.pricePerBTC;
    const sim = simulateSale(
      txn.amountBTC,
      salePrice,
      lotsAtPoint, // use full lot pool — simulateSale deep-copies
      AccountingMethod.SpecificID,
      selections,
      walletName || undefined,
      txn.date
    );
    if (sim) {
      // Stamp with donation FMV if applicable
      if (isDonation) {
        sim.isDonation = true;
        sim.donationFmvPerBTC = txn.pricePerBTC;
        sim.donationFmvTotal = txn.amountBTC * txn.pricePerBTC;
      }
      setPreview(sim);
    } else {
      setError("Not enough BTC from the selected lots. Please re-select.");
      setShowLotPicker(true);
    }
  };

  const handleSave = async () => {
    if (!preview) return;
    setSaving(true);
    const record: SaleRecord = {
      ...preview,
      id: crypto.randomUUID(),
      saleDate: txn.date,
      method: AccountingMethod.SpecificID,
      sourceTransactionId: txn.id,
    };
    await onSave(record);
    setSaving(false);
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-white dark:bg-zinc-900 rounded-xl p-6 max-w-4xl w-full shadow-2xl max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-lg font-bold">
              {existingRecord ? "Edit Lot Selections" : "Assign Lot Selections"}
            </h3>
            <p className="text-sm text-gray-500">
              {TransactionTypeDisplayNames[txn.transactionType]} of {formatBTC(txn.amountBTC)} BTC on {formatDateTime(txn.date)}
              {walletName ? ` — ${walletName}` : ""}
            </p>
          </div>
          {existingRecord && (
            <div className="flex items-center gap-2">
              <span className="text-xs text-blue-500">Currently using Specific ID</span>
              <button
                className="text-xs px-2 py-1 rounded bg-gray-100 dark:bg-zinc-800 hover:bg-gray-200 dark:hover:bg-zinc-700 text-gray-600 dark:text-gray-400"
                onClick={async () => { await onRevert(); }}
                title="Remove Specific ID election — sale will use your default method (FIFO)"
              >
                Revert to FIFO
              </button>
            </div>
          )}
        </div>

        <div className="bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400 text-xs p-2 rounded-lg mb-4">
          IRS expects consistent use of one accounting method per wallet within a tax year (IRC &sect;1012, TD 9989). If you use Specific ID for any {isDonation ? "donation" : "sale"}, use it for all dispositions from this wallet in the same year.
        </div>

        {isWalletMismatch && (
          <div className="bg-yellow-50 dark:bg-yellow-900/20 text-yellow-700 dark:text-yellow-400 text-xs p-2 rounded-lg mb-4">
            ⚠️ <strong>Wallet mismatch:</strong> No lots found in wallet "{walletName}". Showing lots from all wallets as a fallback.
            As of January 1, 2025, IRS requires cost basis to be tracked per wallet (Treasury Reg. §1.1012-1(j)).
            To fix this, record the transfer of Bitcoin to this wallet in Reconciliation.
          </div>
        )}

        {error && (
          <div className="bg-red-50 dark:bg-red-900/20 text-red-500 text-sm p-3 rounded-lg mb-4">
            {error}
          </div>
        )}

        {showLotPicker && (
          <LotPicker
            lots={walletLots}
            targetAmount={txn.amountBTC}
            saleDate={txn.date}
            salePrice={isDonation ? undefined : txn.pricePerBTC}
            initialSelections={initialSelections}
            onConfirm={handleLotPickerConfirm}
            onCancel={onClose}
          />
        )}

        {preview && !showLotPicker && (
          <div className="space-y-4">
            {/* Lot details preview */}
            <div className="card border-l-4 border-l-blue-500">
              <h4 className="font-semibold text-sm mb-2">Selected Lots ({preview.lotDetails.length})</h4>
              <div className="grid grid-cols-[1fr_1fr_1fr_1fr_1fr_1fr] gap-2 text-xs font-semibold text-gray-500 pb-2 border-b border-gray-200 dark:border-gray-700">
                <div>Purchase Date</div>
                <div>Wallet</div>
                <div className="text-right">BTC Amount</div>
                <div className="text-right">Cost Basis</div>
                <div className="text-right">Days Held</div>
                <div>Term</div>
              </div>
              {preview.lotDetails.map((d, idx) => (
                <div key={idx} className="grid grid-cols-[1fr_1fr_1fr_1fr_1fr_1fr] gap-2 py-1.5 text-sm border-b border-gray-100 dark:border-gray-800">
                  <div>{formatDate(d.purchaseDate)}</div>
                  <div className="text-xs text-gray-500 truncate" title={d.wallet || d.exchange}>{d.wallet || d.exchange}</div>
                  <div className="text-right tabular-nums">{formatBTC(d.amountBTC)}</div>
                  <div className="text-right tabular-nums">{formatUSD(d.totalCost)}</div>
                  <div className="text-right tabular-nums">{d.daysHeld}</div>
                  <div><span className={`badge ${d.isLongTerm ? "badge-green" : "badge-orange"} text-xs`}>{d.isLongTerm ? "Long" : "Short"}</span></div>
                </div>
              ))}
              {/* Summary row */}
              <div className="mt-3 flex gap-6 text-sm flex-wrap">
                <div>
                  <span className="text-gray-500">Cost Basis:</span>{" "}
                  <span className="tabular-nums font-medium">{formatUSD(preview.costBasis)}</span>
                </div>
                {!isDonation && (
                  <>
                    <div>
                      <span className="text-gray-500">Proceeds:</span>{" "}
                      <span className="tabular-nums font-medium">{formatUSD(preview.totalProceeds)}</span>
                    </div>
                    <div>
                      <span className="text-gray-500">Gain/Loss:</span>{" "}
                      <span className={`tabular-nums font-semibold ${preview.gainLoss >= 0 ? "text-green-600" : "text-red-500"}`}>
                        {preview.gainLoss >= 0 ? "+" : ""}{formatUSD(preview.gainLoss)}
                      </span>
                    </div>
                  </>
                )}
                <div>
                  <span className="text-gray-500">Term:</span>{" "}
                  <span className={`badge ${preview.isLongTerm ? "badge-green" : preview.isMixedTerm ? "badge-blue" : "badge-orange"} text-xs`}>
                    {preview.isMixedTerm ? "Mixed" : preview.isLongTerm ? "Long-term" : "Short-term"}
                  </span>
                </div>
              </div>
            </div>

            <div className="flex gap-3 justify-end">
              <button className="btn-secondary text-sm" onClick={() => { setShowLotPicker(true); setPreview(null); }}>Re-select Lots</button>
              <button className="btn-secondary text-sm" onClick={onClose}>Cancel</button>
              <button className="btn-primary text-sm" disabled={saving} onClick={async () => { await handleSave(); }}>
                {saving ? "Saving..." : existingRecord ? "Update Lot Selections" : "Save Lot Selections"}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function SortHeader({ label, field, current, asc, onClick }: { label: string; field: string; current: string; asc: boolean; onClick: (f: any) => void }) {
  return (
    <div className="cursor-pointer select-none flex items-center gap-1" onClick={() => onClick(field)}>
      {label}
      {current === field && <span className="text-orange-500">{asc ? "▲" : "▼"}</span>}
    </div>
  );
}

function typeColor(type: TransactionType): string {
  switch (type) {
    case TransactionType.Buy: return "text-green-600";
    case TransactionType.Sell: return "text-red-500";
    case TransactionType.TransferIn: return "text-blue-500";
    case TransactionType.TransferOut: return "text-orange-500";
    case TransactionType.Donation: return "text-purple-500";
  }
}

function typeIcon(type: TransactionType): string {
  switch (type) {
    case TransactionType.Buy: return "↓";
    case TransactionType.Sell: return "↑";
    case TransactionType.TransferIn: return "→";
    case TransactionType.TransferOut: return "←";
    case TransactionType.Donation: return "♥";
  }
}
