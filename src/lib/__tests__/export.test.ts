import { describe, it, expect } from "vitest";
import {
  exportForm8949CSV,
  exportLegacyCSV,
  exportTurboTaxTXF,
  exportTurboTaxCSV,
  exportIncomeCSV,
  exportForm8283CSV,
  exportAuditLogCSV,
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

// ═══════════════════════════════════════════════════════
// CSV Formula Injection Defense (Batch A — A1)
// Every user-controlled string field that flows into an export must be
// defanged against CSV formula injection (OWASP). Excel/Numbers execute
// cells starting with = + - @ \t \r — a malicious imported CSV can chain
// into the user's exported file and run on their accountant's machine.
// ═══════════════════════════════════════════════════════

describe("CSV formula injection defense", () => {
  const MALICIOUS = "=cmd|'/c calc'!A1";
  const HYPERLINK = '=HYPERLINK("http://evil","Click")';

  it("Form 8949 CSV: defangs malicious wallet name in property description", () => {
    const sale = makeSaleRecord({
      lotDetails: [makeLotDetail({ wallet: MALICIOUS, exchange: "Coinbase" })],
    });
    const csv = exportForm8949CSV([sale], 2024, AccountingMethod.FIFO);
    // Property description cell always starts with the BTC digit, so cell-start
    // can't be a formula, but the wallet inside parens must not be raw either.
    // After sanitize, the leading "=" inside the parens is prefixed with '.
    expect(csv).toContain("('=cmd");
    // Original malicious form must not appear unescaped
    expect(csv).not.toMatch(/\(=cmd/);
  });

  it("Legacy CSV: defangs malicious exchange field", () => {
    const sale = makeSaleRecord({
      lotDetails: [makeLotDetail({ exchange: MALICIOUS })],
    });
    const csv = exportLegacyCSV([sale]);
    // The exchange column is its own cell at end of row — must be defanged.
    // After defang it starts with '=, then no special chars so no quote wrap needed.
    expect(csv).toMatch(/,'=cmd/);
    // Bare "=cmd" at start of a cell must NOT appear
    expect(csv).not.toMatch(/,=cmd/);
  });

  it("Legacy CSV: HYPERLINK injection in exchange is defanged", () => {
    const sale = makeSaleRecord({
      lotDetails: [makeLotDetail({ exchange: HYPERLINK })],
    });
    const csv = exportLegacyCSV([sale]);
    // HYPERLINK contains comma + quotes → quote-wrap kicks in, leading = is defanged
    // Quote-wrapped cell with internal quotes escaped: ,"'=HYPERLINK(""http://evil"",""Click"")"
    expect(csv).toContain('"\'=HYPERLINK(');
    expect(csv).not.toMatch(/,=HYPERLINK/);
  });

  it("Income CSV: defangs malicious notes field", () => {
    const tx: Transaction = {
      id: "t1",
      date: "2024-03-01T12:00:00.000Z",
      amountBTC: 0.01,
      pricePerBTC: 60000,
      totalUSD: 600,
      transactionType: TransactionType.Buy,
      exchange: "MyMiner",
      incomeType: IncomeType.Mining,
      notes: MALICIOUS,
    };
    const csv = exportIncomeCSV([tx], 2024);
    expect(csv).toContain("'=cmd");
    expect(csv).not.toMatch(/,=cmd/);
  });

  it("Income CSV: strips embedded newlines from notes to prevent row splits", () => {
    const tx: Transaction = {
      id: "t1",
      date: "2024-03-01T12:00:00.000Z",
      amountBTC: 0.01,
      pricePerBTC: 60000,
      totalUSD: 600,
      transactionType: TransactionType.Buy,
      exchange: "MyMiner",
      incomeType: IncomeType.Mining,
      notes: "line1\nline2\r\nline3",
    };
    const csv = exportIncomeCSV([tx], 2024);
    // The header line + 1 data row + blank + total = 4 lines for the data block,
    // plus the 4 preamble lines (title, year, generated, blank) = 8 total.
    // Critically: the data row stays on ONE line.
    const dataRow = csv.split("\n").find((l) => l.includes("MyMiner"));
    expect(dataRow).toBeDefined();
    expect(dataRow).not.toContain("\n");
    // Newlines collapsed to spaces — content preserved
    expect(dataRow).toContain("line1 line2 line3");
  });

  it("Form 8283 CSV: defangs malicious exchange and notes", () => {
    const donation = makeDonationRecord({
      lotDetails: [makeLotDetail({ amountBTC: 0.3, exchange: MALICIOUS, isLongTerm: true })],
    });
    const summary = buildDonationSummary([donation], [], 2024);
    summary[0].exchange = MALICIOUS;
    summary[0].notes = MALICIOUS;
    const csv = exportForm8283CSV(summary, 2024);
    // No raw =cmd at cell start
    expect(csv).not.toMatch(/,=cmd/);
    // Defanged variant present
    expect(csv).toContain("'=cmd");
  });

  it("Audit log CSV: defangs malicious action and details", () => {
    const entries = [
      { id: "1", timestamp: "2024-01-01T00:00:00.000Z", action: MALICIOUS, details: MALICIOUS },
    ];
    const csv = exportAuditLogCSV(entries);
    expect(csv).not.toMatch(/,=cmd/);
    expect(csv).toContain("'=cmd");
  });

  it("Audit log CSV: details with commas and newlines stay on one row, quoted", () => {
    const entries = [
      {
        id: "1",
        timestamp: "2024-01-01T00:00:00.000Z",
        action: "Edit",
        details: "field1: a, field2: b\nfield3: c",
      },
    ];
    const csv = exportAuditLogCSV(entries);
    const rows = csv.split("\n");
    // Header + 1 data row = 2 rows exactly
    expect(rows).toHaveLength(2);
    // Comma inside details → row must be quote-wrapped
    expect(rows[1]).toContain('"field1: a, field2: b field3: c"');
  });

  it("Negative dollar amounts in CSV are NOT prefixed with quote (defang doesn't touch numeric formatters)", () => {
    // A loss sale produces negative gain — formatted as "-100.00"
    // The defang would (wrongly) turn this into "'-100.00" if applied to numbers.
    // This test confirms numeric formatters bypass defang.
    const sale = makeSaleRecord({
      salePricePerBTC: 30000, // loss: bought at 40k, sold at 30k → -5000 on 0.5 BTC
    });
    const csv = exportForm8949CSV([sale], 2024, AccountingMethod.FIFO);
    // Should contain a negative number formatted as -5000.00 (gain/loss column)
    expect(csv).toContain("-5000.00");
    // Should NOT contain "'-5000.00" (would mean defang was wrongly applied to numbers)
    expect(csv).not.toContain("'-5000.00");
  });

  it("TurboTax TXF: embedded newlines in wallet do not split the P tag across lines", () => {
    const sale = makeSaleRecord({
      lotDetails: [makeLotDetail({ wallet: "line1\nline2\nline3" })],
    });
    const txf = exportTurboTaxTXF([sale], 2024);
    // P tag must remain a single line per TXF spec
    const lines = txf.split("\n");
    const pLines = lines.filter((l) => l.startsWith("P"));
    expect(pLines).toHaveLength(1);
    // Embedded newlines stripped to spaces — content preserved
    expect(pLines[0]).toContain("line1 line2 line3");
  });

  it("TurboTax TXF: wallet starting with = is defanged inside the description", () => {
    // When the wallet ITSELF starts with =, sanitizeUserString defangs it before
    // it's interpolated into the description string.
    const sale = makeSaleRecord({
      lotDetails: [makeLotDetail({ wallet: "=cmd|inj" })],
    });
    const txf = exportTurboTaxTXF([sale], 2024);
    const lines = txf.split("\n");
    const pLine = lines.find((l) => l.startsWith("P"));
    expect(pLine).toBeDefined();
    // The wallet name inside parens is defanged because it starts with =
    expect(pLine).toContain("'=cmd");
    // Raw "(=cmd" must not appear
    expect(pLine).not.toMatch(/\(=cmd/);
  });
});
