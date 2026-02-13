import { useState, useCallback, DragEvent } from "react";
import { useAppState } from "../lib/app-state";
import { readHeaders, detectColumns, parseCSVContent, parseCSVLine, computeHash } from "../lib/csv-import";
import { ColumnMapping, isMappingValid, requiredFieldsMissing, warningFieldsMissing, isDualColumn } from "../lib/models";
import { TransactionType, TransactionTypeDisplayNames } from "../lib/types";

type ImportStatus = { type: "success"; count: number; skipped: number; duplicates: number } | { type: "error"; message: string };

export function ImportView() {
  const state = useAppState();
  const [isDragOver, setIsDragOver] = useState(false);
  const [exchangeName, setExchangeName] = useState("");
  const [importStatus, setImportStatus] = useState<ImportStatus | null>(null);
  const [detectedHeaders, setDetectedHeaders] = useState<string[]>([]);
  const [mapping, setMapping] = useState<ColumnMapping>({});
  const [showMapping, setShowMapping] = useState(false);
  const [pendingContent, setPendingContent] = useState<string | null>(null);
  const [pendingFileName, setPendingFileName] = useState<string | null>(null);
  const [defaultType, setDefaultType] = useState<TransactionType>(TransactionType.Buy);

  const processFile = useCallback(async (content: string, fileName: string) => {
    setPendingContent(content);
    setPendingFileName(fileName);

    // Check for duplicate import
    const hash = await computeHash(content);
    const existing = state.checkImportHistory(hash);
    if (existing) {
      const proceed = confirm(
        `This file (${existing.fileName}) was previously imported on ${new Date(existing.importDate).toLocaleString()} with ${existing.transactionCount} transactions.\n\nDuplicate transactions will be automatically skipped. Import anyway?`
      );
      if (!proceed) {
        setPendingContent(null);
        setPendingFileName(null);
        return;
      }
    }

    const headers = readHeaders(content);
    if (!headers) {
      setImportStatus({ type: "error", message: "Could not read CSV headers" });
      return;
    }

    setDetectedHeaders(headers);
    const detected = detectColumns(headers);
    if (!detected.type && !isDualColumn(detected)) {
      detected.defaultType = defaultType;
    }
    setMapping(detected);
    setShowMapping(true);
    setImportStatus(null);
  }, [state, defaultType]);

  const handleDrop = useCallback((e: DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (ev) => {
        const content = ev.target?.result as string;
        processFile(content, file.name);
      };
      reader.readAsText(file);
    }
  }, [processFile]);

  const handleFileSelect = useCallback(() => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".csv,.txt";
    input.onchange = (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (file) {
        const reader = new FileReader();
        reader.onload = (ev) => {
          const content = ev.target?.result as string;
          processFile(content, file.name);
        };
        reader.readAsText(file);
      }
    };
    input.click();
  }, [processFile]);

  const handleImport = useCallback(async () => {
    if (!pendingContent) return;

    const finalMapping = { ...mapping };
    if (!finalMapping.type && !isDualColumn(finalMapping)) {
      finalMapping.defaultType = defaultType;
    }

    const exchange = exchangeName || "Unknown";
    const result = parseCSVContent(pendingContent, exchange, finalMapping);

    if (result.transactions.length === 0 && result.skippedRows.length > 0) {
      const reasons = result.skippedRows.slice(0, 3).map((r) => `Row ${r.row}: ${r.reason}`).join("\n");
      setImportStatus({ type: "error", message: `No transactions imported. ${result.skippedRows.length} rows skipped.\n${reasons}` });
      return;
    }

    const dedup = state.addTransactionsDeduped(result.transactions);
    setImportStatus({ type: "success", count: dedup.added, skipped: result.skippedRows.length, duplicates: dedup.duplicates });

    // Record import
    const hash = await computeHash(pendingContent);
    state.recordImport(hash, pendingFileName || "unknown.csv", dedup.added);

    // Save mapping
    if (exchange !== "Unknown") {
      const mappings = state.loadMappings();
      mappings[exchange] = finalMapping;
      state.saveMappings(mappings);
    }

    setPendingContent(null);
    setPendingFileName(null);
    setShowMapping(false);
  }, [pendingContent, mapping, exchangeName, defaultType, state, pendingFileName]);

  const updateMapping = (key: keyof ColumnMapping, value: string | null) => {
    setMapping((m) => ({ ...m, [key]: value || undefined }));
  };

  return (
    <div className="p-8 max-w-4xl">
      <div className="text-center mb-6">
        <h1 className="text-3xl font-bold mb-2">Import Transactions</h1>
        <p className="text-gray-500">Import CSV files from any exchange</p>
      </div>

      {/* Drop Zone */}
      <div
        className={`border-2 border-dashed rounded-xl p-12 text-center mb-6 transition-colors cursor-pointer ${
          isDragOver ? "border-orange-500 bg-orange-50 dark:bg-orange-900/10" : "border-gray-300 dark:border-gray-600"
        }`}
        onDragOver={(e) => { e.preventDefault(); setIsDragOver(true); }}
        onDragLeave={() => setIsDragOver(false)}
        onDrop={handleDrop}
        onClick={handleFileSelect}
      >
        <div className="text-4xl mb-3">{isDragOver ? "📂" : "📤"}</div>
        <p className="font-semibold mb-1">{pendingFileName || "Drop CSV file here"}</p>
        <p className="text-gray-400 text-sm mb-3">or</p>
        <button className="btn-secondary">Browse Files...</button>
      </div>

      {/* Exchange name */}
      <div className="flex items-center gap-3 mb-6">
        <span className="text-gray-500">Exchange Name (optional):</span>
        <input
          className="input w-64"
          placeholder="e.g., Coinbase, Swan, Strike"
          value={exchangeName}
          onChange={(e) => setExchangeName(e.target.value)}
        />
      </div>

      {/* Column Mapping */}
      {showMapping && (
        <div className="card mb-6">
          <h3 className="font-semibold mb-2">Column Mapping</h3>
          <p className="text-sm text-gray-500 mb-1">
            Columns in your file:{" "}
            {detectedHeaders.map((h, i) => {
              const mappedValues = Object.values(mapping).filter(Boolean);
              const isMapped = mappedValues.includes(h);
              return (
                <span key={h}>
                  {i > 0 && ", "}
                  <span className={isMapped
                    ? "font-medium text-green-600 dark:text-green-400"
                    : "font-medium text-orange-500 dark:text-orange-400"
                  }>
                    {h}{!isMapped && " (unmapped)"}
                  </span>
                </span>
              );
            })}
          </p>
          <p className="text-sm text-gray-500 mb-4">
            Match each field below to the correct column from your CSV. Fields marked <span className="text-red-500 font-semibold">*</span> are required. If a field was auto-detected, it's already filled in — just verify it looks right.
          </p>

          <MappingRow
            label="Date *"
            tooltip="The date the transaction occurred"
            value={mapping.date} field="date" headers={detectedHeaders} onChange={updateMapping}
          />
          <MappingRow
            label="Type"
            tooltip="Buy or Sell (or Send/Receive for transfers)"
            value={mapping.type} field="type" headers={detectedHeaders} onChange={updateMapping}
          />
          <MappingRow
            label="Amount *"
            tooltip="The BTC quantity — how much Bitcoin, not the dollar value"
            value={mapping.amount} field="amount" headers={detectedHeaders} onChange={updateMapping}
          />
          <MappingRow
            label="Price"
            tooltip="The USD price of one Bitcoin at the time of the transaction"
            value={mapping.price} field="price" headers={detectedHeaders} onChange={updateMapping}
          />
          <MappingRow
            label="Total"
            tooltip="The total USD value of the transaction (Amount × Price)"
            value={mapping.total} field="total" headers={detectedHeaders} onChange={updateMapping}
          />
          <MappingRow
            label="Fee"
            tooltip="Trading fees or commissions charged (optional — defaults to zero)"
            value={mapping.fee} field="fee" headers={detectedHeaders} onChange={updateMapping}
          />
          <MappingRow
            label="Wallet"
            tooltip="Which wallet or sub-account this transaction belongs to (optional)"
            value={mapping.wallet} field="wallet" headers={detectedHeaders} onChange={updateMapping}
          />
          <MappingRow
            label="Exchange"
            tooltip="The exchange or platform where the transaction happened (optional)"
            value={mapping.exchange} field="exchange" headers={detectedHeaders} onChange={updateMapping}
          />
          <MappingRow
            label="Notes"
            tooltip="Any extra notes or description for the transaction (optional)"
            value={mapping.notes} field="notes" headers={detectedHeaders} onChange={updateMapping}
          />

          {/* Default type if no type column */}
          {!mapping.type && !isDualColumn(mapping) && (
            <div className="flex items-center gap-3 mt-4 p-3 bg-orange-50 dark:bg-orange-900/20 rounded-lg">
              <span className="text-orange-500">ℹ️</span>
              <span className="text-sm text-gray-600 dark:text-gray-400">No Type column mapped. Default type:</span>
              <select
                className="select"
                value={defaultType}
                onChange={(e) => setDefaultType(e.target.value as TransactionType)}
              >
                {Object.values(TransactionType).map((t) => (
                  <option key={t} value={t}>{TransactionTypeDisplayNames[t]}</option>
                ))}
              </select>
            </div>
          )}

          {/* Price/Total warning */}
          {warningFieldsMissing(mapping).length > 0 && (
            <div className="flex items-start gap-2 mt-4 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
              <span className="text-red-500 text-lg leading-none mt-0.5">⚠️</span>
              <div>
                <p className="text-red-600 dark:text-red-400 font-semibold text-sm">Neither Price nor Total is mapped</p>
                <p className="text-red-500 dark:text-red-400 text-sm mt-0.5">
                  All transactions will import with $0 USD values, causing incorrect tax calculations. Please map your Price or Total column above.
                </p>
              </div>
            </div>
          )}

          {/* Validation */}
          {requiredFieldsMissing(mapping).length > 0 ? (
            <div className="flex items-center gap-2 mt-4 text-red-500 text-sm">
              <span>⚠️</span>
              <span>Missing required fields: {requiredFieldsMissing(mapping).join(", ")}</span>
            </div>
          ) : (
            <div className="flex items-center gap-2 mt-4 text-green-500 text-sm">
              <span>✅</span>
              <span>All required fields mapped. Ready to import.</span>
            </div>
          )}
        </div>
      )}

      {/* Data Preview */}
      {showMapping && pendingContent && (
        <DataPreview content={pendingContent} headers={detectedHeaders} mapping={mapping} />
      )}

      {/* Import Button */}
      {pendingContent && isMappingValid(mapping) && (
        <div className="text-center mb-6">
          <button className="btn-primary text-lg px-8 py-3" onClick={handleImport}>
            📥 Import Transactions
          </button>
        </div>
      )}

      {/* Status */}
      {importStatus && (
        <div className={`p-4 rounded-lg mb-6 ${importStatus.type === "success" ? "bg-green-50 dark:bg-green-900/20" : "bg-red-50 dark:bg-red-900/20"}`}>
          {importStatus.type === "success" ? (
            <div className="flex items-center gap-2">
              <span className="text-green-500">✅</span>
              <span className="font-medium">Imported {importStatus.count} transactions</span>
              {importStatus.duplicates > 0 && <span className="text-orange-500">({importStatus.duplicates} duplicates skipped)</span>}
              {importStatus.skipped > 0 && <span className="text-gray-500">({importStatus.skipped} rows skipped)</span>}
            </div>
          ) : (
            <div className="flex items-center gap-2 text-red-500">
              <span>⚠️</span>
              <span style={{ whiteSpace: "pre-line" }}>{importStatus.message}</span>
            </div>
          )}
        </div>
      )}

      {/* Transaction count */}
      {state.transactions.length > 0 && (
        <div className="flex items-center justify-between pt-4 border-t border-gray-200 dark:border-gray-700">
          <span className="text-gray-500 text-sm">📄 {state.transactions.length} transactions loaded</span>
          <button className="btn-danger text-sm" onClick={() => { state.clearAllData(); setImportStatus(null); }}>
            Clear All
          </button>
        </div>
      )}
    </div>
  );
}

function MappingRow({
  label, tooltip, value, field, headers, onChange,
}: {
  label: string; tooltip?: string; value?: string; field: string; headers: string[];
  onChange: (key: any, value: string | null) => void;
}) {
  return (
    <div className="flex items-center gap-3 py-2 border-b border-gray-100 dark:border-gray-800">
      <span className="w-24 font-medium text-sm flex-shrink-0 mapping-label" title={tooltip}>
        {label}
        {tooltip && <span className="ml-1 text-gray-400 text-xs cursor-help">ⓘ</span>}
      </span>
      <select
        className="select w-56"
        value={value || ""}
        onChange={(e) => onChange(field, e.target.value || null)}
      >
        <option value="">— Not mapped —</option>
        {headers.map((h) => (
          <option key={h} value={h}>{h}</option>
        ))}
      </select>
      <span>{value ? "✅" : "⚪"}</span>
    </div>
  );
}

function DataPreview({ content, headers, mapping }: {
  content: string; headers: string[]; mapping: ColumnMapping;
}) {
  // Parse first 3 data rows
  const lines = content.startsWith("\uFEFF") ? content.slice(1) : content;
  const allLines = lines.split(/\r?\n/).filter((l) => l.trim());
  if (allLines.length <= 1) return null;

  // Find header line index (first line with known columns)
  let headerIdx = 0;
  const headerFields = parseCSVLine(allLines[0]);
  const headersLower = headerFields.map((h) => h.toLowerCase().trim());
  for (let i = 0; i < allLines.length; i++) {
    const fields = parseCSVLine(allLines[i]);
    const fieldsLower = fields.map((f) => f.toLowerCase().trim());
    if (fieldsLower.some((f) => headers.map((h) => h.toLowerCase().trim()).includes(f))) {
      headerIdx = i;
      break;
    }
  }

  const dataLines = allLines.slice(headerIdx + 1, headerIdx + 4);
  if (dataLines.length === 0) return null;

  // Build header-to-index map
  const parsedHeaders = parseCSVLine(allLines[headerIdx]);
  const headerIndex: Record<string, number> = {};
  parsedHeaders.forEach((h, i) => { headerIndex[h] = i; });

  // Define which columns to show
  const previewCols: { label: string; key: keyof ColumnMapping; isUSD: boolean }[] = [
    { label: "Date", key: "date", isUSD: false },
    { label: "Type", key: "type", isUSD: false },
    { label: "Amount", key: "amount", isUSD: false },
    { label: "Price", key: "price", isUSD: true },
    { label: "Total", key: "total", isUSD: true },
    { label: "Fee", key: "fee", isUSD: true },
  ];

  const activeCols = previewCols.filter((c) => mapping[c.key]);

  // Parse rows
  const rows = dataLines.map((line) => {
    const fields = parseCSVLine(line);
    return activeCols.map((col) => {
      const mappedHeader = mapping[col.key] as string;
      const idx = headerIndex[mappedHeader];
      const raw = idx !== undefined && idx < fields.length ? fields[idx] : "";
      return { raw, isUSD: col.isUSD };
    });
  });

  const formatCell = (raw: string, isUSD: boolean) => {
    if (!raw.trim()) return "—";
    if (!isUSD) return raw;
    const cleaned = raw.replace(/[$,]/g, "").trim();
    const num = Number(cleaned);
    if (isNaN(num)) return raw;
    return `$${num.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  };

  const isZeroUSD = (raw: string, isUSD: boolean) => {
    if (!isUSD) return false;
    const cleaned = raw.replace(/[$,]/g, "").trim();
    const num = Number(cleaned);
    return !isNaN(num) && num === 0;
  };

  return (
    <div className="card mb-6">
      <h3 className="font-semibold mb-1 text-sm">Data Preview</h3>
      <p className="text-xs text-gray-500 mb-3">First {rows.length} row{rows.length !== 1 ? "s" : ""} with your current mapping — verify this looks correct before importing.</p>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200 dark:border-gray-700">
              {activeCols.map((col) => (
                <th key={col.key} className="text-left py-1.5 px-2 text-xs font-semibold text-gray-500 uppercase tracking-wider">{col.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, ri) => (
              <tr key={ri} className="border-b border-gray-100 dark:border-gray-800">
                {row.map((cell, ci) => (
                  <td
                    key={ci}
                    className={`py-1.5 px-2 font-mono text-xs ${
                      isZeroUSD(cell.raw, cell.isUSD)
                        ? "text-orange-500 font-semibold bg-orange-50 dark:bg-orange-900/20"
                        : "text-gray-700 dark:text-gray-300"
                    }`}
                  >
                    {formatCell(cell.raw, cell.isUSD)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
