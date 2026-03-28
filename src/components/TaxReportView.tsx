import { useMemo, useState, useEffect, useCallback } from "react";
import { useAppState } from "../lib/app-state";
import { calculate, resolveRecordedSales, batchOptimizeSpecificId } from "../lib/cost-basis";
import { exportForm8949CSV, exportLegacyCSV, exportTurboTaxTXF, exportTurboTaxCSV, exportForm8283CSV, buildDonationSummary } from "../lib/export";
import { exportForm8949PDF } from "../lib/pdf-export";
import { formatUSD, formatBTC, formatDate } from "../lib/utils";
import { AccountingMethod, TransactionType } from "../lib/types";
import { SaleRecord } from "../lib/models";
import { getUnassignedTransfers, getWalletMismatchSales, getOptimizableSells, getAssignedSells } from "../lib/review-helpers";
import { computeCarryforward } from "../lib/carryforward";
import { saveTextFile, saveBinaryFile } from "../lib/file-save";
import { HelpPanel } from "./HelpPanel";

export function TaxReportView() {
  const state = useAppState();
  const { allTransactions, recordedSales, selectedYear, setSelectedYear, availableYears } = state;

  const result = useMemo(() => calculate(allTransactions, AccountingMethod.FIFO, recordedSales), [allTransactions, recordedSales]);

  // Count unassigned TransferIn transactions (no sourceWallet)
  const unassignedTransferCount = useMemo(() => getUnassignedTransfers(allTransactions, selectedYear).length, [allTransactions, selectedYear]);

  // Count wallet mismatches for the selected year
  const walletMismatchCount = useMemo(() => getWalletMismatchSales(result.sales, selectedYear).length, [result.sales, selectedYear]);

  // Engine warnings (stale Specific ID elections that fell back to FIFO, etc.) — year-scoped
  const engineWarnings = useMemo(
    () => result.warnings.filter((w) => w.message.length > 0 && (!w.txnDate || new Date(w.txnDate).getFullYear() === selectedYear)),
    [result.warnings, selectedYear]
  );

  // Batch optimize state
  const [batchOptimizeResult, setBatchOptimizeResult] = useState<{ records: SaleRecord[]; skipped: number; fifoGainLoss: number; optimizedGainLoss: number; walletMismatches: number } | null>(null);
  const [batchSaving, setBatchSaving] = useState(false);
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Count unassigned sells/donations for optimize button
  const recordedByTxnId = useMemo(
    () => resolveRecordedSales(allTransactions, recordedSales),
    [recordedSales, allTransactions]
  );
  const unassignedCount = useMemo(() => getOptimizableSells(allTransactions, recordedByTxnId, selectedYear, result.fallbackTxnIds).length, [allTransactions, selectedYear, recordedByTxnId, result.fallbackTxnIds]);

  const handleBatchOptimize = useCallback(() => {
    const { records, skipped, walletMismatches } = batchOptimizeSpecificId(allTransactions, recordedSales, selectedYear);
    const fifoResult = calculate(allTransactions, AccountingMethod.FIFO, recordedSales);
    const fifoGainLoss = fifoResult.sales
      .filter((s: SaleRecord) => new Date(s.saleDate).getFullYear() === selectedYear && !s.isDonation)
      .reduce((sum: number, s: SaleRecord) => sum + s.gainLoss, 0);
    const allSales = [...recordedSales, ...records];
    const optResult = calculate(allTransactions, AccountingMethod.FIFO, allSales);
    const optimizedGainLoss = optResult.sales
      .filter((s: SaleRecord) => new Date(s.saleDate).getFullYear() === selectedYear && !s.isDonation)
      .reduce((sum: number, s: SaleRecord) => sum + s.gainLoss, 0);
    setBatchOptimizeResult({ records, skipped, fifoGainLoss, optimizedGainLoss, walletMismatches: walletMismatches.length });
  }, [allTransactions, recordedSales, selectedYear]);

  const handleBatchSave = useCallback(async () => {
    if (!batchOptimizeResult) return;
    setBatchSaving(true);
    setErrorMessage(null);
    try {
      await state.recordSalesBatch(batchOptimizeResult.records);
      setBatchOptimizeResult(null);
    } catch (err) {
      setErrorMessage(`Failed to save optimized elections: ${err instanceof Error ? err.message : "Unknown error"}`);
    } finally {
      setBatchSaving(false);
    }
  }, [batchOptimizeResult, state.recordSalesBatch]);

  // Count assigned Specific ID elections for the year (for clear all)
  const assignedCount = useMemo(() => getAssignedSells(allTransactions, recordedByTxnId, selectedYear, result.fallbackTxnIds).length, [allTransactions, selectedYear, recordedByTxnId, result.fallbackTxnIds]);

  const handleClearAll = useCallback(async () => {
    setClearing(true);
    setErrorMessage(null);
    try {
      const idsToDelete: string[] = [];
      // Use transaction date (not record.saleDate) to match assignedCount filtering
      for (const t of allTransactions) {
        if (t.transactionType !== TransactionType.Sell && t.transactionType !== TransactionType.Donation) continue;
        if (new Date(t.date).getFullYear() !== selectedYear) continue;
        const record = recordedByTxnId.get(t.id);
        if (record) idsToDelete.push(record.id);
      }
      await state.deleteSaleRecordsByIds(idsToDelete);
      setShowClearConfirm(false);
    } catch (err) {
      setErrorMessage(`Failed to clear elections: ${err instanceof Error ? err.message : "Unknown error"}`);
      setShowClearConfirm(false);
    } finally {
      setClearing(false);
    }
  }, [allTransactions, recordedByTxnId, selectedYear, state.deleteSaleRecordsByIds]);

  // Filter sales to selected year — calculate() now handles Specific ID natively
  // (recorded lot elections are respected during engine replay, no overlay needed)
  const salesForYear = useMemo(() => {
    return result.sales.filter((s) => new Date(s.saleDate).getFullYear() === selectedYear);
  }, [result.sales, selectedYear]);

  // Determine effective method from actual sales data for accurate export labels.
  // Each SaleRecord carries its own method (FIFO or SpecificID).
  const effectiveMethod = useMemo(() => {
    const taxable = salesForYear.filter((s) => !s.isDonation);
    const hasSpecificId = taxable.some((s) => s.method === AccountingMethod.SpecificID);
    const hasFifo = taxable.some((s) => s.method !== AccountingMethod.SpecificID);
    if (hasSpecificId && !hasFifo) return AccountingMethod.SpecificID;
    if (hasSpecificId && hasFifo) return AccountingMethod.SpecificID; // Specific ID overrides are applied
    return AccountingMethod.FIFO;
  }, [salesForYear]);

  // Exclude donations from all summary totals and ST/LT breakdown:
  // - Donations have zero proceeds/gainLoss but retain costBasis (proceeds - costBasis ≠ totalGL)
  // - Donations have salePricePerBTC=0 which would produce phantom losses in the lot-detail formula
  const taxableSales = salesForYear.filter((s) => !s.isDonation);
  const totalProceeds = taxableSales.reduce((a, s) => a + s.totalProceeds, 0);
  const totalCostBasis = taxableSales.reduce((a, s) => a + s.costBasis, 0);
  const totalGL = taxableSales.reduce((a, s) => a + s.gainLoss, 0);

  // Compute ST/LT gain/loss from lot details, not sale-level isLongTerm (handles mixed-term sales)
  const stGL = taxableSales.reduce((a, s) => {
    return a + s.lotDetails.filter((d) => !d.isLongTerm).reduce((sum, d) => sum + (d.amountBTC * s.salePricePerBTC - d.totalCost), 0);
  }, 0);
  const ltGL = taxableSales.reduce((a, s) => {
    return a + s.lotDetails.filter((d) => d.isLongTerm).reduce((sum, d) => sum + (d.amountBTC * s.salePricePerBTC - d.totalCost), 0);
  }, 0);

  // Donation summary for Form 8283 reference card
  const donationSummary = useMemo(() => {
    const donationsForYear = salesForYear.filter((s) => s.isDonation);
    return donationsForYear.length > 0 ? buildDonationSummary(donationsForYear, allTransactions, selectedYear) : [];
  }, [salesForYear, allTransactions, selectedYear]);

  const [exportToast, setExportToast] = useState<string | null>(null);

  useEffect(() => {
    if (!exportToast) return;
    const timer = setTimeout(() => setExportToast(null), 3000);
    return () => clearTimeout(timer);
  }, [exportToast]);

  const downloadCSV = async (content: string, filename: string) => {
    const ext = filename.endsWith(".txf") ? "txf" : "csv";
    const saved = await saveTextFile(content, {
      defaultPath: filename,
      filters: [{ name: ext.toUpperCase(), extensions: [ext] }],
    });
    if (saved) setExportToast(filename);
  };

  return (
    <div className="p-8 max-w-5xl">
      <h1 className="text-3xl font-bold mb-1">Tax Report</h1>
      <HelpPanel
        subtitle="Form 8949 and Schedule D data for your selected tax year. Specific ID elections from Transactions are automatically applied."
        expandedContent={
          <>
            <p><strong>Short-term vs. long-term:</strong> Assets held one year or less are short-term (taxed as ordinary income). Assets held more than one year are long-term (lower capital gains rate).</p>
            <p><strong>Accounting methods:</strong> FIFO (First In, First Out) sells oldest lots first — this is the IRS default. Specific Identification lets you choose exactly which lots to sell, but must be elected before the disposal.</p>
            <p><strong>Export options:</strong> Form 8949 CSV for manual filing, TurboTax CSV/TXF for direct import, or a PDF summary for your records.</p>
          </>
        }
      />

      {/* Error banner */}
      {errorMessage && (
        <div className="bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 text-sm p-3 rounded-lg mb-4 flex items-center gap-2">
          <span>⚠️ {errorMessage}</span>
          <button className="ml-auto text-xs underline" onClick={() => setErrorMessage(null)}>Dismiss</button>
        </div>
      )}

      {/* Controls */}
      <div className="flex items-center gap-6 mb-6">
        <div className="flex items-center gap-2">
          <span className="text-gray-500">Tax Year:</span>
          <select className="select" value={selectedYear} onChange={(e) => setSelectedYear(Number(e.target.value))}>
            {availableYears.map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
        </div>
      </div>

      {/* Wallet Mismatch Warning — only show for 2025+ when per-wallet rules apply */}
      {walletMismatchCount > 0 && selectedYear >= 2025 && (
        <div className="card mb-6 border-l-4 border-l-yellow-500 bg-yellow-50 dark:bg-yellow-900/10">
          <div className="flex items-start gap-3">
            <span className="text-yellow-500 text-lg mt-0.5">⚠️</span>
            <div>
              <h3 className="font-semibold text-sm text-yellow-700 dark:text-yellow-400 mb-1">
                Wallet Mismatch — {walletMismatchCount} sale{walletMismatchCount === 1 ? "" : "s"} affected
              </h3>
              <p className="text-xs text-yellow-700 dark:text-yellow-400/80 mb-2">
                IRS per-wallet rules (Treasury Reg. §1.1012-1(j), effective 2025) require that cost basis comes from lots held in the same wallet as the sale.
                The {walletMismatchCount === 1 ? "sale" : "sales"} flagged below had no matching lots in {walletMismatchCount === 1 ? "its" : "their"} wallet, so the engine used lots from other wallets as a fallback.
              </p>
              <p className="text-xs text-yellow-700 dark:text-yellow-400/80">
                <strong>Common causes:</strong> (1) A Transfer In needs a source wallet assigned — go to{" "}
                <button className="underline font-medium hover:text-yellow-900 dark:hover:text-yellow-300" onClick={() => state.setSelectedNav("transactions")}>Transactions</button>{" "}
                and click <strong>"Assign"</strong> on Transfer In rows to re-tag lots to the selling wallet.
                (2) The Bitcoin was purchased elsewhere and needs a Transfer In to move lots to the selling wallet.
                (3) Not enough lots exist in the source wallet to cover the full transfer amount.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Engine Warnings — stale Specific ID elections that fell back to FIFO, etc. */}
      {engineWarnings.length > 0 && (
        <div className="card mb-6 border-l-4 border-l-orange-500 bg-orange-50 dark:bg-orange-900/10">
          <div className="flex items-start gap-3">
            <span className="text-orange-500 text-lg mt-0.5">⚠️</span>
            <div>
              <h3 className="font-semibold text-sm text-orange-700 dark:text-orange-400 mb-1">
                {engineWarnings.length} cost basis warning{engineWarnings.length === 1 ? "" : "s"}
              </h3>
              <div className="space-y-1">
                {engineWarnings.map((w, i) => (
                  <p key={i} className="text-xs text-orange-700 dark:text-orange-400/80">{w.message}</p>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Unassigned Transfer Warning — only show for 2025+ when per-wallet rules apply */}
      {unassignedTransferCount > 0 && selectedYear >= 2025 && (
        <div className="card mb-6 border-l-4 border-l-red-500 bg-red-50 dark:bg-red-900/10">
          <div className="flex items-start gap-3">
            <span className="text-red-500 text-lg mt-0.5">⚠️</span>
            <div>
              <h3 className="font-semibold text-sm text-red-700 dark:text-red-400 mb-1">
                {unassignedTransferCount} Transfer In{unassignedTransferCount === 1 ? "" : "s"} without source wallet
              </h3>
              <p className="text-xs text-red-700 dark:text-red-400/80">
                Some Transfer In transactions have not been assigned a source wallet. Without this,
                the engine cannot re-tag lots to the correct wallet, which may cause wallet mismatch warnings
                and non-compliant cost basis under IRS per-wallet rules (Treasury Reg. §1.1012-1(j)).
              </p>
              <p className="text-xs text-red-700 dark:text-red-400/80 mt-1">
                <strong>To fix:</strong> Go to <button className="underline font-medium hover:text-red-900 dark:hover:text-red-300" onClick={() => state.setSelectedNav("transactions")}>Transactions</button> and
                click "Assign" on the highlighted Transfer In rows.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Optimize Specific ID card */}
      <div className="card mb-6 border-l-4 border-l-blue-500">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="font-semibold text-sm mb-1">Optimize with Specific ID</h3>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              {unassignedCount > 0
                ? `You have ${unassignedCount} sell${unassignedCount === 1 ? "" : "s"}/donation${unassignedCount === 1 ? "" : "s"} in ${selectedYear} using the default FIFO method. Click Optimize to automatically assign the best lots to each sale using Specific ID, minimizing your tax liability. You'll see a comparison before applying.`
                : `All sells and donations in ${selectedYear} already have Specific ID lot elections assigned. Your tax report reflects your optimized selections.`
              }
            </p>
          </div>
          <div className="flex gap-2 ml-4 shrink-0">
            {unassignedCount > 0 ? (
              <button className="text-sm px-4 py-1.5 btn-primary" onClick={handleBatchOptimize}>
                Optimize ({unassignedCount})
              </button>
            ) : (
              <span className="text-sm px-4 py-1.5 btn-secondary opacity-50 cursor-default" title="All sells and donations in this year already have Specific ID lot elections assigned. Use Revert to FIFO to remove them.">All Optimized</span>
            )}
            {assignedCount > 0 && (
              <button className="text-sm px-4 py-1.5 btn-secondary text-red-500 hover:text-red-600" onClick={() => setShowClearConfirm(true)}>
                Revert to FIFO
              </button>
            )}
          </div>
        </div>
      </div>

      {salesForYear.length === 0 ? (
        <div className="text-center py-16">
          <div className="text-5xl mb-4 opacity-50">📄</div>
          <h2 className="text-xl text-gray-500">No sales in {selectedYear}</h2>
        </div>
      ) : (
        <>
          {/* Summary */}
          <div className="card mb-6">
            <h3 className="font-semibold mb-3">Summary — {selectedYear}</h3>
            <div className="grid grid-cols-5 gap-4">
              <div><div className="text-xs text-gray-500">Total Proceeds</div><div className="font-semibold tabular-nums">{formatUSD(totalProceeds)}</div></div>
              <div><div className="text-xs text-gray-500">Cost Basis</div><div className="font-semibold tabular-nums">{formatUSD(totalCostBasis)}</div></div>
              <div><div className="text-xs text-gray-500">Total Gain/Loss</div><div className={`font-semibold tabular-nums ${totalGL >= 0 ? "text-green-600" : "text-red-500"}`}>{formatUSD(totalGL)}</div></div>
              <div><div className="text-xs text-gray-500">Short-term</div><div className={`font-semibold tabular-nums ${stGL >= 0 ? "text-green-600" : "text-red-500"}`}>{formatUSD(stGL)}</div></div>
              <div><div className="text-xs text-gray-500">Long-term</div><div className={`font-semibold tabular-nums ${ltGL >= 0 ? "text-green-600" : "text-red-500"}`}>{formatUSD(ltGL)}</div></div>
            </div>
          </div>

          {/* Capital Loss / Carryforward Info */}
          {(() => {
            const cf = computeCarryforward(stGL, ltGL, state.priorCarryforwardST, state.priorCarryforwardLT);
            const hasPriorCarryforward = state.priorCarryforwardST < 0 || state.priorCarryforwardLT < 0;
            if (cf.netGainLoss >= 0 && !hasPriorCarryforward) return null;
            const hasCarryforward = cf.carryforwardAmount < 0;
            return (
              <div className="card mb-6 border-l-4 border-l-orange-500">
                <h3 className="font-semibold mb-2">{hasCarryforward ? "Capital Loss Carryforward" : cf.netGainLoss < 0 ? "Capital Loss Deduction" : "Prior Carryforward Applied"}</h3>
                <div className="text-sm text-gray-600 dark:text-gray-400 space-y-1">
                  {hasPriorCarryforward && (
                    <>
                      {state.priorCarryforwardST < 0 && (
                        <p>Prior-year ST carryforward: <span className="font-medium text-orange-500">{formatUSD(state.priorCarryforwardST)}</span></p>
                      )}
                      {state.priorCarryforwardLT < 0 && (
                        <p>Prior-year LT carryforward: <span className="font-medium text-orange-500">{formatUSD(state.priorCarryforwardLT)}</span></p>
                      )}
                    </>
                  )}
                  {cf.netGainLoss < 0 ? (
                    hasCarryforward ? (
                      <>
                        <p>Net capital loss (including prior carryforward): <span className="font-medium text-red-500">{formatUSD(cf.netGainLoss)}</span></p>
                        <p>You may deduct <span className="font-medium">{formatUSD(cf.deductibleLoss)}</span> this year and carry forward <span className="font-medium text-orange-500">{formatUSD(cf.carryforwardAmount)}</span> to future tax years.</p>
                        {(cf.carryforwardST < 0 || cf.carryforwardLT < 0) && (
                          <p className="text-xs text-gray-500">
                            Next year: ST carryforward {formatUSD(cf.carryforwardST)}, LT carryforward {formatUSD(cf.carryforwardLT)}
                          </p>
                        )}
                      </>
                    ) : (
                      <p>Your net capital loss of <span className="font-medium text-red-500">{formatUSD(cf.netGainLoss)}</span> is fully deductible this year against ordinary income (up to the {formatUSD(-3000)} annual limit).</p>
                    )
                  ) : (
                    <p>Your prior-year carryforward was fully absorbed by this year's gains. Net gain: <span className="font-medium text-green-600">{formatUSD(cf.netGainLoss)}</span></p>
                  )}
                  <p className="text-xs text-gray-500 mt-2">
                    Set your prior-year capital loss carryforward in Settings → Tax Settings.
                  </p>
                </div>
              </div>
            );
          })()}

          {/* Charitable Donations — Form 8283 Reference */}
          {donationSummary.length > 0 && (
            <div className="card mb-6 border-l-4 border-l-purple-500">
              <h3 className="font-semibold mb-1">Charitable Donations — Form 8283 Reference</h3>
              <p className="text-xs text-gray-500 mb-4">
                Noncash charitable contributions are reported on IRS Form 8283 (Schedule A), not Form 8949.
                This data is for your records when preparing that form.
              </p>

              {/* Donation summary stats */}
              <div className="grid grid-cols-4 gap-4 mb-4">
                <div>
                  <div className="text-xs text-gray-500">Total Donated</div>
                  <div className="font-semibold tabular-nums">{formatBTC(donationSummary.reduce((a, d) => a + d.amountBTC, 0))} BTC</div>
                </div>
                <div>
                  <div className="text-xs text-gray-500">Fair Market Value</div>
                  <div className="font-semibold tabular-nums text-purple-600">{formatUSD(donationSummary.reduce((a, d) => a + d.totalFMV, 0))}</div>
                </div>
                <div>
                  <div className="text-xs text-gray-500">Cost Basis</div>
                  <div className="font-semibold tabular-nums">{formatUSD(donationSummary.reduce((a, d) => a + d.costBasis, 0))}</div>
                </div>
                <div>
                  <div className="text-xs text-gray-500">Donations</div>
                  <div className="font-semibold">{donationSummary.length}</div>
                </div>
              </div>

              {/* Per-donation detail */}
              {donationSummary.map((d, idx) => (
                <details key={idx} className="mb-2">
                  <summary className="flex items-center gap-3 py-2 px-3 rounded cursor-pointer hover:bg-gray-50 dark:hover:bg-zinc-800">
                    <span className="font-medium">Donation #{idx + 1}</span>
                    <span className="text-gray-500 text-sm">{formatDate(d.date)}</span>
                    <span className="flex-1" />
                    <span className="tabular-nums text-sm">{formatBTC(d.amountBTC)} BTC</span>
                    {d.fmvPerBTC > 0 && (
                      <span className="tabular-nums text-sm text-purple-600">FMV {formatUSD(d.totalFMV)}</span>
                    )}
                    <span className={`badge ${d.holdingPeriod === "Long-term" ? "badge-green" : d.holdingPeriod === "Mixed" ? "badge-blue" : "badge-orange"}`}>
                      {d.holdingPeriod}
                    </span>
                  </summary>
                  <div className="ml-8 mt-1 text-xs space-y-1">
                    <div className="flex gap-4 text-gray-600 dark:text-gray-400">
                      <span>Exchange: {d.exchange}</span>
                      {d.notes && <span>Notes: {d.notes}</span>}
                    </div>
                    <div className="flex gap-4 text-gray-600 dark:text-gray-400">
                      <span>Cost Basis: {formatUSD(d.costBasis)}</span>
                      {d.fmvPerBTC > 0 && <span>FMV/BTC: {formatUSD(d.fmvPerBTC)}</span>}
                    </div>
                    {d.lotDetails.map((lot, li) => (
                      <div key={li} className="flex gap-4 py-0.5 text-gray-500">
                        <span>Acquired {formatDate(lot.purchaseDate)}</span>
                        <span className="tabular-nums">{formatBTC(lot.amountBTC)} BTC</span>
                        <span className="tabular-nums">basis {formatUSD(lot.costBasis)}</span>
                        <span className={lot.isLongTerm ? "text-green-600" : "text-orange-500"}>{lot.isLongTerm ? "Long" : "Short"}</span>
                      </div>
                    ))}
                    <div className="text-xs text-gray-400 mt-1">
                      {d.holdingPeriod === "Long-term"
                        ? "Held > 1 year — deductible at FMV (IRC §170(b)(1)(C)), limited to 30% of AGI"
                        : d.holdingPeriod === "Short-term"
                          ? "Held ≤ 1 year — deductible at cost basis only (IRC §170(e)(1)(A))"
                          : "Mixed holding periods — long-term portion deductible at FMV, short-term at cost basis"
                      }
                    </div>
                  </div>
                </details>
              ))}

              {/* Form 8283 Export */}
              <div className="mt-3 pt-3 border-t border-gray-200 dark:border-gray-700">
                <button
                  className="btn-secondary text-sm"
                  onClick={() => downloadCSV(
                    exportForm8283CSV(donationSummary, selectedYear),
                    `form_8283_donations_${selectedYear}.csv`
                  )}
                >
                  📋 Export Form 8283 CSV
                </button>
                <span className="text-xs text-gray-400 ml-3">Reference data for IRS Form 8283 preparation</span>
              </div>
            </div>
          )}

          {/* Export */}
          <div className="card mb-6">
            <h3 className="font-semibold mb-3">Export Tax Documents</h3>
            <div className="flex gap-3 flex-wrap">
              <button className="btn-secondary" onClick={async () => { await downloadCSV(exportForm8949CSV(salesForYear, selectedYear, effectiveMethod, walletMismatchCount), `form_8949_${selectedYear}.csv`); }}>
                📊 Form 8949 CSV
              </button>
              <button className="btn-secondary" onClick={async () => { await downloadCSV(exportLegacyCSV(salesForYear, walletMismatchCount), `btc_tax_${selectedYear}.csv`); }}>
                📋 Raw Data CSV
              </button>
              <button className="btn-secondary" onClick={async () => { await downloadCSV(exportTurboTaxCSV(salesForYear, selectedYear, walletMismatchCount), `turbotax_${selectedYear}.csv`); }}>
                💼 TurboTax CSV
              </button>
              <button className="btn-secondary" onClick={async () => { await downloadCSV(exportTurboTaxTXF(salesForYear, selectedYear, walletMismatchCount), `turbotax_${selectedYear}.txf`); }}>
                📑 TurboTax TXF
              </button>
              <button className="btn-secondary" onClick={async () => { const pdf = exportForm8949PDF(salesForYear, selectedYear, effectiveMethod, walletMismatchCount); const saved = await saveBinaryFile(pdf, { defaultPath: `form_8949_${selectedYear}_${effectiveMethod}.pdf`, filters: [{ name: "PDF", extensions: ["pdf"] }] }); if (saved) setExportToast(`form_8949_${selectedYear}.pdf`); }}>
                📄 PDF Report
              </button>
            </div>
            <p className="text-xs text-gray-500 mt-2">
              Form 8949 exports include Part I (short-term) and Part II (long-term) separated sections with Schedule D summary.
              TurboTax formats can be imported directly into TurboTax.
            </p>
            <p className="text-xs text-gray-500 mt-1">
              Note: If your modified adjusted gross income exceeds $200,000 ($250,000 MFJ),
              capital gains may be subject to an additional 3.8% Net Investment Income Tax (NIIT).
              Consult IRS Form 8960 or a tax professional.
            </p>
            {walletMismatchCount > 0 && selectedYear >= 2025 && (
              <p className="text-xs text-yellow-600 dark:text-yellow-400 mt-2 font-medium">
                ⚠️ {walletMismatchCount} sale{walletMismatchCount === 1 ? "" : "s"} in this report used lots from a different wallet.
                Go to Transactions and assign source wallets on your Transfer In records to fix this before exporting.
              </p>
            )}
          </div>

          {/* Sales List */}
          <div className="card">
            <h3 className="font-semibold mb-3">
              Dispositions ({salesForYear.length})
              {salesForYear.some((s) => s.isDonation) && (
                <span className="text-sm font-normal text-gray-500 ml-2">
                  {salesForYear.filter((s) => !s.isDonation).length} sales, {salesForYear.filter((s) => s.isDonation).length} donations
                </span>
              )}
            </h3>
            {salesForYear.map((sale, idx) => (
              <details key={sale.id} className="mb-2">
                <summary className="flex items-center gap-3 py-2 px-3 rounded cursor-pointer hover:bg-gray-50 dark:hover:bg-zinc-800">
                  <span className="font-medium">{sale.isDonation ? "Donation" : "Sale"} #{idx + 1}</span>
                  <span className="text-gray-500 text-sm">{formatDate(sale.saleDate)}</span>
                  <span className="flex-1" />
                  <span className="tabular-nums text-sm">{formatBTC(sale.amountSold)} BTC</span>
                  <span className={`font-medium tabular-nums ${sale.gainLoss >= 0 ? "text-green-600" : "text-red-500"}`}>
                    {sale.gainLoss >= 0 ? "+" : ""}{formatUSD(sale.gainLoss)}
                  </span>
                  {sale.walletMismatch && selectedYear >= 2025 && (
                    <span className="text-yellow-500 text-xs" title="Wallet mismatch: This sale used lots from a different wallet. To fix, assign a source wallet on the Transfer In that moved Bitcoin to this wallet.">⚠️</span>
                  )}
                  {sale.isDonation ? (
                    <span className="badge" style={{ background: "rgba(168,85,247,0.15)", color: "#a855f7" }}>Donation</span>
                  ) : sale.isMixedTerm ? (
                    <span className="badge badge-blue">Mixed</span>
                  ) : (
                    <span className={`badge ${sale.isLongTerm ? "badge-green" : "badge-orange"}`}>
                      {sale.isLongTerm ? "Long-term" : "Short-term"}
                    </span>
                  )}
                </summary>
                <div className="ml-8 mt-1 text-xs">
                  {sale.lotDetails.map((d) => (
                    <div key={d.id} className="flex gap-4 py-1 text-gray-600 dark:text-gray-400">
                      <span>{formatDate(d.purchaseDate)}</span>
                      <span className="tabular-nums">{formatBTC(d.amountBTC)} BTC</span>
                      <span className="tabular-nums">@{formatUSD(d.costBasisPerBTC)}</span>
                      <span>{d.daysHeld} days</span>
                      <span className={d.isLongTerm ? "text-green-600" : "text-orange-500"}>{d.isLongTerm ? "Long" : "Short"}</span>
                      <span>{d.exchange}</span>
                    </div>
                  ))}
                </div>
              </details>
            ))}
          </div>
        </>
      )}

      {/* Batch Optimize Confirmation Modal */}
      {batchOptimizeResult && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setBatchOptimizeResult(null)}>
          <div className="bg-white dark:bg-zinc-900 rounded-xl p-6 max-w-lg w-full shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-bold mb-4">Optimize — {selectedYear}</h3>

            <div className="bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400 text-xs p-2 rounded-lg mb-4">
              IRS expects consistent use of one accounting method per wallet within a tax year (IRC &sect;1012, TD 9989). Applying Specific ID to all dispositions ensures consistency.
            </div>

            <div className="bg-orange-50 dark:bg-orange-900/20 text-orange-700 dark:text-orange-400 text-xs p-2 rounded-lg mb-4">
              <strong>IRS timing requirement (Treas. Reg. &sect;1.1012-1(c), IRS FAQ 82):</strong> Specific ID elections must be made no later than the date and time of the sale. Applying Specific ID to transactions that were already completed without a contemporaneous lot identification may not satisfy IRS requirements.
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
                      <span className="text-gray-500 font-medium">Change in taxable gains:</span>
                      <span className={`font-bold tabular-nums ${isPositive ? "text-green-600" : "text-red-500"}`}>
                        {isPositive ? `−${formatUSD(savings)}` : `+${formatUSD(Math.abs(savings))}`}
                      </span>
                    </div>
                  );
                })()}
              </div>
            </div>

            {batchOptimizeResult.walletMismatches > 0 && selectedYear >= 2025 && (
              <div className="bg-yellow-50 dark:bg-yellow-900/20 text-yellow-700 dark:text-yellow-400 text-xs p-2 rounded-lg mb-4">
                ⚠️ <strong>{batchOptimizeResult.walletMismatches} sale{batchOptimizeResult.walletMismatches === 1 ? "" : "s"}</strong> used lots from a different wallet because no lots were found in the selling wallet.
                This usually means a transfer between wallets hasn't been recorded yet.
                You can still apply these optimizations, but consider assigning source wallets on your Transfer In transactions first for full IRS compliance.
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
            <h3 className="text-lg font-bold mb-3">Revert to FIFO — {selectedYear}</h3>
            <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
              This will remove all {assignedCount} Specific ID lot election{assignedCount === 1 ? "" : "s"} for {selectedYear}. All sells and donations will fall back to the default FIFO method. You can re-optimize at any time.
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

      {/* Export toast notification */}
      {exportToast && (
        <div className="fixed bottom-6 right-6 bg-green-600 text-white px-5 py-3 rounded-lg shadow-lg flex items-center gap-3 z-50 animate-fade-in">
          <span className="text-lg">✓</span>
          <div>
            <div className="font-medium text-sm">Export Complete</div>
            <div className="text-xs opacity-90">{exportToast}</div>
          </div>
        </div>
      )}
    </div>
  );
}
