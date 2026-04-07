import React, { createContext, useContext, useState, useCallback, useEffect, useRef } from "react";
import { Transaction, SaleRecord, ColumnMapping, ImportRecord, Preferences } from "./models";
import { AccountingMethod, TransactionType } from "./types";
import { calculate, simulateSale as simSale, resolveRecordedSales, LotSelection } from "./cost-basis";
import { fetchBTCPrice, fetchHistoricalPrice } from "./price-service";
import { transactionNaturalKey } from "./utils";
import * as persistence from "./persistence";
import { computeHash } from "./csv-import";
import { deriveEncryptionKey, generateSalt, hashPINWithPBKDF2 } from "./crypto";
import { AuditEntry, AuditAction, createAuditEntry } from "./audit";
import { createBackupBundle, parseBackupBundle, saveBackupToAppData } from "./backup";

interface PriceState {
  currentPrice: number | null;
  lastUpdated: Date | null;
  isLoading: boolean;
  error: string | null;
}

/**
 * Pure function: determines whether a transaction update contains material changes
 * that should invalidate a linked Specific ID election.
 * Material fields: amountBTC, date, pricePerBTC, totalUSD, wallet, transactionType.
 * Non-material fields: notes, exchange, incomeType.
 * BTC compared as integer satoshis, USD as integer cents — eliminates IEEE 754 edge cases.
 */
export function isMaterialChange(
  original: Transaction,
  updates: Partial<Omit<Transaction, "id">>
): boolean {
  const btcDiff = (a: number, b: number) => Math.round(a * 1e8) !== Math.round(b * 1e8);
  const usdDiff = (a: number, b: number) => Math.round(a * 100) !== Math.round(b * 100);
  const norm = (s: string | undefined) => (s || "").trim().toLowerCase();
  return (
    (updates.amountBTC !== undefined && btcDiff(updates.amountBTC, original.amountBTC)) ||
    (updates.date !== undefined && updates.date !== original.date) ||
    (updates.pricePerBTC !== undefined && usdDiff(updates.pricePerBTC, original.pricePerBTC)) ||
    (updates.totalUSD !== undefined && usdDiff(updates.totalUSD, original.totalUSD)) ||
    (updates.wallet !== undefined && norm(updates.wallet) !== norm(original.wallet)) ||
    ("sourceWallet" in updates && norm(updates.sourceWallet) !== norm(original.sourceWallet)) ||
    (updates.transactionType !== undefined && updates.transactionType !== original.transactionType)
  );
}

// findStaleDownstreamRecords was removed in v1.4.7.
// TransferIn edits no longer proactively delete downstream Specific ID elections.
// The engine's extractLotSelections() safety net handles stale elections at calc time:
// missing lots → returns null → FIFO fallback with user-facing warning.
// The old wallet-scoped invalidation was too broad — it wiped elections on unrelated
// sales just because they happened to be in the same wallet as the transfer endpoints.

/** Session-only saved lot selections from Simulation → Record Sale / Add Transaction */
export interface SavedLotSelections {
  lotSelections: LotSelection[];
  amountBTC: number;
  wallet: string; // "" means all wallets
  method: AccountingMethod;
  savedAt: string; // ISO timestamp
}

interface AppStateContextType {
  // Data
  transactions: Transaction[];
  recordedSales: SaleRecord[];
  importHistory: Record<string, ImportRecord>;
  auditLog: AuditEntry[];

  // UI state
  selectedNav: string;
  setSelectedNav: (nav: string) => void;
  selectedYear: number;
  setSelectedYear: (year: number) => void;
  selectedMethod: AccountingMethod;
  setSelectedMethod: (method: AccountingMethod) => void;
  appearanceMode: string | null;
  setAppearanceMode: (mode: string | null) => void;
  privacyBlur: boolean;
  setPrivacyBlur: (blur: boolean) => void;
  selectedWallet: string | null;
  setSelectedWallet: (wallet: string | null) => void;
  livePriceEnabled: boolean;
  setLivePriceEnabled: (enabled: boolean) => void;
  priorCarryforwardST: number;
  setPriorCarryforwardST: (amount: number) => void;
  priorCarryforwardLT: number;
  setPriorCarryforwardLT: (amount: number) => void;
  txnSortField: string;
  setTxnSortField: (field: string) => void;
  txnSortAsc: boolean;
  setTxnSortAsc: (asc: boolean) => void;
  reconciliationDecisions: Record<string, "approved" | "rejected">;
  setReconciliationDecision: (pairKey: string, decision: "approved" | "rejected" | null) => void;
  manualTransferMatches: Array<{ outId: string; inId: string }>;
  addManualTransferMatch: (match: { outId: string; inId: string }) => void;
  removeManualTransferMatch: (outId: string, inId: string) => void;

  // Session-only: saved lot selections from Simulation
  savedLotSelections: SavedLotSelections | null;
  setSavedLotSelections: (saved: SavedLotSelections | null) => void;

  // Security
  isUnlocked: boolean;
  setIsUnlocked: (unlocked: boolean) => void;
  unlockWithPIN: (pin: string) => Promise<void>;
  changePIN: (newPin: string) => Promise<void>;

  // Price
  priceState: PriceState;
  fetchPrice: () => Promise<void>;
  fetchHistoricalPrice: (date: Date) => Promise<number | null>;

  // Computed
  availableYears: number[];
  availableWallets: string[];
  allTransactions: Transaction[];

  // Actions
  addTransactions: (txns: Transaction[]) => Promise<void>;
  addTransactionsDeduped: (txns: Transaction[]) => Promise<{ added: number; duplicates: number }>;
  addTransaction: (txn: Transaction) => Promise<void>;
  deleteTransaction: (id: string) => Promise<void>;
  updateTransaction: (id: string, updates: Partial<Omit<Transaction, "id">>) => Promise<void>;
  updateTransactionPrice: (id: string, price: number) => Promise<void>;
  recordSale: (sale: SaleRecord) => Promise<void>;
  deleteSaleRecordBySourceTxnId: (sourceTransactionId: string) => Promise<void>;
  replaceSaleRecordBySourceTxnId: (sourceTransactionId: string, newRecord: SaleRecord) => Promise<void>;
  deleteSaleRecordById: (saleRecordId: string) => Promise<void>;
  replaceSaleRecordById: (saleRecordId: string, newRecord: SaleRecord) => Promise<void>;
  recordSalesBatch: (sales: SaleRecord[]) => Promise<void>;
  deleteSaleRecordsByIds: (ids: string[]) => Promise<void>;
  clearAllData: () => Promise<void>;
  computeFileHash: (content: string) => Promise<string>;
  checkImportHistory: (hash: string) => ImportRecord | undefined;
  recordImport: (hash: string, fileName: string, count: number) => Promise<void>;
  saveMappings: (mappings: Record<string, ColumnMapping>) => Promise<void>;
  loadMappings: () => Promise<Record<string, ColumnMapping>>;

  // Backup
  createBackup: (password: string) => Promise<string>;
  restoreBackup: (file: File, password?: string) => Promise<void>;

  // Save error (shown as banner when filesystem/encryption save fails)
  saveError: string | null;
  clearSaveError: () => void;

  // Audit
  appendAuditLog: (action: AuditAction, details: string) => Promise<void>;
}

const AppStateContext = createContext<AppStateContextType | null>(null);

export function useAppState() {
  const ctx = useContext(AppStateContext);
  if (!ctx) throw new Error("useAppState must be inside AppStateProvider");
  return ctx;
}

export function AppStateProvider({ children }: { children: React.ReactNode }) {
  // Load initial data — these will be empty arrays if data is encrypted
  // Real data is loaded after unlock via unlockWithPIN
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [recordedSales, setRecordedSales] = useState<SaleRecord[]>([]);
  const [importHistory, setImportHistory] = useState<Record<string, ImportRecord>>({});
  const [auditLog, setAuditLog] = useState<AuditEntry[]>([]);

  const prefs = persistence.loadPreferences();
  const [selectedNav, setSelectedNav] = useState("holdings");
  const [selectedYear, setSelectedYear] = useState(prefs.selectedYear);
  const [selectedMethod, setSelectedMethod] = useState<AccountingMethod>(prefs.selectedMethod);
  const [appearanceMode, setAppearanceMode] = useState<string | null>(prefs.appearanceMode ?? null);
  const [privacyBlur, setPrivacyBlur] = useState(prefs.privacyBlur ?? false);
  const [selectedWallet, setSelectedWallet] = useState<string | null>(prefs.selectedWallet ?? null);
  const [livePriceEnabled, setLivePriceEnabled] = useState(prefs.livePriceEnabled ?? true);
  // Migration: old single priorCarryforward → put into ST (IRS deducts ST first)
  const [priorCarryforwardST, setPriorCarryforwardST] = useState(
    prefs.priorCarryforwardST ?? prefs.priorCarryforward ?? 0
  );
  const [priorCarryforwardLT, setPriorCarryforwardLT] = useState(prefs.priorCarryforwardLT ?? 0);
  const [txnSortField, setTxnSortField] = useState(prefs.txnSortField ?? "date");
  const [txnSortAsc, setTxnSortAsc] = useState(prefs.txnSortAsc ?? true);
  const [reconciliationDecisions, setReconciliationDecisionsState] = useState<Record<string, "approved" | "rejected">>(
    prefs.reconciliationDecisions ?? {}
  );
  const [manualTransferMatches, setManualTransferMatchesState] = useState<Array<{ outId: string; inId: string }>>(
    prefs.manualTransferMatches ?? []
  );

  const setReconciliationDecision = useCallback((pairKey: string, decision: "approved" | "rejected" | null) => {
    setReconciliationDecisionsState((prev) => {
      const next = { ...prev };
      if (decision === null) {
        delete next[pairKey];
      } else {
        next[pairKey] = decision;
      }
      return next;
    });
  }, []);

  const addManualTransferMatch = useCallback((match: { outId: string; inId: string }) => {
    setManualTransferMatchesState((prev) => {
      if (prev.some((m) => m.outId === match.outId && m.inId === match.inId)) return prev;
      return [...prev, match];
    });
  }, []);

  const removeManualTransferMatch = useCallback((outId: string, inId: string) => {
    setManualTransferMatchesState((prev) => prev.filter((m) => !(m.outId === outId && m.inId === inId)));
  }, []);
  const [savedLotSelections, setSavedLotSelections] = useState<SavedLotSelections | null>(null);
  const [isUnlocked, setIsUnlocked] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const [priceState, setPriceState] = useState<PriceState>({
    currentPrice: null,
    lastUpdated: null,
    isLoading: false,
    error: null,
  });

  // Save preferences when they change
  useEffect(() => {
    persistence.savePreferences({
      selectedYear,
      selectedMethod,
      appearanceMode,
      privacyBlur,
      selectedWallet,
      livePriceEnabled,
      priorCarryforwardST,
      priorCarryforwardLT,
      txnSortField,
      txnSortAsc,
      reconciliationDecisions,
      manualTransferMatches,
    });
  }, [selectedYear, selectedMethod, appearanceMode, privacyBlur, selectedWallet, livePriceEnabled, priorCarryforwardST, priorCarryforwardLT, txnSortField, txnSortAsc, reconciliationDecisions, manualTransferMatches]);

  // Apply appearance mode — default to dark when System is selected
  useEffect(() => {
    const root = document.documentElement;
    root.classList.remove("light", "dark");
    if (appearanceMode === "light") {
      root.classList.add("light");
    } else if (appearanceMode === "dark") {
      root.classList.add("dark");
    } else {
      // System: check OS preference, default to dark
      const prefersDark = !window.matchMedia("(prefers-color-scheme: light)").matches;
      root.classList.add(prefersDark ? "dark" : "light");
    }
  }, [appearanceMode]);

  // Clear encryption key on lock
  useEffect(() => {
    if (!isUnlocked) {
      persistence.setEncryptionKey(null);
      // Clear sensitive data from memory
      setTransactions([]);
      setRecordedSales([]);
      setImportHistory({});
      setAuditLog([]);
      setSavedLotSelections(null);
    }
  }, [isUnlocked]);

  // Ref for audit log to avoid stale closures
  const auditLogRef = useRef<AuditEntry[]>([]);
  useEffect(() => { auditLogRef.current = auditLog; }, [auditLog]);

  // Audit log helper — appends and persists (awaits encryption).
  // Rotates at 5000 entries to prevent unbounded growth.
  const AUDIT_LOG_MAX = 5000;
  const appendAuditLog = useCallback(async (action: AuditAction, details: string) => {
    const entry = createAuditEntry(action, details);
    let next = [...auditLogRef.current, entry];
    if (next.length > AUDIT_LOG_MAX) {
      next = next.slice(next.length - AUDIT_LOG_MAX);
    }
    setAuditLog(next);
    await guardedSave(() => persistence.saveAuditLog(next));
  }, []);

  /**
   * Unlock flow: derive encryption key → decrypt data → migrate if needed.
   * Called from LockScreen and SetupPIN after PIN is verified/set.
   */
  const unlockWithPIN = useCallback(async (pin: string) => {
    // Get or create encryption salt (separate from PIN hash salt)
    let encSalt = persistence.loadEncryptionSalt();
    if (!encSalt) {
      encSalt = generateSalt();
      persistence.saveEncryptionSalt(encSalt);
    }

    // Derive AES-256-GCM key from PIN
    let key = await deriveEncryptionKey(pin, encSalt);
    persistence.setEncryptionKey(key);

    // Try loading data — if decrypt fails, check for previous salt (changePIN crash recovery)
    try {
      await persistence.loadTransactionsAsync();
    } catch (e) {
      if (e instanceof persistence.DecryptionError) {
        const prevSalt = persistence.loadPrevEncryptionSalt();
        if (prevSalt) {
          // Crash during changePIN — roll back to previous encryption salt
          persistence.saveEncryptionSalt(prevSalt);
          persistence.clearPrevEncryptionSalt();
          key = await deriveEncryptionKey(pin, prevSalt);
          persistence.setEncryptionKey(key);
        } else {
          throw e;
        }
      } else {
        throw e;
      }
    }

    // Migrate any plaintext data to encrypted format
    await persistence.migrateToEncrypted();

    // Migrate encrypted data from localStorage → filesystem (Tauri only, one-time)
    await persistence.migrateToFilesystem();

    // Load decrypted data
    const txns = await persistence.loadTransactionsAsync();
    const sales = await persistence.loadRecordedSalesAsync();
    const history = await persistence.loadImportHistoryAsync();
    const audit = await persistence.loadAuditLogAsync();

    setTransactions(txns);
    setRecordedSales(sales);
    setImportHistory(history);
    setAuditLog(audit);
    setIsUnlocked(true);

    // Log unlock (after state is set)
    const entry = createAuditEntry(AuditAction.AppUnlocked, "App unlocked");
    const updatedAudit = [...audit, entry];
    setAuditLog(updatedAudit);
    await guardedSave(() => persistence.saveAuditLog(updatedAudit));
  }, []);

  /**
   * Change PIN: decrypt all data with the old key, generate new encryption salt,
   * derive a new encryption key from the new PIN, and re-encrypt all data.
   * Must only be called while the app is unlocked (old key in memory).
   */
  const changePIN = useCallback(async (newPin: string) => {
    // 1. Read ALL decrypted data while old key is still active
    const txns = await persistence.loadTransactionsAsync();
    const sales = await persistence.loadRecordedSalesAsync();
    const mappings = await persistence.loadMappingsAsync();
    const history = await persistence.loadImportHistoryAsync();
    const audit = await persistence.loadAuditLogAsync();

    // 2. Save old encryption salt as backup (crash-safety: allows rollback if re-encrypt fails mid-way)
    const oldEncSalt = persistence.loadEncryptionSalt();
    if (oldEncSalt) {
      persistence.savePrevEncryptionSalt(oldEncSalt);
    }

    // 3. Save new PIN hash/salt (for authentication)
    const pinSalt = generateSalt();
    const pinHash = await hashPINWithPBKDF2(newPin, pinSalt);
    persistence.savePINSalt(pinSalt);
    persistence.savePINHash(pinHash);

    // 4. Generate new encryption salt and derive new encryption key
    const newEncSalt = generateSalt();
    persistence.saveEncryptionSalt(newEncSalt);
    const newKey = await deriveEncryptionKey(newPin, newEncSalt);
    persistence.setEncryptionKey(newKey);

    // 5. Re-encrypt ALL data with the new key
    await persistence.saveTransactionsAsync(txns);
    await persistence.saveRecordedSalesAsync(sales);
    await persistence.saveMappingsAsync(mappings);
    await persistence.saveImportHistoryAsync(history);

    // 6. Log PIN change and save audit with new key
    const entry = createAuditEntry(AuditAction.PINChanged, "PIN changed — data re-encrypted");
    const updatedAudit = [...audit, entry];
    await persistence.saveAuditLogAsync(updatedAudit);
    setAuditLog(updatedAudit);

    // 7. Clear backup salt — re-encryption succeeded
    persistence.clearPrevEncryptionSalt();
  }, []);

  const fetchPrice = useCallback(async () => {
    setPriceState((prev) => ({ ...prev, isLoading: true, error: null }));
    try {
      const { price, timestamp } = await fetchBTCPrice();
      setPriceState({ currentPrice: price, lastUpdated: timestamp, isLoading: false, error: null });
    } catch (e: any) {
      setPriceState((prev) => ({ ...prev, isLoading: false, error: e.message }));
    }
  }, []);

  const fetchHistoricalPriceAction = useCallback(async (date: Date): Promise<number | null> => {
    return fetchHistoricalPrice(date);
  }, []);

  // Computed: all transactions (recorded sales are already in transactions[] via addTransaction)
  const allTransactions = React.useMemo(() => {
    return [...transactions];
  }, [transactions]);

  // Available years — bounds-checked to filter out nonsense values (e.g., Excel serial dates
  // that slipped through as year 44192). Bitcoin launched in 2009; cap at current year + 1.
  const availableYears = React.useMemo(() => {
    const currentYear = new Date().getFullYear();
    const years = new Set<number>();
    years.add(currentYear);
    for (const t of allTransactions) {
      const y = new Date(t.date).getFullYear();
      if (y >= 2009 && y <= currentYear + 1) {
        years.add(y);
      }
    }
    return Array.from(years).sort();
  }, [allTransactions]);

  // Available wallets
  const availableWallets = React.useMemo(() => {
    const wallets = new Set<string>();
    for (const t of allTransactions) {
      const w = t.wallet || t.exchange;
      if (w) wallets.add(w);
    }
    return Array.from(wallets).sort();
  }, [allTransactions]);

  // Ref to track latest transactions for async save (avoids stale closure in setState)
  const transactionsRef = useRef<Transaction[]>([]);
  const recordedSalesRef = useRef<SaleRecord[]>([]);

  // Keep refs in sync with state
  useEffect(() => { transactionsRef.current = transactions; }, [transactions]);
  useEffect(() => { recordedSalesRef.current = recordedSales; }, [recordedSales]);

  /** Wrap async save calls to catch errors and surface them via saveError banner.
   *  State is already updated in memory — the banner warns that persistence may have failed. */
  const guardedSave = async (fn: () => Promise<void>) => {
    try {
      await fn();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to save data";
      console.error("Save error:", e);
      setSaveError(msg);
    }
  };

  const clearSaveError = useCallback(() => setSaveError(null), []);

  // Actions — all save operations now await encryption before returning
  const addTransactions = useCallback(async (txns: Transaction[]) => {
    const next = [...transactionsRef.current, ...txns];
    setTransactions(next);
    transactionsRef.current = next;
    await guardedSave(() => persistence.saveTransactions(next));
    await appendAuditLog(AuditAction.TransactionImport, `Imported ${txns.length} transactions`);
  }, [appendAuditLog]);

  const addTransactionsDeduped = useCallback(
    async (newTxns: Transaction[]) => {
      const prev = transactionsRef.current;
      const existingKeys = new Set(prev.map(transactionNaturalKey));
      const unique = newTxns.filter((t) => !existingKeys.has(transactionNaturalKey(t)));
      const added = unique.length;
      const duplicates = newTxns.length - unique.length;
      if (unique.length > 0) {
        const next = [...prev, ...unique];
        setTransactions(next);
        transactionsRef.current = next;
        await guardedSave(() => persistence.saveTransactions(next));
      }
      if (added > 0) {
        await appendAuditLog(AuditAction.TransactionImport, `Imported ${added} transactions (${duplicates} duplicates skipped)`);
      }
      return { added, duplicates };
    },
    [appendAuditLog]
  );

  const addTransaction = useCallback(async (txn: Transaction) => {
    const next = [...transactionsRef.current, txn];
    setTransactions(next);
    transactionsRef.current = next;
    await guardedSave(() => persistence.saveTransactions(next));
    await appendAuditLog(AuditAction.TransactionAdd, `Added ${txn.transactionType} of ${txn.amountBTC.toFixed(8)} BTC`);
  }, [appendAuditLog]);

  const deleteTransaction = useCallback(async (id: string) => {
    const prev = transactionsRef.current;
    const deleted = prev.find((t) => t.id === id);
    const next = prev.filter((t) => t.id !== id);
    setTransactions(next);
    transactionsRef.current = next;
    await guardedSave(() => persistence.saveTransactions(next));

    // Cascade: remove any linked Specific ID SaleRecord to prevent orphaned entries.
    // Uses shared resolver for consistent matching (same logic as engine + UI).
    const prevSales = recordedSalesRef.current;
    const resolved = resolveRecordedSales(prev, prevSales);
    const linkedRecord = resolved.get(id);
    if (linkedRecord) {
      const nextSales = prevSales.filter((s) => s.id !== linkedRecord.id);
      setRecordedSales(nextSales);
      recordedSalesRef.current = nextSales;
      await guardedSave(() => persistence.saveRecordedSales(nextSales));
    }

    // Cascade: when a Buy (or TransferIn) is deleted, any Specific ID elections
    // referencing it as a lot source become stale. Remove them proactively so the
    // user isn't silently served wrong cost-basis numbers.
    if (deleted && (deleted.transactionType === TransactionType.Buy || deleted.transactionType === TransactionType.TransferIn)) {
      // For Buy: lot ID === buyId, split lots start with buyId + "-xfer-"
      // For TransferIn: split lots contain "-xfer-" + transferId.slice(0,8) anywhere (catches descendants)
      const xferSuffix = "-xfer-" + id.slice(0, 8);
      const isStaleRef = (lotId: string) =>
        deleted.transactionType === TransactionType.Buy
          ? lotId === id || lotId.startsWith(id + "-xfer-")
          : lotId.includes(xferSuffix);
      const staleSaleIds = recordedSalesRef.current
        .filter((s) => s.method === AccountingMethod.SpecificID && s.lotDetails.some((d) => d.lotId && isStaleRef(d.lotId)))
        .map((s) => s.id);
      if (staleSaleIds.length > 0) {
        const staleSet = new Set(staleSaleIds);
        const nextSales2 = recordedSalesRef.current.filter((s) => !staleSet.has(s.id));
        setRecordedSales(nextSales2);
        recordedSalesRef.current = nextSales2;
        await guardedSave(() => persistence.saveRecordedSales(nextSales2));
        await appendAuditLog(AuditAction.SaleRecorded,
          `Auto-removed ${staleSaleIds.length} Specific ID election(s) referencing deleted ${deleted.transactionType} lot. ` +
          `Affected sales will use FIFO until lots are re-assigned via Edit Lots.`
        );
      }
    }

    // Cascade: when a Buy or TransferIn is deleted, any downstream TransferIn whose
    // transferLotSelections reference derived lots should have its selections cleared.
    // Buy: lots have id === buyId or startsWith(buyId + "-xfer-")
    // TransferIn: split lots contain "-xfer-" + transferId.slice(0,8) as a segment
    if (deleted && (deleted.transactionType === TransactionType.Buy || deleted.transactionType === TransactionType.TransferIn)) {
      const xferSuffix = "-xfer-" + id.slice(0, 8);
      const isAffected = (lotId: string) =>
        deleted.transactionType === TransactionType.Buy
          ? lotId === id || lotId.startsWith(id + "-xfer-")
          : lotId.includes(xferSuffix);
      const xferToUpdate = transactionsRef.current.filter(
        (t) => t.transactionType === TransactionType.TransferIn && t.id !== id &&
               t.transferLotSelections?.some((sel) => isAffected(sel.lotId))
      );
      if (xferToUpdate.length > 0) {
        const xferIds = new Set(xferToUpdate.map((t) => t.id));
        const clearedTxns = transactionsRef.current.map((t) =>
          xferIds.has(t.id) ? { ...t, transferLotSelections: undefined } : t
        );
        setTransactions(clearedTxns);
        transactionsRef.current = clearedTxns;
        await guardedSave(() => persistence.saveTransactions(clearedTxns));
      }
    }

    if (deleted) {
      await appendAuditLog(AuditAction.TransactionDelete, `Deleted ${deleted.transactionType} of ${deleted.amountBTC.toFixed(8)} BTC from ${deleted.exchange}`);
    }
  }, [appendAuditLog]);

  const updateTransaction = useCallback(async (id: string, updates: Partial<Omit<Transaction, "id">>) => {
    // Capture pre-edit transaction BEFORE mutating the ref — needed for invalidation checks below.
    const original = transactionsRef.current.find((t) => t.id === id);

    // Clear transfer lot selections when material fields change on a TransferIn.
    // sourceWallet change makes lot selections from the old wallet invalid.
    // amountBTC/date change means the lot coverage needs to be re-evaluated.
    if (original?.transactionType === TransactionType.TransferIn && original.transferLotSelections?.length) {
      const norm = (s: string | undefined) => (s || "").trim().toLowerCase();
      const shouldClear = (
        ("sourceWallet" in updates && norm(updates.sourceWallet) !== norm(original.sourceWallet)) ||
        (updates.amountBTC !== undefined && Math.round(updates.amountBTC * 1e8) !== Math.round(original.amountBTC * 1e8)) ||
        (updates.date !== undefined && updates.date !== original.date) ||
        (updates.transactionType !== undefined && updates.transactionType !== TransactionType.TransferIn)
      );
      if (shouldClear) {
        (updates as any).transferLotSelections = undefined;
      }
    }

    const next = transactionsRef.current.map((t) => {
      if (t.id !== id) return t;
      return { ...t, ...updates };
    });
    setTransactions(next);
    transactionsRef.current = next;
    await guardedSave(() => persistence.saveTransactions(next));

    // Invalidate linked Specific ID election only when material fields change.
    if (original && (original.transactionType === TransactionType.Sell || original.transactionType === TransactionType.Donation)) {
      if (isMaterialChange(original, updates)) {
        const resolved = resolveRecordedSales([original], recordedSalesRef.current);
        const linkedRecord = resolved.get(id);
        // Only auto-delete when we have a positive sourceTransactionId match.
        // Legacy records (no sourceTransactionId) are ambiguous — leave them alone.
        if (linkedRecord && linkedRecord.sourceTransactionId === id) {
          const nextSales = recordedSalesRef.current.filter((s) => s.id !== linkedRecord.id);
          setRecordedSales(nextSales);
          recordedSalesRef.current = nextSales;
          await guardedSave(() => persistence.saveRecordedSales(nextSales));
          await appendAuditLog(AuditAction.SaleRecorded, `Auto-removed Specific ID election for edited transaction (${original.amountBTC.toFixed(8)} BTC)`);
        }
      }
    }

    // TransferIn edits do NOT proactively delete downstream Specific ID elections.
    // The engine's extractLotSelections() safety net handles stale elections at calc time:
    // if a referenced lot no longer exists, it returns null → FIFO fallback with user-facing warning.
    // processSale() honors Specific ID selections from the FULL lot pool (not wallet-filtered),
    // so cross-wallet lots from re-tagging are still used with a walletMismatch tag for warnings.
    // Proactive deletion was too aggressive — it wiped elections on unrelated sales in affected wallets.

    // Buy edits that break lot eligibility invalidate downstream Specific ID elections
    // referencing this Buy as a lot source. Only triggers for truly destructive changes:
    // amount decreased, wallet changed, or type changed away from Buy.
    // Price/date/notes edits are safe — the engine reads current lot properties at calc time.
    if (original && original.transactionType === TransactionType.Buy) {
      const btcDecreased = updates.amountBTC !== undefined && Math.round(updates.amountBTC * 1e8) < Math.round(original.amountBTC * 1e8);
      const walletChanged = updates.wallet !== undefined && (updates.wallet || "").trim().toLowerCase() !== (original.wallet || "").trim().toLowerCase();
      const typeChanged = updates.transactionType !== undefined && updates.transactionType !== TransactionType.Buy;
      if (btcDecreased || walletChanged || typeChanged) {
        const staleSaleIds = recordedSalesRef.current
          .filter((s) => s.method === AccountingMethod.SpecificID && s.lotDetails.some((d) => d.lotId && (d.lotId === id || d.lotId.startsWith(id + "-xfer-"))))
          .map((s) => s.id);
        if (staleSaleIds.length > 0) {
          const staleSet = new Set(staleSaleIds);
          const nextSales2 = recordedSalesRef.current.filter((s) => !staleSet.has(s.id));
          setRecordedSales(nextSales2);
          recordedSalesRef.current = nextSales2;
          await guardedSave(() => persistence.saveRecordedSales(nextSales2));
          await appendAuditLog(AuditAction.SaleRecorded,
            `Auto-removed ${staleSaleIds.length} Specific ID election(s) after Buy edit (lot eligibility changed). ` +
            `Affected sales will use FIFO until lots are re-assigned via Edit Lots.`
          );
        }

        // Also clear transferLotSelections on TransferIn transactions that reference this Buy lot
        const xferToUpdate = transactionsRef.current.filter(
          (t) => t.transactionType === TransactionType.TransferIn &&
                 t.transferLotSelections?.some((sel) => sel.lotId === id || sel.lotId.startsWith(id + "-xfer-"))
        );
        if (xferToUpdate.length > 0) {
          const xferIds = new Set(xferToUpdate.map((t) => t.id));
          const clearedTxns = transactionsRef.current.map((t) =>
            xferIds.has(t.id) ? { ...t, transferLotSelections: undefined } : t
          );
          setTransactions(clearedTxns);
          transactionsRef.current = clearedTxns;
          await guardedSave(() => persistence.saveTransactions(clearedTxns));
        }
      }
    }

    // TransferIn material edits invalidate downstream transfers that reference split lots
    // created by this transfer. Split lot IDs contain "-xfer-" + transferId.slice(0,8).
    if (original && original.transactionType === TransactionType.TransferIn) {
      const norm = (s: string | undefined) => (s || "").trim().toLowerCase();
      const srcChanged = "sourceWallet" in updates && norm(updates.sourceWallet) !== norm(original.sourceWallet);
      const amtChanged = updates.amountBTC !== undefined && Math.round(updates.amountBTC * 1e8) !== Math.round(original.amountBTC * 1e8);
      const dateChanged = updates.date !== undefined && updates.date !== original.date;
      const typeChanged = updates.transactionType !== undefined && updates.transactionType !== TransactionType.TransferIn;
      if (srcChanged || amtChanged || dateChanged || typeChanged) {
        const xferSuffix = "-xfer-" + id.slice(0, 8);
        const xferToUpdate = transactionsRef.current.filter(
          (t) => t.transactionType === TransactionType.TransferIn && t.id !== id &&
                 t.transferLotSelections?.some((sel) => sel.lotId.includes(xferSuffix))
        );
        if (xferToUpdate.length > 0) {
          const xferIds = new Set(xferToUpdate.map((t) => t.id));
          const clearedTxns = transactionsRef.current.map((t) =>
            xferIds.has(t.id) ? { ...t, transferLotSelections: undefined } : t
          );
          setTransactions(clearedTxns);
          transactionsRef.current = clearedTxns;
          await guardedSave(() => persistence.saveTransactions(clearedTxns));
        }
      }
    }

    const updated = next.find((t) => t.id === id);
    if (updated) {
      await appendAuditLog(AuditAction.TransactionEdit, `Edited ${updated.transactionType} of ${updated.amountBTC.toFixed(8)} BTC from ${updated.exchange}`);
    }
  }, [appendAuditLog]);

  const updateTransactionPrice = useCallback(async (id: string, price: number) => {
    const next = transactionsRef.current.map((t) => {
      if (t.id !== id) return t;
      const totalUSD = t.amountBTC * price;
      return { ...t, pricePerBTC: price, totalUSD };
    });
    setTransactions(next);
    transactionsRef.current = next;
    await guardedSave(() => persistence.saveTransactions(next));
  }, []);

  const recordSaleAction = useCallback(async (sale: SaleRecord) => {
    const prev = recordedSalesRef.current;
    // Dedup: if a record with the same sourceTransactionId already exists, replace it instead of appending
    const next = sale.sourceTransactionId && prev.some((s) => s.sourceTransactionId === sale.sourceTransactionId)
      ? [...prev.filter((s) => s.sourceTransactionId !== sale.sourceTransactionId), sale]
      : [...prev, sale];
    setRecordedSales(next);
    recordedSalesRef.current = next;
    await guardedSave(() => persistence.saveRecordedSales(next));
    await appendAuditLog(AuditAction.SaleRecorded, `Recorded sale of ${sale.amountSold.toFixed(8)} BTC — G/L: $${sale.gainLoss.toFixed(2)}`);
  }, [appendAuditLog]);

  /** Delete SaleRecord by sourceTransactionId — used for cascade cleanup when a transaction is deleted. */
  const deleteSaleRecordBySourceTxnIdAction = useCallback(async (sourceTransactionId: string) => {
    const prev = recordedSalesRef.current;
    const toDelete = prev.find((s) => s.sourceTransactionId === sourceTransactionId);
    const next = prev.filter((s) => s.sourceTransactionId !== sourceTransactionId);
    setRecordedSales(next);
    recordedSalesRef.current = next; // Sync ref immediately to prevent stale reads
    await guardedSave(() => persistence.saveRecordedSales(next));
    if (toDelete) {
      await appendAuditLog(AuditAction.SaleRecorded, `Removed Specific ID lot election for sale of ${toDelete.amountSold.toFixed(8)} BTC on ${new Date(toDelete.saleDate).toLocaleDateString()}`);
    }
  }, [appendAuditLog]);

  /** Atomic replace by sourceTransactionId: removes existing SaleRecord and inserts a new one in a single operation.
   *  Avoids the stale-ref race condition that occurs when delete and record are called sequentially. */
  const replaceSaleRecordBySourceTxnIdAction = useCallback(async (sourceTransactionId: string, newRecord: SaleRecord) => {
    const prev = recordedSalesRef.current;
    const next = [...prev.filter((s) => s.sourceTransactionId !== sourceTransactionId), newRecord];
    setRecordedSales(next);
    recordedSalesRef.current = next; // Sync ref immediately
    await guardedSave(() => persistence.saveRecordedSales(next));
    await appendAuditLog(AuditAction.SaleRecorded, `Updated Specific ID lot election for sale of ${newRecord.amountSold.toFixed(8)} BTC — G/L: $${newRecord.gainLoss.toFixed(2)}`);
  }, [appendAuditLog]);

  /** Delete SaleRecord by its own id — used for UI revert (works for both legacy and new-style records). */
  const deleteSaleRecordByIdAction = useCallback(async (saleRecordId: string) => {
    const prev = recordedSalesRef.current;
    const toDelete = prev.find((s) => s.id === saleRecordId);
    const next = prev.filter((s) => s.id !== saleRecordId);
    setRecordedSales(next);
    recordedSalesRef.current = next;
    await guardedSave(() => persistence.saveRecordedSales(next));
    if (toDelete) {
      await appendAuditLog(AuditAction.SaleRecorded, `Reverted Specific ID lot election for sale of ${toDelete.amountSold.toFixed(8)} BTC on ${new Date(toDelete.saleDate).toLocaleDateString()}`);
    }
  }, [appendAuditLog]);

  /** Atomic replace by SaleRecord.id: removes old record and inserts new one.
   *  Used for editing lot selections — supports upgrade-on-save (legacy records get sourceTransactionId stamped). */
  const replaceSaleRecordByIdAction = useCallback(async (saleRecordId: string, newRecord: SaleRecord) => {
    const prev = recordedSalesRef.current;
    const next = [...prev.filter((s) => s.id !== saleRecordId), newRecord];
    setRecordedSales(next);
    recordedSalesRef.current = next;
    await guardedSave(() => persistence.saveRecordedSales(next));
    await appendAuditLog(AuditAction.SaleRecorded, `Updated Specific ID lot election for sale of ${newRecord.amountSold.toFixed(8)} BTC — G/L: $${newRecord.gainLoss.toFixed(2)}`);
  }, [appendAuditLog]);

  /** Batch save multiple SaleRecords in a single encrypt+write operation.
   *  Deduplicates by sourceTransactionId (replaces existing if present). */
  const recordSalesBatchAction = useCallback(async (sales: SaleRecord[]) => {
    let current = recordedSalesRef.current;
    for (const sale of sales) {
      if (sale.sourceTransactionId && current.some((s) => s.sourceTransactionId === sale.sourceTransactionId)) {
        current = [...current.filter((s) => s.sourceTransactionId !== sale.sourceTransactionId), sale];
      } else {
        current = [...current, sale];
      }
    }
    setRecordedSales(current);
    recordedSalesRef.current = current;
    await guardedSave(() => persistence.saveRecordedSales(current));
    await appendAuditLog(AuditAction.SaleRecorded, `Batch saved ${sales.length} Specific ID lot election${sales.length === 1 ? "" : "s"}`);
  }, [appendAuditLog]);

  /** Batch delete multiple SaleRecords by ID in a single encrypt+write operation. */
  const deleteSaleRecordsByIdsAction = useCallback(async (ids: string[]) => {
    const idSet = new Set(ids);
    const prev = recordedSalesRef.current;
    const next = prev.filter((s) => !idSet.has(s.id));
    setRecordedSales(next);
    recordedSalesRef.current = next;
    await guardedSave(() => persistence.saveRecordedSales(next));
    await appendAuditLog(AuditAction.SaleRecorded, `Batch removed ${ids.length} Specific ID lot election${ids.length === 1 ? "" : "s"}`);
  }, [appendAuditLog]);

  const clearAllData = useCallback(async () => {
    // Log BEFORE clearing so the audit entry includes the current encryption key
    await appendAuditLog(AuditAction.DataCleared, "All transaction data cleared");
    setTransactions([]);
    transactionsRef.current = [];
    setRecordedSales([]);
    recordedSalesRef.current = [];
    setImportHistory({});
    importHistoryRef.current = {};
    setSavedLotSelections(null);
    await guardedSave(() => persistence.clearAllData());
  }, [appendAuditLog]);

  const computeFileHash = useCallback(async (content: string) => {
    return computeHash(content);
  }, []);

  const checkImportHistory = useCallback(
    (hash: string) => importHistory[hash],
    [importHistory]
  );

  // Ref for import history to avoid stale closures
  const importHistoryRef = useRef<Record<string, ImportRecord>>({});
  useEffect(() => { importHistoryRef.current = importHistory; }, [importHistory]);

  const recordImport = useCallback(
    async (hash: string, fileName: string, count: number) => {
      const record: ImportRecord = {
        fileHash: hash,
        fileName,
        importDate: new Date().toISOString(),
        transactionCount: count,
      };
      const next = { ...importHistoryRef.current, [hash]: record };
      setImportHistory(next);
      importHistoryRef.current = next;
      await guardedSave(() => persistence.saveImportHistory(next));
    },
    []
  );

  const saveMappingsAction = useCallback(async (mappings: Record<string, ColumnMapping>) => {
    await guardedSave(() => persistence.saveMappings(mappings));
  }, []);

  const loadMappingsAction = useCallback(async () => {
    return persistence.loadMappingsAsync();
  }, []);

  // Backup & Restore
  const createBackupAction = useCallback(async (password: string): Promise<string> => {
    const data = await persistence.loadAllDataForBackup();
    const bundle = await createBackupBundle(
      data.transactions,
      data.recordedSales,
      data.mappings,
      data.importHistory,
      data.auditLog,
      data.preferences,
      password
    );
    // Save to app data directory
    const filename = await saveBackupToAppData(bundle);
    await appendAuditLog(AuditAction.BackupCreated, `Encrypted backup saved with ${data.transactions.length} transactions`);
    return filename;
  }, [appendAuditLog]);

  const restoreBackupAction = useCallback(async (file: File, password?: string) => {
    const text = await file.text();
    const result = await parseBackupBundle(text, password);

    // Persist all data to disk FIRST — if this fails, don't update in-memory state.
    // This prevents the scenario where the user sees restored data in the UI
    // but it wasn't actually saved, leading to data loss on next app launch.
    try {
      await persistence.restoreAllData(result.data);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to save restored data";
      console.error("Restore save error:", e);
      setSaveError(msg);
      throw new Error(`Backup restore failed: ${msg}. Some data may have been partially updated — create a fresh backup before retrying.`);
    }

    // Reload state — sync refs immediately so appendAuditLog reads from restored data
    setTransactions(result.data.transactions);
    transactionsRef.current = result.data.transactions;
    setRecordedSales(result.data.recordedSales);
    recordedSalesRef.current = result.data.recordedSales;
    setImportHistory(result.data.importHistory);
    importHistoryRef.current = result.data.importHistory;
    setAuditLog(result.data.auditLog);
    auditLogRef.current = result.data.auditLog;
    // Invalidate session-only state — restored dataset may have different lots
    setSavedLotSelections(null);

    // Reload preferences into UI state so restored settings take effect immediately
    if (result.data.preferences) {
      const p = result.data.preferences;
      if (p.selectedYear != null) setSelectedYear(p.selectedYear);
      if (p.selectedMethod != null) setSelectedMethod(p.selectedMethod);
      if (p.appearanceMode !== undefined) setAppearanceMode(p.appearanceMode ?? null);
      if (p.privacyBlur !== undefined) setPrivacyBlur(p.privacyBlur ?? false);
      if (p.selectedWallet !== undefined) setSelectedWallet(p.selectedWallet ?? null);
      if (p.livePriceEnabled !== undefined) setLivePriceEnabled(p.livePriceEnabled ?? true);
      // Restore carryforward: prefer new ST/LT fields, fall back to legacy single field → ST
      if (p.priorCarryforwardST !== undefined || p.priorCarryforwardLT !== undefined) {
        setPriorCarryforwardST(p.priorCarryforwardST ?? 0);
        setPriorCarryforwardLT(p.priorCarryforwardLT ?? 0);
      } else if (p.priorCarryforward !== undefined) {
        setPriorCarryforwardST(p.priorCarryforward ?? 0);
        setPriorCarryforwardLT(0);
      }
      if (p.txnSortField !== undefined) setTxnSortField(p.txnSortField);
      if (p.txnSortAsc !== undefined) setTxnSortAsc(p.txnSortAsc);
      if (p.reconciliationDecisions !== undefined) setReconciliationDecisionsState(p.reconciliationDecisions);
      if (p.manualTransferMatches !== undefined) setManualTransferMatchesState(p.manualTransferMatches);
    }

    const encLabel = result.wasEncrypted ? "encrypted" : "legacy unencrypted";
    await appendAuditLog(AuditAction.BackupRestored, `Backup restored from ${file.name} (${encLabel}, ${result.data.transactions.length} transactions)`);
  }, [appendAuditLog]);

  const value: AppStateContextType = {
    transactions,
    recordedSales,
    importHistory,
    auditLog,
    selectedNav,
    setSelectedNav,
    selectedYear,
    setSelectedYear,
    selectedMethod,
    setSelectedMethod,
    appearanceMode,
    setAppearanceMode,
    privacyBlur,
    setPrivacyBlur,
    selectedWallet,
    setSelectedWallet,
    livePriceEnabled,
    setLivePriceEnabled,
    priorCarryforwardST,
    setPriorCarryforwardST,
    priorCarryforwardLT,
    setPriorCarryforwardLT,
    txnSortField,
    setTxnSortField,
    txnSortAsc,
    setTxnSortAsc,
    reconciliationDecisions,
    setReconciliationDecision,
    manualTransferMatches,
    addManualTransferMatch,
    removeManualTransferMatch,
    savedLotSelections,
    setSavedLotSelections,
    isUnlocked,
    setIsUnlocked,
    unlockWithPIN,
    changePIN,
    priceState,
    fetchPrice,
    fetchHistoricalPrice: fetchHistoricalPriceAction,
    availableYears,
    availableWallets,
    allTransactions,
    addTransactions,
    addTransactionsDeduped,
    addTransaction,
    deleteTransaction,
    updateTransaction,
    updateTransactionPrice,
    recordSale: recordSaleAction,
    deleteSaleRecordBySourceTxnId: deleteSaleRecordBySourceTxnIdAction,
    replaceSaleRecordBySourceTxnId: replaceSaleRecordBySourceTxnIdAction,
    deleteSaleRecordById: deleteSaleRecordByIdAction,
    replaceSaleRecordById: replaceSaleRecordByIdAction,
    recordSalesBatch: recordSalesBatchAction,
    deleteSaleRecordsByIds: deleteSaleRecordsByIdsAction,
    clearAllData,
    computeFileHash,
    checkImportHistory,
    recordImport,
    saveMappings: saveMappingsAction,
    loadMappings: loadMappingsAction,
    createBackup: createBackupAction,
    restoreBackup: restoreBackupAction,
    saveError,
    clearSaveError,
    appendAuditLog,
  };

  return (
    <AppStateContext.Provider value={value}>{children}</AppStateContext.Provider>
  );
}
