import React, { createContext, useContext, useState, useCallback, useEffect, useRef } from "react";
import { Transaction, SaleRecord, ColumnMapping, ImportRecord, Preferences } from "./models";
import { AccountingMethod, TransactionType } from "./types";
import { calculate, simulateSale as simSale } from "./cost-basis";
import { fetchBTCPrice, fetchHistoricalPrice } from "./price-service";
import { transactionNaturalKey } from "./utils";
import * as persistence from "./persistence";
import { computeHash } from "./csv-import";
import { deriveEncryptionKey, generateSalt } from "./crypto";
import { AuditEntry, AuditAction, createAuditEntry } from "./audit";
import { createBackupBundle, parseBackupBundle, downloadBackup, BackupBundle } from "./backup";

interface PriceState {
  currentPrice: number | null;
  lastUpdated: Date | null;
  isLoading: boolean;
  error: string | null;
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

  // Security
  isUnlocked: boolean;
  setIsUnlocked: (unlocked: boolean) => void;
  unlockWithPIN: (pin: string) => Promise<void>;

  // Price
  priceState: PriceState;
  fetchPrice: () => Promise<void>;
  fetchHistoricalPrice: (date: Date) => Promise<number | null>;

  // Computed
  availableYears: number[];
  availableWallets: string[];
  allTransactions: Transaction[];

  // Actions
  addTransactions: (txns: Transaction[]) => void;
  addTransactionsDeduped: (txns: Transaction[]) => { added: number; duplicates: number };
  addTransaction: (txn: Transaction) => void;
  deleteTransaction: (id: string) => void;
  updateTransaction: (id: string, updates: Partial<Omit<Transaction, "id">>) => void;
  updateTransactionPrice: (id: string, price: number) => void;
  recordSale: (sale: SaleRecord) => void;
  clearAllData: () => void;
  computeFileHash: (content: string) => Promise<string>;
  checkImportHistory: (hash: string) => ImportRecord | undefined;
  recordImport: (hash: string, fileName: string, count: number) => void;
  saveMappings: (mappings: Record<string, ColumnMapping>) => void;
  loadMappings: () => Record<string, ColumnMapping>;

  // Backup
  createBackup: () => Promise<void>;
  restoreBackup: (file: File) => Promise<void>;

  // Audit
  appendAuditLog: (action: AuditAction, details: string) => void;
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

  // Apply dark mode
  useEffect(() => {
    const root = document.documentElement;
    root.classList.remove("light", "dark");
    if (appearanceMode === "light") root.classList.add("light");
    else if (appearanceMode === "dark") root.classList.add("dark");
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
    }
  }, [isUnlocked]);

  // Audit log helper — appends and persists
  const appendAuditLog = useCallback((action: AuditAction, details: string) => {
    const entry = createAuditEntry(action, details);
    setAuditLog((prev) => {
      const next = [...prev, entry];
      persistence.saveAuditLog(next);
      return next;
    });
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
    persistence.saveAuditLog(updatedAudit);
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

  // Computed: all transactions including recorded sales
  const allTransactions = React.useMemo(() => {
    const all = [...transactions];
    for (const sale of recordedSales) {
      all.push({
        id: crypto.randomUUID(),
        date: sale.saleDate,
        transactionType: TransactionType.Sell,
        amountBTC: sale.amountSold,
        pricePerBTC: sale.salePricePerBTC,
        totalUSD: sale.totalProceeds,
        fee: sale.fee,
        exchange: "Recorded Sale",
        notes: "Manually recorded sale",
      });
    }
    return all;
  }, [transactions, recordedSales]);

  // Available years
  const availableYears = React.useMemo(() => {
    const years = new Set<number>();
    years.add(new Date().getFullYear());
    for (const t of allTransactions) {
      years.add(new Date(t.date).getFullYear());
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

  // Actions
  const addTransactions = useCallback((txns: Transaction[]) => {
    setTransactions((prev) => {
      const next = [...prev, ...txns];
      persistence.saveTransactions(next);
      return next;
    });
    appendAuditLog(AuditAction.TransactionImport, `Imported ${txns.length} transactions`);
  }, [appendAuditLog]);

  const addTransactionsDeduped = useCallback(
    (newTxns: Transaction[]) => {
      const existingKeys = new Set(transactions.map(transactionNaturalKey));
      const unique = newTxns.filter((t) => !existingKeys.has(transactionNaturalKey(t)));
      if (unique.length > 0) {
        const next = [...transactions, ...unique];
        setTransactions(next);
        persistence.saveTransactions(next);
      }
      if (unique.length > 0) {
        appendAuditLog(AuditAction.TransactionImport, `Imported ${unique.length} transactions (${newTxns.length - unique.length} duplicates skipped)`);
      }
      return { added: unique.length, duplicates: newTxns.length - unique.length };
    },
    [transactions, appendAuditLog]
  );

  const addTransaction = useCallback((txn: Transaction) => {
    setTransactions((prev) => {
      const next = [...prev, txn];
      persistence.saveTransactions(next);
      return next;
    });
    appendAuditLog(AuditAction.TransactionAdd, `Added ${txn.transactionType} of ${txn.amountBTC.toFixed(8)} BTC`);
  }, [appendAuditLog]);

  const deleteTransaction = useCallback((id: string) => {
    setTransactions((prev) => {
      const deleted = prev.find((t) => t.id === id);
      const next = prev.filter((t) => t.id !== id);
      persistence.saveTransactions(next);
      if (deleted) {
        appendAuditLog(AuditAction.TransactionDelete, `Deleted ${deleted.transactionType} of ${deleted.amountBTC.toFixed(8)} BTC from ${deleted.exchange}`);
      }
      return next;
    });
  }, [appendAuditLog]);

  const updateTransaction = useCallback((id: string, updates: Partial<Omit<Transaction, "id">>) => {
    setTransactions((prev) => {
      const next = prev.map((t) => {
        if (t.id !== id) return t;
        return { ...t, ...updates };
      });
      persistence.saveTransactions(next);
      const updated = next.find((t) => t.id === id);
      if (updated) {
        appendAuditLog(AuditAction.TransactionEdit, `Edited ${updated.transactionType} of ${updated.amountBTC.toFixed(8)} BTC from ${updated.exchange}`);
      }
      return next;
    });
  }, [appendAuditLog]);

  const updateTransactionPrice = useCallback((id: string, price: number) => {
    setTransactions((prev) => {
      const next = prev.map((t) => {
        if (t.id !== id) return t;
        const totalUSD = t.amountBTC * price;
        return { ...t, pricePerBTC: price, totalUSD };
      });
      persistence.saveTransactions(next);
      return next;
    });
  }, []);

  const recordSaleAction = useCallback((sale: SaleRecord) => {
    setRecordedSales((prev) => {
      const next = [...prev, sale];
      persistence.saveRecordedSales(next);
      return next;
    });
    appendAuditLog(AuditAction.SaleRecorded, `Recorded sale of ${sale.amountSold.toFixed(8)} BTC — G/L: $${sale.gainLoss.toFixed(2)}`);
  }, [appendAuditLog]);

  const clearAllData = useCallback(() => {
    setTransactions([]);
    setRecordedSales([]);
    setImportHistory({});
    persistence.clearAllData();
    appendAuditLog(AuditAction.DataCleared, "All transaction data cleared");
  }, [appendAuditLog]);

  const computeFileHash = useCallback(async (content: string) => {
    return computeHash(content);
  }, []);

  const checkImportHistory = useCallback(
    (hash: string) => importHistory[hash],
    [importHistory]
  );

  const recordImport = useCallback(
    (hash: string, fileName: string, count: number) => {
      const record: ImportRecord = {
        fileHash: hash,
        fileName,
        importDate: new Date().toISOString(),
        transactionCount: count,
      };
      const next = { ...importHistory, [hash]: record };
      setImportHistory(next);
      persistence.saveImportHistory(next);
    },
    [importHistory]
  );

  const saveMappingsAction = useCallback((mappings: Record<string, ColumnMapping>) => {
    persistence.saveMappings(mappings);
  }, []);

  const loadMappingsAction = useCallback(() => {
    return persistence.loadMappings();
  }, []);

  // Backup & Restore
  const createBackupAction = useCallback(async () => {
    const data = await persistence.loadAllDataForBackup();
    const bundle = await createBackupBundle(
      data.transactions,
      data.recordedSales,
      data.mappings,
      data.importHistory,
      data.auditLog,
      data.preferences
    );
    downloadBackup(bundle);
    appendAuditLog(AuditAction.BackupCreated, `Backup created with ${data.transactions.length} transactions`);
  }, [appendAuditLog]);

  const restoreBackupAction = useCallback(async (file: File) => {
    const text = await file.text();
    const bundle = await parseBackupBundle(text);

    // Restore all data
    await persistence.restoreAllData(bundle.data);

    // Reload state
    setTransactions(bundle.data.transactions);
    setRecordedSales(bundle.data.recordedSales);
    setImportHistory(bundle.data.importHistory);
    setAuditLog(bundle.data.auditLog);

    appendAuditLog(AuditAction.BackupRestored, `Backup restored from ${file.name} (${bundle.data.transactions.length} transactions)`);
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
    isUnlocked,
    setIsUnlocked,
    unlockWithPIN,
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
