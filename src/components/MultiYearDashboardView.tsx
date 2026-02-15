import { useMemo } from "react";
import { useAppState } from "../lib/app-state";
import { calculate } from "../lib/cost-basis";
import { formatUSD } from "../lib/utils";
import { AccountingMethod } from "../lib/types";
import { HelpPanel } from "./HelpPanel";

interface YearSummary {
  year: number;
  stGL: number;
  ltGL: number;
  totalGL: number;
  salesCount: number;
}

export function MultiYearDashboardView() {
  const { allTransactions, selectedMethod, setSelectedNav } = useAppState();

  const yearSummaries = useMemo(() => {
    const result = calculate(allTransactions, selectedMethod);
    const byYear: Record<number, YearSummary> = {};

    for (const sale of result.sales) {
      const year = new Date(sale.saleDate).getFullYear();
      if (!byYear[year]) {
        byYear[year] = { year, stGL: 0, ltGL: 0, totalGL: 0, salesCount: 0 };
      }
      byYear[year].totalGL += sale.gainLoss;
      byYear[year].salesCount++;
      // Split ST/LT from lot details to handle mixed-term sales correctly
      for (const d of sale.lotDetails) {
        const lotGL = d.amountBTC * sale.salePricePerBTC - d.totalCost;
        if (d.isLongTerm) {
          byYear[year].ltGL += lotGL;
        } else {
          byYear[year].stGL += lotGL;
        }
      }
    }

    return Object.values(byYear).sort((a, b) => a.year - b.year);
  }, [allTransactions, selectedMethod]);

  const lifetimeTotal = yearSummaries.reduce((a, y) => a + y.totalGL, 0);
  const lifetimeST = yearSummaries.reduce((a, y) => a + y.stGL, 0);
  const lifetimeLT = yearSummaries.reduce((a, y) => a + y.ltGL, 0);
  const totalSales = yearSummaries.reduce((a, y) => a + y.salesCount, 0);

  if (allTransactions.length === 0 || yearSummaries.length === 0) {
    return (
      <div className="p-8 flex flex-col items-center justify-center h-full">
        <div className="text-5xl mb-4 opacity-50">📅</div>
        <h2 className="text-xl text-gray-500 mb-2">No data to display</h2>
        <p className="text-gray-400 mb-4">Import transactions with sales to see multi-year analysis</p>
        <button className="btn-secondary" onClick={() => setSelectedNav("import")}>Go to Import</button>
      </div>
    );
  }

  const maxAbs = Math.max(...yearSummaries.map((y) => Math.abs(y.totalGL)), 1);

  return (
    <div className="p-8 max-w-5xl">
      <h1 className="text-3xl font-bold mb-1">Multi-Year Dashboard</h1>
      <HelpPanel subtitle={`Lifetime capital gains and losses across all tax years using ${selectedMethod}.`} />

      {/* Bar Chart */}
      <div className="card mb-6">
        <div className="flex items-end justify-center gap-6 h-56 pt-4">
          {yearSummaries.map((y) => {
            const height = Math.abs(y.totalGL) / maxAbs * 150;
            const isGain = y.totalGL >= 0;
            return (
              <div key={y.year} className="flex flex-col items-center">
                <span className={`text-sm font-medium tabular-nums mb-1 ${isGain ? "text-green-600" : "text-red-500"}`}>
                  {y.totalGL >= 0 ? "+" : ""}{formatUSD(y.totalGL)}
                </span>
                <div
                  className={`w-16 rounded-t ${isGain ? "bg-green-500" : "bg-red-500"}`}
                  style={{ height: `${Math.max(height, 4)}px` }}
                />
                <div className="text-sm font-semibold mt-2">{y.year}</div>
                <div className="text-xs text-gray-400">{y.salesCount} sales</div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Table */}
      <div className="card mb-6">
        <div className="grid grid-cols-5 gap-4 text-xs font-semibold text-gray-500 pb-2 border-b border-gray-200 dark:border-gray-700">
          <div>Year</div>
          <div className="text-right">Short-term G/L</div>
          <div className="text-right">Long-term G/L</div>
          <div className="text-right">Total G/L</div>
          <div className="text-right"># Sales</div>
        </div>

        {yearSummaries.map((y, i) => {
          const prevYear = i > 0 ? yearSummaries[i - 1] : null;
          const delta = prevYear ? y.totalGL - prevYear.totalGL : null;
          return (
            <div key={y.year} className="grid grid-cols-5 gap-4 py-2 text-sm border-b border-gray-100 dark:border-gray-800">
              <div className="font-medium">{y.year}</div>
              <div className={`text-right tabular-nums ${y.stGL >= 0 ? "text-green-600" : "text-red-500"}`}>
                {y.stGL >= 0 ? "+" : ""}{formatUSD(y.stGL)}
              </div>
              <div className={`text-right tabular-nums ${y.ltGL >= 0 ? "text-green-600" : "text-red-500"}`}>
                {y.ltGL >= 0 ? "+" : ""}{formatUSD(y.ltGL)}
              </div>
              <div className="text-right">
                <span className={`tabular-nums font-medium ${y.totalGL >= 0 ? "text-green-600" : "text-red-500"}`}>
                  {y.totalGL >= 0 ? "+" : ""}{formatUSD(y.totalGL)}
                </span>
                {delta !== null && (
                  <span className={`text-xs ml-1 ${delta >= 0 ? "text-green-500" : "text-red-400"}`}>
                    ({delta >= 0 ? "+" : ""}{formatUSD(delta)})
                  </span>
                )}
              </div>
              <div className="text-right tabular-nums">{y.salesCount}</div>
            </div>
          );
        })}

        {/* Lifetime totals */}
        <div className="grid grid-cols-5 gap-4 py-2 text-sm font-bold border-t-2 border-gray-300 dark:border-gray-600">
          <div>Lifetime</div>
          <div className={`text-right tabular-nums ${lifetimeST >= 0 ? "text-green-600" : "text-red-500"}`}>
            {lifetimeST >= 0 ? "+" : ""}{formatUSD(lifetimeST)}
          </div>
          <div className={`text-right tabular-nums ${lifetimeLT >= 0 ? "text-green-600" : "text-red-500"}`}>
            {lifetimeLT >= 0 ? "+" : ""}{formatUSD(lifetimeLT)}
          </div>
          <div className={`text-right tabular-nums ${lifetimeTotal >= 0 ? "text-green-600" : "text-red-500"}`}>
            {lifetimeTotal >= 0 ? "+" : ""}{formatUSD(lifetimeTotal)}
          </div>
          <div className="text-right tabular-nums">{totalSales}</div>
        </div>
      </div>
    </div>
  );
}
