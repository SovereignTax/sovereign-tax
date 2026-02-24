import { useState, useMemo } from "react";
import { Lot } from "../lib/models";
import { formatUSD, formatBTC, formatDate } from "../lib/utils";
import { daysBetween, isMoreThanOneYear, optimizeLotSelections } from "../lib/cost-basis";

export interface LotSelection {
  lotId: string;
  amountBTC: number;
}

interface LotPickerProps {
  lots: Lot[];
  targetAmount: number;
  saleDate?: string; // ISO date string — used for accurate holding period display (defaults to today)
  salePrice?: number; // USD per BTC — used by Optimize to compute estimated tax per lot
  initialSelections?: LotSelection[]; // Pre-fill from saved simulation selections
  onConfirm: (selections: LotSelection[]) => void;
  onCancel: () => void;
}

type SortField = "date" | "wallet" | "available" | "cost" | "daysHeld" | "term";
type SortDir = "asc" | "desc";

export function LotPicker({ lots, targetAmount, saleDate, salePrice, initialSelections, onConfirm, onCancel }: LotPickerProps) {
  const availableLots = lots.filter((l) => l.remainingBTC > 0);

  // Build initial selection map from saved selections (if provided and lot IDs still exist)
  const buildInitialMap = (): Record<string, number> => {
    if (!initialSelections || initialSelections.length === 0) return {};
    const availableIds = new Set(availableLots.map((l) => l.id));
    const map: Record<string, number> = {};
    for (const sel of initialSelections) {
      if (availableIds.has(sel.lotId)) {
        const lot = availableLots.find((l) => l.id === sel.lotId);
        // Clamp to current available amount (lot may have been partially consumed since simulation)
        map[sel.lotId] = lot ? Math.min(sel.amountBTC, lot.remainingBTC) : sel.amountBTC;
      }
    }
    return map;
  };

  const [selections, setSelections] = useState<Record<string, number>>(buildInitialMap);
  // String state for amount inputs — allows intermediate typing ("0.", "", etc.)
  // without the controlled input snapping to a normalized number mid-keystroke.
  const [inputTexts, setInputTexts] = useState<Record<string, string>>(() => {
    const texts: Record<string, string> = {};
    const initial = buildInitialMap();
    for (const [id, amt] of Object.entries(initial)) {
      texts[id] = amt.toFixed(8);
    }
    return texts;
  });
  const [sortField, setSortField] = useState<SortField>("date");
  const [sortDir, setSortDir] = useState<SortDir>("asc");

  const totalSelected = Object.values(selections).reduce((a, b) => a + b, 0);
  const remaining = targetAmount - totalSelected;
  const isValid = Math.abs(remaining) < 0.00000001 && totalSelected > 0;

  const toggleLot = (lotId: string, maxAmount: number) => {
    setSelections((prev) => {
      const copy = { ...prev };
      if (lotId in copy) {
        delete copy[lotId];
        setInputTexts((t) => { const c = { ...t }; delete c[lotId]; return c; });
      } else {
        // Auto-fill remaining needed or max available
        const needed = targetAmount - Object.entries(copy).reduce((a, [, v]) => a + v, 0);
        const amt = Math.min(maxAmount, Math.max(0, needed));
        copy[lotId] = amt;
        setInputTexts((t) => ({ ...t, [lotId]: amt.toFixed(8) }));
      }
      return copy;
    });
  };

  const updateAmount = (lotId: string, value: string, maxAvailable: number) => {
    // Always update the display string so the user can type freely
    setInputTexts((prev) => ({ ...prev, [lotId]: value }));
    // Parse and commit to numeric selections when valid
    const num = Number(value);
    if (!isNaN(num) && num >= 0) {
      const clamped = Math.min(num, maxAvailable);
      setSelections((prev) => ({ ...prev, [lotId]: clamped }));
    }
  };

  const handleAmountBlur = (lotId: string) => {
    // On blur, normalize the display to the committed numeric value
    const num = selections[lotId];
    if (num !== undefined && num > 0) {
      setInputTexts((prev) => ({ ...prev, [lotId]: num.toFixed(8) }));
    } else {
      // User left it empty/zero — show "0" but keep the lot checked
      setInputTexts((prev) => ({ ...prev, [lotId]: "0" }));
      setSelections((prev) => ({ ...prev, [lotId]: 0 }));
    }
  };

  /**
   * Auto-select lots to reduce tax burden.
   * Scores each lot by estimated tax per BTC using assumed rates (37% ST, 15% LT).
   * Losses get negative scores (tax savings), so they're picked first.
   * When no sale price is available (e.g. donations), falls back to long-term first + highest cost basis.
   */
  const optimizeSelections = () => {
    const result = optimizeLotSelections(availableLots, targetAmount, salePrice, saleDate);
    const newSelections: Record<string, number> = {};
    const newTexts: Record<string, string> = {};
    for (const s of result) {
      newSelections[s.lotId] = s.amountBTC;
      newTexts[s.lotId] = s.amountBTC.toFixed(8);
    }
    setSelections(newSelections);
    setInputTexts(newTexts);
  };

  const handleConfirm = () => {
    const result: LotSelection[] = Object.entries(selections)
      .filter(([, amt]) => amt > 0)
      .map(([lotId, amountBTC]) => ({ lotId, amountBTC }));
    onConfirm(result);
  };

  // Use sale date for accurate holding period display; fall back to today for simulations
  const referenceDate = saleDate || new Date().toISOString();

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortField(field);
      setSortDir("asc");
    }
  };

  const sortIndicator = (field: SortField) => {
    if (sortField !== field) return "";
    return sortDir === "asc" ? " \u25B2" : " \u25BC";
  };

  const sortedLots = useMemo(() => {
    const lotsWithMeta = availableLots.map((lot) => ({
      lot,
      daysHeld: daysBetween(lot.purchaseDate, referenceDate),
      isLongTerm: isMoreThanOneYear(lot.purchaseDate, referenceDate),
      walletName: (lot.wallet || lot.exchange || "").toLowerCase(),
    }));

    lotsWithMeta.sort((a, b) => {
      let cmp = 0;
      switch (sortField) {
        case "date":
          cmp = new Date(a.lot.purchaseDate).getTime() - new Date(b.lot.purchaseDate).getTime();
          break;
        case "wallet":
          cmp = a.walletName.localeCompare(b.walletName);
          break;
        case "available":
          cmp = a.lot.remainingBTC - b.lot.remainingBTC;
          break;
        case "cost":
          cmp = a.lot.pricePerBTC - b.lot.pricePerBTC;
          break;
        case "daysHeld":
          cmp = a.daysHeld - b.daysHeld;
          break;
        case "term":
          cmp = (a.isLongTerm ? 1 : 0) - (b.isLongTerm ? 1 : 0);
          break;
      }
      return sortDir === "asc" ? cmp : -cmp;
    });

    return lotsWithMeta;
  }, [availableLots, sortField, sortDir, referenceDate]);

  return (
    <div className="card">
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-semibold">Select Lots (Specific Identification)</h3>
        <div className="text-sm">
          <span className="text-gray-500">Target:</span>{" "}
          <span className="tabular-nums font-medium">{formatBTC(targetAmount)} BTC</span>
          {" | "}
          <span className="text-gray-500">Selected:</span>{" "}
          <span className={`tabular-nums font-medium ${isValid ? "text-green-600" : remaining > 0 ? "text-orange-500" : "text-red-500"}`}>
            {formatBTC(totalSelected)} BTC
          </span>
        </div>
      </div>

      <div className="grid grid-cols-[40px_1fr_1fr_1fr_1fr_1fr_1fr_120px] gap-2 text-xs font-semibold text-gray-500 pb-2 border-b border-gray-200 dark:border-gray-700">
        <div></div>
        <div className="cursor-pointer hover:text-gray-700 dark:hover:text-gray-300 select-none" onClick={() => handleSort("date")}>Date{sortIndicator("date")}</div>
        <div className="cursor-pointer hover:text-gray-700 dark:hover:text-gray-300 select-none" onClick={() => handleSort("wallet")}>Wallet{sortIndicator("wallet")}</div>
        <div className="text-right cursor-pointer hover:text-gray-700 dark:hover:text-gray-300 select-none" onClick={() => handleSort("available")}>Available{sortIndicator("available")}</div>
        <div className="text-right cursor-pointer hover:text-gray-700 dark:hover:text-gray-300 select-none" onClick={() => handleSort("cost")}>Cost/BTC{sortIndicator("cost")}</div>
        <div className="text-right cursor-pointer hover:text-gray-700 dark:hover:text-gray-300 select-none" onClick={() => handleSort("daysHeld")}>Days Held{sortIndicator("daysHeld")}</div>
        <div className="cursor-pointer hover:text-gray-700 dark:hover:text-gray-300 select-none" onClick={() => handleSort("term")}>Term{sortIndicator("term")}</div>
        <div className="text-right">Amount to Sell</div>
      </div>

      {sortedLots.map(({ lot, daysHeld, isLongTerm }) => {
          const isSelected = lot.id in selections;
          const termBg = isSelected
            ? "bg-blue-50 dark:bg-blue-900/10"
            : isLongTerm
              ? "bg-green-50/40 dark:bg-green-900/5"
              : "bg-orange-50/40 dark:bg-orange-900/5";
          return (
            <div key={lot.id} className={`grid grid-cols-[40px_1fr_1fr_1fr_1fr_1fr_1fr_120px] gap-2 py-2 text-sm border-b border-gray-100 dark:border-gray-800 ${termBg}`}>
              <div>
                <input
                  type="checkbox"
                  checked={isSelected}
                  onChange={() => toggleLot(lot.id, lot.remainingBTC)}
                />
              </div>
              <div>{formatDate(lot.purchaseDate)}</div>
              <div className="text-xs text-gray-500 truncate" title={lot.wallet || lot.exchange}>{lot.wallet || lot.exchange}</div>
              <div className="text-right tabular-nums">{formatBTC(lot.remainingBTC)}</div>
              <div className="text-right tabular-nums">{formatUSD(lot.pricePerBTC)}</div>
              <div className="text-right tabular-nums">{daysHeld}</div>
              <div>
                <span className={`badge ${isLongTerm ? "badge-green" : "badge-orange"} text-xs`}>
                  {isLongTerm ? "Long" : "Short"}
                </span>
              </div>
              <div className="text-right">
                {isSelected && (
                  <input
                    className="input w-full text-right text-sm"
                    value={inputTexts[lot.id] ?? ""}
                    onChange={(e) => updateAmount(lot.id, e.target.value, lot.remainingBTC)}
                    onBlur={() => handleAmountBlur(lot.id)}
                    max={lot.remainingBTC}
                  />
                )}
              </div>
            </div>
          );
        })}

      {remaining > 0.00000001 && (
        <div className="text-sm text-orange-500 mt-2">
          Still need {formatBTC(remaining)} BTC to meet target
        </div>
      )}
      {remaining < -0.00000001 && (
        <div className="text-sm text-red-500 mt-2">
          Over-selected by {formatBTC(Math.abs(remaining))} BTC
        </div>
      )}

      <div className="sticky bottom-0 bg-white dark:bg-zinc-900 pt-3 pb-1 border-t border-gray-200 dark:border-gray-700 mt-4 flex items-center gap-3">
        <button className="btn-primary" disabled={!isValid} onClick={handleConfirm}>
          Confirm Selection
        </button>
        <button className="btn-secondary" onClick={optimizeSelections}>
          ✨ Optimize
        </button>
        <button className="btn-secondary" onClick={onCancel}>Cancel</button>
        <span className="text-xs text-gray-400 ml-2">Optimize picks lots with the lowest estimated tax (losses first, then smallest gains)</span>
      </div>
    </div>
  );
}
