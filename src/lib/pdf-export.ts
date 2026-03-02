import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { SaleRecord } from "./models";
import { AccountingMethod, AccountingMethodDisplayNames } from "./types";

function formatDate(isoDate: string): string {
  const d = new Date(isoDate);
  if (isNaN(d.getTime())) return "UNKNOWN";
  return d.toISOString().split("T")[0];
}

function formatBTC(value: number): string {
  return value.toFixed(8);
}

/** Form 8949 description: "0.50000000 BTC (Coinbase)" — includes wallet for audit trail */
function formatPropertyDescription(amountBTC: number, detail: { wallet?: string; exchange: string }): string {
  const walletName = detail.wallet || detail.exchange;
  return walletName ? `${formatBTC(amountBTC)} BTC (${walletName})` : `${formatBTC(amountBTC)} BTC`;
}

function formatUSD(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

/**
 * Generate a Form 8949 PDF report using jsPDF + autoTable.
 * Returns the PDF as a Uint8Array for saving via Tauri dialog.
 */
export function exportForm8949PDF(
  sales: SaleRecord[],
  year: number,
  method: AccountingMethod,
  walletMismatchCount?: number
): Uint8Array {
  // Exclude donations — they are not capital gain/loss events (IRC §170)
  sales = sales.filter((s) => !s.isDonation);
  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "letter" });
  const pageWidth = doc.internal.pageSize.getWidth();

  // --- Header ---
  doc.setFontSize(16);
  doc.setFont("helvetica", "bold");
  doc.text("Form 8949 — Sales and Dispositions of Capital Assets", 14, 15);

  doc.setFontSize(10);
  doc.setFont("helvetica", "normal");
  doc.text(`Tax Year: ${year}`, 14, 22);
  doc.text(`Method: ${method} (${AccountingMethodDisplayNames[method]})`, 14, 27);
  doc.text(`Generated: ${formatDate(new Date().toISOString())}`, 14, 32);
  doc.text("Sovereign Tax", pageWidth - 14, 15, { align: "right" });

  let yPos = 40;

  // --- Wallet mismatch disclaimer ---
  if (walletMismatchCount && walletMismatchCount > 0) {
    doc.setFontSize(8);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(180, 100, 0);
    doc.text(
      `WARNING: ${walletMismatchCount} sale(s) used lots from a different wallet than where the sale occurred.`,
      14,
      yPos
    );
    yPos += 4;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.5);
    doc.text(
      "Treasury Reg. \u00A71.1012-1(j) (effective Jan 1, 2025) requires per-wallet cost basis. These sales used a global lot pool fallback.",
      14,
      yPos
    );
    yPos += 4;
    doc.text(
      "To fix: assign source wallets on Transfer In transactions so lots are re-tagged to the correct wallet before exporting.",
      14,
      yPos
    );
    doc.setTextColor(0, 0, 0);
    yPos += 8;
  }

  // Build detail rows at the lot-detail level across ALL sales (handles mixed-term correctly)
  const stRows = buildDetailRows(sales, false);
  const ltRows = buildDetailRows(sales, true);

  // Compute totals from lot details, not sale-level aggregates
  const { proceeds: stProceeds, basis: stBasis, gainLoss: stGL, fees: stFees } = computeDetailTotals(sales, false);
  const { proceeds: ltProceeds, basis: ltBasis, gainLoss: ltGL, fees: ltFees } = computeDetailTotals(sales, true);

  // --- Part I: Short-Term ---
  doc.setFontSize(12);
  doc.setFont("helvetica", "bold");
  doc.text("Part I — Short-Term Capital Gains and Losses (held one year or less)", 14, yPos);
  yPos += 5;

  if (stRows.length === 0) {
    doc.setFontSize(10);
    doc.setFont("helvetica", "italic");
    doc.text("No short-term sales for this period.", 14, yPos + 5);
    yPos += 12;
  } else {
    autoTable(doc, {
      startY: yPos,
      head: [["Description", "Date Acquired", "Date Sold", "Proceeds", "Cost Basis", "Adj. (Fees)", "Gain/(Loss)"]],
      body: stRows,
      foot: [buildTotalRowFromDetails("Total Short-Term", stProceeds, stBasis, stGL, stFees)],
      theme: "striped",
      headStyles: { fillColor: [41, 128, 185], fontSize: 8 },
      bodyStyles: { fontSize: 8 },
      footStyles: { fillColor: [220, 220, 220], textColor: [0, 0, 0], fontStyle: "bold", fontSize: 8 },
      margin: { left: 14, right: 14 },
      styles: { cellPadding: 2 },
    });
    yPos = (doc as any).lastAutoTable.finalY + 10;
  }

  // Check if we need a new page
  if (yPos > doc.internal.pageSize.getHeight() - 40) {
    doc.addPage();
    yPos = 15;
  }

  // --- Part II: Long-Term ---
  doc.setFontSize(12);
  doc.setFont("helvetica", "bold");
  doc.text("Part II — Long-Term Capital Gains and Losses (held more than one year)", 14, yPos);
  yPos += 5;

  if (ltRows.length === 0) {
    doc.setFontSize(10);
    doc.setFont("helvetica", "italic");
    doc.text("No long-term sales for this period.", 14, yPos + 5);
    yPos += 12;
  } else {
    autoTable(doc, {
      startY: yPos,
      head: [["Description", "Date Acquired", "Date Sold", "Proceeds", "Cost Basis", "Adj. (Fees)", "Gain/(Loss)"]],
      body: ltRows,
      foot: [buildTotalRowFromDetails("Total Long-Term", ltProceeds, ltBasis, ltGL, ltFees)],
      theme: "striped",
      headStyles: { fillColor: [39, 174, 96], fontSize: 8 },
      bodyStyles: { fontSize: 8 },
      footStyles: { fillColor: [220, 220, 220], textColor: [0, 0, 0], fontStyle: "bold", fontSize: 8 },
      margin: { left: 14, right: 14 },
      styles: { cellPadding: 2 },
    });
    yPos = (doc as any).lastAutoTable.finalY + 10;
  }

  // Check if we need a new page for summary
  if (yPos > doc.internal.pageSize.getHeight() - 50) {
    doc.addPage();
    yPos = 15;
  }

  // --- Schedule D Summary ---
  doc.setFontSize(12);
  doc.setFont("helvetica", "bold");
  doc.text("Schedule D Summary — Capital Gains and Losses", 14, yPos);
  yPos += 5;

  autoTable(doc, {
    startY: yPos,
    head: [["Category", "Proceeds", "Cost Basis", "Gain/(Loss)"]],
    body: [
      ["Short-term (Part I)", formatUSD(stProceeds), formatUSD(stBasis), formatUSD(stGL)],
      ["Long-term (Part II)", formatUSD(ltProceeds), formatUSD(ltBasis), formatUSD(ltGL)],
    ],
    foot: [["Net Total", formatUSD(stProceeds + ltProceeds), formatUSD(stBasis + ltBasis), formatUSD(stGL + ltGL)]],
    theme: "grid",
    headStyles: { fillColor: [52, 73, 94], fontSize: 9 },
    bodyStyles: { fontSize: 9 },
    footStyles: { fillColor: [220, 220, 220], textColor: [0, 0, 0], fontStyle: "bold", fontSize: 9 },
    margin: { left: 14, right: 14 },
    styles: { cellPadding: 3 },
  });

  // --- NIIT Surtax Note ---
  yPos = (doc as any).lastAutoTable.finalY + 8;
  if (yPos > doc.internal.pageSize.getHeight() - 30) {
    doc.addPage();
    yPos = 15;
  }
  doc.setFontSize(7.5);
  doc.setFont("helvetica", "italic");
  doc.setTextColor(128, 128, 128);
  doc.text(
    "Note: Capital gains may be subject to an additional 3.8% Net Investment Income Tax (NIIT) if MAGI exceeds $200,000 ($250,000 MFJ). See IRS Form 8960.",
    14,
    yPos
  );

  // --- Footer on all pages ---
  const totalPages = doc.getNumberOfPages();
  for (let i = 1; i <= totalPages; i++) {
    doc.setPage(i);
    const pageHeight = doc.internal.pageSize.getHeight();
    doc.setFontSize(8);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(128, 128, 128);
    doc.text(`Page ${i} of ${totalPages}`, pageWidth - 14, pageHeight - 8, { align: "right" });
    doc.text("Generated by Sovereign Tax — For informational purposes only. Consult a tax professional.", 14, pageHeight - 8);
  }

  // Reset text color
  doc.setTextColor(0, 0, 0);

  // Return as binary for Tauri file save
  return new Uint8Array(doc.output("arraybuffer"));
}

/** Build detail rows from ALL sales, filtering lot details by term */
function buildDetailRows(sales: SaleRecord[], longTermOnly: boolean): string[][] {
  const rows: string[][] = [];
  for (const sale of sales) {
    const termDetails = sale.lotDetails.filter((d) => longTermOnly ? d.isLongTerm : !d.isLongTerm);
    if (termDetails.length === 0) continue;
    // Apportion fee proportionally when sale has mixed-term lots
    const termBTC = termDetails.reduce((a, d) => a + d.amountBTC, 0);
    const totalBTC = sale.lotDetails.reduce((a, d) => a + d.amountBTC, 0);
    const feeShare = sale.fee ? sale.fee * (termBTC / totalBTC) : 0;
    let feeRemaining = feeShare;
    for (let di = 0; di < termDetails.length; di++) {
      const detail = termDetails[di];
      const proceeds = detail.amountBTC * sale.salePricePerBTC;
      const gainLoss = proceeds - detail.totalCost;
      let lotFee = 0;
      if (feeShare > 0) {
        lotFee = di < termDetails.length - 1 ? Math.round((feeShare / termDetails.length) * 100) / 100 : Math.round(feeRemaining * 100) / 100;
        feeRemaining -= lotFee;
      }
      rows.push([
        `${formatPropertyDescription(detail.amountBTC, detail)}`,
        formatDate(detail.purchaseDate),
        formatDate(sale.saleDate),
        formatUSD(proceeds),
        formatUSD(detail.totalCost),
        lotFee > 0 ? formatUSD(lotFee) : "",
        formatUSD(gainLoss),
      ]);
    }
  }
  return rows;
}

/** Compute totals from lot details for a given term */
function computeDetailTotals(sales: SaleRecord[], longTermOnly: boolean): { proceeds: number; basis: number; gainLoss: number; fees: number } {
  let proceeds = 0, basis = 0, gainLoss = 0, fees = 0;
  for (const sale of sales) {
    const termDetails = sale.lotDetails.filter((d) => d.isLongTerm === longTermOnly);
    if (termDetails.length === 0) continue;
    const termBTC = termDetails.reduce((a, d) => a + d.amountBTC, 0);
    const totalBTC = sale.lotDetails.reduce((a, d) => a + d.amountBTC, 0);
    for (const detail of termDetails) {
      const detailProceeds = detail.amountBTC * sale.salePricePerBTC;
      proceeds += detailProceeds;
      basis += detail.totalCost;
      gainLoss += detailProceeds - detail.totalCost;
    }
    fees += sale.fee ? sale.fee * (termBTC / totalBTC) : 0;
  }
  return { proceeds, basis, gainLoss, fees };
}

function buildTotalRowFromDetails(label: string, totalProceeds: number, totalBasis: number, totalGL: number, totalFees: number): string[] {
  return [
    label,
    "",
    "",
    formatUSD(totalProceeds),
    formatUSD(totalBasis),
    totalFees > 0 ? formatUSD(totalFees) : "",
    formatUSD(totalGL),
  ];
}
