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
        const sale = processSale(trans, lots, method);
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
 */
export function simulateSale(
  amountBTC: number,
  pricePerBTC: number,
  currentLots: Lot[],
  method: AccountingMethod,
  lotSelections?: LotSelection[]
): SaleRecord | null {
  // Deep copy lots
  const lotsCopy: Lot[] = currentLots.map((lot) => ({
    ...lot,
    id: lot.id,
  }));

  const fakeSale: Transaction = {
    id: crypto.randomUUID(),
    date: new Date().toISOString(),
    transactionType: TransactionType.Sell,
    amountBTC,
    pricePerBTC,
    totalUSD: amountBTC * pricePerBTC,
    exchange: "Simulation",
    notes: "",
  };

  return processSale(fakeSale, lotsCopy, method, lotSelections);
}

/**
 * Process a sale against available lots.
 * MUTATES the lots array (reduces remainingBTC).
 * Optionally accepts lotSelections for Specific Identification method.
 */
function processSale(
  sale: Transaction,
  lots: Lot[],
  method: AccountingMethod,
  lotSelections?: LotSelection[]
): SaleRecord | null {
  const amountToSell = sale.amountBTC;
  if (amountToSell <= 0) return null;

  // Get indices of lots with remaining BTC
  const availableIndices = lots
    .map((lot, idx) => ({ lot, idx }))
    .filter(({ lot }) => lot.remainingBTC > 0)
    .map(({ idx }) => idx);

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
        isLongTerm: daysHeld > 365,
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
        isLongTerm: daysHeld > 365,
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
  const isLongTerm = avgHoldingDays > 365;

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
    method,
  };
}
