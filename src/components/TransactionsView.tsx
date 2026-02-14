import { useState, useMemo } from "react";
import { useAppState } from "../lib/app-state";
import { formatUSD, formatBTC, formatDateTime } from "../lib/utils";
import { TransactionType, TransactionTypeDisplayNames, IncomeType, IncomeTypeDisplayNames } from "../lib/types";
import { Transaction } from "../lib/models";

export function TransactionsView() {
  const { transactions, setSelectedNav, updateTransaction, deleteTransaction } = useAppState();
  const [sortField, setSortField] = useState<keyof Transaction>("date");
  const [sortAsc, setSortAsc] = useState(true);
  const [filterType, setFilterType] = useState<TransactionType | "">("");
  const [searchText, setSearchText] = useState("");
  const [editingTxn, setEditingTxn] = useState<Transaction | null>(null);
  const [deletingTxn, setDeletingTxn] = useState<Transaction | null>(null);

  const filtered = useMemo(() => {
    let result = [...transactions];
    if (filterType) result = result.filter((t) => t.transactionType === filterType);
    if (searchText) {
      const lower = searchText.toLowerCase();
      result = result.filter((t) =>
        t.exchange.toLowerCase().includes(lower) ||
        t.notes.toLowerCase().includes(lower) ||
        TransactionTypeDisplayNames[t.transactionType].toLowerCase().includes(lower)
      );
    }
    result.sort((a, b) => {
      let cmp = 0;
      switch (sortField) {
        case "date": cmp = new Date(a.date).getTime() - new Date(b.date).getTime(); break;
        case "amountBTC": cmp = a.amountBTC - b.amountBTC; break;
        case "pricePerBTC": cmp = a.pricePerBTC - b.pricePerBTC; break;
        case "totalUSD": cmp = a.totalUSD - b.totalUSD; break;
        case "exchange": cmp = a.exchange.localeCompare(b.exchange); break;
        default: cmp = new Date(a.date).getTime() - new Date(b.date).getTime();
      }
      return sortAsc ? cmp : -cmp;
    });
    return result;
  }, [transactions, filterType, searchText, sortField, sortAsc]);

  const counts = useMemo(() => ({
    buys: transactions.filter((t) => t.transactionType === TransactionType.Buy).length,
    sells: transactions.filter((t) => t.transactionType === TransactionType.Sell).length,
    transfers: transactions.filter((t) => t.transactionType === TransactionType.TransferIn || t.transactionType === TransactionType.TransferOut).length,
  }), [transactions]);

  const toggleSort = (field: keyof Transaction) => {
    if (sortField === field) setSortAsc(!sortAsc);
    else { setSortField(field); setSortAsc(true); }
  };

  const handleDelete = () => {
    if (deletingTxn) {
      deleteTransaction(deletingTxn.id);
      setDeletingTxn(null);
    }
  };

  if (transactions.length === 0) {
    return (
      <div className="p-8 flex flex-col items-center justify-center h-full">
        <div className="text-5xl mb-4 opacity-50">📋</div>
        <h2 className="text-xl text-gray-500 mb-2">No transactions imported yet</h2>
        <button className="btn-secondary" onClick={() => setSelectedNav("import")}>Go to Import</button>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <div className="p-6 pb-3 text-center">
        <h1 className="text-3xl font-bold">All Transactions</h1>
        <p className="text-gray-500">{transactions.length} transactions imported</p>
      </div>

      {/* Toolbar */}
      <div className="flex items-center gap-4 px-6 pb-3">
        <div className="flex items-center gap-2 bg-gray-100 dark:bg-zinc-800 rounded-lg px-3 py-1.5 w-72">
          <span className="text-gray-400">🔍</span>
          <input className="bg-transparent outline-none flex-1 text-sm" placeholder="Search by exchange or notes..." value={searchText} onChange={(e) => setSearchText(e.target.value)} />
        </div>
        <select className="select text-sm" value={filterType} onChange={(e) => setFilterType(e.target.value as any)}>
          <option value="">All Types</option>
          {Object.values(TransactionType).map((t) => (
            <option key={t} value={t}>{TransactionTypeDisplayNames[t]}</option>
          ))}
        </select>
        <span className="flex-1" />
        <span className="text-xs"><span className="inline-block w-2 h-2 rounded-full bg-green-500 mr-1" />{counts.buys} Buys</span>
        <span className="text-xs"><span className="inline-block w-2 h-2 rounded-full bg-red-500 mr-1" />{counts.sells} Sells</span>
        <span className="text-xs"><span className="inline-block w-2 h-2 rounded-full bg-blue-500 mr-1" />{counts.transfers} Transfers</span>
      </div>

      {/* Table (scrollable with sticky header) */}
      <div className="flex-1 overflow-y-auto border-t border-gray-200 dark:border-gray-700">
        <div className="px-6">
          {/* Sticky Header */}
          <div className="grid gap-2 py-2 text-xs font-semibold text-gray-500 bg-white dark:bg-zinc-900 border-b border-gray-200 dark:border-gray-700 sticky top-0 z-10" style={{ gridTemplateColumns: '1.4fr 0.9fr 1fr 1fr 0.7fr 1fr 0.8fr 0.9fr 0.6fr' }}>
            <SortHeader label="Date" field="date" current={sortField} asc={sortAsc} onClick={toggleSort} />
            <div>Type</div>
            <SortHeader label="Amount BTC" field="amountBTC" current={sortField} asc={sortAsc} onClick={toggleSort} />
            <SortHeader label="Price/BTC" field="pricePerBTC" current={sortField} asc={sortAsc} onClick={toggleSort} />
            <div>Fee</div>
            <SortHeader label="Total USD" field="totalUSD" current={sortField} asc={sortAsc} onClick={toggleSort} />
            <SortHeader label="Exchange" field="exchange" current={sortField} asc={sortAsc} onClick={toggleSort} />
            <div>Notes</div>
            <div className="text-right">Actions</div>
          </div>

          {/* Table Body */}
          {filtered.map((t, i) => (
            <div key={t.id} className={`grid gap-2 py-1.5 text-sm items-center ${i % 2 === 0 ? "" : "bg-gray-50 dark:bg-zinc-800/30"}`} style={{ gridTemplateColumns: '1.4fr 0.9fr 1fr 1fr 0.7fr 1fr 0.8fr 0.9fr 0.6fr' }}>
              <div className="tabular-nums">{formatDateTime(t.date)}</div>
              <div className={typeColor(t.transactionType)}>
                {typeIcon(t.transactionType)} {TransactionTypeDisplayNames[t.transactionType]}
              </div>
              <div className="tabular-nums">{formatBTC(t.amountBTC)}</div>
              <div className="tabular-nums">{formatUSD(t.pricePerBTC)}</div>
              <div className="tabular-nums text-gray-400">{t.fee ? formatUSD(t.fee) : ""}</div>
              <div className="tabular-nums">{formatUSD(t.totalUSD)}</div>
              <div className="truncate">{t.exchange}</div>
              <div className="text-gray-500 truncate">{t.notes}</div>
              <div className="flex gap-1 justify-end">
                <button
                  className="text-xs px-1.5 py-0.5 rounded hover:bg-gray-200 dark:hover:bg-zinc-700 text-gray-500"
                  onClick={() => setEditingTxn({ ...t })}
                  title="Edit"
                >
                  Edit
                </button>
                <button
                  className="text-xs px-1.5 py-0.5 rounded hover:bg-red-100 dark:hover:bg-red-900/30 text-red-400"
                  onClick={() => setDeletingTxn(t)}
                  title="Delete"
                >
                  Del
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Edit Modal */}
      {editingTxn && (
        <EditModal
          txn={editingTxn}
          onSave={(updates) => {
            updateTransaction(editingTxn.id, updates);
            setEditingTxn(null);
          }}
          onClose={() => setEditingTxn(null)}
        />
      )}

      {/* Delete Confirmation */}
      {deletingTxn && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setDeletingTxn(null)}>
          <div className="bg-white dark:bg-zinc-900 rounded-xl p-6 max-w-md shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-bold mb-2">Delete Transaction?</h3>
            <p className="text-gray-500 text-sm mb-1">
              {TransactionTypeDisplayNames[deletingTxn.transactionType]} of {formatBTC(deletingTxn.amountBTC)} BTC on {formatDateTime(deletingTxn.date)}
            </p>
            <p className="text-gray-500 text-sm mb-4">
              This will permanently remove this transaction. Tax calculations will be recalculated automatically.
            </p>
            <div className="flex gap-3 justify-end">
              <button className="btn-secondary text-sm" onClick={() => setDeletingTxn(null)}>Cancel</button>
              <button className="bg-red-500 hover:bg-red-600 text-white px-4 py-2 rounded-lg text-sm font-medium" onClick={handleDelete}>Delete</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function EditModal({ txn, onSave, onClose }: { txn: Transaction; onSave: (updates: Partial<Omit<Transaction, "id">>) => void; onClose: () => void }) {
  const [type, setType] = useState(txn.transactionType);
  const [date, setDate] = useState(new Date(txn.date).toISOString().split("T")[0]);
  const [amountStr, setAmountStr] = useState(txn.amountBTC.toFixed(8));
  const [priceStr, setPriceStr] = useState(txn.pricePerBTC.toFixed(2));
  const [totalStr, setTotalStr] = useState(txn.totalUSD.toFixed(2));
  const [feeStr, setFeeStr] = useState(txn.fee ? txn.fee.toFixed(2) : "");
  const [exchange, setExchange] = useState(txn.exchange);
  const [wallet, setWallet] = useState(txn.wallet || "");
  const [notes, setNotes] = useState(txn.notes);
  const [incomeType, setIncomeType] = useState<IncomeType | "">(txn.incomeType || "");
  const [error, setError] = useState<string | null>(null);

  const handleSave = () => {
    setError(null);
    const amount = Number(amountStr);
    if (!amount || amount <= 0) { setError("Enter a valid BTC amount"); return; }
    const price = Number(priceStr);
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

    onSave({
      date: new Date(date + "T12:00:00").toISOString(),
      transactionType: type,
      amountBTC: amount,
      pricePerBTC: adjustedPrice,
      totalUSD: adjustedTotal,
      fee: fee > 0 ? fee : undefined,
      exchange: exchange || "Manual",
      wallet: wallet || exchange || "Manual",
      incomeType: type === TransactionType.Buy && incomeType ? incomeType : undefined,
      notes,
    });
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-white dark:bg-zinc-900 rounded-xl p-6 max-w-lg w-full shadow-2xl max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-lg font-bold mb-4">Edit Transaction</h3>

        <div className="space-y-3">
          {/* Type */}
          <div className="flex items-center gap-3">
            <span className="w-20 text-right text-gray-500 text-sm">Type:</span>
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
            <div className="flex items-center gap-3">
              <span className="w-20 text-right text-gray-500 text-sm">Income:</span>
              <select className="select w-44 text-sm" value={incomeType} onChange={(e) => setIncomeType(e.target.value as IncomeType | "")}>
                <option value="">Not Income</option>
                {Object.values(IncomeType).map((it) => (
                  <option key={it} value={it}>{IncomeTypeDisplayNames[it]}</option>
                ))}
              </select>
            </div>
          )}

          {/* Date */}
          <div className="flex items-center gap-3">
            <span className="w-20 text-right text-gray-500 text-sm">Date:</span>
            <input type="date" className="input w-44 text-sm" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>

          {/* Amount */}
          <div className="flex items-center gap-3">
            <span className="w-20 text-right text-gray-500 text-sm">BTC Amt:</span>
            <input className="input w-44 text-sm" value={amountStr} onChange={(e) => setAmountStr(e.target.value)} />
          </div>

          {/* Price */}
          <div className="flex items-center gap-3">
            <span className="w-20 text-right text-gray-500 text-sm">Price/BTC:</span>
            <input className="input w-44 text-sm" value={priceStr} onChange={(e) => setPriceStr(e.target.value)} />
          </div>

          {/* Total */}
          <div className="flex items-center gap-3">
            <span className="w-20 text-right text-gray-500 text-sm">Total USD:</span>
            <input className="input w-44 text-sm" value={totalStr} onChange={(e) => setTotalStr(e.target.value)} />
            <span className="text-xs text-gray-400">(before fee adj.)</span>
          </div>

          {/* Fee */}
          <div className="flex items-center gap-3">
            <span className="w-20 text-right text-gray-500 text-sm">Fee USD:</span>
            <input className="input w-44 text-sm" placeholder="0.00" value={feeStr} onChange={(e) => setFeeStr(e.target.value)} />
          </div>

          {/* Exchange */}
          <div className="flex items-center gap-3">
            <span className="w-20 text-right text-gray-500 text-sm">Exchange:</span>
            <input className="input w-44 text-sm" value={exchange} onChange={(e) => setExchange(e.target.value)} />
          </div>

          {/* Wallet */}
          <div className="flex items-center gap-3">
            <span className="w-20 text-right text-gray-500 text-sm">Wallet:</span>
            <input className="input w-44 text-sm" placeholder="Defaults to exchange" value={wallet} onChange={(e) => setWallet(e.target.value)} />
          </div>

          {/* Notes */}
          <div className="flex items-center gap-3">
            <span className="w-20 text-right text-gray-500 text-sm">Notes:</span>
            <input className="input w-64 text-sm" value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
        </div>

        {error && <div className="text-red-500 text-sm mt-3">{error}</div>}

        <div className="flex gap-3 justify-end mt-5">
          <button className="btn-secondary text-sm" onClick={onClose}>Cancel</button>
          <button className="btn-primary text-sm" onClick={handleSave}>Save Changes</button>
        </div>
      </div>
    </div>
  );
}

function SortHeader({ label, field, current, asc, onClick }: { label: string; field: string; current: string; asc: boolean; onClick: (f: any) => void }) {
  return (
    <div className="cursor-pointer select-none flex items-center gap-1" onClick={() => onClick(field)}>
      {label}
      {current === field && <span className="text-orange-500">{asc ? "▲" : "▼"}</span>}
    </div>
  );
}

function typeColor(type: TransactionType): string {
  switch (type) {
    case TransactionType.Buy: return "text-green-600";
    case TransactionType.Sell: return "text-red-500";
    case TransactionType.TransferIn: return "text-blue-500";
    case TransactionType.TransferOut: return "text-orange-500";
  }
}

function typeIcon(type: TransactionType): string {
  switch (type) {
    case TransactionType.Buy: return "↓";
    case TransactionType.Sell: return "↑";
    case TransactionType.TransferIn: return "→";
    case TransactionType.TransferOut: return "←";
  }
}
