import { Transaction, SaleRecord, ColumnMapping, ImportRecord, Preferences } from "./models";
import { AccountingMethod } from "./types";
import { encryptData, decryptData, isEncryptedData } from "./crypto";
import { AuditEntry } from "./audit";

/**
 * Persistence service using localStorage for cross-platform compatibility.
 * Supports AES-256-GCM encryption for sensitive data.
 * Works in both Tauri and browser contexts.
 */

const KEYS = {
  transactions: "sovereign-tax-transactions",
  recordedSales: "sovereign-tax-recorded-sales",
  exchangeMappings: "sovereign-tax-exchange-mappings",
  importHistory: "sovereign-tax-import-history",
  preferences: "sovereign-tax-preferences",
  pinHash: "sovereign-tax-pin-hash",
  pinSalt: "sovereign-tax-pin-salt",
  pinAttempts: "sovereign-tax-pin-attempts",
  pinLockoutUntil: "sovereign-tax-pin-lockout-until",
  encryptionSalt: "sovereign-tax-encryption-salt",
  auditLog: "sovereign-tax-audit-log",
  priceCache: "sovereign-tax-price-cache",
  tosAccepted: "sovereign-tax-tos-accepted",
};

/** Keys that hold sensitive financial data and should be encrypted */
const ENCRYPTED_KEYS = new Set([
  KEYS.transactions,
  KEYS.recordedSales,
  KEYS.exchangeMappings,
  KEYS.importHistory,
  KEYS.auditLog,
]);

// ======================================================================
// Encryption key management — held in memory during unlocked session
// ======================================================================

let _encryptionKey: CryptoKey | null = null;

export function setEncryptionKey(key: CryptoKey | null): void {
  _encryptionKey = key;
}

export function getEncryptionKey(): CryptoKey | null {
  return _encryptionKey;
}

// ======================================================================
// Core I/O — plaintext (for unencrypted keys) and encrypted
// ======================================================================

function loadJSON<T>(key: string): T | null {
  try {
    const data = localStorage.getItem(key);
    if (!data) return null;
    return JSON.parse(data) as T;
  } catch {
    return null;
  }
}

function saveJSON<T>(key: string, value: T): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (e) {
    console.error(`Failed to save ${key}:`, e);
  }
}

/** Load and decrypt data for an encrypted key. Falls back to plaintext if not yet encrypted. */
async function loadEncrypted<T>(key: string): Promise<T | null> {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;

    // If we have an encryption key and the data is encrypted, decrypt it
    if (_encryptionKey && isEncryptedData(raw)) {
      const json = await decryptData(raw, _encryptionKey);
      return JSON.parse(json) as T;
    }

    // Otherwise try to parse as plain JSON (migration scenario)
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

/** Encrypt and save data. Falls back to plaintext if no encryption key. */
async function saveEncrypted<T>(key: string, value: T): Promise<void> {
  try {
    const json = JSON.stringify(value);
    if (_encryptionKey) {
      const encrypted = await encryptData(json, _encryptionKey);
      localStorage.setItem(key, encrypted);
    } else {
      // No encryption key yet — save as plaintext (will be encrypted on next unlock)
      localStorage.setItem(key, json);
    }
  } catch (e) {
    console.error(`Failed to save ${key}:`, e);
  }
}

// ======================================================================
// Migration: encrypt any remaining plaintext data
// ======================================================================

/**
 * Migrate all sensitive data from plaintext to encrypted format.
 * Called once after unlock when encryption key is established.
 */
export async function migrateToEncrypted(): Promise<void> {
  if (!_encryptionKey) return;

  for (const key of ENCRYPTED_KEYS) {
    const raw = localStorage.getItem(key);
    if (!raw) continue;

    // Skip if already encrypted
    if (isEncryptedData(raw)) continue;

    // It's plaintext JSON — encrypt it
    try {
      const encrypted = await encryptData(raw, _encryptionKey);
      localStorage.setItem(key, encrypted);
    } catch (e) {
      console.error(`Failed to migrate ${key} to encrypted:`, e);
    }
  }
}

// ======================================================================
// Data accessors — async versions for encrypted data
// ======================================================================

// Transactions
export async function loadTransactionsAsync(): Promise<Transaction[]> {
  return (await loadEncrypted<Transaction[]>(KEYS.transactions)) ?? [];
}

export async function saveTransactionsAsync(transactions: Transaction[]): Promise<void> {
  await saveEncrypted(KEYS.transactions, transactions);
}

// Synchronous fallback for initial load before unlock
export function loadTransactions(): Transaction[] {
  return loadJSON<Transaction[]>(KEYS.transactions) ?? [];
}

export function saveTransactions(transactions: Transaction[]): void {
  // Fire-and-forget async save if encryption key is available
  if (_encryptionKey) {
    saveEncrypted(KEYS.transactions, transactions);
  } else {
    saveJSON(KEYS.transactions, transactions);
  }
}

// Recorded Sales
export async function loadRecordedSalesAsync(): Promise<SaleRecord[]> {
  return (await loadEncrypted<SaleRecord[]>(KEYS.recordedSales)) ?? [];
}

export async function saveRecordedSalesAsync(sales: SaleRecord[]): Promise<void> {
  await saveEncrypted(KEYS.recordedSales, sales);
}

export function loadRecordedSales(): SaleRecord[] {
  return loadJSON<SaleRecord[]>(KEYS.recordedSales) ?? [];
}

export function saveRecordedSales(sales: SaleRecord[]): void {
  if (_encryptionKey) {
    saveEncrypted(KEYS.recordedSales, sales);
  } else {
    saveJSON(KEYS.recordedSales, sales);
  }
}

// Exchange Mappings
export function loadMappings(): Record<string, ColumnMapping> {
  return loadJSON<Record<string, ColumnMapping>>(KEYS.exchangeMappings) ?? {};
}

export function saveMappings(mappings: Record<string, ColumnMapping>): void {
  if (_encryptionKey) {
    saveEncrypted(KEYS.exchangeMappings, mappings);
  } else {
    saveJSON(KEYS.exchangeMappings, mappings);
  }
}

// Import History
export function loadImportHistory(): Record<string, ImportRecord> {
  return loadJSON<Record<string, ImportRecord>>(KEYS.importHistory) ?? {};
}

export async function loadImportHistoryAsync(): Promise<Record<string, ImportRecord>> {
  return (await loadEncrypted<Record<string, ImportRecord>>(KEYS.importHistory)) ?? {};
}

export function saveImportHistory(history: Record<string, ImportRecord>): void {
  if (_encryptionKey) {
    saveEncrypted(KEYS.importHistory, history);
  } else {
    saveJSON(KEYS.importHistory, history);
  }
}

// Preferences (not encrypted — contains no sensitive financial data)
export function loadPreferences(): Preferences {
  const prefs = loadJSON<Preferences>(KEYS.preferences);
  return {
    selectedYear: new Date().getFullYear(),
    selectedMethod: AccountingMethod.FIFO,
    appearanceMode: null,
    privacyBlur: false,
    livePriceEnabled: true,
    ...prefs,
  };
}

export function savePreferences(prefs: Preferences): void {
  saveJSON(KEYS.preferences, prefs);
}

// ======================================================================
// PIN management (not encrypted — needed before unlock)
// ======================================================================

export function loadPINHash(): string | null {
  return localStorage.getItem(KEYS.pinHash);
}

export function loadPINSalt(): string | null {
  return localStorage.getItem(KEYS.pinSalt);
}

export function savePINHash(hash: string): void {
  localStorage.setItem(KEYS.pinHash, hash);
}

export function savePINSalt(salt: string): void {
  localStorage.setItem(KEYS.pinSalt, salt);
}

export function deletePINHash(): void {
  localStorage.removeItem(KEYS.pinHash);
  localStorage.removeItem(KEYS.pinSalt);
}

export function hasPIN(): boolean {
  return !!localStorage.getItem(KEYS.pinHash);
}

// Encryption salt (separate from PIN salt — used to derive encryption key)
export function loadEncryptionSalt(): string | null {
  return localStorage.getItem(KEYS.encryptionSalt);
}

export function saveEncryptionSalt(salt: string): void {
  localStorage.setItem(KEYS.encryptionSalt, salt);
}

// ======================================================================
// PIN rate limiting
// ======================================================================

export function loadPINAttempts(): number {
  return parseInt(localStorage.getItem(KEYS.pinAttempts) ?? "0", 10);
}

export function savePINAttempts(attempts: number): void {
  localStorage.setItem(KEYS.pinAttempts, String(attempts));
}

export function loadPINLockoutUntil(): number {
  return parseInt(localStorage.getItem(KEYS.pinLockoutUntil) ?? "0", 10);
}

export function savePINLockoutUntil(timestamp: number): void {
  localStorage.setItem(KEYS.pinLockoutUntil, String(timestamp));
}

export function clearPINAttempts(): void {
  localStorage.removeItem(KEYS.pinAttempts);
  localStorage.removeItem(KEYS.pinLockoutUntil);
}

// ======================================================================
// Audit Log (encrypted — survives clearAllData)
// ======================================================================

export async function loadAuditLogAsync(): Promise<AuditEntry[]> {
  return (await loadEncrypted<AuditEntry[]>(KEYS.auditLog)) ?? [];
}

export function saveAuditLog(entries: AuditEntry[]): void {
  if (_encryptionKey) {
    saveEncrypted(KEYS.auditLog, entries);
  } else {
    saveJSON(KEYS.auditLog, entries);
  }
}

// ======================================================================
// Price Cache (plaintext — not sensitive)
// ======================================================================

export function loadPriceCache(): Record<string, number> {
  return loadJSON<Record<string, number>>(KEYS.priceCache) ?? {};
}

export function savePriceCache(cache: Record<string, number>): void {
  saveJSON(KEYS.priceCache, cache);
}

// ======================================================================
// Bulk load/restore for backup
// ======================================================================

export async function loadAllDataForBackup(): Promise<{
  transactions: Transaction[];
  recordedSales: SaleRecord[];
  mappings: Record<string, ColumnMapping>;
  importHistory: Record<string, ImportRecord>;
  auditLog: AuditEntry[];
  preferences: Preferences;
}> {
  const transactions = await loadTransactionsAsync();
  const recordedSales = await loadRecordedSalesAsync();
  const mappings = loadMappings();
  const importHistory = await loadImportHistoryAsync();
  const auditLog = await loadAuditLogAsync();
  const preferences = loadPreferences();
  return { transactions, recordedSales, mappings, importHistory, auditLog, preferences };
}

export async function restoreAllData(data: {
  transactions: Transaction[];
  recordedSales: SaleRecord[];
  mappings: Record<string, ColumnMapping>;
  importHistory: Record<string, ImportRecord>;
  auditLog: AuditEntry[];
  preferences: Preferences;
}): Promise<void> {
  await saveTransactionsAsync(data.transactions);
  await saveRecordedSalesAsync(data.recordedSales);
  saveMappings(data.mappings);
  saveImportHistory(data.importHistory);
  saveAuditLog(data.auditLog);
  savePreferences(data.preferences);
}

// ======================================================================
// Terms of Service acceptance
// ======================================================================

export function hasTOSAccepted(): boolean {
  return localStorage.getItem(KEYS.tosAccepted) === "true";
}

export function saveTOSAccepted(): void {
  localStorage.setItem(KEYS.tosAccepted, "true");
}

// ======================================================================
// Clear all data
// ======================================================================

export function clearAllData(): void {
  // Remove all encrypted data keys EXCEPT audit log
  for (const key of ENCRYPTED_KEYS) {
    if (key === KEYS.auditLog) continue; // Audit log survives data clears
    localStorage.removeItem(key);
  }
  // Reset preferences to defaults
  savePreferences({
    selectedYear: new Date().getFullYear(),
    selectedMethod: AccountingMethod.FIFO,
    appearanceMode: null,
    privacyBlur: false,
    livePriceEnabled: true,
    selectedWallet: null,
  });
}
