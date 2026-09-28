import { useMemo, useState } from "react";
import { useAppState } from "../lib/app-state";
import { reconcileTransfers, MatchConfidence, TransferPair, transferPairKey, walletOf } from "../lib/reconciliation";
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
    addManualTransferMatch,
    removeManualTransferMatch,
    autoMatchTransfers,
    setAutoMatchTransfers,
    reconcileOptions,
  } = useAppState();

  // Manual matches, unmatched pairs and the auto-match switch are applied inside the matcher,
  // so a manual match can never be overridden or duplicated by an automatic one.
  const result = useMemo(() => reconcileTransfers(allTransactions, reconcileOptions), [allTransactions, reconcileOptions]);

  // Local selection state for manual matching UI (ephemeral)
  const [selectedOutId, setSelectedOutId] = useState<string | null>(null);
  const [selectedInId, setSelectedInId] = useState<string | null>(null);

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
  // Keyed by sale.id — an array index survives year switches and would silently
  // expand an unrelated row in the new year's list.
  const [expandedSaleId, setExpandedSaleId] = useState<string | null>(null);

  // Split auto-matched pairs by confidence. Unmatched (rejected) pairs are never formed.
  const confidentPairs = result.matchedTransfers.filter((p) => p.confidence === MatchConfidence.Confident);
  const flaggedPairs = result.matchedTransfers.filter((p) => p.confidence === MatchConfidence.Flagged);
  const pendingFlagged = flaggedPairs.filter((p) => reconciliationDecisions[pairKey(p)] !== "approved");
  const approvedFlaggedPairs = flaggedPairs.filter((p) => reconciliationDecisions[pairKey(p)] === "approved");

  // All confirmed matches for display, oldest first
  const allConfirmedPairs = [...confidentPairs, ...approvedFlaggedPairs, ...result.manualTransfers].sort(
    (a, b) => new Date(a.transferOut.date).getTime() - new Date(b.transferOut.date).getTime()
  );

  const ambiguousIds = useMemo(() => new Set(result.ambiguousTransferIds), [result.ambiguousTransferIds]);
  const unmatchedOuts = result.unmatchedTransferOuts;
  const unmatchedIns = result.unmatchedTransferIns;
  // A deposit with a source wallet is already accounted for — only the rest need attention
  const insNeedingSource = unmatchedIns.filter((t) => !t.sourceWallet?.trim());

  // Pairs the user unmatched whose transactions still exist — they stay out of auto-matching
  const userUnmatchedKeys = Object.entries(reconciliationDecisions)
    .filter(([key, decision]) => decision === "rejected" && key.split("|").every((id) => txnById.has(id)))
    .map(([key]) => key);

  // Manual match helpers
  const selectedOut = unmatchedOuts.find((t) => t.id === selectedOutId) ?? null;
  const selectedIn = unmatchedIns.find((t) => t.id === selectedInId) ?? null;

  const handleApproveFlag = (pair: TransferPair) => {
    setReconciliationDecision(pairKey(pair), "approved");
  };

  // Unmatch (any pair, auto or manual): both transfers move to the Unmatched list and
  // auto-matching leaves them alone, so the user can pair them by hand.
  const handleUnmatch = (pair: TransferPair) => {
    if (pair.manual) removeManualTransferMatch(pair.transferOut.id, pair.transferIn.id);
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

  const selectedPairWarnings = selectedOut && selectedIn ? pairWarnings(selectedOut, selectedIn) : [];

  return (
    <div className="p-8 max-w-5xl">
      <h1 className="text-3xl font-bold mb-1">Reconciliation</h1>
      <HelpPanel
        subtitle="Pair withdrawals (Transfer Out) with deposits (Transfer In) between your wallets, and check each wallet's balance."
        expandedContent={
          <>
            <p><strong>Your tax numbers don't depend on this page.</strong> Cost basis moves between wallets only through the <strong>source wallet</strong> assigned on each Transfer In (Transactions → Assign). Matching here builds your paper trail and powers the "Suggested" source wallet in Assign.</p>
            <p><strong>How matching works:</strong> A Transfer Out is paired with a Transfer In of the same amount (the received amount may be slightly less, for the miner fee) that arrives 0–7 days later in a different wallet. Wallets are compared using the Wallet field (or Exchange when Wallet is blank), so a move between two wallets under the same exchange or account label is matched too.</p>
            <p><strong>When several transfers fit:</strong> a deposit whose source wallet you assigned wins, then one labeled with the same account (same Exchange), then the smallest fee and fewest days. If two different pairings are still equally good — for example, two accounts sending the identical amount on the same day — nothing is guessed: those transfers stay unmatched and are marked <em>Ambiguous</em> for you to pair.</p>
            <p><strong>Flagged matches:</strong> Transfers with an unusually high implied miner fee (above 0.0005 BTC) are flagged for your review. You can approve or unmatch them.</p>
            <p><strong>Manual matching and Unmatch:</strong> Select one outgoing and one incoming transfer below to link them. Manual matches always take priority. <em>Unmatch</em> any pair to move both transfers to the Unmatched list — auto-match will leave them alone. Turn off <em>Auto-match transfers</em> to pair everything by hand.</p>
            <p><strong>Deposits with a source wallet (✓):</strong> already accounted for — the source wallet tells the tax engine where the coins came from, so a matching Transfer Out record is optional (though recording both sides gives the most complete paper trail).</p>
            <p><strong>Unmatched withdrawals:</strong> Withdrawals to a wallet you don't track here will appear as unmatched — this is normal and does not indicate a problem.</p>
            <p><strong>Wallet balances:</strong> Computed per wallet — the same wallets Holdings uses — from your records: buys and deposits add; sells, donations and withdrawals subtract. A Transfer In with a source wallet but no Transfer Out record counts as leaving that source wallet. A negative balance usually means missing buys or transfers.</p>
          </>
        }
      />

      {/* Auto-match switch */}
      <div className="card mb-6 flex items-start gap-4">
        <label className="flex items-center gap-2 cursor-pointer text-sm font-medium shrink-0 pt-0.5">
          <input
            type="checkbox"
            className="accent-orange-500"
            checked={autoMatchTransfers}
            onChange={(e) => setAutoMatchTransfers(e.target.checked)}
          />
          Auto-match transfers
        </label>
        <p className="text-xs text-gray-500 dark:text-gray-400">
          {autoMatchTransfers
            ? "On — withdrawals and deposits are paired when the amounts and dates line up. Manual matches always win, equally good pairings between different wallets are never guessed, and you can Unmatch any pair."
            : "Off — only the pairs you match by hand are used. Nothing is paired automatically."}
        </p>
      </div>

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
          <div className={`text-xl font-semibold ${unmatchedOuts.length > 0 ? "text-orange-500" : "text-green-600"}`}>
            {unmatchedOuts.length}
          </div>
        </div>
        <div className="card" title="Deposits with no matching withdrawal and no source wallet assigned">
          <div className="text-xs text-gray-500 mb-1">Unmatched In</div>
          <div className={`text-xl font-semibold ${insNeedingSource.length > 0 ? "text-orange-500" : "text-green-600"}`}>
            {insNeedingSource.length}
          </div>
        </div>
        <div className="card">
          <div className="text-xs text-gray-500 mb-1">Wallets</div>
          <div className="text-xl font-semibold">{result.walletBalances.length}</div>
        </div>
      </div>

      {/* Wallet Balances */}
      <div className="card mb-6">
        <h3 className="font-semibold mb-1">Wallet Balances</h3>
        <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">
          From your transaction records, per wallet (the same wallets as Holdings). When every transfer is recorded consistently these match your Holdings.
        </p>
        <div className="grid grid-cols-4 gap-2 text-xs font-semibold text-gray-500 pb-2 border-b border-gray-200 dark:border-gray-700">
          <div>Wallet</div>
          <div className="text-right">Total In (BTC)</div>
          <div className="text-right">Total Out (BTC)</div>
          <div className="text-right">Net Balance</div>
        </div>
        {result.walletBalances.map((b) => (
          <div key={b.wallet.toLowerCase()} className="grid grid-cols-4 gap-2 py-2 text-sm border-b border-gray-100 dark:border-gray-800">
            <div className="font-medium">{b.wallet || "(no wallet)"}</div>
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
            <PairRow key={pairKey(pair)} pair={pair} flagged>
              <button
                className="text-xs px-2 py-1 rounded bg-green-600 hover:bg-green-700 text-white"
                onClick={() => handleApproveFlag(pair)}
              >
                Approve
              </button>
              <button
                className="text-xs px-2 py-1 rounded bg-red-500 hover:bg-red-600 text-white"
                title="Not the same transfer — move both to the Unmatched list"
                onClick={() => handleUnmatch(pair)}
              >
                Unmatch
              </button>
            </PairRow>
          ))}
        </div>
      )}

      {/* Matched Transfers (confirmed) */}
      {allConfirmedPairs.length > 0 && (
        <div className="card mb-6">
          <h3 className="font-semibold mb-3">Matched Transfer Pairs ({allConfirmedPairs.length})</h3>
          {allConfirmedPairs.map((pair) => (
            <PairRow key={pairKey(pair)} pair={pair}>
              <button
                className="text-xs text-red-400 hover:text-red-600"
                title="Not the same transfer — move both to the Unmatched list, where auto-match will leave them alone"
                onClick={() => handleUnmatch(pair)}
              >
                Unmatch
              </button>
            </PairRow>
          ))}
        </div>
      )}

      {/* Unmatched Transfers + Manual Matching */}
      {(unmatchedOuts.length > 0 || unmatchedIns.length > 0) && (
        <div className="card mb-6">
          <h3 className="font-semibold mb-2">Unmatched Transfers</h3>
          <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">
            Unmatched outgoing transfers are common and usually not an issue — most are withdrawals to a wallet you don't track here.
            Deposits marked ✓ already have a source wallet, so their cost basis moves with them.
            To link a withdrawal to its deposit, select one of each below.
          </p>
          {userUnmatchedKeys.length > 0 && (
            <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">
              You unmatched {userUnmatchedKeys.length} pair{userUnmatchedKeys.length === 1 ? "" : "s"}; those transfers are kept out of auto-matching.{" "}
              <button
                className="underline text-orange-500 hover:text-orange-400"
                onClick={() => userUnmatchedKeys.forEach((key) => setReconciliationDecision(key, null))}
              >
                Let auto-match pair them again
              </button>
            </p>
          )}

          {/* Manual match: two-column selection */}
          <div className="grid grid-cols-2 gap-4 mb-4">
            {/* Unmatched Outs */}
            <div>
              <div className="text-xs font-semibold text-gray-500 mb-2">Outgoing ({unmatchedOuts.length})</div>
              {unmatchedOuts.length === 0 ? (
                <p className="text-xs text-gray-400">None</p>
              ) : (
                unmatchedOuts.map((t) => (
                  <UnmatchedRow
                    key={t.id}
                    transaction={t}
                    direction="out"
                    ambiguous={ambiguousIds.has(t.id)}
                    isSelected={selectedOutId === t.id}
                    onSelect={() => setSelectedOutId(selectedOutId === t.id ? null : t.id)}
                  />
                ))
              )}
            </div>

            {/* Unmatched Ins */}
            <div>
              <div className="text-xs font-semibold text-gray-500 mb-2">Incoming ({unmatchedIns.length})</div>
              {unmatchedIns.length === 0 ? (
                <p className="text-xs text-gray-400">None</p>
              ) : (
                unmatchedIns.map((t) => (
                  <UnmatchedRow
                    key={t.id}
                    transaction={t}
                    direction="in"
                    ambiguous={ambiguousIds.has(t.id)}
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
                <WalletLabel t={selectedOut} />
                <span className="text-gray-400">→</span>
                <WalletLabel t={selectedIn} />
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
              {selectedPairWarnings.map((w) => (
                <p key={w} className="text-xs text-orange-600 dark:text-orange-400 mt-2">⚠ {w}</p>
              ))}
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
              const isExpanded = expandedSaleId === sale.id;
              return (
                <div key={sale.id || idx}>
                  {/* Sale summary row */}
                  <div
                    className={`grid grid-cols-[1fr_auto_auto_auto_auto_auto] gap-x-3 py-2.5 px-2 text-sm cursor-pointer rounded transition-colors ${isExpanded ? "bg-orange-50 dark:bg-orange-900/10" : "hover:bg-gray-50 dark:hover:bg-zinc-800/50"} border-b border-gray-100 dark:border-gray-800`}
                    onClick={() => setExpandedSaleId(isExpanded ? null : sale.id)}
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

/** Unique key for a transfer pair (for Set tracking and persisted decisions) */
function pairKey(pair: TransferPair): string {
  return transferPairKey(pair.transferOut.id, pair.transferIn.id);
}

const norm = (s: string | undefined) => (s ?? "").trim().toLowerCase();

/**
 * Bookkeeping problems in a (proposed) pair that would make the paper trail disagree with the
 * cost-basis engine. Empty when the pair is consistent.
 */
function pairWarnings(out: Transaction, inp: Transaction): string[] {
  const warnings: string[] = [];
  if (norm(walletOf(out)) === norm(walletOf(inp))) {
    warnings.push(
      `Both sides are in "${walletOf(inp)}". A Transfer Out's Wallet should be the wallet the coins left; the Transfer In's Wallet is where they arrived.`
    );
  }
  const source = norm(inp.sourceWallet);
  if (source && source !== norm(walletOf(out)) && source !== norm(out.exchange)) {
    warnings.push(
      `The deposit's assigned source wallet is "${inp.sourceWallet}", but this withdrawal is from "${walletOf(out)}". Cost basis follows the source wallet — update one of them so they agree.`
    );
  }
  return warnings;
}

/** Wallet name, with the exchange/account label when it differs */
function WalletLabel({ t }: { t: Transaction }) {
  const wallet = walletOf(t);
  const showExchange = !!t.exchange && norm(t.exchange) !== norm(wallet);
  return (
    <span className="min-w-0 truncate" title={showExchange ? `Wallet: ${wallet} · Exchange: ${t.exchange}` : `Wallet: ${wallet}`}>
      <span className="font-medium">{wallet || "—"}</span>
      {showExchange && <span className="text-xs text-gray-400 ml-1">({t.exchange})</span>}
    </span>
  );
}

/** One matched (or flagged) pair: date, from → to wallets, amount, fee, days, actions */
function PairRow({ pair, flagged, children }: { pair: TransferPair; flagged?: boolean; children?: React.ReactNode }) {
  const warnings = pairWarnings(pair.transferOut, pair.transferIn);
  return (
    <div className="py-2 text-sm border-b border-gray-100 dark:border-gray-800">
      <div className="flex items-center gap-3">
        <span className={flagged ? "text-orange-500" : "text-green-500"}>{flagged ? "⚠" : "✓"}</span>
        <span className="shrink-0">{formatDate(pair.transferOut.date)}</span>
        <WalletLabel t={pair.transferOut} />
        <span className="text-gray-400">→</span>
        <WalletLabel t={pair.transferIn} />
        {pair.manual && <span className="badge badge-blue text-[10px]">Manual</span>}
        <span className="flex-1" />
        {flagged ? (
          <span className="tabular-nums text-xs">
            {formatBTC(pair.transferOut.amountBTC)} → {formatBTC(pair.transferIn.amountBTC)}
          </span>
        ) : (
          <span className="tabular-nums">{formatBTC(pair.amountBTC)} BTC</span>
        )}
        {(flagged || pair.impliedFeeBTC > 0.00000001) && (
          <span className={`tabular-nums text-xs ${flagged ? "text-orange-500 font-medium" : "text-gray-400"}`} title="Implied miner fee">
            {flagged ? "Fee" : "fee"}: {formatBTC(pair.impliedFeeBTC)}
          </span>
        )}
        <span className="text-xs text-gray-400">{pair.daysBetween}d</span>
        {children}
      </div>
      {warnings.map((w) => (
        <p key={w} className="text-xs text-orange-600 dark:text-orange-400 mt-1 ml-6">⚠ {w}</p>
      ))}
    </div>
  );
}

/** Selectable row for an unmatched transfer */
function UnmatchedRow({
  transaction,
  direction,
  ambiguous,
  isSelected,
  onSelect,
}: {
  transaction: Transaction;
  direction: "out" | "in";
  ambiguous: boolean;
  isSelected: boolean;
  onSelect: () => void;
}) {
  const source = direction === "in" ? transaction.sourceWallet?.trim() : undefined;
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
        className="accent-orange-500 shrink-0"
        onClick={(e) => e.stopPropagation()}
      />
      <span className={`badge ${direction === "out" ? "badge-orange" : "badge-blue"} text-xs shrink-0`}>
        {direction === "out" ? "Out" : "In"}
      </span>
      <span className="text-xs shrink-0">{formatDate(transaction.date)}</span>
      {/* The wallet label gives way (truncates) so the status badges always stay visible */}
      <span className="text-xs min-w-0 flex-1 truncate"><WalletLabel t={transaction} /></span>
      {ambiguous && (
        <span
          className="badge text-[10px] shrink-0 bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-400"
          title="Another transfer with the same amount and date from a different wallet fits equally well, so this one wasn't matched automatically. Pair it manually."
        >
          Ambiguous
        </span>
      )}
      {source && (
        <span className="text-[10px] shrink-0 text-green-600 dark:text-green-400" title={`Source wallet assigned: ${source}`}>
          ✓ from {source}
        </span>
      )}
      <span className="tabular-nums text-xs shrink-0">{formatBTC(transaction.amountBTC)}</span>
    </div>
  );
}
