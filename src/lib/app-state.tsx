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
import { createBackupBundle, parseBackupBundle, downloadBackup } from "./backup";

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

/**
 * Pure function: given a TransferIn edit, determines which downstream Specific ID
 * SaleRecords should be invalidated.
 * Returns the IDs of stale SaleRecords that should be removed.
 *
 * Affected wallets = old source + new source + destination + new destination.
 * Only invalidates Specific ID elections on sells/donations in affected wallets
 * at or after the transfer date. Sells in unrelated wallets are untouched.
 */
export function findStaleDownstreamRecords(
  original: Transaction,
  updates: Partial<Omit<Transaction, "id">>,
  allTransactions: Transaction[],
  allSaleRecords: SaleRecord[]
): string[] {
  if (original.transactionType !== TransactionType.TransferIn) return [];
  if (!isMaterialChange(original, updates)) return [];

  const transferDate = new Date(updates.date || original.date).getTime();
  const norm = (s?: string) => (s || "").trim().toLowerCase();
  const affectedWallets = new Set<string>();
  if (original.sourceWallet) affectedWallets.add(norm(original.sourceWallet));
  if (updates.sourceWallet) affectedWallets.add(norm(updates.sourceWallet));
  affectedWallets.add(norm(original.wallet || original.exchange));
  if (updates.wallet) affectedWallets.add(norm(updates.wallet));
  affectedWallets.delete(""); // Prevent empty-string from matching transactions with no wallet

  const downstreamIds = new Set(
    allTransactions
      .filter((t) =>
        (t.transactionType === TransactionType.Sell || t.transactionType === TransactionType.Donation) &&
        new Date(t.date).getTime() >= transferDate &&
        affectedWallets.has(norm(t.wallet || t.exchange))
      )
      .map((t) => t.id)
  );

  return allSaleRecords
    .filter(
      (s) => s.sourceTransactionId && downstreamIds.has(s.sourceTransactionId) && s.method === "SpecificID"
    )
    .map((s) => s.id);
}

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
  createBackup: (password: string) => Promise<boolean>;
  restoreBackup: (file: File, password?: string) => Promise<void>;

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
  const [savedLotSelections, setSavedLotSelections] = useState<SavedLotSelections | null>(null);
  const [isUnlocked, setIsUnlocked] = useState(false);

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
    });
  }, [selectedYear, selectedMethod, appearanceMode, privacyBlur, selectedWallet, livePriceEnabled]);

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

  // Audit log helper — appends and persists (awaits encryption)
  const appendAuditLog = useCallback(async (action: AuditAction, details: string) => {
    const entry = createAuditEntry(action, details);
    const next = [...auditLogRef.current, entry];
    setAuditLog(next);
    await persistence.saveAuditLog(next);
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
    const key = await deriveEncryptionKey(pin, encSalt);
    persistence.setEncryptionKey(key);

    // Migrate any plaintext data to encrypted format
    await persistence.migrateToEncrypted();

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
    await persistence.saveAuditLog(updatedAudit);
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

    // 2. Save new PIN hash/salt (for authentication)
    const pinSalt = generateSalt();
    const pinHash = await hashPINWithPBKDF2(newPin, pinSalt);
    persistence.savePINSalt(pinSalt);
    persistence.savePINHash(pinHash);

    // 3. Generate new encryption salt and derive new encryption key
    const newEncSalt = generateSalt();
    persistence.saveEncryptionSalt(newEncSalt);
    const newKey = await deriveEncryptionKey(newPin, newEncSalt);
    persistence.setEncryptionKey(newKey);

    // 4. Re-encrypt ALL data with the new key
    await persistence.saveTransactionsAsync(txns);
    await persistence.saveRecordedSalesAsync(sales);
    await persistence.saveMappingsAsync(mappings);
    await persistence.saveImportHistoryAsync(history);

    // 5. Log PIN change and save audit with new key
    const entry = createAuditEntry(AuditAction.PINChanged, "PIN changed — data re-encrypted");
    const updatedAudit = [...audit, entry];
    await persistence.saveAuditLogAsync(updatedAudit);
    setAuditLog(updatedAudit);
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

  // Actions — all save operations now await encryption before returning
  const addTransactions = useCallback(async (txns: Transaction[]) => {
    const next = [...transactionsRef.current, ...txns];
    setTransactions(next);
    transactionsRef.current = next;
    await persistence.saveTransactions(next);
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
        await persistence.saveTransactions(next);
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
    await persistence.saveTransactions(next);
    await appendAuditLog(AuditAction.TransactionAdd, `Added ${txn.transactionType} of ${txn.amountBTC.toFixed(8)} BTC`);
  }, [appendAuditLog]);

  const deleteTransaction = useCallback(async (id: string) => {
    const prev = transactionsRef.current;
    const deleted = prev.find((t) => t.id === id);
    const next = prev.filter((t) => t.id !== id);
    setTransactions(next);
    transactionsRef.current = next;
    await persistence.saveTransactions(next);

    // Cascade: remove any linked Specific ID SaleRecord to prevent orphaned entries.
    // Uses shared resolver for consistent matching (same logic as engine + UI).
    const prevSales = recordedSalesRef.current;
    const resolved = resolveRecordedSales(prev, prevSales);
    const linkedRecord = resolved.get(id);
    if (linkedRecord) {
      const nextSales = prevSales.filter((s) => s.id !== linkedRecord.id);
      setRecordedSales(nextSales);
      recordedSalesRef.current = nextSales;
      await persistence.saveRecordedSales(nextSales);
    }

    // Cascade: when a Buy (or TransferIn) is deleted, any Specific ID elections
    // referencing it as a lot source become stale. Remove them proactively so the
    // user isn't silently served wrong cost-basis numbers.
    if (deleted && (deleted.transactionType === TransactionType.Buy || deleted.transactionType === TransactionType.TransferIn)) {
      const staleSaleIds = recordedSalesRef.current
        .filter((s) => s.method === AccountingMethod.SpecificID && s.lotDetails.some((d) => d.lotId === id))
        .map((s) => s.id);
      if (staleSaleIds.length > 0) {
        const staleSet = new Set(staleSaleIds);
        const nextSales2 = recordedSalesRef.current.filter((s) => !staleSet.has(s.id));
        setRecordedSales(nextSales2);
        recordedSalesRef.current = nextSales2;
        await persistence.saveRecordedSales(nextSales2);
        await appendAuditLog(AuditAction.SaleRecorded,
          `Auto-removed ${staleSaleIds.length} Specific ID election(s) referencing deleted ${deleted.transactionType} lot. ` +
          `Affected sales will use FIFO until lots are re-assigned via Edit Lots.`
        );
      }
    }

    if (deleted) {
      await appendAuditLog(AuditAction.TransactionDelete, `Deleted ${deleted.transactionType} of ${deleted.amountBTC.toFixed(8)} BTC from ${deleted.exchange}`);
    }
  }, [appendAuditLog]);

  const updateTransaction = useCallback(async (id: string, updates: Partial<Omit<Transaction, "id">>) => {
    // Capture pre-edit transaction BEFORE mutating the ref — needed for invalidation checks below.
    const original = transactionsRef.current.find((t) => t.id === id);

    const next = transactionsRef.current.map((t) => {
      if (t.id !== id) return t;
      return { ...t, ...updates };
    });
    setTransactions(next);
    transactionsRef.current = next;
    await persistence.saveTransactions(next);

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
          await persistence.saveRecordedSales(nextSales);
          await appendAuditLog(AuditAction.SaleRecorded, `Auto-removed Specific ID election for edited transaction (${original.amountBTC.toFixed(8)} BTC)`);
        }
      }
    }

    // TransferIn sourceWallet changes invalidate downstream Specific ID elections,
    // but ONLY for sells/donations in the affected wallets (old source, new source, destination).
    if (original && original.transactionType === TransactionType.TransferIn) {
      const staleIds = findStaleDownstreamRecords(original, updates, transactionsRef.current, recordedSalesRef.current);
      if (staleIds.length > 0) {
        const staleSet = new Set(staleIds);
        const nextSales = recordedSalesRef.current.filter((s) => !staleSet.has(s.id));
        setRecordedSales(nextSales);
        recordedSalesRef.current = nextSales;
        await persistence.saveRecordedSales(nextSales);
        await appendAuditLog(AuditAction.SaleRecorded, `Auto-removed ${staleIds.length} downstream Specific ID election(s) after TransferIn edit`);
      }
    }

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
          .filter((s) => s.method === AccountingMethod.SpecificID && s.lotDetails.some((d) => d.lotId === id))
          .map((s) => s.id);
        if (staleSaleIds.length > 0) {
          const staleSet = new Set(staleSaleIds);
          const nextSales2 = recordedSalesRef.current.filter((s) => !staleSet.has(s.id));
          setRecordedSales(nextSales2);
          recordedSalesRef.current = nextSales2;
          await persistence.saveRecordedSales(nextSales2);
          await appendAuditLog(AuditAction.SaleRecorded,
            `Auto-removed ${staleSaleIds.length} Specific ID election(s) after Buy edit (lot eligibility changed). ` +
            `Affected sales will use FIFO until lots are re-assigned via Edit Lots.`
          );
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
    await persistence.saveTransactions(next);
  }, []);

  const recordSaleAction = useCallback(async (sale: SaleRecord) => {
    const prev = recordedSalesRef.current;
    // Dedup: if a record with the same sourceTransactionId already exists, replace it instead of appending
    const next = sale.sourceTransactionId && prev.some((s) => s.sourceTransactionId === sale.sourceTransactionId)
      ? [...prev.filter((s) => s.sourceTransactionId !== sale.sourceTransactionId), sale]
      : [...prev, sale];
    setRecordedSales(next);
    recordedSalesRef.current = next;
    await persistence.saveRecordedSales(next);
    await appendAuditLog(AuditAction.SaleRecorded, `Recorded sale of ${sale.amountSold.toFixed(8)} BTC — G/L: $${sale.gainLoss.toFixed(2)}`);
  }, [appendAuditLog]);

  /** Delete SaleRecord by sourceTransactionId — used for cascade cleanup when a transaction is deleted. */
  const deleteSaleRecordBySourceTxnIdAction = useCallback(async (sourceTransactionId: string) => {
    const prev = recordedSalesRef.current;
    const toDelete = prev.find((s) => s.sourceTransactionId === sourceTransactionId);
    const next = prev.filter((s) => s.sourceTransactionId !== sourceTransactionId);
    setRecordedSales(next);
    recordedSalesRef.current = next; // Sync ref immediately to prevent stale reads
    await persistence.saveRecordedSales(next);
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
    await persistence.saveRecordedSales(next);
    await appendAuditLog(AuditAction.SaleRecorded, `Updated Specific ID lot election for sale of ${newRecord.amountSold.toFixed(8)} BTC — G/L: $${newRecord.gainLoss.toFixed(2)}`);
  }, [appendAuditLog]);

  /** Delete SaleRecord by its own id — used for UI revert (works for both legacy and new-style records). */
  const deleteSaleRecordByIdAction = useCallback(async (saleRecordId: string) => {
    const prev = recordedSalesRef.current;
    const toDelete = prev.find((s) => s.id === saleRecordId);
    const next = prev.filter((s) => s.id !== saleRecordId);
    setRecordedSales(next);
    recordedSalesRef.current = next;
    await persistence.saveRecordedSales(next);
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
    await persistence.saveRecordedSales(next);
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
    await persistence.saveRecordedSales(current);
    await appendAuditLog(AuditAction.SaleRecorded, `Batch saved ${sales.length} Specific ID lot election${sales.length === 1 ? "" : "s"}`);
  }, [appendAuditLog]);

  /** Batch delete multiple SaleRecords by ID in a single encrypt+write operation. */
  const deleteSaleRecordsByIdsAction = useCallback(async (ids: string[]) => {
    const idSet = new Set(ids);
    const prev = recordedSalesRef.current;
    const next = prev.filter((s) => !idSet.has(s.id));
    setRecordedSales(next);
    recordedSalesRef.current = next;
    await persistence.saveRecordedSales(next);
    await appendAuditLog(AuditAction.SaleRecorded, `Batch removed ${ids.length} Specific ID lot election${ids.length === 1 ? "" : "s"}`);
  }, [appendAuditLog]);

  const clearAllData = useCallback(async () => {
    setTransactions([]);
    transactionsRef.current = [];
    setRecordedSales([]);
    recordedSalesRef.current = [];
    setImportHistory({});
    importHistoryRef.current = {};
    setSavedLotSelections(null);
    persistence.clearAllData();
    await appendAuditLog(AuditAction.DataCleared, "All transaction data cleared");
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
      await persistence.saveImportHistory(next);
    },
    []
  );

  const saveMappingsAction = useCallback(async (mappings: Record<string, ColumnMapping>) => {
    await persistence.saveMappings(mappings);
  }, []);

  const loadMappingsAction = useCallback(async () => {
    return persistence.loadMappingsAsync();
  }, []);

  // Backup & Restore
  const createBackupAction = useCallback(async (password: string): Promise<boolean> => {
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
    const saved = await downloadBackup(bundle);
    if (saved) {
      await appendAuditLog(AuditAction.BackupCreated, `Encrypted backup created with ${data.transactions.length} transactions`);
    }
    return saved;
  }, [appendAuditLog]);

  const restoreBackupAction = useCallback(async (file: File, password?: string) => {
    const text = await file.text();
    const result = await parseBackupBundle(text, password);

    // Restore all data
    await persistence.restoreAllData(result.data);

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
    appendAuditLog,
  };

  return (
    <AppStateContext.Provider value={value}>{children}</AppStateContext.Provider>
  );
}
