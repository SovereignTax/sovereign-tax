import { useState, useMemo, useEffect } from "react";
import { useAppState } from "../lib/app-state";
import { savePINHash, savePINSalt } from "../lib/persistence";
import { generateSalt, hashPINWithPBKDF2 } from "../lib/crypto";
import logo from "../assets/icon-128.png";

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

export function SetupPIN({ isInitialSetup, onDone }: { isInitialSetup: boolean; onDone?: () => void }) {
  const { unlockWithPIN, changePIN } = useAppState();
  const quote = useMemo(() => satoshiQuotes[Math.floor(Math.random() * satoshiQuotes.length)], []);
  const [pin, setPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [isConfirming, setIsConfirming] = useState(false);
  const [showError, setShowError] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const [isHashing, setIsHashing] = useState(false);

  const currentPin = isConfirming ? confirmPin : pin;
  const setCurrentPin = isConfirming ? setConfirmPin : setPin;

  const handleDigit = (digit: string) => {
    if (currentPin.length >= 6) return;
    setCurrentPin((p) => p + digit);
    setShowError(false);
  };

  const handleDelete = () => {
    setCurrentPin((p) => p.slice(0, -1));
    setShowError(false);
  };

  const handleContinue = () => {
    setIsConfirming(true);
    setShowError(false);
  };

  const handleSetPIN = async () => {
    if (pin !== confirmPin) {
      setErrorMsg("PINs don't match. Try again.");
      setShowError(true);
      setConfirmPin("");
      return;
    }
    if (pin.length < 4 || pin.length > 6) {
      setErrorMsg("PIN must be 4-6 digits");
      setShowError(true);
      return;
    }

    setIsHashing(true);
    try {
      if (isInitialSetup) {
        // First-time setup: save PIN hash/salt, then derive encryption key
        const salt = generateSalt();
        const hash = await hashPINWithPBKDF2(pin, salt);
        savePINSalt(salt);
        savePINHash(hash);
        await unlockWithPIN(pin);
      } else {
        // PIN change: decrypt data with old key, re-encrypt with new key
        await changePIN(pin);
      }
      onDone?.();
    } finally {
      setIsHashing(false);
    }
  };

  // Keyboard support — type digits, Backspace to delete, Enter to continue/confirm
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (isHashing) return;
      if (e.key >= "0" && e.key <= "9") {
        handleDigit(e.key);
      } else if (e.key === "Backspace") {
        e.preventDefault();
        handleDelete();
      } else if (e.key === "Enter" && currentPin.length >= 4) {
        if (isConfirming) handleSetPIN();
        else handleContinue();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [currentPin, isConfirming, isHashing]);

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
      <h1 className="text-2xl font-semibold mb-2">
        {isInitialSetup ? "Create Your PIN" : "Change PIN"}
      </h1>
      <p className="text-gray-500 mb-6">
        {isConfirming ? "Confirm your PIN" : isInitialSetup ? "Choose a 4-6 digit PIN" : "Enter new PIN"}
      </p>

      <div className="flex gap-3 mb-6">
        {Array.from({ length: 6 }).map((_, i) => (
          <div
            key={i}
            className={`w-4 h-4 rounded-full ${
              i < currentPin.length ? "bg-orange-500" : "bg-gray-300 dark:bg-gray-600"
            }`}
          />
        ))}
      </div>

      {showError && <p className="text-red-500 text-sm mb-4">{errorMsg}</p>}

      <div className="space-y-3">
        {[["1", "2", "3"], ["4", "5", "6"], ["7", "8", "9"]].map((row, ri) => (
          <div key={ri} className="flex gap-3">
            {row.map((d) => (
              <button key={d} className="pin-btn" onClick={() => handleDigit(d)} disabled={isHashing}>
                {d}
              </button>
            ))}
          </div>
        ))}
        <div className="flex gap-3 justify-center">
          <button className="pin-btn invisible" aria-hidden="true">0</button>
          <button className="pin-btn" onClick={() => handleDigit("0")} disabled={isHashing}>0</button>
          <button className="pin-btn text-base" onClick={handleDelete} disabled={isHashing}>⌫</button>
        </div>
      </div>

      {/* Button always visible to prevent layout shift */}
      <button
        className="btn-primary mt-6 w-40 transition-opacity duration-200"
        disabled={currentPin.length < 4 || isHashing}
        style={{ opacity: currentPin.length >= 4 ? 1 : 0.3 }}
        onClick={isConfirming ? handleSetPIN : handleContinue}
      >
        {isHashing ? "Securing..." : isConfirming ? "Set PIN" : "Continue"}
      </button>
    </div>
  );
}
