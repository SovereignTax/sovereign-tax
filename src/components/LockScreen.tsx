import { useState, useEffect, useCallback, useMemo } from "react";
import { useAppState } from "../lib/app-state";
import logo from "../assets/icon-128.png";
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

const satoshiQuotes = [
  "If you don't believe it or don't get it, I don't have the time to try to convince you, sorry.",
  "The root problem with conventional currency is all the trust that's required to make it work.",
  "It might make sense just to get some in case it catches on.",
  "The nature of Bitcoin is such that once version 0.1 was released, the core design was set in stone for the rest of its lifetime.",
  "Lost coins only make everyone else's coins worth slightly more. Think of it as a donation to everyone.",
  "I've been working on a new electronic cash system that's fully peer-to-peer, with no trusted third party.",
  "With e-currency based on cryptographic proof, without the need to trust a third party middleman, money can be secure.",
  "The Times 03/Jan/2009 Chancellor on brink of second bailout for banks.",
  "Writing a description for this thing for general audiences is bloody hard. There's nothing to relate it to.",
  "In a few decades when the reward gets too small, the transaction fee will become the main compensation for nodes.",
];

export function LockScreen() {
  const { unlockWithPIN } = useAppState();
  const quote = useMemo(() => satoshiQuotes[Math.floor(Math.random() * satoshiQuotes.length)], []);
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
        try {
          await unlockWithPIN(pin);
        } catch (unlockErr) {
          console.error("Unlock failed:", unlockErr);
          setErrorMsg("Failed to load data. Please try again or contact support.");
          setShowError(true);
          setPin("");
          return;
        }
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

  // Keyboard support — type digits, Backspace to delete, Enter to unlock
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key >= "0" && e.key <= "9") {
        handleDigit(e.key);
      } else if (e.key === "Backspace") {
        e.preventDefault();
        handleDelete();
      } else if (e.key === "Enter" && pin.length >= 4 && !isLockedOut && !isVerifying) {
        handleUnlock();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [pin, isLockedOut, isVerifying, handleUnlock]);

  return (
    <div className="relative flex flex-col items-center justify-center h-screen bg-gray-50 dark:bg-zinc-900">
      {/* Satoshi quote — top right easter egg */}
      <div className="absolute top-4 right-5 max-w-xs text-right animate-[fadeInQuote_1.5s_ease-in-out_0.5s_both]">
        <p className="text-xs italic text-orange-500/70 leading-relaxed">
          "{quote}"
        </p>
        <p className="text-[10px] text-orange-500/40 mt-0.5">
          — Satoshi Nakamoto
        </p>
      </div>

      <img src={logo} alt="Sovereign Tax" className="w-12 h-12 rounded-xl mb-6" />
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

      {/* Unlock button — always visible to prevent layout shift */}
      <button
        className="btn-primary mt-6 w-40 transition-opacity duration-200"
        disabled={pin.length < 4 || isLockedOut || isVerifying}
        style={{ opacity: pin.length >= 4 && !isLockedOut ? 1 : 0.3 }}
        onClick={handleUnlock}
      >
        {isVerifying ? "Verifying..." : "Unlock"}
      </button>
    </div>
  );
}
