import { useState, useMemo } from "react";
import { useAppState } from "../lib/app-state";
import { calculate, simulateSale, LotSelection } from "../lib/cost-basis";
import { formatUSD, formatBTC, formatDate, formatDateTime, findSimilarTransactions } from "../lib/utils";
import { AccountingMethod, TransactionType, TransactionTypeDisplayNames } from "../lib/types";
import { SaleRecord, createTransaction } from "../lib/models";
import { LotPicker } from "./LotPicker";
import { HelpPanel } from "./HelpPanel";

export function RecordSaleView() {
  const state = useAppState();
  const [saleDate, setSaleDate] = useState(new Date().toISOString().split("T")[0]);
  const [amountStr, setAmountStr] = useState("");
  const [priceStr, setPriceStr] = useState("");
  const [useLive, setUseLive] = useState(false);
  const [method, setMethod] = useState(AccountingMethod.FIFO);
  const [preview, setPreview] = useState<SaleRecord | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [showLotPicker, setShowLotPicker] = useState(false);
  const [lotSelections, setLotSelections] = useState<LotSelection[] | null>(null);
  const [selectedWallet, setSelectedWallet] = useState("");
  const [pendingConfirm, setPendingConfirm] = useState(false);
  const [duplicateMatches, setDuplicateMatches] = useState<typeof state.transactions>([]);

  const fullResult = useMemo(() => calculate(state.allTransactions, method), [state.allTransactions, method]);

  const isSpecificID = method === AccountingMethod.SpecificID;

  const generatePreview = () => {
    setError(null); setSuccess(null);
    const amount = Number(amountStr);
    const price = useLive ? state.priceState.currentPrice! : Number(priceStr);
    if (!amount || amount <= 0) { setError("Enter valid amount"); return; }
    if (!price || price <= 0) { setError("Enter valid price"); return; }

    if (isSpecificID) {
      // Show lot picker instead of auto-preview
      setShowLotPicker(true);
      setPreview(null);
      return;
    }

    const wallet = selectedWallet || undefined;
    const saleDateISO = new Date(saleDate + "T12:00:00").toISOString();
    const sim = simulateSale(amount, price, fullResult.lots, method, undefined, wallet, saleDateISO);
    if (!sim) { setError("Not enough BTC to sell"); return; }
    setPreview(sim);
  };

  const handleLotPickerConfirm = (selections: LotSelection[]) => {
    setShowLotPicker(false);
    setLotSelections(selections);
    const amount = Number(amountStr);
    const price = useLive ? state.priceState.currentPrice! : Number(priceStr);
    const wallet = selectedWallet || undefined;
    const saleDateISO = new Date(saleDate + "T12:00:00").toISOString();
    const sim = simulateSale(amount, price, fullResult.lots, method, selections, wallet, saleDateISO);
    if (!sim) { setError("Not enough BTC from selected lots"); return; }
    setPreview(sim);
  };

  const handleLotPickerCancel = () => {
    setShowLotPicker(false);
  };

  const commitSale = () => {
    if (!preview) return;
    const walletName = selectedWallet || "Recorded Sale";
    const txn = createTransaction({
      date: new Date(saleDate + "T12:00:00").toISOString(),
      transactionType: TransactionType.Sell,
      amountBTC: preview.amountSold,
      pricePerBTC: preview.salePricePerBTC,
      totalUSD: preview.totalProceeds,
      exchange: walletName,
      wallet: walletName,
      notes: "Manually recorded sale",
    });
    state.addTransaction(txn);
    state.recordSale(preview);
    setSuccess("Sale recorded successfully");
    setPreview(null);
    setLotSelections(null);
    setPendingConfirm(false);
    setDuplicateMatches([]);
    setAmountStr(""); setPriceStr("");
  };

  const confirmSale = () => {
    if (!preview) return;

    // Check for similar existing sell transactions on same day
    const similar = findSimilarTransactions(
      state.transactions,
      TransactionType.Sell,
      new Date(saleDate + "T12:00:00").toISOString(),
      preview.amountSold
    );
    if (similar.length > 0) {
      setPendingConfirm(true);
      setDuplicateMatches(similar);
      return;
    }

    commitSale();
  };

  return (
    <div className="p-8 max-w-4xl">
      <h1 className="text-3xl font-bold mb-1">Record Sale</h1>
      <HelpPanel subtitle="Record an actual sale to permanently consume lots and generate a taxable event." />

      <div className="card mb-6">
        <div className="flex gap-4 mb-4 flex-wrap">
          <div>
            <label className="text-xs text-gray-500 block mb-1">Sale Date</label>
            <input type="date" className="input" value={saleDate} onChange={(e) => setSaleDate(e.target.value)} />
          </div>
          <div>
            <label className="text-xs text-gray-500 block mb-1">BTC Amount</label>
            <input className="input w-44" placeholder="0.00000000" value={amountStr} onChange={(e) => setAmountStr(e.target.value)} />
          </div>
          <div>
            <div className="flex items-center gap-2 mb-1">
              <label className="text-xs text-gray-500">Price/BTC</label>
              <label className="flex items-center gap-1 text-xs"><input type="checkbox" checked={useLive} onChange={(e) => { setUseLive(e.target.checked); if (e.target.checked) state.fetchPrice(); }} /> Live</label>
            </div>
            {useLive ? (
              <div className="text-lg font-medium tabular-nums h-8">{state.priceState.currentPrice ? formatUSD(state.priceState.currentPrice) : "..."}</div>
            ) : (
              <input className="input w-44" placeholder="0.00" value={priceStr} onChange={(e) => setPriceStr(e.target.value)} />
            )}
          </div>
          <div>
            <label className="text-xs text-gray-500 block mb-1">Method</label>
            <select className="select" value={method} onChange={(e) => { setMethod(e.target.value as AccountingMethod); setPreview(null); setShowLotPicker(false); setLotSelections(null); }}>
              {Object.values(AccountingMethod).map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
          </div>
          {state.availableWallets.length > 1 && (
            <div>
              <label className="text-xs text-gray-500 block mb-1">Wallet</label>
              <select className="select" value={selectedWallet} onChange={(e) => { setSelectedWallet(e.target.value); setPreview(null); }}>
                <option value="">All Wallets</option>
                {state.availableWallets.map((w) => <option key={w} value={w}>{w}</option>)}
              </select>
            </div>
          )}
        </div>
        <div className="flex gap-3">
          <button className="btn-secondary" onClick={generatePreview}>
            {isSpecificID ? "🔍 Select Lots" : "👁️ Preview"}
          </button>
          {preview && <button className="btn-primary" onClick={confirmSale}>✅ Record Sale</button>}
        </div>
      </div>

      {error && <div className="bg-red-50 dark:bg-red-900/20 text-red-500 p-4 rounded-lg mb-6">⚠️ {error}</div>}
      {success && <div className="bg-green-50 dark:bg-green-900/20 text-green-600 p-4 rounded-lg mb-6">✅ {success}</div>}

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

      {preview && (
        <div className="card mb-6">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold">Preview</h3>
            <span className="text-orange-500 text-xs font-bold">PREVIEW ONLY</span>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><span className="text-xs text-gray-500">Proceeds:</span> <span className="tabular-nums">{formatUSD(preview.totalProceeds)}</span></div>
            <div><span className="text-xs text-gray-500">Cost Basis:</span> <span className="tabular-nums">{formatUSD(preview.costBasis)}</span></div>
            <div><span className="text-xs text-gray-500">Gain/Loss:</span> <span className={`font-semibold tabular-nums ${preview.gainLoss >= 0 ? "text-green-600" : "text-red-500"}`}>{preview.gainLoss >= 0 ? "+" : ""}{formatUSD(preview.gainLoss)}</span></div>
            <div><span className="text-xs text-gray-500">Term:</span> <span className={`badge ${preview.isLongTerm ? "badge-green" : "badge-orange"}`}>{preview.isLongTerm ? "Long-term" : "Short-term"}</span></div>
          </div>
          {isSpecificID && lotSelections && (
            <div className="text-xs text-blue-500 mt-2">Using Specific Identification — {lotSelections.length} lot(s) selected</div>
          )}
        </div>
      )}

      {state.recordedSales.length > 0 && (
        <div className="card">
          <h3 className="font-semibold mb-3">Recorded Sales History</h3>
          {state.recordedSales.map((s) => (
            <div key={s.id} className="flex items-center gap-4 py-2 text-sm">
              <span>{formatDate(s.saleDate)}</span>
              <span className="tabular-nums">{formatBTC(s.amountSold)} BTC</span>
              <span>@</span>
              <span className="tabular-nums">{formatUSD(s.salePricePerBTC)}</span>
              <span className="flex-1" />
              <span className={`font-medium tabular-nums ${s.gainLoss >= 0 ? "text-green-600" : "text-red-500"}`}>{s.gainLoss >= 0 ? "+" : ""}{formatUSD(s.gainLoss)}</span>
              <span className={`badge ${s.isLongTerm ? "badge-green" : "badge-orange"}`}>{s.isLongTerm ? "Long" : "Short"}</span>
            </div>
          ))}
        </div>
      )}

      {/* Duplicate Warning Modal */}
      {pendingConfirm && duplicateMatches.length > 0 && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => { setPendingConfirm(false); setDuplicateMatches([]); }}>
          <div className="bg-white dark:bg-zinc-900 rounded-xl p-6 max-w-lg w-full shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-bold mb-2 text-orange-500">Possible Duplicate Sale</h3>
            <p className="text-sm text-gray-600 dark:text-gray-400 mb-3">
              A similar sell transaction already exists on the same day. Recording this sale could double-count the sale and produce incorrect tax calculations.
            </p>
            <p className="text-sm text-gray-600 dark:text-gray-400 mb-3">
              This can happen if you record a sale manually that was also imported from a CSV.
            </p>

            <div className="bg-gray-50 dark:bg-zinc-800 rounded-lg p-3 mb-4 text-sm space-y-1">
              <p className="font-semibold text-gray-700 dark:text-gray-300 mb-2">Existing match{duplicateMatches.length > 1 ? "es" : ""}:</p>
              {duplicateMatches.map((m) => (
                <div key={m.id} className="flex items-center gap-3 text-gray-600 dark:text-gray-400">
                  <span className="tabular-nums">{formatDateTime(m.date)}</span>
                  <span>{TransactionTypeDisplayNames[m.transactionType]}</span>
                  <span className="tabular-nums">{formatBTC(m.amountBTC)} BTC</span>
                  <span className="text-gray-400">{m.exchange}</span>
                </div>
              ))}
            </div>

            <div className="flex gap-3 justify-end">
              <button className="btn-secondary text-sm" onClick={() => { setPendingConfirm(false); setDuplicateMatches([]); }}>Cancel</button>
              <button
                className="bg-orange-500 hover:bg-orange-600 text-white px-4 py-2 rounded-lg text-sm font-medium"
                onClick={commitSale}
              >
                Record Anyway
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
