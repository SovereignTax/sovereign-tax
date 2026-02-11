import { useMemo } from "react";
import { useAppState } from "../lib/app-state";
import { formatUSD, formatBTC, formatDate } from "../lib/utils";
import { TransactionType, IncomeType, IncomeTypeDisplayNames } from "../lib/types";
import { exportIncomeCSV } from "../lib/export";

export function IncomeView() {
  const { allTransactions, selectedYear, setSelectedYear, availableYears } = useAppState();

  const incomeTransactions = useMemo(() => {
    return allTransactions.filter(
      (t) => t.incomeType && t.transactionType === TransactionType.Buy && new Date(t.date).getFullYear() === selectedYear
    );
  }, [allTransactions, selectedYear]);

  const byType = useMemo(() => {
    const groups: Record<string, typeof incomeTransactions> = {};
    for (const t of incomeTransactions) {
      const key = t.incomeType || "unknown";
      if (!groups[key]) groups[key] = [];
      groups[key].push(t);
    }
    return groups;
  }, [incomeTransactions]);

  const totalIncome = incomeTransactions.reduce((a, t) => a + t.totalUSD, 0);
  const totalBTC = incomeTransactions.reduce((a, t) => a + t.amountBTC, 0);

  const downloadCSV = (content: string, filename: string) => {
    const blob = new Blob([content], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="p-8 max-w-5xl">
      <h1 className="text-3xl font-bold mb-1">Income</h1>
      <p className="text-gray-500 mb-6">Mining, rewards, and other ordinary income (Schedule 1)</p>

      {/* Controls */}
      <div className="flex items-center gap-6 mb-6">
        <div className="flex items-center gap-2">
          <span className="text-gray-500">Tax Year:</span>
          <select className="select" value={selectedYear} onChange={(e) => setSelectedYear(Number(e.target.value))}>
            {availableYears.map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
        </div>
        {incomeTransactions.length > 0 && (
          <button
            className="btn-secondary"
            onClick={() => downloadCSV(exportIncomeCSV(allTransactions, selectedYear), `income_${selectedYear}.csv`)}
          >
            📊 Export Income CSV
          </button>
        )}
      </div>

      {incomeTransactions.length === 0 ? (
        <div className="text-center py-16">
          <div className="text-5xl mb-4 opacity-50">💰</div>
          <h2 className="text-xl text-gray-500">No income transactions in {selectedYear}</h2>
          <p className="text-gray-400 mt-2">Mining, rewards, and other income will appear here when imported</p>
        </div>
      ) : (
        <>
          {/* Summary Cards */}
          <div className="grid grid-cols-3 gap-4 mb-6">
            <div className="card">
              <div className="flex items-center gap-2 mb-2">
                <span className="text-orange-500">₿</span>
                <span className="text-xs text-gray-500">Total BTC Received</span>
              </div>
              <div className="text-xl font-semibold tabular-nums">{formatBTC(totalBTC)}</div>
            </div>
            <div className="card">
              <div className="flex items-center gap-2 mb-2">
                <span className="text-green-500">💲</span>
                <span className="text-xs text-gray-500">Total Fair Market Value</span>
              </div>
              <div className="text-xl font-semibold tabular-nums">{formatUSD(totalIncome)}</div>
            </div>
            <div className="card">
              <div className="flex items-center gap-2 mb-2">
                <span className="text-blue-500">📋</span>
                <span className="text-xs text-gray-500">Transactions</span>
              </div>
              <div className="text-xl font-semibold tabular-nums">{incomeTransactions.length}</div>
            </div>
          </div>

          {/* By Type */}
          {Object.entries(byType).map(([type, txns]) => (
            <div key={type} className="card mb-4">
              <h3 className="font-semibold mb-3">
                {IncomeTypeDisplayNames[type as IncomeType] || type}
                <span className="text-gray-400 text-sm font-normal ml-2">
                  ({txns.length} transactions — {formatUSD(txns.reduce((a, t) => a + t.totalUSD, 0))})
                </span>
              </h3>
              <div className="grid grid-cols-5 gap-2 text-xs font-semibold text-gray-500 pb-2 border-b border-gray-200 dark:border-gray-700">
                <div>Date</div>
                <div className="text-right">BTC Amount</div>
                <div className="text-right">FMV (USD)</div>
                <div>Exchange</div>
                <div>Notes</div>
              </div>
              {txns
                .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
                .map((t) => (
                  <div key={t.id} className="grid grid-cols-5 gap-2 py-2 text-sm border-b border-gray-100 dark:border-gray-800">
                    <div>{formatDate(t.date)}</div>
                    <div className="text-right tabular-nums">{formatBTC(t.amountBTC)}</div>
                    <div className="text-right tabular-nums">{formatUSD(t.totalUSD)}</div>
                    <div className="truncate">{t.exchange}</div>
                    <div className="truncate text-gray-400">{t.notes || "—"}</div>
                  </div>
                ))}
            </div>
          ))}

          {/* IRS Note */}
          <div className="bg-yellow-50 dark:bg-yellow-900/20 p-4 rounded-lg flex items-start gap-3">
            <span className="text-xl">⚠️</span>
            <div className="text-sm">
              <strong>IRS Note:</strong> Mining, rewards, and other crypto income are taxed as ordinary income
              at the fair market value on the date received. Report on Schedule 1 (Form 1040). The cost basis of
              these tokens equals the FMV at receipt for future capital gains calculations.
            </div>
          </div>
        </>
      )}
    </div>
  );
}
