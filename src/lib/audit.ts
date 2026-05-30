/** Audit trail for tracking all user actions */

export enum AuditAction {
  TransactionImport = "TransactionImport",
  TransactionAdd = "TransactionAdd",
  TransactionEdit = "TransactionEdit",
  TransactionDelete = "TransactionDelete",
  SaleRecorded = "SaleRecorded",
  DataCleared = "DataCleared",
  BackupCreated = "BackupCreated",
  BackupRestored = "BackupRestored",
  PINChanged = "PINChanged",
  AppUnlocked = "AppUnlocked",
}

export const AuditActionDisplayNames: Record<AuditAction, string> = {
  [AuditAction.TransactionImport]: "Transactions Imported",
  [AuditAction.TransactionAdd]: "Transaction Added",
  [AuditAction.TransactionEdit]: "Transaction Edited",
  [AuditAction.TransactionDelete]: "Transaction Deleted",
  [AuditAction.SaleRecorded]: "Sale Recorded",
  [AuditAction.DataCleared]: "Data Cleared",
  [AuditAction.BackupCreated]: "Backup Created",
  [AuditAction.BackupRestored]: "Backup Restored",
  [AuditAction.PINChanged]: "PIN Changed",
  [AuditAction.AppUnlocked]: "App Unlocked",
};

export interface AuditEntry {
  id: string;
  timestamp: string; // ISO 8601
  action: AuditAction;
  details: string;
}

export function createAuditEntry(action: AuditAction, details: string): AuditEntry {
  return {
    id: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    action,
    details,
  };
}

/** Maximum audit-log entries retained. Older entries are rotated out. */
export const AUDIT_LOG_MAX = 5000;

/**
 * Cap the audit log to the most recent `max` entries, dropping the oldest.
 * Returns the same array reference when already within the cap (no copy).
 * Centralizes rotation so every append/persist site stays bounded — the
 * high-frequency AppUnlocked entry previously bypassed an inline cap and
 * could grow the log without limit.
 */
export function capAuditLog(entries: AuditEntry[], max: number = AUDIT_LOG_MAX): AuditEntry[] {
  return entries.length > max ? entries.slice(entries.length - max) : entries;
}
