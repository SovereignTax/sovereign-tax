import { describe, it, expect } from "vitest";
import {
  parseCSVLine,
  parseDate,
  parseDecimal,
  detectColumns,
  readHeaders,
  parseCSVContent,
} from "../csv-import";
import { TransactionType } from "../types";
import { ColumnMapping } from "../models";

// ═══════════════════════════════════════════════════════
// parseCSVLine — RFC 4180 compliance
// ═══════════════════════════════════════════════════════

describe("parseCSVLine", () => {
  it("parses simple comma-separated values", () => {
    expect(parseCSVLine("a,b,c")).toEqual(["a", "b", "c"]);
  });

  it("handles quoted fields", () => {
    expect(parseCSVLine('"hello","world"')).toEqual(["hello", "world"]);
  });

  it("handles commas inside quotes", () => {
    expect(parseCSVLine('"hello, world",foo')).toEqual(["hello, world", "foo"]);
  });

  it("handles escaped double quotes (RFC 4180)", () => {
    expect(parseCSVLine('"He said ""hi""",bar')).toEqual([
      'He said "hi"',
      "bar",
    ]);
  });

  it("trims whitespace from unquoted fields", () => {
    expect(parseCSVLine("  a , b , c  ")).toEqual(["a", "b", "c"]);
  });

  it("handles empty fields", () => {
    expect(parseCSVLine("a,,c")).toEqual(["a", "", "c"]);
  });

  it("handles single field", () => {
    expect(parseCSVLine("hello")).toEqual(["hello"]);
  });

  it("handles empty line", () => {
    expect(parseCSVLine("")).toEqual([""]);
  });

  it("handles mixed quoted and unquoted", () => {
    expect(parseCSVLine('a,"b,c",d')).toEqual(["a", "b,c", "d"]);
  });
});

// ═══════════════════════════════════════════════════════
// parseDate — multi-format support
// ═══════════════════════════════════════════════════════

describe("parseDate", () => {
  it("parses ISO 8601 dates", () => {
    const d = parseDate("2024-01-15T12:00:00Z");
    expect(d).not.toBeNull();
    expect(d!.getFullYear()).toBe(2024);
    expect(d!.getMonth()).toBe(0); // January
    expect(d!.getDate()).toBe(15);
  });

  it("parses ISO 8601 with milliseconds", () => {
    const d = parseDate("2024-06-15T10:30:45.123Z");
    expect(d).not.toBeNull();
    expect(d!.getFullYear()).toBe(2024);
  });

  it("parses MM/dd/yyyy format", () => {
    const d = parseDate("01/15/2024");
    expect(d).not.toBeNull();
    expect(d!.getFullYear()).toBe(2024);
  });

  it("parses yyyy-MM-dd format", () => {
    const d = parseDate("2024-01-15");
    expect(d).not.toBeNull();
    expect(d!.getFullYear()).toBe(2024);
  });

  it("handles UTC suffix (Gemini format)", () => {
    const d = parseDate("2024-01-15 12:00:00 UTC");
    expect(d).not.toBeNull();
    expect(d!.getFullYear()).toBe(2024);
  });

  it("strips timezone abbreviations", () => {
    const d = parseDate("2024-01-15 12:00:00 EST");
    expect(d).not.toBeNull();
    expect(d!.getFullYear()).toBe(2024);
  });

  it("returns null for empty string", () => {
    expect(parseDate("")).toBeNull();
  });

  it("returns null for garbage input", () => {
    expect(parseDate("not a date")).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════
// parseDecimal — number parsing
// ═══════════════════════════════════════════════════════

describe("parseDecimal", () => {
  it("parses basic numbers", () => {
    expect(parseDecimal("42")).toBe(42);
    expect(parseDecimal("3.14159")).toBe(3.14159);
  });

  it("strips dollar signs", () => {
    expect(parseDecimal("$1,234.56")).toBe(1234.56);
  });

  it("strips commas", () => {
    expect(parseDecimal("1,000,000")).toBe(1000000);
  });

  it("handles negative numbers", () => {
    expect(parseDecimal("-42.5")).toBe(-42.5);
  });

  it("returns 0 for empty string", () => {
    expect(parseDecimal("")).toBe(0);
  });

  it("returns null for non-numeric", () => {
    expect(parseDecimal("abc")).toBeNull();
  });

  it("strips whitespace", () => {
    expect(parseDecimal("  42.5  ")).toBe(42.5);
  });
});

// ═══════════════════════════════════════════════════════
// detectColumns — auto-detection
// ═══════════════════════════════════════════════════════

describe("detectColumns", () => {
  it("detects standard column names", () => {
    const headers = ["Date", "Type", "Amount", "Price", "Total", "Fee"];
    const mapping = detectColumns(headers);
    expect(mapping.date).toBe("Date");
    expect(mapping.type).toBe("Type");
    expect(mapping.amount).toBe("Amount");
    expect(mapping.price).toBe("Price");
    expect(mapping.total).toBe("Total");
    expect(mapping.fee).toBe("Fee");
  });

  it("detects case-insensitive headers", () => {
    const headers = ["DATE", "TYPE", "AMOUNT", "PRICE"];
    const mapping = detectColumns(headers);
    expect(mapping.date).toBe("DATE");
    expect(mapping.type).toBe("TYPE");
    expect(mapping.amount).toBe("AMOUNT");
    expect(mapping.price).toBe("PRICE");
  });

  it("detects Coinbase-style headers", () => {
    const headers = [
      "Timestamp",
      "Transaction Type",
      "Asset",
      "Quantity Transacted",
      "Spot Price at Transaction",
      "Notes",
    ];
    const mapping = detectColumns(headers);
    expect(mapping.date).toBe("Timestamp");
    expect(mapping.type).toBe("Transaction Type");
    expect(mapping.amount).toBe("Quantity Transacted");
    expect(mapping.price).toBe("Spot Price at Transaction");
    expect(mapping.notes).toBe("Notes");
  });

  it("detects dual-column format (Received/Sent)", () => {
    const headers = [
      "Date",
      "Received Quantity",
      "Received Currency",
      "Sent Quantity",
      "Sent Currency",
    ];
    const mapping = detectColumns(headers);
    expect(mapping.date).toBe("Date");
    expect(mapping.receivedQuantity).toBe("Received Quantity");
    expect(mapping.receivedCurrency).toBe("Received Currency");
    expect(mapping.sentQuantity).toBe("Sent Quantity");
    expect(mapping.sentCurrency).toBe("Sent Currency");
  });

  it("detects wallet and exchange columns", () => {
    const headers = ["Date", "Amount", "Price", "Wallet", "Exchange"];
    const mapping = detectColumns(headers);
    expect(mapping.wallet).toBe("Wallet");
    expect(mapping.exchange).toBe("Exchange");
  });

  it("detects notes column", () => {
    const headers = ["Date", "Amount", "Price", "Notes"];
    const mapping = detectColumns(headers);
    expect(mapping.notes).toBe("Notes");
  });

  it("detects parenthetical headers like Price (USD)", () => {
    const headers = ["Date", "Amount (BTC)", "Price (USD)", "Total (USD)", "Fee (USD)"];
    const mapping = detectColumns(headers);
    expect(mapping.date).toBe("Date");
    expect(mapping.amount).toBe("Amount (BTC)");
    expect(mapping.price).toBe("Price (USD)");
    expect(mapping.total).toBe("Total (USD)");
    expect(mapping.fee).toBe("Fee (USD)");
  });

  it("prefers Asset Amount over generic Amount", () => {
    const headers = ["Date", "Amount", "Asset Amount", "Price"];
    const mapping = detectColumns(headers);
    expect(mapping.amount).toBe("Asset Amount");
  });
});

// ═══════════════════════════════════════════════════════
// readHeaders
// ═══════════════════════════════════════════════════════

describe("readHeaders", () => {
  it("reads headers from CSV content", () => {
    const csv = "Date,Type,Amount\n2024-01-15,Buy,1.0";
    const headers = readHeaders(csv);
    expect(headers).toEqual(["Date", "Type", "Amount"]);
  });

  it("handles BOM character", () => {
    const csv = "\uFEFFDate,Type,Amount\n2024-01-15,Buy,1.0";
    const headers = readHeaders(csv);
    expect(headers).toEqual(["Date", "Type", "Amount"]);
  });

  it("returns null for empty content", () => {
    expect(readHeaders("")).toBeNull();
  });

  it("skips preamble rows to find real headers", () => {
    const csv = [
      "Some preamble text that is not headers",
      "More preamble",
      "Date,Type,Amount,Price",
      "2024-01-15,Buy,1.0,40000",
    ].join("\n");
    const headers = readHeaders(csv);
    expect(headers).toContain("Date");
    expect(headers).toContain("Type");
  });
});

// ═══════════════════════════════════════════════════════
// parseCSVContent — full import pipeline
// ═══════════════════════════════════════════════════════

describe("parseCSVContent", () => {
  it("parses a simple buy transaction", () => {
    const csv = "Date,Type,Amount,Price\n2024-01-15,Buy,1.0,40000";
    const mapping: ColumnMapping = {
      date: "Date",
      type: "Type",
      amount: "Amount",
      price: "Price",
    };
    const result = parseCSVContent(csv, "Coinbase", mapping);
    expect(result.transactions).toHaveLength(1);
    const tx = result.transactions[0];
    expect(tx.transactionType).toBe(TransactionType.Buy);
    expect(tx.amountBTC).toBe(1.0);
    expect(tx.pricePerBTC).toBe(40000);
    expect(tx.exchange).toBe("Coinbase");
  });

  it("parses a sell transaction", () => {
    const csv = "Date,Type,Amount,Price\n2024-06-15,Sell,0.5,60000";
    const mapping: ColumnMapping = {
      date: "Date",
      type: "Type",
      amount: "Amount",
      price: "Price",
    };
    const result = parseCSVContent(csv, "Coinbase", mapping);
    expect(result.transactions).toHaveLength(1);
    expect(result.transactions[0].transactionType).toBe(TransactionType.Sell);
  });

  it("calculates total from amount and price when total is missing", () => {
    const csv = "Date,Type,Amount,Price\n2024-01-15,Buy,0.5,40000";
    const mapping: ColumnMapping = {
      date: "Date",
      type: "Type",
      amount: "Amount",
      price: "Price",
    };
    const result = parseCSVContent(csv, "Test", mapping);
    expect(result.transactions[0].totalUSD).toBeCloseTo(20000, 2);
  });

  it("calculates price from amount and total when price is missing", () => {
    const csv = "Date,Type,Amount,Total\n2024-01-15,Buy,0.5,20000";
    const mapping: ColumnMapping = {
      date: "Date",
      type: "Type",
      amount: "Amount",
      total: "Total",
    };
    const result = parseCSVContent(csv, "Test", mapping);
    expect(result.transactions[0].pricePerBTC).toBeCloseTo(40000, 2);
  });

  it("handles fee adjustment for buys (increases cost basis)", () => {
    const csv = "Date,Type,Amount,Price,Fee\n2024-01-15,Buy,1.0,40000,50";
    const mapping: ColumnMapping = {
      date: "Date",
      type: "Type",
      amount: "Amount",
      price: "Price",
      fee: "Fee",
    };
    const result = parseCSVContent(csv, "Test", mapping);
    const tx = result.transactions[0];
    expect(tx.totalUSD).toBeCloseTo(40050, 2); // 40000 + 50
    expect(tx.fee).toBe(50);
  });

  it("handles fee adjustment for sells (decreases proceeds)", () => {
    const csv = "Date,Type,Amount,Price,Fee\n2024-01-15,Sell,1.0,60000,50";
    const mapping: ColumnMapping = {
      date: "Date",
      type: "Type",
      amount: "Amount",
      price: "Price",
      fee: "Fee",
    };
    const result = parseCSVContent(csv, "Test", mapping);
    const tx = result.transactions[0];
    expect(tx.totalUSD).toBeCloseTo(59950, 2); // 60000 - 50
  });

  it("skips non-BTC assets when asset column exists", () => {
    const csv =
      "Date,Type,Amount,Price,Asset\n2024-01-15,Buy,1.0,40000,BTC\n2024-01-16,Buy,10.0,3000,ETH";
    const mapping: ColumnMapping = {
      date: "Date",
      type: "Type",
      amount: "Amount",
      price: "Price",
      asset: "Asset",
    };
    const result = parseCSVContent(csv, "Test", mapping);
    expect(result.transactions).toHaveLength(1);
    expect(result.skippedRows).toHaveLength(1);
    expect(result.skippedRows[0].reason).toContain("Non-BTC");
  });

  it("allows XBT as BTC alias", () => {
    const csv = "Date,Type,Amount,Price,Asset\n2024-01-15,Buy,1.0,40000,XBT";
    const mapping: ColumnMapping = {
      date: "Date",
      type: "Type",
      amount: "Amount",
      price: "Price",
      asset: "Asset",
    };
    const result = parseCSVContent(csv, "Test", mapping);
    expect(result.transactions).toHaveLength(1);
  });

  it("skips rows with non-completed status", () => {
    const csv =
      "Date,Type,Amount,Price,Status\n2024-01-15,Buy,1.0,40000,Completed\n2024-01-16,Buy,1.0,40000,Pending";
    const mapping: ColumnMapping = {
      date: "Date",
      type: "Type",
      amount: "Amount",
      price: "Price",
    };
    const result = parseCSVContent(csv, "Test", mapping);
    expect(result.transactions).toHaveLength(1);
    expect(result.skippedRows).toHaveLength(1);
    expect(result.skippedRows[0].reason).toContain("Status");
  });

  it("uses exchange from CSV over provided exchange name", () => {
    const csv =
      "Date,Type,Amount,Price,Exchange\n2024-01-15,Buy,1.0,40000,Kraken";
    const mapping: ColumnMapping = {
      date: "Date",
      type: "Type",
      amount: "Amount",
      price: "Price",
      exchange: "Exchange",
    };
    const result = parseCSVContent(csv, "DefaultExchange", mapping);
    expect(result.transactions[0].exchange).toBe("Kraken");
  });

  it("falls back to provided exchange name when CSV column empty", () => {
    const csv = 'Date,Type,Amount,Price,Exchange\n2024-01-15,Buy,1.0,40000,""';
    const mapping: ColumnMapping = {
      date: "Date",
      type: "Type",
      amount: "Amount",
      price: "Price",
      exchange: "Exchange",
    };
    const result = parseCSVContent(csv, "Coinbase", mapping);
    expect(result.transactions[0].exchange).toBe("Coinbase");
  });

  it("parses wallet from CSV", () => {
    const csv =
      "Date,Type,Amount,Price,Wallet\n2024-01-15,Buy,1.0,40000,My Ledger";
    const mapping: ColumnMapping = {
      date: "Date",
      type: "Type",
      amount: "Amount",
      price: "Price",
      wallet: "Wallet",
    };
    const result = parseCSVContent(csv, "Coinbase", mapping);
    expect(result.transactions[0].wallet).toBe("My Ledger");
  });

  it("parses notes from CSV (truncated to 100 chars)", () => {
    const longNote = "A".repeat(200);
    const csv = `Date,Type,Amount,Price,Notes\n2024-01-15,Buy,1.0,40000,"${longNote}"`;
    const mapping: ColumnMapping = {
      date: "Date",
      type: "Type",
      amount: "Amount",
      price: "Price",
      notes: "Notes",
    };
    const result = parseCSVContent(csv, "Test", mapping);
    expect(result.transactions[0].notes.length).toBeLessThanOrEqual(100);
  });

  it("skips rows with missing date", () => {
    const csv = "Date,Type,Amount,Price\n,Buy,1.0,40000";
    const mapping: ColumnMapping = {
      date: "Date",
      type: "Type",
      amount: "Amount",
      price: "Price",
    };
    const result = parseCSVContent(csv, "Test", mapping);
    expect(result.transactions).toHaveLength(0);
    expect(result.skippedRows).toHaveLength(1);
  });

  it("skips rows with zero amount", () => {
    const csv = "Date,Type,Amount,Price\n2024-01-15,Buy,0,40000";
    const mapping: ColumnMapping = {
      date: "Date",
      type: "Type",
      amount: "Amount",
      price: "Price",
    };
    const result = parseCSVContent(csv, "Test", mapping);
    expect(result.transactions).toHaveLength(0);
    expect(result.skippedRows).toHaveLength(1);
  });

  it("parses donation type from CSV", () => {
    const csv = "Date,Type,Amount,Price\n2024-01-15,Donation,0.5,60000";
    const mapping: ColumnMapping = {
      date: "Date",
      type: "Type",
      amount: "Amount",
      price: "Price",
    };
    const result = parseCSVContent(csv, "Test", mapping);
    expect(result.transactions).toHaveLength(1);
    expect(result.transactions[0].transactionType).toBe(TransactionType.Donation);
  });

  it("parses transfer types from CSV", () => {
    const csv = [
      "Date,Type,Amount,Price",
      "2024-01-15,Transfer In,1.0,0",
      "2024-01-16,Withdrawal,0.5,0",
    ].join("\n");
    const mapping: ColumnMapping = {
      date: "Date",
      type: "Type",
      amount: "Amount",
      price: "Price",
    };
    const result = parseCSVContent(csv, "Test", mapping);
    expect(result.transactions).toHaveLength(2);
    expect(result.transactions[0].transactionType).toBe(TransactionType.TransferIn);
    expect(result.transactions[1].transactionType).toBe(TransactionType.TransferOut);
  });

  it("uses absolute value of negative amounts", () => {
    const csv = "Date,Type,Amount,Price\n2024-01-15,Sell,-0.5,60000";
    const mapping: ColumnMapping = {
      date: "Date",
      type: "Type",
      amount: "Amount",
      price: "Price",
    };
    const result = parseCSVContent(csv, "Test", mapping);
    expect(result.transactions[0].amountBTC).toBe(0.5);
  });

  it("handles BOM + Windows line endings", () => {
    const csv = "\uFEFFDate,Type,Amount,Price\r\n2024-01-15,Buy,1.0,40000\r\n";
    const mapping: ColumnMapping = {
      date: "Date",
      type: "Type",
      amount: "Amount",
      price: "Price",
    };
    const result = parseCSVContent(csv, "Test", mapping);
    expect(result.transactions).toHaveLength(1);
  });

  it("empty CSV returns no transactions", () => {
    const result = parseCSVContent("", "Test", {});
    expect(result.transactions).toHaveLength(0);
  });

  it("header-only CSV returns no transactions", () => {
    const csv = "Date,Type,Amount,Price";
    const mapping: ColumnMapping = {
      date: "Date",
      type: "Type",
      amount: "Amount",
      price: "Price",
    };
    const result = parseCSVContent(csv, "Test", mapping);
    expect(result.transactions).toHaveLength(0);
  });
});

// ═══════════════════════════════════════════════════════
// Dual-column format (Received/Sent)
// ═══════════════════════════════════════════════════════

describe("parseCSVContent — dual-column format", () => {
  it("parses BTC buy from dual columns", () => {
    const csv = [
      "Date,Received Quantity,Received Currency,Sent Quantity,Sent Currency",
      "2024-01-15,0.5,BTC,20000,USD",
    ].join("\n");
    const mapping: ColumnMapping = {
      date: "Date",
      receivedQuantity: "Received Quantity",
      receivedCurrency: "Received Currency",
      sentQuantity: "Sent Quantity",
      sentCurrency: "Sent Currency",
    };
    const result = parseCSVContent(csv, "Gemini", mapping);
    expect(result.transactions).toHaveLength(1);
    expect(result.transactions[0].transactionType).toBe(TransactionType.Buy);
    expect(result.transactions[0].amountBTC).toBe(0.5);
  });

  it("parses BTC sell from dual columns", () => {
    const csv = [
      "Date,Received Quantity,Received Currency,Sent Quantity,Sent Currency",
      "2024-01-15,30000,USD,0.5,BTC",
    ].join("\n");
    const mapping: ColumnMapping = {
      date: "Date",
      receivedQuantity: "Received Quantity",
      receivedCurrency: "Received Currency",
      sentQuantity: "Sent Quantity",
      sentCurrency: "Sent Currency",
    };
    const result = parseCSVContent(csv, "Gemini", mapping);
    expect(result.transactions).toHaveLength(1);
    expect(result.transactions[0].transactionType).toBe(TransactionType.Sell);
    expect(result.transactions[0].amountBTC).toBe(0.5);
  });

  it("detects BTC transfer in (received BTC, nothing sent)", () => {
    const csv = [
      "Date,Received Quantity,Received Currency,Sent Quantity,Sent Currency",
      "2024-01-15,0.5,BTC,0,",
    ].join("\n");
    const mapping: ColumnMapping = {
      date: "Date",
      receivedQuantity: "Received Quantity",
      receivedCurrency: "Received Currency",
      sentQuantity: "Sent Quantity",
      sentCurrency: "Sent Currency",
    };
    const result = parseCSVContent(csv, "Gemini", mapping);
    expect(result.transactions).toHaveLength(1);
    expect(result.transactions[0].transactionType).toBe(TransactionType.TransferIn);
  });

  it("detects BTC transfer out (sent BTC, nothing received)", () => {
    const csv = [
      "Date,Received Quantity,Received Currency,Sent Quantity,Sent Currency",
      "2024-01-15,0,,0.5,BTC",
    ].join("\n");
    const mapping: ColumnMapping = {
      date: "Date",
      receivedQuantity: "Received Quantity",
      receivedCurrency: "Received Currency",
      sentQuantity: "Sent Quantity",
      sentCurrency: "Sent Currency",
    };
    const result = parseCSVContent(csv, "Gemini", mapping);
    expect(result.transactions).toHaveLength(1);
    expect(result.transactions[0].transactionType).toBe(TransactionType.TransferOut);
  });
});
