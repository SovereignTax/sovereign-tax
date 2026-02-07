import { useState, useMemo } from "react";
import { Lot } from "../lib/models";
import { formatUSD, formatBTC, formatDate } from "../lib/utils";
import { daysBetween } from "../lib/cost-basis";

export interface LotSelection {
  lotId: string;
  amountBTC: number;
}

interface LotPickerProps {
  lots: Lot[];
  targetAmount: number;
  onConfirm: (selections: LotSelection[]) => void;
  onCancel: () => void;
}

export function LotPicker({ lots, targetAmount, onConfirm, onCancel }: LotPickerProps) {
  const availableLots = lots.filter((l) => l.remainingBTC > 0);
  const [selections, setSelections] = useState<Record<string, number>>({});

  const totalSelected = Object.values(selections).reduce((a, b) => a + b, 0);
  const remaining = targetAmount - totalSelected;
  const isValid = Math.abs(remaining) < 0.00000001 && totalSelected > 0;

  const toggleLot = (lotId: string, maxAmount: number) => {
    setSelections((prev) => {
      const copy = { ...prev };
      if (copy[lotId]) {
        delete copy[lotId];
      } else {
        // Auto-fill remaining needed or max available
        const needed = targetAmount - Object.entries(copy).reduce((a, [, v]) => a + v, 0);
        copy[lotId] = Math.min(maxAmount, Math.max(0, needed));
      }
      return copy;
    });
  };

  const updateAmount = (lotId: string, value: string) => {
    const num = Number(value);
    if (isNaN(num) || num < 0) return;
    setSelections((prev) => {
      const copy = { ...prev };
      if (num === 0) {
        delete copy[lotId];
      } else {
        copy[lotId] = num;
      }
      return copy;
    });
  };

  const handleConfirm = () => {
    const result: LotSelection[] = Object.entries(selections)
      .filter(([, amt]) => amt > 0)
      .map(([lotId, amountBTC]) => ({ lotId, amountBTC }));
    onConfirm(result);
  };

  const now = new Date().toISOString();

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

      <div className="grid grid-cols-[40px_1fr_1fr_1fr_1fr_1fr_120px] gap-2 text-xs font-semibold text-gray-500 pb-2 border-b border-gray-200 dark:border-gray-700">
        <div></div>
        <div>Date</div>
        <div className="text-right">Available</div>
        <div className="text-right">Cost/BTC</div>
        <div className="text-right">Days Held</div>
        <div>Term</div>
        <div className="text-right">Amount to Sell</div>
      </div>

      {availableLots
        .sort((a, b) => new Date(a.purchaseDate).getTime() - new Date(b.purchaseDate).getTime())
        .map((lot) => {
          const isSelected = !!selections[lot.id];
          const daysHeld = daysBetween(lot.purchaseDate, now);
          const isLongTerm = daysHeld > 365;
          return (
            <div key={lot.id} className={`grid grid-cols-[40px_1fr_1fr_1fr_1fr_1fr_120px] gap-2 py-2 text-sm border-b border-gray-100 dark:border-gray-800 ${isSelected ? "bg-blue-50 dark:bg-blue-900/10" : ""}`}>
              <div>
                <input
                  type="checkbox"
                  checked={isSelected}
                  onChange={() => toggleLot(lot.id, lot.remainingBTC)}
                />
              </div>
              <div>{formatDate(lot.purchaseDate)}</div>
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
                    value={selections[lot.id] || ""}
                    onChange={(e) => updateAmount(lot.id, e.target.value)}
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

      <div className="flex gap-3 mt-4">
        <button className="btn-primary" disabled={!isValid} onClick={handleConfirm}>
          Confirm Selection
        </button>
        <button className="btn-secondary" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}
