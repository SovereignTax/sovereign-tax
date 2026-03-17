import { useMemo, useState, useEffect } from "react";
import { useAppState } from "../lib/app-state";
import { calculate, batchOptimizeSpecificId } from "../lib/cost-basis";
import { formatUSD } from "../lib/utils";
import { AccountingMethod } from "../lib/types";
import { HelpPanel } from "./HelpPanel";

interface MethodResult {
  label: string;
  description: string;
  totalGL: number;
  stGL: number;
  ltGL: number;
  salesCount: number;
}

export function ComparisonView() {
  const { allTransactions, selectedYear, setSelectedYear, availableYears, setSelectedNav, recordedSales } = useAppState();

  const [results, setResults] = useState<MethodResult[] | null>(null);
  const [computing, setComputing] = useState(false);

  useEffect(() => {
    setComputing(true);
    setResults(null);
    // Defer heavy computation to next frame so the loading state renders first
    const id = requestAnimationFrame(() => {
      // 1. FIFO baseline (no Specific ID records — pure FIFO for all sells)
      const fifoCalc = calculate(allTransactions, AccountingMethod.FIFO);
      const fifoSales = fifoCalc.sales.filter((s) => new Date(s.saleDate).getFullYear() === selectedYear);
      const fifoTaxable = fifoSales.filter((s) => !s.isDonation);
      const fifo: MethodResult = {
        label: "FIFO",
        description: "First In, First Out — IRS default",
        totalGL: fifoSales.reduce((a, s) => a + s.gainLoss, 0),
        stGL: fifoTaxable.reduce((a, s) => a + s.lotDetails.filter((d) => !d.isLongTerm).reduce((sum, d) => sum + (d.amountBTC * s.salePricePerBTC - d.totalCost), 0), 0),
        ltGL: fifoTaxable.reduce((a, s) => a + s.lotDetails.filter((d) => d.isLongTerm).reduce((sum, d) => sum + (d.amountBTC * s.salePricePerBTC - d.totalCost), 0), 0),
        salesCount: fifoTaxable.length,
      };

      // 2. Optimal Specific ID — batch optimize all sells for the year
      const { records: optRecords } = batchOptimizeSpecificId(allTransactions, [], selectedYear);
      const optCalc = calculate(allTransactions, AccountingMethod.FIFO, optRecords);
      const optSales = optCalc.sales.filter((s) => new Date(s.saleDate).getFullYear() === selectedYear);
      const optTaxable = optSales.filter((s) => !s.isDonation);
      const optimal: MethodResult = {
        label: "Optimal Specific ID",
        description: "Auto-selected lots to minimize tax",
        totalGL: optSales.reduce((a, s) => a + s.gainLoss, 0),
        stGL: optTaxable.reduce((a, s) => a + s.lotDetails.filter((d) => !d.isLongTerm).reduce((sum, d) => sum + (d.amountBTC * s.salePricePerBTC - d.totalCost), 0), 0),
        ltGL: optTaxable.reduce((a, s) => a + s.lotDetails.filter((d) => d.isLongTerm).reduce((sum, d) => sum + (d.amountBTC * s.salePricePerBTC - d.totalCost), 0), 0),
        salesCount: optTaxable.length,
      };

      setResults([fifo, optimal]);
      setComputing(false);
    });
    return () => cancelAnimationFrame(id);
  }, [allTransactions, selectedYear]);

  const savings = results ? results[0].totalGL - results[1].totalGL : 0;

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

  if (!results || computing) {
    return (
      <div className="p-8 max-w-5xl">
        <h1 className="text-3xl font-bold mb-1">Compare Methods</h1>
        <div className="flex flex-col items-center justify-center py-20">
          <div className="text-4xl mb-4 animate-pulse">⚖️</div>
          <p className="text-gray-500">Calculating optimal lot selections...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-8 max-w-5xl">
      <h1 className="text-3xl font-bold mb-1">Compare Methods</h1>
      <HelpPanel
        subtitle="Compare FIFO vs Optimal Specific ID to see which method saves you more on taxes."
        expandedContent={
          <>
            <p><strong>FIFO (First In, First Out):</strong> Sells oldest lots first. This is the IRS default method when specific lots are not identified.</p>
            <p><strong>Optimal Specific ID:</strong> Automatically selects the best lots for each sale to minimize your total tax. Prioritizes losses first, then the smallest gains.</p>
            <p>To apply Specific ID to your transactions, go to Transactions and use the <strong>Optimize All</strong> button or assign lots individually.</p>
          </>
        }
      />

      <div className="flex items-center gap-3 mb-6">
        <span className="text-gray-500">Tax Year:</span>
        <select className="select" value={selectedYear} onChange={(e) => setSelectedYear(Number(e.target.value))}>
          {availableYears.map((y) => <option key={y} value={y}>{y}</option>)}
        </select>
      </div>

      {/* Bar chart visualization */}
      <div className="card mb-6">
        <div className="flex items-end justify-center gap-16 h-56 pt-4">
          {results.map((r) => {
            const maxAbs = Math.max(...results.map((x) => Math.abs(x.totalGL)), 1);
            const height = Math.abs(r.totalGL) / maxAbs * 150;
            const isGain = r.totalGL >= 0;
            return (
              <div key={r.label} className="flex flex-col items-center">
                <span className={`text-sm font-medium tabular-nums mb-1 ${isGain ? "text-green-600" : "text-red-500"}`}>
                  {isGain ? "+" : ""}{formatUSD(r.totalGL)}
                </span>
                <div
                  className={`w-24 rounded-t ${isGain ? "bg-green-500" : "bg-red-500"}`}
                  style={{ height: `${Math.max(height, 4)}px` }}
                />
                <div className="text-sm font-semibold mt-2">{r.label}</div>
                <div className="text-xs text-gray-500 text-center max-w-28">{r.description}</div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Savings callout */}
      {savings > 0 && (
        <div className="card mb-6 border-l-4 border-l-green-500 bg-green-50 dark:bg-green-900/10">
          <div className="flex items-center gap-3">
            <span className="text-2xl">💰</span>
            <div>
              <div className="text-sm text-gray-600 dark:text-gray-400">Estimated reduction in taxable gains using Specific ID:</div>
              <div className="text-2xl font-bold text-green-600 tabular-nums">−{formatUSD(savings)}</div>
            </div>
          </div>
        </div>
      )}

      {/* Summary table */}
      <div className="card mb-6">
        <div className="grid grid-cols-3 gap-4">
          <div></div>
          {results.map((r) => (
            <div key={r.label} className="text-center">
              <div className="font-semibold">{r.label}</div>
              <div className="text-xs text-gray-500">{r.description}</div>
            </div>
          ))}
        </div>
        <div className="border-t my-3" />

        <CompRow label="Total Gain/Loss" values={results.map((r, i) => ({ value: r.totalGL, isBest: i === 1 && savings > 0 }))} />
        <CompRow label="Short-term" values={results.map((r) => ({ value: r.stGL }))} />
        <CompRow label="Long-term" values={results.map((r) => ({ value: r.ltGL }))} />
        <div className="grid grid-cols-3 gap-4 py-2">
          <div className="text-gray-500"># Sales</div>
          {results.map((r) => <div key={r.label} className="text-center tabular-nums">{r.salesCount}</div>)}
        </div>
        {savings > 0 && (
          <>
            <div className="border-t my-3" />
            <div className="grid grid-cols-3 gap-4 py-2">
              <div className="text-gray-500 font-medium">Change in taxable gains</div>
              <div></div>
              <div className="text-center tabular-nums font-bold text-green-600">−{formatUSD(savings)}</div>
            </div>
          </>
        )}
      </div>

      {/* Info */}
      <div className="bg-blue-50 dark:bg-blue-900/20 p-4 rounded-lg text-sm text-blue-600 dark:text-blue-400">
        <strong>How to apply:</strong> Go to <strong>Transactions</strong> and click <strong>Optimize All</strong> to automatically assign optimal Specific ID lots to all sells in {selectedYear}. You can also assign lots individually using the <strong>Lots</strong> button on each sell.
        <div className="mt-2 text-xs opacity-75">IRS expects consistent use of one accounting method per wallet within a tax year (IRC §1012, TD 9989).</div>
      </div>
    </div>
  );
}

function CompRow({ label, values }: { label: string; values: { value: number; isBest?: boolean }[] }) {
  return (
    <div className="grid grid-cols-3 gap-4 py-2">
      <div className="text-gray-500">{label}</div>
      {values.map((v, i) => (
        <div key={i} className={`text-center tabular-nums ${v.isBest ? "font-bold" : ""} ${v.value >= 0 ? "text-green-600" : "text-red-500"}`}>
          {v.value >= 0 ? "+" : ""}{formatUSD(v.value)}
        </div>
      ))}
    </div>
  );
}
