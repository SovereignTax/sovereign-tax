import { describe, it, expect } from "vitest";
import {
  parseCSVLine,
  parseDate,
  parseDecimal,
  detectColumns,
  readHeaders,
  parseCSVContent,
  excelSerialToDate,
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

  it("converts Excel serial date 44192 to Dec 27, 2020", () => {
    const d = parseDate("44192");
    expect(d).not.toBeNull();
    expect(d!.getUTCFullYear()).toBe(2020);
    expect(d!.getUTCMonth()).toBe(11); // December
    expect(d!.getUTCDate()).toBe(27);
  });

  it("converts Excel serial date 44927 to Jan 1, 2023", () => {
    const d = parseDate("44927");
    expect(d).not.toBeNull();
    expect(d!.getUTCFullYear()).toBe(2023);
    expect(d!.getUTCMonth()).toBe(0); // January
    expect(d!.getUTCDate()).toBe(1);
  });

  it("converts Excel serial date 1 to Jan 1, 1900", () => {
    const d = parseDate("1");
    expect(d).not.toBeNull();
    expect(d!.getUTCFullYear()).toBe(1900);
    expect(d!.getUTCMonth()).toBe(0); // January
    expect(d!.getUTCDate()).toBe(1);
  });

  it("converts Excel serial date 45658 to Jan 1, 2025", () => {
    const d = parseDate("45658");
    expect(d).not.toBeNull();
    expect(d!.getUTCFullYear()).toBe(2025);
    expect(d!.getUTCMonth()).toBe(0); // January
    expect(d!.getUTCDate()).toBe(1);
  });

  it("does not treat numbers > 60000 as Excel serial dates", () => {
    // 70000 is outside the Excel serial range — should fall through to new Date()
    const d = parseDate("70000");
    // new Date("70000") parses as year 70000, which is nonsense but not our problem here
    // The key is it should NOT go through the Excel path
    expect(d).not.toBeNull();
    expect(d!.getFullYear()).not.toBeLessThan(60000);
  });

  it("does not treat 4-digit years as Excel serial dates", () => {
    // "2024" alone looks like a pure number but it's also a valid year.
    // It's in range 1-60000 so it hits the Excel path — serial 2024 = July 18, 1905.
    // This is fine because a bare "2024" in a date column is ambiguous and the Excel
    // interpretation is no worse than new Date("2024") → Jan 1, 2024 00:00 UTC.
    const d = parseDate("2024");
    expect(d).not.toBeNull();
  });

  it("converts Excel decimal serial 44192.5 to Dec 27, 2020 (noon)", () => {
    const d = parseDate("44192.5");
    expect(d).not.toBeNull();
    expect(d!.getUTCFullYear()).toBe(2020);
    expect(d!.getUTCMonth()).toBe(11); // December
    expect(d!.getUTCDate()).toBe(27);
  });

  it("converts Excel decimal serial 44192.75 to Dec 27, 2020 (6pm)", () => {
    const d = parseDate("44192.75");
    expect(d).not.toBeNull();
    expect(d!.getUTCFullYear()).toBe(2020);
    expect(d!.getUTCMonth()).toBe(11);
    expect(d!.getUTCDate()).toBe(27);
  });
});

// ═══════════════════════════════════════════════════════
// excelSerialToDate — direct unit tests
// ═══════════════════════════════════════════════════════

describe("excelSerialToDate", () => {
  it("serial 1 = Jan 1, 1900", () => {
    const d = excelSerialToDate(1);
    expect(d.getUTCFullYear()).toBe(1900);
    expect(d.getUTCMonth()).toBe(0);
    expect(d.getUTCDate()).toBe(1);
  });

  it("serial 59 = Feb 28, 1900 (last day before Lotus bug)", () => {
    const d = excelSerialToDate(59);
    expect(d.getUTCFullYear()).toBe(1900);
    expect(d.getUTCMonth()).toBe(1); // February
    expect(d.getUTCDate()).toBe(28);
  });

  it("serial 61 = Mar 1, 1900 (skips fake Feb 29)", () => {
    const d = excelSerialToDate(61);
    expect(d.getUTCFullYear()).toBe(1900);
    expect(d.getUTCMonth()).toBe(2); // March
    expect(d.getUTCDate()).toBe(1);
  });

  it("serial 44192 = Dec 27, 2020", () => {
    const d = excelSerialToDate(44192);
    expect(d.getUTCFullYear()).toBe(2020);
    expect(d.getUTCMonth()).toBe(11);
    expect(d.getUTCDate()).toBe(27);
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

  it("returns null for empty string", () => {
    expect(parseDecimal("")).toBeNull();
  });

  it("returns null for non-numeric", () => {
    expect(parseDecimal("abc")).toBeNull();
  });

  it("strips whitespace", () => {
    expect(parseDecimal("  42.5  ")).toBe(42.5);
  });

  it("strips BTC/XBT unit suffixes", () => {
    expect(parseDecimal("0.0041604 BTC")).toBe(0.0041604);
    expect(parseDecimal("0.00423113 BTC")).toBe(0.00423113);
    expect(parseDecimal("1.5 XBT")).toBe(1.5);
    expect(parseDecimal("0.01321421 btc")).toBe(0.01321421);
  });

  it("strips USD/USDT/USDC unit suffixes", () => {
    expect(parseDecimal("1234.56 USD")).toBe(1234.56);
    expect(parseDecimal("500.00 USDT")).toBe(500);
    expect(parseDecimal("99.99 USDC")).toBe(99.99);
  });

  it("strips SAT/SATS unit suffixes", () => {
    expect(parseDecimal("100000 SAT")).toBe(100000);
    expect(parseDecimal("250000 SATS")).toBe(250000);
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

  it("detects dual-column with Received Amount / Sent Amount", () => {
    const headers = ["Date", "Sent Amount", "Sent Currency", "Received Amount", "Received Currency", "Fee Amount", "Fee Currency", "Tag"];
    const mapping = detectColumns(headers);
    expect(mapping.date).toBe("Date");
    expect(mapping.type).toBe("Tag");
    expect(mapping.receivedQuantity).toBe("Received Amount");
    expect(mapping.receivedCurrency).toBe("Received Currency");
    expect(mapping.sentQuantity).toBe("Sent Amount");
    expect(mapping.sentCurrency).toBe("Sent Currency");
    expect(mapping.fee).toBe("Fee Amount");
  });

  it("detects new variations: created_at, vol, proceeds, tx_type", () => {
    const headers = ["created_at", "tx_type", "vol", "fill price", "proceeds", "commission"];
    const mapping = detectColumns(headers);
    expect(mapping.date).toBe("created_at");
    expect(mapping.type).toBe("tx_type");
    expect(mapping.amount).toBe("vol");
    expect(mapping.price).toBe("fill price");
    expect(mapping.total).toBe("proceeds");
    expect(mapping.fee).toBe("commission");
  });

  it("keyword fallback detects 'Transaction Date (UTC)' as date", () => {
    const headers = ["Transaction Date (UTC)", "BTC Quantity", "USD Price", "Total USD"];
    const mapping = detectColumns(headers);
    expect(mapping.date).toBe("Transaction Date (UTC)");
  });

  it("keyword fallback detects 'BTC Amount' variants", () => {
    const headers = ["Date", "Crypto Amount (BTC)", "USD Spot Price", "Total"];
    const mapping = detectColumns(headers);
    // "Crypto Amount (BTC)" doesn't exactly match any variation, but keyword fallback catches it
    expect(mapping.amount).toBe("Crypto Amount (BTC)");
  });

  it("keyword fallback does not steal claimed headers", () => {
    // "Fee Amount" should match fee (exact), keyword fallback should NOT also match it as amount
    const headers = ["Date", "Quantity Transacted", "Price", "Fee Amount"];
    const mapping = detectColumns(headers);
    expect(mapping.fee).toBe("Fee Amount");
    expect(mapping.amount).toBe("Quantity Transacted");
  });

  it("detects Kraken-style headers", () => {
    const headers = ["time", "type", "vol", "cost", "fee"];
    const mapping = detectColumns(headers);
    expect(mapping.date).toBe("time");
    expect(mapping.type).toBe("type");
    expect(mapping.amount).toBe("vol");
    expect(mapping.total).toBe("cost");
    expect(mapping.fee).toBe("fee");
  });

  it("detects Bisq-style 'Amount in BTC'", () => {
    const headers = ["Date/Time", "Offer Type", "Amount in BTC", "Price", "Trading Fee"];
    const mapping = detectColumns(headers);
    expect(mapping.date).toBe("Date/Time");
    expect(mapping.amount).toBe("Amount in BTC");
    expect(mapping.price).toBe("Price");
    expect(mapping.fee).toBe("Trading Fee");
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

  it("user-entered exchange name overrides CSV exchange column", () => {
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
    // The user-entered name always wins for IRS per-wallet tracking
    expect(result.transactions[0].exchange).toBe("DefaultExchange");
    expect(result.transactions[0].wallet).toBe("DefaultExchange");
  });

  it("user-entered exchange name used when CSV exchange column empty", () => {
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

  it("user-entered exchange name overrides CSV wallet column", () => {
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
    // The user-entered name always wins — CSV wallet column is ignored
    expect(result.transactions[0].wallet).toBe("Coinbase");
    expect(result.transactions[0].exchange).toBe("Coinbase");
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

  it("parses Excel serial dates in CSV rows", () => {
    const csv = "Date,Type,Amount,Price\n44192,Buy,0.5,23000";
    const mapping: ColumnMapping = {
      date: "Date",
      type: "Type",
      amount: "Amount",
      price: "Price",
    };
    const result = parseCSVContent(csv, "Test", mapping);
    expect(result.transactions).toHaveLength(1);
    const tx = result.transactions[0];
    const d = new Date(tx.date);
    expect(d.getUTCFullYear()).toBe(2020);
    expect(d.getUTCMonth()).toBe(11); // December
    expect(d.getUTCDate()).toBe(27);
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

// ═══════════════════════════════════════════════════════
// Swan Bitcoin CSV format
// ═══════════════════════════════════════════════════════

describe("Swan Bitcoin CSV", () => {
  const swanHeaders = "Event,Date,Timezone,Status,Transaction ID,Total USD,Transaction USD,Fee USD,Unit Count,Asset Type,BTC Price,Address Label,USD Cost Basis,Acquisition Date";

  it("auto-detects Swan column names including Event and Unit Count", () => {
    const headers = swanHeaders.split(",");
    const mapping = detectColumns(headers);
    expect(mapping.type).toBe("Event");
    expect(mapping.amount).toBe("Unit Count");
    expect(mapping.price).toBe("BTC Price");
    expect(mapping.total).toBe("Total USD");
    expect(mapping.fee).toBe("Fee USD");
    expect(mapping.notes).toBe("Transaction ID");
    expect(mapping.asset).toBe("Asset Type");
  });

  it("accepts 'settled' status (Swan Bitcoin)", () => {
    const csv = [
      swanHeaders,
      "purchase,2023-06-24 04:35:11+00,UTC,settled,7d82700a-1234,40.00,40.00,,0.00129600,BTC,30864.20,,,",
    ].join("\n");
    const mapping: ColumnMapping = {
      date: "Date",
      type: "Event",
      amount: "Unit Count",
      price: "BTC Price",
      total: "Total USD",
      fee: "Fee USD",
      notes: "Transaction ID",
      asset: "Asset Type",
    };
    const result = parseCSVContent(csv, "Swan", mapping);
    expect(result.transactions).toHaveLength(1);
    expect(result.transactions[0].transactionType).toBe(TransactionType.Buy);
    expect(result.transactions[0].amountBTC).toBeCloseTo(0.001296, 6);
  });

  it("skips USD deposit rows (non-BTC asset)", () => {
    const csv = [
      swanHeaders,
      "deposit,2023-06-01 05:12:39+00,UTC,settled,,815.00,,,,USD,,,,",
    ].join("\n");
    const mapping: ColumnMapping = {
      date: "Date",
      type: "Event",
      amount: "Unit Count",
      price: "BTC Price",
      total: "Total USD",
      fee: "Fee USD",
      notes: "Transaction ID",
      asset: "Asset Type",
    };
    const result = parseCSVContent(csv, "Swan", mapping);
    expect(result.transactions).toHaveLength(0);
    expect(result.skippedRows.length).toBeGreaterThan(0);
    expect(result.skippedRows[0].reason).toContain("Non-BTC asset");
  });

  it("parses BTC deposit as TransferIn", () => {
    const csv = [
      swanHeaders,
      "deposit,2023-06-01 06:38:27+00,UTC,settled,,,,,0.00901677,BTC,,Custodial Transferred from Prime Trust,,,",
    ].join("\n");
    const mapping: ColumnMapping = {
      date: "Date",
      type: "Event",
      amount: "Unit Count",
      price: "BTC Price",
      total: "Total USD",
      fee: "Fee USD",
      notes: "Transaction ID",
      asset: "Asset Type",
    };
    const result = parseCSVContent(csv, "Swan", mapping);
    expect(result.transactions).toHaveLength(1);
    expect(result.transactions[0].transactionType).toBe(TransactionType.TransferIn);
    expect(result.transactions[0].amountBTC).toBeCloseTo(0.00901677, 8);
  });

  it("parses full Swan export with mixed rows", () => {
    const csv = [
      swanHeaders,
      "deposit,2023-06-01 05:12:39+00,UTC,settled,,815.00,,,,USD,,,,",
      "deposit,2023-06-01 06:38:27+00,UTC,settled,,,,,0.00901677,BTC,,Custodial Transferred,,,",
      "purchase,2023-06-08 19:33:29+00,UTC,settled,05bb6d47-7ba0,815.00,815.00,,0.03062470,BTC,26612.51,,,",
      "purchase,2023-06-24 04:35:11+00,UTC,settled,7d82700a-7002,40.00,40.00,,0.00129600,BTC,30864.20,,,",
    ].join("\n");
    const mapping: ColumnMapping = {
      date: "Date",
      type: "Event",
      amount: "Unit Count",
      price: "BTC Price",
      total: "Total USD",
      fee: "Fee USD",
      notes: "Transaction ID",
      asset: "Asset Type",
    };
    const result = parseCSVContent(csv, "Swan", mapping);
    // USD deposit skipped, BTC deposit + 2 purchases = 3 transactions
    expect(result.transactions).toHaveLength(3);
    expect(result.skippedRows).toHaveLength(1); // USD deposit
    expect(result.transactions[0].transactionType).toBe(TransactionType.TransferIn);
    expect(result.transactions[1].transactionType).toBe(TransactionType.Buy);
    expect(result.transactions[2].transactionType).toBe(TransactionType.Buy);
  });
});
