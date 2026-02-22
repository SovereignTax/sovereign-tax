import { useEffect } from "react";
import { useAppState } from "../lib/app-state";
import { formatUSD } from "../lib/utils";
import { timeAgo } from "../lib/utils";
import logo from "../assets/icon-128.png";

const navSections = [
  {
    title: "Data",
    items: [
      { id: "import", label: "Import", icon: "📥" },
      { id: "addTransaction", label: "Add Transaction", icon: "➕" },
      { id: "transactions", label: "Transactions", icon: "📋" },
    ],
  },
  {
    title: "Portfolio",
    items: [
      { id: "holdings", label: "Holdings", icon: "₿" },
      { id: "reconciliation", label: "Reconciliation", icon: "🔗" },
      { id: "simulation", label: "Simulate Sale", icon: "📈" },
    ],
  },
  {
    title: "Tax",
    items: [
      { id: "taxReport", label: "Tax Report", icon: "📄" },
      { id: "income", label: "Income", icon: "💰" },
      { id: "comparison", label: "Compare Methods", icon: "⚖️" },
    ],
  },
  {
    title: "Insights",
    items: [
      { id: "multiYear", label: "Multi-Year", icon: "📅" },
      { id: "taxLossHarvesting", label: "Tax Harvesting", icon: "🌾" },
      { id: "lotMaturity", label: "Lot Maturity", icon: "⏳" },
    ],
  },
];

export function Sidebar() {
  const { selectedNav, setSelectedNav, priceState, fetchPrice, livePriceEnabled } = useAppState();

  useEffect(() => {
    if (!livePriceEnabled) return;
    fetchPrice();
    const interval = setInterval(fetchPrice, 60000); // Refresh every minute
    return () => clearInterval(interval);
  }, [fetchPrice, livePriceEnabled]);

  return (
    <div className="sidebar w-56 flex flex-col h-full shrink-0">
      {/* Logo & Title */}
      <div className="px-4 pt-5 pb-3 flex items-center gap-3">
        <img src={logo} alt="Sovereign Tax" className="w-8 h-8 rounded-lg" />
        <h1 className="text-lg font-bold text-gray-800 dark:text-gray-100">
          Sovereign Tax
        </h1>
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto px-3 space-y-4">
        {navSections.map((section) => (
          <div key={section.title}>
            <div className="text-xs font-semibold text-gray-400 uppercase tracking-wider px-3 mb-1">
              {section.title}
            </div>
            {section.items.map((item) => (
              <div
                key={item.id}
                className={`sidebar-item ${selectedNav === item.id ? "active" : ""}`}
                onClick={() => setSelectedNav(item.id)}
              >
                <span>{item.icon}</span>
                <span>{item.label}</span>
              </div>
            ))}
          </div>
        ))}

        {/* Settings & Audit */}
        <div>
          <div
            className={`sidebar-item ${selectedNav === "settings" ? "active" : ""}`}
            onClick={() => setSelectedNav("settings")}
          >
            <span>⚙️</span>
            <span>Settings</span>
          </div>
          <div
            className={`sidebar-item ${selectedNav === "auditLog" ? "active" : ""}`}
            onClick={() => setSelectedNav("auditLog")}
          >
            <span>📝</span>
            <span>Audit Log</span>
          </div>
        </div>
      </nav>

      {/* Live BTC Price */}
      <div className="border-t border-gray-200 dark:border-gray-700 px-4 py-3">
        {livePriceEnabled ? (
          <>
            <div className="flex items-center gap-2">
              <span className="text-orange-500 text-lg">₿</span>
              {priceState.isLoading ? (
                <span className="text-gray-400 text-sm">Loading...</span>
              ) : priceState.currentPrice ? (
                <span className="text-base font-bold tabular-nums">
                  {formatUSD(priceState.currentPrice)}
                </span>
              ) : (
                <span className="text-gray-400 text-base">--</span>
              )}
              <span className="flex-1" />
              <button
                onClick={fetchPrice}
                className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 text-sm"
                title="Refresh price"
              >
                🔄
              </button>
            </div>
            {priceState.lastUpdated && (
              <div className="text-xs text-gray-400 mt-1">
                Updated {timeAgo(priceState.lastUpdated)}
              </div>
            )}
          </>
        ) : (
          <div className="flex items-center gap-2">
            <span className="text-gray-400 text-lg">₿</span>
            <span className="text-gray-400 text-sm">Offline mode</span>
          </div>
        )}
      </div>
    </div>
  );
}
