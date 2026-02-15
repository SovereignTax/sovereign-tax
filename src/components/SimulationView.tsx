import { useState, useMemo } from "react";
import { useAppState } from "../lib/app-state";
import { calculate, simulateSale, LotSelection } from "../lib/cost-basis";
import { formatUSD, formatBTC, formatDate } from "../lib/utils";
import { AccountingMethod } from "../lib/types";
import { SaleRecord } from "../lib/models";
import { LotPicker } from "./LotPicker";
import { HelpPanel } from "./HelpPanel";

export function SimulationView() {
  const state = useAppState();
  const { allTransactions, priceState, fetchPrice, availableWallets } = state;
  const [amountStr, setAmountStr] = useState("");
  const [priceStr, setPriceStr] = useState("");
  const [useLive, setUseLive] = useState(false);
  const [method, setMethod] = useState(AccountingMethod.FIFO);
  const [selectedWallet, setSelectedWallet] = useState("");
  const [result, setResult] = useState<SaleRecord | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showLotPicker, setShowLotPicker] = useState(false);

  const fullResult = useMemo(() => calculate(allTransactions, method), [allTransactions, method]);

  const isSpecificID = method === AccountingMethod.SpecificID;

  const canSimulate = () => {
    const amt = Number(amountStr);
    if (!amt || amt <= 0) return false;
    if (useLive) return !!priceState.currentPrice;
    const p = Number(priceStr);
    return p > 0;
  };

  const runSimulation = () => {
    setError(null);
    const amount = Number(amountStr);
    if (!amount || amount <= 0) { setError("Enter a valid BTC amount"); return; }
    const price = useLive ? priceState.currentPrice! : Number(priceStr);
    if (!price || price <= 0) { setError("Enter a valid price"); return; }

    if (isSpecificID) {
      // Show lot picker instead of auto-simulation
      setShowLotPicker(true);
      setResult(null);
      return;
    }

    const wallet = selectedWallet || undefined;
    const sim = simulateSale(amount, price, fullResult.lots, method, undefined, wallet);
    if (!sim) { setError("Not enough BTC in holdings"); return; }
    setResult(sim);
  };

  const handleLotPickerConfirm = (selections: LotSelection[]) => {
    setShowLotPicker(false);
    const amount = Number(amountStr);
    const price = useLive ? priceState.currentPrice! : Number(priceStr);
    const wallet = selectedWallet || undefined;
    const sim = simulateSale(amount, price, fullResult.lots, method, selections, wallet);
    if (!sim) { setError("Not enough BTC from selected lots"); return; }
    setResult(sim);
  };

  const handleLotPickerCancel = () => {
    setShowLotPicker(false);
  };

  return (
    <div className="p-8 max-w-4xl">
      <h1 className="text-3xl font-bold mb-1">Simulate Sale</h1>
      <HelpPanel subtitle="Preview capital gains and lot matching for a hypothetical sale — nothing is recorded." />

      <div className="card mb-6">
        <div className="flex gap-6 mb-4">
          <div>
            <label className="text-xs text-gray-500 block mb-1">BTC Amount</label>
            <input className="input w-48" placeholder="0.00000000" value={amountStr} onChange={(e) => setAmountStr(e.target.value)} />
          </div>
          <div>
            <div className="flex items-center gap-2 mb-1">
              <label className="text-xs text-gray-500">Price per BTC (USD)</label>
              <label className="flex items-center gap-1 text-xs">
                <input type="checkbox" checked={useLive} onChange={(e) => { setUseLive(e.target.checked); if (e.target.checked) fetchPrice(); }} />
                Live
              </label>
            </div>
            {useLive ? (
              <div className="text-lg font-medium tabular-nums h-8">{priceState.currentPrice ? formatUSD(priceState.currentPrice) : "..."}</div>
            ) : (
              <input className="input w-48" placeholder="0.00" value={priceStr} onChange={(e) => setPriceStr(e.target.value)} />
            )}
          </div>
          <div>
            <label className="text-xs text-gray-500 block mb-1">Method</label>
            <select className="select" value={method} onChange={(e) => { setMethod(e.target.value as AccountingMethod); setResult(null); setShowLotPicker(false); }}>
              {Object.values(AccountingMethod).map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
          </div>
          {availableWallets.length > 1 && (
            <div>
              <label className="text-xs text-gray-500 block mb-1">Wallet</label>
              <select className="select" value={selectedWallet} onChange={(e) => { setSelectedWallet(e.target.value); setResult(null); }}>
                <option value="">All Wallets</option>
                {availableWallets.map((w) => <option key={w} value={w}>{w}</option>)}
              </select>
            </div>
          )}
        </div>
        <button className="btn-primary" disabled={!canSimulate()} onClick={runSimulation}>
          {isSpecificID ? "🔍 Select Lots" : "▶️ Simulate"}
        </button>
      </div>

      {error && <div className="bg-red-50 dark:bg-red-900/20 text-red-500 p-4 rounded-lg mb-6">⚠️ {error}</div>}

      {/* Lot Picker for Specific ID */}
      {showLotPicker && (
        <div className="mb-6">
          <LotPicker
            lots={fullResult.lots}
            targetAmount={Number(amountStr)}
            onConfirm={handleLotPickerConfirm}
            onCancel={handleLotPickerCancel}
          />
        </div>
      )}

      {result && (
        <div className="card">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold flex items-center gap-2">✨ Simulation Result</h3>
            <span className="badge badge-orange font-bold text-xs">NOT A REAL TRANSACTION</span>
          </div>
          <div className="grid grid-cols-2 gap-y-3 gap-x-6 mb-4">
            <Row label="Amount" value={`${formatBTC(result.amountSold)} BTC`} />
            <Row label="Sale Price" value={formatUSD(result.salePricePerBTC)} />
            <Row label="Total Proceeds" value={formatUSD(result.totalProceeds)} />
            <Row label="Cost Basis" value={formatUSD(result.costBasis)} />
            <Row label="Estimated Gain/Loss" value={`${result.gainLoss >= 0 ? "+" : ""}${formatUSD(result.gainLoss)}`} className={`text-lg font-bold ${result.gainLoss >= 0 ? "text-green-600" : "text-red-500"}`} />
            <Row label="Holding Period" value={<>{result.holdingPeriodDays} days <span className={`badge ${result.isLongTerm ? "badge-green" : "badge-orange"} ml-2`}>{result.isLongTerm ? "Long-term" : "Short-term"}</span></>} />
          </div>

          {result.lotDetails.length > 0 && (
            <>
              <div className="border-t pt-3 mt-3">
                <h4 className="text-sm font-medium mb-2">Lots Used:</h4>
                {result.lotDetails.map((d) => (
                  <div key={d.id} className="flex gap-4 text-xs text-gray-600 dark:text-gray-400 py-1">
                    <span>{formatDate(d.purchaseDate)}</span>
                    <span className="tabular-nums">{formatBTC(d.amountBTC)} BTC</span>
                    <span>@</span>
                    <span className="tabular-nums">{formatUSD(d.costBasisPerBTC)}</span>
                    <span>{d.daysHeld} days</span>
                    <span>{d.exchange}</span>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function Row({ label, value, className }: { label: string; value: React.ReactNode; className?: string }) {
  return (
    <div>
      <div className="text-xs text-gray-500">{label}</div>
      <div className={`tabular-nums ${className || ""}`}>{value}</div>
    </div>
  );
}
