import { SaleRecord, Transaction } from "./models";
import { AccountingMethod, AccountingMethodDisplayNames, IncomeTypeDisplayNames, TransactionType } from "./types";

function formatDate(isoDate: string): string {
  const d = new Date(isoDate);
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

/** Export Form 8949 compatible CSV — splits lot details by term, not sales */
export function exportForm8949CSV(
  sales: SaleRecord[],
  year: number,
  method: AccountingMethod
): string {
  const lines: string[] = [];

  // Title
  lines.push("IRS Form 8949 — Sales and Dispositions of Capital Assets");
  lines.push(`Tax Year: ${year}`);
  lines.push(`Accounting Method: ${method} (${AccountingMethodDisplayNames[method]})`);
  lines.push(`Generated: ${formatDate(new Date().toISOString())}`);
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
    for (const detail of stDetails) {
      const proceeds = detail.amountBTC * sale.salePricePerBTC;
      const gainLoss = proceeds - detail.totalCost;
      const feeStr = feeShare > 0 ? formatCSVDecimal(feeShare / stDetails.length) : "";
      lines.push(
        `${formatBTC(detail.amountBTC)} BTC,${formatDate(detail.purchaseDate)},${formatDate(sale.saleDate)},${formatCSVDecimal(proceeds)},${formatCSVDecimal(detail.totalCost)},${feeStr},${formatCSVDecimal(gainLoss)}`
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
    for (const detail of ltDetails) {
      const proceeds = detail.amountBTC * sale.salePricePerBTC;
      const gainLoss = proceeds - detail.totalCost;
      const feeStr = feeShare > 0 ? formatCSVDecimal(feeShare / ltDetails.length) : "";
      lines.push(
        `${formatBTC(detail.amountBTC)} BTC,${formatDate(detail.purchaseDate)},${formatDate(sale.saleDate)},${formatCSVDecimal(proceeds)},${formatCSVDecimal(detail.totalCost)},${feeStr},${formatCSVDecimal(gainLoss)}`
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

  return lines.join("\n");
}

/** Export legacy CSV */
export function exportLegacyCSV(sales: SaleRecord[]): string {
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
          `${formatBTC(detail.amountBTC)} BTC`,
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
export function exportTurboTaxTXF(sales: SaleRecord[], year: number): string {
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
      lines.push(`P${formatBTC(detail.amountBTC)} BTC`);
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
export function exportTurboTaxCSV(sales: SaleRecord[], year: number): string {
  const lines = [
    "Currency Name,Purchase Date,Cost Basis,Date Sold,Proceeds",
  ];

  for (const sale of sales) {
    for (const detail of sale.lotDetails) {
      const proceeds = detail.amountBTC * sale.salePricePerBTC;
      lines.push(
        `${formatBTC(detail.amountBTC)} BTC,${formatDate(detail.purchaseDate)},${formatCSVDecimal(detail.totalCost)},${formatDate(sale.saleDate)},${formatCSVDecimal(proceeds)}`
      );
    }
  }

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
