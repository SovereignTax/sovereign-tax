import { Transaction } from "./models";
import { TransactionType } from "./types";

/** Confidence level for auto-matched transfer pairs */
export enum MatchConfidence {
  /** Fee below auto-threshold — high confidence this is the same transfer */
  Confident = "confident",
  /** Fee between auto-threshold and ceiling — likely the same transfer but fee is unusually high */
  Flagged = "flagged",
}

export interface TransferPair {
  transferOut: Transaction;
  transferIn: Transaction;
  amountBTC: number;
  daysBetween: number;
  /** Implied miner fee: out.amountBTC - in.amountBTC (always >= 0 for valid matches) */
  impliedFeeBTC: number;
  /** Match confidence based on implied fee size */
  confidence: MatchConfidence;
  /** True when the user linked this pair by hand on the Reconciliation page */
  manual?: boolean;
}

export interface WalletBalance {
  /** Wallet name (first-seen spelling). Same key the cost-basis engine and Holdings use: wallet, else exchange. */
  wallet: string;
  totalIn: number;  // BTC bought + transferred in
  totalOut: number; // BTC sold/donated + transferred out (including implied withdrawals, see reconcileTransfers)
  netBalance: number;
}

export interface ReconciliationResult {
  /** Automatically matched pairs (always empty when auto-matching is turned off). */
  matchedTransfers: TransferPair[];
  /** Pairs the user matched by hand. These always win over auto-matching. */
  manualTransfers: TransferPair[];
  unmatchedTransferOuts: Transaction[];
  /** Every Transfer In without a paired Transfer Out — including ones whose source wallet is
   *  assigned, which are fully accounted for (the source wallet says where the coins came from). */
  unmatchedTransferIns: Transaction[];
  /** IDs of transfers left unpaired because two or more pairings between DIFFERENT wallets fit
   *  equally well (e.g. identical same-day transfers from two accounts). The matcher never guesses. */
  ambiguousTransferIds: string[];
  walletBalances: WalletBalance[];
  suggestedMissing: string[];
}

export interface ReconcileOptions {
  /** User-confirmed pairs. Their transactions are withheld from auto-matching, so a manual
   *  match can never be overridden or duplicated by an automatic one. */
  manualMatches?: ReadonlyArray<{ outId: string; inId: string }>;
  /** Auto-matched pairs the user unmatched/rejected, as transferPairKey() strings. Both
   *  transactions are withheld from auto-matching so the user can pair them by hand. */
  rejectedPairKeys?: Iterable<string>;
  /** false = manual-only mode: nothing is paired automatically. Default true. */
  autoMatch?: boolean;
}

/**
 * Fee thresholds for transfer matching:
 * - Below FEE_AUTO_THRESHOLD: auto-match with high confidence (green)
 * - Between FEE_AUTO_THRESHOLD and FEE_MAX_CEILING: auto-match but flagged for review (orange)
 * - Above FEE_MAX_CEILING: no auto-match (stays in unmatched list)
 */
const FEE_AUTO_THRESHOLD = 0.0005; // ~$50 at $100k/BTC — normal miner fee range
const FEE_MAX_CEILING = 0.01;      // ~$1000 at $100k/BTC — above this is likely not the same transfer
// Proportional guards: miner fees are absolute, but when the implied "fee" eats a large
// fraction of the sent amount, the two transactions are almost certainly NOT the same
// transfer. Without these, out 0.0006 → in 0.0002 (a 67% "fee") matched as Confident
// and suggestSourceWallet propagated the wrong source wallet into engine re-tagging.
const FEE_MAX_FRACTION = 0.25;       // any match: implied fee must be ≤ 25% of amount sent
const FEE_CONFIDENT_FRACTION = 0.05; // Confident: implied fee must be ≤ 5% of amount sent
const NEGATIVE_FEE_TOLERANCE = 0.00000001; // 1 sat — allow for rounding in "in > out" edge cases
const MAX_DAYS_WINDOW = 7;
const DAY_MS = 1000 * 60 * 60 * 24;

// Exchange labels that carry no information about which account a transfer belongs to.
// "Manual" is what Add Transaction stores when the Exchange field is left blank.
const UNINFORMATIVE_LABELS = new Set(["", "manual"]);

export function daysBetweenDates(d1: string, d2: string): number {
  const date1 = new Date(d1);
  const date2 = new Date(d2);
  return Math.abs(Math.floor((date2.getTime() - date1.getTime()) / (1000 * 60 * 60 * 24)));
}

/** Stable key for a transfer pair — used for persisted approve/reject decisions. */
export function transferPairKey(outId: string, inId: string): string {
  return `${outId}|${inId}`;
}

/**
 * The wallet a transaction's coins are in — the same rule the cost-basis engine uses
 * (wallet, falling back to exchange). For a Transfer Out this is where the coins left;
 * for a Transfer In, where they arrived.
 */
export function walletOf(t: Pick<Transaction, "wallet" | "exchange">): string {
  return t.wallet || t.exchange || "";
}

const norm = (s: string | undefined) => (s ?? "").trim().toLowerCase();
const walletKey = (t: Transaction) => norm(walletOf(t));

/** Build ReconcileOptions from the persisted preference fields. */
export function reconcileOptionsFromPrefs(prefs: {
  manualTransferMatches?: ReadonlyArray<{ outId: string; inId: string }>;
  reconciliationDecisions?: Record<string, "approved" | "rejected">;
  autoMatchTransfers?: boolean;
}): ReconcileOptions {
  return {
    manualMatches: prefs.manualTransferMatches ?? [],
    rejectedPairKeys: Object.entries(prefs.reconciliationDecisions ?? {})
      .filter(([, decision]) => decision === "rejected")
      .map(([key]) => key),
    autoMatch: prefs.autoMatchTransfers ?? true,
  };
}

interface Candidate {
  out: Transaction;
  inp: Transaction;
  /** 0 = the Transfer In's assigned source wallet confirms this withdrawal */
  sourceTier: number;
  /** 0 = the deposit's exchange label names the withdrawal's account (same account/entity) */
  affinityTier: number;
  feeSats: number;
  days: number;
  impliedFeeBTC: number;
  /** Deterministic final tie-break: chronological, then input order */
  order: number;
}

/**
 * Could `out` and `inp` be the two halves of one transfer?
 * Returns the candidate (unscored order) or null.
 */
function evaluatePair(out: Transaction, inp: Transaction, outTime: number, inTime: number): Omit<Candidate, "order"> | null {
  // Same place on both sides isn't a move. Only exclude when the wallet AND the exchange
  // label coincide: the old exchange-only rule made every same-exchange move between two
  // wallets (Exchange A/Wallet A → Exchange A/Hardware Wallet A) impossible to match, so the
  // matcher paired the withdrawal with another account's identical deposit instead.
  if (walletKey(out) === walletKey(inp) && norm(out.exchange) === norm(inp.exchange)) return null;

  // An assigned source wallet is the user's own statement of where the coins came from —
  // never pair the deposit with a withdrawal from any other wallet.
  const source = norm(inp.sourceWallet);
  if (source && source !== walletKey(out) && source !== norm(out.exchange)) return null;

  // Timing: deposit at or after the withdrawal, within the window
  if (inTime < outTime) return null;
  const days = Math.floor((inTime - outTime) / DAY_MS);
  if (days > MAX_DAYS_WINDOW) return null;

  // Amount: implied miner fee must be non-negative and plausible
  const impliedFee = out.amountBTC - inp.amountBTC;
  if (impliedFee < -NEGATIVE_FEE_TOLERANCE) return null;
  if (impliedFee > FEE_MAX_CEILING) return null;
  if (out.amountBTC > 0 && impliedFee > out.amountBTC * FEE_MAX_FRACTION) return null;

  const inLabel = norm(inp.exchange);
  const affinity = !UNINFORMATIVE_LABELS.has(inLabel) && (inLabel === norm(out.exchange) || inLabel === walletKey(out));

  const fee = Math.max(0, impliedFee);
  return {
    out,
    inp,
    sourceTier: source ? 0 : 1,
    affinityTier: affinity ? 0 : 1,
    feeSats: Math.round(fee * 1e8),
    days,
    impliedFeeBTC: fee,
  };
}

function compareCandidates(a: Candidate, b: Candidate): number {
  return (
    a.sourceTier - b.sourceTier ||
    a.affinityTier - b.affinityTier ||
    a.feeSats - b.feeSats ||
    a.days - b.days ||
    a.order - b.order
  );
}

function sameScore(a: Candidate, b: Candidate): boolean {
  return a.sourceTier === b.sourceTier && a.affinityTier === b.affinityTier && a.feeSats === b.feeSats && a.days === b.days;
}

function toPair(out: Transaction, inp: Transaction, manual: boolean): TransferPair {
  const impliedFee = Math.max(0, out.amountBTC - inp.amountBTC);
  const confidence =
    manual || (impliedFee < FEE_AUTO_THRESHOLD && impliedFee <= out.amountBTC * FEE_CONFIDENT_FRACTION)
      ? MatchConfidence.Confident
      : MatchConfidence.Flagged;
  return {
    transferOut: out,
    transferIn: inp,
    amountBTC: out.amountBTC,
    daysBetween: daysBetweenDates(out.date, inp.date),
    impliedFeeBTC: impliedFee,
    confidence,
    ...(manual ? { manual: true } : {}),
  };
}

/**
 * Pair candidates best-first. Each accepted pair is the best remaining option for both of
 * its transactions. When an equally good option would pair one side with a DIFFERENT wallet
 * (e.g. two accounts making identical same-day transfers), the choice is a coin flip, so all
 * transactions involved are left unpaired (returned as ambiguous) for the user to match.
 * Rivals in the same wallet are interchangeable — pairing either is correct.
 */
function assignPairs(candidates: Candidate[], detectAmbiguity: boolean) {
  candidates.sort(compareCandidates);
  const byOut = new Map<string, Candidate[]>();
  const byIn = new Map<string, Candidate[]>();
  const index = (m: Map<string, Candidate[]>, id: string, c: Candidate) => {
    const list = m.get(id);
    if (list) list.push(c);
    else m.set(id, [c]);
  };
  for (const c of candidates) {
    index(byOut, c.out.id, c);
    index(byIn, c.inp.id, c);
  }

  const taken = new Set<string>();
  const ambiguous = new Set<string>();
  const available = (id: string) => !taken.has(id) && !ambiguous.has(id);
  const accepted: Candidate[] = [];

  for (const c of candidates) {
    if (!available(c.out.id) || !available(c.inp.id)) continue;

    if (detectAmbiguity) {
      const rivals = [
        ...byOut.get(c.out.id)!.filter((r) => r !== c && available(r.inp.id) && sameScore(r, c) && walletKey(r.inp) !== walletKey(c.inp)),
        ...byIn.get(c.inp.id)!.filter((r) => r !== c && available(r.out.id) && sameScore(r, c) && walletKey(r.out) !== walletKey(c.out)),
      ];
      if (rivals.length > 0) {
        for (const x of [c, ...rivals]) {
          ambiguous.add(x.out.id);
          ambiguous.add(x.inp.id);
        }
        continue;
      }
    }

    taken.add(c.out.id);
    taken.add(c.inp.id);
    accepted.push(c);
  }

  return { accepted, ambiguous };
}

/** Build all plausible (out, in) candidates between the given transfers. */
function buildCandidates(outs: Transaction[], ins: Transaction[], orderIndex: Map<string, number>): Candidate[] {
  const time = (t: Transaction) => new Date(t.date).getTime();
  const sortedIns = ins
    .map((t) => ({ t, time: time(t) }))
    .filter((x) => !Number.isNaN(x.time))
    .sort((a, b) => a.time - b.time || orderIndex.get(a.t.id)! - orderIndex.get(b.t.id)!);

  const found: Array<{ c: Omit<Candidate, "order">; outTime: number; inTime: number }> = [];
  for (const out of outs) {
    const outTime = time(out);
    if (Number.isNaN(outTime)) continue;
    // Binary search: first deposit at or after this withdrawal
    let lo = 0;
    let hi = sortedIns.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (sortedIns[mid].time < outTime) lo = mid + 1;
      else hi = mid;
    }
    for (let j = lo; j < sortedIns.length; j++) {
      const { t: inp, time: inTime } = sortedIns[j];
      if (inTime - outTime >= (MAX_DAYS_WINDOW + 1) * DAY_MS) break;
      const c = evaluatePair(out, inp, outTime, inTime);
      if (c) found.push({ c, outTime, inTime });
    }
  }
  // Final tie-break order: chronological by withdrawal, then deposit, then input order —
  // deterministic regardless of how the transactions array happens to be ordered.
  found.sort((a, b) =>
    a.outTime - b.outTime ||
    a.inTime - b.inTime ||
    orderIndex.get(a.c.out.id)! - orderIndex.get(b.c.out.id)! ||
    orderIndex.get(a.c.inp.id)! - orderIndex.get(b.c.inp.id)!
  );
  return found.map(({ c }, order) => ({ ...c, order }));
}

/**
 * Pair Transfer Outs with Transfer Ins and compute per-wallet balances.
 *
 * Precedence: manual matches first (always honored), then — if auto-matching is on — automatic
 * matching over the remaining transfers, excluding any the user unmatched.
 *
 * Automatic matching pairs a withdrawal with a deposit when the amounts agree (allowing a
 * plausible miner fee) and the deposit lands 0–7 days later. Among several plausible
 * partners it prefers, in order: a deposit whose assigned source wallet is this withdrawal's
 * wallet; a deposit labeled with the withdrawal's account (same exchange label, or an
 * exchange label naming the source wallet); the smallest implied fee; the fewest days.
 * When two different pairings tie on all of those, nothing is paired (see assignPairs).
 */
export function reconcileTransfers(transactions: Transaction[], options: ReconcileOptions = {}): ReconciliationResult {
  const autoMatch = options.autoMatch ?? true;
  const byId = new Map<string, Transaction>();
  const orderIndex = new Map<string, number>();
  transactions.forEach((t, i) => {
    byId.set(t.id, t);
    orderIndex.set(t.id, i);
  });
  const chrono = (a: Transaction, b: Transaction) =>
    new Date(a.date).getTime() - new Date(b.date).getTime() || orderIndex.get(a.id)! - orderIndex.get(b.id)!;

  const allOuts = transactions.filter((t) => t.transactionType === TransactionType.TransferOut).sort(chrono);
  const allIns = transactions.filter((t) => t.transactionType === TransactionType.TransferIn).sort(chrono);

  // 1. Manual matches — validated against current data (a deleted or re-typed transaction
  //    silently drops its match; a transaction can belong to at most one pair).
  const paired = new Set<string>();
  const manualTransfers: TransferPair[] = [];
  for (const ref of options.manualMatches ?? []) {
    const out = byId.get(ref.outId);
    const inp = byId.get(ref.inId);
    if (!out || !inp) continue;
    if (out.transactionType !== TransactionType.TransferOut || inp.transactionType !== TransactionType.TransferIn) continue;
    if (paired.has(out.id) || paired.has(inp.id)) continue;
    paired.add(out.id);
    paired.add(inp.id);
    manualTransfers.push(toPair(out, inp, true));
  }

  // 2. Transfers the user unmatched are withheld from auto-matching (only while both halves exist)
  const withheld = new Set<string>();
  for (const key of options.rejectedPairKeys ?? []) {
    const [outId, inId] = key.split("|");
    if (outId && inId && byId.has(outId) && byId.has(inId)) {
      withheld.add(outId);
      withheld.add(inId);
    }
  }

  // 3. Automatic matching over what's left
  const matchedTransfers: TransferPair[] = [];
  let ambiguous = new Set<string>();
  if (autoMatch) {
    const eligible = (t: Transaction) => !paired.has(t.id) && !withheld.has(t.id);
    const candidates = buildCandidates(allOuts.filter(eligible), allIns.filter(eligible), orderIndex);
    const result = assignPairs(candidates, true);
    ambiguous = result.ambiguous;
    for (const c of result.accepted) {
      paired.add(c.out.id);
      paired.add(c.inp.id);
      matchedTransfers.push(toPair(c.out, c.inp, false));
    }
    matchedTransfers.sort((a, b) => chrono(a.transferOut, b.transferOut));
  }

  const unmatchedTransferOuts = allOuts.filter((t) => !paired.has(t.id));
  const unmatchedTransferIns = allIns.filter((t) => !paired.has(t.id));

  // 4. Per-wallet balances, keyed exactly like the cost-basis engine and Holdings
  //    (wallet, else exchange; trimmed + case-insensitive). Display uses first-seen spelling.
  const balances = new Map<string, WalletBalance>();
  const add = (name: string, field: "totalIn" | "totalOut", amount: number) => {
    const key = norm(name);
    let b = balances.get(key);
    if (!b) {
      b = { wallet: name.trim(), totalIn: 0, totalOut: 0, netBalance: 0 };
      balances.set(key, b);
    }
    b[field] += amount;
  };
  for (const t of transactions) {
    switch (t.transactionType) {
      case TransactionType.Buy:
      case TransactionType.TransferIn:
        add(walletOf(t), "totalIn", t.amountBTC);
        break;
      case TransactionType.Sell:
      case TransactionType.Donation:
      case TransactionType.TransferOut:
        add(walletOf(t), "totalOut", t.amountBTC);
        break;
    }
  }
  // A Transfer In with an assigned source wallet but no Transfer Out record still took the
  // coins out of that source wallet — the engine moves the lots from there. Count that
  // implied withdrawal so "Transfer In only" bookkeeping balances. Before doing so, net
  // against any unpaired Transfer Out from that same source wallet (e.g. auto-matching is
  // off, or the pairing was ambiguous) so one movement is never subtracted twice.
  const sourceAssignedIns = unmatchedTransferIns.filter((t) => norm(t.sourceWallet) && !withheld.has(t.id));
  const nettable = unmatchedTransferOuts.filter((t) => !withheld.has(t.id));
  const netted = assignPairs(buildCandidates(nettable, sourceAssignedIns, orderIndex), false);
  const nettedIns = new Set(netted.accepted.map((c) => c.inp.id));
  for (const t of unmatchedTransferIns) {
    if (norm(t.sourceWallet) && !nettedIns.has(t.id)) add(t.sourceWallet!, "totalOut", t.amountBTC);
  }
  for (const b of balances.values()) {
    b.netBalance = b.totalIn - b.totalOut;
  }
  const walletBalances = Array.from(balances.values()).sort((a, b) => a.wallet.localeCompare(b.wallet));

  // 5. Suggestions
  const ambiguousTransferIds = [...ambiguous].filter((id) => !paired.has(id));
  const suggestedMissing: string[] = [];
  for (const b of walletBalances) {
    if (b.netBalance < -NEGATIVE_FEE_TOLERANCE) {
      suggestedMissing.push(
        `${b.wallet || "(no wallet)"}: Balance is negative (${b.netBalance.toFixed(8)} BTC). You may be missing buy or transfer-in transactions for this wallet.`
      );
    }
  }
  const listWallets = (txns: Transaction[]) => Array.from(new Set(txns.map((t) => walletOf(t)))).join(", ");
  // Ambiguous transfers get their own message below — they do have candidates, just not a unique one
  const isAmbiguous = new Set(ambiguousTransferIds);
  const lonelyOuts = unmatchedTransferOuts.filter((t) => !isAmbiguous.has(t.id));
  if (lonelyOuts.length > 0) {
    suggestedMissing.push(
      `${lonelyOuts.length} unmatched outgoing transfer${lonelyOuts.length === 1 ? "" : "s"} from ${listWallets(lonelyOuts)}. This is normal for withdrawals to a wallet you don't track here; otherwise check the destination wallet for a missing Transfer In.`
    );
  }
  const needSource = unmatchedTransferIns.filter((t) => !norm(t.sourceWallet) && !isAmbiguous.has(t.id));
  if (needSource.length > 0) {
    suggestedMissing.push(
      `${needSource.length} incoming transfer${needSource.length === 1 ? "" : "s"} to ${listWallets(needSource)} ${needSource.length === 1 ? "has" : "have"} no matching withdrawal and no source wallet. Assign a source wallet (Transactions → Assign) so the cost basis moves with the coins.`
    );
  }
  if (ambiguousTransferIds.length > 0) {
    suggestedMissing.push(
      `${ambiguousTransferIds.length} transfers were not auto-matched because more than one pairing fits equally well (same amount and date from different wallets). Match them manually below, or assign each Transfer In's source wallet.`
    );
  }

  return {
    matchedTransfers,
    manualTransfers,
    unmatchedTransferOuts,
    unmatchedTransferIns,
    ambiguousTransferIds,
    walletBalances,
    suggestedMissing,
  };
}

export interface SourceWalletSuggestion {
  wallet: string;
  reason: string;
  confidence: MatchConfidence;
}

/**
 * Suggest the source wallet for a Transfer In from the paper trail: the Transfer Out it is
 * paired with (a manual match, else an automatic one). Returns null if there is none.
 *
 * Existing source-wallet assignments on Transfer Ins are ignored here: the suggestion exists to
 * help choose that assignment, so it must come from the withdrawal/deposit records alone — an
 * assignment made from an earlier wrong suggestion would otherwise be echoed back as evidence.
 */
export function suggestSourceWallet(
  txn: Transaction,
  allTransactions: Transaction[],
  options: ReconcileOptions = {}
): SourceWalletSuggestion | null {
  if (txn.transactionType !== TransactionType.TransferIn) return null;

  const evidenceOnly = allTransactions.map((t) =>
    t.transactionType === TransactionType.TransferIn && t.sourceWallet ? { ...t, sourceWallet: undefined } : t
  );
  const { manualTransfers, matchedTransfers } = reconcileTransfers(evidenceOnly, options);
  const match =
    manualTransfers.find((p) => p.transferIn.id === txn.id) ??
    matchedTransfers.find((p) => p.transferIn.id === txn.id);
  if (!match) return null;

  const sourceWallet = walletOf(match.transferOut);
  const amount = match.transferOut.amountBTC.toFixed(8);
  const date = new Date(match.transferOut.date).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });

  return {
    wallet: sourceWallet,
    reason: match.manual
      ? `You matched this deposit to the ${amount} BTC withdrawal from ${sourceWallet} on ${date}`
      : `Matches ${amount} BTC withdrawal from ${sourceWallet} on ${date}`,
    confidence: match.confidence,
  };
}
