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
 * Shared resolver: maps each disposition transaction to its recorded Specific ID SaleRecord.
 * Returns Map<transactionId, SaleRecord> with deterministic one-to-one matching.
 *
 * Primary path: match by sourceTransactionId (collision-proof, v1.3.0+).
 * Legacy fallback: match by date|amount|type key with shift() consumption (pre-v1.3.0 records).
 * Transactions are consumed chronologically to match the engine's processing order.
 *
 * Used by: calculate(), calculateUpTo(), TransactionsView (UI), deleteTransaction (cascade).
 */
export function resolveRecordedSales(
  transactions: Transaction[],
  recordedSales: SaleRecord[]
): Map<string, SaleRecord> {
  const result = new Map<string, SaleRecord>();

  // 1. Index new-style records by sourceTransactionId (collision-proof primary path)
  for (const rs of recordedSales) {
    if (rs.sourceTransactionId && rs.method === AccountingMethod.SpecificID) {
      result.set(rs.sourceTransactionId, rs);
    }
  }

  // 2. Index legacy records by date|amount|type into arrays for one-to-one consumption
  const legacyByKey = new Map<string, SaleRecord[]>();
  for (const rs of recordedSales) {
    if (rs.method === AccountingMethod.SpecificID && !rs.sourceTransactionId) {
      const typeTag = rs.isDonation ? "donation" : "sale";
      const key = `${rs.saleDate}|${rs.amountSold.toFixed(8)}|${typeTag}`;
      const arr = legacyByKey.get(key) || [];
      arr.push(rs);
      legacyByKey.set(key, arr);
    }
  }

  // 3. Sort transactions chronologically (matches engine processing order)
  const sorted = [...transactions].sort(
    (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()
  );

  // 4. For each disposition not already matched, consume one legacy record via shift()
  for (const txn of sorted) {
    if (result.has(txn.id)) continue; // Already matched by sourceTransactionId
    if (txn.transactionType !== TransactionType.Sell && txn.transactionType !== TransactionType.Donation) continue;
    const typeTag = txn.transactionType === TransactionType.Donation ? "donation" : "sale";
    const key = `${txn.date}|${txn.amountBTC.toFixed(8)}|${typeTag}`;
    const arr = legacyByKey.get(key);
    if (arr && arr.length > 0) {
      result.set(txn.id, arr.shift()!);
    }
  }

  return result;
}

/**
 * Cost Basis Engine — pure calculation, no side effects.
 * Supports FIFO and Specific Identification methods (the only two IRS-permitted methods).
 *
 * Lot IDs are deterministic (derived from source transaction ID) so that
 * Specific ID lot selections in recordedSales can reliably match lots
 * across multiple calculate() calls.
 *
 * recordedSales: optional pre-recorded SaleRecords from Specific ID elections.
 * When a Sell or Donation matches a recorded Specific ID SaleRecord,
 * the engine uses the recorded lot selections instead of auto-selecting.
 * This ensures Specific ID elections are permanent and consistent across all views.
 */
export function calculate(
  transactions: Transaction[],
  method: AccountingMethod,
  recordedSales?: SaleRecord[]
): CalculationResult {
  const lots: Lot[] = [];
  const sales: SaleRecord[] = [];
  const warnings: string[] = [];

  // Resolve which transactions have recorded Specific ID elections
  const resolved = recordedSales ? resolveRecordedSales(transactions, recordedSales) : new Map<string, SaleRecord>();

  // Sort by date
  const sorted = [...transactions].sort(
    (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()
  );

  for (const trans of sorted) {
    switch (trans.transactionType) {
      case TransactionType.Buy: {
        // Deterministic lot ID from transaction ID — stable across calculate() calls
        const lot = createLot({
          id: trans.id,
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
        const recorded = resolved.get(trans.id);
        let lotSelections = recorded ? extractLotSelections(recorded, lots) : undefined;
        let effectiveMethod = recorded ? AccountingMethod.SpecificID : method;

        // If recorded but lot matching failed (partial or total), fall back to current method with warning.
        // This triggers when a Buy referenced by the election was edited or deleted.
        if (recorded && lotSelections === null) {
          warnings.push(
            `Specific ID election for sale on ${formatDateShort(trans.date)} could not be applied — one or more selected lots no longer exist or were modified. ` +
            `Using ${method} as fallback. To fix: open this sale in the Transactions view and re-assign lots using the Edit Lots button.`
          );
          lotSelections = undefined;
          effectiveMethod = method;
        }

        const sale = processSale(trans, lots, effectiveMethod, lotSelections ?? undefined, warnings);
        if (sale) {
          sales.push(sale);
        } else {
          warnings.push(`No lots available for sale on ${formatDateShort(trans.date)}`);
        }
        break;
      }

      case TransactionType.Donation: {
        const recorded = resolved.get(trans.id);
        let lotSelections = recorded ? extractLotSelections(recorded, lots) : undefined;
        let effectiveMethod = recorded ? AccountingMethod.SpecificID : method;

        // If recorded but lot matching failed (partial or total), fall back to current method with warning.
        // This triggers when a Buy referenced by the election was edited or deleted.
        if (recorded && lotSelections === null) {
          warnings.push(
            `Specific ID election for donation on ${formatDateShort(trans.date)} could not be applied — one or more selected lots no longer exist or were modified. ` +
            `Using ${method} as fallback. To fix: open this donation in the Transactions view and re-assign lots using the Edit Lots button.`
          );
          lotSelections = undefined;
          effectiveMethod = method;
        }

        // Pass real transaction — processSale handles zero proceeds/gainLoss natively for donations
        const donationResult = processSale(trans, lots, effectiveMethod, lotSelections ?? undefined, warnings, "donation", trans.pricePerBTC);
        if (donationResult) {
          sales.push(donationResult);
        } else {
          warnings.push(`No lots available for donation on ${formatDateShort(trans.date)}`);
        }
        break;
      }

      case TransactionType.TransferIn: {
        // Non-taxable self-transfer (IRS FAQ 81). If the user assigned a sourceWallet,
        // FIFO-consume lots from that wallet and re-tag them to the TransferIn's wallet.
        // Cost basis and holding period carry over — no taxable event.
        if (trans.sourceWallet) {
          const destWallet = trans.wallet || trans.exchange;
          const sourceNorm = trans.sourceWallet.trim().toLowerCase();
          let remaining = trans.amountBTC;

          // FIFO order: oldest lots from the source wallet first
          const sourceIndices = lots
            .map((lot, idx) => ({ lot, idx }))
            .filter(({ lot }) =>
              lot.remainingBTC > 0 &&
              (lot.wallet || lot.exchange || "").trim().toLowerCase() === sourceNorm
            )
            .sort((a, b) => new Date(a.lot.purchaseDate).getTime() - new Date(b.lot.purchaseDate).getTime())
            .map(({ idx }) => idx);

          for (const idx of sourceIndices) {
            if (remaining <= 0.00000001) break;
            const take = Math.min(lots[idx].remainingBTC, remaining);

            if (Math.abs(take - lots[idx].remainingBTC) < 1e-8) {
              // Re-tag entire lot in place (avoids splitting)
              lots[idx].wallet = destWallet;
            } else {
              // Split: reduce original lot, create new re-tagged lot with the taken portion
              lots[idx].remainingBTC -= take;
              if (lots[idx].remainingBTC > 0 && lots[idx].remainingBTC < 1e-8) {
                lots[idx].remainingBTC = 0;
              }
              const retagged = createLot({
                id: lots[idx].id + "-xfer-" + trans.id.slice(0, 8),
                purchaseDate: lots[idx].purchaseDate,
                amountBTC: take,
                pricePerBTC: lots[idx].pricePerBTC,
                totalCost: (lots[idx].totalCost / lots[idx].amountBTC) * take,
                fee: lots[idx].fee ? (lots[idx].fee! / lots[idx].amountBTC) * take : undefined,
                exchange: lots[idx].exchange,
                wallet: destWallet,
                remainingBTC: take,
              });
              lots.push(retagged);
            }
            remaining -= take;
          }

          if (remaining > 0.00000001) {
            warnings.push(
              `TransferIn on ${formatDateShort(trans.date)}: Could not find ${remaining.toFixed(8)} BTC in "${trans.sourceWallet}" to re-tag. Some lots may remain at the source wallet.`
            );
          }
        }
        // If no sourceWallet assigned, do nothing (same as before)
        break;
      }

      case TransactionType.TransferOut:
        // Non-taxable movement — lots stay where they are.
        // The corresponding TransferIn (with sourceWallet) handles re-tagging.
        break;
    }
  }

  return { lots, sales, warnings };
}

/**
 * Extract lot selections from a recorded SaleRecord.
 * Maps lotDetails back to LotSelection format that processSale() expects.
 * Uses lotId (= source Buy transaction ID, now deterministic) for matching.
 *
 * Legacy migration: pre-v1.2.49 recordings lack lotId on LotDetails.
 * For those, we match against current lots by purchaseDate + costBasisPerBTC
 * to recover the user's original lot election.
 */
function extractLotSelections(recorded: SaleRecord, currentLots?: Lot[]): LotSelection[] | null {
  const selections: LotSelection[] = [];
  const usedLotIds = new Set<string>();
  let unmatchedCount = 0;

  for (const d of recorded.lotDetails) {
    if (d.lotId) {
      // New-style: has deterministic lotId — verify lot still exists in current pool
      if (currentLots && !currentLots.some((l) => l.id === d.lotId)) {
        unmatchedCount++;
      } else {
        selections.push({ lotId: d.lotId, amountBTC: d.amountBTC });
        usedLotIds.add(d.lotId);
      }
    } else if (currentLots) {
      // Legacy migration: match by purchaseDate + costBasisPerBTC + exchange
      // These properties uniquely identify which Buy transaction (= lot) was used
      const match = currentLots.find(
        (lot) =>
          !usedLotIds.has(lot.id) &&
          lot.purchaseDate === d.purchaseDate &&
          Math.abs(lot.pricePerBTC - d.costBasisPerBTC) < 0.005 &&
          lot.exchange === d.exchange
      );
      if (match) {
        selections.push({ lotId: match.id, amountBTC: d.amountBTC });
        usedLotIds.add(match.id);
      } else {
        unmatchedCount++;
      }
    } else {
      unmatchedCount++;
    }
  }

  // If ANY lot details failed to resolve, return null to trigger full fallback.
  // Partial selections are dangerous — they silently under-fill the disposition.
  if (unmatchedCount > 0) return null;

  return selections;
}

/**
 * Calculate lot state up to (but not including) a specific transaction.
 * Used to get the available lots at the point in time just before a sale/donation,
 * so the user can retroactively assign Specific ID lot selections to imported sells.
 *
 * All transactions before `stopBeforeTransactionId` are processed normally
 * (including their recorded Specific ID elections). The target transaction
 * and everything after it are skipped, giving us the lot pool as it existed
 * at that moment in time.
 *
 * excludeSaleRecordId: optional SaleRecord.id to exclude from the recorded sales
 * passed to calculate(). This prevents the target transaction's own record from
 * being consumed by a different transaction with the same legacy key (date|amount|type),
 * which would corrupt the lot pool.
 */
export function calculateUpTo(
  transactions: Transaction[],
  method: AccountingMethod,
  stopBeforeTransactionId: string,
  recordedSales?: SaleRecord[],
  excludeSaleRecordId?: string
): CalculationResult {
  // Sort chronologically (same as calculate())
  const sorted = [...transactions].sort(
    (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()
  );

  // Find the index of the target transaction
  const stopIdx = sorted.findIndex((t) => t.id === stopBeforeTransactionId);
  if (stopIdx === -1) {
    // Transaction not found — fall back to full calculation
    return calculate(transactions, method, recordedSales);
  }

  // Process only transactions before the target
  const subset = sorted.slice(0, stopIdx);

  // Exclude the target transaction's own SaleRecord to prevent legacy key contamination
  const filteredSales = excludeSaleRecordId && recordedSales
    ? recordedSales.filter((rs) => rs.id !== excludeSaleRecordId)
    : recordedSales;

  return calculate(subset, method, filteredSales);
}

/**
 * Auto-select lots to minimize estimated tax burden.
 * Scores each lot by (salePrice - costBasisPerBTC) * taxRate, picks lowest scores first
 * (losses first, then smallest gains). When salePrice is unavailable (donations),
 * falls back to long-term first + highest basis.
 *
 * Returns LotSelection[] ready to pass to simulateSale().
 */
export function optimizeLotSelections(
  lots: Lot[],
  targetAmount: number,
  salePrice?: number,
  saleDate?: string
): LotSelection[] {
  const refDate = saleDate || new Date().toISOString();
  const ST_RATE = 0.37;
  const LT_RATE = 0.15;

  const ranked = lots
    .filter((l) => l.remainingBTC > 0)
    .map((lot) => {
      const longTerm = isMoreThanOneYear(lot.purchaseDate, refDate);
      const costBasisPerBTC = lot.totalCost / lot.amountBTC; // fee-inclusive
      const rate = longTerm ? LT_RATE : ST_RATE;
      const taxScore = salePrice
        ? (salePrice - costBasisPerBTC) * rate
        : (longTerm ? -1e9 : 0) - costBasisPerBTC; // fallback: long-term first, then highest basis
      return { lot, taxScore };
    })
    .sort((a, b) => a.taxScore - b.taxScore);

  let needed = targetAmount;
  const selections: LotSelection[] = [];
  for (const { lot } of ranked) {
    if (needed <= 0.00000001) break;
    const take = Math.min(lot.remainingBTC, needed);
    selections.push({ lotId: lot.id, amountBTC: take });
    needed -= take;
  }
  return selections;
}

/**
 * Batch-optimize all unassigned sells/donations in a year using Specific ID.
 * Processes chronologically: for each unassigned disposition, calculates lots at that point,
 * runs optimizeLotSelections(), simulates the sale, and returns the SaleRecords to save.
 *
 * Does NOT modify any state — caller is responsible for saving the returned records.
 * Skips transactions that already have Specific ID elections (unless includeExisting is true).
 */
export function batchOptimizeSpecificId(
  transactions: Transaction[],
  recordedSales: SaleRecord[],
  taxYear: number,
  includeExisting = false
): { records: SaleRecord[]; skipped: number; failed: string[]; walletMismatches: string[] } {
  const resolved = resolveRecordedSales(transactions, recordedSales);
  const sorted = [...transactions].sort(
    (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()
  );

  const dispositions = sorted.filter((t) => {
    if (t.transactionType !== TransactionType.Sell && t.transactionType !== TransactionType.Donation) return false;
    const txnYear = new Date(t.date).getFullYear();
    if (txnYear !== taxYear) return false;
    if (!includeExisting && resolved.has(t.id)) return false;
    return true;
  });

  const records: SaleRecord[] = [];
  const failed: string[] = [];
  const walletMismatches: string[] = [];
  let skipped = 0;

  // Build a working copy of recordedSales that accumulates new records as we go
  let workingSales = [...recordedSales];

  for (const txn of dispositions) {
    // Calculate lots at this point, including previously generated records from this batch
    const result = calculateUpTo(transactions, AccountingMethod.FIFO, txn.id, workingSales);
    const available = result.lots.filter((l) => l.remainingBTC > 0);

    // Wallet filter (TD 9989)
    const walletName = txn.wallet || txn.exchange;
    const walletNorm = (walletName || "").trim().toLowerCase();
    let pool = available;
    let isMismatch = false;
    if (walletNorm) {
      const filtered = available.filter(
        (l) => (l.wallet || l.exchange || "").trim().toLowerCase() === walletNorm
      );
      if (filtered.length > 0) {
        pool = filtered;
      } else if (available.length > 0) {
        isMismatch = true;
      }
    }

    const isDonation = txn.transactionType === TransactionType.Donation;
    const salePrice = isDonation ? undefined : txn.pricePerBTC;
    const selections = optimizeLotSelections(pool, txn.amountBTC, salePrice, txn.date);

    // Reject if no lots available or if selections don't fully cover the disposition
    const totalSelected = selections.reduce((sum, s) => sum + s.amountBTC, 0);
    if (selections.length === 0 || totalSelected < txn.amountBTC - 1e-8) {
      failed.push(txn.id);
      skipped++;
      continue;
    }

    const sim = simulateSale(
      txn.amountBTC,
      isDonation ? 0 : txn.pricePerBTC,
      result.lots, // full lot pool for simulateSale to deep-copy
      AccountingMethod.SpecificID,
      selections,
      walletName || undefined,
      txn.date
    );

    if (!sim || sim.amountSold < txn.amountBTC - 1e-8) {
      failed.push(txn.id);
      skipped++;
      continue;
    }

    if (isDonation) {
      sim.isDonation = true;
      sim.donationFmvPerBTC = txn.pricePerBTC;
      sim.donationFmvTotal = txn.amountBTC * txn.pricePerBTC;
    }

    const record: SaleRecord = {
      ...sim,
      id: crypto.randomUUID(),
      saleDate: txn.date,
      method: AccountingMethod.SpecificID,
      sourceTransactionId: txn.id,
      walletMismatch: isMismatch || undefined,
    };

    if (isMismatch) walletMismatches.push(txn.id);
    records.push(record);
    // Add to working sales so the next iteration's calculateUpTo sees this assignment
    workingSales = [...workingSales, record];
  }

  return { records, skipped, failed, walletMismatches };
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

/** Disposition type: sale (taxable) or donation (non-taxable, IRC §170) */
type DispositionType = "sale" | "donation";

/**
 * Process a disposition (sale or donation) against available lots.
 * MUTATES the lots array (reduces remainingBTC).
 * Enforces per-wallet/per-account cost basis per IRS TD 9989 (effective Jan 1, 2025).
 * Optionally accepts lotSelections for Specific Identification method.
 *
 * For donations: proceeds, salePricePerBTC, and gainLoss are always zero.
 * FMV is stored in donationFmvPerBTC/donationFmvTotal for Form 8283 reporting.
 */
function processSale(
  sale: Transaction,
  lots: Lot[],
  method: AccountingMethod,
  lotSelections?: LotSelection[],
  warnings?: string[],
  dispositionType: DispositionType = "sale",
  fmvPerBTC?: number
): SaleRecord | null {
  const amountToSell = sale.amountBTC;
  if (amountToSell <= 0) return null;

  // Per-wallet cost basis enforcement (IRS TD 9989)
  // Filter lots to the same wallet/account as the sale (case-insensitive)
  const normalizeWallet = (w: string | undefined) => (w || "").trim().toLowerCase();
  const saleWallet = sale.wallet || sale.exchange;
  const saleWalletNorm = normalizeWallet(saleWallet);
  let availableIndices = lots
    .map((lot, idx) => ({ lot, idx }))
    .filter(({ lot }) => lot.remainingBTC > 0 && normalizeWallet(lot.wallet || lot.exchange) === saleWalletNorm)
    .map(({ idx }) => idx);

  // Fallback: if no lots match the wallet, use all available lots with a warning
  let walletMismatch = false;
  if (availableIndices.length === 0) {
    availableIndices = lots
      .map((lot, idx) => ({ lot, idx }))
      .filter(({ lot }) => lot.remainingBTC > 0)
      .map(({ idx }) => idx);

    if (availableIndices.length > 0) {
      walletMismatch = true;
      if (warnings) {
        warnings.push(
          `No lots found in wallet "${saleWallet}" for sale on ${formatDateShort(sale.date)}. Fell back to global lot pool.`
        );
      }
    }
  }

  if (availableIndices.length === 0) return null;

  let totalCostBasis = 0;
  const lotDetails: LotDetail[] = [];
  let remainingToSell = amountToSell;
  const holdingDays: number[] = [];

  // Specific Identification: use manual lot selections (restricted to wallet-filtered lots)
  if (method === AccountingMethod.SpecificID && lotSelections && lotSelections.length > 0) {
    const availableSet = new Set(availableIndices);
    for (const sel of lotSelections) {
      if (remainingToSell <= 0) break;
      const lotIdx = lots.findIndex((l) => l.id === sel.lotId);
      if (lotIdx === -1 || !availableSet.has(lotIdx) || lots[lotIdx].remainingBTC <= 0) continue;

      const sellFromLot = Math.min(sel.amountBTC, lots[lotIdx].remainingBTC, remainingToSell);
      // Use fee-inclusive cost basis: totalCost includes exchange fee (cost basis = amount*price + fee)
      const costBasisPerBTC = lots[lotIdx].totalCost / lots[lotIdx].amountBTC;
      const costForPortion = sellFromLot * costBasisPerBTC;
      totalCostBasis += costForPortion;

      const daysHeld = daysBetween(lots[lotIdx].purchaseDate, sale.date);
      holdingDays.push(daysHeld);

      lotDetails.push({
        id: crypto.randomUUID(),
        lotId: lots[lotIdx].id,
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
      // Epsilon snap: prevent IEEE 754 float drift from creating phantom lots
      if (lots[lotIdx].remainingBTC > 0 && lots[lotIdx].remainingBTC < 1e-8) {
        lots[lotIdx].remainingBTC = 0;
      }
      remainingToSell -= sellFromLot;
    }
  } else {
    // Standard method: sort indices by method
    // FIFO is the only automatic method (IRS default). Specific ID without selections also falls back to FIFO.
    const sortedIndices = availableIndices.sort(
      (a, b) => new Date(lots[a].purchaseDate).getTime() - new Date(lots[b].purchaseDate).getTime()
    );

    for (const idx of sortedIndices) {
      if (remainingToSell <= 0) break;

      const sellFromLot = Math.min(remainingToSell, lots[idx].remainingBTC);
      // Use fee-inclusive cost basis: totalCost includes exchange fee (cost basis = amount*price + fee)
      const costBasisPerBTC = lots[idx].totalCost / lots[idx].amountBTC;
      const costForPortion = sellFromLot * costBasisPerBTC;
      totalCostBasis += costForPortion;

      const daysHeld = daysBetween(lots[idx].purchaseDate, sale.date);
      holdingDays.push(daysHeld);

      lotDetails.push({
        id: crypto.randomUUID(),
        lotId: lots[idx].id,
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
      // Epsilon snap: prevent IEEE 754 float drift from creating phantom lots
      if (lots[idx].remainingBTC > 0 && lots[idx].remainingBTC < 1e-8) {
        lots[idx].remainingBTC = 0;
      }
      remainingToSell -= sellFromLot;
    }
  }

  const amountSold = amountToSell - remainingToSell;
  const isDonation = dispositionType === "donation";

  // Donations: zero proceeds, zero gain/loss (IRC §170 — not a capital gains event)
  // Sales: pro-rate proceeds if only partially filled (not enough lots to cover full sale)
  const totalProceeds = isDonation
    ? 0
    : amountSold < amountToSell
      ? amountSold * sale.pricePerBTC
      : sale.totalUSD;
  const gainLoss = isDonation ? 0 : totalProceeds - totalCostBasis;
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
    sourceTransactionId: sale.id,
    saleDate: sale.date,
    amountSold,
    salePricePerBTC: isDonation ? 0 : sale.pricePerBTC,
    totalProceeds,
    costBasis: totalCostBasis,
    gainLoss,
    fee: amountSold < amountToSell ? (amountSold / amountToSell) * (sale.fee ?? 0) : sale.fee,
    lotDetails,
    holdingPeriodDays: avgHoldingDays,
    isLongTerm,
    isMixedTerm,
    method,
    isDonation: isDonation || undefined,
    donationFmvPerBTC: isDonation ? fmvPerBTC : undefined,
    donationFmvTotal: isDonation ? amountSold * (fmvPerBTC ?? 0) : undefined,
    walletMismatch: walletMismatch || undefined,
  };
}
