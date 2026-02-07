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
  incomeType?: IncomeType; // For mining, staking, airdrops — classified as ordinary income
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

export interface LotDetail {
  id: string;
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
  method: AccountingMethod;
}

export interface CalculationResult {
  lots: Lot[];
  sales: SaleRecord[];
  warnings: string[];
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
}

export function createTransaction(params: Omit<Transaction, "id">): Transaction {
  return {
    id: crypto.randomUUID(),
    ...params,
    amountBTC: Math.abs(params.amountBTC),
    totalUSD: Math.abs(params.totalUSD),
  };
}

export function createLot(params: Omit<Lot, "id" | "remainingBTC"> & { remainingBTC?: number }): Lot {
  return {
    id: crypto.randomUUID(),
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
  }
  return missing;
}

export function isMappingValid(mapping: ColumnMapping): boolean {
  return requiredFieldsMissing(mapping).length === 0;
}
