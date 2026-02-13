import { useState, useMemo } from "react";
import { useAppState } from "../lib/app-state";
import { formatUSD, formatBTC, formatDateTime } from "../lib/utils";
import { TransactionType, TransactionTypeDisplayNames } from "../lib/types";
import { Transaction } from "../lib/models";

export function TransactionsView() {
  const { transactions, setSelectedNav } = useAppState();
  const [sortField, setSortField] = useState<keyof Transaction>("date");
  const [sortAsc, setSortAsc] = useState(true);
  const [filterType, setFilterType] = useState<TransactionType | "">("");
  const [searchText, setSearchText] = useState("");

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
          <div className="grid grid-cols-7 gap-2 py-2 text-xs font-semibold text-gray-500 bg-white dark:bg-zinc-900 border-b border-gray-200 dark:border-gray-700 sticky top-0 z-10">
            <SortHeader label="Date" field="date" current={sortField} asc={sortAsc} onClick={toggleSort} />
            <div>Type</div>
            <SortHeader label="Amount BTC" field="amountBTC" current={sortField} asc={sortAsc} onClick={toggleSort} />
            <SortHeader label="Price/BTC" field="pricePerBTC" current={sortField} asc={sortAsc} onClick={toggleSort} />
            <SortHeader label="Total USD" field="totalUSD" current={sortField} asc={sortAsc} onClick={toggleSort} />
            <SortHeader label="Exchange" field="exchange" current={sortField} asc={sortAsc} onClick={toggleSort} />
            <div>Notes</div>
          </div>

          {/* Table Body */}
          {filtered.map((t, i) => (
            <div key={t.id} className={`grid grid-cols-7 gap-2 py-1.5 text-sm ${i % 2 === 0 ? "" : "bg-gray-50 dark:bg-zinc-800/30"}`}>
              <div className="tabular-nums">{formatDateTime(t.date)}</div>
              <div className={typeColor(t.transactionType)}>
                {typeIcon(t.transactionType)} {TransactionTypeDisplayNames[t.transactionType]}
              </div>
              <div className="tabular-nums">{formatBTC(t.amountBTC)}</div>
              <div className="tabular-nums">{formatUSD(t.pricePerBTC)}</div>
              <div className="tabular-nums">{formatUSD(t.totalUSD)}</div>
              <div className="truncate">{t.exchange}</div>
              <div className="text-gray-500 truncate">{t.notes}</div>
            </div>
          ))}
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
