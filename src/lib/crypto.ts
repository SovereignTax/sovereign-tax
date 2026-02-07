/**
 * Cryptographic utilities for Sovereign Tax.
 * Uses Web Crypto API:
 *   - PBKDF2-HMAC-SHA256 for PIN hashing (600,000 iterations)
 *   - AES-256-GCM for data encryption at rest
 */

const PBKDF2_ITERATIONS = 600_000;
const SALT_LENGTH = 16; // 16 bytes = 128 bits
const IV_LENGTH = 12; // 12 bytes = 96 bits (GCM standard)
const ENCRYPTION_VERSION = 1; // For future format changes

/** Convert a Uint8Array to a hex string */
export function bufferToHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Convert a hex string to a Uint8Array */
export function hexToBuffer(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
  }
  return bytes;
}

/** Generate a random 16-byte salt */
export function generateSalt(): string {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_LENGTH));
  return bufferToHex(salt.buffer as ArrayBuffer);
}

/**
 * Derive a PBKDF2-HMAC-SHA256 hash from a PIN and salt.
 * Returns a 256-bit (32-byte) derived key as a hex string.
 *
 * @param pin - The user's PIN (4-6 digits)
 * @param saltHex - The salt as a hex string (32 hex chars = 16 bytes)
 * @returns The derived key as a 64-character hex string
 */
export async function hashPINWithPBKDF2(
  pin: string,
  saltHex: string
): Promise<string> {
  const encoder = new TextEncoder();
  const pinData = encoder.encode(pin);
  const salt = hexToBuffer(saltHex);

  // Import PIN as a CryptoKey for PBKDF2
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    pinData,
    "PBKDF2",
    false,
    ["deriveBits"]
  );

  // Derive 256 bits using PBKDF2-HMAC-SHA256
  const derivedBits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      salt: salt.buffer as ArrayBuffer,
      iterations: PBKDF2_ITERATIONS,
      hash: "SHA-256",
    },
    keyMaterial,
    256
  );

  return bufferToHex(derivedBits);
}

/**
 * Get the lockout duration in seconds based on failed attempt count.
 * Exponential backoff: 0s for <=2, 30s for 3, 60s for 4, 5min for 5-6, 30min for 7+
 */
export function getLockoutDuration(attempts: number): number {
  if (attempts <= 2) return 0;
  if (attempts === 3) return 30;
  if (attempts === 4) return 60;
  if (attempts <= 6) return 300; // 5 minutes
  return 1800; // 30 minutes
}

/**
 * Format remaining lockout time for display.
 */
export function formatLockoutTime(seconds: number): string {
  if (seconds <= 0) return "";
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const secs = seconds % 60;
  if (secs === 0) return `${minutes}m`;
  return `${minutes}m ${secs}s`;
}

// ======================================================================
// AES-256-GCM Encryption
// ======================================================================

/**
 * Derive an AES-256-GCM CryptoKey from a PIN and salt using PBKDF2.
 * This is a separate key derivation from the PIN hash — uses a different salt.
 */
export async function deriveEncryptionKey(
  pin: string,
  saltHex: string
): Promise<CryptoKey> {
  const encoder = new TextEncoder();
  const pinData = encoder.encode(pin);
  const salt = hexToBuffer(saltHex);

  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    pinData,
    "PBKDF2",
    false,
    ["deriveKey"]
  );

  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: salt.buffer as ArrayBuffer,
      iterations: PBKDF2_ITERATIONS,
      hash: "SHA-256",
    },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

/**
 * Encrypt plaintext data with AES-256-GCM.
 *
 * Output format (base64-encoded): [1B version][16B salt][12B IV][ciphertext + GCM tag]
 *
 * @param plaintext - The data to encrypt (JSON string)
 * @param key - The AES-256-GCM CryptoKey
 * @returns Base64-encoded encrypted data
 */
export async function encryptData(
  plaintext: string,
  key: CryptoKey
): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(plaintext);

  // Generate random IV for each encryption
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));

  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    data
  );

  // Combine version + IV + ciphertext
  const version = new Uint8Array([ENCRYPTION_VERSION]);
  const combined = new Uint8Array(1 + IV_LENGTH + ciphertext.byteLength);
  combined.set(version, 0);
  combined.set(iv, 1);
  combined.set(new Uint8Array(ciphertext), 1 + IV_LENGTH);

  // Base64 encode
  return btoa(String.fromCharCode(...combined));
}

/**
 * Decrypt AES-256-GCM encrypted data.
 *
 * @param encryptedBase64 - Base64-encoded encrypted data
 * @param key - The AES-256-GCM CryptoKey
 * @returns Decrypted plaintext string
 */
export async function decryptData(
  encryptedBase64: string,
  key: CryptoKey
): Promise<string> {
  // Decode base64
  const combined = Uint8Array.from(atob(encryptedBase64), (c) =>
    c.charCodeAt(0)
  );

  // Parse header
  const version = combined[0];
  if (version !== ENCRYPTION_VERSION) {
    throw new Error(`Unsupported encryption version: ${version}`);
  }

  const iv = combined.slice(1, 1 + IV_LENGTH);
  const ciphertext = combined.slice(1 + IV_LENGTH);

  const plainBuffer = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv },
    key,
    ciphertext
  );

  return new TextDecoder().decode(plainBuffer);
}

/**
 * Check if a string looks like encrypted data (base64 with version header).
 */
export function isEncryptedData(data: string): boolean {
  try {
    if (!data || data.startsWith("{") || data.startsWith("[")) return false;
    const decoded = atob(data);
    return decoded.charCodeAt(0) === ENCRYPTION_VERSION && decoded.length > 1 + IV_LENGTH;
  } catch {
    return false;
  }
}
