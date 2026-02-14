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
