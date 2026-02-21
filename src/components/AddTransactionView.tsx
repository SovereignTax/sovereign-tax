import { useState, useCallback, useMemo } from "react";
import { useAppState } from "../lib/app-state";
import { createTransaction, Transaction, SaleRecord } from "../lib/models";
import { TransactionType, TransactionTypeDisplayNames, IncomeType, IncomeTypeDisplayNames } from "../lib/types";
import { AccountingMethod } from "../lib/types";
import { formatUSD, formatBTC, formatDate, formatDateTime, findSimilarTransactions } from "../lib/utils";
import { calculate, simulateSale, LotSelection } from "../lib/cost-basis";
import { LotPicker } from "./LotPicker";
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

  // Disposition (Sell/Donation) lot preview state
  const [dispositionMethod, setDispositionMethod] = useState(AccountingMethod.FIFO);
  const [dispositionPreview, setDispositionPreview] = useState<SaleRecord | null>(null);
  const [showLotPicker, setShowLotPicker] = useState(false);
  const [lotSelections, setLotSelections] = useState<LotSelection[] | null>(null);

  // Current lots for disposition preview (Sell or Donation)
  const isDisposition = type === TransactionType.Sell || type === TransactionType.Donation;
  const currentLots = useMemo(() => {
    if (!isDisposition) return [];
    return calculate(state.allTransactions, dispositionMethod, state.recordedSales).lots;
  }, [state.allTransactions, dispositionMethod, isDisposition, state.recordedSales]);

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

  const isSpecificID = isDisposition && dispositionMethod === AccountingMethod.SpecificID;
  const [usingSavedSelections, setUsingSavedSelections] = useState(false);

  // Check for saved lot selections from Simulation
  const saved = state.savedLotSelections;
  const hasSavedSelections = isSpecificID && saved !== null
    && saved.method === AccountingMethod.SpecificID
    && (saved.wallet.toLowerCase() === (wallet || "").toLowerCase()) // wallet match (case-insensitive)
    && !showLotPicker && !lotSelections && !dispositionPreview;

  // Multi-wallet warning: check if selected wallet has enough BTC for the disposition
  const walletBTCAvailable = useMemo(() => {
    if (!isDisposition || !wallet) return null;
    const walletNorm = wallet.trim().toLowerCase();
    return currentLots
      .filter((l) => l.remainingBTC > 0 && (l.wallet || l.exchange || "").toLowerCase() === walletNorm)
      .reduce((sum, l) => sum + l.remainingBTC, 0);
  }, [isDisposition, wallet, currentLots]);
  const requestedAmount = Number(amountStr) || 0;
  const showWalletWarning = isDisposition && wallet && walletBTCAvailable !== null && requestedAmount > 0 && requestedAmount > walletBTCAvailable + 0.00000001;

  /** Use saved lot selections from Simulation to pre-fill the LotPicker */
  const useSavedSelectionsHandler = () => {
    if (!saved) return;
    setError(null);
    if (!amountStr) setAmountStr(String(saved.amountBTC));
    setUsingSavedSelections(true);
    setShowLotPicker(true);
    setDispositionPreview(null);
    setLotSelections(null);
  };

  /** Preview which lots will be consumed by this sell or donation */
  const previewDispositionLots = () => {
    setError(null);
    setDispositionPreview(null);
    const amount = Number(amountStr);
    if (!amount || amount <= 0) { setError("Enter a valid BTC amount to preview"); return; }

    if (isSpecificID) {
      // Show lot picker for manual selection
      setUsingSavedSelections(false);
      setShowLotPicker(true);
      setLotSelections(null);
      return;
    }

    const walletFilter = wallet || undefined;
    const dateISO = new Date(date + "T12:00:00").toISOString();
    const isDonation = type === TransactionType.Donation;
    const price = isDonation ? 0 : (useLive ? state.priceState.currentPrice! : Number(priceStr));
    const sim = simulateSale(amount, price, currentLots, dispositionMethod, undefined, walletFilter, dateISO);
    if (!sim) { setError(`Not enough BTC in available lots for this ${isDonation ? "donation" : "sell"} amount`); return; }
    setDispositionPreview(sim);
  };

  /** Handle lot picker confirmation for Specific ID dispositions */
  const handleDispositionLotConfirm = (selections: LotSelection[]) => {
    setShowLotPicker(false);
    setLotSelections(selections);
    const amount = Number(amountStr);
    const walletFilter = wallet || undefined;
    const dateISO = new Date(date + "T12:00:00").toISOString();
    const isDonation = type === TransactionType.Donation;
    const price = isDonation ? 0 : (useLive ? state.priceState.currentPrice! : Number(priceStr));
    const sim = simulateSale(amount, price, currentLots, AccountingMethod.SpecificID, selections, walletFilter, dateISO);
    if (!sim) { setError("Not enough BTC from selected lots"); return; }
    setDispositionPreview(sim);
  };

  const handleDispositionLotCancel = () => {
    setShowLotPicker(false);
  };

  const commitTransaction = async (txn: Transaction) => {
    await state.addTransaction(txn);

    // For Specific ID dispositions (Sell or Donation), save the SaleRecord as a permanent lot election
    if (dispositionMethod === AccountingMethod.SpecificID && dispositionPreview && lotSelections) {
      if (txn.transactionType === TransactionType.Donation) {
        const price = useLive ? state.priceState.currentPrice! : Number(priceStr);
        const saleRecord: SaleRecord = {
          ...dispositionPreview,
          id: crypto.randomUUID(),
          saleDate: txn.date,
          isDonation: true,
          donationFmvPerBTC: price,
          donationFmvTotal: dispositionPreview.amountSold * price,
          method: AccountingMethod.SpecificID,
          sourceTransactionId: txn.id,
        };
        await state.recordSale(saleRecord);
      } else if (txn.transactionType === TransactionType.Sell) {
        const saleRecord: SaleRecord = {
          ...dispositionPreview,
          id: crypto.randomUUID(),
          saleDate: txn.date,
          method: AccountingMethod.SpecificID,
          sourceTransactionId: txn.id,
        };
        await state.recordSale(saleRecord);
      }
    }

    // Clear saved lot selections after any disposition — lots may have been consumed by FIFO or Specific ID
    if (isDisposition) {
      state.setSavedLotSelections(null);
    }
    setSuccess(`${TransactionTypeDisplayNames[txn.transactionType]} of ${formatBTC(txn.amountBTC)} BTC added`);
    setAmountStr(""); setPriceStr(""); setTotalStr(""); setFeeStr(""); setWallet(""); setNotes(""); setIncomeType("");
    setPendingTxn(null);
    setDuplicateMatches([]);
    setDispositionPreview(null);
    setLotSelections(null);
    setShowLotPicker(false);
    setUsingSavedSelections(false);
  };

  const handleAdd = async () => {
    setError(null); setSuccess(null);
    const amount = Number(amountStr);
    if (!amount || amount <= 0) { setError("Enter a valid BTC amount"); return; }
    const price = useLive ? state.priceState.currentPrice! : Number(priceStr);
    const isTransfer = type === TransactionType.TransferIn || type === TransactionType.TransferOut;
    if (!isTransfer && (!price || price <= 0)) { setError(type === TransactionType.Donation ? "Enter the Fair Market Value (FMV) per BTC on the date of donation" : "Enter a valid price"); return; }
    let total = Number(totalStr);
    if (!total || total <= 0) total = amount * (price || 0);
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

    await commitTransaction(txn);
  };

  return (
    <div className="p-8 max-w-3xl">
      <h1 className="text-3xl font-bold mb-1">Add Transaction</h1>
      <HelpPanel subtitle="Manually add a buy, sell, transfer, donation, or income transaction that wasn't in a CSV import." />

      <div className="card space-y-4">
        {/* Type */}
        <div className="flex items-center gap-4">
          <span className="w-24 text-right text-gray-500">Type:</span>
          <div className="segmented">
            {Object.values(TransactionType).map((t) => (
              <button key={t} className={`segmented-btn ${type === t ? "active" : ""}`} onClick={() => { setType(t); setWallet(""); setDispositionPreview(null); setLotSelections(null); setShowLotPicker(false); setUsingSavedSelections(false); }}>
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

        {/* Method Selector (Sell + Donation) */}
        {isDisposition && (
          <div className="flex items-center gap-4">
            <span className="w-24 text-right text-gray-500">Method:</span>
            <div className="segmented">
              {[AccountingMethod.FIFO, AccountingMethod.SpecificID].map((m) => (
                <button key={m} className={`segmented-btn ${dispositionMethod === m ? "active" : ""}`} onClick={() => { setDispositionMethod(m); setDispositionPreview(null); setShowLotPicker(false); setLotSelections(null); setUsingSavedSelections(false); }}>
                  {m}
                </button>
              ))}
            </div>
            <span className="text-xs text-gray-400">{isSpecificID ? "Choose exactly which lots to dispose" : "FIFO — IRS default, sells oldest lots first"}</span>
          </div>
        )}

        {/* Wallet Filter (Sell + Donation — filter lots by wallet) */}
        {isDisposition && state.availableWallets.length > 1 && (
          <div className="flex items-center gap-4">
            <span className="w-24 text-right text-gray-500">Wallet:</span>
            <select className="select w-48" value={wallet} onChange={(e) => { setWallet(e.target.value); setDispositionPreview(null); setLotSelections(null); setShowLotPicker(false); setUsingSavedSelections(false); }}>
              <option value="">All Wallets</option>
              {state.availableWallets.map((w) => <option key={w} value={w}>{w}</option>)}
            </select>
            <span className="text-xs text-gray-400">Filter lots to a specific wallet/exchange</span>
          </div>
        )}

        {/* Date */}
        <div className="flex items-center gap-4">
          <span className="w-24 text-right text-gray-500">Date:</span>
          <input type="date" className="input w-48" value={date} onChange={(e) => { setDate(e.target.value); setDispositionPreview(null); setLotSelections(null); setShowLotPicker(false); setUsingSavedSelections(false); }} />
        </div>

        {/* Amount */}
        <div className="flex items-center gap-4">
          <span className="w-24 text-right text-gray-500">BTC Amount:</span>
          <input className="input w-48" placeholder="0.00000000" value={amountStr} onChange={(e) => { setAmountStr(e.target.value); setDispositionPreview(null); setLotSelections(null); setShowLotPicker(false); setUsingSavedSelections(false); }} />
        </div>

        {/* Price */}
        <div className="flex items-center gap-4">
          <span className="w-24 text-right text-gray-500">{type === TransactionType.Donation ? "FMV/BTC:" : "Price/BTC:"}</span>
          {useLive ? (
            <span className="font-medium tabular-nums">{state.priceState.currentPrice ? formatUSD(state.priceState.currentPrice) : "..."}</span>
          ) : (
            <input className="input w-48" placeholder="0.00" value={priceStr} onChange={(e) => { setPriceStr(e.target.value); setDispositionPreview(null); setLotSelections(null); setShowLotPicker(false); setUsingSavedSelections(false); }} />
          )}
          <label className="flex items-center gap-1 text-sm">
            <input type="checkbox" checked={useLive} onChange={(e) => { setUseLive(e.target.checked); if (e.target.checked) state.fetchPrice(); setDispositionPreview(null); setLotSelections(null); setShowLotPicker(false); setUsingSavedSelections(false); }} />
            Live Price
          </label>
          {((type === TransactionType.Buy && incomeType) || type === TransactionType.Donation) && !useLive && state.livePriceEnabled && (
            <button
              className="btn-secondary text-xs px-3 py-1"
              onClick={fetchFMV}
              disabled={fmvLoading || !date}
            >
              {fmvLoading ? "Fetching..." : "Fetch FMV"}
            </button>
          )}
        </div>
        {type === TransactionType.Donation && (
          <div className="flex items-center gap-4">
            <span className="w-24" />
            <span className="text-xs text-purple-500">Donations consume lots but are not taxable events. Enter FMV for your charitable deduction records.</span>
          </div>
        )}

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
          <input className="input w-48" placeholder="e.g., Coinbase" value={exchange} onChange={(e) => { setExchange(e.target.value); setDispositionPreview(null); setLotSelections(null); setShowLotPicker(false); setUsingSavedSelections(false); }} />
        </div>

        {/* Wallet — hide when From Wallet dropdown is shown (dispositions with multiple wallets) */}
        {!(isDisposition && state.availableWallets.length > 1) && (
        <div className="flex items-center gap-4">
          <span className="w-24 text-right text-gray-500">Wallet:</span>
          <input className="input w-48" list="wallet-options" placeholder="Defaults to exchange" value={wallet} onChange={(e) => { setWallet(e.target.value); setDispositionPreview(null); setLotSelections(null); setShowLotPicker(false); setUsingSavedSelections(false); }} />
          <datalist id="wallet-options">
            {state.availableWallets.map((w) => <option key={w} value={w} />)}
          </datalist>
          <span className="text-xs text-gray-400">(optional — for per-wallet cost basis tracking)</span>
        </div>
        )}
        {showWalletWarning && (
          <div className="flex items-center gap-4">
            <span className="w-24" />
            <div className="bg-orange-50 dark:bg-orange-900/20 text-orange-600 dark:text-orange-400 text-xs p-2 rounded-lg">
              ⚠️ Only {formatBTC(walletBTCAvailable!)} BTC available in "{wallet}". Per IRS rules (TD 9989), you cannot mix lots across wallets in a single sale. Record separate sales from each wallet, or transfer BTC between wallets first.
            </div>
          </div>
        )}

        {/* Notes */}
        <div className="flex items-center gap-4">
          <span className="w-24 text-right text-gray-500">Notes:</span>
          <input className="input w-72" placeholder="Optional notes" value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={100} />
          <span className="text-xs text-gray-400">{notes.length}/100</span>
        </div>

        {hasSavedSelections && saved && (
          <div className="flex items-center gap-4">
            <span className="w-24" />
            <div className="bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-400 text-sm p-3 rounded-lg flex items-center justify-between flex-1">
              <span>📋 Saved lot selections from Simulation ({formatBTC(saved.amountBTC)} BTC{saved.wallet ? ` in ${saved.wallet}` : ""})</span>
              <button className="btn-primary text-xs px-3 py-1" onClick={useSavedSelectionsHandler}>Use Saved Selections</button>
            </div>
          </div>
        )}

        <div className="flex gap-3 pt-2">
          <button
            className="btn-primary"
            disabled={isSpecificID && !lotSelections}
            title={isSpecificID && !lotSelections ? "Select lots first using the button to the right" : undefined}
            onClick={async () => { await handleAdd(); }}
          >➕ Add Transaction</button>
          {isDisposition && (
            <button className="btn-secondary" onClick={previewDispositionLots}>
              {isSpecificID ? "🔍 Select Lots" : "🔍 Preview Lot Consumption"}
            </button>
          )}
        </div>
      </div>

      {/* Lot Picker for Specific ID (Sell + Donation) */}
      {showLotPicker && isSpecificID && (
        <div className="mt-4">
          <LotPicker
            lots={wallet
              ? currentLots.filter((l) => (l.wallet || l.exchange || "").toLowerCase() === wallet.toLowerCase())
              : currentLots}
            targetAmount={Number(amountStr)}
            saleDate={date ? new Date(date + "T12:00:00").toISOString() : undefined}
            salePrice={type === TransactionType.Sell ? (useLive ? state.priceState.currentPrice || undefined : Number(priceStr) || undefined) : undefined}
            initialSelections={usingSavedSelections && saved ? saved.lotSelections : undefined}
            onConfirm={handleDispositionLotConfirm}
            onCancel={handleDispositionLotCancel}
          />
        </div>
      )}

      {/* Disposition Lot Preview (Sell + Donation) */}
      {dispositionPreview && isDisposition && (
        <div className={`card mt-4 border-l-4 ${type === TransactionType.Donation ? "border-l-purple-500" : "border-l-orange-500"}`}>
          <div className="flex items-center justify-between mb-3">
            <h3 className={`font-semibold ${type === TransactionType.Donation ? "text-purple-700 dark:text-purple-400" : ""}`}>
              Lot Consumption Preview ({dispositionMethod})
            </h3>
            <span className={`text-xs font-medium ${type === TransactionType.Donation ? "text-purple-500" : "text-orange-500"}`}>PREVIEW — not yet recorded</span>
          </div>
          {isSpecificID && lotSelections && (
            <div className="text-xs text-blue-500 mb-2">Using Specific Identification — {lotSelections.length} lot(s) manually selected</div>
          )}
          {type === TransactionType.Donation && (
            <p className="text-xs text-gray-500 mb-3">
              These lots will be consumed when this donation is processed. Long-term lots (held &gt;1 year) qualify for a deduction at full Fair Market Value. Short-term lots are deductible at cost basis only.
            </p>
          )}
          {type === TransactionType.Sell && (
            <p className="text-xs text-gray-500 mb-3">
              These lots will be consumed by this sale. The cost basis determines your capital gain or loss for Form 8949.
            </p>
          )}

          {/* Lot details table */}
          <div className="grid grid-cols-[1fr_1fr_1fr_1fr_1fr_1fr] gap-2 text-xs font-semibold text-gray-500 pb-2 border-b border-gray-200 dark:border-gray-700 mb-1">
            <div>Purchase Date</div>
            <div>Wallet</div>
            <div className="text-right">BTC Amount</div>
            <div className="text-right">Cost Basis</div>
            <div className="text-right">Days Held</div>
            <div>Term</div>
          </div>
          {dispositionPreview.lotDetails.map((d, idx) => (
            <div key={idx} className="grid grid-cols-[1fr_1fr_1fr_1fr_1fr_1fr] gap-2 py-1.5 text-sm border-b border-gray-100 dark:border-gray-800">
              <div>{formatDate(d.purchaseDate)}</div>
              <div className="text-xs text-gray-500 truncate" title={d.wallet || d.exchange}>{d.wallet || d.exchange}</div>
              <div className="text-right tabular-nums">{formatBTC(d.amountBTC)}</div>
              <div className="text-right tabular-nums">{formatUSD(d.totalCost)}</div>
              <div className="text-right tabular-nums">{d.daysHeld}</div>
              <div>
                <span className={`badge ${d.isLongTerm ? "badge-green" : "badge-orange"} text-xs`}>
                  {d.isLongTerm ? "Long-term" : "Short-term"}
                </span>
              </div>
            </div>
          ))}

          {/* Summary */}
          <div className="mt-3 flex gap-6 text-sm flex-wrap">
            <div>
              <span className="text-gray-500">Total BTC:</span>{" "}
              <span className="tabular-nums font-medium">{formatBTC(dispositionPreview.amountSold)}</span>
            </div>
            <div>
              <span className="text-gray-500">Total Cost Basis:</span>{" "}
              <span className="tabular-nums font-medium">{formatUSD(dispositionPreview.costBasis)}</span>
            </div>
            {type === TransactionType.Sell && (
              <>
                <div>
                  <span className="text-gray-500">Proceeds:</span>{" "}
                  <span className="tabular-nums font-medium">{formatUSD(dispositionPreview.totalProceeds)}</span>
                </div>
                <div>
                  <span className="text-gray-500">Gain/Loss:</span>{" "}
                  <span className={`tabular-nums font-semibold ${dispositionPreview.gainLoss >= 0 ? "text-green-600" : "text-red-500"}`}>
                    {dispositionPreview.gainLoss >= 0 ? "+" : ""}{formatUSD(dispositionPreview.gainLoss)}
                  </span>
                </div>
              </>
            )}
            <div>
              <span className="text-gray-500">Term:</span>{" "}
              <span className={`badge ${dispositionPreview.isLongTerm ? "badge-green" : dispositionPreview.isMixedTerm ? "badge-blue" : "badge-orange"} text-xs`}>
                {dispositionPreview.isMixedTerm ? "Mixed" : dispositionPreview.isLongTerm ? "Long-term" : "Short-term"}
              </span>
            </div>
          </div>
        </div>
      )}

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
                onClick={async () => { await commitTransaction(pendingTxn); }}
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
