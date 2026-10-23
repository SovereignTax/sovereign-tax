import { describe, it, expect } from "vitest";
import {
  assignBox,
  isCoveredLot,
  groupByBox,
  getUnclassifiedSaleWallets,
  suggestWalletKind,
  normalizeWalletKey,
  BOX_INFO,
} from "../form8949-boxes";
import { calculate } from "../cost-basis";
import { createTransaction, LotDetail, SaleRecord, WalletReporting } from "../models";
import { AccountingMethod, TransactionType } from "../types";

function detail(overrides: Partial<LotDetail> = {}): LotDetail {
  return {
    id: crypto.randomUUID(),
    lotId: "lot-1",
    purchaseDate: new Date(2026, 1, 1, 12).toISOString(),
    amountBTC: 0.5,
    costBasisPerBTC: 50000,
    totalCost: 25000,
    daysHeld: 30,
    exchange: "Coinbase",
    wallet: "Coinbase",
    isLongTerm: false,
    ...overrides,
  };
}

function sale(details: LotDetail[], overrides: Partial<SaleRecord> = {}): SaleRecord {
  return {
    id: crypto.randomUUID(),
    saleDate: new Date(2026, 5, 1, 12).toISOString(),
    amountSold: details.reduce((a, d) => a + d.amountBTC, 0),
    salePricePerBTC: 60000,
    totalProceeds: 30000,
    costBasis: 25000,
    gainLoss: 5000,
    lotDetails: details,
    holdingPeriodDays: 30,
    isLongTerm: false,
    isMixedTerm: false,
    method: AccountingMethod.FIFO,
    wallet: "Coinbase",
    ...overrides,
  };
}

const exchange: Record<string, WalletReporting> = { coinbase: { kind: "exchange" } };

describe("assignBox — classification matrix", () => {
  it("unclassified wallets go to I (short) / L (long)", () => {
    expect(assignBox(detail(), sale([detail()]), {})).toBe("I");
    expect(assignBox(detail({ isLongTerm: true }), sale([detail()]), undefined)).toBe("L");
  });

  it("self-custody wallets go to I / L", () => {
    const r: Record<string, WalletReporting> = { coinbase: { kind: "self-custody" } };
    expect(assignBox(detail(), sale([detail()]), r)).toBe("I");
    expect(assignBox(detail({ isLongTerm: true }), sale([detail()]), r)).toBe("L");
  });

  it("exchange with basisReported 'none' goes to H / K even for covered lots", () => {
    const r: Record<string, WalletReporting> = { coinbase: { kind: "exchange", basisReported: "none" } };
    expect(assignBox(detail(), sale([detail()]), r)).toBe("H");
    expect(assignBox(detail({ isLongTerm: true }), sale([detail()]), r)).toBe("K");
  });

  it("exchange with basisReported 'all' goes to G / J even for transferred lots", () => {
    const r: Record<string, WalletReporting> = { coinbase: { kind: "exchange", basisReported: "all" } };
    expect(assignBox(detail({ transferred: true }), sale([detail()]), r)).toBe("G");
    expect(assignBox(detail({ transferred: true, isLongTerm: true }), sale([detail()]), r)).toBe("J");
  });

  it("exchange default ('covered'): covered lots G / J, noncovered H / K", () => {
    expect(assignBox(detail(), sale([detail()]), exchange)).toBe("G");
    expect(assignBox(detail({ isLongTerm: true }), sale([detail()]), exchange)).toBe("J");
    const old = detail({ purchaseDate: new Date(2025, 5, 1, 12).toISOString(), isLongTerm: true });
    expect(assignBox(old, sale([old]), exchange)).toBe("K");
  });

  it("wallet keys are matched case- and whitespace-insensitively", () => {
    expect(assignBox(detail(), sale([detail()], { wallet: "  COINBASE " }), exchange)).toBe("G");
  });

  it("falls back to the lot's wallet when the SaleRecord predates sale.wallet", () => {
    expect(assignBox(detail(), sale([detail()], { wallet: undefined }), exchange)).toBe("G");
  });
});

describe("isCoveredLot", () => {
  it("bought on/after 2026-01-01 in the same wallet, never transferred → covered", () => {
    expect(isCoveredLot(detail(), "Coinbase")).toBe(true);
    expect(isCoveredLot(detail({ purchaseDate: new Date(2026, 0, 1, 0, 0).toISOString() }), "Coinbase")).toBe(true);
  });

  it("bought before 2026 → noncovered", () => {
    expect(isCoveredLot(detail({ purchaseDate: new Date(2025, 11, 31, 23).toISOString() }), "Coinbase")).toBe(false);
  });

  it("transferred in → noncovered", () => {
    expect(isCoveredLot(detail({ transferred: true }), "Coinbase")).toBe(false);
  });

  it("lot from another wallet (wallet-mismatch fallback) → noncovered", () => {
    expect(isCoveredLot(detail({ wallet: "Kraken", exchange: "Kraken" }), "Coinbase")).toBe(false);
  });
});

describe("assignBox — end to end through calculate()", () => {
  const tx = (type: TransactionType, date: string, amount: number, price: number, wallet: string, sourceWallet?: string) =>
    createTransaction({
      date: new Date(date + "T12:00:00").toISOString(),
      transactionType: type,
      amountBTC: amount,
      pricePerBTC: price,
      totalUSD: amount * price,
      exchange: wallet,
      wallet,
      sourceWallet,
      notes: "",
    });

  it("cold-storage coins sold on an exchange land in H; exchange-bought coins in G", () => {
    const result = calculate([
      tx(TransactionType.Buy, "2026-01-05", 1, 40000, "Cold"),
      tx(TransactionType.TransferIn, "2026-02-01", 1, 0, "Coinbase", "Cold"),
      tx(TransactionType.Buy, "2026-02-10", 1, 45000, "Coinbase"),
      tx(TransactionType.Sell, "2026-06-01", 2, 60000, "Coinbase"),
    ], AccountingMethod.FIFO);
    const boxes = result.sales[0].lotDetails.map((d) => assignBox(d, result.sales[0], exchange));
    expect(boxes.sort()).toEqual(["G", "H"]);
  });
});

describe("groupByBox", () => {
  it("groups in G–L order, omits empty boxes and excludes donations", () => {
    const ltOld = detail({ isLongTerm: true, purchaseDate: new Date(2024, 0, 1).toISOString() });
    const covered = detail();
    const cold = detail({ wallet: "Cold", exchange: "Cold" });
    const groups = groupByBox([
      sale([ltOld, covered]),
      sale([cold], { wallet: "Cold" }),
      sale([detail()], { isDonation: true }),
    ], exchange);
    expect(groups.map((g) => g.box)).toEqual(["G", "I", "K"]);
    expect(groups.reduce((n, g) => n + g.rows.length, 0)).toBe(3);
  });
});

describe("getUnclassifiedSaleWallets", () => {
  it("lists distinct unclassified sale wallets, skipping donations", () => {
    const wallets = getUnclassifiedSaleWallets([
      sale([detail()]),
      sale([detail()], { wallet: "Cold" }),
      sale([detail()], { wallet: "cold " }),
      sale([detail()], { wallet: "Charity Wallet", isDonation: true }),
    ], exchange);
    expect(wallets).toEqual(["Cold"]);
  });
});

describe("suggestWalletKind", () => {
  it("suggests exchange for known US brokers only", () => {
    expect(suggestWalletKind("Coinbase")).toBe("exchange");
    expect(suggestWalletKind("Kraken Pro")).toBe("exchange");
    expect(suggestWalletKind("Cash App")).toBe("exchange");
    expect(suggestWalletKind("Coldcard")).toBeUndefined();
    expect(suggestWalletKind("")).toBeUndefined();
  });
});

describe("BOX_INFO", () => {
  it("maps boxes to the Schedule D lines", () => {
    expect(["G", "H", "I", "J", "K", "L"].map((b) => BOX_INFO[b as keyof typeof BOX_INFO].scheduleDLine)).toEqual(["1b", "2", "3", "8b", "9", "10"]);
    expect(normalizeWalletKey(" Coinbase ")).toBe("coinbase");
  });
});
