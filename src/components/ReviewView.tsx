import { useState, useMemo, useCallback, useEffect } from "react";
import { useAppState } from "../lib/app-state";
import { calculate, resolveRecordedSales, batchOptimizeSpecificId } from "../lib/cost-basis";
import { formatUSD, formatBTC, formatDateTime } from "../lib/utils";
import { AccountingMethod, TransactionType, TransactionTypeDisplayNames } from "../lib/types";
import { Transaction, SaleRecord } from "../lib/models";
import {
  getUnassignedTransfers,
  getAssignedTransferCount,
  getWalletMismatchSales,
  getOptimizableSells,
  getAssignedSells,
} from "../lib/review-helpers";
import { suggestSourceWallet } from "../lib/reconciliation";
import { HelpPanel } from "./HelpPanel";

export function ReviewView() {
  const state = useAppState();
  const {
    transactions,
    allTransactions,
    recordedSales,
    selectedYear,
    setSelectedYear,
    availableYears,
    availableWallets,
    updateTransaction,
    recordSalesBatch,
    deleteSaleRecordsByIds,
    setSelectedNav,
  } = state;

  // Shared resolver
  const recordedByTxnId = useMemo(
    () => resolveRecordedSales(allTransactions, recordedSales),
    [recordedSales, allTransactions]
  );

  // Run calculate() for wallet mismatch detection + wallet balances
  const calcResult = useMemo(
    () => calculate(allTransactions, AccountingMethod.FIFO, recordedSales),
    [allTransactions, recordedSales]
  );

  // --- Aggregated review data ---
  const unassignedTransfers = useMemo(() => getUnassignedTransfers(transactions, selectedYear), [transactions, selectedYear]);
  const assignedTransferCount = useMemo(() => getAssignedTransferCount(transactions, selectedYear), [transactions, selectedYear]);
  const walletMismatchSales = useMemo(() => getWalletMismatchSales(calcResult.sales, selectedYear), [calcResult.sales, selectedYear]);
  const optimizableSells = useMemo(() => getOptimizableSells(transactions, recordedByTxnId, selectedYear), [transactions, recordedByTxnId, selectedYear]);
  const assignedSells = useMemo(() => getAssignedSells(transactions, recordedByTxnId, selectedYear), [transactions, recordedByTxnId, selectedYear]);

  // Wallet balances for source wallet modal
  const walletBalances = useMemo(() => {
    const balances = new Map<string, number>();
    for (const lot of calcResult.lots) {
      if (lot.remainingBTC <= 0) continue;
      const w = lot.wallet || lot.exchange;
      if (w) balances.set(w, (balances.get(w) || 0) + lot.remainingBTC);
    }
    return balances;
  }, [calcResult.lots]);

  // --- Local UI state ---
  const [assigningSourceWallet, setAssigningSourceWallet] = useState<string | null>(null);
  const [batchOptimizeResult, setBatchOptimizeResult] = useState<{
    records: SaleRecord[];
    skipped: number;
    fifoGainLoss: number;
    optimizedGainLoss: number;
    walletMismatches: number;
  } | null>(null);
  const [batchSaving, setBatchSaving] = useState(false);
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // --- Readiness status ---
  const hasIssues = unassignedTransfers.length > 0 || walletMismatchSales.length > 0;
  const hasOptimizable = optimizableSells.length > 0;
  const readinessStatus: "ready" | "warning" | "action" =
    hasIssues ? "action" : hasOptimizable ? "warning" : "ready";

  // --- Handlers ---
  const handleBatchOptimize = useCallback(() => {
    const { records, skipped, walletMismatches } = batchOptimizeSpecificId(allTransactions, recordedSales, selectedYear);
    // Use existing calcResult for FIFO baseline — same inputs, no need to re-run calculate()
    const fifoGainLoss = calcResult.sales
      .filter((s: SaleRecord) => new Date(s.saleDate).getFullYear() === selectedYear && !s.isDonation)
      .reduce((sum: number, s: SaleRecord) => sum + s.gainLoss, 0);
    const allSales = [...recordedSales, ...records];
    const optResult = calculate(allTransactions, AccountingMethod.FIFO, allSales);
    const optimizedGainLoss = optResult.sales
      .filter((s: SaleRecord) => new Date(s.saleDate).getFullYear() === selectedYear && !s.isDonation)
      .reduce((sum: number, s: SaleRecord) => sum + s.gainLoss, 0);
    setBatchOptimizeResult({ records, skipped, fifoGainLoss, optimizedGainLoss, walletMismatches: walletMismatches.length });
  }, [allTransactions, recordedSales, selectedYear, calcResult.sales]);

  const handleBatchSave = useCallback(async () => {
    if (!batchOptimizeResult) return;
    setBatchSaving(true);
    setErrorMessage(null);
    try {
      await recordSalesBatch(batchOptimizeResult.records);
      setBatchOptimizeResult(null);
    } catch (err) {
      setErrorMessage(`Failed to save optimized elections: ${err instanceof Error ? err.message : "Unknown error"}`);
    } finally {
      setBatchSaving(false);
    }
  }, [batchOptimizeResult, recordSalesBatch]);

  const handleClearAll = useCallback(async () => {
    setClearing(true);
    setErrorMessage(null);
    try {
      const idsToDelete: string[] = [];
      for (const t of allTransactions) {
        if (t.transactionType !== TransactionType.Sell && t.transactionType !== TransactionType.Donation) continue;
        if (new Date(t.date).getFullYear() !== selectedYear) continue;
        const record = recordedByTxnId.get(t.id);
        if (record) idsToDelete.push(record.id);
      }
      await deleteSaleRecordsByIds(idsToDelete);
      setShowClearConfirm(false);
    } catch (err) {
      setErrorMessage(`Failed to clear elections: ${err instanceof Error ? err.message : "Unknown error"}`);
      setShowClearConfirm(false);
    } finally {
      setClearing(false);
    }
  }, [allTransactions, recordedByTxnId, selectedYear, deleteSaleRecordsByIds]);

  // Close modals on Escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (batchOptimizeResult) { setBatchOptimizeResult(null); return; }
        if (showClearConfirm) { setShowClearConfirm(false); return; }
        if (assigningSourceWallet) { setAssigningSourceWallet(null); return; }
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [batchOptimizeResult, showClearConfirm, assigningSourceWallet]);

  if (transactions.length === 0) {
    return (
      <div className="p-8 flex flex-col items-center justify-center h-full">
        <div className="text-5xl mb-4 opacity-50">📋</div>
        <h2 className="text-xl text-gray-500 mb-2">No transactions imported yet</h2>
        <p className="text-gray-400 text-sm mb-4">Import your CSV files to get started with the guided review.</p>
        <button className="btn-primary" onClick={() => setSelectedNav("import")}>Go to Import</button>
      </div>
    );
  }

  return (
    <div className="p-8 max-w-4xl">
      <h1 className="text-3xl font-bold mb-1">Review</h1>
      <HelpPanel
        subtitle={`Guided checklist for ${selectedYear} tax preparation. Fix issues here before generating your tax report.`}
        expandedContent={
          <>
            <p><strong>Step 1 — Assign source wallets:</strong> Transfer In transactions need a source wallet so the engine tracks lots at the correct wallet for IRS per-wallet rules.</p>
            <p><strong>Step 2 — Resolve wallet mismatches:</strong> Sales that used lots from the wrong wallet need attention — usually a missing Transfer In assignment.</p>
            <p><strong>Step 3 — Optimize lot selections:</strong> Apply Specific ID to minimize your tax liability. You can always revert to FIFO.</p>
            <p><strong>When all green:</strong> Your data is ready — go to Tax Report to export Form 8949.</p>
          </>
        }
      />

      {/* Year selector */}
      <div className="flex items-center gap-4 mb-6">
        <div className="flex items-center gap-2">
          <span className="text-gray-500">Tax Year:</span>
          <select className="select" value={selectedYear} onChange={(e) => setSelectedYear(Number(e.target.value))}>
            {availableYears.map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
        </div>
      </div>

      {/* Readiness Summary */}
      <div className={`card mb-6 border-l-4 ${
        readinessStatus === "ready" ? "border-l-green-500" :
        readinessStatus === "warning" ? "border-l-yellow-500" :
        "border-l-red-500"
      }`}>
        <div className="flex items-center gap-3">
          <span className="text-2xl">
            {readinessStatus === "ready" ? "✅" : readinessStatus === "warning" ? "⚠️" : "🔴"}
          </span>
          <div>
            <h3 className="font-semibold">
              {readinessStatus === "ready"
                ? `${selectedYear} Tax Data Ready`
                : readinessStatus === "warning"
                  ? `${selectedYear} Almost Ready — Optimization Available`
                  : `${selectedYear} Needs Attention`
              }
            </h3>
            <p className="text-sm text-gray-500">
              {readinessStatus === "ready"
                ? "All checks passed. You can generate your tax report."
                : readinessStatus === "warning"
                  ? `No blocking issues, but ${optimizableSells.length} sale${optimizableSells.length === 1 ? "" : "s"} can be optimized with Specific ID to reduce your tax liability.`
                  : `${unassignedTransfers.length > 0 ? `${unassignedTransfers.length} unassigned transfer${unassignedTransfers.length === 1 ? "" : "s"}` : ""}${unassignedTransfers.length > 0 && walletMismatchSales.length > 0 ? " and " : ""}${walletMismatchSales.length > 0 ? `${walletMismatchSales.length} wallet mismatch${walletMismatchSales.length === 1 ? "" : "es"}` : ""} need${(unassignedTransfers.length + walletMismatchSales.length) === 1 ? "s" : ""} to be resolved.`
              }
            </p>
          </div>
        </div>
      </div>

      {/* Error banner */}
      {errorMessage && (
        <div className="bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 text-sm p-3 rounded-lg mb-4 flex items-center gap-2">
          <span>⚠️ {errorMessage}</span>
          <button className="ml-auto text-xs underline" onClick={() => setErrorMessage(null)}>Dismiss</button>
        </div>
      )}

      {/* Section 1: Unassigned Transfers */}
      <ReviewSection
        title="Source Wallet Assignments"
        status={unassignedTransfers.length === 0 ? "pass" : "fail"}
        summary={
          unassignedTransfers.length === 0
            ? `All ${selectedYear} Transfer In transactions have source wallets assigned${assignedTransferCount > 0 ? ` (${assignedTransferCount} assigned)` : ""}.`
            : `${unassignedTransfers.length} Transfer In${unassignedTransfers.length === 1 ? "" : "s"} without a source wallet.`
        }
      >
        {unassignedTransfers.length > 0 && (
          <>
            <p className="text-xs text-gray-500 mb-3">
              IRS per-wallet rules (Treasury Reg. §1.1012-1(j)) require cost basis from lots in the same wallet as the sale. Assign source wallets so lots are tracked correctly.
            </p>
            <div className="space-y-1">
              {unassignedTransfers.map((t) => (
                <div key={t.id} className="flex items-center gap-3 px-3 py-2 rounded bg-red-50 dark:bg-red-900/10 text-sm">
                  <span className="text-red-500">⚠️</span>
                  <span className="flex-1">
                    <span className="font-medium">{formatDateTime(t.date)}</span>
                    <span className="text-gray-500 mx-2">—</span>
                    <span>{formatBTC(t.amountBTC)} BTC to <span className="font-medium">{t.wallet || t.exchange}</span></span>
                  </span>
                  <button
                    className="text-xs px-2 py-1 rounded bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400 font-medium hover:bg-red-200 dark:hover:bg-red-900/50"
                    onClick={() => setAssigningSourceWallet(t.id)}
                  >
                    Assign
                  </button>
                </div>
              ))}
            </div>
          </>
        )}
      </ReviewSection>

      {/* Section 2: Wallet Mismatches */}
      <ReviewSection
        title="Wallet Compliance"
        status={walletMismatchSales.length === 0 ? "pass" : "fail"}
        summary={
          walletMismatchSales.length === 0
            ? `All ${selectedYear} sales used lots from the correct wallet.`
            : `${walletMismatchSales.length} sale${walletMismatchSales.length === 1 ? "" : "s"} used lots from the wrong wallet.`
        }
      >
        {walletMismatchSales.length > 0 && (
          <>
            <p className="text-xs text-gray-500 mb-3">
              These sales had no matching lots in their wallet, so the engine used lots from other wallets as a fallback. Usually this means a Transfer In needs a source wallet assigned above.
            </p>
            <div className="space-y-1">
              {walletMismatchSales.map((sale) => {
                let txn = sale.sourceTransactionId ? transactions.find((t) => t.id === sale.sourceTransactionId) : undefined;
                if (!txn) {
                  txn = transactions.find((t) =>
                    (t.transactionType === TransactionType.Sell || t.transactionType === TransactionType.Donation) &&
                    Math.abs(t.amountBTC - sale.amountSold) < 1e-8 &&
                    new Date(t.date).toDateString() === new Date(sale.saleDate).toDateString()
                  );
                }
                const wallet = txn ? (txn.wallet || txn.exchange || "untagged") : "untagged";
                return (
                  <div key={sale.id} className="flex items-center gap-3 px-3 py-2 rounded bg-yellow-50 dark:bg-yellow-900/10 text-sm">
                    <span className="text-yellow-500">⚠️</span>
                    <span className="flex-1">
                      <span className="font-medium">{new Date(sale.saleDate).toLocaleDateString()}</span>
                      <span className="text-gray-500 mx-2">—</span>
                      <span>Sold {formatBTC(sale.amountSold)} BTC on "{wallet}" — no lots found in this wallet</span>
                    </span>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </ReviewSection>

      {/* Section 3: Lot Optimization */}
      <ReviewSection
        title="Lot Optimization"
        status={optimizableSells.length === 0 ? "pass" : "info"}
        summary={
          optimizableSells.length === 0
            ? `All ${selectedYear} sales have Specific ID lot elections${assignedSells.length > 0 ? ` (${assignedSells.length} optimized)` : ""}.`
            : `${optimizableSells.length} sell${optimizableSells.length === 1 ? "" : "s"}/donation${optimizableSells.length === 1 ? "" : "s"} using default FIFO — can be optimized.`
        }
      >
        <p className="text-xs text-gray-500 mb-3">
          {optimizableSells.length > 0
            ? "Specific ID lets you choose exactly which lots to sell, often resulting in lower tax liability. Click Optimize to see a comparison before applying."
            : "Your sales are using Specific ID lot elections. You can revert to FIFO at any time."
          }
        </p>
        <div className="flex gap-2">
          {optimizableSells.length > 0 ? (
            <button className="btn-primary text-sm" onClick={handleBatchOptimize}>
              Optimize Sells ({optimizableSells.length})
            </button>
          ) : (
            <span className="text-sm px-4 py-1.5 btn-secondary opacity-50 cursor-default">All Optimized</span>
          )}
          {assignedSells.length > 0 && (
            <button
              className="btn-secondary text-sm text-red-500 hover:text-red-600"
              onClick={() => setShowClearConfirm(true)}
            >
              Revert to FIFO ({assignedSells.length})
            </button>
          )}
        </div>
      </ReviewSection>

      {/* Ready to File */}
      {readinessStatus === "ready" && (
        <div className="card border-l-4 border-l-green-500 mt-6">
          <div className="flex items-center gap-4">
            <span className="text-3xl">✅</span>
            <div className="flex-1">
              <h3 className="font-semibold text-green-700 dark:text-green-400">Ready to File</h3>
              <p className="text-sm text-gray-500">All checks passed for {selectedYear}. Generate your Form 8949 and Schedule D data.</p>
            </div>
            <button className="btn-primary" onClick={() => setSelectedNav("taxReport")}>
              Go to Tax Report
            </button>
          </div>
        </div>
      )}

      {/* Source Wallet Assignment Modal */}
      {assigningSourceWallet && transactions.find((t) => t.id === assigningSourceWallet) && (() => {
        const modalTxn = transactions.find((t) => t.id === assigningSourceWallet)!;
        const transferDate = new Date(modalTxn.date).getTime();
        // Only show wallets that had Buy or TransferIn activity before this transfer's date
        const priorWallets = new Set<string>();
        for (const t of allTransactions) {
          if ((t.transactionType === TransactionType.Buy || t.transactionType === TransactionType.TransferIn) && new Date(t.date).getTime() <= transferDate) {
            const w = t.wallet || t.exchange;
            if (w) priorWallets.add(w);
          }
        }
        const filteredWallets = availableWallets.filter((w) => priorWallets.has(w));
        // Point-in-time balances: only lots from transactions before the transfer date
        const priorBalances = new Map<string, number>();
        for (const lot of calcResult.lots) {
          if (lot.remainingBTC <= 0) continue;
          if (new Date(lot.purchaseDate).getTime() > transferDate) continue;
          const w = lot.wallet || lot.exchange;
          if (w) priorBalances.set(w, (priorBalances.get(w) || 0) + lot.remainingBTC);
        }
        return (
          <SourceWalletModal
            txn={modalTxn}
            availableWallets={filteredWallets}
            walletBalances={priorBalances}
            suggestion={suggestSourceWallet(modalTxn, allTransactions)}
            onSave={async (sourceWallet) => {
              await updateTransaction(assigningSourceWallet, { sourceWallet: sourceWallet || undefined });
              setAssigningSourceWallet(null);
            }}
            onClear={async () => {
              await updateTransaction(assigningSourceWallet, { sourceWallet: undefined });
              setAssigningSourceWallet(null);
            }}
            onClose={() => setAssigningSourceWallet(null)}
          />
        );
      })()}

      {/* Batch Optimize Confirmation Modal */}
      {batchOptimizeResult && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={() => setBatchOptimizeResult(null)}>
          <div className="bg-white dark:bg-zinc-900 rounded-xl p-6 max-w-lg w-full shadow-2xl max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-bold mb-4">Optimize Sells — {selectedYear}</h3>

            <div className="bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400 text-xs p-2 rounded-lg mb-4">
              IRS expects consistent use of one accounting method per wallet within a tax year (IRC &sect;1012, TD 9989). Applying Specific ID to all dispositions ensures consistency.
            </div>

            <div className="bg-orange-50 dark:bg-orange-900/20 text-orange-700 dark:text-orange-400 text-xs p-2 rounded-lg mb-4">
              <strong>IRS timing requirement (Treas. Reg. &sect;1.1012-1(c), IRS FAQ 82):</strong> Specific ID elections must be made no later than the date and time of the sale.
              {selectedYear === 2025
                ? <span className="block mt-1"><strong>What to do:</strong> For 2025 transactions, Notice 2025-07 provides temporary relief for record-keeping. Proceed with optimization — Sovereign Tax stores your lot identifications as required records.</span>
                : <span className="block mt-1"><strong>What to do:</strong> You are optimizing {selectedYear} transactions. Notice 2025-07 temporary relief applies only to 2025. If you made contemporaneous lot identifications at the time of each original sale, this records them. If not, consider reverting to FIFO or consulting a tax professional.</span>
              }
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
                  <span className="text-gray-500">Current gain/loss ({selectedYear}):</span>
                  <span className={`font-medium tabular-nums ${batchOptimizeResult.fifoGainLoss >= 0 ? "text-green-600" : "text-red-500"}`}>
                    {batchOptimizeResult.fifoGainLoss >= 0 ? "+" : ""}{formatUSD(batchOptimizeResult.fifoGainLoss)}
                  </span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-gray-500">Optimized gain/loss ({selectedYear}):</span>
                  <span className={`font-medium tabular-nums ${batchOptimizeResult.optimizedGainLoss >= 0 ? "text-green-600" : "text-red-500"}`}>
                    {batchOptimizeResult.optimizedGainLoss >= 0 ? "+" : ""}{formatUSD(batchOptimizeResult.optimizedGainLoss)}
                  </span>
                </div>
                {batchOptimizeResult.fifoGainLoss !== batchOptimizeResult.optimizedGainLoss && (() => {
                  const savings = batchOptimizeResult.fifoGainLoss - batchOptimizeResult.optimizedGainLoss;
                  const isPositive = savings > 0;
                  return (
                    <div className="flex justify-between text-sm mt-1 pt-1 border-t border-gray-100 dark:border-gray-800">
                      <span className="text-gray-500 font-medium">{isPositive ? "Estimated savings:" : "Additional tax liability:"}</span>
                      <span className={`font-bold tabular-nums ${isPositive ? "text-green-600" : "text-red-500"}`}>
                        {isPositive ? formatUSD(savings) : `+${formatUSD(Math.abs(savings))}`}
                      </span>
                    </div>
                  );
                })()}
              </div>
            </div>

            {batchOptimizeResult.walletMismatches > 0 && (
              <div className="bg-yellow-50 dark:bg-yellow-900/20 text-yellow-700 dark:text-yellow-400 text-xs p-2 rounded-lg mb-4">
                ⚠️ <strong>{batchOptimizeResult.walletMismatches} sale{batchOptimizeResult.walletMismatches === 1 ? "" : "s"}</strong> used lots from a different wallet.
                Consider assigning source wallets on your Transfer In transactions first for full IRS compliance.
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

      {/* Revert to FIFO Confirmation Modal */}
      {showClearConfirm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setShowClearConfirm(false)}>
          <div className="bg-white dark:bg-zinc-900 rounded-xl p-6 max-w-md w-full shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-bold mb-3">Revert to FIFO — {selectedYear}</h3>
            <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
              This will remove all {assignedSells.length} Specific ID lot election{assignedSells.length === 1 ? "" : "s"} for {selectedYear}. All sells and donations will fall back to the default FIFO method. You can re-optimize at any time.
            </p>
            <div className="flex gap-3 justify-end">
              <button className="btn-secondary text-sm" onClick={() => setShowClearConfirm(false)}>Cancel</button>
              <button className="text-sm px-4 py-1.5 bg-red-600 hover:bg-red-700 text-white rounded-lg" disabled={clearing} onClick={async () => { await handleClearAll(); }}>
                {clearing ? "Clearing..." : `Remove All (${assignedSells.length})`}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// --- ReviewSection: collapsible checklist item ---
function ReviewSection({
  title,
  status,
  summary,
  children,
}: {
  title: string;
  status: "pass" | "fail" | "info";
  summary: string;
  children?: React.ReactNode;
}) {
  const [open, setOpen] = useState(status !== "pass");

  // Re-sync open state when status changes (e.g., after fixing issues or switching years)
  useEffect(() => {
    setOpen(status !== "pass");
  }, [status]);

  const icon = status === "pass" ? "✅" : status === "fail" ? "🔴" : "💡";
  const borderColor = status === "pass" ? "border-l-green-500" : status === "fail" ? "border-l-red-500" : "border-l-blue-500";

  return (
    <div className={`card mb-4 border-l-4 ${borderColor}`}>
      <button
        className="w-full flex items-center gap-3 text-left"
        onClick={() => setOpen(!open)}
      >
        <span className="text-lg">{icon}</span>
        <div className="flex-1">
          <h3 className="font-semibold text-sm">{title}</h3>
          <p className="text-xs text-gray-500">{summary}</p>
        </div>
        <span className={`text-gray-400 text-xs transition-transform duration-150 ${open ? "rotate-90" : ""}`}>▶</span>
      </button>
      {open && children && (
        <div className="mt-3 pt-3 border-t border-gray-200 dark:border-gray-700">
          {children}
        </div>
      )}
    </div>
  );
}

// --- SourceWalletModal (self-contained copy for ReviewView) ---
function SourceWalletModal({
  txn,
  availableWallets,
  walletBalances,
  suggestion,
  onSave,
  onClear,
  onClose,
}: {
  txn: Transaction;
  availableWallets: string[];
  walletBalances: Map<string, number>;
  suggestion?: { wallet: string; reason: string; confidence: "confident" | "flagged" } | null;
  onSave: (sourceWallet: string) => Promise<void>;
  onClear: () => Promise<void>;
  onClose: () => void;
}) {
  const [selected, setSelected] = useState(txn.sourceWallet || "");
  const [customWallet, setCustomWallet] = useState("");
  const [saving, setSaving] = useState(false);
  const destWallet = txn.wallet || txn.exchange;

  // If we have a suggestion, move it to the top of the list.
  const options = suggestion && availableWallets.includes(suggestion.wallet)
    ? [suggestion.wallet, ...availableWallets.filter((w) => w !== suggestion.wallet)]
    : availableWallets;

  const effectiveValue = selected === "__custom__" ? customWallet.trim() : selected;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-white dark:bg-zinc-900 rounded-xl p-6 max-w-md w-full shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-lg font-bold mb-2">Assign Source Wallet</h3>
        <p className="text-sm text-gray-500 mb-1">
          Transfer In of {formatBTC(txn.amountBTC)} BTC to <span className="font-medium">{destWallet}</span> on {formatDateTime(txn.date)}
        </p>
        <p className="text-sm text-gray-500 mb-4">
          Select the exchange or wallet where this Bitcoin was originally purchased. This re-tags the lots so cost basis is accurate when you sell from {destWallet ? `"${destWallet}"` : "the destination"}.
        </p>

        <div className="bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400 text-xs p-2 rounded-lg mb-4">
          Transfers between your own wallets are not taxable (IRS FAQ 81). The original cost basis and holding period carry over automatically.
        </div>

        <div className="max-h-48 overflow-y-auto rounded-lg border border-gray-200 dark:border-zinc-700 mb-2">
          {options.map((w) => {
            const bal = walletBalances.get(w) || 0;
            const isSelected = selected === w;
            const isSuggested = suggestion?.wallet === w;
            return (
              <button
                key={w}
                className={`w-full flex flex-col px-3 py-2 text-sm text-left hover:bg-gray-100 dark:hover:bg-zinc-800 transition-colors ${isSelected ? "bg-orange-50 dark:bg-orange-900/20 border-l-2 border-l-orange-500" : isSuggested ? "bg-green-50 dark:bg-green-900/10 border-l-2 border-l-green-500" : "border-l-2 border-l-transparent"}`}
                onClick={() => setSelected(isSelected ? "" : w)}
              >
                <div className="flex items-center justify-between w-full">
                  <span className="flex items-center gap-2">
                    <span className={isSelected ? "font-medium text-orange-600 dark:text-orange-400" : ""}>{w}</span>
                    {isSuggested && (
                      <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${suggestion.confidence === "confident" ? "bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400" : "bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-400"}`}>
                        {suggestion.confidence === "confident" ? "Suggested" : "Possible match"}
                      </span>
                    )}
                  </span>
                  <span className={`tabular-nums text-xs ${bal > 0 ? "text-gray-500" : "text-gray-300 dark:text-gray-600"}`}>
                    {bal > 0 ? `${bal.toFixed(8)} BTC` : "0 BTC"}
                  </span>
                </div>
                {isSuggested && (
                  <span className="text-[11px] text-green-600 dark:text-green-400 mt-0.5">{suggestion.reason}</span>
                )}
              </button>
            );
          })}
          <button
            className={`w-full flex items-center px-3 py-2 text-sm text-left hover:bg-gray-100 dark:hover:bg-zinc-800 transition-colors ${selected === "__custom__" ? "bg-orange-50 dark:bg-orange-900/20 border-l-2 border-l-orange-500" : "border-l-2 border-l-transparent"}`}
            onClick={() => setSelected(selected === "__custom__" ? "" : "__custom__")}
          >
            <span className={selected === "__custom__" ? "font-medium text-orange-600 dark:text-orange-400" : "text-gray-500"}>Other (type a name)...</span>
          </button>
        </div>

        {selected === "__custom__" && (
          <input
            type="text"
            className="input w-full mb-2"
            placeholder="e.g., Coinbase, Cold Storage, Trezor"
            value={customWallet}
            onChange={(e) => setCustomWallet(e.target.value)}
            autoFocus
          />
        )}

        <div className="flex gap-3 justify-end mt-3">
          {txn.sourceWallet && (
            <button
              className="text-xs px-3 py-1.5 rounded bg-gray-100 dark:bg-zinc-800 hover:bg-gray-200 dark:hover:bg-zinc-700 text-gray-600 dark:text-gray-400"
              onClick={async () => { setSaving(true); try { await onClear(); } finally { setSaving(false); } }}
              disabled={saving}
            >
              Clear Assignment
            </button>
          )}
          <span className="flex-1" />
          <button className="btn-secondary text-sm" onClick={onClose}>Cancel</button>
          <button
            className="btn-primary text-sm"
            disabled={!effectiveValue || saving}
            onClick={async () => { setSaving(true); try { await onSave(effectiveValue); } finally { setSaving(false); } }}
          >
            {saving ? "Saving..." : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}
