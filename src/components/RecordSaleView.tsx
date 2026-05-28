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
  const [usingSavedSelections, setUsingSavedSelections] = useState(false);

  const fullResult = useMemo(() => calculate(state.allTransactions, method, state.recordedSales), [state.allTransactions, method, state.recordedSales]);

  const isSpecificID = method === AccountingMethod.SpecificID;

  // Check for saved lot selections from Simulation
  const saved = state.savedLotSelections;
  const hasSavedSelections = isSpecificID && saved !== null
    && saved.method === AccountingMethod.SpecificID
    && (saved.wallet.toLowerCase() === selectedWallet.toLowerCase()) // wallet match (case-insensitive; both "" = all wallets)
    && !showLotPicker && !lotSelections && !preview;

  // Multi-wallet warning: check if selected wallet has enough BTC
  const walletBTCAvailable = useMemo(() => {
    if (!selectedWallet) return null;
    const walletNorm = selectedWallet.trim().toLowerCase();
    return fullResult.lots
      .filter((l) => l.remainingBTC > 0 && (l.wallet || l.exchange || "").toLowerCase() === walletNorm)
      .reduce((sum, l) => sum + l.remainingBTC, 0);
  }, [selectedWallet, fullResult.lots]);
  const requestedAmount = Number(amountStr) || 0;
  const showWalletWarning = selectedWallet && walletBTCAvailable !== null && requestedAmount > 0 && requestedAmount > walletBTCAvailable + 0.00000001;

  const useSavedSelections = () => {
    if (!saved) return;
    setError(null); setSuccess(null);
    // Pre-fill amount from saved if not already set
    if (!amountStr) setAmountStr(String(saved.amountBTC));
    setUsingSavedSelections(true);
    setShowLotPicker(true);
    setPreview(null);
  };

  const generatePreview = () => {
    setError(null); setSuccess(null);
    const amount = Number(amountStr);
    const price = useLive ? state.priceState.currentPrice! : Number(priceStr);
    if (!amount || amount <= 0) { setError("Enter valid amount"); return; }
    if (!price || price <= 0) { setError("Enter valid price"); return; }

    if (isSpecificID) {
      // Show lot picker instead of auto-preview
      setUsingSavedSelections(false);
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

  const commitSale = async () => {
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
    await state.addTransaction(txn);
    // Link the SaleRecord to the source transaction for collision-proof Specific ID lookup
    await state.recordSale({ ...preview, sourceTransactionId: txn.id });
    // Clear saved lot selections — lots are now consumed
    state.setSavedLotSelections(null);
    setSuccess("Sale recorded successfully");
    setPreview(null);
    setLotSelections(null);
    setUsingSavedSelections(false);
    setPendingConfirm(false);
    setDuplicateMatches([]);
    setAmountStr(""); setPriceStr("");
  };

  const confirmSale = async () => {
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

    await commitSale();
  };

  return (
    <div className="p-8 max-w-4xl">
      <h1 className="text-3xl font-bold mb-1">Record Sale</h1>
      <HelpPanel subtitle="Record an actual sale to permanently consume lots and generate a taxable event." />

      <div className="card mb-6">
        <div className="flex gap-4 mb-4 flex-wrap">
          <div>
            <label className="text-xs text-gray-500 block mb-1">Sale Date</label>
            <input type="date" className="input" value={saleDate} min="2009-01-03" max="2099-12-31" onChange={(e) => { setSaleDate(e.target.value); setPreview(null); setLotSelections(null); setShowLotPicker(false); setUsingSavedSelections(false); }} />
          </div>
          <div>
            <label className="text-xs text-gray-500 block mb-1">BTC Amount</label>
            <input className="input w-44" placeholder="0.00000000" value={amountStr} onChange={(e) => { setAmountStr(e.target.value); setPreview(null); setLotSelections(null); setShowLotPicker(false); setUsingSavedSelections(false); }} />
          </div>
          <div>
            <div className="flex items-center gap-2 mb-1">
              <label className="text-xs text-gray-500">Price/BTC</label>
              <label className="flex items-center gap-1 text-xs"><input type="checkbox" checked={useLive} onChange={(e) => { setUseLive(e.target.checked); if (e.target.checked) state.fetchPrice(); setPreview(null); setLotSelections(null); setShowLotPicker(false); setUsingSavedSelections(false); }} /> Live</label>
            </div>
            {useLive ? (
              <div className="text-lg font-medium tabular-nums h-8">{state.priceState.currentPrice ? formatUSD(state.priceState.currentPrice) : "..."}</div>
            ) : (
              <input className="input w-44" placeholder="0.00" value={priceStr} onChange={(e) => { setPriceStr(e.target.value); setPreview(null); setLotSelections(null); setShowLotPicker(false); setUsingSavedSelections(false); }} />
            )}
          </div>
          <div>
            <label className="text-xs text-gray-500 block mb-1">Method</label>
            <select className="select" value={method} onChange={(e) => { setMethod(e.target.value as AccountingMethod); setPreview(null); setShowLotPicker(false); setLotSelections(null); setUsingSavedSelections(false); }}>
              {Object.values(AccountingMethod).map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
          </div>
          {state.availableWallets.length > 1 && (
            <div>
              <label className="text-xs text-gray-500 block mb-1">Wallet</label>
              <select className="select" value={selectedWallet} onChange={(e) => { setSelectedWallet(e.target.value); setPreview(null); setLotSelections(null); setShowLotPicker(false); setUsingSavedSelections(false); }}>
                <option value="">All Wallets</option>
                {state.availableWallets.map((w) => <option key={w} value={w}>{w}</option>)}
              </select>
            </div>
          )}
        </div>
        {showWalletWarning && (
          <div className="bg-orange-50 dark:bg-orange-900/20 text-orange-600 dark:text-orange-400 text-xs p-2 rounded-lg mt-2">
            ⚠️ Only {formatBTC(walletBTCAvailable!)} BTC available in "{selectedWallet}". Per IRS rules (TD 9989), you cannot mix lots across wallets in a single sale. Record separate sales from each wallet, or transfer BTC between wallets first.
          </div>
        )}
        {hasSavedSelections && saved && (
          <div className="bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-400 text-sm p-3 rounded-lg mt-3 flex items-center justify-between">
            <span>📋 You have saved lot selections from Simulation ({formatBTC(saved.amountBTC)} BTC{saved.wallet ? ` in ${saved.wallet}` : ""})</span>
            <button className="btn-primary text-xs px-3 py-1" onClick={useSavedSelections}>Use Saved Selections</button>
          </div>
        )}
        <div className="flex gap-3 mt-3">
          <button className="btn-secondary" onClick={generatePreview}>
            {isSpecificID ? "🔍 Select Lots" : "👁️ Preview"}
          </button>
          {preview && <button className="btn-primary" onClick={async () => { await confirmSale(); }}>✅ Record Sale</button>}
        </div>
      </div>

      {error && <div className="bg-red-50 dark:bg-red-900/20 text-red-500 p-4 rounded-lg mb-6">⚠️ {error}</div>}
      {success && <div className="bg-green-50 dark:bg-green-900/20 text-green-600 p-4 rounded-lg mb-6">✅ {success}</div>}

      {/* Lot Picker for Specific ID — filtered to selected wallet */}
      {showLotPicker && (
        <div className="mb-6">
          <LotPicker
            lots={selectedWallet
              ? fullResult.lots.filter((l) => (l.wallet || l.exchange || "").toLowerCase() === selectedWallet.toLowerCase())
              : fullResult.lots}
            targetAmount={Number(amountStr)}
            saleDate={new Date(saleDate + "T12:00:00").toISOString()}
            salePrice={useLive ? state.priceState.currentPrice || undefined : Number(priceStr) || undefined}
            initialSelections={usingSavedSelections && saved ? saved.lotSelections : undefined}
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
                onClick={async () => { await commitSale(); }}
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
