import { useMemo, useState } from "react";
import { useAppState } from "../lib/app-state";
import { calculate, daysBetween, simulateSale, isMoreThanOneYear } from "../lib/cost-basis";
import { formatUSD, formatBTC, formatDate } from "../lib/utils";
import { AccountingMethod } from "../lib/types";
import { SaleRecord } from "../lib/models";
import { HelpPanel } from "./HelpPanel";

export function TaxLossHarvestingView() {
  const { allTransactions, selectedYear, setSelectedYear, availableYears, priceState, fetchPrice, selectedMethod } = useAppState();
  const [harvestResult, setHarvestResult] = useState<SaleRecord | null>(null);

  const result = useMemo(() => calculate(allTransactions, selectedMethod), [allTransactions, selectedMethod]);
  const currentPrice = priceState.currentPrice;

  const lotsWithGL = useMemo(() => {
    if (!currentPrice) return [];
    return result.lots
      .filter((l) => l.remainingBTC > 0)
      .map((lot) => {
        const currentValue = lot.remainingBTC * currentPrice;
        const costBasis = lot.remainingBTC * lot.pricePerBTC;
        const unrealizedGL = currentValue - costBasis;
        const daysHeld = daysBetween(lot.purchaseDate, new Date().toISOString());
        return { ...lot, currentValue, costBasis, unrealizedGL, daysHeld, isLongTerm: isMoreThanOneYear(lot.purchaseDate, new Date().toISOString()) };
      })
      .sort((a, b) => a.unrealizedGL - b.unrealizedGL); // Biggest losses first
  }, [result.lots, currentPrice]);

  const losingLots = lotsWithGL.filter((l) => l.unrealizedGL < 0);
  const totalHarvestable = losingLots.reduce((a, l) => a + l.unrealizedGL, 0);
  const totalHarvestBTC = losingLots.reduce((a, l) => a + l.remainingBTC, 0);

  // Current year realized gains
  const salesThisYear = result.sales.filter((s) => new Date(s.saleDate).getFullYear() === selectedYear);
  const realizedGains = salesThisYear.reduce((a, s) => a + s.gainLoss, 0);
  const netAfterHarvest = realizedGains + totalHarvestable;

  const simulateHarvest = () => {
    if (!currentPrice || totalHarvestBTC <= 0) return;
    const sim = simulateSale(totalHarvestBTC, currentPrice, result.lots, selectedMethod);
    if (sim) setHarvestResult(sim);
  };

  if (!currentPrice) {
    return (
      <div className="p-8 flex flex-col items-center justify-center h-full">
        <div className="text-5xl mb-4 opacity-50">🌾</div>
        <h2 className="text-xl text-gray-500 mb-2">Price data needed</h2>
        <p className="text-gray-400 mb-4">Live BTC price is required for tax-loss harvesting analysis</p>
        <button className="btn-primary" onClick={fetchPrice}>Fetch Price</button>
      </div>
    );
  }

  return (
    <div className="p-8 max-w-5xl">
      <h1 className="text-3xl font-bold mb-1">Tax-Loss Harvesting</h1>
      <HelpPanel subtitle="Identify lots trading below cost basis that could be sold to offset realized gains this year." />

      <div className="flex items-center gap-3 mb-6">
        <span className="text-gray-500">Tax Year:</span>
        <select className="select" value={selectedYear} onChange={(e) => setSelectedYear(Number(e.target.value))}>
          {availableYears.map((y) => <option key={y} value={y}>{y}</option>)}
        </select>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-4 gap-4 mb-6">
        <div className="card">
          <div className="text-xs text-gray-500 mb-1">Harvestable Losses</div>
          <div className="text-xl font-semibold tabular-nums text-red-500">{formatUSD(totalHarvestable)}</div>
          <div className="text-xs text-gray-400">{losingLots.length} lots</div>
        </div>
        <div className="card">
          <div className="text-xs text-gray-500 mb-1">{selectedYear} Realized Gains</div>
          <div className={`text-xl font-semibold tabular-nums ${realizedGains >= 0 ? "text-green-600" : "text-red-500"}`}>{formatUSD(realizedGains)}</div>
        </div>
        <div className="card">
          <div className="text-xs text-gray-500 mb-1">Net After Harvesting</div>
          <div className={`text-xl font-semibold tabular-nums ${netAfterHarvest >= 0 ? "text-green-600" : "text-red-500"}`}>{formatUSD(netAfterHarvest)}</div>
        </div>
        <div className="card">
          <div className="text-xs text-gray-500 mb-1">Potential Tax Savings</div>
          <div className="text-xl font-semibold tabular-nums text-green-600">
            {formatUSD(Math.abs(totalHarvestable) * 0.37)}
          </div>
          <div className="text-xs text-gray-400">est. @ 37% rate</div>
        </div>
      </div>

      {losingLots.length === 0 ? (
        <div className="card text-center py-8">
          <div className="text-3xl mb-2">🎉</div>
          <p className="text-gray-500">All your lots are in profit! No tax-loss harvesting opportunities.</p>
        </div>
      ) : (
        <>
          {/* Lots Table */}
          <div className="card mb-6">
            <h3 className="font-semibold mb-3">Lots with Unrealized Losses ({losingLots.length})</h3>
            <div className="grid grid-cols-6 gap-2 text-xs font-semibold text-gray-500 pb-2 border-b border-gray-200 dark:border-gray-700">
              <div>Date</div>
              <div className="text-right">BTC</div>
              <div className="text-right">Cost Basis</div>
              <div className="text-right">Current Value</div>
              <div className="text-right">Unrealized Loss</div>
              <div>Term</div>
            </div>
            {losingLots.map((lot) => (
              <div key={lot.id} className="grid grid-cols-6 gap-2 py-2 text-sm border-b border-gray-100 dark:border-gray-800">
                <div>{formatDate(lot.purchaseDate)}</div>
                <div className="text-right tabular-nums">{formatBTC(lot.remainingBTC)}</div>
                <div className="text-right tabular-nums">{formatUSD(lot.costBasis)}</div>
                <div className="text-right tabular-nums">{formatUSD(lot.currentValue)}</div>
                <div className="text-right tabular-nums text-red-500">{formatUSD(lot.unrealizedGL)}</div>
                <div>
                  <span className={`badge ${lot.isLongTerm ? "badge-green" : "badge-orange"} text-xs`}>
                    {lot.isLongTerm ? "Long" : "Short"}
                  </span>
                </div>
              </div>
            ))}
          </div>

          <div className="flex gap-3 mb-6">
            <button className="btn-secondary" onClick={simulateHarvest}>
              📈 Simulate Harvest ({formatBTC(totalHarvestBTC)} BTC)
            </button>
          </div>

          {harvestResult && (
            <div className="card mb-6">
              <h3 className="font-semibold mb-3">Harvest Simulation Result</h3>
              <div className="grid grid-cols-3 gap-4">
                <div><span className="text-xs text-gray-500">Proceeds:</span> <span className="tabular-nums">{formatUSD(harvestResult.totalProceeds)}</span></div>
                <div><span className="text-xs text-gray-500">Cost Basis:</span> <span className="tabular-nums">{formatUSD(harvestResult.costBasis)}</span></div>
                <div><span className="text-xs text-gray-500">Realized Loss:</span> <span className="tabular-nums text-red-500">{formatUSD(harvestResult.gainLoss)}</span></div>
              </div>
            </div>
          )}

          {/* Note */}
          <div className="bg-yellow-50 dark:bg-yellow-900/20 p-4 rounded-lg flex items-start gap-3">
            <span className="text-xl">💡</span>
            <div className="text-sm">
              <strong>Note:</strong> The IRS wash-sale rule does not currently apply to cryptocurrency.
              However, proposed legislation may change this. Consult a tax professional for guidance.
            </div>
          </div>
        </>
      )}
    </div>
  );
}
