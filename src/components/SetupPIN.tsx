import { useState } from "react";
import { useAppState } from "../lib/app-state";
import { savePINHash, savePINSalt } from "../lib/persistence";
import { generateSalt, hashPINWithPBKDF2 } from "../lib/crypto";

export function SetupPIN({ isInitialSetup, onDone }: { isInitialSetup: boolean; onDone?: () => void }) {
  const { unlockWithPIN } = useAppState();
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
      // Generate a fresh random salt and derive PBKDF2 hash
      const salt = generateSalt();
      const hash = await hashPINWithPBKDF2(pin, salt);
      savePINSalt(salt);
      savePINHash(hash);
      // Derive encryption key and load/encrypt data
      await unlockWithPIN(pin);
      onDone?.();
    } finally {
      setIsHashing(false);
    }
  };

  return (
    <div className="flex flex-col items-center justify-center h-screen bg-gray-50 dark:bg-zinc-900">
      <div className="text-5xl mb-6">{isInitialSetup ? "🛡️" : "🔄"}</div>
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

      {!isConfirming && pin.length >= 4 && (
        <button className="btn-primary mt-6 w-40" onClick={handleContinue} disabled={isHashing}>
          Continue
        </button>
      )}
      {isConfirming && confirmPin.length >= 4 && (
        <button className="btn-primary mt-6 w-40" onClick={handleSetPIN} disabled={isHashing}>
          {isHashing ? "Securing..." : "Set PIN"}
        </button>
      )}
    </div>
  );
}
