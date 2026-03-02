import { vi, describe, it, expect, beforeEach, beforeAll, afterEach } from "vitest";
import { AccountingMethod } from "../types";

// ═══════════════════════════════════════════════════════
// Mock setup — must come before importing persistence
// ═══════════════════════════════════════════════════════

// Mock Tauri FS module
const mockWriteTextFile = vi.fn();
const mockReadTextFile = vi.fn();
const mockExists = vi.fn();
const mockMkdir = vi.fn();
const mockRemove = vi.fn();

vi.mock("@tauri-apps/plugin-fs", () => ({
  readTextFile: (...args: any[]) => mockReadTextFile(...args),
  writeTextFile: (...args: any[]) => mockWriteTextFile(...args),
  exists: (...args: any[]) => mockExists(...args),
  mkdir: (...args: any[]) => mockMkdir(...args),
  remove: (...args: any[]) => mockRemove(...args),
  BaseDirectory: { AppData: 24 },
}));

// Mock localStorage
const lsStore: Record<string, string> = {};
const mockLocalStorage = {
  getItem: vi.fn((key: string) => lsStore[key] ?? null),
  setItem: vi.fn((key: string, value: string) => { lsStore[key] = value; }),
  removeItem: vi.fn((key: string) => { delete lsStore[key]; }),
  clear: vi.fn(() => { for (const k of Object.keys(lsStore)) delete lsStore[k]; }),
};
vi.stubGlobal("localStorage", mockLocalStorage);

// Mock window (for isTauri check)
vi.stubGlobal("window", globalThis);

// Now import persistence (uses mocked deps)
import * as persistence from "../persistence";
import { deriveEncryptionKey, generateSalt } from "../crypto";

// ═══════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════

function clearLsStore() {
  for (const k of Object.keys(lsStore)) delete lsStore[k];
}

/** Enable Tauri mode by setting __TAURI_INTERNALS__ on window/globalThis */
function enableTauri() {
  (globalThis as any).__TAURI_INTERNALS__ = {};
}

function disableTauri() {
  delete (globalThis as any).__TAURI_INTERNALS__;
}

// Derive a real encryption key once (PBKDF2 is slow)
let testKey: CryptoKey;
let testSalt: string;
beforeAll(async () => {
  testSalt = generateSalt();
  testKey = await deriveEncryptionKey("1234", testSalt);
});

beforeEach(() => {
  clearLsStore();
  persistence.setEncryptionKey(null);
  disableTauri();
  mockWriteTextFile.mockReset();
  mockReadTextFile.mockReset();
  mockExists.mockReset().mockResolvedValue(false);
  mockMkdir.mockReset();
  mockRemove.mockReset();
});

// ═══════════════════════════════════════════════════════
// Group 1: Error classes
// ═══════════════════════════════════════════════════════

describe("Error classes", () => {
  it("DecryptionError has correct name and message", () => {
    const err = new persistence.DecryptionError("bad data");
    expect(err.name).toBe("DecryptionError");
    expect(err.message).toBe("bad data");
    expect(err).toBeInstanceOf(Error);
  });

  it("StorageQuotaError has correct name and message", () => {
    const err = new persistence.StorageQuotaError("quota exceeded");
    expect(err.name).toBe("StorageQuotaError");
    expect(err.message).toBe("quota exceeded");
    expect(err).toBeInstanceOf(Error);
  });
});

// ═══════════════════════════════════════════════════════
// Group 2: Plaintext localStorage round-trips
// ═══════════════════════════════════════════════════════

describe("Plaintext localStorage", () => {
  it("loadPreferences returns defaults when nothing stored", () => {
    const prefs = persistence.loadPreferences();
    expect(prefs.selectedYear).toBe(new Date().getFullYear());
    expect(prefs.selectedMethod).toBe(AccountingMethod.FIFO);
    expect(prefs.appearanceMode).toBe("dark");
    expect(prefs.privacyBlur).toBe(false);
    expect(prefs.livePriceEnabled).toBe(true);
  });

  it("savePreferences / loadPreferences round-trip", () => {
    const prefs = {
      selectedYear: 2025,
      selectedMethod: AccountingMethod.SpecificID,
      appearanceMode: "light" as const,
      privacyBlur: true,
      livePriceEnabled: false,
    };
    persistence.savePreferences(prefs);
    const loaded = persistence.loadPreferences();
    expect(loaded.selectedYear).toBe(2025);
    expect(loaded.selectedMethod).toBe(AccountingMethod.SpecificID);
    expect(loaded.appearanceMode).toBe("light");
    expect(loaded.privacyBlur).toBe(true);
    expect(loaded.livePriceEnabled).toBe(false);
  });

  it("PIN hash/salt save, load, delete, hasPIN", () => {
    expect(persistence.hasPIN()).toBe(false);
    persistence.savePINHash("abc123");
    persistence.savePINSalt("salt456");
    expect(persistence.hasPIN()).toBe(true);
    expect(persistence.loadPINHash()).toBe("abc123");
    expect(persistence.loadPINSalt()).toBe("salt456");
    persistence.deletePINHash();
    expect(persistence.hasPIN()).toBe(false);
    expect(persistence.loadPINHash()).toBeNull();
    expect(persistence.loadPINSalt()).toBeNull();
  });

  it("encryption salt save/load", () => {
    expect(persistence.loadEncryptionSalt()).toBeNull();
    persistence.saveEncryptionSalt("enc-salt-hex");
    expect(persistence.loadEncryptionSalt()).toBe("enc-salt-hex");
  });

  it("prevEncryptionSalt save/load/clear (crash-safety)", () => {
    expect(persistence.loadPrevEncryptionSalt()).toBeNull();
    persistence.savePrevEncryptionSalt("old-salt-hex");
    expect(persistence.loadPrevEncryptionSalt()).toBe("old-salt-hex");
    persistence.clearPrevEncryptionSalt();
    expect(persistence.loadPrevEncryptionSalt()).toBeNull();
  });

  it("PIN rate limiting — attempts and lockout", () => {
    expect(persistence.loadPINAttempts()).toBe(0);
    expect(persistence.loadPINLockoutUntil()).toBe(0);
    persistence.savePINAttempts(3);
    persistence.savePINLockoutUntil(1700000000);
    expect(persistence.loadPINAttempts()).toBe(3);
    expect(persistence.loadPINLockoutUntil()).toBe(1700000000);
    persistence.clearPINAttempts();
    expect(persistence.loadPINAttempts()).toBe(0);
    expect(persistence.loadPINLockoutUntil()).toBe(0);
  });

  it("price cache save/load", () => {
    expect(persistence.loadPriceCache()).toEqual({});
    persistence.savePriceCache({ "2024-01-15": 42000 });
    expect(persistence.loadPriceCache()).toEqual({ "2024-01-15": 42000 });
  });

  it("TOS accepted save/load", () => {
    expect(persistence.hasTOSAccepted()).toBe(false);
    persistence.saveTOSAccepted();
    expect(persistence.hasTOSAccepted()).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════
// Group 3: Encrypted storage — browser mode (no Tauri)
// ═══════════════════════════════════════════════════════

describe("Encrypted storage — browser mode", () => {
  it("loadTransactionsAsync returns [] when nothing stored", async () => {
    persistence.setEncryptionKey(testKey);
    const txns = await persistence.loadTransactionsAsync();
    expect(txns).toEqual([]);
  });

  it("encrypted save/load round-trip for transactions", async () => {
    persistence.setEncryptionKey(testKey);
    const data = [{ id: "t1", date: "2024-01-01", amountBTC: 0.5 }];
    await persistence.saveTransactionsAsync(data as any);
    const loaded = await persistence.loadTransactionsAsync();
    expect(loaded).toEqual(data);
  });

  it("encrypted save/load round-trip for recorded sales", async () => {
    persistence.setEncryptionKey(testKey);
    const data = [{ id: "s1", saleDate: "2024-06-01", amountSold: 0.25 }];
    await persistence.saveRecordedSalesAsync(data as any);
    const loaded = await persistence.loadRecordedSalesAsync();
    expect(loaded).toEqual(data);
  });

  it("encrypted save/load round-trip for mappings", async () => {
    persistence.setEncryptionKey(testKey);
    const data = { Coinbase: { date: 0, amount: 1 } };
    await persistence.saveMappingsAsync(data as any);
    const loaded = await persistence.loadMappingsAsync();
    expect(loaded).toEqual(data);
  });

  it("encrypted save/load round-trip for import history", async () => {
    persistence.setEncryptionKey(testKey);
    const data = { hash1: { fileHash: "hash1", fileName: "test.csv", importDate: "2024-01-01", transactionCount: 5 } };
    await persistence.saveImportHistoryAsync(data);
    const loaded = await persistence.loadImportHistoryAsync();
    expect(loaded).toEqual(data);
  });

  it("encrypted save/load round-trip for audit log", async () => {
    persistence.setEncryptionKey(testKey);
    const data = [{ id: "a1", timestamp: "2024-01-01", action: "test", details: "detail" }];
    await persistence.saveAuditLogAsync(data as any);
    const loaded = await persistence.loadAuditLogAsync();
    expect(loaded).toEqual(data);
  });

  it("migrateToEncrypted converts plaintext data to encrypted", async () => {
    // Store plaintext JSON in localStorage (pre-encryption state)
    const txns = [{ id: "t1", date: "2024-01-01" }];
    lsStore["sovereign-tax-transactions"] = JSON.stringify(txns);

    persistence.setEncryptionKey(testKey);
    await persistence.migrateToEncrypted();

    // After migration, the raw data should no longer be parseable as plain JSON
    const raw = lsStore["sovereign-tax-transactions"];
    expect(raw).toBeDefined();
    // Encrypted data starts with a base64 string, not { or [
    expect(raw.startsWith("[")).toBe(false);
    expect(raw.startsWith("{")).toBe(false);

    // But loadTransactionsAsync can still decrypt it
    const loaded = await persistence.loadTransactionsAsync();
    expect(loaded).toEqual(txns);
  });

  it("DecryptionError thrown when decrypting with wrong key", async () => {
    // Encrypt with testKey
    persistence.setEncryptionKey(testKey);
    await persistence.saveTransactionsAsync([{ id: "t1" }] as any);

    // Try to load with a different key
    const wrongSalt = generateSalt();
    const wrongKey = await deriveEncryptionKey("9999", wrongSalt);
    persistence.setEncryptionKey(wrongKey);

    await expect(persistence.loadTransactionsAsync()).rejects.toThrow(persistence.DecryptionError);
  });

  it("clearAllData removes data keys but preserves audit log", async () => {
    persistence.setEncryptionKey(testKey);
    await persistence.saveTransactionsAsync([{ id: "t1" }] as any);
    await persistence.saveRecordedSalesAsync([{ id: "s1" }] as any);
    await persistence.saveAuditLogAsync([{ id: "a1" }] as any);

    await persistence.clearAllData();

    // Transactions and sales should be gone
    const txns = await persistence.loadTransactionsAsync();
    expect(txns).toEqual([]);
    const sales = await persistence.loadRecordedSalesAsync();
    expect(sales).toEqual([]);

    // Audit log should survive
    const audit = await persistence.loadAuditLogAsync();
    expect(audit).toEqual([{ id: "a1" }]);
  });

  it("clearAllData resets preferences to defaults", async () => {
    persistence.savePreferences({
      selectedYear: 2020,
      selectedMethod: AccountingMethod.SpecificID,
      appearanceMode: "light",
      privacyBlur: true,
      livePriceEnabled: false,
    });

    await persistence.clearAllData();

    const prefs = persistence.loadPreferences();
    expect(prefs.selectedYear).toBe(new Date().getFullYear());
    expect(prefs.selectedMethod).toBe(AccountingMethod.FIFO);
    expect(prefs.appearanceMode).toBe("dark");
  });
});

// ═══════════════════════════════════════════════════════
// Group 4: Tauri filesystem routing
// ═══════════════════════════════════════════════════════

describe("Tauri filesystem routing", () => {
  beforeEach(() => {
    enableTauri();
    // Default: mkdir succeeds, data dir "exists" after first mkdir
    mockMkdir.mockResolvedValue(undefined);
  });

  afterEach(() => {
    disableTauri();
  });

  it("saveTransactionsAsync writes to filesystem, not localStorage", async () => {
    persistence.setEncryptionKey(testKey);
    mockExists.mockResolvedValue(false); // dir doesn't exist yet
    mockWriteTextFile.mockResolvedValue(undefined);

    await persistence.saveTransactionsAsync([{ id: "t1" }] as any);

    // Should have written to filesystem
    expect(mockWriteTextFile).toHaveBeenCalled();
    const [filename] = mockWriteTextFile.mock.calls[0];
    expect(filename).toBe("data/transactions.dat");

    // localStorage should NOT have the transactions key
    expect(lsStore["sovereign-tax-transactions"]).toBeUndefined();
  });

  it("loadTransactionsAsync reads from filesystem first", async () => {
    persistence.setEncryptionKey(testKey);

    // First, save to filesystem to get valid encrypted data
    mockExists.mockResolvedValue(true);
    mockWriteTextFile.mockResolvedValue(undefined);
    await persistence.saveTransactionsAsync([{ id: "fs-tx" }] as any);

    // Capture what was written to filesystem
    const writtenData = mockWriteTextFile.mock.calls[0][1];

    // Now set up FS to return that data
    mockExists.mockResolvedValue(true);
    mockReadTextFile.mockResolvedValue(writtenData);

    const loaded = await persistence.loadTransactionsAsync();
    expect(loaded).toEqual([{ id: "fs-tx" }]);
    expect(mockReadTextFile).toHaveBeenCalled();
  });

  it("loadTransactionsAsync falls back to localStorage when file missing", async () => {
    persistence.setEncryptionKey(testKey);

    // FS has no file
    mockExists.mockResolvedValue(false);

    // But localStorage has data (pre-migration state) — save in browser mode
    disableTauri();
    await persistence.saveTransactionsAsync([{ id: "ls-tx" }] as any);
    enableTauri();

    // Now in Tauri mode, FS file doesn't exist → falls back to localStorage
    mockExists.mockResolvedValue(false);
    const loaded = await persistence.loadTransactionsAsync();
    expect(loaded).toEqual([{ id: "ls-tx" }]);
  });

  it("migrateToFilesystem moves data from localStorage to filesystem", async () => {
    persistence.setEncryptionKey(testKey);

    // Save data to localStorage first (browser mode)
    disableTauri();
    await persistence.saveTransactionsAsync([{ id: "migrate-me" }] as any);
    const lsData = lsStore["sovereign-tax-transactions"];
    expect(lsData).toBeDefined();
    enableTauri();

    // FS file doesn't exist yet
    mockExists.mockResolvedValue(false);
    mockWriteTextFile.mockResolvedValue(undefined);

    await persistence.migrateToFilesystem();

    // Should have written to filesystem
    expect(mockWriteTextFile).toHaveBeenCalled();
    const writtenFilename = mockWriteTextFile.mock.calls.find(
      (c: any[]) => c[0] === "data/transactions.dat"
    );
    expect(writtenFilename).toBeDefined();

    // localStorage should be cleaned up
    expect(lsStore["sovereign-tax-transactions"]).toBeUndefined();
  });

  it("migrateToFilesystem skips data already on filesystem", async () => {
    persistence.setEncryptionKey(testKey);

    // FS already has the file
    mockExists.mockResolvedValue(true);
    mockReadTextFile.mockResolvedValue("already-here");

    // Also put something in localStorage
    lsStore["sovereign-tax-transactions"] = "old-data";

    await persistence.migrateToFilesystem();

    // Should NOT have written to filesystem (data already there)
    const txnWrite = mockWriteTextFile.mock.calls.find(
      (c: any[]) => c[0] === "data/transactions.dat"
    );
    expect(txnWrite).toBeUndefined();

    // BUT should have cleaned up localStorage
    expect(lsStore["sovereign-tax-transactions"]).toBeUndefined();
  });

  it("migrateToFilesystem is no-op in browser mode", async () => {
    disableTauri();
    lsStore["sovereign-tax-transactions"] = "some-data";

    await persistence.migrateToFilesystem();

    // Data should still be in localStorage
    expect(lsStore["sovereign-tax-transactions"]).toBe("some-data");
    // No FS operations
    expect(mockWriteTextFile).not.toHaveBeenCalled();
  });

  it("migrateToFilesystem leaves localStorage intact on FS write failure", async () => {
    persistence.setEncryptionKey(testKey);

    disableTauri();
    await persistence.saveTransactionsAsync([{ id: "keep-me" }] as any);
    const originalData = lsStore["sovereign-tax-transactions"];
    enableTauri();

    // FS write will fail
    mockExists.mockResolvedValue(false);
    mockWriteTextFile.mockRejectedValue(new Error("disk full"));

    await persistence.migrateToFilesystem();

    // localStorage should still have the data (not deleted)
    expect(lsStore["sovereign-tax-transactions"]).toBe(originalData);
  });

  it("clearAllData removes filesystem files", async () => {
    persistence.setEncryptionKey(testKey);
    mockExists.mockResolvedValue(true);
    mockRemove.mockResolvedValue(undefined);

    await persistence.clearAllData();

    // Should have called remove for each encrypted key except audit log
    const removedFiles = mockRemove.mock.calls.map((c: any[]) => c[0]);
    expect(removedFiles).toContain("data/transactions.dat");
    expect(removedFiles).toContain("data/recorded-sales.dat");
    expect(removedFiles).toContain("data/exchange-mappings.dat");
    expect(removedFiles).toContain("data/import-history.dat");
    // Audit log should NOT be removed
    expect(removedFiles).not.toContain("data/audit-log.dat");
  });
});

// ═══════════════════════════════════════════════════════
// Group 5: Bulk operations
// ═══════════════════════════════════════════════════════

describe("Bulk operations", () => {
  it("loadAllDataForBackup loads all data types", async () => {
    persistence.setEncryptionKey(testKey);
    await persistence.saveTransactionsAsync([{ id: "t1" }] as any);
    await persistence.saveRecordedSalesAsync([{ id: "s1" }] as any);
    await persistence.saveMappingsAsync({ CB: { date: 0 } } as any);
    await persistence.saveImportHistoryAsync({ h1: { fileHash: "h1", fileName: "f.csv", importDate: "2024-01-01", transactionCount: 1 } });
    await persistence.saveAuditLogAsync([{ id: "a1" }] as any);
    persistence.savePreferences({
      selectedYear: 2025,
      selectedMethod: AccountingMethod.FIFO,
    });

    const backup = await persistence.loadAllDataForBackup();
    expect(backup.transactions).toEqual([{ id: "t1" }]);
    expect(backup.recordedSales).toEqual([{ id: "s1" }]);
    expect(backup.mappings).toEqual({ CB: { date: 0 } });
    expect(backup.importHistory).toEqual({ h1: { fileHash: "h1", fileName: "f.csv", importDate: "2024-01-01", transactionCount: 1 } });
    expect(backup.auditLog).toEqual([{ id: "a1" }]);
    expect(backup.preferences.selectedYear).toBe(2025);
  });

  it("restoreAllData saves all data types", async () => {
    persistence.setEncryptionKey(testKey);
    const data = {
      transactions: [{ id: "r-t1" }] as any,
      recordedSales: [{ id: "r-s1" }] as any,
      mappings: { R: { date: 0 } } as any,
      importHistory: { rh: { fileHash: "rh", fileName: "r.csv", importDate: "2024-01-01", transactionCount: 2 } },
      auditLog: [{ id: "r-a1" }] as any,
      preferences: { selectedYear: 2024, selectedMethod: AccountingMethod.FIFO } as any,
    };

    await persistence.restoreAllData(data);

    expect(await persistence.loadTransactionsAsync()).toEqual(data.transactions);
    expect(await persistence.loadRecordedSalesAsync()).toEqual(data.recordedSales);
    expect(await persistence.loadMappingsAsync()).toEqual(data.mappings);
    expect(await persistence.loadImportHistoryAsync()).toEqual(data.importHistory);
    expect(await persistence.loadAuditLogAsync()).toEqual(data.auditLog);
    expect(persistence.loadPreferences().selectedYear).toBe(2024);
  });
});

// ═══════════════════════════════════════════════════════
// Group 6: Conditional save functions (encryption key present or not)
// ═══════════════════════════════════════════════════════

describe("Conditional save functions", () => {
  it("saveTransactions uses plaintext when no encryption key", async () => {
    // No encryption key set
    await persistence.saveTransactions([{ id: "plain" }] as any);
    const raw = lsStore["sovereign-tax-transactions"];
    expect(raw).toBe('[{"id":"plain"}]');
  });

  it("saveTransactions uses encryption when key is set", async () => {
    persistence.setEncryptionKey(testKey);
    await persistence.saveTransactions([{ id: "enc" }] as any);
    const raw = lsStore["sovereign-tax-transactions"];
    // Encrypted data should NOT be plain JSON
    expect(raw).toBeDefined();
    expect(raw.startsWith("[")).toBe(false);
  });

  it("saveRecordedSales uses plaintext when no encryption key", async () => {
    await persistence.saveRecordedSales([{ id: "s-plain" }] as any);
    const raw = lsStore["sovereign-tax-recorded-sales"];
    expect(raw).toBe('[{"id":"s-plain"}]');
  });

  it("saveAuditLog uses plaintext when no encryption key", async () => {
    await persistence.saveAuditLog([{ id: "a-plain" }] as any);
    const raw = lsStore["sovereign-tax-audit-log"];
    expect(raw).toBe('[{"id":"a-plain"}]');
  });
});

// ═══════════════════════════════════════════════════════
// Group 7: Error propagation (guardedSave relies on these)
// ═══════════════════════════════════════════════════════

describe("Error propagation for guardedSave", () => {
  it("saveEncrypted throws StorageQuotaError on localStorage quota exceeded (browser mode)", async () => {
    persistence.setEncryptionKey(testKey);
    // Override setItem to throw QuotaExceededError
    const quotaError = new DOMException("QuotaExceededError", "QuotaExceededError");
    Object.defineProperty(quotaError, "name", { value: "QuotaExceededError" });
    mockLocalStorage.setItem.mockImplementationOnce(() => { throw quotaError; });

    await expect(
      persistence.saveTransactionsAsync([{ id: "too-big" }] as any)
    ).rejects.toThrow(persistence.StorageQuotaError);

    // Restore normal setItem
    mockLocalStorage.setItem.mockImplementation((key: string, value: string) => { lsStore[key] = value; });
  });

  it("saveEncrypted throws on Tauri filesystem write failure", async () => {
    enableTauri();
    persistence.setEncryptionKey(testKey);
    mockExists.mockResolvedValue(true);
    mockWriteTextFile.mockRejectedValue(new Error("Permission denied"));

    await expect(
      persistence.saveTransactionsAsync([{ id: "fail" }] as any)
    ).rejects.toThrow("Permission denied");

    disableTauri();
  });

  it("loadEncrypted throws DecryptionError, not null, on corrupt encrypted data", async () => {
    persistence.setEncryptionKey(testKey);
    // Store valid encrypted data
    await persistence.saveTransactionsAsync([{ id: "ok" }] as any);

    // Corrupt it by changing characters while keeping it "encrypted-looking"
    const raw = lsStore["sovereign-tax-transactions"];
    expect(raw).toBeDefined();
    // Swap to a different key — simulates corruption from wrong key
    const wrongKey = await deriveEncryptionKey("0000", generateSalt());
    persistence.setEncryptionKey(wrongKey);

    await expect(persistence.loadTransactionsAsync()).rejects.toThrow(persistence.DecryptionError);
  });
});

// ═══════════════════════════════════════════════════════
// Group 8: changePIN crash-safety scenario
// ═══════════════════════════════════════════════════════

describe("changePIN crash-safety", () => {
  it("prevEncryptionSalt survives across save/load cycle", () => {
    // Simulate: save current salt before changePIN
    const currentSalt = "abc123def456";
    persistence.savePrevEncryptionSalt(currentSalt);

    // Simulate: app crashes here, new salt already written
    persistence.saveEncryptionSalt("new-salt-789");

    // On next unlock: prevSalt is available for recovery
    expect(persistence.loadPrevEncryptionSalt()).toBe(currentSalt);
    expect(persistence.loadEncryptionSalt()).toBe("new-salt-789");

    // After successful recovery, clear prev
    persistence.clearPrevEncryptionSalt();
    expect(persistence.loadPrevEncryptionSalt()).toBeNull();
  });

  it("data encrypted with old key is recoverable via prevSalt", async () => {
    // Encrypt data with key A
    const saltA = generateSalt();
    const keyA = await deriveEncryptionKey("1234", saltA);
    persistence.setEncryptionKey(keyA);
    await persistence.saveTransactions([{ id: "important-data" }] as any);

    // Simulate partial changePIN: save prevSalt, change to key B
    persistence.savePrevEncryptionSalt(saltA);
    const saltB = generateSalt();
    persistence.saveEncryptionSalt(saltB);
    const keyB = await deriveEncryptionKey("5678", saltB);
    persistence.setEncryptionKey(keyB);

    // Crash happens here — data is still encrypted with key A
    // On next unlock: try key B first (from new salt) — fails
    await expect(persistence.loadTransactionsAsync()).rejects.toThrow(persistence.DecryptionError);

    // Recovery: use prevSalt to re-derive key A
    const recoveredSalt = persistence.loadPrevEncryptionSalt();
    expect(recoveredSalt).toBe(saltA);
    const keyARecovered = await deriveEncryptionKey("1234", recoveredSalt!);
    persistence.setEncryptionKey(keyARecovered);

    // Data is now readable again
    const loaded = await persistence.loadTransactionsAsync();
    expect(loaded).toEqual([{ id: "important-data" }]);
  });
});
