import { useMemo } from "react";
import { useAppState } from "../lib/app-state";
import { reconcileTransfers } from "../lib/reconciliation";
import { formatBTC, formatDate } from "../lib/utils";

export function ReconciliationView() {
  const { allTransactions, setSelectedNav } = useAppState();

  const result = useMemo(() => reconcileTransfers(allTransactions), [allTransactions]);

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
      <p className="text-gray-500 mb-6">Match transfers between exchanges and identify missing data</p>

      {/* Summary Cards */}
      <div className="grid grid-cols-4 gap-4 mb-6">
        <div className="card">
          <div className="text-xs text-gray-500 mb-1">Matched Transfers</div>
          <div className="text-xl font-semibold text-green-600">{result.matchedTransfers.length}</div>
        </div>
        <div className="card">
          <div className="text-xs text-gray-500 mb-1">Unmatched Out</div>
          <div className={`text-xl font-semibold ${result.unmatchedTransferOuts.length > 0 ? "text-orange-500" : "text-green-600"}`}>
            {result.unmatchedTransferOuts.length}
          </div>
        </div>
        <div className="card">
          <div className="text-xs text-gray-500 mb-1">Unmatched In</div>
          <div className={`text-xl font-semibold ${result.unmatchedTransferIns.length > 0 ? "text-orange-500" : "text-green-600"}`}>
            {result.unmatchedTransferIns.length}
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

      {/* Matched Transfers */}
      {result.matchedTransfers.length > 0 && (
        <div className="card mb-6">
          <h3 className="font-semibold mb-3">Matched Transfer Pairs ({result.matchedTransfers.length})</h3>
          {result.matchedTransfers.map((pair, i) => (
            <div key={i} className="flex items-center gap-3 py-2 text-sm border-b border-gray-100 dark:border-gray-800">
              <span className="text-green-500">✓</span>
              <span>{formatDate(pair.transferOut.date)}</span>
              <span className="font-medium">{pair.transferOut.exchange}</span>
              <span className="text-gray-400">→</span>
              <span className="font-medium">{pair.transferIn.exchange}</span>
              <span className="flex-1" />
              <span className="tabular-nums">{formatBTC(pair.amountBTC)} BTC</span>
              <span className="text-xs text-gray-400">{pair.daysBetween}d</span>
            </div>
          ))}
        </div>
      )}

      {/* Unmatched Transfers */}
      {(result.unmatchedTransferOuts.length > 0 || result.unmatchedTransferIns.length > 0) && (
        <div className="card mb-6">
          <h3 className="font-semibold mb-3">Unmatched Transfers</h3>
          {result.unmatchedTransferOuts.map((t) => (
            <div key={t.id} className="flex items-center gap-3 py-2 text-sm border-b border-gray-100 dark:border-gray-800">
              <span className="text-orange-500">⚠</span>
              <span className="badge badge-orange text-xs">Out</span>
              <span>{formatDate(t.date)}</span>
              <span className="font-medium">{t.exchange}</span>
              <span className="flex-1" />
              <span className="tabular-nums">{formatBTC(t.amountBTC)} BTC</span>
            </div>
          ))}
          {result.unmatchedTransferIns.map((t) => (
            <div key={t.id} className="flex items-center gap-3 py-2 text-sm border-b border-gray-100 dark:border-gray-800">
              <span className="text-orange-500">⚠</span>
              <span className="badge badge-blue text-xs">In</span>
              <span>{formatDate(t.date)}</span>
              <span className="font-medium">{t.exchange}</span>
              <span className="flex-1" />
              <span className="tabular-nums">{formatBTC(t.amountBTC)} BTC</span>
            </div>
          ))}
        </div>
      )}

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
