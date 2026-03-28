import { TransactionType, AccountingMethod, IncomeType } from "./types";

export interface Transaction {
  id: string;
  date: string; // ISO 8601 string
  transactionType: TransactionType;
  amountBTC: number;
  pricePerBTC: number;
  totalUSD: number;
  fee?: number; // Exchange fee in USD
  exchange: string;
  wallet?: string; // Wallet/account for per-wallet cost basis tracking
  sourceWallet?: string; // For TransferIn: which wallet/exchange the lots came from (user-assigned)
  transferLotSelections?: LotSelection[]; // For TransferIn: user-chosen lots to re-tag (Specific ID for transfers)
  incomeType?: IncomeType; // For mining, rewards — classified as ordinary income
  notes: string;
}

export interface Lot {
  id: string;
  purchaseDate: string;
  amountBTC: number;
  pricePerBTC: number;
  totalCost: number; // Includes fee (cost basis = amount*price + fee)
  fee?: number; // Exchange fee in USD
  remainingBTC: number;
  exchange: string;
  wallet?: string; // Wallet/account for per-wallet cost basis tracking
}

/** Lot selection for Specific Identification method */
export interface LotSelection {
  lotId: string;
  amountBTC: number;
}

export interface LotDetail {
  id: string;
  lotId?: string; // Source lot ID (= Buy transaction ID) for Specific ID matching across calculate() runs
  purchaseDate: string;
  amountBTC: number;
  costBasisPerBTC: number;
  totalCost: number;
  daysHeld: number;
  exchange: string;
  wallet?: string;
  isLongTerm: boolean;
}

export interface SaleRecord {
  id: string;
  saleDate: string;
  amountSold: number;
  salePricePerBTC: number;
  totalProceeds: number; // Net of sale fee (proceeds = amount*price - fee)
  costBasis: number;
  gainLoss: number;
  fee?: number; // Sale fee in USD
  lotDetails: LotDetail[];
  holdingPeriodDays: number;
  isLongTerm: boolean;
  isMixedTerm: boolean; // true when sale spans both short-term and long-term lots
  method: AccountingMethod;
  isDonation?: boolean; // true for charitable donations — excluded from Form 8949
  donationFmvPerBTC?: number; // Original FMV per BTC from the donation transaction
  donationFmvTotal?: number; // Original total FMV (amount × FMV) from the donation transaction
  sourceTransactionId?: string; // Links to originating Sell/Donation transaction for unique keying
  walletMismatch?: boolean; // true when sale used lots from a different wallet (global fallback)
}

export interface EngineWarning {
  message: string;
  /** ISO date of the transaction that generated this warning (for year-scoping). */
  txnDate?: string;
}

export interface CalculationResult {
  lots: Lot[];
  sales: SaleRecord[];
  warnings: EngineWarning[];
  /** Transaction IDs whose Specific ID elections were rejected at calc time (fell back to FIFO). */
  fallbackTxnIds: string[];
}

export interface ImportRecord {
  fileHash: string;
  fileName: string;
  importDate: string;
  transactionCount: number;
}

export interface ColumnMapping {
  date?: string;
  type?: string;
  amount?: string;
  price?: string;
  total?: string;
  fee?: string;
  wallet?: string;
  exchange?: string;
  notes?: string;
  asset?: string;
  receivedQuantity?: string;
  receivedCurrency?: string;
  sentQuantity?: string;
  sentCurrency?: string;
  defaultType?: TransactionType;
}

export interface Preferences {
  selectedYear: number;
  selectedMethod: AccountingMethod;
  appearanceMode?: string | null; // "light", "dark", or null (system)
  privacyBlur?: boolean;
  selectedWallet?: string | null; // null = all wallets
  livePriceEnabled?: boolean; // true = fetch from CoinGecko, false = fully offline
  priorCarryforward?: number; // LEGACY — single combined carryforward (migrated to ST on first load)
  priorCarryforwardST?: number; // Prior-year short-term capital loss carryforward (negative, USD)
  priorCarryforwardLT?: number; // Prior-year long-term capital loss carryforward (negative, USD)
  txnSortField?: string; // Transaction sort column (default: "date")
  txnSortAsc?: boolean; // Transaction sort direction (default: true = ascending)
}

export function createTransaction(params: Omit<Transaction, "id">): Transaction {
  return {
    id: crypto.randomUUID(),
    ...params,
    amountBTC: Math.abs(params.amountBTC),
    totalUSD: Math.abs(params.totalUSD),
  };
}

export function createLot(params: Omit<Lot, "id" | "remainingBTC"> & { id?: string; remainingBTC?: number }): Lot {
  return {
    id: params.id ?? crypto.randomUUID(),
    ...params,
    remainingBTC: params.remainingBTC ?? params.amountBTC,
  };
}

export function isDualColumn(mapping: ColumnMapping): boolean {
  return !!(
    mapping.receivedQuantity &&
    mapping.receivedCurrency &&
    mapping.sentQuantity &&
    mapping.sentCurrency
  );
}

export function requiredFieldsMissing(mapping: ColumnMapping): string[] {
  const missing: string[] = [];
  if (!mapping.date) missing.push("date");
  if (!isDualColumn(mapping)) {
    if (!mapping.amount) missing.push("amount");
    if (!mapping.price && !mapping.total) missing.push("price or total");
  }
  return missing;
}

export function isMappingValid(mapping: ColumnMapping): boolean {
  return requiredFieldsMissing(mapping).length === 0;
}

export function warningFieldsMissing(mapping: ColumnMapping): string[] {
  const warnings: string[] = [];
  if (!isDualColumn(mapping) && !mapping.price && !mapping.total) {
    warnings.push("price or total");
  }
  return warnings;
}
