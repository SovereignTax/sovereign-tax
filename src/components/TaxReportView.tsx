import { useMemo } from "react";
import { useAppState } from "../lib/app-state";
import { calculate } from "../lib/cost-basis";
import { exportForm8949CSV, exportLegacyCSV, exportTurboTaxTXF, exportTurboTaxCSV } from "../lib/export";
import { exportForm8949PDF } from "../lib/pdf-export";
import { formatUSD, formatBTC, formatDate } from "../lib/utils";
import { AccountingMethod } from "../lib/types";

export function TaxReportView() {
  const { allTransactions, selectedYear, setSelectedYear, selectedMethod, setSelectedMethod, availableYears } = useAppState();

  const result = useMemo(() => calculate(allTransactions, selectedMethod), [allTransactions, selectedMethod]);
  const salesForYear = result.sales.filter((s) => new Date(s.saleDate).getFullYear() === selectedYear);

  const totalProceeds = salesForYear.reduce((a, s) => a + s.totalProceeds, 0);
  const totalCostBasis = salesForYear.reduce((a, s) => a + s.costBasis, 0);
  const totalGL = salesForYear.reduce((a, s) => a + s.gainLoss, 0);
  const stGL = salesForYear.filter((s) => !s.isLongTerm).reduce((a, s) => a + s.gainLoss, 0);
  const ltGL = salesForYear.filter((s) => s.isLongTerm).reduce((a, s) => a + s.gainLoss, 0);

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
      <h1 className="text-3xl font-bold mb-6">Tax Report</h1>

      {/* Controls */}
      <div className="flex items-center gap-6 mb-6">
        <div className="flex items-center gap-2">
          <span className="text-gray-500">Tax Year:</span>
          <select className="select" value={selectedYear} onChange={(e) => setSelectedYear(Number(e.target.value))}>
            {availableYears.map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
        </div>
        <div className="segmented">
          {Object.values(AccountingMethod).map((m) => (
            <button key={m} className={`segmented-btn ${selectedMethod === m ? "active" : ""}`} onClick={() => setSelectedMethod(m)}>{m}</button>
          ))}
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
            <h3 className="font-semibold mb-3">Summary — {selectedYear} ({selectedMethod})</h3>
            <div className="grid grid-cols-5 gap-4">
              <div><div className="text-xs text-gray-500">Total Proceeds</div><div className="font-semibold tabular-nums">{formatUSD(totalProceeds)}</div></div>
              <div><div className="text-xs text-gray-500">Cost Basis</div><div className="font-semibold tabular-nums">{formatUSD(totalCostBasis)}</div></div>
              <div><div className="text-xs text-gray-500">Total Gain/Loss</div><div className={`font-semibold tabular-nums ${totalGL >= 0 ? "text-green-600" : "text-red-500"}`}>{formatUSD(totalGL)}</div></div>
              <div><div className="text-xs text-gray-500">Short-term</div><div className={`font-semibold tabular-nums ${stGL >= 0 ? "text-green-600" : "text-red-500"}`}>{formatUSD(stGL)}</div></div>
              <div><div className="text-xs text-gray-500">Long-term</div><div className={`font-semibold tabular-nums ${ltGL >= 0 ? "text-green-600" : "text-red-500"}`}>{formatUSD(ltGL)}</div></div>
            </div>
          </div>

          {/* Export */}
          <div className="card mb-6">
            <h3 className="font-semibold mb-3">Export Tax Documents</h3>
            <div className="flex gap-3 flex-wrap">
              <button className="btn-secondary" onClick={() => downloadCSV(exportForm8949CSV(salesForYear, selectedYear, selectedMethod), `form_8949_${selectedYear}_${selectedMethod}.csv`)}>
                📊 Form 8949 CSV
              </button>
              <button className="btn-secondary" onClick={() => downloadCSV(exportLegacyCSV(salesForYear), `btc_tax_${selectedYear}_${selectedMethod}.csv`)}>
                📋 Raw Data CSV
              </button>
              <button className="btn-secondary" onClick={() => downloadCSV(exportTurboTaxCSV(salesForYear, selectedYear), `turbotax_${selectedYear}.csv`)}>
                💼 TurboTax CSV
              </button>
              <button className="btn-secondary" onClick={() => downloadCSV(exportTurboTaxTXF(salesForYear, selectedYear), `turbotax_${selectedYear}.txf`)}>
                📑 TurboTax TXF
              </button>
              <button className="btn-secondary" onClick={() => exportForm8949PDF(salesForYear, selectedYear, selectedMethod)}>
                📄 PDF Report
              </button>
            </div>
            <p className="text-xs text-gray-500 mt-2">
              Form 8949 exports include Part I (short-term) and Part II (long-term) separated sections with Schedule D summary.
              TurboTax formats can be imported directly into TurboTax.
            </p>
          </div>

          {/* Sales List */}
          <div className="card">
            <h3 className="font-semibold mb-3">Sales ({salesForYear.length})</h3>
            {salesForYear.map((sale, idx) => (
              <details key={sale.id} className="mb-2">
                <summary className="flex items-center gap-3 py-2 px-3 rounded cursor-pointer hover:bg-gray-50 dark:hover:bg-zinc-800">
                  <span className="font-medium">Sale #{idx + 1}</span>
                  <span className="text-gray-500 text-sm">{formatDate(sale.saleDate)}</span>
                  <span className="flex-1" />
                  <span className="tabular-nums text-sm">{formatBTC(sale.amountSold)} BTC</span>
                  <span className={`font-medium tabular-nums ${sale.gainLoss >= 0 ? "text-green-600" : "text-red-500"}`}>
                    {sale.gainLoss >= 0 ? "+" : ""}{formatUSD(sale.gainLoss)}
                  </span>
                  <span className={`badge ${sale.isLongTerm ? "badge-green" : "badge-orange"}`}>
                    {sale.isLongTerm ? "Long-term" : "Short-term"}
                  </span>
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
    </div>
  );
}
