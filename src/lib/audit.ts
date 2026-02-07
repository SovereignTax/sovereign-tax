/** Audit trail for tracking all user actions */

export enum AuditAction {
  TransactionImport = "TransactionImport",
  TransactionAdd = "TransactionAdd",
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
