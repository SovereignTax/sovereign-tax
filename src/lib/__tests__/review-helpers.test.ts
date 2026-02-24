import { describe, it, expect } from "vitest";
import {
  getUnassignedTransfers,
  getAssignedTransferCount,
  getWalletMismatchSales,
  getWalletMismatchIds,
  getOptimizableSells,
  getAssignedSells,
} from "../review-helpers";
import { TransactionType, AccountingMethod } from "../types";
import { Transaction, SaleRecord } from "../models";

function makeTxn(overrides: Partial<Transaction> = {}): Transaction {
  return {
    id: crypto.randomUUID(),
    date: "2024-06-15T12:00:00.000Z",
    transactionType: TransactionType.Buy,
    amountBTC: 1,
    pricePerBTC: 50000,
    totalUSD: 50000,
    exchange: "Coinbase",
    notes: "",
    ...overrides,
  };
}

function makeSale(overrides: Partial<SaleRecord> = {}): SaleRecord {
  return {
    id: crypto.randomUUID(),
    saleDate: "2024-09-01T12:00:00.000Z",
    amountSold: 0.5,
    salePricePerBTC: 60000,
    totalProceeds: 30000,
    costBasis: 25000,
    gainLoss: 5000,
    holdingPeriodDays: 90,
    isLongTerm: false,
    isMixedTerm: false,
    method: AccountingMethod.FIFO,
    lotDetails: [],
    ...overrides,
  };
}

describe("getUnassignedTransfers", () => {
  it("returns TransferIn without sourceWallet", () => {
    const txns = [
      makeTxn({ transactionType: TransactionType.TransferIn }),
      makeTxn({ transactionType: TransactionType.TransferIn, sourceWallet: "Gemini" }),
      makeTxn({ transactionType: TransactionType.Buy }),
    ];
    const result = getUnassignedTransfers(txns);
    expect(result).toHaveLength(1);
    expect(result[0].sourceWallet).toBeUndefined();
  });

  it("returns empty for no transfers", () => {
    const txns = [makeTxn({ transactionType: TransactionType.Buy })];
    expect(getUnassignedTransfers(txns)).toHaveLength(0);
  });

  it("filters by year when year is provided", () => {
    const txns = [
      makeTxn({ transactionType: TransactionType.TransferIn, date: "2024-03-01T12:00:00.000Z" }),
      makeTxn({ transactionType: TransactionType.TransferIn, date: "2025-01-15T12:00:00.000Z" }),
      makeTxn({ transactionType: TransactionType.TransferIn, date: "2023-11-20T12:00:00.000Z" }),
    ];
    const result = getUnassignedTransfers(txns, 2024);
    expect(result).toHaveLength(1);
    expect(new Date(result[0].date).getFullYear()).toBe(2024);
  });

  it("returns all years when year is omitted", () => {
    const txns = [
      makeTxn({ transactionType: TransactionType.TransferIn, date: "2024-03-01T12:00:00.000Z" }),
      makeTxn({ transactionType: TransactionType.TransferIn, date: "2025-01-15T12:00:00.000Z" }),
    ];
    expect(getUnassignedTransfers(txns)).toHaveLength(2);
  });

  it("handles year boundary correctly (Dec vs Jan)", () => {
    const txns = [
      makeTxn({ transactionType: TransactionType.TransferIn, date: "2024-12-15T12:00:00.000Z" }),
      makeTxn({ transactionType: TransactionType.TransferIn, date: "2025-01-15T12:00:00.000Z" }),
    ];
    expect(getUnassignedTransfers(txns, 2024)).toHaveLength(1);
    expect(getUnassignedTransfers(txns, 2025)).toHaveLength(1);
  });

  it("returns empty for empty input", () => {
    expect(getUnassignedTransfers([])).toHaveLength(0);
    expect(getUnassignedTransfers([], 2024)).toHaveLength(0);
  });
});

describe("getAssignedTransferCount", () => {
  it("counts TransferIn with sourceWallet", () => {
    const txns = [
      makeTxn({ transactionType: TransactionType.TransferIn, sourceWallet: "Gemini" }),
      makeTxn({ transactionType: TransactionType.TransferIn, sourceWallet: "Kraken" }),
      makeTxn({ transactionType: TransactionType.TransferIn }),
    ];
    expect(getAssignedTransferCount(txns)).toBe(2);
  });

  it("filters by year when year is provided", () => {
    const txns = [
      makeTxn({ transactionType: TransactionType.TransferIn, sourceWallet: "Gemini", date: "2024-06-01T12:00:00.000Z" }),
      makeTxn({ transactionType: TransactionType.TransferIn, sourceWallet: "Kraken", date: "2025-02-01T12:00:00.000Z" }),
      makeTxn({ transactionType: TransactionType.TransferIn, sourceWallet: "Coinbase", date: "2024-11-01T12:00:00.000Z" }),
    ];
    expect(getAssignedTransferCount(txns, 2024)).toBe(2);
    expect(getAssignedTransferCount(txns, 2025)).toBe(1);
  });

  it("returns all years when year is omitted", () => {
    const txns = [
      makeTxn({ transactionType: TransactionType.TransferIn, sourceWallet: "Gemini", date: "2024-06-01T12:00:00.000Z" }),
      makeTxn({ transactionType: TransactionType.TransferIn, sourceWallet: "Kraken", date: "2025-02-01T12:00:00.000Z" }),
    ];
    expect(getAssignedTransferCount(txns)).toBe(2);
  });

  it("returns zero for empty input", () => {
    expect(getAssignedTransferCount([])).toBe(0);
  });
});

describe("getWalletMismatchSales", () => {
  it("returns sales with walletMismatch in the given year", () => {
    const sales = [
      makeSale({ walletMismatch: true, saleDate: "2024-09-01T12:00:00.000Z" }),
      makeSale({ walletMismatch: false, saleDate: "2024-09-01T12:00:00.000Z" }),
      makeSale({ walletMismatch: true, saleDate: "2023-09-01T12:00:00.000Z" }),
    ];
    const result = getWalletMismatchSales(sales, 2024);
    expect(result).toHaveLength(1);
  });

  it("returns empty when no mismatches", () => {
    const sales = [makeSale({ walletMismatch: false })];
    expect(getWalletMismatchSales(sales, 2024)).toHaveLength(0);
  });
});

describe("getWalletMismatchIds", () => {
  it("builds set of transaction IDs with wallet mismatches", () => {
    const sales = [
      makeSale({ walletMismatch: true, sourceTransactionId: "txn-1" }),
      makeSale({ walletMismatch: true, sourceTransactionId: "txn-2" }),
      makeSale({ walletMismatch: false, sourceTransactionId: "txn-3" }),
      makeSale({ walletMismatch: true }), // no sourceTransactionId — should be skipped
    ];
    const ids = getWalletMismatchIds(sales);
    expect(ids.size).toBe(2);
    expect(ids.has("txn-1")).toBe(true);
    expect(ids.has("txn-2")).toBe(true);
    expect(ids.has("txn-3")).toBe(false);
  });
});

describe("getOptimizableSells", () => {
  it("returns sells/donations without Specific ID in the year", () => {
    const sell1 = makeTxn({ transactionType: TransactionType.Sell, date: "2024-06-01T12:00:00.000Z" });
    const sell2 = makeTxn({ transactionType: TransactionType.Sell, date: "2024-07-01T12:00:00.000Z" });
    const donation = makeTxn({ transactionType: TransactionType.Donation, date: "2024-08-01T12:00:00.000Z" });
    const buy = makeTxn({ transactionType: TransactionType.Buy, date: "2024-06-01T12:00:00.000Z" });
    const sell2023 = makeTxn({ transactionType: TransactionType.Sell, date: "2023-06-01T12:00:00.000Z" });

    const recorded = new Map<string, SaleRecord>();
    recorded.set(sell2.id, makeSale());

    const result = getOptimizableSells([sell1, sell2, donation, buy, sell2023], recorded, 2024);
    expect(result).toHaveLength(2); // sell1 + donation
    expect(result.map((t) => t.id)).toContain(sell1.id);
    expect(result.map((t) => t.id)).toContain(donation.id);
  });
});

describe("getAssignedSells", () => {
  it("returns sells/donations WITH Specific ID in the year", () => {
    const sell1 = makeTxn({ transactionType: TransactionType.Sell, date: "2024-06-01T12:00:00.000Z" });
    const sell2 = makeTxn({ transactionType: TransactionType.Sell, date: "2024-07-01T12:00:00.000Z" });

    const recorded = new Map<string, SaleRecord>();
    recorded.set(sell1.id, makeSale());

    const result = getAssignedSells([sell1, sell2], recorded, 2024);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe(sell1.id);
  });
});
