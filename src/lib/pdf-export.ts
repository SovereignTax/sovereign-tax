import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { SaleRecord } from "./models";
import { AccountingMethod, AccountingMethodDisplayNames } from "./types";

function formatDate(isoDate: string): string {
  return new Date(isoDate).toISOString().split("T")[0];
}

function formatBTC(value: number): string {
  return value.toFixed(8);
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
 * Downloads the PDF immediately.
 */
export function exportForm8949PDF(
  sales: SaleRecord[],
  year: number,
  method: AccountingMethod
): void {
  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "letter" });
  const pageWidth = doc.internal.pageSize.getWidth();

  const shortTermSales = sales.filter((s) => !s.isLongTerm);
  const longTermSales = sales.filter((s) => s.isLongTerm);

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

  // --- Part I: Short-Term ---
  doc.setFontSize(12);
  doc.setFont("helvetica", "bold");
  doc.text("Part I — Short-Term Capital Gains and Losses (held one year or less)", 14, yPos);
  yPos += 5;

  const stRows = buildDetailRows(shortTermSales, false);

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
      foot: [buildTotalRow("Total Short-Term", shortTermSales)],
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

  const ltRows = buildDetailRows(longTermSales, true);

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
      foot: [buildTotalRow("Total Long-Term", longTermSales)],
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

  const stProceeds = shortTermSales.reduce((a, s) => a + s.totalProceeds, 0);
  const stBasis = shortTermSales.reduce((a, s) => a + s.costBasis, 0);
  const stGL = shortTermSales.reduce((a, s) => a + s.gainLoss, 0);
  const ltProceeds = longTermSales.reduce((a, s) => a + s.totalProceeds, 0);
  const ltBasis = longTermSales.reduce((a, s) => a + s.costBasis, 0);
  const ltGL = longTermSales.reduce((a, s) => a + s.gainLoss, 0);

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

  // Download
  doc.save(`form_8949_${year}_${method}.pdf`);
}

function buildDetailRows(sales: SaleRecord[], longTermOnly: boolean): string[][] {
  const rows: string[][] = [];
  for (const sale of sales) {
    for (const detail of sale.lotDetails) {
      if (longTermOnly && !detail.isLongTerm) continue;
      if (!longTermOnly && detail.isLongTerm) continue;
      const proceeds = detail.amountBTC * sale.salePricePerBTC;
      const gainLoss = proceeds - detail.totalCost;
      rows.push([
        `${formatBTC(detail.amountBTC)} BTC`,
        formatDate(detail.purchaseDate),
        formatDate(sale.saleDate),
        formatUSD(proceeds),
        formatUSD(detail.totalCost),
        sale.fee ? formatUSD(sale.fee) : "",
        formatUSD(gainLoss),
      ]);
    }
  }
  return rows;
}

function buildTotalRow(label: string, sales: SaleRecord[]): string[] {
  const totalProceeds = sales.reduce((a, s) => a + s.totalProceeds, 0);
  const totalBasis = sales.reduce((a, s) => a + s.costBasis, 0);
  const totalGL = sales.reduce((a, s) => a + s.gainLoss, 0);
  const totalFees = sales.reduce((a, s) => a + (s.fee || 0), 0);
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
