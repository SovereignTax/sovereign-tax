import { useMemo, useState } from "react";
import { useAppState } from "../lib/app-state";
import { reconcileTransfers, MatchConfidence, TransferPair, daysBetweenDates } from "../lib/reconciliation";
import { calculate } from "../lib/cost-basis";
import { formatBTC, formatUSD, formatDate } from "../lib/utils";
import { Transaction } from "../lib/models";
import { AccountingMethod } from "../lib/types";
import { HelpPanel } from "./HelpPanel";

export function ReconciliationView() {
  const {
    allTransactions,
    recordedSales,
    selectedYear,
    availableYears,
    setSelectedYear,
    setSelectedNav,
    reconciliationDecisions,
    setReconciliationDecision,
    manualTransferMatches,
    addManualTransferMatch,
    removeManualTransferMatch,
  } = useAppState();

  const result = useMemo(() => reconcileTransfers(allTransactions), [allTransactions]);

  // Local selection state for manual matching UI (ephemeral)
  const [selectedOutId, setSelectedOutId] = useState<string | null>(null);
  const [selectedInId, setSelectedInId] = useState<string | null>(null);

  // Reconstruct manual match pairs from persisted id-only references
  const manualMatches: TransferPair[] = useMemo(() => {
    const idx = new Map<string, Transaction>();
    for (const t of allTransactions) idx.set(t.id, t);
    const out: TransferPair[] = [];
    for (const ref of manualTransferMatches) {
      const o = idx.get(ref.outId);
      const i = idx.get(ref.inId);
      if (!o || !i) continue; // transaction was deleted — drop silently
      const impliedFee = Math.max(0, o.amountBTC - i.amountBTC);
      out.push({
        transferOut: o,
        transferIn: i,
        amountBTC: o.amountBTC,
        daysBetween: daysBetweenDates(o.date, i.date),
        impliedFeeBTC: impliedFee,
        confidence: MatchConfidence.Confident,
      });
    }
    return out;
  }, [manualTransferMatches, allTransactions]);

  // Lot assignments: compute from calculate() result, scoped to selectedYear
  const calcResult = useMemo(
    () => calculate(allTransactions, AccountingMethod.FIFO, recordedSales),
    [allTransactions, recordedSales]
  );
  const txnById = useMemo(() => {
    const map = new Map<string, Transaction>();
    for (const t of allTransactions) map.set(t.id, t);
    return map;
  }, [allTransactions]);
  const salesForYear = useMemo(
    () => calcResult.sales.filter((s) => !s.isDonation && new Date(s.saleDate).getFullYear() === selectedYear),
    [calcResult.sales, selectedYear]
  );
  const donationsForYear = useMemo(
    () => calcResult.sales.filter((s) => s.isDonation && new Date(s.saleDate).getFullYear() === selectedYear),
    [calcResult.sales, selectedYear]
  );
  const [expandedSaleIdx, setExpandedSaleIdx] = useState<number | null>(null);

  // Split auto-matched pairs by confidence
  const confidentPairs = result.matchedTransfers.filter((p) => p.confidence === MatchConfidence.Confident);
  const flaggedPairs = result.matchedTransfers.filter((p) => p.confidence === MatchConfidence.Flagged);

  // Flagged pairs that haven't been reviewed yet
  const pendingFlagged = flaggedPairs.filter((p) => !reconciliationDecisions[pairKey(p)]);
  const approvedFlaggedPairs = flaggedPairs.filter((p) => reconciliationDecisions[pairKey(p)] === "approved");
  const rejectedFlaggedPairs = flaggedPairs.filter((p) => reconciliationDecisions[pairKey(p)] === "rejected");

  // Effective unmatched = original unmatched + rejected flagged transfers - manually matched
  const manualOutIds = new Set(manualMatches.map((m) => m.transferOut.id));
  const manualInIds = new Set(manualMatches.map((m) => m.transferIn.id));

  const effectiveUnmatchedOuts = [
    ...result.unmatchedTransferOuts,
    ...rejectedFlaggedPairs.map((p) => p.transferOut),
  ].filter((t) => !manualOutIds.has(t.id));

  const effectiveUnmatchedIns = [
    ...result.unmatchedTransferIns,
    ...rejectedFlaggedPairs.map((p) => p.transferIn),
  ].filter((t) => !manualInIds.has(t.id));

  // All confirmed matches for display
  const allConfirmedPairs = [...confidentPairs, ...approvedFlaggedPairs, ...manualMatches];

  // Manual match helpers
  const selectedOut = effectiveUnmatchedOuts.find((t) => t.id === selectedOutId) ?? null;
  const selectedIn = effectiveUnmatchedIns.find((t) => t.id === selectedInId) ?? null;

  const handleApproveFlag = (pair: TransferPair) => {
    setReconciliationDecision(pairKey(pair), "approved");
  };

  const handleRejectFlag = (pair: TransferPair) => {
    setReconciliationDecision(pairKey(pair), "rejected");
  };

  const handleManualMatch = () => {
    if (!selectedOut || !selectedIn) return;
    addManualTransferMatch({ outId: selectedOut.id, inId: selectedIn.id });
    setSelectedOutId(null);
    setSelectedInId(null);
  };

  if (allTransactions.length === 0) {
    return (
      <div className="p-8 flex flex-col items-center justify-center h-full">
        <div className="text-5xl mb-4 opacity-50">🔍</div>
        <h2 className="text-xl text-gray-500 mb-2">No data to reconcile</h2>
        <p className="text-gray-400 mb-4">Import transactions first</p>
        <button className="btn-secondary" onClick={() => setSelectedNav("import")}>Go to Import</button>
      </div>
    );
  }

  return (
    <div className="p-8 max-w-5xl">
      <h1 className="text-3xl font-bold mb-1">Reconciliation</h1>
      <HelpPanel
        subtitle="Match transfers between exchanges and identify missing data."
        expandedContent={
          <>
            <p><strong>How matching works:</strong> A withdrawal from one exchange is paired with a deposit at another within a 7-day window. Miner fees are accounted for — the received amount can be less than the sent amount.</p>
            <p><strong>Flagged matches:</strong> Transfers with an unusually high implied miner fee (above 0.0005 BTC) are flagged for your review. You can approve or reject them.</p>
            <p><strong>Manual matching:</strong> If a transfer wasn't auto-matched, you can select one outgoing and one incoming transfer to link them manually.</p>
            <p><strong>Unmatched transfers:</strong> Withdrawals to your own cold storage wallet will appear as unmatched — this is normal and does not indicate a problem.</p>
            <p><strong>Exchange balances:</strong> Net BTC balance per exchange is computed from all buys, sells, transfers, and donations. A negative balance may indicate missing import data.</p>
          </>
        }
      />

      {/* Summary Cards */}
      <div className="grid grid-cols-5 gap-4 mb-6">
        <div className="card">
          <div className="text-xs text-gray-500 mb-1">Matched</div>
          <div className="text-xl font-semibold text-green-600">{allConfirmedPairs.length}</div>
        </div>
        <div className="card">
          <div className="text-xs text-gray-500 mb-1">Flagged for Review</div>
          <div className={`text-xl font-semibold ${pendingFlagged.length > 0 ? "text-orange-500" : "text-green-600"}`}>
            {pendingFlagged.length}
          </div>
        </div>
        <div className="card">
          <div className="text-xs text-gray-500 mb-1">Unmatched Out</div>
          <div className={`text-xl font-semibold ${effectiveUnmatchedOuts.length > 0 ? "text-orange-500" : "text-green-600"}`}>
            {effectiveUnmatchedOuts.length}
          </div>
        </div>
        <div className="card">
          <div className="text-xs text-gray-500 mb-1">Unmatched In</div>
          <div className={`text-xl font-semibold ${effectiveUnmatchedIns.length > 0 ? "text-orange-500" : "text-green-600"}`}>
            {effectiveUnmatchedIns.length}
          </div>
        </div>
        <div className="card">
          <div className="text-xs text-gray-500 mb-1">Exchanges</div>
          <div className="text-xl font-semibold">{result.exchangeBalances.length}</div>
        </div>
      </div>

      {/* Exchange Balances */}
      <div className="card mb-6">
        <h3 className="font-semibold mb-3">Exchange Balances</h3>
        <div className="grid grid-cols-4 gap-2 text-xs font-semibold text-gray-500 pb-2 border-b border-gray-200 dark:border-gray-700">
          <div>Exchange</div>
          <div className="text-right">Total In (BTC)</div>
          <div className="text-right">Total Out (BTC)</div>
          <div className="text-right">Net Balance</div>
        </div>
        {result.exchangeBalances.map((b) => (
          <div key={b.exchange} className="grid grid-cols-4 gap-2 py-2 text-sm border-b border-gray-100 dark:border-gray-800">
            <div className="font-medium">{b.exchange}</div>
            <div className="text-right tabular-nums">{formatBTC(b.totalIn)}</div>
            <div className="text-right tabular-nums">{formatBTC(b.totalOut)}</div>
            <div className={`text-right tabular-nums font-medium ${b.netBalance < -0.00000001 ? "text-red-500" : "text-green-600"}`}>
              {formatBTC(b.netBalance)}
            </div>
          </div>
        ))}
      </div>

      {/* Flagged for Review */}
      {pendingFlagged.length > 0 && (
        <div className="card mb-6 border-l-4 border-l-orange-500">
          <h3 className="font-semibold mb-2 flex items-center gap-2">
            <span className="text-orange-500">⚠</span> Flagged for Review ({pendingFlagged.length})
          </h3>
          <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">
            These transfers were auto-matched but have an unusually high implied miner fee. Please verify they are the same transfer.
          </p>
          {pendingFlagged.map((pair) => (
            <div key={pairKey(pair)} className="flex items-center gap-3 py-2 text-sm border-b border-gray-100 dark:border-gray-800">
              <span className="text-orange-500">⚠</span>
              <span>{formatDate(pair.transferOut.date)}</span>
              <span className="font-medium">{pair.transferOut.exchange}</span>
              <span className="text-gray-400">→</span>
              <span className="font-medium">{pair.transferIn.exchange}</span>
              <span className="flex-1" />
              <span className="tabular-nums text-xs">
                {formatBTC(pair.transferOut.amountBTC)} → {formatBTC(pair.transferIn.amountBTC)}
              </span>
              <span className="text-orange-500 font-medium text-xs tabular-nums" title="Implied miner fee">
                Fee: {formatBTC(pair.impliedFeeBTC)}
              </span>
              <span className="text-xs text-gray-400">{pair.daysBetween}d</span>
              <button
                className="text-xs px-2 py-1 rounded bg-green-600 hover:bg-green-700 text-white"
                onClick={() => handleApproveFlag(pair)}
              >
                Approve
              </button>
              <button
                className="text-xs px-2 py-1 rounded bg-red-500 hover:bg-red-600 text-white"
                onClick={() => handleRejectFlag(pair)}
              >
                Reject
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Matched Transfers (confirmed) */}
      {allConfirmedPairs.length > 0 && (
        <div className="card mb-6">
          <h3 className="font-semibold mb-3">Matched Transfer Pairs ({allConfirmedPairs.length})</h3>
          {allConfirmedPairs.map((pair, i) => (
            <div key={i} className="flex items-center gap-3 py-2 text-sm border-b border-gray-100 dark:border-gray-800">
              <span className="text-green-500">✓</span>
              <span>{formatDate(pair.transferOut.date)}</span>
              <span className="font-medium">{pair.transferOut.exchange}</span>
              <span className="text-gray-400">→</span>
              <span className="font-medium">{pair.transferIn.exchange}</span>
              <span className="flex-1" />
              <span className="tabular-nums">{formatBTC(pair.amountBTC)} BTC</span>
              {pair.impliedFeeBTC > 0.00000001 && (
                <span className="text-xs text-gray-400 tabular-nums" title="Implied miner fee">
                  fee: {formatBTC(pair.impliedFeeBTC)}
                </span>
              )}
              <span className="text-xs text-gray-400">{pair.daysBetween}d</span>
            </div>
          ))}
        </div>
      )}

      {/* Unmatched Transfers + Manual Matching */}
      {(effectiveUnmatchedOuts.length > 0 || effectiveUnmatchedIns.length > 0) && (
        <div className="card mb-6">
          <h3 className="font-semibold mb-2">Unmatched Transfers</h3>
          <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">
            Unmatched outgoing transfers are common and usually not an issue — most are withdrawals to your own cold storage or self-custody wallet.
            You can manually match a pair by selecting one outgoing and one incoming transfer below.
          </p>

          {/* Manual match: two-column selection */}
          <div className="grid grid-cols-2 gap-4 mb-4">
            {/* Unmatched Outs */}
            <div>
              <div className="text-xs font-semibold text-gray-500 mb-2">Outgoing ({effectiveUnmatchedOuts.length})</div>
              {effectiveUnmatchedOuts.length === 0 ? (
                <p className="text-xs text-gray-400">None</p>
              ) : (
                effectiveUnmatchedOuts.map((t) => (
                  <UnmatchedRow
                    key={t.id}
                    transaction={t}
                    direction="out"
                    isSelected={selectedOutId === t.id}
                    onSelect={() => setSelectedOutId(selectedOutId === t.id ? null : t.id)}
                  />
                ))
              )}
            </div>

            {/* Unmatched Ins */}
            <div>
              <div className="text-xs font-semibold text-gray-500 mb-2">Incoming ({effectiveUnmatchedIns.length})</div>
              {effectiveUnmatchedIns.length === 0 ? (
                <p className="text-xs text-gray-400">None</p>
              ) : (
                effectiveUnmatchedIns.map((t) => (
                  <UnmatchedRow
                    key={t.id}
                    transaction={t}
                    direction="in"
                    isSelected={selectedInId === t.id}
                    onSelect={() => setSelectedInId(selectedInId === t.id ? null : t.id)}
                  />
                ))
              )}
            </div>
          </div>

          {/* Manual match confirmation bar */}
          {selectedOut && selectedIn && (
            <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 p-3 rounded-lg">
              <div className="flex items-center gap-3 text-sm flex-wrap">
                <span className="font-medium">{selectedOut.exchange}</span>
                <span className="text-gray-400">→</span>
                <span className="font-medium">{selectedIn.exchange}</span>
                <span className="text-gray-400">|</span>
                <span className="tabular-nums">{formatBTC(selectedOut.amountBTC)}</span>
                <span className="text-gray-400">→</span>
                <span className="tabular-nums">{formatBTC(selectedIn.amountBTC)}</span>
                <span className="text-gray-400">|</span>
                {(() => {
                  const fee = Math.max(0, selectedOut.amountBTC - selectedIn.amountBTC);
                  const isHighFee = fee > 0.0005;
                  const isNegative = selectedIn.amountBTC > selectedOut.amountBTC + 0.00000001;
                  return (
                    <span className={`tabular-nums font-medium text-xs ${isNegative ? "text-red-500" : isHighFee ? "text-orange-500" : "text-gray-600 dark:text-gray-400"}`}>
                      {isNegative ? "⚠ In > Out" : `Implied fee: ${formatBTC(fee)} BTC`}
                      {isHighFee && !isNegative && " ⚠ High"}
                    </span>
                  );
                })()}
                <span className="flex-1" />
                <button
                  className="btn-primary text-xs px-3 py-1"
                  onClick={handleManualMatch}
                >
                  Confirm Match
                </button>
                <button
                  className="btn-secondary text-xs px-3 py-1"
                  onClick={() => { setSelectedOutId(null); setSelectedInId(null); }}
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Lot Assignments — shows which lots were consumed by each sale */}
      <div className="card mb-6">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-semibold">Lot Assignments ({salesForYear.length + donationsForYear.length})</h3>
          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-500">Year:</span>
            <select className="select text-sm py-1 px-2" value={selectedYear} onChange={(e) => setSelectedYear(Number(e.target.value))}>
              {availableYears.map((y) => <option key={y} value={y}>{y}</option>)}
            </select>
          </div>
        </div>
        <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">
          Click a row to see which purchase lots were used to calculate cost basis for each sale or donation.
        </p>

        {salesForYear.length === 0 && donationsForYear.length === 0 ? (
          <p className="text-sm text-gray-400 py-4 text-center">No dispositions in {selectedYear}</p>
        ) : (
          <div>
            {/* Column headers */}
            <div className="grid grid-cols-[1fr_auto_auto_auto_auto_auto] gap-x-3 text-xs font-semibold text-gray-500 pb-2 border-b border-gray-200 dark:border-gray-700 px-2">
              <div>Sale / Donation</div>
              <div className="text-right">BTC</div>
              <div className="text-right">Proceeds</div>
              <div className="text-right">Cost Basis</div>
              <div className="text-right">Gain / Loss</div>
              <div className="text-right w-16">Method</div>
            </div>

            {[...salesForYear, ...donationsForYear].map((sale, idx) => {
              const txn = sale.sourceTransactionId ? txnById.get(sale.sourceTransactionId) : undefined;
              const saleWallet = txn?.wallet || txn?.exchange || "";
              const isExpanded = expandedSaleIdx === idx;
              return (
                <div key={sale.id || idx}>
                  {/* Sale summary row */}
                  <div
                    className={`grid grid-cols-[1fr_auto_auto_auto_auto_auto] gap-x-3 py-2.5 px-2 text-sm cursor-pointer rounded transition-colors ${isExpanded ? "bg-orange-50 dark:bg-orange-900/10" : "hover:bg-gray-50 dark:hover:bg-zinc-800/50"} border-b border-gray-100 dark:border-gray-800`}
                    onClick={() => setExpandedSaleIdx(isExpanded ? null : idx)}
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <span className={`text-xs transition-transform ${isExpanded ? "rotate-90" : ""}`}>▶</span>
                      <span className={`badge text-[10px] ${sale.isDonation ? "badge-purple" : "badge-orange"}`}>
                        {sale.isDonation ? "Donation" : "Sell"}
                      </span>
                      <span className="text-xs text-gray-500">{formatDate(sale.saleDate)}</span>
                      {saleWallet && <span className="text-xs text-gray-400 truncate">{saleWallet}</span>}
                      {sale.walletMismatch && <span className="text-yellow-500 text-xs" title="Wallet mismatch — lots came from a different wallet">⚠️</span>}
                    </div>
                    <div className="text-right tabular-nums">{formatBTC(sale.amountSold)}</div>
                    <div className="text-right tabular-nums">{sale.isDonation ? "—" : formatUSD(sale.totalProceeds)}</div>
                    <div className="text-right tabular-nums">{formatUSD(sale.costBasis)}</div>
                    <div className={`text-right tabular-nums font-medium ${sale.isDonation ? "text-gray-400" : sale.gainLoss >= 0 ? "text-green-600" : "text-red-500"}`}>
                      {sale.isDonation ? "—" : formatUSD(sale.gainLoss)}
                    </div>
                    <div className="text-right w-16">
                      <span className={`badge text-[10px] ${sale.method === AccountingMethod.SpecificID ? "badge-blue" : "badge-gray"}`}>
                        {sale.method === AccountingMethod.SpecificID ? "Specific ID" : "FIFO"}
                      </span>
                    </div>
                  </div>

                  {/* Expanded lot details */}
                  {isExpanded && sale.lotDetails.length > 0 && (
                    <div className="ml-6 mr-2 mb-2 border-l-2 border-orange-200 dark:border-orange-800 pl-3">
                      <div className="grid grid-cols-[1fr_auto_auto_auto_auto] gap-x-3 text-[10px] font-semibold text-gray-400 py-1">
                        <div>Source Lot</div>
                        <div className="text-right">BTC Used</div>
                        <div className="text-right">Cost Basis</div>
                        <div className="text-right">Days Held</div>
                        <div className="text-right">Term</div>
                      </div>
                      {sale.lotDetails.map((lot, li) => (
                        <div key={lot.id || li} className={`grid grid-cols-[1fr_auto_auto_auto_auto] gap-x-3 py-1.5 text-xs border-b border-gray-50 dark:border-gray-800/50 ${lot.isLongTerm ? "bg-green-50/30 dark:bg-green-900/5" : "bg-orange-50/30 dark:bg-orange-900/5"}`}>
                          <div className="flex items-center gap-2 min-w-0">
                            <span className="text-gray-400">↳</span>
                            <span className="text-gray-500">{formatDate(lot.purchaseDate)}</span>
                            <span className="text-gray-400 truncate">{lot.wallet || lot.exchange}</span>
                            <span className="text-gray-300 tabular-nums">@{formatUSD(lot.costBasisPerBTC)}/BTC</span>
                          </div>
                          <div className="text-right tabular-nums">{formatBTC(lot.amountBTC)}</div>
                          <div className="text-right tabular-nums">{formatUSD(lot.totalCost)}</div>
                          <div className="text-right tabular-nums text-gray-500">{lot.daysHeld}d</div>
                          <div className="text-right">
                            <span className={`badge text-[10px] ${lot.isLongTerm ? "badge-green" : "badge-orange"}`}>
                              {lot.isLongTerm ? "Long" : "Short"}
                            </span>
                          </div>
                        </div>
                      ))}
                      <div className="flex justify-end gap-4 pt-1.5 text-[10px] text-gray-400">
                        <span>{sale.lotDetails.length} lot{sale.lotDetails.length !== 1 ? "s" : ""} consumed</span>
                        <span>Total cost basis: {formatUSD(sale.costBasis)}</span>
                      </div>
                    </div>
                  )}
                  {isExpanded && sale.lotDetails.length === 0 && (
                    <div className="ml-6 mr-2 mb-2 py-2 text-xs text-gray-400 italic">No lot details recorded for this sale</div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Suggestions */}
      {result.suggestedMissing.length > 0 && (
        <div className="bg-yellow-50 dark:bg-yellow-900/20 p-4 rounded-lg">
          <h3 className="font-semibold mb-2 flex items-center gap-2"><span>💡</span> Suggestions</h3>
          <ul className="list-disc list-inside space-y-1 text-sm">
            {result.suggestedMissing.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

/** Unique key for a transfer pair (for Set tracking) */
function pairKey(pair: TransferPair): string {
  return `${pair.transferOut.id}|${pair.transferIn.id}`;
}

/** Selectable row for an unmatched transfer */
function UnmatchedRow({
  transaction,
  direction,
  isSelected,
  onSelect,
}: {
  transaction: Transaction;
  direction: "out" | "in";
  isSelected: boolean;
  onSelect: () => void;
}) {
  return (
    <div
      className={`flex items-center gap-2 py-2 px-2 text-sm border-b border-gray-100 dark:border-gray-800 cursor-pointer rounded ${
        isSelected ? "bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800" : "hover:bg-gray-50 dark:hover:bg-zinc-800/50"
      }`}
      onClick={onSelect}
    >
      <input
        type="radio"
        checked={isSelected}
        onChange={onSelect}
        className="accent-orange-500"
        onClick={(e) => e.stopPropagation()}
      />
      <span className={`badge ${direction === "out" ? "badge-orange" : "badge-blue"} text-xs`}>
        {direction === "out" ? "Out" : "In"}
      </span>
      <span className="text-xs">{formatDate(transaction.date)}</span>
      <span className="font-medium text-xs">{transaction.exchange}</span>
      <span className="flex-1" />
      <span className="tabular-nums text-xs">{formatBTC(transaction.amountBTC)}</span>
    </div>
  );
}
