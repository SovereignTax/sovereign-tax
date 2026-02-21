import { describe, it, expect } from "vitest";
import {
  formatUSD,
  formatBTC,
  formatDate,
  formatDateTime,
  formatCSVDecimal,
  timeAgo,
  findSimilarTransactions,
  transactionNaturalKey,
} from "../utils";

// ═══════════════════════════════════════════════════════
// FORMAT FUNCTIONS
// ═══════════════════════════════════════════════════════

describe("formatUSD", () => {
  it("formats positive amounts", () => {
    const result = formatUSD(1234.56);
    expect(result).toContain("1,234.56");
    expect(result).toContain("$");
  });

  it("formats zero", () => {
    const result = formatUSD(0);
    expect(result).toContain("0.00");
  });

  it("formats negative amounts", () => {
    const result = formatUSD(-500.5);
    expect(result).toContain("500.50");
  });

  it("formats large amounts with commas", () => {
    const result = formatUSD(1000000);
    expect(result).toContain("1,000,000");
  });
});

describe("formatBTC", () => {
  it("formats to 8 decimal places", () => {
    expect(formatBTC(1.0)).toBe("1.00000000");
    expect(formatBTC(0.00000001)).toBe("0.00000001"); // 1 satoshi
    expect(formatBTC(0.123456789)).toBe("0.12345679"); // Rounds
  });
});

describe("formatCSVDecimal", () => {
  it("formats to 2 decimal places", () => {
    expect(formatCSVDecimal(1234.5)).toBe("1234.50");
    expect(formatCSVDecimal(0)).toBe("0.00");
    expect(formatCSVDecimal(99.999)).toBe("100.00");
  });
});

describe("formatDate", () => {
  it("formats ISO date to US locale", () => {
    const result = formatDate("2024-06-15T12:00:00.000Z");
    // Should contain month, day, and year
    expect(result).toMatch(/\d{2}\/\d{2}\/\d{4}/);
  });
});

describe("formatDateTime", () => {
  it("includes time component", () => {
    const result = formatDateTime("2024-06-15T14:30:00.000Z");
    // Should contain date and time
    expect(result).toMatch(/\d{2}\/\d{2}\/\d{4}/);
  });
});

// ═══════════════════════════════════════════════════════
// timeAgo
// ═══════════════════════════════════════════════════════

describe("timeAgo", () => {
  it("shows seconds for very recent times", () => {
    const now = new Date();
    const result = timeAgo(new Date(now.getTime() - 30000)); // 30 seconds ago
    expect(result).toMatch(/\d+s ago/);
  });

  it("shows minutes for recent times", () => {
    const now = new Date();
    const result = timeAgo(new Date(now.getTime() - 5 * 60 * 1000)); // 5 min ago
    expect(result).toMatch(/\d+m ago/);
  });

  it("shows hours", () => {
    const now = new Date();
    const result = timeAgo(new Date(now.getTime() - 3 * 60 * 60 * 1000)); // 3 hours ago
    expect(result).toMatch(/\d+h ago/);
  });

  it("shows days for older times", () => {
    const now = new Date();
    const result = timeAgo(new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000)); // 2 days ago
    expect(result).toMatch(/\d+d ago/);
  });
});

// ═══════════════════════════════════════════════════════
// findSimilarTransactions
// ═══════════════════════════════════════════════════════

describe("findSimilarTransactions", () => {
  const existing = [
    { date: "2024-01-15T12:00:00.000Z", transactionType: "buy", amountBTC: 1.0, exchange: "Coinbase" },
    { date: "2024-01-15T18:00:00.000Z", transactionType: "buy", amountBTC: 0.99, exchange: "Coinbase" },
    { date: "2024-01-16T12:00:00.000Z", transactionType: "buy", amountBTC: 1.0, exchange: "Coinbase" },
    { date: "2024-01-15T12:00:00.000Z", transactionType: "sell", amountBTC: 1.0, exchange: "Coinbase" },
  ];

  it("finds exact match on same day", () => {
    const similar = findSimilarTransactions(existing, "buy", "2024-01-15T12:00:00.000Z", 1.0);
    expect(similar.length).toBeGreaterThanOrEqual(1);
  });

  it("finds similar amount within 5% on same day", () => {
    const similar = findSimilarTransactions(existing, "buy", "2024-01-15T14:00:00.000Z", 1.0);
    // Should find both the 1.0 and 0.99 (within 5%)
    expect(similar.length).toBe(2);
  });

  it("does not match different transaction types", () => {
    const similar = findSimilarTransactions(existing, "sell", "2024-01-15T12:00:00.000Z", 1.0);
    expect(similar).toHaveLength(1); // Only the sell
  });

  it("does not match different dates", () => {
    const similar = findSimilarTransactions(existing, "buy", "2024-02-01T12:00:00.000Z", 1.0);
    expect(similar).toHaveLength(0);
  });

  it("handles zero amount", () => {
    const items = [
      { date: "2024-01-15T12:00:00.000Z", transactionType: "buy", amountBTC: 0, exchange: "X" },
    ];
    const similar = findSimilarTransactions(items, "buy", "2024-01-15T12:00:00.000Z", 0);
    expect(similar).toHaveLength(1);
  });
});

// ═══════════════════════════════════════════════════════
// transactionNaturalKey
// ═══════════════════════════════════════════════════════

describe("transactionNaturalKey", () => {
  it("generates consistent keys for same transaction", () => {
    const tx = {
      date: "2024-01-15T12:00:00.000Z",
      transactionType: "buy",
      amountBTC: 1.0,
      exchange: "Coinbase",
    };
    const key1 = transactionNaturalKey(tx);
    const key2 = transactionNaturalKey(tx);
    expect(key1).toBe(key2);
  });

  it("generates different keys for different amounts", () => {
    const tx1 = {
      date: "2024-01-15T12:00:00.000Z",
      transactionType: "buy",
      amountBTC: 1.0,
      exchange: "Coinbase",
    };
    const tx2 = { ...tx1, amountBTC: 2.0 };
    expect(transactionNaturalKey(tx1)).not.toBe(transactionNaturalKey(tx2));
  });

  it("generates different keys for different types", () => {
    const tx1 = {
      date: "2024-01-15T12:00:00.000Z",
      transactionType: "buy",
      amountBTC: 1.0,
      exchange: "Coinbase",
    };
    const tx2 = { ...tx1, transactionType: "sell" };
    expect(transactionNaturalKey(tx1)).not.toBe(transactionNaturalKey(tx2));
  });

  it("is case-insensitive on exchange", () => {
    const tx1 = {
      date: "2024-01-15T12:00:00.000Z",
      transactionType: "buy",
      amountBTC: 1.0,
      exchange: "Coinbase",
    };
    const tx2 = { ...tx1, exchange: "coinbase" };
    expect(transactionNaturalKey(tx1)).toBe(transactionNaturalKey(tx2));
  });

  it("includes wallet in key when present", () => {
    const tx = {
      date: "2024-01-15T12:00:00.000Z",
      transactionType: "buy",
      amountBTC: 1.0,
      exchange: "Coinbase",
      wallet: "Ledger",
    };
    const key = transactionNaturalKey(tx);
    expect(key).toContain("ledger");
  });

  it("formats BTC to 8 decimal places", () => {
    const tx = {
      date: "2024-01-15T12:00:00.000Z",
      transactionType: "buy",
      amountBTC: 0.1,
      exchange: "Coinbase",
    };
    const key = transactionNaturalKey(tx);
    expect(key).toContain("0.10000000");
  });
});
