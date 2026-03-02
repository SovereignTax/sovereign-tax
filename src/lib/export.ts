import { SaleRecord, Transaction } from "./models";
import { AccountingMethod, AccountingMethodDisplayNames, IncomeTypeDisplayNames, TransactionType } from "./types";

function formatDate(isoDate: string): string {
  const d = new Date(isoDate);
  if (isNaN(d.getTime())) return "UNKNOWN";
  return d.toISOString().split("T")[0]; // yyyy-MM-dd
}

function formatBTC(value: number): string {
  return value.toFixed(8);
}

function formatCSVDecimal(value: number): string {
  return value.toFixed(2);
}

function formatUSD(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(value);
}

/** Form 8949 description: "0.50000000 BTC (Coinbase)" — includes wallet for audit trail.
 *  CSV-safe: wraps in quotes and escapes internal quotes so commas/quotes in exchange names don't break CSV parsing. */
function formatPropertyDescription(amountBTC: number, detail: { wallet?: string; exchange: string }): string {
  const walletName = detail.wallet || detail.exchange;
  const desc = walletName ? `${formatBTC(amountBTC)} BTC (${walletName})` : `${formatBTC(amountBTC)} BTC`;
  return `"${desc.replace(/"/g, '""')}"`;
}

/** Export Form 8949 compatible CSV — splits lot details by term, not sales */
export function exportForm8949CSV(
  sales: SaleRecord[],
  year: number,
  method: AccountingMethod,
  walletMismatchCount?: number
): string {
  // Exclude donations — they are not capital gain/loss events (IRC §170)
  sales = sales.filter((s) => !s.isDonation);
  const lines: string[] = [];

  // Title
  lines.push("IRS Form 8949 — Sales and Dispositions of Capital Assets");
  lines.push(`Tax Year: ${year}`);
  lines.push(`Accounting Method: ${method} (${AccountingMethodDisplayNames[method]})`);
  lines.push(`Generated: ${formatDate(new Date().toISOString())}`);

  // Wallet mismatch disclaimer — per-wallet tracking required by Treasury Reg. §1.1012-1(j)
  if (walletMismatchCount && walletMismatchCount > 0) {
    lines.push("");
    lines.push(`WARNING: ${walletMismatchCount} sale(s) in this report used lots from a different wallet than where the sale occurred.`);
    lines.push("Treasury Reg. §1.1012-1(j) (effective Jan 1 2025) requires per-wallet cost basis tracking.");
    lines.push("These sales fell back to a global lot pool which may not satisfy IRS per-wallet requirements.");
    lines.push("To fix: assign source wallets on your Transfer In transactions so lots are re-tagged to the correct wallet.");
  }

  lines.push("");

  // Collect all lot details split by term across ALL sales (handles mixed-term sales)
  let stProceeds = 0, stBasis = 0, stGainLoss = 0, stFees = 0;
  let ltProceeds = 0, ltBasis = 0, ltGainLoss = 0, ltFees = 0;

  // Part I — Short-Term
  lines.push("PART I — SHORT-TERM CAPITAL GAINS AND LOSSES (held one year or less)");
  lines.push("Description of Property,Date Acquired,Date Sold,Proceeds (Sales Price),Cost or Other Basis,Adjustments (Fees),Gain or (Loss)");

  for (const sale of sales) {
    const stDetails = sale.lotDetails.filter((d) => !d.isLongTerm);
    if (stDetails.length === 0) continue;
    // Apportion fee proportionally to short-term portion
    const stBTCTotal = stDetails.reduce((a, d) => a + d.amountBTC, 0);
    const saleBTCTotal = sale.lotDetails.reduce((a, d) => a + d.amountBTC, 0);
    const feeShare = sale.fee ? sale.fee * (stBTCTotal / saleBTCTotal) : 0;
    let feeRemaining = feeShare;
    for (let di = 0; di < stDetails.length; di++) {
      const detail = stDetails[di];
      const proceeds = detail.amountBTC * sale.salePricePerBTC;
      const gainLoss = proceeds - detail.totalCost;
      // Assign fee per lot; last lot gets remainder to avoid rounding loss
      let lotFee = 0;
      if (feeShare > 0) {
        lotFee = di < stDetails.length - 1 ? Math.round((feeShare / stDetails.length) * 100) / 100 : Math.round(feeRemaining * 100) / 100;
        feeRemaining -= lotFee;
      }
      const feeStr = lotFee > 0 ? formatCSVDecimal(lotFee) : "";
      lines.push(
        `${formatPropertyDescription(detail.amountBTC, detail)},${formatDate(detail.purchaseDate)},${formatDate(sale.saleDate)},${formatCSVDecimal(proceeds)},${formatCSVDecimal(detail.totalCost)},${feeStr},${formatCSVDecimal(gainLoss)}`
      );
      stProceeds += proceeds;
      stBasis += detail.totalCost;
      stGainLoss += gainLoss;
    }
    stFees += feeShare;
  }

  lines.push(`TOTAL SHORT-TERM,,,${formatCSVDecimal(stProceeds)},${formatCSVDecimal(stBasis)},${stFees > 0 ? formatCSVDecimal(stFees) : ""},${formatCSVDecimal(stGainLoss)}`);
  lines.push("");

  // Part II — Long-Term
  lines.push("PART II — LONG-TERM CAPITAL GAINS AND LOSSES (held more than one year)");
  lines.push("Description of Property,Date Acquired,Date Sold,Proceeds (Sales Price),Cost or Other Basis,Adjustments (Fees),Gain or (Loss)");

  for (const sale of sales) {
    const ltDetails = sale.lotDetails.filter((d) => d.isLongTerm);
    if (ltDetails.length === 0) continue;
    // Apportion fee proportionally to long-term portion
    const ltBTCTotal = ltDetails.reduce((a, d) => a + d.amountBTC, 0);
    const saleBTCTotal = sale.lotDetails.reduce((a, d) => a + d.amountBTC, 0);
    const feeShare = sale.fee ? sale.fee * (ltBTCTotal / saleBTCTotal) : 0;
    let feeRemaining = feeShare;
    for (let di = 0; di < ltDetails.length; di++) {
      const detail = ltDetails[di];
      const proceeds = detail.amountBTC * sale.salePricePerBTC;
      const gainLoss = proceeds - detail.totalCost;
      let lotFee = 0;
      if (feeShare > 0) {
        lotFee = di < ltDetails.length - 1 ? Math.round((feeShare / ltDetails.length) * 100) / 100 : Math.round(feeRemaining * 100) / 100;
        feeRemaining -= lotFee;
      }
      const feeStr = lotFee > 0 ? formatCSVDecimal(lotFee) : "";
      lines.push(
        `${formatPropertyDescription(detail.amountBTC, detail)},${formatDate(detail.purchaseDate)},${formatDate(sale.saleDate)},${formatCSVDecimal(proceeds)},${formatCSVDecimal(detail.totalCost)},${feeStr},${formatCSVDecimal(gainLoss)}`
      );
      ltProceeds += proceeds;
      ltBasis += detail.totalCost;
      ltGainLoss += gainLoss;
    }
    ltFees += feeShare;
  }

  lines.push(`TOTAL LONG-TERM,,,${formatCSVDecimal(ltProceeds)},${formatCSVDecimal(ltBasis)},${ltFees > 0 ? formatCSVDecimal(ltFees) : ""},${formatCSVDecimal(ltGainLoss)}`);
  lines.push("");

  // Schedule D Summary
  lines.push("SCHEDULE D SUMMARY — Capital Gains and Losses");
  lines.push("Category,Proceeds,Cost Basis,Gain or (Loss)");
  lines.push(`Short-term (Part I),${formatCSVDecimal(stProceeds)},${formatCSVDecimal(stBasis)},${formatCSVDecimal(stGainLoss)}`);
  lines.push(`Long-term (Part II),${formatCSVDecimal(ltProceeds)},${formatCSVDecimal(ltBasis)},${formatCSVDecimal(ltGainLoss)}`);
  lines.push(`NET TOTAL,${formatCSVDecimal(stProceeds + ltProceeds)},${formatCSVDecimal(stBasis + ltBasis)},${formatCSVDecimal(stGainLoss + ltGainLoss)}`);

  // Repeat wallet mismatch disclaimer at end of document for visibility
  if (walletMismatchCount && walletMismatchCount > 0) {
    lines.push("");
    lines.push(`WARNING: ${walletMismatchCount} sale(s) used lots from a different wallet (see header for details).`);
  }

  return lines.join("\n");
}

/** Export legacy CSV */
export function exportLegacyCSV(sales: SaleRecord[], walletMismatchCount?: number): string {
  // Exclude donations — they are not capital gain/loss events
  sales = sales.filter((s) => !s.isDonation);
  const lines = [
    "Date Sold,Date Acquired,Description,Proceeds,Cost Basis,Fee,Gain/Loss,Holding Period (days),Term,Exchange",
  ];

  for (const sale of sales) {
    for (const detail of sale.lotDetails) {
      const proceeds = detail.amountBTC * sale.salePricePerBTC;
      const gainLoss = proceeds - detail.totalCost;
      lines.push(
        [
          formatDate(sale.saleDate),
          formatDate(detail.purchaseDate),
          `${formatPropertyDescription(detail.amountBTC, detail)}`,
          formatCSVDecimal(proceeds),
          formatCSVDecimal(detail.totalCost),
          sale.fee ? formatCSVDecimal(sale.fee) : "0.00",
          formatCSVDecimal(gainLoss),
          String(detail.daysHeld),
          detail.isLongTerm ? "Long-term" : "Short-term",
          detail.exchange,
        ].join(",")
      );
    }
  }

  // Wallet mismatch disclaimer
  if (walletMismatchCount && walletMismatchCount > 0) {
    lines.push("");
    lines.push(`# WARNING: ${walletMismatchCount} sale(s) used lots from a different wallet than where the sale occurred.`);
    lines.push("# Treasury Reg. §1.1012-1(j) requires per-wallet cost basis tracking (effective Jan 1 2025).");
    lines.push("# To fix: assign source wallets on Transfer In transactions so lots are re-tagged to the correct wallet.");
  }

  return lines.join("\n");
}

/** Export income transactions CSV for Schedule 1 reference */
export function exportIncomeCSV(transactions: Transaction[], year: number): string {
  const incomeTransactions = transactions.filter(
    (t) => t.incomeType && t.transactionType === TransactionType.Buy && new Date(t.date).getFullYear() === year
  );

  const lines = [
    "Schedule 1 — Ordinary Income from Cryptocurrency",
    `Tax Year: ${year}`,
    `Generated: ${formatDate(new Date().toISOString())}`,
    "",
    "Date,Income Type,BTC Amount,Fair Market Value (USD),Exchange,Notes",
  ];

  let totalIncome = 0;
  for (const t of incomeTransactions) {
    const typeName = t.incomeType ? IncomeTypeDisplayNames[t.incomeType] : "Unknown";
    lines.push(
      `${formatDate(t.date)},${typeName},${formatBTC(t.amountBTC)},${formatCSVDecimal(t.totalUSD)},${t.exchange},"${t.notes || ""}"`
    );
    totalIncome += t.totalUSD;
  }

  lines.push("");
  lines.push(`TOTAL ORDINARY INCOME,,,,${formatCSVDecimal(totalIncome)}`);

  return lines.join("\n");
}

/** Export TurboTax TXF format */
export function exportTurboTaxTXF(sales: SaleRecord[], year: number, walletMismatchCount?: number): string {
  // Exclude donations — they are not capital gain/loss events
  sales = sales.filter((s) => !s.isDonation);
  const lines: string[] = [];
  lines.push("V042");
  lines.push("ASovereign Tax");
  lines.push(`D${formatDate(new Date().toISOString())}`);
  lines.push("^");

  for (const sale of sales) {
    for (const detail of sale.lotDetails) {
      const proceeds = detail.amountBTC * sale.salePricePerBTC;
      // TXF type: 323 = short-term, 324 = long-term
      const typeCode = detail.isLongTerm ? "324" : "323";
      lines.push(`TD`);
      lines.push(`N${typeCode}`);
      lines.push(`C1`);
      lines.push(`L1`);
      lines.push(`P${formatPropertyDescription(detail.amountBTC, detail)}`);
      lines.push(`D${formatDate(detail.purchaseDate)}`);
      lines.push(`D${formatDate(sale.saleDate)}`);
      lines.push(`$${formatCSVDecimal(detail.totalCost)}`);
      lines.push(`$${formatCSVDecimal(proceeds)}`);
      lines.push("^");
    }
  }

  return lines.join("\n");
}

/** Export TurboTax CSV format */
export function exportTurboTaxCSV(sales: SaleRecord[], year: number, walletMismatchCount?: number): string {
  // Exclude donations — they are not capital gain/loss events
  sales = sales.filter((s) => !s.isDonation);
  const lines = [
    "Currency Name,Purchase Date,Cost Basis,Date Sold,Proceeds",
  ];

  for (const sale of sales) {
    for (const detail of sale.lotDetails) {
      const proceeds = detail.amountBTC * sale.salePricePerBTC;
      lines.push(
        `${formatPropertyDescription(detail.amountBTC, detail)},${formatDate(detail.purchaseDate)},${formatCSVDecimal(detail.totalCost)},${formatDate(sale.saleDate)},${formatCSVDecimal(proceeds)}`
      );
    }
  }

  // Wallet mismatch disclaimer
  if (walletMismatchCount && walletMismatchCount > 0) {
    lines.push("");
    lines.push(`# WARNING: ${walletMismatchCount} sale(s) used lots from a different wallet than where the sale occurred.`);
    lines.push("# Treasury Reg. §1.1012-1(j) requires per-wallet cost basis tracking (effective Jan 1 2025).");
    lines.push("# Assign source wallets on Transfer In transactions to fix.");
  }

  return lines.join("\n");
}

/** Data structure for donation summary used by TaxReportView */
export interface DonationSummaryItem {
  date: string;
  amountBTC: number;
  fmvPerBTC: number;
  totalFMV: number;
  costBasis: number;
  holdingPeriod: string; // "Short-term" or "Long-term" or "Mixed"
  exchange: string;
  notes: string;
  lotDetails: { purchaseDate: string; amountBTC: number; costBasis: number; isLongTerm: boolean; wallet?: string; exchange: string }[];
}

/**
 * Build donation summary from donation SaleRecords.
 * FMV is stored directly on the SaleRecord (donationFmvPerBTC/donationFmvTotal),
 * with fallback to raw transaction matching for legacy data.
 */
export function buildDonationSummary(
  donationSales: SaleRecord[],
  allTransactions: Transaction[],
  year: number
): DonationSummaryItem[] {
  // Fallback: raw donation transactions for legacy data that lacks FMV on SaleRecord
  const rawDonations = allTransactions.filter(
    (t) => t.transactionType === TransactionType.Donation && new Date(t.date).getFullYear() === year
  );
  const usedIds = new Set<string>();

  return donationSales.map((sale) => {
    // Prefer FMV stored directly on the SaleRecord (set during cost-basis calculation)
    let fmvPerBTC = sale.donationFmvPerBTC ?? 0;
    let totalFMV = sale.donationFmvTotal ?? 0;
    let exchange = sale.lotDetails[0]?.exchange ?? "Unknown";
    let notes = "";

    // Fallback: match to raw transaction for legacy data or if FMV not on SaleRecord
    if (!fmvPerBTC) {
      const rawMatch = rawDonations.find(
        (t) => !usedIds.has(t.id) && t.date === sale.saleDate && Math.abs(t.amountBTC - sale.amountSold) < 0.000000005
      );
      if (rawMatch) {
        usedIds.add(rawMatch.id);
        fmvPerBTC = rawMatch.pricePerBTC;
        totalFMV = rawMatch.totalUSD || sale.amountSold * fmvPerBTC;
        exchange = rawMatch.exchange;
        notes = rawMatch.notes;
      }
    } else {
      // Still try to get exchange/notes from raw transaction (match by date only for flexibility)
      const rawMatch = rawDonations.find(
        (t) => !usedIds.has(t.id) && t.date === sale.saleDate
      );
      if (rawMatch) {
        usedIds.add(rawMatch.id);
        exchange = rawMatch.exchange;
        notes = rawMatch.notes;
      }
    }

    const hasShort = sale.lotDetails.some((d) => !d.isLongTerm);
    const hasLong = sale.lotDetails.some((d) => d.isLongTerm);
    const holdingPeriod = hasShort && hasLong ? "Mixed" : hasLong ? "Long-term" : "Short-term";

    return {
      date: sale.saleDate,
      amountBTC: sale.amountSold,
      fmvPerBTC,
      totalFMV,
      costBasis: sale.costBasis,
      holdingPeriod,
      exchange,
      notes,
      lotDetails: sale.lotDetails.map((d) => ({
        purchaseDate: d.purchaseDate,
        amountBTC: d.amountBTC,
        costBasis: d.totalCost,
        isLongTerm: d.isLongTerm,
        wallet: d.wallet,
        exchange: d.exchange,
      })),
    };
  });
}

/** Export Form 8283 CSV — Noncash Charitable Contributions (for donation records) */
export function exportForm8283CSV(
  donationSummary: DonationSummaryItem[],
  year: number
): string {
  const lines: string[] = [];

  lines.push("IRS Form 8283 — Noncash Charitable Contributions (Reference Data)");
  lines.push(`Tax Year: ${year}`);
  lines.push(`Generated: ${formatDate(new Date().toISOString())}`);
  lines.push("");
  lines.push("IMPORTANT: This is reference data for preparing Form 8283. Donations of cryptocurrency");
  lines.push("are reported on Form 8283 (Schedule A), NOT on Form 8949. Consult a tax professional.");
  lines.push("");

  // Section A header (for donations ≤ $5,000 — most common)
  lines.push("SECTION A — Donated Property of $5,000 or Less");
  lines.push("Description of Property,Date Acquired,Date Donated,Donor's Cost Basis,Fair Market Value,FMV Method,Holding Period,Exchange/Wallet,Notes");

  let totalFMV = 0;
  let totalCostBasis = 0;
  let totalBTC = 0;

  for (const donation of donationSummary) {
    // If a donation drew from multiple lots, show per-lot detail
    for (const lot of donation.lotDetails) {
      const lotFMV = lot.amountBTC * donation.fmvPerBTC;
      lines.push(
        [
          `${formatPropertyDescription(lot.amountBTC, lot)}`,
          formatDate(lot.purchaseDate),
          formatDate(donation.date),
          formatCSVDecimal(lot.costBasis),
          formatCSVDecimal(lotFMV),
          donation.fmvPerBTC > 0 ? "CoinGecko / Exchange Rate" : "Not provided",
          lot.isLongTerm ? "Long-term" : "Short-term",
          donation.exchange,
          `"${(donation.notes || "").replace(/"/g, '""')}"`,
        ].join(",")
      );
    }
    totalFMV += donation.totalFMV;
    totalCostBasis += donation.costBasis;
    totalBTC += donation.amountBTC;
  }

  lines.push("");
  lines.push(`TOTALS,,,${formatCSVDecimal(totalCostBasis)},${formatCSVDecimal(totalFMV)}`);
  lines.push(`Total BTC Donated: ${formatBTC(totalBTC)}`);
  lines.push("");
  lines.push("NOTES:");
  lines.push("- Donations of appreciated property held > 1 year: deductible at FMV (IRC §170(b)(1)(C))");
  lines.push("- Donations of appreciated property held ≤ 1 year: deductible at cost basis (IRC §170(e)(1)(A))");
  lines.push("- Donations exceeding $500 require Form 8283 Section A");
  lines.push("- Donations exceeding $5,000 require a qualified appraisal (Form 8283 Section B)");
  lines.push("- Deduction limited to 30% of AGI for appreciated property (60% for cost-basis-limited property)");

  return lines.join("\n");
}

/** Export audit log CSV */
export function exportAuditLogCSV(entries: { id: string; timestamp: string; action: string; details: string }[]): string {
  const lines = [
    "Timestamp,Action,Details",
  ];

  for (const entry of entries) {
    lines.push(`${entry.timestamp},"${entry.action}","${entry.details.replace(/"/g, '""')}"`);
  }

  return lines.join("\n");
}
