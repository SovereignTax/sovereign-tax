import { useMemo } from "react";
import { useAppState } from "../lib/app-state";
import { calculate, daysBetween, isMoreThanOneYear } from "../lib/cost-basis";
import { formatUSD, formatBTC, formatDate } from "../lib/utils";
import { HelpPanel } from "./HelpPanel";

export function LotMaturityView() {
  const { allTransactions, selectedMethod, setSelectedNav } = useAppState();
  const result = useMemo(() => calculate(allTransactions, selectedMethod), [allTransactions, selectedMethod]);

  const now = new Date().toISOString();

  const lotsWithMaturity = useMemo(() => {
    return result.lots
      .filter((l) => l.remainingBTC > 0)
      .map((lot) => {
        const daysHeld = daysBetween(lot.purchaseDate, now);
        // Long-term = held more than 1 calendar year (IRC §1222, handles leap years)
        const ltDate = new Date(lot.purchaseDate);
        ltDate.setFullYear(ltDate.getFullYear() + 1);
        ltDate.setDate(ltDate.getDate() + 1); // Day after 1 year anniversary
        const longTermDate = ltDate.toISOString();
        const isLongTerm = isMoreThanOneYear(lot.purchaseDate, now);
        const daysUntilLongTerm = isLongTerm ? 0 : Math.max(0, daysBetween(now, longTermDate));
        return { ...lot, daysHeld, daysUntilLongTerm, longTermDate, isLongTerm };
      })
      .sort((a, b) => a.daysUntilLongTerm - b.daysUntilLongTerm);
  }, [result.lots, now]);

  const approaching30 = lotsWithMaturity.filter((l) => !l.isLongTerm && l.daysUntilLongTerm <= 30);
  const approaching90 = lotsWithMaturity.filter((l) => !l.isLongTerm && l.daysUntilLongTerm > 30 && l.daysUntilLongTerm <= 90);
  const shortTerm = lotsWithMaturity.filter((l) => !l.isLongTerm && l.daysUntilLongTerm > 90);
  const longTerm = lotsWithMaturity.filter((l) => l.isLongTerm);

  const getBadge = (daysUntilLT: number, isLT: boolean) => {
    if (isLT) return <span className="badge badge-green text-xs">Long-term</span>;
    if (daysUntilLT <= 30) return <span className="badge badge-red text-xs">{daysUntilLT}d left</span>;
    if (daysUntilLT <= 90) return <span className="badge badge-orange text-xs">{daysUntilLT}d left</span>;
    return <span className="badge badge-blue text-xs">{daysUntilLT}d left</span>;
  };

  if (lotsWithMaturity.length === 0) {
    return (
      <div className="p-8 flex flex-col items-center justify-center h-full">
        <div className="text-5xl mb-4 opacity-50">⏳</div>
        <h2 className="text-xl text-gray-500 mb-2">No active lots</h2>
        <p className="text-gray-400 mb-4">Import buy transactions to track lot maturity</p>
        <button className="btn-secondary" onClick={() => setSelectedNav("import")}>Go to Import</button>
      </div>
    );
  }

  return (
    <div className="p-8 max-w-5xl">
      <h1 className="text-3xl font-bold mb-1">Lot Maturity</h1>
      <HelpPanel subtitle="Track when each lot crosses the one-year holding threshold for long-term capital gains treatment." />

      {/* Summary Cards */}
      <div className="grid grid-cols-4 gap-4 mb-6">
        {approaching30.length > 0 && (
          <div className="card border-l-4 border-red-500">
            <div className="text-xs text-gray-500 mb-1">Maturing in 30 days</div>
            <div className="text-xl font-semibold">{approaching30.length} lots</div>
            <div className="text-xs text-gray-400">{formatBTC(approaching30.reduce((a, l) => a + l.remainingBTC, 0))} BTC</div>
          </div>
        )}
        {approaching90.length > 0 && (
          <div className="card border-l-4 border-orange-500">
            <div className="text-xs text-gray-500 mb-1">Maturing 31-90 days</div>
            <div className="text-xl font-semibold">{approaching90.length} lots</div>
            <div className="text-xs text-gray-400">{formatBTC(approaching90.reduce((a, l) => a + l.remainingBTC, 0))} BTC</div>
          </div>
        )}
        <div className="card border-l-4 border-blue-500">
          <div className="text-xs text-gray-500 mb-1">Short-term (91+ days)</div>
          <div className="text-xl font-semibold">{shortTerm.length} lots</div>
          <div className="text-xs text-gray-400">{formatBTC(shortTerm.reduce((a, l) => a + l.remainingBTC, 0))} BTC</div>
        </div>
        <div className="card border-l-4 border-green-500">
          <div className="text-xs text-gray-500 mb-1">Long-term</div>
          <div className="text-xl font-semibold">{longTerm.length} lots</div>
          <div className="text-xs text-gray-400">{formatBTC(longTerm.reduce((a, l) => a + l.remainingBTC, 0))} BTC</div>
        </div>
      </div>

      {/* Lot Table */}
      <div className="card">
        <h3 className="font-semibold mb-3">All Active Lots ({lotsWithMaturity.length})</h3>
        <div className="grid grid-cols-7 gap-2 text-xs font-semibold text-gray-500 pb-2 border-b border-gray-200 dark:border-gray-700">
          <div>Purchase Date</div>
          <div className="text-right">BTC</div>
          <div className="text-right">Cost/BTC</div>
          <div className="text-right">Days Held</div>
          <div>Long-term Date</div>
          <div>Status</div>
          <div>Exchange</div>
        </div>
        {lotsWithMaturity.map((lot) => (
          <div key={lot.id} className="grid grid-cols-7 gap-2 py-2 text-sm border-b border-gray-100 dark:border-gray-800">
            <div>{formatDate(lot.purchaseDate)}</div>
            <div className="text-right tabular-nums">{formatBTC(lot.remainingBTC)}</div>
            <div className="text-right tabular-nums">{formatUSD(lot.pricePerBTC)}</div>
            <div className="text-right tabular-nums">{lot.daysHeld}</div>
            <div>{lot.isLongTerm ? "—" : formatDate(lot.longTermDate)}</div>
            <div>{getBadge(lot.daysUntilLongTerm, lot.isLongTerm)}</div>
            <div className="truncate">{lot.exchange}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
