import { useState, useRef } from "react";
import { useAppState } from "../lib/app-state";
import { SetupPIN } from "./SetupPIN";

export function SettingsView() {
  const state = useAppState();
  const [showChangePIN, setShowChangePIN] = useState(false);
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [backupStatus, setBackupStatus] = useState<string | null>(null);
  const [restoreStatus, setRestoreStatus] = useState<string | null>(null);
  const [showRestoreConfirm, setShowRestoreConfirm] = useState(false);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  if (showChangePIN) {
    return <SetupPIN isInitialSetup={false} onDone={() => setShowChangePIN(false)} />;
  }

  return (
    <div className="p-8 max-w-3xl">
      <h1 className="text-3xl font-bold mb-6">Settings</h1>

      {/* Appearance */}
      <div className="card mb-4">
        <h3 className="font-semibold mb-3">🎨 Appearance</h3>
        <div className="flex items-center justify-between">
          <span className="text-gray-500">Theme</span>
          <div className="segmented">
            {[
              { value: null, label: "System" },
              { value: "light", label: "Light" },
              { value: "dark", label: "Dark" },
            ].map((opt) => (
              <button
                key={opt.label}
                className={`segmented-btn ${state.appearanceMode === opt.value ? "active" : ""}`}
                onClick={() => state.setAppearanceMode(opt.value)}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Privacy & Security */}
      <div className="card mb-4">
        <h3 className="font-semibold mb-3">🔒 Privacy & Security</h3>
        <div className="flex items-center justify-between mb-3">
          <span className="text-gray-500">PIN Lock</span>
          <button className="btn-secondary text-sm" onClick={() => setShowChangePIN(true)}>
            Change PIN
          </button>
        </div>
        <div className="flex items-center justify-between">
          <div>
            <span className="text-gray-500">Hide Amounts</span>
            <p className="text-xs text-gray-400">Blur all BTC and USD values for privacy</p>
          </div>
          <label className="relative inline-flex items-center cursor-pointer">
            <input
              type="checkbox"
              checked={state.privacyBlur}
              onChange={(e) => state.setPrivacyBlur(e.target.checked)}
              className="sr-only peer"
            />
            <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none rounded-full peer dark:bg-gray-700 peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-orange-500"></div>
          </label>
        </div>
      </div>

      {/* Data */}
      <div className="card mb-4">
        <h3 className="font-semibold mb-3">💾 Data</h3>
        <div className="flex items-center justify-between mb-2">
          <span className="text-gray-500">Transactions</span>
          <span className="tabular-nums">{state.transactions.length} imported</span>
        </div>
        <div className="flex items-center justify-between mb-3">
          <span className="text-gray-500">Recorded Sales</span>
          <span className="tabular-nums">{state.recordedSales.length} recorded</span>
        </div>
        <div className="border-t pt-3 mb-3">
          <div className="flex items-center justify-between">
            <span className="text-gray-500">Storage</span>
            <span className="text-xs text-gray-400">Browser localStorage</span>
          </div>
        </div>
        <div className="flex justify-end">
          {showClearConfirm ? (
            <div className="flex items-center gap-3">
              <span className="text-sm text-red-500">Delete all data? This cannot be undone.</span>
              <button className="btn-danger text-sm" onClick={() => { state.clearAllData(); setShowClearConfirm(false); }}>
                Confirm Delete
              </button>
              <button className="btn-secondary text-sm" onClick={() => setShowClearConfirm(false)}>Cancel</button>
            </div>
          ) : (
            <button className="btn-danger text-sm" onClick={() => setShowClearConfirm(true)}>
              Clear All Data
            </button>
          )}
        </div>
      </div>

      {/* Backup & Restore */}
      <div className="card mb-4">
        <h3 className="font-semibold mb-3">📦 Backup & Restore</h3>
        <div className="flex items-center gap-3 mb-3">
          <button
            className="btn-secondary text-sm"
            onClick={async () => {
              try {
                setBackupStatus("Creating backup...");
                await state.createBackup();
                setBackupStatus("Backup downloaded successfully!");
                setTimeout(() => setBackupStatus(null), 3000);
              } catch (e: any) {
                setBackupStatus(`Error: ${e.message}`);
              }
            }}
          >
            💾 Create Backup
          </button>
          <button
            className="btn-secondary text-sm"
            onClick={() => fileInputRef.current?.click()}
          >
            📂 Restore Backup
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".sovereigntax"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) {
                setPendingFile(file);
                setShowRestoreConfirm(true);
              }
              e.target.value = "";
            }}
          />
        </div>
        {showRestoreConfirm && pendingFile && (
          <div className="bg-orange-50 dark:bg-orange-900/20 p-3 rounded-lg flex items-center gap-3 mb-2">
            <span className="text-sm text-orange-600">Restore from {pendingFile.name}? This will overwrite all current data.</span>
            <button
              className="btn-danger text-sm"
              onClick={async () => {
                try {
                  setRestoreStatus("Restoring...");
                  await state.restoreBackup(pendingFile);
                  setRestoreStatus("Backup restored successfully!");
                  setShowRestoreConfirm(false);
                  setPendingFile(null);
                  setTimeout(() => setRestoreStatus(null), 3000);
                } catch (e: any) {
                  setRestoreStatus(`Error: ${e.message}`);
                }
              }}
            >
              Confirm Restore
            </button>
            <button className="btn-secondary text-sm" onClick={() => { setShowRestoreConfirm(false); setPendingFile(null); }}>
              Cancel
            </button>
          </div>
        )}
        {backupStatus && <p className="text-sm text-gray-500">{backupStatus}</p>}
        {restoreStatus && <p className="text-sm text-gray-500">{restoreStatus}</p>}
        <p className="text-xs text-gray-400 mt-2">
          Backups include all transactions, sales, mappings, and audit log. Files use the .sovereigntax extension.
        </p>
      </div>

      {/* About */}
      <div className="card">
        <h3 className="font-semibold mb-3">ℹ️ About</h3>
        <div className="flex items-center justify-between mb-2">
          <span className="text-gray-500">Sovereign Tax</span>
          <span>Version 1.0</span>
        </div>
        <p className="text-sm text-gray-400">
          A privacy-focused Bitcoin tax calculator. All data is stored locally on your device.
        </p>
      </div>
    </div>
  );
}
