// Accounting methods for cost basis calculation
export enum AccountingMethod {
  FIFO = "FIFO",
  LIFO = "LIFO",
  HIFO = "HIFO",
  SpecificID = "SpecificID",
}

export const AccountingMethodDisplayNames: Record<AccountingMethod, string> = {
  [AccountingMethod.FIFO]: "First In, First Out",
  [AccountingMethod.LIFO]: "Last In, First Out",
  [AccountingMethod.HIFO]: "Highest In, First Out",
  [AccountingMethod.SpecificID]: "Specific Identification",
};

// Transaction types
export enum TransactionType {
  Buy = "buy",
  Sell = "sell",
  TransferIn = "transfer_in",
  TransferOut = "transfer_out",
}

export const TransactionTypeDisplayNames: Record<TransactionType, string> = {
  [TransactionType.Buy]: "Buy",
  [TransactionType.Sell]: "Sell",
  [TransactionType.TransferIn]: "Transfer In",
  [TransactionType.TransferOut]: "Transfer Out",
};

// Income types for Schedule 1 classification
export enum IncomeType {
  Mining = "mining",
  Fork = "fork",
  Reward = "reward",
  Interest = "interest",
}

export const IncomeTypeDisplayNames: Record<IncomeType, string> = {
  [IncomeType.Mining]: "Mining",
  [IncomeType.Fork]: "Hard Fork",
  [IncomeType.Reward]: "Reward",
  [IncomeType.Interest]: "Interest",
};

/**
 * Parse an income type from transaction type string.
 * Returns null if the transaction is not income (i.e., a normal buy/sell/transfer).
 */
export function parseIncomeType(input: string): IncomeType | null {
  const lower = input.toLowerCase().trim();

  // Exact matches
  switch (lower) {
    case "mining":
      return IncomeType.Mining;
    case "fork":
      return IncomeType.Fork;
    case "reward":
    case "rewards income":
    case "reward income":
    case "learning reward":
    case "coinbase earn":
    case "earn":
      return IncomeType.Reward;
    case "interest":
    case "interest payout":
      return IncomeType.Interest;
  }

  // Substring fallbacks
  if (lower.includes("mining") || lower.includes("mined")) return IncomeType.Mining;
  if (lower.includes("fork")) return IncomeType.Fork;
  if (lower.includes("interest")) return IncomeType.Interest;
  if (lower.includes("reward") || lower.includes("earn")) return IncomeType.Reward;

  return null;
}

/**
 * Parse a transaction type string from CSV data.
 * Supports exact matches and substring fallbacks for maximum compatibility.
 */
export function parseTransactionType(input: string): TransactionType | null {
  const lower = input.toLowerCase().trim();

  // Exact matches first
  switch (lower) {
    // Buy-like
    case "buy":
    case "purchase":
    case "bought":
    case "advanced trade buy":
    case "advance trade buy":
    case "market buy":
    case "limit buy":
    case "bitcoin purchase":
    case "bitcoin boost":
    case "reward":
    case "rewards income":
    case "reward income":
    case "interest":
    case "interest payout":
    case "learning reward":
    case "coinbase earn":
    case "earn":
    case "fork":
    case "mining":
      return TransactionType.Buy;

    // Sell-like
    case "sell":
    case "sold":
    case "advanced trade sell":
    case "advance trade sell":
    case "market sell":
    case "limit sell":
    case "bitcoin sale":
    case "convert":
    case "card spend":
      return TransactionType.Sell;

    // Transfer in
    case "receive":
    case "received":
    case "incoming":
    case "deposit":
    case "transfer in":
    case "credit":
    case "pro deposit":
    case "prime deposit":
    case "asset migration":
      return TransactionType.TransferIn;

    // Transfer out
    case "send":
    case "sent":
    case "outgoing":
    case "withdrawal":
    case "transfer out":
    case "bitcoin withdrawal":
    case "debit":
    case "pro withdrawal":
    case "prime withdrawal":
      return TransactionType.TransferOut;
  }

  // Substring fallbacks
  if (lower.includes("buy") || lower.includes("purchase")) return TransactionType.Buy;
  if (lower.includes("sell") || lower.includes("sale") || lower.includes("spend")) return TransactionType.Sell;
  if (lower.includes("reward") || lower.includes("income") || lower.includes("earn")) return TransactionType.Buy;
  if (lower.includes("withdrawal") || lower.includes("withdraw")) return TransactionType.TransferOut;
  if (lower.includes("deposit") || lower.includes("receive") || lower.includes("migration")) return TransactionType.TransferIn;

  return null;
}
