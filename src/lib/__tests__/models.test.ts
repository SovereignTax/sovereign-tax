import { describe, it, expect } from "vitest";
import {
  createTransaction,
  createLot,
  isDualColumn,
  requiredFieldsMissing,
  isMappingValid,
  warningFieldsMissing,
  ColumnMapping,
} from "../models";
import { TransactionType } from "../types";

// ═══════════════════════════════════════════════════════
// createTransaction
// ═══════════════════════════════════════════════════════

describe("createTransaction", () => {
  it("creates a transaction with a unique ID", () => {
    const tx = createTransaction({
      date: "2024-01-15T12:00:00.000Z",
      transactionType: TransactionType.Buy,
      amountBTC: 1.0,
      pricePerBTC: 40000,
      totalUSD: 40000,
      exchange: "Coinbase",
      notes: "",
    });
    expect(tx.id).toBeDefined();
    expect(tx.id.length).toBeGreaterThan(0);
  });

  it("generates unique IDs for each transaction", () => {
    const tx1 = createTransaction({
      date: "2024-01-15T12:00:00.000Z",
      transactionType: TransactionType.Buy,
      amountBTC: 1.0,
      pricePerBTC: 40000,
      totalUSD: 40000,
      exchange: "Coinbase",
      notes: "",
    });
    const tx2 = createTransaction({
      date: "2024-01-15T12:00:00.000Z",
      transactionType: TransactionType.Buy,
      amountBTC: 1.0,
      pricePerBTC: 40000,
      totalUSD: 40000,
      exchange: "Coinbase",
      notes: "",
    });
    expect(tx1.id).not.toBe(tx2.id);
  });

  it("takes absolute value of amountBTC", () => {
    const tx = createTransaction({
      date: "2024-01-15T12:00:00.000Z",
      transactionType: TransactionType.Sell,
      amountBTC: -0.5,
      pricePerBTC: 60000,
      totalUSD: -30000,
      exchange: "Coinbase",
      notes: "",
    });
    expect(tx.amountBTC).toBe(0.5);
    expect(tx.totalUSD).toBe(30000);
  });

  it("preserves all fields", () => {
    const tx = createTransaction({
      date: "2024-01-15T12:00:00.000Z",
      transactionType: TransactionType.Buy,
      amountBTC: 1.0,
      pricePerBTC: 40000,
      totalUSD: 40000,
      fee: 10,
      exchange: "Coinbase",
      wallet: "My Wallet",
      notes: "Test note",
    });
    expect(tx.date).toBe("2024-01-15T12:00:00.000Z");
    expect(tx.transactionType).toBe(TransactionType.Buy);
    expect(tx.fee).toBe(10);
    expect(tx.exchange).toBe("Coinbase");
    expect(tx.wallet).toBe("My Wallet");
    expect(tx.notes).toBe("Test note");
  });
});

// ═══════════════════════════════════════════════════════
// createLot
// ═══════════════════════════════════════════════════════

describe("createLot", () => {
  it("creates a lot with remainingBTC = amountBTC by default", () => {
    const lot = createLot({
      purchaseDate: "2024-01-15T12:00:00.000Z",
      amountBTC: 1.0,
      pricePerBTC: 40000,
      totalCost: 40000,
      exchange: "Coinbase",
    });
    expect(lot.remainingBTC).toBe(1.0);
  });

  it("allows custom remainingBTC", () => {
    const lot = createLot({
      purchaseDate: "2024-01-15T12:00:00.000Z",
      amountBTC: 1.0,
      pricePerBTC: 40000,
      totalCost: 40000,
      exchange: "Coinbase",
      remainingBTC: 0.5,
    });
    expect(lot.remainingBTC).toBe(0.5);
  });

  it("generates an ID if not provided", () => {
    const lot = createLot({
      purchaseDate: "2024-01-15T12:00:00.000Z",
      amountBTC: 1.0,
      pricePerBTC: 40000,
      totalCost: 40000,
      exchange: "Coinbase",
    });
    expect(lot.id).toBeDefined();
    expect(lot.id.length).toBeGreaterThan(0);
  });

  it("uses provided ID", () => {
    const lot = createLot({
      id: "custom-id",
      purchaseDate: "2024-01-15T12:00:00.000Z",
      amountBTC: 1.0,
      pricePerBTC: 40000,
      totalCost: 40000,
      exchange: "Coinbase",
    });
    expect(lot.id).toBe("custom-id");
  });
});

// ═══════════════════════════════════════════════════════
// isDualColumn
// ═══════════════════════════════════════════════════════

describe("isDualColumn", () => {
  it("returns true when all four dual-column fields are present", () => {
    const mapping: ColumnMapping = {
      date: "Date",
      receivedQuantity: "Received Quantity",
      receivedCurrency: "Received Currency",
      sentQuantity: "Sent Quantity",
      sentCurrency: "Sent Currency",
    };
    expect(isDualColumn(mapping)).toBe(true);
  });

  it("returns false when any dual-column field is missing", () => {
    expect(isDualColumn({ date: "Date" })).toBe(false);
    expect(
      isDualColumn({
        date: "Date",
        receivedQuantity: "RQ",
        receivedCurrency: "RC",
        sentQuantity: "SQ",
        // missing sentCurrency
      })
    ).toBe(false);
  });

  it("returns false for standard column format", () => {
    const mapping: ColumnMapping = {
      date: "Date",
      type: "Type",
      amount: "Amount",
      price: "Price",
    };
    expect(isDualColumn(mapping)).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════
// requiredFieldsMissing & isMappingValid
// ═══════════════════════════════════════════════════════

describe("requiredFieldsMissing", () => {
  it("returns empty array when all required fields present", () => {
    const mapping: ColumnMapping = {
      date: "Date",
      amount: "Amount",
      price: "Price",
    };
    expect(requiredFieldsMissing(mapping)).toEqual([]);
  });

  it("accepts total instead of price", () => {
    const mapping: ColumnMapping = {
      date: "Date",
      amount: "Amount",
      total: "Total",
    };
    expect(requiredFieldsMissing(mapping)).toEqual([]);
  });

  it("reports missing date", () => {
    const mapping: ColumnMapping = {
      amount: "Amount",
      price: "Price",
    };
    expect(requiredFieldsMissing(mapping)).toContain("date");
  });

  it("reports missing amount (for standard format)", () => {
    const mapping: ColumnMapping = {
      date: "Date",
      price: "Price",
    };
    expect(requiredFieldsMissing(mapping)).toContain("amount");
  });

  it("reports missing price or total", () => {
    const mapping: ColumnMapping = {
      date: "Date",
      amount: "Amount",
    };
    expect(requiredFieldsMissing(mapping)).toContain("price or total");
  });

  it("dual-column format only needs date", () => {
    const mapping: ColumnMapping = {
      date: "Date",
      receivedQuantity: "RQ",
      receivedCurrency: "RC",
      sentQuantity: "SQ",
      sentCurrency: "SC",
    };
    expect(requiredFieldsMissing(mapping)).toEqual([]);
  });
});

describe("isMappingValid", () => {
  it("returns true for valid mappings", () => {
    expect(isMappingValid({ date: "Date", amount: "Amount", price: "Price" })).toBe(true);
  });

  it("returns false for invalid mappings", () => {
    expect(isMappingValid({})).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════
// warningFieldsMissing
// ═══════════════════════════════════════════════════════

describe("warningFieldsMissing", () => {
  it("warns when neither price nor total is present", () => {
    const mapping: ColumnMapping = {
      date: "Date",
      amount: "Amount",
    };
    expect(warningFieldsMissing(mapping)).toContain("price or total");
  });

  it("no warnings when price is present", () => {
    const mapping: ColumnMapping = {
      date: "Date",
      amount: "Amount",
      price: "Price",
    };
    expect(warningFieldsMissing(mapping)).toEqual([]);
  });

  it("no warnings for dual-column format", () => {
    const mapping: ColumnMapping = {
      date: "Date",
      receivedQuantity: "RQ",
      receivedCurrency: "RC",
      sentQuantity: "SQ",
      sentCurrency: "SC",
    };
    expect(warningFieldsMissing(mapping)).toEqual([]);
  });
});
