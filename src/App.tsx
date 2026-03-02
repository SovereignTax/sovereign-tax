import { useState } from "react";
import { AppStateProvider, useAppState } from "./lib/app-state";
import { Sidebar } from "./components/Sidebar";
import { LockScreen } from "./components/LockScreen";
import { SetupPIN } from "./components/SetupPIN";
import { TermsOfService } from "./components/TermsOfService";
import { HoldingsView } from "./components/HoldingsView";
import { ImportView } from "./components/ImportView";
import { TransactionsView } from "./components/TransactionsView";
import { TaxReportView } from "./components/TaxReportView";
import { SimulationView } from "./components/SimulationView";
import { AddTransactionView } from "./components/AddTransactionView";
import { ComparisonView } from "./components/ComparisonView";
import { SettingsView } from "./components/SettingsView";
import { IncomeView } from "./components/IncomeView";
import { AuditLogView } from "./components/AuditLogView";
import { TaxLossHarvestingView } from "./components/TaxLossHarvestingView";
import { MultiYearDashboardView } from "./components/MultiYearDashboardView";
import { LotMaturityView } from "./components/LotMaturityView";
import { ReconciliationView } from "./components/ReconciliationView";
import { ReviewView } from "./components/ReviewView";
import { hasPIN, hasTOSAccepted } from "./lib/persistence";

function SaveErrorBanner() {
  const { saveError, clearSaveError } = useAppState();
  if (!saveError) return null;
  return (
    <div className="flex items-center gap-3 px-4 py-2.5 bg-orange-500/90 text-white text-sm shrink-0">
      <span className="shrink-0">💾</span>
      <span className="flex-1 truncate">Your data is safe in memory. We recommend creating a backup via Settings to keep a copy on disk.</span>
      <button
        onClick={clearSaveError}
        className="shrink-0 px-2 py-0.5 rounded bg-white/20 hover:bg-white/30 text-xs font-medium transition-colors"
      >
        Got it
      </button>
    </div>
  );
}

function AppContent() {
  const { isUnlocked, selectedNav } = useAppState();
  const [tosAccepted, setTosAccepted] = useState(() => hasTOSAccepted());

  if (!isUnlocked) {
    // First-time user: show TOS before PIN setup
    if (!hasPIN()) {
      if (!tosAccepted) {
        return <TermsOfService onAccepted={() => setTosAccepted(true)} />;
      }
      return <SetupPIN isInitialSetup />;
    }
    // Returning user: go straight to lock screen
    return <LockScreen />;
  }

  const renderPage = () => {
    switch (selectedNav) {
      case "import": return <ImportView />;
      case "transactions": return <TransactionsView />;
      case "holdings": return <HoldingsView />;
      case "review": return <ReviewView />;
      case "taxReport": return <TaxReportView />;
      case "simulation": return <SimulationView />;
      case "addTransaction": return <AddTransactionView />;
      case "comparison": return <ComparisonView />;
      case "income": return <IncomeView />;
      case "auditLog": return <AuditLogView />;
      case "taxLossHarvesting": return <TaxLossHarvestingView />;
      case "multiYear": return <MultiYearDashboardView />;
      case "lotMaturity": return <LotMaturityView />;
      case "reconciliation": return <ReconciliationView />;
      case "settings": return <SettingsView />;
      default: return <HoldingsView />;
    }
  };

  return (
    <div className="flex flex-col h-screen overflow-hidden">
      <SaveErrorBanner />
      {/* Help bar */}
      <div className="flex items-center justify-end px-4 py-1.5 border-b border-gray-200 dark:border-white/[0.06] bg-gray-50 dark:bg-white/[0.02] shrink-0">
        <a
          href="https://sovereigntax.io/help.html"
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs font-medium text-orange-500 hover:text-orange-400 transition-colors flex items-center gap-1.5 bg-orange-500/10 hover:bg-orange-500/15 px-3 py-1 rounded-full"
        >
          <span>❓</span>
          <span>Help Guide</span>
          <span className="text-[10px]">↗</span>
        </a>
      </div>
      <div className="flex flex-1 overflow-hidden">
        <Sidebar />
        <main className="flex-1 overflow-y-auto">
          {renderPage()}
        </main>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <AppStateProvider>
      <AppContent />
    </AppStateProvider>
  );
}
