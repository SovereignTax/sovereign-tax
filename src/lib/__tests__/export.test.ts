import { describe, it, expect } from "vitest";
import {
  exportForm8949CSV,
  exportLegacyCSV,
  exportTurboTaxTXF,
  exportTurboTaxCSV,
  exportIncomeCSV,
  exportForm8283CSV,
  buildDonationSummary,
} from "../export";
import { AccountingMethod, TransactionType, IncomeType } from "../types";
import { SaleRecord, Transaction, LotDetail } from "../models";

// ═══════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════

function makeLotDetail(overrides: Partial<LotDetail> = {}): LotDetail {
  return {
    id: "ld-1",
    lotId: "lot-1",
    purchaseDate: "2024-01-15T12:00:00.000Z",
    amountBTC: 0.5,
    costBasisPerBTC: 40000,
    totalCost: 20000,
    daysHeld: 150,
    exchange: "Coinbase",
    isLongTerm: false,
    ...overrides,
  };
}

function makeSaleRecord(overrides: Partial<SaleRecord> = {}): SaleRecord {
  return {
    id: "sale-1",
    saleDate: "2024-06-15T12:00:00.000Z",
    amountSold: 0.5,
    salePricePerBTC: 60000,
    totalProceeds: 30000,
    costBasis: 20000,
    gainLoss: 10000,
    lotDetails: [makeLotDetail()],
    holdingPeriodDays: 150,
    isLongTerm: false,
    isMixedTerm: false,
    method: AccountingMethod.FIFO,
    ...overrides,
  };
}

function makeDonationRecord(overrides: Partial<SaleRecord> = {}): SaleRecord {
  return {
    id: "don-1",
    saleDate: "2024-06-15T12:00:00.000Z",
    amountSold: 0.3,
    salePricePerBTC: 0,
    totalProceeds: 0,
    costBasis: 12000,
    gainLoss: 0,
    lotDetails: [
      makeLotDetail({ amountBTC: 0.3, totalCost: 12000 }),
    ],
    holdingPeriodDays: 150,
    isLongTerm: false,
    isMixedTerm: false,
    method: AccountingMethod.FIFO,
    isDonation: true,
    donationFmvPerBTC: 65000,
    donationFmvTotal: 19500,
    ...overrides,
  };
}

// ═══════════════════════════════════════════════════════
// Form 8949 CSV
// ═══════════════════════════════════════════════════════

describe("exportForm8949CSV", () => {
  it("generates valid CSV with short-term sale", () => {
    const csv = exportForm8949CSV([makeSaleRecord()], 2024, AccountingMethod.FIFO);
    expect(csv).toContain("Form 8949");
    expect(csv).toContain("Tax Year: 2024");
    expect(csv).toContain("SHORT-TERM");
    expect(csv).toContain("0.50000000 BTC");
  });

  it("generates long-term section for long-term sales", () => {
    const sale = makeSaleRecord({
      isLongTerm: true,
      lotDetails: [makeLotDetail({ isLongTerm: true, daysHeld: 400 })],
    });
    const csv = exportForm8949CSV([sale], 2024, AccountingMethod.FIFO);
    expect(csv).toContain("LONG-TERM");
    expect(csv).toContain("0.50000000 BTC");
  });

  it("splits mixed-term sales into both sections", () => {
    const sale = makeSaleRecord({
      isMixedTerm: true,
      lotDetails: [
        makeLotDetail({ amountBTC: 0.3, totalCost: 12000, isLongTerm: false }),
        makeLotDetail({
          id: "ld-2",
          lotId: "lot-2",
          amountBTC: 0.2,
          totalCost: 8000,
          isLongTerm: true,
          daysHeld: 400,
        }),
      ],
    });
    const csv = exportForm8949CSV([sale], 2024, AccountingMethod.FIFO);
    // Both sections should have entries
    const lines = csv.split("\n");
    const shortTermLines = lines.filter((l) => l.includes("0.30000000 BTC"));
    const longTermLines = lines.filter((l) => l.includes("0.20000000 BTC"));
    expect(shortTermLines.length).toBeGreaterThanOrEqual(1);
    expect(longTermLines.length).toBeGreaterThanOrEqual(1);
  });

  it("excludes donations from Form 8949", () => {
    const sales = [makeSaleRecord(), makeDonationRecord()];
    const csv = exportForm8949CSV(sales, 2024, AccountingMethod.FIFO);
    // Only the regular sale should appear (0.5 BTC), not the donation (0.3 BTC)
    const dataLines = csv.split("\n").filter((l) => l.match(/^"?\d+\.\d+ BTC/));
    expect(dataLines).toHaveLength(1);
    expect(dataLines[0]).toContain("0.50000000 BTC");
  });

  it("includes Schedule D summary", () => {
    const csv = exportForm8949CSV([makeSaleRecord()], 2024, AccountingMethod.FIFO);
    expect(csv).toContain("SCHEDULE D SUMMARY");
    expect(csv).toContain("NET TOTAL");
  });
});

// ═══════════════════════════════════════════════════════
// Legacy CSV
// ═══════════════════════════════════════════════════════

describe("exportLegacyCSV", () => {
  it("generates correct CSV headers", () => {
    const csv = exportLegacyCSV([makeSaleRecord()]);
    const firstLine = csv.split("\n")[0];
    expect(firstLine).toContain("Date Sold");
    expect(firstLine).toContain("Date Acquired");
    expect(firstLine).toContain("Proceeds");
    expect(firstLine).toContain("Cost Basis");
  });

  it("includes sale data rows", () => {
    const csv = exportLegacyCSV([makeSaleRecord()]);
    const lines = csv.split("\n");
    expect(lines.length).toBeGreaterThan(1);
    expect(lines[1]).toContain("0.50000000 BTC");
  });

  it("excludes donations", () => {
    const csv = exportLegacyCSV([makeSaleRecord(), makeDonationRecord()]);
    const dataLines = csv.split("\n").slice(1);
    expect(dataLines).toHaveLength(1);
  });
});

// ═══════════════════════════════════════════════════════
// TurboTax TXF
// ═══════════════════════════════════════════════════════

describe("exportTurboTaxTXF", () => {
  it("starts with TXF header", () => {
    const txf = exportTurboTaxTXF([makeSaleRecord()], 2024);
    expect(txf).toMatch(/^V042/);
    expect(txf).toContain("ASovereign Tax");
  });

  it("uses code 323 for short-term", () => {
    const txf = exportTurboTaxTXF([makeSaleRecord()], 2024);
    expect(txf).toContain("N323");
  });

  it("uses code 324 for long-term", () => {
    const sale = makeSaleRecord({
      isLongTerm: true,
      lotDetails: [makeLotDetail({ isLongTerm: true })],
    });
    const txf = exportTurboTaxTXF([sale], 2024);
    expect(txf).toContain("N324");
  });

  it("excludes donations", () => {
    const txf = exportTurboTaxTXF([makeDonationRecord()], 2024);
    // Should only have the header, no data records
    expect(txf).not.toContain("N323");
    expect(txf).not.toContain("N324");
  });
});

// ═══════════════════════════════════════════════════════
// TurboTax CSV
// ═══════════════════════════════════════════════════════

describe("exportTurboTaxCSV", () => {
  it("generates correct TurboTax CSV headers", () => {
    const csv = exportTurboTaxCSV([makeSaleRecord()], 2024);
    const firstLine = csv.split("\n")[0];
    expect(firstLine).toContain("Currency Name");
    expect(firstLine).toContain("Purchase Date");
    expect(firstLine).toContain("Cost Basis");
    expect(firstLine).toContain("Date Sold");
    expect(firstLine).toContain("Proceeds");
  });

  it("excludes donations", () => {
    const csv = exportTurboTaxCSV([makeDonationRecord()], 2024);
    const lines = csv.split("\n").filter((l) => l.trim());
    expect(lines).toHaveLength(1); // Only header
  });
});

// ═══════════════════════════════════════════════════════
// Income CSV (Schedule 1)
// ═══════════════════════════════════════════════════════

describe("exportIncomeCSV", () => {
  it("exports mining income transactions", () => {
    const transactions: Transaction[] = [
      {
        id: "t1",
        date: "2024-06-15T12:00:00.000Z",
        transactionType: TransactionType.Buy,
        amountBTC: 0.001,
        pricePerBTC: 60000,
        totalUSD: 60,
        exchange: "Mining Pool",
        notes: "Block reward",
        incomeType: IncomeType.Mining,
      },
    ];
    const csv = exportIncomeCSV(transactions, 2024);
    expect(csv).toContain("Schedule 1");
    expect(csv).toContain("Mining");
    expect(csv).toContain("0.00100000");
  });

  it("only includes income transactions for the specified year", () => {
    const transactions: Transaction[] = [
      {
        id: "t1",
        date: "2024-06-15T12:00:00.000Z",
        transactionType: TransactionType.Buy,
        amountBTC: 0.001,
        pricePerBTC: 60000,
        totalUSD: 60,
        exchange: "Mining",
        notes: "",
        incomeType: IncomeType.Mining,
      },
      {
        id: "t2",
        date: "2023-06-15T12:00:00.000Z",
        transactionType: TransactionType.Buy,
        amountBTC: 0.002,
        pricePerBTC: 30000,
        totalUSD: 60,
        exchange: "Mining",
        notes: "",
        incomeType: IncomeType.Mining,
      },
    ];
    const csv = exportIncomeCSV(transactions, 2024);
    // Should only include the 2024 transaction
    const dataLines = csv.split("\n").filter((l) => l.match(/^\d{4}-/));
    expect(dataLines).toHaveLength(1);
    expect(dataLines[0]).toContain("2024");
  });

  it("excludes non-income transactions", () => {
    const transactions: Transaction[] = [
      {
        id: "t1",
        date: "2024-01-15T12:00:00.000Z",
        transactionType: TransactionType.Buy,
        amountBTC: 1.0,
        pricePerBTC: 40000,
        totalUSD: 40000,
        exchange: "Coinbase",
        notes: "",
        // No incomeType
      },
    ];
    const csv = exportIncomeCSV(transactions, 2024);
    const dataLines = csv.split("\n").filter((l) => l.match(/^\d{4}-/));
    expect(dataLines).toHaveLength(0);
  });
});

// ═══════════════════════════════════════════════════════
// Form 8283 CSV (Charitable Donations)
// ═══════════════════════════════════════════════════════

describe("exportForm8283CSV", () => {
  it("generates Form 8283 with donation data", () => {
    const summary = [
      {
        date: "2024-06-15T12:00:00.000Z",
        amountBTC: 0.3,
        fmvPerBTC: 65000,
        totalFMV: 19500,
        costBasis: 12000,
        holdingPeriod: "Short-term",
        exchange: "Coinbase",
        notes: "Charity donation",
        lotDetails: [
          {
            purchaseDate: "2024-01-15T12:00:00.000Z",
            amountBTC: 0.3,
            costBasis: 12000,
            isLongTerm: false,
            exchange: "Coinbase",
          },
        ],
      },
    ];
    const csv = exportForm8283CSV(summary, 2024);
    expect(csv).toContain("Form 8283");
    expect(csv).toContain("Tax Year: 2024");
    expect(csv).toContain("0.30000000 BTC");
    expect(csv).toContain("19500.00"); // FMV
    expect(csv).toContain("12000.00"); // Cost basis
  });

  it("includes IRS compliance notes", () => {
    const csv = exportForm8283CSV([], 2024);
    expect(csv).toContain("IRC §170");
    expect(csv).toContain("qualified appraisal");
  });
});

// ═══════════════════════════════════════════════════════
// buildDonationSummary
// ═══════════════════════════════════════════════════════

describe("buildDonationSummary", () => {
  it("uses FMV from SaleRecord when available", () => {
    const donationSales = [makeDonationRecord()];
    const transactions: Transaction[] = [];
    const summary = buildDonationSummary(donationSales, transactions, 2024);
    expect(summary).toHaveLength(1);
    expect(summary[0].fmvPerBTC).toBe(65000);
    expect(summary[0].totalFMV).toBe(19500);
  });

  it("falls back to transaction matching for legacy data without FMV", () => {
    const donationSale: SaleRecord = {
      ...makeDonationRecord(),
      donationFmvPerBTC: undefined,
      donationFmvTotal: undefined,
    };
    const transactions: Transaction[] = [
      {
        id: "tx-d1",
        date: "2024-06-15T12:00:00.000Z",
        transactionType: TransactionType.Donation,
        amountBTC: 0.3,
        pricePerBTC: 65000,
        totalUSD: 19500,
        exchange: "Coinbase",
        notes: "Legacy donation",
      },
    ];
    const summary = buildDonationSummary([donationSale], transactions, 2024);
    expect(summary).toHaveLength(1);
    expect(summary[0].fmvPerBTC).toBe(65000);
    expect(summary[0].notes).toBe("Legacy donation");
  });

  it("determines holding period correctly", () => {
    const sale = makeDonationRecord({
      lotDetails: [
        makeLotDetail({ amountBTC: 0.15, isLongTerm: true }),
        makeLotDetail({ id: "ld-2", amountBTC: 0.15, isLongTerm: false }),
      ],
    });
    const summary = buildDonationSummary([sale], [], 2024);
    expect(summary[0].holdingPeriod).toBe("Mixed");
  });
});
