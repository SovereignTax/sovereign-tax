import { Transaction, SaleRecord, ColumnMapping, ImportRecord, Preferences } from "./models";
import { AuditEntry } from "./audit";

export interface BackupBundle {
  version: number;
  created: string;
  checksum: string;
  data: {
    transactions: Transaction[];
    recordedSales: SaleRecord[];
    mappings: Record<string, ColumnMapping>;
    importHistory: Record<string, ImportRecord>;
    auditLog: AuditEntry[];
    preferences: Preferences;
  };
}

/** Compute SHA-256 hash for integrity check */
async function computeChecksum(data: string): Promise<string> {
  const encoded = new TextEncoder().encode(data);
  const hashBuffer = await crypto.subtle.digest("SHA-256", encoded);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Create a backup bundle from current app data */
export async function createBackupBundle(
  transactions: Transaction[],
  recordedSales: SaleRecord[],
  mappings: Record<string, ColumnMapping>,
  importHistory: Record<string, ImportRecord>,
  auditLog: AuditEntry[],
  preferences: Preferences
): Promise<BackupBundle> {
  const data = {
    transactions,
    recordedSales,
    mappings,
    importHistory,
    auditLog,
    preferences,
  };

  const dataStr = JSON.stringify(data);
  const checksum = await computeChecksum(dataStr);

  return {
    version: 1,
    created: new Date().toISOString(),
    checksum,
    data,
  };
}

/** Parse and validate a backup bundle from JSON string */
export async function parseBackupBundle(json: string): Promise<BackupBundle> {
  const bundle = JSON.parse(json) as BackupBundle;

  if (!bundle.version || !bundle.data || !bundle.checksum) {
    throw new Error("Invalid backup file format");
  }

  if (bundle.version !== 1) {
    throw new Error(`Unsupported backup version: ${bundle.version}`);
  }

  // Verify checksum
  const dataStr = JSON.stringify(bundle.data);
  const expectedChecksum = await computeChecksum(dataStr);
  if (expectedChecksum !== bundle.checksum) {
    throw new Error("Backup integrity check failed — file may be corrupted");
  }

  // Validate required data
  if (!Array.isArray(bundle.data.transactions)) {
    throw new Error("Invalid backup: missing transactions array");
  }
  if (!Array.isArray(bundle.data.recordedSales)) {
    throw new Error("Invalid backup: missing recorded sales array");
  }

  return bundle;
}

/** Download backup as .sovereigntax file */
export function downloadBackup(bundle: BackupBundle): void {
  const json = JSON.stringify(bundle, null, 2);
  const blob = new Blob([json], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  const dateStr = new Date().toISOString().split("T")[0];
  a.download = `sovereign-tax-backup-${dateStr}.sovereigntax`;
  a.click();
  URL.revokeObjectURL(url);
}
