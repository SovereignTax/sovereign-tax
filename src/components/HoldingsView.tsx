import { useMemo } from "react";
import { useAppState } from "../lib/app-state";
import { calculate } from "../lib/cost-basis";
import { formatUSD, formatBTC, formatDate } from "../lib/utils";
import { AccountingMethod } from "../lib/types";

export function HoldingsView() {
  const { allTransactions, selectedMethod, setSelectedMethod, priceState, privacyBlur, setPrivacyBlur, setSelectedNav, selectedWallet, setSelectedWallet, availableWallets } = useAppState();

  const result = useMemo(() => calculate(allTransactions, selectedMethod), [allTransactions, selectedMethod]);

  const activeLots = result.lots.filter((l) => {
    if (l.remainingBTC <= 0) return false;
    if (selectedWallet && (l.wallet || l.exchange) !== selectedWallet) return false;
    return true;
  });
  const totalBTC = activeLots.reduce((a, l) => a + l.remainingBTC, 0);
  const totalCostBasis = activeLots.reduce((a, l) => a + l.remainingBTC * l.pricePerBTC, 0);
  const avgCostPerBTC = totalBTC > 0 ? totalCostBasis / totalBTC : 0;
  const currentValue = priceState.currentPrice ? totalBTC * priceState.currentPrice : null;
  const unrealizedGL = currentValue != null ? currentValue - totalCostBasis : null;

  const blurClass = privacyBlur ? "blur-privacy" : "";
  const blurSmClass = privacyBlur ? "blur-privacy-sm" : "";

  if (allTransactions.length === 0) {
    return (
      <div className="p-8 flex flex-col items-center justify-center h-full">
        <div className="text-6xl mb-4 opacity-50">₿</div>
        <h2 className="text-xl text-gray-500 mb-2">No Holdings</h2>
        <p className="text-gray-400 mb-4">Import transactions to see your holdings</p>
        <button className="btn-primary" onClick={() => setSelectedNav("import")}>
          Import Data
        </button>
      </div>
    );
  }

  return (
    <div className="p-8 max-w-6xl">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-3xl font-bold">Holdings</h1>
        <button
          onClick={() => setPrivacyBlur(!privacyBlur)}
          className="text-xl p-2 rounded hover:bg-gray-100 dark:hover:bg-zinc-800"
          title={privacyBlur ? "Show amounts" : "Hide amounts"}
        >
          {privacyBlur ? "🙈" : "👁️"}
        </button>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-4 gap-4 mb-6">
        <SummaryCard icon="₿" title="Total BTC" value={formatBTC(totalBTC)} color="orange" blur={blurClass} />
        <SummaryCard icon="💲" title="Cost Basis" value={formatUSD(totalCostBasis)} color="blue" blur={blurClass} />
        <SummaryCard icon="📊" title="Avg Cost/BTC" value={formatUSD(avgCostPerBTC)} color="purple" blur={blurClass} />
        {currentValue != null && unrealizedGL != null && (
          <SummaryCard
            icon="📈"
            title="Current Value"
            value={formatUSD(currentValue)}
            subtitle={`${unrealizedGL >= 0 ? "+" : ""}${formatUSD(unrealizedGL)}`}
            color={unrealizedGL >= 0 ? "green" : "red"}
            blur={blurClass}
          />
        )}
      </div>

      {/* Method Picker + Wallet Filter */}
      <div className="flex items-center justify-center gap-4 mb-6">
        <div className="segmented">
          {Object.values(AccountingMethod).map((m) => (
            <button
              key={m}
              className={`segmented-btn ${selectedMethod === m ? "active" : ""}`}
              onClick={() => setSelectedMethod(m)}
            >
              {m}
            </button>
          ))}
        </div>
        {availableWallets.length > 1 && (
          <select
            className="select text-sm"
            value={selectedWallet || ""}
            onChange={(e) => setSelectedWallet(e.target.value || null)}
          >
            <option value="">All Wallets</option>
            {availableWallets.map((w) => (
              <option key={w} value={w}>{w}</option>
            ))}
          </select>
        )}
      </div>

      {/* Lot Table */}
      <div className="card">
        <h3 className="font-semibold mb-3">Lots ({activeLots.length})</h3>
        {activeLots.length === 0 ? (
          <p className="text-gray-500">No remaining lots</p>
        ) : (
          <>
            <div className="grid grid-cols-6 gap-2 text-xs font-semibold text-gray-500 pb-2 border-b border-gray-200 dark:border-gray-700">
              <div>Date</div>
              <div className="text-right">Amount BTC</div>
              <div className="text-right">Remaining</div>
              <div className="text-right">Price/BTC</div>
              <div className="text-right">Cost Basis</div>
              <div>Exchange</div>
            </div>
            {activeLots
              .sort((a, b) => new Date(a.purchaseDate).getTime() - new Date(b.purchaseDate).getTime())
              .map((lot) => (
                <div key={lot.id} className="grid grid-cols-6 gap-2 py-2 text-sm border-b border-gray-100 dark:border-gray-800">
                  <div>{formatDate(lot.purchaseDate)}</div>
                  <div className={`text-right tabular-nums ${blurSmClass}`}>{formatBTC(lot.amountBTC)}</div>
                  <div className={`text-right tabular-nums ${blurSmClass}`}>{formatBTC(lot.remainingBTC)}</div>
                  <div className={`text-right tabular-nums ${blurSmClass}`}>{formatUSD(lot.pricePerBTC)}</div>
                  <div className={`text-right tabular-nums ${blurSmClass}`}>{formatUSD(lot.remainingBTC * lot.pricePerBTC)}</div>
                  <div className="truncate">{lot.exchange}</div>
                </div>
              ))}
          </>
        )}
      </div>
    </div>
  );
}

function SummaryCard({
  icon, title, value, subtitle, color, blur,
}: {
  icon: string; title: string; value: string; subtitle?: string; color: string; blur: string;
}) {
  const colorClasses: Record<string, string> = {
    orange: "text-orange-500",
    blue: "text-blue-500",
    purple: "text-purple-500",
    green: "text-green-500",
    red: "text-red-500",
  };

  return (
    <div className="card">
      <div className="flex items-center gap-2 mb-2">
        <span className={colorClasses[color]}>{icon}</span>
        <span className="text-xs text-gray-500">{title}</span>
      </div>
      <div className={`text-xl font-semibold tabular-nums ${blur}`}>{value}</div>
      {subtitle && (
        <div className={`text-xs tabular-nums ${colorClasses[color]} ${blur}`}>{subtitle}</div>
      )}
    </div>
  );
}
