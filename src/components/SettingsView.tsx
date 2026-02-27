import { useState, useRef } from "react";
import { useAppState } from "../lib/app-state";
import { SetupPIN } from "./SetupPIN";
import { openUrl } from "@tauri-apps/plugin-opener";
import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import { HelpPanel } from "./HelpPanel";
import { isEncryptedBackup } from "../lib/backup";

const APP_VERSION = __APP_VERSION__;
const VERSION_CHECK_URL = "https://raw.githubusercontent.com/sovereigntax/sovereign-tax/main/version.json";

/** Compare two semver strings. Returns -1 if a < b, 0 if equal, 1 if a > b. */
function compareSemver(a: string, b: string): number {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const na = pa[i] ?? 0;
    const nb = pb[i] ?? 0;
    if (na < nb) return -1;
    if (na > nb) return 1;
  }
  return 0;
}

export function SettingsView() {
  const state = useAppState();
  const [showChangePIN, setShowChangePIN] = useState(false);
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [backupStatus, setBackupStatus] = useState<string | null>(null);
  const [restoreStatus, setRestoreStatus] = useState<string | null>(null);
  const [showRestoreConfirm, setShowRestoreConfirm] = useState(false);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [pendingFileIsEncrypted, setPendingFileIsEncrypted] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [updateStatus, setUpdateStatus] = useState<{ type: "checking" | "up-to-date" | "available" | "error"; message: string; downloadUrl?: string } | null>(null);

  // Backup password modal state
  const [showBackupPasswordModal, setShowBackupPasswordModal] = useState(false);
  const [backupPassword, setBackupPassword] = useState("");
  const [backupPasswordConfirm, setBackupPasswordConfirm] = useState("");
  const [backupPasswordError, setBackupPasswordError] = useState<string | null>(null);

  // Restore password modal state
  const [showRestorePasswordModal, setShowRestorePasswordModal] = useState(false);
  const [restorePassword, setRestorePassword] = useState("");
  const [restorePasswordError, setRestorePasswordError] = useState<string | null>(null);

  if (showChangePIN) {
    return <SetupPIN isInitialSetup={false} onDone={() => setShowChangePIN(false)} />;
  }

  return (
    <div className="p-8 max-w-3xl">
      <h1 className="text-3xl font-bold mb-1">Settings</h1>
      <HelpPanel subtitle="Appearance, security, data management, and backup/restore." />

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
        <div className="flex items-center justify-between mb-3">
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
        <div className="flex items-center justify-between">
          <div>
            <span className="text-gray-500">Live BTC Price</span>
            <p className="text-xs text-gray-400">Fetch current price from CoinGecko (requires internet)</p>
          </div>
          <label className="relative inline-flex items-center cursor-pointer">
            <input
              type="checkbox"
              checked={state.livePriceEnabled}
              onChange={(e) => state.setLivePriceEnabled(e.target.checked)}
              className="sr-only peer"
            />
            <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none rounded-full peer dark:bg-gray-700 peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-orange-500"></div>
          </label>
        </div>
      </div>

      {/* Tax Settings */}
      <div className="card mb-4">
        <h3 className="font-semibold mb-3">📊 Tax Settings</h3>
        <div className="flex items-center justify-between">
          <div>
            <span className="text-gray-500">Prior-Year Capital Loss Carryforward</span>
            <p className="text-xs text-gray-400">Loss amount carried forward from prior tax years (IRS Schedule D)</p>
          </div>
          <div className="flex items-center gap-1">
            <span className="text-gray-500 text-sm">$</span>
            <input
              type="number"
              className="input w-28 text-sm text-right tabular-nums"
              value={state.priorCarryforward === 0 ? "" : Math.abs(state.priorCarryforward)}
              onChange={(e) => {
                const val = e.target.value;
                state.setPriorCarryforward(val === "" ? 0 : -Math.abs(Number(val)));
              }}
              placeholder="0"
              min="0"
              step="1"
            />
          </div>
        </div>
        <p className="text-xs text-gray-500 mt-2">Enter the total capital loss carryforward from your prior-year Schedule D. This is factored into the Tax Report's carryforward calculation.</p>
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
              <button className="btn-danger text-sm" onClick={async () => { await state.clearAllData(); setShowClearConfirm(false); }}>
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
            onClick={() => {
              setBackupPassword("");
              setBackupPasswordConfirm("");
              setBackupPasswordError(null);
              setShowBackupPasswordModal(true);
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
            onChange={async (e) => {
              const file = e.target.files?.[0];
              if (file) {
                // Read file to check if it's v2 encrypted or v1 legacy
                try {
                  const text = await file.text();
                  const encrypted = isEncryptedBackup(text);
                  setPendingFile(file);
                  setPendingFileIsEncrypted(encrypted);
                  if (encrypted) {
                    // Show password prompt for encrypted backup
                    setRestorePassword("");
                    setRestorePasswordError(null);
                    setShowRestorePasswordModal(true);
                  } else {
                    // Legacy unencrypted backup — show confirmation with warning
                    setShowRestoreConfirm(true);
                  }
                } catch {
                  setRestoreStatus("Error: Could not read backup file");
                }
              }
              e.target.value = "";
            }}
          />
        </div>

        {/* Create Backup Password Modal */}
        {showBackupPasswordModal && (
          <div className="bg-orange-50 dark:bg-orange-900/20 border border-orange-200 dark:border-orange-800 p-4 rounded-lg mb-3">
            <h4 className="font-semibold text-sm mb-1">Set Backup Password</h4>
            <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">
              Your backup will be encrypted with AES-256-GCM using this password.
              <strong className="text-orange-600 dark:text-orange-400"> You will need this password to restore this backup. </strong>
              If you lose it, the backup cannot be recovered.
            </p>
            <div className="space-y-2 mb-3">
              <input
                type="password"
                placeholder="Enter backup password"
                className="input w-full text-sm"
                value={backupPassword}
                onChange={(e) => { setBackupPassword(e.target.value); setBackupPasswordError(null); }}
                autoFocus
                onKeyDown={(e) => { if (e.key === "Enter") document.getElementById("backup-confirm-input")?.focus(); }}
              />
              <input
                id="backup-confirm-input"
                type="password"
                placeholder="Confirm backup password"
                className="input w-full text-sm"
                value={backupPasswordConfirm}
                onChange={(e) => { setBackupPasswordConfirm(e.target.value); setBackupPasswordError(null); }}
                onKeyDown={async (e) => {
                  if (e.key === "Enter" && backupPassword && backupPassword.length >= 4 && backupPassword === backupPasswordConfirm) {
                    try {
                      setShowBackupPasswordModal(false);
                      setBackupStatus("Encrypting and creating backup...");
                      const saved = await state.createBackup(backupPassword);
                      setBackupStatus(saved ? "Encrypted backup downloaded successfully!" : "Backup cancelled.");
                      setBackupPassword("");
                      setBackupPasswordConfirm("");
                      setTimeout(() => setBackupStatus(null), 3000);
                    } catch (err: any) {
                      setBackupStatus(`Error: ${err.message}`);
                    }
                  }
                }}
              />
            </div>
            {backupPasswordError && <p className="text-xs text-red-500 mb-2">{backupPasswordError}</p>}
            <div className="flex items-center gap-2">
              <button
                className="btn-primary text-sm"
                disabled={!backupPassword || backupPassword.length < 1}
                onClick={async () => {
                  if (backupPassword !== backupPasswordConfirm) {
                    setBackupPasswordError("Passwords do not match");
                    return;
                  }
                  if (backupPassword.length < 4) {
                    setBackupPasswordError("Password must be at least 4 characters");
                    return;
                  }
                  try {
                    setShowBackupPasswordModal(false);
                    setBackupStatus("Encrypting and creating backup...");
                    const saved = await state.createBackup(backupPassword);
                    setBackupStatus(saved ? "Encrypted backup downloaded successfully!" : "Backup cancelled.");
                    setBackupPassword("");
                    setBackupPasswordConfirm("");
                    setTimeout(() => setBackupStatus(null), 3000);
                  } catch (err: any) {
                    setBackupStatus(`Error: ${err.message}`);
                  }
                }}
              >
                Create Encrypted Backup
              </button>
              <button
                className="btn-secondary text-sm"
                onClick={() => { setShowBackupPasswordModal(false); setBackupPassword(""); setBackupPasswordConfirm(""); }}
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* Restore Password Modal (for v2 encrypted backups) */}
        {showRestorePasswordModal && pendingFile && (
          <div className="bg-orange-50 dark:bg-orange-900/20 border border-orange-200 dark:border-orange-800 p-4 rounded-lg mb-3">
            <h4 className="font-semibold text-sm mb-1">Enter Backup Password</h4>
            <p className="text-xs text-gray-500 dark:text-gray-400 mb-1">
              <strong>{pendingFile.name}</strong> is encrypted. Enter the password that was used when this backup was created.
            </p>
            <p className="text-xs text-orange-600 dark:text-orange-400 mb-3">
              This will overwrite all current data in the app.
            </p>
            <input
              type="password"
              placeholder="Backup password"
              className="input w-full text-sm mb-2"
              value={restorePassword}
              onChange={(e) => { setRestorePassword(e.target.value); setRestorePasswordError(null); }}
              autoFocus
              onKeyDown={async (e) => {
                if (e.key === "Enter" && restorePassword) {
                  try {
                    setShowRestorePasswordModal(false);
                    setRestoreStatus("Decrypting and restoring...");
                    await state.restoreBackup(pendingFile, restorePassword);
                    setRestoreStatus("Encrypted backup restored successfully!");
                    setPendingFile(null);
                    setRestorePassword("");
                    setTimeout(() => setRestoreStatus(null), 3000);
                  } catch (err: any) {
                    setRestorePasswordError(err.message);
                    setShowRestorePasswordModal(true);
                    setRestoreStatus(null);
                  }
                }
              }}
            />
            {restorePasswordError && <p className="text-xs text-red-500 mb-2">{restorePasswordError}</p>}
            <div className="flex items-center gap-2">
              <button
                className="btn-primary text-sm"
                disabled={!restorePassword}
                onClick={async () => {
                  try {
                    setShowRestorePasswordModal(false);
                    setRestoreStatus("Decrypting and restoring...");
                    await state.restoreBackup(pendingFile, restorePassword);
                    setRestoreStatus("Encrypted backup restored successfully!");
                    setPendingFile(null);
                    setRestorePassword("");
                    setTimeout(() => setRestoreStatus(null), 3000);
                  } catch (err: any) {
                    setRestorePasswordError(err.message);
                    setShowRestorePasswordModal(true);
                    setRestoreStatus(null);
                  }
                }}
              >
                Decrypt & Restore
              </button>
              <button
                className="btn-secondary text-sm"
                onClick={() => { setShowRestorePasswordModal(false); setPendingFile(null); setRestorePassword(""); }}
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* Legacy restore confirm (v1 unencrypted backups) */}
        {showRestoreConfirm && pendingFile && !pendingFileIsEncrypted && (
          <div className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 p-4 rounded-lg mb-3">
            <div className="flex items-start gap-2 mb-2">
              <span className="text-lg">⚠️</span>
              <div>
                <h4 className="font-semibold text-sm">Legacy Unencrypted Backup</h4>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                  <strong>{pendingFile.name}</strong> is an older backup that was not encrypted. Restoring it will overwrite all current data.
                  After restoring, we recommend creating a new encrypted backup.
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                className="btn-danger text-sm"
                onClick={async () => {
                  try {
                    setShowRestoreConfirm(false);
                    setRestoreStatus("Restoring legacy backup...");
                    await state.restoreBackup(pendingFile);
                    setRestoreStatus("Legacy backup restored successfully! Consider creating a new encrypted backup.");
                    setPendingFile(null);
                    setTimeout(() => setRestoreStatus(null), 5000);
                  } catch (err: any) {
                    setRestoreStatus(`Error: ${err.message}`);
                  }
                }}
              >
                Restore Anyway
              </button>
              <button className="btn-secondary text-sm" onClick={() => { setShowRestoreConfirm(false); setPendingFile(null); }}>
                Cancel
              </button>
            </div>
          </div>
        )}

        {backupStatus && <p className="text-sm text-gray-500 mt-2">{backupStatus}</p>}
        {restoreStatus && <p className="text-sm text-gray-500 mt-2">{restoreStatus}</p>}
        <p className="text-xs text-gray-400 mt-2">
          Backups are encrypted with AES-256-GCM using a password you choose. Files use the .sovereigntax extension.
        </p>
      </div>

      {/* About */}
      <div className="card">
        <h3 className="font-semibold mb-3">ℹ️ About</h3>
        <div className="flex items-center justify-between mb-2">
          <span className="text-gray-500">Sovereign Tax</span>
          <span>Version {APP_VERSION}</span>
        </div>
        <p className="text-sm text-gray-400 mb-4">
          A privacy-focused Bitcoin tax calculator. All data is stored locally on your device.
        </p>

        {/* Check for Updates */}
        <div className="border-t pt-3">
          <div className="flex items-center gap-3">
            <button
              className="btn-secondary text-sm"
              disabled={updateStatus?.type === "checking"}
              onClick={async () => {
                setUpdateStatus({ type: "checking", message: "Checking for updates..." });
                try {
                  let response: Response;
                  try {
                    response = await tauriFetch(VERSION_CHECK_URL, { cache: "no-store" });
                  } catch {
                    response = await window.fetch(VERSION_CHECK_URL, { cache: "no-store" });
                  }
                  if (!response.ok) throw new Error("Could not reach update server");
                  const data = await response.json();
                  const latest = data.latest;
                  if (!latest) throw new Error("Invalid response");

                  if (compareSemver(latest, APP_VERSION) <= 0) {
                    setUpdateStatus({ type: "up-to-date", message: `You're up to date! (v${APP_VERSION})` });
                  } else {
                    const notes = data.notes ? ` — ${data.notes}` : "";
                    const platform = navigator.userAgent.includes("Mac") ? "macos" : navigator.userAgent.includes("Linux") ? "linux" : "windows";
                    const downloadUrl = data.downloads?.[platform] || data.url;
                    setUpdateStatus({
                      type: "available",
                      message: `v${latest} available${notes}`,
                      downloadUrl,
                    });
                  }
                } catch (e: any) {
                  setUpdateStatus({
                    type: "error",
                    message: `Could not check for updates. Make sure you're connected to the internet.`,
                  });
                }
              }}
            >
              {updateStatus?.type === "checking" ? "Checking..." : "🔄 Check for Updates"}
            </button>
            {updateStatus && updateStatus.type !== "checking" && (
              <span
                className={`text-sm ${
                  updateStatus.type === "up-to-date"
                    ? "text-green-500"
                    : updateStatus.type === "available"
                    ? "text-orange-500 font-medium"
                    : "text-red-400"
                }`}
              >
                {updateStatus.type === "up-to-date" && "✓ "}
                {updateStatus.type === "error" && "⚠ "}
                {updateStatus.message}
              </span>
            )}
          </div>
          {updateStatus?.type === "available" && (
            <div className="mt-3 p-3 bg-orange-50 dark:bg-orange-900/20 border border-orange-200 dark:border-orange-800 rounded-lg">
              <div className="flex items-center gap-3">
                <span className="text-orange-500 text-lg">⬆</span>
                <div className="flex-1">
                  <p className="text-sm font-medium text-orange-600 dark:text-orange-400">{updateStatus.message}</p>
                  <p className="text-xs text-gray-500 mt-0.5">You have v{APP_VERSION}. Download the latest version to get new features and fixes.</p>
                </div>
                <button
                  className="btn-primary text-sm px-4 py-2"
                  onClick={() => openUrl(updateStatus.downloadUrl || "https://sovereigntax.io")}
                >
                  Download Update
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
