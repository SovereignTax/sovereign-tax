import { useState } from "react";
import { useAppState } from "../lib/app-state";
import { createTransaction } from "../lib/models";
import { TransactionType, TransactionTypeDisplayNames, IncomeType, IncomeTypeDisplayNames } from "../lib/types";
import { formatUSD } from "../lib/utils";

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
  const [success, setSuccess] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

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
      date: new Date(date).toISOString(),
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
    state.addTransaction(txn);
    setSuccess(`${TransactionTypeDisplayNames[type]} of ${amountStr} BTC added`);
    setAmountStr(""); setPriceStr(""); setTotalStr(""); setFeeStr(""); setWallet(""); setNotes(""); setIncomeType("");
  };

  return (
    <div className="p-8 max-w-3xl">
      <h1 className="text-3xl font-bold mb-6">Add Transaction</h1>

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
            <span className="text-xs text-gray-400">(optional — for mining, staking, airdrops)</span>
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
    </div>
  );
}
