import { describe, it, expect } from "vitest";
import {
  TransactionType,
  AccountingMethod,
  IncomeType,
  parseTransactionType,
  parseIncomeType,
  TransactionTypeDisplayNames,
  AccountingMethodDisplayNames,
  IncomeTypeDisplayNames,
} from "../types";

// ═══════════════════════════════════════════════════════
// ENUMS — sanity checks
// ═══════════════════════════════════════════════════════

describe("Enums", () => {
  it("AccountingMethod has only FIFO and SpecificID", () => {
    const values = Object.values(AccountingMethod);
    expect(values).toContain("FIFO");
    expect(values).toContain("SpecificID");
    expect(values).toHaveLength(2);
  });

  it("TransactionType has all expected types", () => {
    const values = Object.values(TransactionType);
    expect(values).toContain("buy");
    expect(values).toContain("sell");
    expect(values).toContain("transfer_in");
    expect(values).toContain("transfer_out");
    expect(values).toContain("donation");
    expect(values).toHaveLength(5);
  });

  it("IncomeType has all expected types", () => {
    const values = Object.values(IncomeType);
    expect(values).toContain("mining");
    expect(values).toContain("fork");
    expect(values).toContain("reward");
    expect(values).toContain("interest");
    expect(values).toHaveLength(4);
  });

  it("all display name maps are complete", () => {
    for (const method of Object.values(AccountingMethod)) {
      expect(AccountingMethodDisplayNames[method]).toBeDefined();
    }
    for (const type of Object.values(TransactionType)) {
      expect(TransactionTypeDisplayNames[type]).toBeDefined();
    }
    for (const type of Object.values(IncomeType)) {
      expect(IncomeTypeDisplayNames[type]).toBeDefined();
    }
  });
});

// ═══════════════════════════════════════════════════════
// parseTransactionType
// ═══════════════════════════════════════════════════════

describe("parseTransactionType", () => {
  // Buy types
  it.each([
    "buy", "Buy", "BUY", "purchase", "bought",
    "advanced trade buy", "market buy", "limit buy",
    "bitcoin purchase", "bitcoin boost",
  ])("parses '%s' as Buy", (input) => {
    expect(parseTransactionType(input)).toBe(TransactionType.Buy);
  });

  // Income → treated as Buy (tax-wise, income creates a lot)
  it.each([
    "reward", "rewards income", "mining", "interest",
    "coinbase earn", "learning reward", "fork",
  ])("parses income type '%s' as Buy", (input) => {
    expect(parseTransactionType(input)).toBe(TransactionType.Buy);
  });

  // Sell types
  it.each([
    "sell", "Sell", "sold", "advanced trade sell",
    "market sell", "limit sell", "bitcoin sale",
    "convert", "card spend",
  ])("parses '%s' as Sell", (input) => {
    expect(parseTransactionType(input)).toBe(TransactionType.Sell);
  });

  // Transfer In
  it.each([
    "receive", "received", "incoming", "deposit",
    "transfer in", "credit", "pro deposit",
    "asset migration",
  ])("parses '%s' as TransferIn", (input) => {
    expect(parseTransactionType(input)).toBe(TransactionType.TransferIn);
  });

  // Transfer Out
  it.each([
    "send", "sent", "outgoing", "withdrawal",
    "transfer out", "bitcoin withdrawal", "debit",
  ])("parses '%s' as TransferOut", (input) => {
    expect(parseTransactionType(input)).toBe(TransactionType.TransferOut);
  });

  // Donation
  it.each([
    "donation", "donate", "gift", "charitable", "charity",
  ])("parses '%s' as Donation", (input) => {
    expect(parseTransactionType(input)).toBe(TransactionType.Donation);
  });

  // Substring fallbacks
  it("falls back to Buy for substrings containing 'buy'", () => {
    expect(parseTransactionType("Quick Buy")).toBe(TransactionType.Buy);
  });

  it("falls back to Sell for substrings containing 'sell'", () => {
    expect(parseTransactionType("Quick Sell")).toBe(TransactionType.Sell);
  });

  it("falls back to Sell for substrings containing 'sale'", () => {
    expect(parseTransactionType("Quick sale")).toBe(TransactionType.Sell);
  });

  it("falls back to Donation for substrings containing 'charit'", () => {
    expect(parseTransactionType("charitable contribution")).toBe(TransactionType.Donation);
  });

  // Unknown
  it("returns null for unknown types", () => {
    expect(parseTransactionType("unknown")).toBeNull();
    expect(parseTransactionType("")).toBeNull();
    expect(parseTransactionType("xyz123")).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════
// parseIncomeType
// ═══════════════════════════════════════════════════════

describe("parseIncomeType", () => {
  it.each([
    ["mining", IncomeType.Mining],
    ["Mining", IncomeType.Mining],
    ["fork", IncomeType.Fork],
    ["reward", IncomeType.Reward],
    ["rewards income", IncomeType.Reward],
    ["coinbase earn", IncomeType.Reward],
    ["learning reward", IncomeType.Reward],
    ["interest", IncomeType.Interest],
    ["interest payout", IncomeType.Interest],
  ])("parses '%s' as %s", (input, expected) => {
    expect(parseIncomeType(input)).toBe(expected);
  });

  it("returns null for non-income types", () => {
    expect(parseIncomeType("buy")).toBeNull();
    expect(parseIncomeType("sell")).toBeNull();
    expect(parseIncomeType("transfer")).toBeNull();
    expect(parseIncomeType("")).toBeNull();
  });

  it("uses substring matching for 'mined'", () => {
    expect(parseIncomeType("BTC mined from pool")).toBe(IncomeType.Mining);
  });

  it("uses substring matching for 'earn'", () => {
    expect(parseIncomeType("DeFi earn program")).toBe(IncomeType.Reward);
  });
});
