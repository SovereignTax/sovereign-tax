import { useMemo } from "react";
import { useAppState } from "../lib/app-state";
import { calculate } from "../lib/cost-basis";
import { formatUSD } from "../lib/utils";
import { AccountingMethod, AccountingMethodDisplayNames } from "../lib/types";

interface MethodResult {
  method: AccountingMethod;
  totalGL: number;
  stGL: number;
  ltGL: number;
  salesCount: number;
}

export function ComparisonView() {
  const { allTransactions, selectedYear, setSelectedYear, availableYears, setSelectedNav } = useAppState();

  // Exclude SpecificID from auto-comparison (requires manual lot selection)
  const comparableMethods = Object.values(AccountingMethod).filter((m) => m !== AccountingMethod.SpecificID);

  const results: MethodResult[] = useMemo(() => {
    return comparableMethods.map((method) => {
      const calc = calculate(allTransactions, method);
      const salesForYear = calc.sales.filter((s) => new Date(s.saleDate).getFullYear() === selectedYear);
      return {
        method,
        totalGL: salesForYear.reduce((a, s) => a + s.gainLoss, 0),
        stGL: salesForYear.filter((s) => !s.isLongTerm).reduce((a, s) => a + s.gainLoss, 0),
        ltGL: salesForYear.filter((s) => s.isLongTerm).reduce((a, s) => a + s.gainLoss, 0),
        salesCount: salesForYear.length,
      };
    });
  }, [allTransactions, selectedYear, comparableMethods]);

  const bestMethod = results.reduce((best, r) => (r.totalGL < best.totalGL ? r : best), results[0]);

  if (allTransactions.length === 0) {
    return (
      <div className="p-8 flex flex-col items-center justify-center h-full">
        <div className="text-5xl mb-4 opacity-50">⚖️</div>
        <h2 className="text-xl text-gray-500 mb-2">No data to compare</h2>
        <p className="text-gray-400 mb-4">Import transactions first</p>
        <button className="btn-secondary" onClick={() => setSelectedNav("import")}>Go to Import</button>
      </div>
    );
  }

  return (
    <div className="p-8 max-w-5xl">
      <h1 className="text-3xl font-bold mb-6">Compare Methods</h1>

      <div className="flex items-center gap-3 mb-6">
        <span className="text-gray-500">Tax Year:</span>
        <select className="select" value={selectedYear} onChange={(e) => setSelectedYear(Number(e.target.value))}>
          {availableYears.map((y) => <option key={y} value={y}>{y}</option>)}
        </select>
      </div>

      {/* Bar chart visualization */}
      <div className="card mb-6">
        <div className="flex items-end justify-center gap-8 h-56 pt-4">
          {results.map((r) => {
            const maxAbs = Math.max(...results.map((x) => Math.abs(x.totalGL)), 1);
            const height = Math.abs(r.totalGL) / maxAbs * 150;
            const isGain = r.totalGL >= 0;
            return (
              <div key={r.method} className="flex flex-col items-center">
                <span className={`text-sm font-medium tabular-nums mb-1 ${isGain ? "text-green-600" : "text-red-500"}`}>
                  {formatUSD(r.totalGL)}
                </span>
                <div
                  className={`w-20 rounded-t ${isGain ? "bg-green-500" : "bg-red-500"}`}
                  style={{ height: `${Math.max(height, 4)}px` }}
                />
                <div className="text-sm font-semibold mt-2">{r.method}</div>
                <div className="text-xs text-gray-500">{AccountingMethodDisplayNames[r.method]}</div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Comparison table */}
      <div className="card mb-6">
        <div className="grid grid-cols-4 gap-4">
          <div></div>
          {results.map((r) => (
            <div key={r.method} className="text-center">
              <div className="font-semibold">{r.method}</div>
              <div className="text-xs text-gray-500">{AccountingMethodDisplayNames[r.method]}</div>
            </div>
          ))}
        </div>
        <div className="border-t my-3" />

        <CompRow label="Total Gain/Loss" values={results.map((r) => ({ value: r.totalGL, isBest: r.method === bestMethod.method }))} />
        <CompRow label="Short-term" values={results.map((r) => ({ value: r.stGL }))} />
        <CompRow label="Long-term" values={results.map((r) => ({ value: r.ltGL }))} />
        <div className="grid grid-cols-4 gap-4 py-2">
          <div className="text-gray-500"># Sales</div>
          {results.map((r) => <div key={r.method} className="text-center tabular-nums">{r.salesCount}</div>)}
        </div>
      </div>

      {/* Recommendation */}
      <div className="bg-yellow-50 dark:bg-yellow-900/20 p-4 rounded-lg flex items-center gap-3">
        <span className="text-xl">💡</span>
        <span>
          <strong>{AccountingMethodDisplayNames[bestMethod.method]} ({bestMethod.method})</strong> produces the lowest taxable gain for {selectedYear}.
        </span>
      </div>
    </div>
  );
}

function CompRow({ label, values }: { label: string; values: { value: number; isBest?: boolean }[] }) {
  return (
    <div className="grid grid-cols-4 gap-4 py-2">
      <div className="text-gray-500">{label}</div>
      {values.map((v, i) => (
        <div key={i} className={`text-center tabular-nums ${v.isBest ? "font-bold" : ""} ${v.value >= 0 ? "text-green-600" : "text-red-500"}`}>
          {v.value >= 0 ? "+" : ""}{formatUSD(v.value)}
        </div>
      ))}
    </div>
  );
}
