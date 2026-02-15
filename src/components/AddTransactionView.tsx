import { useState, useCallback } from "react";
import { useAppState } from "../lib/app-state";
import { createTransaction, Transaction } from "../lib/models";
import { TransactionType, TransactionTypeDisplayNames, IncomeType, IncomeTypeDisplayNames } from "../lib/types";
import { formatUSD, formatBTC, formatDateTime, findSimilarTransactions } from "../lib/utils";
import { HelpPanel } from "./HelpPanel";

export function AddTransactionView() {
  const state = useAppState();
  const [type, setType] = useState(TransactionType.Buy);
  const [date, setDate] = useState(new Date().toISOString().split("T")[0]);
  const [amountStr, setAmountStr] = useState("");
  const [priceStr, setPriceStr] = useState("");
  const [totalStr, setTotalStr] = useState("");
  const [feeStr, setFeeStr] = useState("");
  const [exchange, setExchange] = useState("");
  const [wallet, setWallet] = useState("");
  const [notes, setNotes] = useState("");
  const [incomeType, setIncomeType] = useState<IncomeType | "">("");
  const [useLive, setUseLive] = useState(false);
  const [fmvLoading, setFmvLoading] = useState(false);
  const [success, setSuccess] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Duplicate warning state
  const [pendingTxn, setPendingTxn] = useState<Transaction | null>(null);
  const [duplicateMatches, setDuplicateMatches] = useState<typeof state.transactions>([]);

  /** Auto-fetch historical FMV for income transactions */
  const fetchFMV = useCallback(async () => {
    if (!date || !state.livePriceEnabled) return;
    setFmvLoading(true);
    setError(null);
    try {
      const price = await state.fetchHistoricalPrice(new Date(date));
      if (price) {
        setPriceStr(price.toFixed(2));
        const amt = Number(amountStr);
        if (amt > 0) setTotalStr((amt * price).toFixed(2));
      } else {
        setError("Could not fetch historical price for this date. Enter manually.");
      }
    } catch {
      setError("Failed to fetch price. Check your internet connection.");
    } finally {
      setFmvLoading(false);
    }
  }, [date, amountStr, state]);

  const commitTransaction = (txn: Transaction) => {
    state.addTransaction(txn);
    setSuccess(`${TransactionTypeDisplayNames[txn.transactionType]} of ${formatBTC(txn.amountBTC)} BTC added`);
    setAmountStr(""); setPriceStr(""); setTotalStr(""); setFeeStr(""); setWallet(""); setNotes(""); setIncomeType("");
    setPendingTxn(null);
    setDuplicateMatches([]);
  };

  const handleAdd = () => {
    setError(null); setSuccess(null);
    const amount = Number(amountStr);
    if (!amount || amount <= 0) { setError("Enter a valid BTC amount"); return; }
    const price = useLive ? state.priceState.currentPrice! : Number(priceStr);
    if (!price || price <= 0) { setError("Enter a valid price"); return; }
    let total = Number(totalStr);
    if (!total || total <= 0) total = amount * price;
    const fee = Number(feeStr) || 0;

    // Apply fee: buys add fee to cost basis, sells subtract from proceeds
    let adjustedTotal = total;
    let adjustedPrice = price;
    if (fee > 0) {
      if (type === TransactionType.Buy) {
        adjustedTotal = total + fee;
      } else if (type === TransactionType.Sell) {
        adjustedTotal = Math.max(0, total - fee);
      }
      if (amount > 0) adjustedPrice = adjustedTotal / amount;
    }

    const finalExchange = exchange || "Manual";
    const txn = createTransaction({
      date: new Date(date + "T12:00:00").toISOString(),
      transactionType: type,
      amountBTC: amount,
      pricePerBTC: adjustedPrice,
      totalUSD: adjustedTotal,
      fee: fee > 0 ? fee : undefined,
      exchange: finalExchange,
      wallet: wallet || finalExchange,
      incomeType: type === TransactionType.Buy && incomeType ? incomeType : undefined,
      notes,
    });

    // Check for similar existing transactions
    const similar = findSimilarTransactions(state.transactions, type, txn.date, amount);
    if (similar.length > 0) {
      setPendingTxn(txn);
      setDuplicateMatches(similar);
      return;
    }

    commitTransaction(txn);
  };

  return (
    <div className="p-8 max-w-3xl">
      <h1 className="text-3xl font-bold mb-1">Add Transaction</h1>
      <HelpPanel subtitle="Manually add a buy, sell, transfer, or income transaction that wasn't in a CSV import." />

      <div className="card space-y-4">
        {/* Type */}
        <div className="flex items-center gap-4">
          <span className="w-24 text-right text-gray-500">Type:</span>
          <div className="segmented">
            {Object.values(TransactionType).map((t) => (
              <button key={t} className={`segmented-btn ${type === t ? "active" : ""}`} onClick={() => setType(t)}>
                {TransactionTypeDisplayNames[t]}
              </button>
            ))}
          </div>
        </div>

        {/* Income Type (only for Buy) */}
        {type === TransactionType.Buy && (
          <div className="flex items-center gap-4">
            <span className="w-24 text-right text-gray-500">Income Type:</span>
            <select className="select w-48" value={incomeType} onChange={(e) => setIncomeType(e.target.value as IncomeType | "")}>
              <option value="">Not Income (Regular Buy)</option>
              {Object.values(IncomeType).map((it) => (
                <option key={it} value={it}>{IncomeTypeDisplayNames[it]}</option>
              ))}
            </select>
            <span className="text-xs text-gray-400">(optional — for mining, rewards, etc.)</span>
          </div>
        )}

        {/* Date */}
        <div className="flex items-center gap-4">
          <span className="w-24 text-right text-gray-500">Date:</span>
          <input type="date" className="input w-48" value={date} onChange={(e) => setDate(e.target.value)} />
        </div>

        {/* Amount */}
        <div className="flex items-center gap-4">
          <span className="w-24 text-right text-gray-500">BTC Amount:</span>
          <input className="input w-48" placeholder="0.00000000" value={amountStr} onChange={(e) => setAmountStr(e.target.value)} />
        </div>

        {/* Price */}
        <div className="flex items-center gap-4">
          <span className="w-24 text-right text-gray-500">Price/BTC:</span>
          {useLive ? (
            <span className="font-medium tabular-nums">{state.priceState.currentPrice ? formatUSD(state.priceState.currentPrice) : "..."}</span>
          ) : (
            <input className="input w-48" placeholder="0.00" value={priceStr} onChange={(e) => setPriceStr(e.target.value)} />
          )}
          <label className="flex items-center gap-1 text-sm">
            <input type="checkbox" checked={useLive} onChange={(e) => { setUseLive(e.target.checked); if (e.target.checked) state.fetchPrice(); }} />
            Live Price
          </label>
          {type === TransactionType.Buy && incomeType && !useLive && state.livePriceEnabled && (
            <button
              className="btn-secondary text-xs px-3 py-1"
              onClick={fetchFMV}
              disabled={fmvLoading || !date}
            >
              {fmvLoading ? "Fetching..." : "Fetch FMV"}
            </button>
          )}
        </div>

        {/* Total */}
        <div className="flex items-center gap-4">
          <span className="w-24 text-right text-gray-500">Total USD:</span>
          <input className="input w-48" placeholder="Auto-calculated" value={totalStr} onChange={(e) => setTotalStr(e.target.value)} />
          <span className="text-xs text-gray-400">(optional)</span>
        </div>

        {/* Fee */}
        <div className="flex items-center gap-4">
          <span className="w-24 text-right text-gray-500">Fee USD:</span>
          <input className="input w-48" placeholder="0.00" value={feeStr} onChange={(e) => setFeeStr(e.target.value)} />
          <span className="text-xs text-gray-400">(optional — added to cost basis for buys, subtracted from proceeds for sells)</span>
        </div>

        {/* Exchange */}
        <div className="flex items-center gap-4">
          <span className="w-24 text-right text-gray-500">Exchange:</span>
          <input className="input w-48" placeholder="e.g., Coinbase" value={exchange} onChange={(e) => setExchange(e.target.value)} />
        </div>

        {/* Wallet */}
        <div className="flex items-center gap-4">
          <span className="w-24 text-right text-gray-500">Wallet:</span>
          <input className="input w-48" placeholder="Defaults to exchange" value={wallet} onChange={(e) => setWallet(e.target.value)} />
          <span className="text-xs text-gray-400">(optional — for per-wallet cost basis tracking)</span>
        </div>

        {/* Notes */}
        <div className="flex items-center gap-4">
          <span className="w-24 text-right text-gray-500">Notes:</span>
          <input className="input w-72" placeholder="Optional notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
        </div>

        <div className="pt-2">
          <button className="btn-primary" onClick={handleAdd}>➕ Add Transaction</button>
        </div>
      </div>

      {success && <div className="bg-green-50 dark:bg-green-900/20 text-green-600 p-4 rounded-lg mt-4">✅ {success}</div>}
      {error && <div className="bg-red-50 dark:bg-red-900/20 text-red-500 p-4 rounded-lg mt-4">⚠️ {error}</div>}

      {/* Duplicate Warning Modal */}
      {pendingTxn && duplicateMatches.length > 0 && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => { setPendingTxn(null); setDuplicateMatches([]); }}>
          <div className="bg-white dark:bg-zinc-900 rounded-xl p-6 max-w-lg w-full shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-bold mb-2 text-orange-500">Possible Duplicate</h3>
            <p className="text-sm text-gray-600 dark:text-gray-400 mb-3">
              A similar transaction already exists. Adding this could cause duplicate entries, which will produce incorrect tax calculations (e.g., double-counting a sale).
            </p>
            <p className="text-sm text-gray-600 dark:text-gray-400 mb-3">
              This can happen if you manually add a transaction that also appears in a CSV import.
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
              <button className="btn-secondary text-sm" onClick={() => { setPendingTxn(null); setDuplicateMatches([]); }}>Cancel</button>
              <button
                className="bg-orange-500 hover:bg-orange-600 text-white px-4 py-2 rounded-lg text-sm font-medium"
                onClick={() => commitTransaction(pendingTxn)}
              >
                Add Anyway
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
