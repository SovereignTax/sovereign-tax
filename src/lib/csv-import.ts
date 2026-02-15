import { TransactionType, parseTransactionType, parseIncomeType } from "./types";
import {
  Transaction,
  ColumnMapping,
  createTransaction,
  isDualColumn,
} from "./models";

export interface CSVImportResult {
  transactions: Transaction[];
  skippedRows: { row: number; reason: string }[];
  detectedMapping: ColumnMapping;
  headers: string[];
}

// Column name variations for auto-detection
const columnVariations: Record<string, string[]> = {
  date: ["date", "timestamp", "time", "datetime", "transaction date", "trade date", "created at"],
  type: ["type", "transaction type", "side", "trade type", "action", "transaction_type", "tag"],
  amount: [
    "amount", "quantity", "size", "btc amount", "bitcoin", "btc", "volume",
    "asset amount", "net amount", "quantity transacted",
    "amount (btc)", "amount btc", "quantity (btc)",
  ],
  price: [
    "price", "price per btc", "rate", "unit price", "btc price", "price usd",
    "spot price", "asset price", "price at transaction",
    "spot price at transaction", "usd spot price at transaction",
    "price (usd)", "price (btc)", "unit price (usd)",
  ],
  total: [
    "total", "total usd", "usd total", "value", "total value", "subtotal",
    "total (inclusive of fees and/or spread)", "usd amount",
    "usd total (inclusive of fees)", "usd subtotal",
    "total (usd)",
  ],
  fee: [
    "fee", "fees", "commission", "spread", "trading fee", "transaction fee",
    "fee amount", "fee (usd)", "fee usd", "total fee",
  ],
  wallet: ["wallet", "wallet name", "sub-account", "sub account"],
  exchange: ["exchange", "source", "platform", "venue", "account", "portfolio"],
  notes: ["notes", "description", "memo", "comment", "specification"],
  asset: ["asset", "asset type", "symbol", "size unit", "product"],
  receivedQuantity: ["received quantity", "received amount"],
  receivedCurrency: ["received currency"],
  sentQuantity: ["sent quantity", "sent amount"],
  sentCurrency: ["sent currency"],
};

// Date formats
const dateFormats = [
  "yyyy-MM-dd",
  "MM/dd/yyyy",
  "dd/MM/yyyy",
  "yyyy-MM-dd HH:mm:ss",
  "MM/dd/yyyy HH:mm:ss",
  "yyyy-MM-ddTHH:mm:ss",
  "yyyy-MM-ddTHH:mm:ssZ",
  "yyyy-MM-ddTHH:mm:ss.SSS",
  "yyyy-MM-ddTHH:mm:ss.SSSZ",
  "yyyy-MM-dd HH:mm:ss zzz",
];

/** Parse a CSV line handling quoted fields (RFC 4180: escaped quotes via "") */
export function parseCSVLine(line: string): string[] {
  const fields: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (inQuotes) {
      if (char === '"') {
        if (i + 1 < line.length && line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        current += char;
      }
    } else {
      if (char === '"') {
        inQuotes = true;
      } else if (char === ",") {
        fields.push(current.trim());
        current = "";
      } else {
        current += char;
      }
    }
  }
  fields.push(current.trim());
  return fields;
}

/** Parse a date string trying multiple formats */
export function parseDate(dateStr: string): Date | null {
  let trimmed = dateStr.trim();
  if (!trimmed) return null;

  // Try ISO 8601 first (most common)
  const isoDate = new Date(trimmed);
  if (!isNaN(isoDate.getTime())) return isoDate;

  // Handle " UTC" suffix (Gemini)
  if (trimmed.endsWith(" UTC")) {
    const withoutUTC = trimmed.slice(0, -4);
    const utcDate = new Date(withoutUTC + "Z");
    if (!isNaN(utcDate.getTime())) return utcDate;
    // Try without Z
    const utcDate2 = new Date(withoutUTC);
    if (!isNaN(utcDate2.getTime())) return utcDate2;
  }

  // Strip timezone abbreviation (CST, EST, etc)
  const withoutTZ = trimmed.replace(/\s+[A-Z]{2,5}$/, "");
  if (withoutTZ !== trimmed) {
    const tzDate = new Date(withoutTZ);
    if (!isNaN(tzDate.getTime())) return tzDate;
  }

  // Try MM/dd/yyyy formats
  const mdyMatch = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(.*)$/);
  if (mdyMatch) {
    const [, month, day, year, rest] = mdyMatch;
    const isoStr = `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}${rest.trim() ? "T" + rest.trim() : ""}`;
    const mdyDate = new Date(isoStr);
    if (!isNaN(mdyDate.getTime())) return mdyDate;
  }

  return null;
}

/** Parse a decimal number from string, handling $, commas, etc */
export function parseDecimal(str: string): number | null {
  const cleaned = str
    .trim()
    .replace(/\$/g, "")
    .replace(/,/g, "")
    .replace(/\s/g, "");
  if (!cleaned) return 0;
  const num = Number(cleaned);
  return isNaN(num) ? null : num;
}

/** Detect column mappings from headers */
export function detectColumns(headers: string[]): ColumnMapping {
  const headersLower = headers.map((h) => h.toLowerCase().trim());
  const mapping: ColumnMapping = {};

  // Pass 1: Match known column variations
  for (const [field, variations] of Object.entries(columnVariations)) {
    for (const variation of variations) {
      const idx = headersLower.indexOf(variation);
      if (idx !== -1) {
        const original = headers[idx];
        switch (field) {
          case "date": mapping.date = original; break;
          case "type": mapping.type = original; break;
          case "amount": mapping.amount = original; break;
          case "price": mapping.price = original; break;
          case "total": mapping.total = original; break;
          case "fee": mapping.fee = original; break;
          case "wallet": mapping.wallet = original; break;
          case "exchange": mapping.exchange = original; break;
          case "notes": mapping.notes = original; break;
          case "asset": mapping.asset = original; break;
          case "receivedQuantity": mapping.receivedQuantity = original; break;
          case "receivedCurrency": mapping.receivedCurrency = original; break;
          case "sentQuantity": mapping.sentQuantity = original; break;
          case "sentCurrency": mapping.sentCurrency = original; break;
        }
        break;
      }
    }
  }

  // Pass 2: Prefer "Asset Amount" / "Asset Price" over generic when both exist
  const headersLowerSet = new Set(headersLower);

  if (headersLowerSet.has("asset amount")) {
    const idx = headersLower.indexOf("asset amount");
    if (idx !== -1) {
      const previousAmount = mapping.amount;
      mapping.amount = headers[idx];
      if (previousAmount && previousAmount !== headers[idx] && !mapping.total) {
        mapping.total = previousAmount;
      }
    }
  }

  if (headersLowerSet.has("asset price")) {
    const idx = headersLower.indexOf("asset price");
    if (idx !== -1) {
      mapping.price = headers[idx];
    }
  }

  // Pass 3: Handle Coinbase legacy "USD " prefixed columns
  for (let i = 0; i < headers.length; i++) {
    const lower = headers[i].toLowerCase().trim();
    if (!lower.startsWith("usd ")) continue;
    const stripped = lower.slice(4);
    for (const [field, variations] of Object.entries(columnVariations)) {
      if (variations.includes(stripped)) {
        const original = headers[i];
        if (field === "price" && !mapping.price) mapping.price = original;
        if (field === "total" && !mapping.total) mapping.total = original;
        break;
      }
    }
  }

  // Pass 4: Normalize parenthetical headers — "Price (USD)" → "price usd"
  // This catches any parenthetical format not explicitly listed in variations
  for (let i = 0; i < headers.length; i++) {
    const lower = headersLower[i];
    // Skip if no parentheses
    if (!lower.includes("(")) continue;
    // Normalize: strip parens, collapse whitespace
    const normalized = lower.replace(/[()]/g, "").replace(/\s+/g, " ").trim();
    if (normalized === lower) continue;

    for (const [field, variations] of Object.entries(columnVariations)) {
      // Skip fields already mapped
      const mappedKey = field as keyof ColumnMapping;
      if (mapping[mappedKey]) continue;

      if (variations.includes(normalized)) {
        const original = headers[i];
        switch (field) {
          case "date": mapping.date = original; break;
          case "type": mapping.type = original; break;
          case "amount": mapping.amount = original; break;
          case "price": mapping.price = original; break;
          case "total": mapping.total = original; break;
          case "fee": mapping.fee = original; break;
          case "wallet": mapping.wallet = original; break;
          case "exchange": mapping.exchange = original; break;
          case "notes": mapping.notes = original; break;
          case "asset": mapping.asset = original; break;
          case "receivedQuantity": mapping.receivedQuantity = original; break;
          case "receivedCurrency": mapping.receivedCurrency = original; break;
          case "sentQuantity": mapping.sentQuantity = original; break;
          case "sentCurrency": mapping.sentCurrency = original; break;
        }
        break;
      }
    }
  }

  return mapping;
}

/** Find the header row index, skipping metadata/preamble rows */
function findHeaderLineIndex(lines: string[]): number {
  const allKnownColumns = new Set<string>();
  for (const variations of Object.values(columnVariations)) {
    for (const v of variations) allKnownColumns.add(v);
  }

  for (let idx = 0; idx < lines.length; idx++) {
    const fields = parseCSVLine(lines[idx]);
    if (fields.length >= 3) {
      const fieldsLower = fields.map((f) => f.toLowerCase().trim());
      const matchCount = fieldsLower.filter((f) => {
        if (allKnownColumns.has(f)) return true;
        // Also try normalizing parenthetical headers: "price (usd)" → "price usd"
        if (f.includes("(")) {
          const normalized = f.replace(/[()]/g, "").replace(/\s+/g, " ").trim();
          return allKnownColumns.has(normalized);
        }
        return false;
      }).length;
      if (matchCount >= 1) return idx;
    }
  }
  return 0;
}

/** Find the asset column for BTC-only filtering */
function findAssetColumn(headers: string[]): string | null {
  const assetVariations = ["asset", "asset type", "symbol", "size unit", "product"];
  for (const header of headers) {
    if (assetVariations.includes(header.toLowerCase().trim())) {
      return header;
    }
  }
  return null;
}

/** Find the status column for completed-only filtering */
function findStatusColumn(headers: string[]): string | null {
  return headers.find((h) => h.toLowerCase().trim() === "status") || null;
}

/** Read headers from CSV content */
export function readHeaders(content: string): string[] | null {
  const cleaned = content.startsWith("\uFEFF") ? content.slice(1) : content;
  const lines = cleaned.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length === 0) return null;
  const headerIdx = findHeaderLineIndex(lines);
  return parseCSVLine(lines[headerIdx]);
}

/** Parse CSV content into transactions */
export function parseCSVContent(
  content: string,
  exchangeName: string,
  mapping: ColumnMapping
): CSVImportResult {
  const cleaned = content.startsWith("\uFEFF") ? content.slice(1) : content;
  const lines = cleaned.split(/\r?\n/).filter((l) => l.trim());

  if (lines.length <= 1) {
    return { transactions: [], skippedRows: [], detectedMapping: mapping, headers: [] };
  }

  const headerIdx = findHeaderLineIndex(lines);
  const headers = parseCSVLine(lines[headerIdx]);
  const dataLines = lines.slice(headerIdx + 1);
  const transactions: Transaction[] = [];
  const skippedRows: { row: number; reason: string }[] = [];
  const assetCol = findAssetColumn(headers);
  const statusCol = findStatusColumn(headers);

  for (let lineIdx = 0; lineIdx < dataLines.length; lineIdx++) {
    const rowNum = headerIdx + lineIdx + 2;
    const fields = parseCSVLine(dataLines[lineIdx]);

    if (fields.length < 1) {
      skippedRows.push({ row: rowNum, reason: "Empty row" });
      continue;
    }

    // Build row dict
    const row: Record<string, string> = {};
    for (let i = 0; i < headers.length; i++) {
      row[headers[i]] = i < fields.length ? fields[i] : "";
    }

    // Asset filtering
    if (assetCol && row[assetCol]) {
      const assetUpper = row[assetCol].toUpperCase().trim();
      if (assetUpper && !assetUpper.includes("BTC") && !assetUpper.includes("XBT")) {
        skippedRows.push({ row: rowNum, reason: `Non-BTC asset: ${row[assetCol]}` });
        continue;
      }
    }

    // Status filtering
    if (statusCol && row[statusCol]) {
      const statusLower = row[statusCol].toLowerCase().trim();
      if (statusLower && statusLower !== "completed" && statusLower !== "complete" && statusLower !== "success") {
        skippedRows.push({ row: rowNum, reason: `Status: ${row[statusCol]}` });
        continue;
      }
    }

    try {
      const trans = parseTransaction(row, mapping, exchangeName);
      transactions.push(trans);
    } catch (e: any) {
      skippedRows.push({ row: rowNum, reason: e.message || "Parse error" });
    }
  }

  return { transactions, skippedRows, detectedMapping: mapping, headers };
}

function parseTransaction(
  row: Record<string, string>,
  mapping: ColumnMapping,
  exchange: string
): Transaction {
  // Date
  const dateCol = mapping.date;
  if (!dateCol || !row[dateCol]?.trim()) throw new Error("Missing date");
  const date = parseDate(row[dateCol]);
  if (!date) throw new Error(`Unable to parse date: ${row[dateCol]}`);

  if (isDualColumn(mapping)) {
    return parseDualColumnTransaction(row, mapping, date, exchange);
  }
  return parseStandardTransaction(row, mapping, date, exchange);
}

function parseDualColumnTransaction(
  row: Record<string, string>,
  mapping: ColumnMapping,
  date: Date,
  exchange: string
): Transaction {
  const rcvQty = parseDecimal(row[mapping.receivedQuantity!] || "") ?? 0;
  const rcvCurrency = (row[mapping.receivedCurrency!] || "").trim().toUpperCase();
  const sntQty = parseDecimal(row[mapping.sentQuantity!] || "") ?? 0;
  const sntCurrency = (row[mapping.sentCurrency!] || "").trim().toUpperCase();

  // Determine type
  let transType: TransactionType;
  if (mapping.type && row[mapping.type]?.trim()) {
    const parsed = parseTransactionType(row[mapping.type]);
    if (parsed) { transType = parsed; } else { transType = mapping.defaultType || TransactionType.Buy; }
  } else if (rcvCurrency === "BTC" && sntQty === 0) {
    transType = TransactionType.TransferIn;
  } else if (sntCurrency === "BTC" && rcvQty === 0) {
    transType = TransactionType.TransferOut;
  } else if (rcvCurrency === "BTC" && ["USD", "USDT", "USDC"].includes(sntCurrency)) {
    transType = TransactionType.Buy;
  } else if (sntCurrency === "BTC" && ["USD", "USDT", "USDC"].includes(rcvCurrency)) {
    transType = TransactionType.Sell;
  } else if (rcvCurrency === "BTC") {
    transType = TransactionType.Buy;
  } else if (sntCurrency === "BTC") {
    transType = TransactionType.Sell;
  } else {
    transType = mapping.defaultType || TransactionType.Buy;
  }

  // Parse fee
  let fee = 0;
  if (mapping.fee && row[mapping.fee]?.trim()) {
    fee = Math.abs(parseDecimal(row[mapping.fee]) ?? 0);
  }

  let amountBTC: number, totalUSD: number, pricePerBTC: number;
  if (transType === TransactionType.Buy || transType === TransactionType.TransferIn) {
    amountBTC = Math.abs(rcvQty);
    totalUSD = Math.abs(sntQty);
  } else {
    amountBTC = Math.abs(sntQty);
    totalUSD = Math.abs(rcvQty);
  }

  // Apply fee: buys increase cost basis, sells reduce proceeds
  if (fee > 0) {
    if (transType === TransactionType.Buy) {
      totalUSD = totalUSD + fee;
    } else if (transType === TransactionType.Sell) {
      totalUSD = Math.max(0, totalUSD - fee);
    }
  }

  pricePerBTC = amountBTC > 0 && totalUSD > 0 ? totalUSD / amountBTC : 0;

  if (amountBTC <= 0) throw new Error("BTC amount is zero");

  const notes = mapping.notes && row[mapping.notes] ? row[mapping.notes] : "";
  let finalExchange = exchange;
  if (mapping.exchange && row[mapping.exchange]?.trim()) {
    finalExchange = row[mapping.exchange];
  }

  // Wallet
  let wallet: string | undefined;
  if (mapping.wallet && row[mapping.wallet]?.trim()) {
    wallet = row[mapping.wallet].trim();
  }

  // Income classification
  const typeStr = mapping.type && row[mapping.type]?.trim() ? row[mapping.type].trim() : "";
  const incomeType = typeStr ? parseIncomeType(typeStr) : undefined;

  return createTransaction({
    date: date.toISOString(),
    transactionType: transType,
    amountBTC,
    pricePerBTC,
    totalUSD,
    fee: fee > 0 ? fee : undefined,
    exchange: finalExchange,
    wallet: wallet || finalExchange,
    incomeType: incomeType || undefined,
    notes,
  });
}

function parseStandardTransaction(
  row: Record<string, string>,
  mapping: ColumnMapping,
  date: Date,
  exchange: string
): Transaction {
  // Type
  let transType: TransactionType;
  if (mapping.type && row[mapping.type]?.trim()) {
    const parsed = parseTransactionType(row[mapping.type]);
    if (!parsed) throw new Error(`Unknown transaction type: ${row[mapping.type]}`);
    transType = parsed;
  } else {
    transType = mapping.defaultType || TransactionType.Buy;
  }

  // Amount
  if (!mapping.amount || !row[mapping.amount]?.trim()) throw new Error("Missing amount");
  const amountBTC = parseDecimal(row[mapping.amount]);
  if (amountBTC === null || amountBTC === 0) throw new Error(`Invalid number: ${row[mapping.amount]}`);

  // Price
  let price = 0;
  if (mapping.price && row[mapping.price]?.trim()) {
    price = parseDecimal(row[mapping.price]) ?? 0;
  }

  // Total
  let total = 0;
  if (mapping.total && row[mapping.total]?.trim()) {
    total = Math.abs(parseDecimal(row[mapping.total]) ?? 0);
  }

  // Parse fee
  let fee = 0;
  if (mapping.fee && row[mapping.fee]?.trim()) {
    fee = Math.abs(parseDecimal(row[mapping.fee]) ?? 0);
  }

  // Calculate missing values
  if (total === 0 && price > 0 && Math.abs(amountBTC) > 0) {
    total = Math.abs(amountBTC) * price;
  }
  if (price === 0 && total > 0 && Math.abs(amountBTC) > 0) {
    price = total / Math.abs(amountBTC);
  }

  // Apply fee to total: for buys, fee increases cost basis; for sells, fee reduces proceeds
  if (fee > 0) {
    if (transType === TransactionType.Buy) {
      total = total + fee;
    } else if (transType === TransactionType.Sell) {
      total = Math.max(0, total - fee);
    }
    // Recalculate effective price per BTC after fee adjustment
    if (Math.abs(amountBTC) > 0) {
      price = total / Math.abs(amountBTC);
    }
  }

  const notes = mapping.notes && row[mapping.notes] ? row[mapping.notes] : "";
  let finalExchange = exchange;
  if (mapping.exchange && row[mapping.exchange]?.trim()) {
    finalExchange = row[mapping.exchange];
  }

  // Wallet
  let wallet: string | undefined;
  if (mapping.wallet && row[mapping.wallet]?.trim()) {
    wallet = row[mapping.wallet].trim();
  }

  // Income classification
  const typeStr = mapping.type && row[mapping.type]?.trim() ? row[mapping.type].trim() : "";
  const incomeType = typeStr ? parseIncomeType(typeStr) : undefined;

  return createTransaction({
    date: date.toISOString(),
    transactionType: transType,
    amountBTC: Math.abs(amountBTC),
    pricePerBTC: price,
    totalUSD: total,
    fee: fee > 0 ? fee : undefined,
    exchange: finalExchange,
    wallet: wallet || finalExchange,
    incomeType: incomeType || undefined,
    notes,
  });
}

/** Compute SHA-256 hash of a string */
export async function computeHash(content: string): Promise<string> {
  const data = new TextEncoder().encode(content);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}
