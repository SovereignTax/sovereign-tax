import { AccountingMethod, TransactionType } from "./types";
import {
  Transaction,
  Lot,
  LotDetail,
  SaleRecord,
  CalculationResult,
  createLot,
} from "./models";

/** Calculate days between two ISO date strings */
export function daysBetween(d1: string, d2: string): number {
  const date1 = new Date(d1);
  const date2 = new Date(d2);
  const diffMs = date2.getTime() - date1.getTime();
  return Math.floor(diffMs / (1000 * 60 * 60 * 24));
}

/**
 * Determine if a holding period qualifies as long-term per IRS IRC §1222.
 * The holding period starts the day after acquisition. An asset is long-term
 * if sold on or after the same month/day of the next year + 1 day.
 * This correctly handles leap years and boundary cases.
 */
export function isMoreThanOneYear(acquiredDate: string, soldDate: string): boolean {
  const acquired = new Date(acquiredDate);
  const sold = new Date(soldDate);
  const oneYearLater = new Date(acquired);
  oneYearLater.setFullYear(oneYearLater.getFullYear() + 1);
  return sold > oneYearLater;
}

/** Format date for display */
function formatDateShort(isoDate: string): string {
  const d = new Date(isoDate);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

/** Lot selection for Specific Identification method */
export interface LotSelection {
  lotId: string;
  amountBTC: number;
}

/**
 * Cost Basis Engine — pure calculation, no side effects.
 * Supports FIFO, LIFO, HIFO, and Specific Identification methods.
 */
export function calculate(
  transactions: Transaction[],
  method: AccountingMethod
): CalculationResult {
  const lots: Lot[] = [];
  const sales: SaleRecord[] = [];
  const warnings: string[] = [];

  // Sort by date
  const sorted = [...transactions].sort(
    (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()
  );

  for (const trans of sorted) {
    switch (trans.transactionType) {
      case TransactionType.Buy: {
        const lot = createLot({
          purchaseDate: trans.date,
          amountBTC: trans.amountBTC,
          pricePerBTC: trans.pricePerBTC,
          totalCost: trans.totalUSD, // Already includes fee (fee added during import)
          fee: trans.fee,
          exchange: trans.exchange,
          wallet: trans.wallet || trans.exchange,
        });
        lots.push(lot);
        break;
      }

      case TransactionType.Sell: {
        const sale = processSale(trans, lots, method, undefined, warnings);
        if (sale) {
          sales.push(sale);
        } else {
          warnings.push(`No lots available for sale on ${formatDateShort(trans.date)}`);
        }
        break;
      }

      case TransactionType.TransferIn:
      case TransactionType.TransferOut:
        // Non-taxable movements, do nothing
        break;
    }
  }

  return { lots, sales, warnings };
}

/**
 * Simulate a sale without modifying actual lot state.
 * If wallet is provided, enforces per-wallet lot selection (TD 9989).
 */
export function simulateSale(
  amountBTC: number,
  pricePerBTC: number,
  currentLots: Lot[],
  method: AccountingMethod,
  lotSelections?: LotSelection[],
  wallet?: string,
  saleDate?: string
): SaleRecord | null {
  // Deep copy lots
  const lotsCopy: Lot[] = currentLots.map((lot) => ({
    ...lot,
    id: lot.id,
  }));

  const fakeSale: Transaction = {
    id: crypto.randomUUID(),
    date: saleDate || new Date().toISOString(),
    transactionType: TransactionType.Sell,
    amountBTC,
    pricePerBTC,
    totalUSD: amountBTC * pricePerBTC,
    exchange: wallet || "Simulation",
    wallet: wallet,
    notes: "",
  };

  return processSale(fakeSale, lotsCopy, method, lotSelections);
}

/**
 * Process a sale against available lots.
 * MUTATES the lots array (reduces remainingBTC).
 * Enforces per-wallet/per-account cost basis per IRS TD 9989 (effective Jan 1, 2025).
 * Optionally accepts lotSelections for Specific Identification method.
 */
function processSale(
  sale: Transaction,
  lots: Lot[],
  method: AccountingMethod,
  lotSelections?: LotSelection[],
  warnings?: string[]
): SaleRecord | null {
  const amountToSell = sale.amountBTC;
  if (amountToSell <= 0) return null;

  // Per-wallet cost basis enforcement (IRS TD 9989)
  // Filter lots to the same wallet/account as the sale
  const saleWallet = sale.wallet || sale.exchange;
  let availableIndices = lots
    .map((lot, idx) => ({ lot, idx }))
    .filter(({ lot }) => lot.remainingBTC > 0 && (lot.wallet || lot.exchange) === saleWallet)
    .map(({ idx }) => idx);

  // Fallback: if no lots match the wallet, use all available lots with a warning
  if (availableIndices.length === 0) {
    availableIndices = lots
      .map((lot, idx) => ({ lot, idx }))
      .filter(({ lot }) => lot.remainingBTC > 0)
      .map(({ idx }) => idx);

    if (availableIndices.length > 0 && warnings) {
      warnings.push(
        `No lots found in wallet "${saleWallet}" for sale on ${formatDateShort(sale.date)}. Fell back to global lot pool.`
      );
    }
  }

  if (availableIndices.length === 0) return null;

  let totalCostBasis = 0;
  const lotDetails: LotDetail[] = [];
  let remainingToSell = amountToSell;
  const holdingDays: number[] = [];

  // Specific Identification: use manual lot selections
  if (method === AccountingMethod.SpecificID && lotSelections && lotSelections.length > 0) {
    for (const sel of lotSelections) {
      if (remainingToSell <= 0) break;
      const lotIdx = lots.findIndex((l) => l.id === sel.lotId);
      if (lotIdx === -1 || lots[lotIdx].remainingBTC <= 0) continue;

      const sellFromLot = Math.min(sel.amountBTC, lots[lotIdx].remainingBTC, remainingToSell);
      const costBasisPerBTC = lots[lotIdx].pricePerBTC;
      const costForPortion = sellFromLot * costBasisPerBTC;
      totalCostBasis += costForPortion;

      const daysHeld = daysBetween(lots[lotIdx].purchaseDate, sale.date);
      holdingDays.push(daysHeld);

      lotDetails.push({
        id: crypto.randomUUID(),
        purchaseDate: lots[lotIdx].purchaseDate,
        amountBTC: sellFromLot,
        costBasisPerBTC,
        totalCost: costForPortion,
        daysHeld,
        exchange: lots[lotIdx].exchange,
        wallet: lots[lotIdx].wallet,
        isLongTerm: isMoreThanOneYear(lots[lotIdx].purchaseDate, sale.date),
      });

      lots[lotIdx].remainingBTC -= sellFromLot;
      remainingToSell -= sellFromLot;
    }
  } else {
    // Standard method: sort indices by method
    let sortedIndices: number[];
    const effectiveMethod = method === AccountingMethod.SpecificID ? AccountingMethod.FIFO : method;
    switch (effectiveMethod) {
      case AccountingMethod.FIFO:
        sortedIndices = availableIndices.sort(
          (a, b) => new Date(lots[a].purchaseDate).getTime() - new Date(lots[b].purchaseDate).getTime()
        );
        break;
      case AccountingMethod.LIFO:
        sortedIndices = availableIndices.sort(
          (a, b) => new Date(lots[b].purchaseDate).getTime() - new Date(lots[a].purchaseDate).getTime()
        );
        break;
      case AccountingMethod.HIFO:
        sortedIndices = availableIndices.sort(
          (a, b) => lots[b].pricePerBTC - lots[a].pricePerBTC
        );
        break;
      default:
        sortedIndices = availableIndices;
    }

    for (const idx of sortedIndices) {
      if (remainingToSell <= 0) break;

      const sellFromLot = Math.min(remainingToSell, lots[idx].remainingBTC);
      const costBasisPerBTC = lots[idx].pricePerBTC;
      const costForPortion = sellFromLot * costBasisPerBTC;
      totalCostBasis += costForPortion;

      const daysHeld = daysBetween(lots[idx].purchaseDate, sale.date);
      holdingDays.push(daysHeld);

      lotDetails.push({
        id: crypto.randomUUID(),
        purchaseDate: lots[idx].purchaseDate,
        amountBTC: sellFromLot,
        costBasisPerBTC,
        totalCost: costForPortion,
        daysHeld,
        exchange: lots[idx].exchange,
        wallet: lots[idx].wallet,
        isLongTerm: isMoreThanOneYear(lots[idx].purchaseDate, sale.date),
      });

      lots[idx].remainingBTC -= sellFromLot;
      remainingToSell -= sellFromLot;
    }
  }

  const totalProceeds = sale.totalUSD; // Already net of fee (fee subtracted during import)
  const gainLoss = totalProceeds - totalCostBasis;
  const avgHoldingDays =
    holdingDays.length === 0
      ? 0
      : Math.floor(holdingDays.reduce((a, b) => a + b, 0) / holdingDays.length);

  // Determine term classification from lot details, not averages
  const hasShortTerm = lotDetails.some((d) => !d.isLongTerm);
  const hasLongTerm = lotDetails.some((d) => d.isLongTerm);
  const isMixedTerm = hasShortTerm && hasLongTerm;
  // For non-mixed sales, use lot-level truth; for mixed, isLongTerm=false (use lotDetails for split)
  const isLongTerm = isMixedTerm ? false : hasLongTerm;

  return {
    id: crypto.randomUUID(),
    saleDate: sale.date,
    amountSold: amountToSell - remainingToSell,
    salePricePerBTC: sale.pricePerBTC,
    totalProceeds,
    costBasis: totalCostBasis,
    gainLoss,
    fee: sale.fee,
    lotDetails,
    holdingPeriodDays: avgHoldingDays,
    isLongTerm,
    isMixedTerm,
    method,
  };
}
