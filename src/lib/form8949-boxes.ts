import { LotDetail, SaleRecord, WalletReporting } from "./models";

/**
 * Form 8949 digital-asset boxes (2025+ form; boxes C/F are no longer used for digital assets).
 * Each Part I / Part II copy checks exactly one box, so exports group rows by box.
 *
 *   G / J — Form 1099-DA received, basis reported to the IRS
 *   H / K — Form 1099-DA received, basis NOT reported
 *   I / L — no Form 1099-DA (self-custody, P2P, non-reporting platform)
 */
export type Box8949 = "G" | "H" | "I" | "J" | "K" | "L";

export const DIGITAL_ASSET_BOXES_FIRST_YEAR = 2025;

/** Broker basis reporting is mandatory for units acquired on/after this date (local) and kept in the same account. */
const COVERED_START = new Date(2026, 0, 1);

export interface BoxInfo {
  box: Box8949;
  part: "I" | "II";
  isLongTerm: boolean;
  scheduleDLine: string;
  label: string;
}

export const BOX_INFO: Record<Box8949, BoxInfo> = {
  G: { box: "G", part: "I", isLongTerm: false, scheduleDLine: "1b", label: "Short-term — reported on Form 1099-DA, basis reported to the IRS" },
  H: { box: "H", part: "I", isLongTerm: false, scheduleDLine: "2", label: "Short-term — reported on Form 1099-DA, basis NOT reported to the IRS" },
  I: { box: "I", part: "I", isLongTerm: false, scheduleDLine: "3", label: "Short-term — not reported on Form 1099-DA" },
  J: { box: "J", part: "II", isLongTerm: true, scheduleDLine: "8b", label: "Long-term — reported on Form 1099-DA, basis reported to the IRS" },
  K: { box: "K", part: "II", isLongTerm: true, scheduleDLine: "9", label: "Long-term — reported on Form 1099-DA, basis NOT reported to the IRS" },
  L: { box: "L", part: "II", isLongTerm: true, scheduleDLine: "10", label: "Long-term — not reported on Form 1099-DA" },
};

export const BOX_ORDER: Box8949[] = ["G", "H", "I", "J", "K", "L"];

/** Note printed on box G/J sections — we don't know the broker-reported basis. */
export const BASIS_REPORTED_NOTE =
  "Compare with your Form 1099-DA. Column (e) must show the basis your exchange reported; if it differs from the basis shown here, enter the exchange's figure in (e) and the difference in (g) with code B.";

/** Same normalization the engine uses for wallet matching. */
export function normalizeWalletKey(wallet: string | undefined | null): string {
  return (wallet || "").trim().toLowerCase();
}

export function getWalletReporting(
  reporting: Record<string, WalletReporting> | undefined,
  wallet: string | undefined | null
): WalletReporting | undefined {
  const key = normalizeWalletKey(wallet);
  return key ? reporting?.[key] : undefined;
}

function saleWalletOf(sale: SaleRecord, detail?: LotDetail): string {
  return sale.wallet || detail?.wallet || detail?.exchange || "";
}

/**
 * A unit is "covered" (broker must report basis) when it was acquired on/after 2026-01-01
 * in the same account it was sold from and never left that account.
 */
export function isCoveredLot(detail: LotDetail, saleWallet: string): boolean {
  if (detail.transferred) return false;
  if (normalizeWalletKey(detail.wallet || detail.exchange) !== normalizeWalletKey(saleWallet)) return false;
  return new Date(detail.purchaseDate) >= COVERED_START;
}

/**
 * Assign the Form 8949 box for one lot of a disposition.
 * Unclassified wallets are treated as not reported on a 1099-DA (I/L) — the Review
 * checklist and export warnings ask the user to classify them.
 */
export function assignBox(
  detail: LotDetail,
  sale: SaleRecord,
  reporting: Record<string, WalletReporting> | undefined
): Box8949 {
  const saleWallet = saleWalletOf(sale, detail);
  const setting = getWalletReporting(reporting, saleWallet);
  const lt = detail.isLongTerm;
  if (setting?.kind !== "exchange") return lt ? "L" : "I";
  const basis = setting.basisReported ?? "covered";
  const basisReported = basis === "all" || (basis === "covered" && isCoveredLot(detail, saleWallet));
  if (basisReported) return lt ? "J" : "G";
  return lt ? "K" : "H";
}

export interface BoxRow {
  sale: SaleRecord;
  detail: LotDetail;
}

/** Group every lot detail of the (non-donation) sales by box, in G–L order. Empty boxes omitted. */
export function groupByBox(
  sales: SaleRecord[],
  reporting: Record<string, WalletReporting> | undefined
): { box: Box8949; rows: BoxRow[] }[] {
  const groups = new Map<Box8949, BoxRow[]>();
  for (const sale of sales) {
    if (sale.isDonation) continue;
    for (const detail of sale.lotDetails) {
      const box = assignBox(detail, sale, reporting);
      if (!groups.has(box)) groups.set(box, []);
      groups.get(box)!.push({ sale, detail });
    }
  }
  return BOX_ORDER.filter((b) => groups.has(b)).map((box) => ({ box, rows: groups.get(box)! }));
}

/**
 * Distinct wallets (display names) that have taxable sales and no classification yet.
 * Donations are excluded — they aren't reported on Form 8949.
 */
export function getUnclassifiedSaleWallets(
  sales: SaleRecord[],
  reporting: Record<string, WalletReporting> | undefined
): string[] {
  const seen = new Map<string, string>();
  for (const sale of sales) {
    if (sale.isDonation) continue;
    const wallet = saleWalletOf(sale, sale.lotDetails[0]);
    const key = normalizeWalletKey(wallet);
    if (key && !reporting?.[key] && !seen.has(key)) seen.set(key, wallet.trim());
  }
  return [...seen.values()].sort((a, b) => a.localeCompare(b));
}

/** US exchanges and brokers that issue Form 1099-DA. Used only to SUGGEST a classification — the user confirms. */
const KNOWN_EXCHANGES = [
  "coinbase", "kraken", "gemini", "river", "strike", "swan", "cash app", "cashapp",
  "robinhood", "binance.us", "binance us", "bitstamp", "crypto.com", "paypal", "venmo",
  "fidelity", "schwab", "uphold", "okcoin", "itrust", "bitwise",
];

export function suggestWalletKind(wallet: string): WalletReporting["kind"] | undefined {
  const key = normalizeWalletKey(wallet);
  if (!key) return undefined;
  return KNOWN_EXCHANGES.some((name) => key.includes(name)) ? "exchange" : undefined;
}
