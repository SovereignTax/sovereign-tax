import { Transaction, SaleRecord, ColumnMapping, ImportRecord, Preferences } from "./models";
import { AuditEntry } from "./audit";
import { deriveEncryptionKey, encryptData, decryptData, generateSalt } from "./crypto";
import { saveTextFile } from "./file-save";

/**
 * Encrypted backup format (v2):
 * The .sovereigntax file contains a JSON envelope with an encrypted data payload.
 * Encryption: AES-256-GCM with a key derived from a user-chosen backup password
 * via PBKDF2-HMAC-SHA256 (600,000 iterations).
 *
 * Backward compatibility: v1 backups (plaintext JSON) are detected and parsed
 * with a warning that they are unencrypted.
 */

const BACKUP_VERSION = 2;

export interface BackupData {
  transactions: Transaction[];
  recordedSales: SaleRecord[];
  mappings: Record<string, ColumnMapping>;
  importHistory: Record<string, ImportRecord>;
  auditLog: AuditEntry[];
  preferences: Preferences;
}

/** v2 encrypted backup envelope */
export interface EncryptedBackupBundle {
  version: 2;
  created: string;
  salt: string; // Hex-encoded PBKDF2 salt for password key derivation
  encrypted: string; // Base64-encoded AES-256-GCM ciphertext of BackupData JSON
}

/** v1 legacy plaintext backup (for backward compatibility) */
export interface LegacyBackupBundle {
  version: 1;
  created: string;
  checksum: string;
  data: BackupData;
}

export type BackupBundle = EncryptedBackupBundle | LegacyBackupBundle;

/** Result of parsing a backup — includes the data and whether it was encrypted */
export interface BackupParseResult {
  data: BackupData;
  wasEncrypted: boolean;
  created: string;
}

/** Compute SHA-256 hash for integrity check (used by legacy v1 format) */
async function computeChecksum(data: string): Promise<string> {
  const encoded = new TextEncoder().encode(data);
  const hashBuffer = await crypto.subtle.digest("SHA-256", encoded);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Create an encrypted backup bundle.
 * Derives an AES-256-GCM key from the password via PBKDF2, encrypts all data.
 */
export async function createBackupBundle(
  transactions: Transaction[],
  recordedSales: SaleRecord[],
  mappings: Record<string, ColumnMapping>,
  importHistory: Record<string, ImportRecord>,
  auditLog: AuditEntry[],
  preferences: Preferences,
  password: string
): Promise<EncryptedBackupBundle> {
  const data: BackupData = {
    transactions,
    recordedSales,
    mappings,
    importHistory,
    auditLog,
    preferences,
  };

  // Generate a fresh salt for this backup's key derivation
  const salt = generateSalt();

  // Derive AES-256-GCM key from the backup password
  const key = await deriveEncryptionKey(password, salt);

  // Encrypt the data payload
  const plaintext = JSON.stringify(data);
  const encrypted = await encryptData(plaintext, key);

  return {
    version: BACKUP_VERSION,
    created: new Date().toISOString(),
    salt,
    encrypted,
  };
}

/**
 * Parse and decrypt a backup bundle.
 * Supports both v2 (encrypted) and v1 (legacy plaintext) formats.
 *
 * @param json - Raw file content
 * @param password - Backup password (required for v2, ignored for v1)
 * @returns Parsed backup data with encryption status
 */
export async function parseBackupBundle(json: string, password?: string): Promise<BackupParseResult> {
  const parsed = JSON.parse(json);

  if (!parsed.version) {
    throw new Error("Invalid backup file format — missing version");
  }

  // v2: encrypted backup
  if (parsed.version === 2) {
    return parseEncryptedBackup(parsed as EncryptedBackupBundle, password);
  }

  // v1: legacy plaintext backup
  if (parsed.version === 1) {
    return parseLegacyBackup(parsed as LegacyBackupBundle);
  }

  throw new Error(`Unsupported backup version: ${parsed.version}`);
}

/** Detect if a backup file is v2 encrypted (used by UI to decide whether to show password prompt) */
export function isEncryptedBackup(json: string): boolean {
  try {
    const parsed = JSON.parse(json);
    return parsed.version === 2;
  } catch {
    return false;
  }
}

/** Parse v2 encrypted backup */
async function parseEncryptedBackup(
  bundle: EncryptedBackupBundle,
  password?: string
): Promise<BackupParseResult> {
  if (!bundle.salt || !bundle.encrypted) {
    throw new Error("Invalid encrypted backup — missing salt or encrypted data");
  }

  if (!password) {
    throw new Error("This backup is encrypted. A password is required to restore it.");
  }

  // Derive the decryption key from the password + stored salt
  const key = await deriveEncryptionKey(password, bundle.salt);

  // Decrypt the data payload
  let decryptedJson: string;
  try {
    decryptedJson = await decryptData(bundle.encrypted, key);
  } catch {
    throw new Error("Incorrect backup password. Please try again.");
  }

  // Parse and validate
  const data = JSON.parse(decryptedJson) as BackupData;
  validateBackupData(data);

  return {
    data,
    wasEncrypted: true,
    created: bundle.created,
  };
}

/** Parse v1 legacy plaintext backup */
async function parseLegacyBackup(bundle: LegacyBackupBundle): Promise<BackupParseResult> {
  if (!bundle.data || !bundle.checksum) {
    throw new Error("Invalid backup file format");
  }

  // Verify checksum
  const dataStr = JSON.stringify(bundle.data);
  const expectedChecksum = await computeChecksum(dataStr);
  if (expectedChecksum !== bundle.checksum) {
    throw new Error("Backup integrity check failed — file may be corrupted");
  }

  validateBackupData(bundle.data);

  return {
    data: bundle.data,
    wasEncrypted: false,
    created: bundle.created,
  };
}

/** Validate that backup data has required fields */
function validateBackupData(data: BackupData): void {
  if (!Array.isArray(data.transactions)) {
    throw new Error("Invalid backup: missing transactions array");
  }
  if (!Array.isArray(data.recordedSales)) {
    throw new Error("Invalid backup: missing recorded sales array");
  }
}

/** Save backup as .sovereigntax file via native save dialog. Returns true if saved, false if cancelled. */
export async function downloadBackup(bundle: EncryptedBackupBundle): Promise<boolean> {
  const json = JSON.stringify(bundle);
  const dateStr = new Date().toISOString().split("T")[0];
  return saveTextFile(json, {
    defaultPath: `sovereign-tax-backup-${dateStr}.sovereigntax`,
    filters: [{ name: "Sovereign Tax Backup", extensions: ["sovereigntax"] }],
  });
}
