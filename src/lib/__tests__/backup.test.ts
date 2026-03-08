import { describe, it, expect } from "vitest";
import {
  createBackupBundle,
  parseBackupBundle,
  isEncryptedBackup,
  BackupData,
} from "../backup";

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------
const SAMPLE_DATA: {
  transactions: BackupData["transactions"];
  recordedSales: BackupData["recordedSales"];
  mappings: BackupData["mappings"];
  importHistory: BackupData["importHistory"];
  auditLog: BackupData["auditLog"];
  preferences: BackupData["preferences"];
} = {
  transactions: [
    {
      id: "txn-1",
      date: "2025-01-15",
      transactionType: "Buy" as any,
      amountBTC: 0.5,
      pricePerBTC: 42000,
      totalUSD: 21000,
      fee: 10,
      wallet: "Coinbase",
      exchange: "Coinbase",
    },
  ] as any,
  recordedSales: [],
  mappings: {},
  importHistory: {},
  auditLog: [],
  preferences: { selectedYear: 2025, accountingMethod: "FIFO" } as any,
};

const PASSWORD = "test-backup-password";

// ---------------------------------------------------------------------------
// createBackupBundle
// ---------------------------------------------------------------------------
describe("createBackupBundle", () => {
  it("creates a v2 encrypted bundle", async () => {
    const bundle = await createBackupBundle(
      SAMPLE_DATA.transactions,
      SAMPLE_DATA.recordedSales,
      SAMPLE_DATA.mappings,
      SAMPLE_DATA.importHistory,
      SAMPLE_DATA.auditLog,
      SAMPLE_DATA.preferences,
      PASSWORD
    );

    expect(bundle.version).toBe(2);
    expect(bundle.salt).toHaveLength(32); // 16 bytes = 32 hex chars
    expect(typeof bundle.encrypted).toBe("string");
    expect(bundle.encrypted.length).toBeGreaterThan(0);
    expect(bundle.created).toMatch(/^\d{4}-\d{2}-\d{2}T/); // ISO timestamp
  });

  it("generates unique salt each time", async () => {
    const b1 = await createBackupBundle(
      SAMPLE_DATA.transactions, SAMPLE_DATA.recordedSales,
      SAMPLE_DATA.mappings, SAMPLE_DATA.importHistory,
      SAMPLE_DATA.auditLog, SAMPLE_DATA.preferences, PASSWORD
    );
    const b2 = await createBackupBundle(
      SAMPLE_DATA.transactions, SAMPLE_DATA.recordedSales,
      SAMPLE_DATA.mappings, SAMPLE_DATA.importHistory,
      SAMPLE_DATA.auditLog, SAMPLE_DATA.preferences, PASSWORD
    );
    expect(b1.salt).not.toBe(b2.salt);
  });
});

// ---------------------------------------------------------------------------
// Full round-trip: create → serialize → parse
// ---------------------------------------------------------------------------
describe("backup round-trip (create → parse)", () => {
  it("encrypts and decrypts with correct password", async () => {
    const bundle = await createBackupBundle(
      SAMPLE_DATA.transactions, SAMPLE_DATA.recordedSales,
      SAMPLE_DATA.mappings, SAMPLE_DATA.importHistory,
      SAMPLE_DATA.auditLog, SAMPLE_DATA.preferences, PASSWORD
    );

    const json = JSON.stringify(bundle);
    const result = await parseBackupBundle(json, PASSWORD);

    expect(result.wasEncrypted).toBe(true);
    expect(result.data.transactions).toEqual(SAMPLE_DATA.transactions);
    expect(result.data.recordedSales).toEqual(SAMPLE_DATA.recordedSales);
    expect(result.data.mappings).toEqual(SAMPLE_DATA.mappings);
    expect(result.data.preferences).toEqual(SAMPLE_DATA.preferences);
  });

  it("round-trips empty data", async () => {
    const bundle = await createBackupBundle([], [], {}, {}, [], {} as any, PASSWORD);
    const json = JSON.stringify(bundle);
    const result = await parseBackupBundle(json, PASSWORD);

    expect(result.data.transactions).toEqual([]);
    expect(result.data.recordedSales).toEqual([]);
  });

  it("round-trips large transaction list", async () => {
    const bigTxns = Array.from({ length: 500 }, (_, i) => ({
      id: `txn-${i}`,
      date: "2025-06-01",
      transactionType: "Buy",
      amountBTC: 0.001 * i,
      pricePerBTC: 50000,
      totalUSD: 50,
      fee: 1,
      wallet: "Ledger",
      exchange: "Kraken",
    })) as any;

    const bundle = await createBackupBundle(
      bigTxns, [], {}, {}, [], {} as any, PASSWORD
    );
    const json = JSON.stringify(bundle);
    const result = await parseBackupBundle(json, PASSWORD);

    expect(result.data.transactions).toHaveLength(500);
    expect(result.data.transactions[499].id).toBe("txn-499");
  });
});

// ---------------------------------------------------------------------------
// parseBackupBundle — error handling
// ---------------------------------------------------------------------------
describe("parseBackupBundle — errors", () => {
  it("rejects wrong password", async () => {
    const bundle = await createBackupBundle(
      SAMPLE_DATA.transactions, SAMPLE_DATA.recordedSales,
      SAMPLE_DATA.mappings, SAMPLE_DATA.importHistory,
      SAMPLE_DATA.auditLog, SAMPLE_DATA.preferences, PASSWORD
    );
    const json = JSON.stringify(bundle);

    await expect(parseBackupBundle(json, "wrong-password"))
      .rejects.toThrow("Incorrect backup password");
  });

  it("rejects v2 backup with no password", async () => {
    const bundle = await createBackupBundle(
      SAMPLE_DATA.transactions, SAMPLE_DATA.recordedSales,
      SAMPLE_DATA.mappings, SAMPLE_DATA.importHistory,
      SAMPLE_DATA.auditLog, SAMPLE_DATA.preferences, PASSWORD
    );
    const json = JSON.stringify(bundle);

    await expect(parseBackupBundle(json))
      .rejects.toThrow("password is required");
  });

  it("rejects missing version", async () => {
    await expect(parseBackupBundle(JSON.stringify({ data: {} })))
      .rejects.toThrow("missing version");
  });

  it("rejects unsupported version", async () => {
    await expect(parseBackupBundle(JSON.stringify({ version: 99 })))
      .rejects.toThrow("Unsupported backup version: 99");
  });

  it("rejects invalid JSON", async () => {
    await expect(parseBackupBundle("not json at all"))
      .rejects.toThrow();
  });

  it("rejects v2 with missing salt", async () => {
    const bad = JSON.stringify({ version: 2, created: "2025-01-01", encrypted: "abc" });
    await expect(parseBackupBundle(bad, PASSWORD))
      .rejects.toThrow("missing salt");
  });

  it("rejects v2 with missing encrypted field", async () => {
    const bad = JSON.stringify({ version: 2, created: "2025-01-01", salt: "a".repeat(32) });
    await expect(parseBackupBundle(bad, PASSWORD))
      .rejects.toThrow("missing salt or encrypted data");
  });
});

// ---------------------------------------------------------------------------
// v1 legacy backup parsing
// ---------------------------------------------------------------------------
describe("parseBackupBundle — v1 legacy", () => {
  // Helper: create a v1 backup with valid checksum
  async function createV1Bundle(data: BackupData): Promise<string> {
    const dataStr = JSON.stringify(data);
    const encoded = new TextEncoder().encode(dataStr);
    const hashBuffer = await crypto.subtle.digest("SHA-256", encoded);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const checksum = hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");

    return JSON.stringify({
      version: 1,
      created: "2024-12-01T00:00:00Z",
      checksum,
      data,
    });
  }

  it("parses valid v1 backup", async () => {
    const data: BackupData = {
      transactions: SAMPLE_DATA.transactions as any,
      recordedSales: [],
      mappings: {},
      importHistory: {},
      auditLog: [],
      preferences: {} as any,
    };

    const json = await createV1Bundle(data);
    const result = await parseBackupBundle(json);

    expect(result.wasEncrypted).toBe(false);
    expect(result.data.transactions).toEqual(data.transactions);
    expect(result.created).toBe("2024-12-01T00:00:00Z");
  });

  it("rejects v1 with bad checksum (tampered data)", async () => {
    const data: BackupData = {
      transactions: SAMPLE_DATA.transactions as any,
      recordedSales: [],
      mappings: {},
      importHistory: {},
      auditLog: [],
      preferences: {} as any,
    };

    const json = await createV1Bundle(data);
    const parsed = JSON.parse(json);
    // Tamper with the data after checksum was computed
    parsed.data.transactions = [];
    const tampered = JSON.stringify(parsed);

    await expect(parseBackupBundle(tampered))
      .rejects.toThrow("integrity check failed");
  });

  it("rejects v1 with missing checksum", async () => {
    const bad = JSON.stringify({
      version: 1,
      created: "2024-12-01",
      data: { transactions: [], recordedSales: [] },
    });

    await expect(parseBackupBundle(bad))
      .rejects.toThrow("Invalid backup file format");
  });

  it("rejects v1 with missing data", async () => {
    const bad = JSON.stringify({
      version: 1,
      created: "2024-12-01",
      checksum: "abc",
    });

    await expect(parseBackupBundle(bad))
      .rejects.toThrow("Invalid backup file format");
  });
});

// ---------------------------------------------------------------------------
// Backup data validation
// ---------------------------------------------------------------------------
describe("backup data validation", () => {
  it("rejects backup missing transactions array", async () => {
    const bundle = await createBackupBundle(
      SAMPLE_DATA.transactions, SAMPLE_DATA.recordedSales,
      SAMPLE_DATA.mappings, SAMPLE_DATA.importHistory,
      SAMPLE_DATA.auditLog, SAMPLE_DATA.preferences, PASSWORD
    );

    // We can't easily craft invalid encrypted data, so test via v1 path
    const dataStr = JSON.stringify({ recordedSales: [] }); // missing transactions
    const encoded = new TextEncoder().encode(dataStr);
    const hashBuffer = await crypto.subtle.digest("SHA-256", encoded);
    const checksum = Array.from(new Uint8Array(hashBuffer))
      .map((b) => b.toString(16).padStart(2, "0")).join("");

    const bad = JSON.stringify({
      version: 1,
      created: "2025-01-01",
      checksum,
      data: { recordedSales: [] },
    });

    await expect(parseBackupBundle(bad))
      .rejects.toThrow("missing transactions array");
  });

  it("rejects backup missing recordedSales array", async () => {
    const dataStr = JSON.stringify({ transactions: [] }); // missing recordedSales
    const encoded = new TextEncoder().encode(dataStr);
    const hashBuffer = await crypto.subtle.digest("SHA-256", encoded);
    const checksum = Array.from(new Uint8Array(hashBuffer))
      .map((b) => b.toString(16).padStart(2, "0")).join("");

    const bad = JSON.stringify({
      version: 1,
      created: "2025-01-01",
      checksum,
      data: { transactions: [] },
    });

    await expect(parseBackupBundle(bad))
      .rejects.toThrow("missing recorded sales array");
  });
});

// ---------------------------------------------------------------------------
// isEncryptedBackup
// ---------------------------------------------------------------------------
describe("isEncryptedBackup", () => {
  it("returns true for v2 backup", () => {
    const json = JSON.stringify({ version: 2, salt: "abc", encrypted: "def" });
    expect(isEncryptedBackup(json)).toBe(true);
  });

  it("returns false for v1 backup", () => {
    const json = JSON.stringify({ version: 1, data: {}, checksum: "abc" });
    expect(isEncryptedBackup(json)).toBe(false);
  });

  it("returns false for invalid JSON", () => {
    expect(isEncryptedBackup("not json")).toBe(false);
  });

  it("returns false for empty string", () => {
    expect(isEncryptedBackup("")).toBe(false);
  });
});
