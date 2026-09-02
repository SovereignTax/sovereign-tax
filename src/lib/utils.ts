import { TransactionType } from "./types";

/** Format a number as USD currency */
export function formatUSD(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

/** Format BTC with 8 decimal places */
export function formatBTC(value: number): string {
  return value.toFixed(8);
}

/** Format a date from ISO string */
export function formatDate(isoDate: string): string {
  return new Date(isoDate).toLocaleDateString("en-US", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
}

/** Format a date with time */
export function formatDateTime(isoDate: string): string {
  return new Date(isoDate).toLocaleString("en-US", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Format USD without currency symbol for CSV */
export function formatCSVDecimal(value: number): string {
  return value.toFixed(2);
}

/** Relative time string */
export function timeAgo(date: Date): string {
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

/** Find existing transactions that look similar (same type, same day, similar amount).
 *  Used to warn users about potential duplicates before adding. */
export function findSimilarTransactions<T extends { date: string; transactionType: string; amountBTC: number; exchange: string }>(
  existing: T[],
  type: string,
  date: string,
  amountBTC: number
): T[] {
  const targetDay = new Date(date).toDateString();
  return existing.filter((t) => {
    if (t.transactionType !== type) return false;
    if (new Date(t.date).toDateString() !== targetDay) return false;
    // Within 5% of the amount, or exact match at 0
    if (amountBTC === 0 && t.amountBTC === 0) return true;
    const ratio = Math.abs(t.amountBTC - amountBTC) / Math.max(t.amountBTC, amountBTC);
    return ratio < 0.05;
  });
}

/** Natural key for transaction deduplication */
export function transactionNaturalKey(t: { date: string; transactionType: string; amountBTC: number; exchange: string; wallet?: string }): string {
  const d = new Date(t.date);
  const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  const amount = t.amountBTC.toFixed(8);
  const walletKey = t.wallet ? `|${t.wallet.toLowerCase()}` : "";
  return `${dateStr}|${t.transactionType}|${amount}|${t.exchange.toLowerCase()}${walletKey}`;
}

/** Wallet-agnostic key for cross-exchange duplicate detection.
 *  Matches on date + type + amount only — catches re-imports under a different exchange name. */
export function transactionLooseKey(t: { date: string; transactionType: string; amountBTC: number }): string {
  const d = new Date(t.date);
  const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  const amount = t.amountBTC.toFixed(8);
  return `${dateStr}|${t.transactionType}|${amount}`;
}

/** Detect whether a SaleRecord's lot selections include lots from a different wallet
 *  than the sale's wallet. Used to initialize the "Show lots from all wallets" toggle
 *  so cross-wallet Specific ID elections are visible when reopening the editor. */
export function hasCrossWalletLots(
  lotDetails: { wallet?: string; exchange?: string }[],
  saleWallet: string
): boolean {
  const norm = saleWallet.trim().toLowerCase();
  if (!norm) return false;
  return lotDetails.some((d) => {
    const lotWallet = (d.wallet || d.exchange || "").trim().toLowerCase();
    return lotWallet !== "" && lotWallet !== norm;
  });
}

/** Partition incoming transactions into loose-key matches and non-matches.
 *  Returns the count of potential cross-exchange duplicates and the filtered non-matching list. */
export function partitionLooseDuplicates<T extends { date: string; transactionType: string; amountBTC: number }>(
  existing: { date: string; transactionType: string; amountBTC: number }[],
  incoming: T[]
): { matchCount: number; nonMatching: T[] } {
  const existingKeys = new Set(existing.map(transactionLooseKey));
  const nonMatching: T[] = [];
  let matchCount = 0;
  for (const t of incoming) {
    if (existingKeys.has(transactionLooseKey(t))) {
      matchCount++;
    } else {
      nonMatching.push(t);
    }
  }
  return { matchCount, nonMatching };
}

/** Detect the "I entered the gross total" mistake before it is saved.
 *
 *  The Total USD field means the amount BEFORE fees — the app applies the fee itself
 *  (added to cost basis on buys, subtracted from proceeds on sells). A user who types
 *  what they actually paid or received has the fee in there already, so saving applies
 *  it a second time: a $87.01 buy with a $2.99 fee entered as $90.00 stores $92.99 and
 *  reports an inflated cost basis per BTC.
 *
 *  The giveaway is Total ≈ (Amount × Price) ± Fee. Returns the corrected pre-fee total
 *  when that pattern is present, else null. Compared in whole cents with a 1c tolerance
 *  so ordinary rounding in the user's typed price does not suppress the warning.
 *  Advisory only — never auto-corrects. */
export function detectFeeDoubleCount(params: {
  transactionType: TransactionType;
  amountBTC: number;
  pricePerBTC: number;
  totalUSD: number;
  fee: number;
}): { suggestedTotal: number } | null {
  const { transactionType, amountBTC, pricePerBTC, totalUSD, fee } = params;
  const isBuy = transactionType === TransactionType.Buy;
  const isSell = transactionType === TransactionType.Sell;
  if (!isBuy && !isSell) return null; // transfers/donations do not fee-adjust the total
  if (!(amountBTC > 0 && pricePerBTC > 0 && totalUSD > 0 && fee > 0)) return null;
  if (!Number.isFinite(amountBTC) || !Number.isFinite(pricePerBTC)) return null;
  if (!Number.isFinite(totalUSD) || !Number.isFinite(fee)) return null;

  const cents = (n: number) => Math.round(n * 100);
  const net = amountBTC * pricePerBTC;          // what the Total field should hold
  const gross = isBuy ? net + fee : net - fee;  // what it looks like they typed

  // Must match the gross figure...
  if (Math.abs(cents(totalUSD) - cents(gross)) > 1) return null;
  // ...and be meaningfully different from the correct one (guards a fee that rounds to 0c).
  if (Math.abs(cents(totalUSD) - cents(net)) < 1) return null;

  return { suggestedTotal: net };
}

/** Homepage — the safe fallback for any update URL we don't recognize. */
export const HOMEPAGE_URL = "https://sovereigntax.io";

/** Origins the in-app update prompt is allowed to open.
 *  The download URL comes from a REMOTE version.json (fetched from GitHub raw).
 *  If that file — or the repo hosting it — were ever compromised, an unvalidated
 *  URL would send users who trust the update prompt to an attacker-controlled
 *  download. Only our own release hosts are accepted. */
export const ALLOWED_DOWNLOAD_ORIGINS = [
  "https://sovereigntax.io",
  "https://www.sovereigntax.io",
  "https://github.com",
  "https://objects.githubusercontent.com",
];

/** Return `raw` only if it is an https URL on an allowlisted origin, else the homepage.
 *  Compares the parsed ORIGIN — a startsWith/substring check would wrongly accept
 *  "https://sovereigntax.io.evil.com" and "https://evil.com/?x=sovereigntax.io". */
export function safeDownloadUrl(raw: unknown): string {
  if (typeof raw !== "string" || !raw) return HOMEPAGE_URL;
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return HOMEPAGE_URL; // relative or malformed
  }
  if (parsed.protocol !== "https:") return HOMEPAGE_URL;
  return ALLOWED_DOWNLOAD_ORIGINS.includes(parsed.origin) ? parsed.href : HOMEPAGE_URL;
}

/** Maximum carryforward value accepted in Settings ($100M).
 *  Realistic prior-year capital loss carryforwards never approach this.
 *  Cap prevents NaN/Infinity/scientific-notation inputs from polluting state. */
export const CARRYFORWARD_MAX = 100_000_000;

/** Sanitize a Settings carryforward input string into a stored loss value
 *  (negative number per existing convention).
 *  - Empty/null input → 0
 *  - NaN, ±Infinity → 0 (invalid input rejected silently rather than poisoning state)
 *  - Scientific notation that overflows → clamped to CARRYFORWARD_MAX
 *  - Otherwise: returns -Math.abs(value), clamped at CARRYFORWARD_MAX
 *  See BUG-FIX-PLAN.md B6. */
export function sanitizeCarryforward(raw: string): number {
  if (raw === "" || raw == null) return 0;
  const n = Number(raw);
  if (!Number.isFinite(n)) return 0; // catches NaN and ±Infinity
  const clamped = Math.min(Math.abs(n), CARRYFORWARD_MAX);
  return -clamped;
}
