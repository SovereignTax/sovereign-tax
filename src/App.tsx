import { AppStateProvider, useAppState } from "./lib/app-state";
import { Sidebar } from "./components/Sidebar";
import { LockScreen } from "./components/LockScreen";
import { SetupPIN } from "./components/SetupPIN";
import { HoldingsView } from "./components/HoldingsView";
import { ImportView } from "./components/ImportView";
import { TransactionsView } from "./components/TransactionsView";
import { TaxReportView } from "./components/TaxReportView";
import { SimulationView } from "./components/SimulationView";
import { RecordSaleView } from "./components/RecordSaleView";
import { AddTransactionView } from "./components/AddTransactionView";
import { ComparisonView } from "./components/ComparisonView";
import { SettingsView } from "./components/SettingsView";
import { IncomeView } from "./components/IncomeView";
import { AuditLogView } from "./components/AuditLogView";
import { TaxLossHarvestingView } from "./components/TaxLossHarvestingView";
import { MultiYearDashboardView } from "./components/MultiYearDashboardView";
import { LotMaturityView } from "./components/LotMaturityView";
import { ReconciliationView } from "./components/ReconciliationView";
import { hasPIN } from "./lib/persistence";

function AppContent() {
  const { isUnlocked, selectedNav } = useAppState();

  if (!isUnlocked) {
    if (hasPIN()) {
      return <LockScreen />;
    }
    return <SetupPIN isInitialSetup />;
  }

  const renderPage = () => {
    switch (selectedNav) {
      case "import": return <ImportView />;
      case "transactions": return <TransactionsView />;
      case "holdings": return <HoldingsView />;
      case "taxReport": return <TaxReportView />;
      case "simulation": return <SimulationView />;
      case "recordSale": return <RecordSaleView />;
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
    <div className="flex h-screen overflow-hidden">
      <Sidebar />
      <main className="flex-1 overflow-y-auto">
        {renderPage()}
      </main>
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
