import { Transaction, SaleRecord, ColumnMapping, ImportRecord, Preferences } from "./models";
import { AccountingMethod } from "./types";
import { encryptData, decryptData, isEncryptedData } from "./crypto";
import { AuditEntry } from "./audit";
import {
  readTextFile,
  writeTextFile,
  exists,
  mkdir,
  remove,
  BaseDirectory,
} from "@tauri-apps/plugin-fs";

/**
 * Persistence service — hybrid storage:
 *   - Large encrypted data → Tauri filesystem ($APPDATA/data/*.dat) — no size limit
 *   - Small sync data (PIN, salt, prefs) → localStorage — fast synchronous access
 * Falls back to localStorage for everything when running in browser (Vite dev server).
 * Supports AES-256-GCM encryption for sensitive data.
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
  prevEncryptionSalt: "sovereign-tax-prev-encryption-salt",
  auditLog: "sovereign-tax-audit-log",
  priceCache: "sovereign-tax-price-cache",
  tosAccepted: "sovereign-tax-tos-accepted",
};

/** Map localStorage keys → filesystem filenames inside $APPDATA/data/ */
const FS_FILENAMES: Record<string, string> = {
  [KEYS.transactions]: "data/transactions.dat",
  [KEYS.recordedSales]: "data/recorded-sales.dat",
  [KEYS.exchangeMappings]: "data/exchange-mappings.dat",
  [KEYS.importHistory]: "data/import-history.dat",
  [KEYS.auditLog]: "data/audit-log.dat",
};

/** Error thrown when data exists but cannot be decrypted (wrong key / corrupt data). */
export class DecryptionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DecryptionError";
  }
}

/** Error thrown when localStorage quota is exceeded. */
export class StorageQuotaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StorageQuotaError";
  }
}

/** Keys that hold sensitive financial data and should be encrypted */
const ENCRYPTED_KEYS = new Set([
  KEYS.transactions,
  KEYS.recordedSales,
  KEYS.exchangeMappings,
  KEYS.importHistory,
  KEYS.auditLog,
]);

// ======================================================================
// Tauri detection + filesystem helpers
// ======================================================================

/** Check if running inside Tauri (production) vs browser (dev) */
function isTauri(): boolean {
  return !!(window as any).__TAURI_INTERNALS__;
}

let _dataDirReady = false;

/** Ensure $APPDATA/data/ directory exists (called once per session) */
async function ensureDataDir(): Promise<void> {
  if (_dataDirReady) return;
  try {
    const dirExists = await exists("data", { baseDir: BaseDirectory.AppData });
    if (!dirExists) {
      await mkdir("data", { baseDir: BaseDirectory.AppData, recursive: true });
    }
    _dataDirReady = true;
  } catch (e) {
    console.error("Failed to create data directory:", e);
    throw e;
  }
}

/** Write data to a file in $APPDATA/ */
async function fsWrite(filename: string, data: string): Promise<void> {
  await ensureDataDir();
  await writeTextFile(filename, data, { baseDir: BaseDirectory.AppData });
}

/** Read data from a file in $APPDATA/. Returns null if file doesn't exist. */
async function fsRead(filename: string): Promise<string | null> {
  try {
    const fileExists = await exists(filename, { baseDir: BaseDirectory.AppData });
    if (!fileExists) return null;
    return await readTextFile(filename, { baseDir: BaseDirectory.AppData });
  } catch {
    return null;
  }
}

/** Remove a file from $APPDATA/. Silent on failure. */
async function fsRemove(filename: string): Promise<void> {
  try {
    const fileExists = await exists(filename, { baseDir: BaseDirectory.AppData });
    if (fileExists) {
      await remove(filename, { baseDir: BaseDirectory.AppData });
    }
  } catch {
    // Silent — cleanup is best-effort
  }
}

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
    if (e instanceof DOMException && e.name === "QuotaExceededError") {
      throw new StorageQuotaError(`Storage quota exceeded saving ${key}`);
    }
    console.error(`Failed to save ${key}:`, e);
  }
}

/** Load and decrypt data for an encrypted key.
 *  In Tauri: reads from filesystem, falls back to localStorage for migration.
 *  In browser: reads from localStorage only.
 *  Throws DecryptionError if data exists and is encrypted but cannot be decrypted. */
async function loadEncrypted<T>(key: string): Promise<T | null> {
  let raw: string | null = null;

  // In Tauri: try filesystem first, fall back to localStorage (migration path)
  if (isTauri() && FS_FILENAMES[key]) {
    raw = await fsRead(FS_FILENAMES[key]);
  }
  if (raw === null) {
    raw = localStorage.getItem(key);
  }
  if (raw === null) return null;

  // If we have an encryption key and the data is encrypted, decrypt it
  if (_encryptionKey && isEncryptedData(raw)) {
    try {
      const json = await decryptData(raw, _encryptionKey);
      return JSON.parse(json) as T;
    } catch (e) {
      throw new DecryptionError(`Failed to decrypt ${key}`);
    }
  }

  // Otherwise try to parse as plain JSON (migration scenario)
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

/** Encrypt and save data.
 *  In Tauri: writes to filesystem (no size limit).
 *  In browser: writes to localStorage (dev mode fallback).
 *  Throws on failure so callers can show user-facing error messages. */
async function saveEncrypted<T>(key: string, value: T): Promise<void> {
  const json = JSON.stringify(value);
  const data = _encryptionKey ? await encryptData(json, _encryptionKey) : json;

  // In Tauri: write to filesystem
  if (isTauri() && FS_FILENAMES[key]) {
    await fsWrite(FS_FILENAMES[key], data);
    return;
  }

  // Browser fallback: localStorage
  try {
    localStorage.setItem(key, data);
  } catch (e) {
    if (e instanceof DOMException && e.name === "QuotaExceededError") {
      throw new StorageQuotaError(`Storage quota exceeded saving ${key}`);
    }
    throw e;
  }
}

// ======================================================================
// Migration: encrypt plaintext + move localStorage → filesystem
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

/**
 * Migrate encrypted data from localStorage → filesystem.
 * Called once after unlock. For each encrypted key, if the data exists in
 * localStorage but not yet on the filesystem, copy it over and delete the
 * localStorage copy. No-op when running in browser (Vite dev).
 */
export async function migrateToFilesystem(): Promise<void> {
  if (!isTauri()) return;

  for (const key of ENCRYPTED_KEYS) {
    const filename = FS_FILENAMES[key];
    if (!filename) continue;

    // Skip if already on filesystem
    const onDisk = await fsRead(filename);
    if (onDisk !== null) {
      // Data is on filesystem — clean up localStorage copy if present
      localStorage.removeItem(key);
      continue;
    }

    // Check localStorage
    const raw = localStorage.getItem(key);
    if (!raw) continue;

    // Copy to filesystem, then remove from localStorage
    try {
      await fsWrite(filename, raw);
      localStorage.removeItem(key);
    } catch (e) {
      console.error(`Failed to migrate ${key} to filesystem:`, e);
      // Leave in localStorage as fallback — loadEncrypted will still find it
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

/** Save transactions — awaits encryption to ensure data is written before returning */
export async function saveTransactions(transactions: Transaction[]): Promise<void> {
  if (_encryptionKey) {
    await saveEncrypted(KEYS.transactions, transactions);
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

/** Save recorded sales — awaits encryption to ensure data is written before returning */
export async function saveRecordedSales(sales: SaleRecord[]): Promise<void> {
  if (_encryptionKey) {
    await saveEncrypted(KEYS.recordedSales, sales);
  } else {
    saveJSON(KEYS.recordedSales, sales);
  }
}

// Exchange Mappings
export function loadMappings(): Record<string, ColumnMapping> {
  return loadJSON<Record<string, ColumnMapping>>(KEYS.exchangeMappings) ?? {};
}

export async function loadMappingsAsync(): Promise<Record<string, ColumnMapping>> {
  return (await loadEncrypted<Record<string, ColumnMapping>>(KEYS.exchangeMappings)) ?? {};
}

/** Save mappings — awaits encryption to ensure data is written before returning */
export async function saveMappings(mappings: Record<string, ColumnMapping>): Promise<void> {
  if (_encryptionKey) {
    await saveEncrypted(KEYS.exchangeMappings, mappings);
  } else {
    saveJSON(KEYS.exchangeMappings, mappings);
  }
}

export async function saveMappingsAsync(mappings: Record<string, ColumnMapping>): Promise<void> {
  await saveEncrypted(KEYS.exchangeMappings, mappings);
}

// Import History
export function loadImportHistory(): Record<string, ImportRecord> {
  return loadJSON<Record<string, ImportRecord>>(KEYS.importHistory) ?? {};
}

export async function loadImportHistoryAsync(): Promise<Record<string, ImportRecord>> {
  return (await loadEncrypted<Record<string, ImportRecord>>(KEYS.importHistory)) ?? {};
}

/** Save import history — awaits encryption to ensure data is written before returning */
export async function saveImportHistory(history: Record<string, ImportRecord>): Promise<void> {
  if (_encryptionKey) {
    await saveEncrypted(KEYS.importHistory, history);
  } else {
    saveJSON(KEYS.importHistory, history);
  }
}

export async function saveImportHistoryAsync(history: Record<string, ImportRecord>): Promise<void> {
  await saveEncrypted(KEYS.importHistory, history);
}

// Preferences (not encrypted — contains no sensitive financial data)
export function loadPreferences(): Preferences {
  const prefs = loadJSON<Preferences>(KEYS.preferences);
  return {
    selectedYear: new Date().getFullYear(),
    selectedMethod: AccountingMethod.FIFO,
    appearanceMode: "dark",
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

// Previous encryption salt — saved during changePIN for crash-safety rollback
export function loadPrevEncryptionSalt(): string | null {
  return localStorage.getItem(KEYS.prevEncryptionSalt);
}

export function savePrevEncryptionSalt(salt: string): void {
  localStorage.setItem(KEYS.prevEncryptionSalt, salt);
}

export function clearPrevEncryptionSalt(): void {
  localStorage.removeItem(KEYS.prevEncryptionSalt);
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

/** Save audit log — awaits encryption to ensure data is written before returning */
export async function saveAuditLog(entries: AuditEntry[]): Promise<void> {
  if (_encryptionKey) {
    await saveEncrypted(KEYS.auditLog, entries);
  } else {
    saveJSON(KEYS.auditLog, entries);
  }
}

export async function saveAuditLogAsync(entries: AuditEntry[]): Promise<void> {
  await saveEncrypted(KEYS.auditLog, entries);
}

// ======================================================================
// Price Cache (plaintext — not sensitive, stays on localStorage)
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
  const mappings = await loadMappingsAsync();
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
  await saveMappingsAsync(data.mappings);
  await saveImportHistoryAsync(data.importHistory);
  await saveAuditLogAsync(data.auditLog);
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

export async function clearAllData(): Promise<void> {
  // Remove all encrypted data keys EXCEPT audit log
  for (const key of ENCRYPTED_KEYS) {
    if (key === KEYS.auditLog) continue; // Audit log survives data clears

    // Remove from filesystem
    const filename = FS_FILENAMES[key];
    if (isTauri() && filename) {
      await fsRemove(filename);
    }

    // Remove from localStorage (cleanup / dev mode)
    localStorage.removeItem(key);
  }
  // Reset preferences to defaults
  savePreferences({
    selectedYear: new Date().getFullYear(),
    selectedMethod: AccountingMethod.FIFO,
    appearanceMode: "dark",
    privacyBlur: false,
    livePriceEnabled: true,
    selectedWallet: null,
  });
}
