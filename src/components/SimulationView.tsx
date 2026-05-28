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
  const { allTransactions, priceState, fetchPrice, availableWallets, setSavedLotSelections } = state;
  const [amountStr, setAmountStr] = useState("");
  const [priceStr, setPriceStr] = useState("");
  const [useLive, setUseLive] = useState(false);
  const [method, setMethod] = useState(AccountingMethod.FIFO);
  const [selectedWallet, setSelectedWallet] = useState("");
  // Simulated sale date — defaults to today but user can backdate or future-date
  // for "what if I sell next March?" scenarios. Required for accurate holding-
  // period (ST/LT) classification. See BUG-FIX-PLAN.md B2.
  const [saleDate, setSaleDate] = useState<string>(new Date().toISOString().split("T")[0]);
  const [result, setResult] = useState<SaleRecord | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showLotPicker, setShowLotPicker] = useState(false);
  const [lastSelections, setLastSelections] = useState<LotSelection[] | null>(null);

  const fullResult = useMemo(() => calculate(allTransactions, method, state.recordedSales), [allTransactions, method, state.recordedSales]);

  const isSpecificID = method === AccountingMethod.SpecificID;

  // Sale date as ISO string at noon UTC — matches the convention used elsewhere
  // in the app for day-precision dates and avoids edge-of-day TZ issues.
  const saleDateISO = saleDate ? new Date(saleDate + "T12:00:00").toISOString() : undefined;

  /** Clear stale result and any saved selections — call from every input handler.
   *  Without this, the user can edit Amount/Price/Method/Wallet but see stale
   *  result from a previous simulation, and saved lot selections from a prior
   *  method/wallet could silently pre-fill the next disposition flow.
   *  See BUG-FIX-PLAN.md B3. */
  const resetStaleState = () => {
    setResult(null);
    setShowLotPicker(false);
    setLastSelections(null);
    setSavedLotSelections(null);
    setError(null);
  };

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
    const sim = simulateSale(amount, price, fullResult.lots, method, undefined, wallet, saleDateISO);
    if (!sim) { setError("Not enough BTC in holdings"); return; }
    setResult(sim);
  };

  const handleLotPickerConfirm = (selections: LotSelection[]) => {
    setShowLotPicker(false);
    const amount = Number(amountStr);
    const price = useLive ? priceState.currentPrice! : Number(priceStr);
    const wallet = selectedWallet || undefined;
    const sim = simulateSale(amount, price, fullResult.lots, method, selections, wallet, saleDateISO);
    if (!sim) { setError("Not enough BTC from selected lots"); return; }
    setResult(sim);
    // Save lot selections for use in Record Sale / Add Transaction
    setLastSelections(selections);
    setSavedLotSelections({
      lotSelections: selections,
      amountBTC: amount,
      wallet: selectedWallet,
      method,
      savedAt: new Date().toISOString(),
    });
  };

  const handleLotPickerCancel = () => {
    setShowLotPicker(false);
  };

  return (
    <div className="p-8 max-w-4xl">
      <h1 className="text-3xl font-bold mb-1">Simulate Sale</h1>
      <HelpPanel subtitle="Preview capital gains and lot matching for a hypothetical sale — nothing is recorded." />

      <div className="card mb-6">
        <div className="flex gap-6 mb-4 flex-wrap">
          <div>
            <label className="text-xs text-gray-500 block mb-1">BTC Amount</label>
            <input className="input w-48" placeholder="0.00000000" value={amountStr} onChange={(e) => { setAmountStr(e.target.value); resetStaleState(); }} />
          </div>
          <div>
            <div className="flex items-center gap-2 mb-1">
              <label className="text-xs text-gray-500">Price per BTC (USD)</label>
              <label className="flex items-center gap-1 text-xs">
                <input type="checkbox" checked={useLive} onChange={(e) => { setUseLive(e.target.checked); if (e.target.checked) fetchPrice(); resetStaleState(); }} />
                Live
              </label>
            </div>
            {useLive ? (
              <div className="text-lg font-medium tabular-nums h-8">{priceState.currentPrice ? formatUSD(priceState.currentPrice) : "..."}</div>
            ) : (
              <input className="input w-48" placeholder="0.00" value={priceStr} onChange={(e) => { setPriceStr(e.target.value); resetStaleState(); }} />
            )}
          </div>
          <div>
            <label className="text-xs text-gray-500 block mb-1" title="The hypothetical sale date — used for short-term vs long-term holding-period classification.">Sale Date</label>
            <input
              type="date"
              className="input w-48"
              value={saleDate}
              min="2009-01-03"
              max="2099-12-31"
              onChange={(e) => { setSaleDate(e.target.value); resetStaleState(); }}
            />
          </div>
          <div>
            <label className="text-xs text-gray-500 block mb-1">Method</label>
            <select className="select" value={method} onChange={(e) => { setMethod(e.target.value as AccountingMethod); resetStaleState(); }}>
              <option value={AccountingMethod.FIFO}>FIFO</option>
              <option value={AccountingMethod.SpecificID}>Specific ID</option>
            </select>
          </div>
          {availableWallets.length > 1 && (
            <div>
              <label className="text-xs text-gray-500 block mb-1">Wallet</label>
              <select className="select" value={selectedWallet} onChange={(e) => { setSelectedWallet(e.target.value); resetStaleState(); }}>
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

      {/* Lot Picker for Specific ID — filtered to selected wallet */}
      {showLotPicker && (
        <div className="mb-6">
          <LotPicker
            lots={selectedWallet
              ? fullResult.lots.filter((l) => (l.wallet || l.exchange || "").toLowerCase() === selectedWallet.toLowerCase())
              : fullResult.lots}
            targetAmount={Number(amountStr)}
            salePrice={useLive ? priceState.currentPrice || undefined : Number(priceStr) || undefined}
            saleDate={saleDateISO}
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

          {/* Saved lot selections confirmation for Specific ID simulations */}
          {lastSelections && isSpecificID && (
            <div className="bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400 text-sm p-3 rounded-lg mt-3 flex items-center gap-2">
              <span>✅</span>
              <span>Lot selections saved — go to <strong>Record Sale</strong> or <strong>Add Transaction</strong> with Specific ID and they'll be pre-filled automatically.</span>
            </div>
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
