import { describe, it, expect } from "vitest";
import { exportForm8949PDF } from "../pdf-export";
import { AccountingMethod } from "../types";
import { SaleRecord } from "../models";

function sale(overrides: Partial<SaleRecord> = {}): SaleRecord {
  return {
    id: "sale-1",
    saleDate: new Date(2026, 5, 1, 12).toISOString(),
    amountSold: 0.5,
    salePricePerBTC: 60000,
    totalProceeds: 30000,
    costBasis: 20000,
    gainLoss: 10000,
    lotDetails: [{
      id: "ld-1", lotId: "lot-1", purchaseDate: new Date(2026, 1, 1, 12).toISOString(), amountBTC: 0.5,
      costBasisPerBTC: 40000, totalCost: 20000, daysHeld: 120, exchange: "Coinbase", wallet: "Coinbase", isLongTerm: false,
    }],
    holdingPeriodDays: 120,
    isLongTerm: false,
    isMixedTerm: false,
    method: AccountingMethod.FIFO,
    wallet: "Coinbase",
    ...overrides,
  };
}

// jsPDF writes uncompressed text operators with ( and ) escaped as \( \)
const text = (bytes: Uint8Array) => new TextDecoder("latin1").decode(bytes).replace(/\\([()])/g, "$1");

describe("exportForm8949PDF", () => {
  it("2025+ PDF uses the checked digital-asset box", () => {
    const pdf = text(exportForm8949PDF([sale()], 2026, AccountingMethod.FIFO, 0, { coinbase: { kind: "exchange" } }));
    expect(pdf).toContain("Box G checked");
    expect(pdf).toContain("Line 1b (box G)");
  });

  it("pre-2025 PDF keeps Part I / Part II headings", () => {
    const pdf = text(exportForm8949PDF([sale({ saleDate: "2024-06-15T12:00:00.000Z" })], 2024, AccountingMethod.FIFO));
    expect(pdf).toContain("Part I");
    expect(pdf).not.toContain("checked");
  });
});
