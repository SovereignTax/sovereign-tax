import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { LotDetail, SaleRecord, WalletReporting } from "./models";
import { assignBox, groupByBox, getUnclassifiedSaleWallets, BOX_INFO, BASIS_REPORTED_NOTE, DIGITAL_ASSET_BOXES_FIRST_YEAR } from "./form8949-boxes";
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

type DetailFilter = (detail: LotDetail, sale: SaleRecord) => boolean;

interface PdfSection {
  title: string;
  note?: string;
  include: DetailFilter;
  box?: keyof typeof BOX_INFO; // 2025+ digital-asset box; undefined for the pre-2025 layout
  isLongTerm: boolean;
  totalLabel: string;
  emptyText: string;
  color: [number, number, number];
}

/**
 * Generate a Form 8949 PDF report using jsPDF + autoTable.
 * Tax years 2025+ use the digital-asset boxes (G–L), one section per checked box,
 * classified from `walletReporting`. Earlier years keep the plain Part I / Part II layout.
 * Returns the PDF as a Uint8Array for saving via Tauri dialog.
 */
export function exportForm8949PDF(
  sales: SaleRecord[],
  year: number,
  method: AccountingMethod,
  walletMismatchCount?: number,
  walletReporting?: Record<string, WalletReporting>
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

  const useBoxes = year >= DIGITAL_ASSET_BOXES_FIRST_YEAR;
  const pageHeight = doc.internal.pageSize.getHeight();

  // --- Unclassified wallet warning (2025+ boxes) ---
  const unclassified = useBoxes ? getUnclassifiedSaleWallets(sales, walletReporting) : [];
  if (unclassified.length > 0) {
    doc.setFontSize(8);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(180, 100, 0);
    doc.text(`WARNING: ${unclassified.length} wallet(s) not classified as exchange or self-custody: ${unclassified.join(", ")}`, 14, yPos, { maxWidth: pageWidth - 28 });
    yPos += 4;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.5);
    doc.text(
      "Their sales are listed under box I/L (not reported on Form 1099-DA). If an exchange sent you a Form 1099-DA for them, classify the wallet in Settings \u2192 Wallets and export again.",
      14,
      yPos,
      { maxWidth: pageWidth - 28 }
    );
    doc.setTextColor(0, 0, 0);
    yPos += 8;
  }

  const sections: PdfSection[] = useBoxes
    ? groupByBox(sales, walletReporting).map(({ box }) => {
        const info = BOX_INFO[box];
        return {
          title: `Part ${info.part} \u2014 Box ${box} checked: ${info.label}`,
          note: box === "G" || box === "J" ? BASIS_REPORTED_NOTE : undefined,
          include: (d: LotDetail, sale: SaleRecord) => assignBox(d, sale, walletReporting) === box,
          box,
          isLongTerm: info.isLongTerm,
          totalLabel: `Total Box ${box}`,
          emptyText: "",
          color: info.isLongTerm ? [39, 174, 96] : [41, 128, 185],
        };
      })
    : [
        { title: "Part I \u2014 Short-Term Capital Gains and Losses (held one year or less)", include: (d) => !d.isLongTerm, isLongTerm: false, totalLabel: "Total Short-Term", emptyText: "No short-term sales for this period.", color: [41, 128, 185] },
        { title: "Part II \u2014 Long-Term Capital Gains and Losses (held more than one year)", include: (d) => d.isLongTerm, isLongTerm: true, totalLabel: "Total Long-Term", emptyText: "No long-term sales for this period.", color: [39, 174, 96] },
      ];

  if (useBoxes && sections.length === 0) {
    doc.setFontSize(10);
    doc.setFont("helvetica", "italic");
    doc.text("No taxable dispositions for this tax year.", 14, yPos + 5);
    yPos += 12;
  }

  const st = { proceeds: 0, basis: 0, gainLoss: 0 };
  const lt = { proceeds: 0, basis: 0, gainLoss: 0 };
  const lineRows: string[][] = [];

  for (let si = 0; si < sections.length; si++) {
    const section = sections[si];
    // Check if we need a new page
    if (si > 0 && yPos > pageHeight - 40) {
      doc.addPage();
      yPos = 15;
    }
    doc.setFontSize(useBoxes ? 11 : 12);
    doc.setFont("helvetica", "bold");
    doc.text(section.title, 14, yPos);
    yPos += 5;
    if (section.note) {
      doc.setFontSize(7.5);
      doc.setFont("helvetica", "italic");
      const noteLines = doc.splitTextToSize(section.note, pageWidth - 28);
      doc.text(noteLines, 14, yPos);
      yPos += noteLines.length * 3.5 + 1;
    }

    // Build detail rows and totals at the lot-detail level (handles mixed-term / mixed-box sales)
    const rows = buildDetailRows(sales, section.include);
    const totals = computeDetailTotals(sales, section.include);
    const into = section.isLongTerm ? lt : st;
    into.proceeds += totals.proceeds; into.basis += totals.basis; into.gainLoss += totals.gainLoss;
    if (section.box) {
      lineRows.push([`Line ${BOX_INFO[section.box].scheduleDLine} (box ${section.box})`, formatUSD(totals.proceeds), formatUSD(totals.basis), formatUSD(totals.gainLoss)]);
    }

    if (rows.length === 0) {
      doc.setFontSize(10);
      doc.setFont("helvetica", "italic");
      doc.text(section.emptyText, 14, yPos + 5);
      yPos += 12;
    } else {
      autoTable(doc, {
        startY: yPos,
        head: [["Description", "Date Acquired", "Date Sold", "Proceeds", "Cost Basis", "Fees (in Proceeds)", "Gain/(Loss)"]],
        body: rows,
        foot: [buildTotalRowFromDetails(section.totalLabel, totals.proceeds, totals.basis, totals.gainLoss, totals.fees)],
        theme: "striped",
        headStyles: { fillColor: section.color, fontSize: 8 },
        bodyStyles: { fontSize: 8 },
        footStyles: { fillColor: [220, 220, 220], textColor: [0, 0, 0], fontStyle: "bold", fontSize: 8 },
        margin: { left: 14, right: 14 },
        styles: { cellPadding: 2 },
      });
      yPos = (doc as any).lastAutoTable.finalY + 10;
    }
  }

  // Check if we need a new page for summary
  if (yPos > pageHeight - 50) {
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
      ...lineRows,
      ["Short-term (Part I)", formatUSD(st.proceeds), formatUSD(st.basis), formatUSD(st.gainLoss)],
      ["Long-term (Part II)", formatUSD(lt.proceeds), formatUSD(lt.basis), formatUSD(lt.gainLoss)],
    ],
    foot: [["Net Total", formatUSD(st.proceeds + lt.proceeds), formatUSD(st.basis + lt.basis), formatUSD(st.gainLoss + lt.gainLoss)]],
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

/** Build detail rows from ALL sales, keeping the lot details that pass `include` (term or box) */
function buildDetailRows(sales: SaleRecord[], include: DetailFilter): string[][] {
  const rows: string[][] = [];
  for (const sale of sales) {
    const termDetails = sale.lotDetails.filter((d) => include(d, sale));
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
        lotFee = di < termDetails.length - 1 ? Math.round((feeShare * (detail.amountBTC / termBTC)) * 100) / 100 : Math.round(feeRemaining * 100) / 100;
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

/** Compute totals from the lot details that pass `include` (term or box) */
function computeDetailTotals(sales: SaleRecord[], include: DetailFilter): { proceeds: number; basis: number; gainLoss: number; fees: number } {
  let proceeds = 0, basis = 0, gainLoss = 0, fees = 0;
  for (const sale of sales) {
    const termDetails = sale.lotDetails.filter((d) => include(d, sale));
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
