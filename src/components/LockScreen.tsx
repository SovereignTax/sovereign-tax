import { useState, useEffect, useCallback } from "react";
import { useAppState } from "../lib/app-state";
import {
  loadPINHash,
  loadPINSalt,
  loadPINAttempts,
  savePINAttempts,
  loadPINLockoutUntil,
  savePINLockoutUntil,
  clearPINAttempts,
} from "../lib/persistence";
import { hashPINWithPBKDF2, getLockoutDuration, formatLockoutTime } from "../lib/crypto";

export function LockScreen() {
  const { unlockWithPIN } = useAppState();
  const [pin, setPin] = useState("");
  const [showError, setShowError] = useState(false);
  const [errorMsg, setErrorMsg] = useState("Incorrect PIN. Try again.");
  const [isVerifying, setIsVerifying] = useState(false);
  const [lockoutRemaining, setLockoutRemaining] = useState(0);

  // Check lockout on mount and update countdown
  useEffect(() => {
    const lockoutUntil = loadPINLockoutUntil();
    if (lockoutUntil > Date.now()) {
      setLockoutRemaining(Math.ceil((lockoutUntil - Date.now()) / 1000));
    }

    const interval = setInterval(() => {
      const until = loadPINLockoutUntil();
      if (until > Date.now()) {
        setLockoutRemaining(Math.ceil((until - Date.now()) / 1000));
      } else {
        setLockoutRemaining(0);
      }
    }, 1000);

    return () => clearInterval(interval);
  }, []);

  const isLockedOut = lockoutRemaining > 0;

  const handleDigit = (digit: string) => {
    if (pin.length >= 6 || isLockedOut || isVerifying) return;
    setPin((p) => p + digit);
    setShowError(false);
  };

  const handleDelete = () => {
    if (isLockedOut || isVerifying) return;
    setPin((p) => p.slice(0, -1));
    setShowError(false);
  };

  const handleUnlock = useCallback(async () => {
    if (isLockedOut || isVerifying) return;

    setIsVerifying(true);
    try {
      const storedHash = loadPINHash();
      const storedSalt = loadPINSalt();

      if (!storedHash || !storedSalt) {
        // Legacy: no salt means old SHA-256 hash — force re-setup
        setErrorMsg("PIN data corrupted. Please clear data and set up again.");
        setShowError(true);
        setPin("");
        return;
      }

      const inputHash = await hashPINWithPBKDF2(pin, storedSalt);

      if (inputHash === storedHash) {
        // Success — clear attempts, derive encryption key, and load data
        clearPINAttempts();
        await unlockWithPIN(pin);
      } else {
        // Failed — increment attempts and apply lockout
        const attempts = loadPINAttempts() + 1;
        savePINAttempts(attempts);

        const lockoutSecs = getLockoutDuration(attempts);
        if (lockoutSecs > 0) {
          const lockoutUntil = Date.now() + lockoutSecs * 1000;
          savePINLockoutUntil(lockoutUntil);
          setLockoutRemaining(lockoutSecs);
          setErrorMsg(
            `Incorrect PIN. Too many attempts — locked for ${formatLockoutTime(lockoutSecs)}.`
          );
        } else {
          setErrorMsg("Incorrect PIN. Try again.");
        }

        setShowError(true);
        setPin("");
      }
    } finally {
      setIsVerifying(false);
    }
  }, [pin, isLockedOut, isVerifying, unlockWithPIN]);

  return (
    <div className="flex flex-col items-center justify-center h-screen bg-gray-50 dark:bg-zinc-900">
      <div className="text-5xl mb-6">🔒</div>
      <h1 className="text-2xl font-semibold mb-2">Sovereign Tax</h1>
      <p className="text-gray-500 mb-6">Enter your PIN to unlock</p>

      {/* PIN dots */}
      <div className="flex gap-3 mb-6">
        {Array.from({ length: 6 }).map((_, i) => (
          <div
            key={i}
            className={`w-4 h-4 rounded-full ${
              i < pin.length ? "bg-orange-500" : "bg-gray-300 dark:bg-gray-600"
            }`}
          />
        ))}
      </div>

      {showError && (
        <p className="text-red-500 text-sm mb-4">{errorMsg}</p>
      )}

      {isLockedOut && (
        <p className="text-amber-500 text-sm mb-4 font-medium">
          Locked — try again in {formatLockoutTime(lockoutRemaining)}
        </p>
      )}

      {/* Keypad */}
      <div className="space-y-3">
        {[
          ["1", "2", "3"],
          ["4", "5", "6"],
          ["7", "8", "9"],
        ].map((row, ri) => (
          <div key={ri} className="flex gap-3">
            {row.map((d) => (
              <button
                key={d}
                className="pin-btn"
                onClick={() => handleDigit(d)}
                disabled={isLockedOut || isVerifying}
              >
                {d}
              </button>
            ))}
          </div>
        ))}
        <div className="flex gap-3 justify-center">
          <button className="pin-btn invisible" aria-hidden="true">0</button>
          <button
            className="pin-btn"
            onClick={() => handleDigit("0")}
            disabled={isLockedOut || isVerifying}
          >
            0
          </button>
          <button
            className="pin-btn text-base"
            onClick={handleDelete}
            disabled={isLockedOut || isVerifying}
          >
            ⌫
          </button>
        </div>
      </div>

      {/* Unlock button */}
      <button
        className="btn-primary mt-6 w-40"
        disabled={pin.length < 4 || isLockedOut || isVerifying}
        style={{ opacity: pin.length >= 4 && !isLockedOut ? 1 : 0.3 }}
        onClick={handleUnlock}
      >
        {isVerifying ? "Verifying..." : "Unlock"}
      </button>
    </div>
  );
}
