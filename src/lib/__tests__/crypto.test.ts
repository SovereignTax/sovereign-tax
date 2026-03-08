import { describe, it, expect } from "vitest";
import {
  bufferToHex,
  hexToBuffer,
  generateSalt,
  hashPINWithPBKDF2,
  deriveEncryptionKey,
  encryptData,
  decryptData,
  isEncryptedData,
  getLockoutDuration,
  formatLockoutTime,
} from "../crypto";

// ---------------------------------------------------------------------------
// bufferToHex / hexToBuffer — hex encoding round-trip
// ---------------------------------------------------------------------------
describe("bufferToHex", () => {
  it("encodes empty buffer", () => {
    expect(bufferToHex(new Uint8Array([]).buffer)).toBe("");
  });

  it("encodes single byte", () => {
    expect(bufferToHex(new Uint8Array([0xff]).buffer)).toBe("ff");
  });

  it("pads single-digit hex values with leading zero", () => {
    expect(bufferToHex(new Uint8Array([0x0a]).buffer)).toBe("0a");
  });

  it("encodes multiple bytes", () => {
    expect(bufferToHex(new Uint8Array([0xde, 0xad, 0xbe, 0xef]).buffer)).toBe("deadbeef");
  });
});

describe("hexToBuffer", () => {
  it("decodes empty string", () => {
    expect(hexToBuffer("")).toEqual(new Uint8Array([]));
  });

  it("decodes single byte", () => {
    expect(hexToBuffer("ff")).toEqual(new Uint8Array([0xff]));
  });

  it("decodes multiple bytes", () => {
    expect(hexToBuffer("deadbeef")).toEqual(new Uint8Array([0xde, 0xad, 0xbe, 0xef]));
  });
});

describe("hex round-trip", () => {
  it("bufferToHex → hexToBuffer preserves data", () => {
    const original = new Uint8Array([0, 1, 127, 128, 255]);
    const hex = bufferToHex(original.buffer);
    const roundTripped = hexToBuffer(hex);
    expect(roundTripped).toEqual(original);
  });
});

// ---------------------------------------------------------------------------
// generateSalt
// ---------------------------------------------------------------------------
describe("generateSalt", () => {
  it("returns 32-char hex string (16 bytes)", () => {
    const salt = generateSalt();
    expect(salt).toHaveLength(32);
    expect(/^[0-9a-f]{32}$/.test(salt)).toBe(true);
  });

  it("generates unique salts", () => {
    const salts = new Set(Array.from({ length: 10 }, () => generateSalt()));
    expect(salts.size).toBe(10);
  });
});

// ---------------------------------------------------------------------------
// hashPINWithPBKDF2
// ---------------------------------------------------------------------------
describe("hashPINWithPBKDF2", () => {
  const salt = "a".repeat(32); // Fixed salt for deterministic tests

  it("returns 64-char hex string (256 bits)", async () => {
    const hash = await hashPINWithPBKDF2("1234", salt);
    expect(hash).toHaveLength(64);
    expect(/^[0-9a-f]{64}$/.test(hash)).toBe(true);
  });

  it("same PIN + salt produces same hash", async () => {
    const h1 = await hashPINWithPBKDF2("1234", salt);
    const h2 = await hashPINWithPBKDF2("1234", salt);
    expect(h1).toBe(h2);
  });

  it("different PINs produce different hashes", async () => {
    const h1 = await hashPINWithPBKDF2("1234", salt);
    const h2 = await hashPINWithPBKDF2("5678", salt);
    expect(h1).not.toBe(h2);
  });

  it("different salts produce different hashes", async () => {
    const salt2 = "b".repeat(32);
    const h1 = await hashPINWithPBKDF2("1234", salt);
    const h2 = await hashPINWithPBKDF2("1234", salt2);
    expect(h1).not.toBe(h2);
  });
});

// ---------------------------------------------------------------------------
// AES-256-GCM encrypt / decrypt round-trip
// ---------------------------------------------------------------------------
describe("encryptData / decryptData", () => {
  const salt = "c".repeat(32);

  it("round-trips short plaintext", async () => {
    const key = await deriveEncryptionKey("testpass", salt);
    const plaintext = "Hello, World!";
    const encrypted = await encryptData(plaintext, key);
    const decrypted = await decryptData(encrypted, key);
    expect(decrypted).toBe(plaintext);
  });

  it("round-trips JSON data", async () => {
    const key = await deriveEncryptionKey("testpass", salt);
    const data = { transactions: [{ id: "1", amount: 0.5 }], count: 42 };
    const plaintext = JSON.stringify(data);
    const encrypted = await encryptData(plaintext, key);
    const decrypted = await decryptData(encrypted, key);
    expect(JSON.parse(decrypted)).toEqual(data);
  });

  it("round-trips empty string", async () => {
    const key = await deriveEncryptionKey("testpass", salt);
    const encrypted = await encryptData("", key);
    const decrypted = await decryptData(encrypted, key);
    expect(decrypted).toBe("");
  });

  it("round-trips large data (>8KB, tests chunked encoding)", async () => {
    const key = await deriveEncryptionKey("testpass", salt);
    // Generate ~20KB of data to test the chunked base64 encoding path
    const largeText = "x".repeat(20_000);
    const encrypted = await encryptData(largeText, key);
    const decrypted = await decryptData(encrypted, key);
    expect(decrypted).toBe(largeText);
  });

  it("produces different ciphertext each time (unique IV)", async () => {
    const key = await deriveEncryptionKey("testpass", salt);
    const plaintext = "same input";
    const e1 = await encryptData(plaintext, key);
    const e2 = await encryptData(plaintext, key);
    expect(e1).not.toBe(e2); // Different IV each time
    // But both decrypt to the same value
    expect(await decryptData(e1, key)).toBe(plaintext);
    expect(await decryptData(e2, key)).toBe(plaintext);
  });

  it("wrong key fails to decrypt", async () => {
    const key1 = await deriveEncryptionKey("password1", salt);
    const key2 = await deriveEncryptionKey("password2", salt);
    const encrypted = await encryptData("secret", key1);
    await expect(decryptData(encrypted, key2)).rejects.toThrow();
  });

  it("tampered ciphertext fails to decrypt", async () => {
    const key = await deriveEncryptionKey("testpass", salt);
    const encrypted = await encryptData("secret", key);
    // Flip a character in the middle of the base64 string
    const chars = encrypted.split("");
    const mid = Math.floor(chars.length / 2);
    chars[mid] = chars[mid] === "A" ? "B" : "A";
    const tampered = chars.join("");
    await expect(decryptData(tampered, key)).rejects.toThrow();
  });

  it("encrypted output is valid base64", async () => {
    const key = await deriveEncryptionKey("testpass", salt);
    const encrypted = await encryptData("test data", key);
    // Should not throw when decoded
    expect(() => atob(encrypted)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// isEncryptedData
// ---------------------------------------------------------------------------
describe("isEncryptedData", () => {
  it("returns false for JSON object", () => {
    expect(isEncryptedData('{"key":"value"}')).toBe(false);
  });

  it("returns false for JSON array", () => {
    expect(isEncryptedData("[1,2,3]")).toBe(false);
  });

  it("returns false for empty string", () => {
    expect(isEncryptedData("")).toBe(false);
  });

  it("returns false for invalid base64", () => {
    expect(isEncryptedData("not-valid!!!")).toBe(false);
  });

  it("returns true for actual encrypted data", async () => {
    const salt = "d".repeat(32);
    const key = await deriveEncryptionKey("testpass", salt);
    const encrypted = await encryptData("test", key);
    expect(isEncryptedData(encrypted)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// getLockoutDuration
// ---------------------------------------------------------------------------
describe("getLockoutDuration", () => {
  it("0 attempts = no lockout", () => {
    expect(getLockoutDuration(0)).toBe(0);
  });

  it("1-2 attempts = no lockout", () => {
    expect(getLockoutDuration(1)).toBe(0);
    expect(getLockoutDuration(2)).toBe(0);
  });

  it("3 attempts = 30s", () => {
    expect(getLockoutDuration(3)).toBe(30);
  });

  it("4 attempts = 60s", () => {
    expect(getLockoutDuration(4)).toBe(60);
  });

  it("5-6 attempts = 5 minutes", () => {
    expect(getLockoutDuration(5)).toBe(300);
    expect(getLockoutDuration(6)).toBe(300);
  });

  it("7+ attempts = 30 minutes", () => {
    expect(getLockoutDuration(7)).toBe(1800);
    expect(getLockoutDuration(100)).toBe(1800);
  });
});

// ---------------------------------------------------------------------------
// formatLockoutTime
// ---------------------------------------------------------------------------
describe("formatLockoutTime", () => {
  it("0 or negative = empty", () => {
    expect(formatLockoutTime(0)).toBe("");
    expect(formatLockoutTime(-5)).toBe("");
  });

  it("seconds only", () => {
    expect(formatLockoutTime(30)).toBe("30s");
    expect(formatLockoutTime(59)).toBe("59s");
  });

  it("exact minutes", () => {
    expect(formatLockoutTime(60)).toBe("1m");
    expect(formatLockoutTime(300)).toBe("5m");
  });

  it("minutes and seconds", () => {
    expect(formatLockoutTime(90)).toBe("1m 30s");
    expect(formatLockoutTime(1830)).toBe("30m 30s");
  });
});
