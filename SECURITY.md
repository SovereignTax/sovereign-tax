# Sovereign Tax - Security Architecture

## Overview

Sovereign Tax is a local-only Bitcoin tax calculator. All financial data is stored locally on your device, encrypted at rest, and never transmitted to any server. This document describes the security measures in place and how to verify them.

## Zero Data Collection

- **No telemetry**: The app sends zero analytics, crash reports, or usage data
- **No accounts**: No user registration, no cloud sync, no server-side storage
- **No API keys**: No proprietary API keys are embedded in the app
- **Single network call**: The only network request is to the public CoinGecko API (`api.coingecko.com`) to fetch the current BTC price. No user data is included in this request

## Encryption at Rest (AES-256-GCM)

All sensitive financial data is encrypted before being written to disk using **AES-256-GCM** (Galois/Counter Mode), a NIST-approved authenticated encryption standard.

### What's Encrypted
- Transaction records (buys, sells, transfers)
- Recorded sale calculations
- Exchange column mappings
- Import history

### What's NOT Encrypted
- User preferences (theme, selected year, accounting method) - contains no financial data
- PIN hash and salt - stored in OS keychain (macOS) or localStorage (Tauri)

### How It Works

1. **Key Derivation**: When you unlock the app with your PIN, an AES-256 encryption key is derived using **PBKDF2-HMAC-SHA256** with 600,000 iterations and a random 16-byte salt
2. **Encryption**: Each save operation generates a fresh random 12-byte IV (initialization vector), then encrypts the data using AES-256-GCM. The output format is: `[1-byte version][12-byte IV][ciphertext + GCM authentication tag]`
3. **Decryption**: On unlock, the same key is re-derived from the PIN, and used to decrypt stored data
4. **Key Clearing**: When you lock the app, the encryption key is zeroed out of memory

### Encryption Salt
A separate random salt is used for encryption key derivation (distinct from the PIN verification salt). This means the PIN verification hash and the encryption key are derived independently - compromising one does not reveal the other.

## PIN Security (PBKDF2)

Your PIN is never stored in plaintext. It is processed using **PBKDF2-HMAC-SHA256**:

- **600,000 iterations** of key stretching (OWASP recommended minimum)
- **Random 16-byte salt** (unique per installation)
- **256-bit derived key** stored for verification
- **Constant-time comparison** to prevent timing attacks (macOS app)

### Rate Limiting

Brute-force attacks are mitigated with exponential backoff:

| Failed Attempts | Lockout Duration |
|-----------------|-----------------|
| 1-2             | None            |
| 3               | 30 seconds      |
| 4               | 60 seconds      |
| 5-6             | 5 minutes       |
| 7+              | 30 minutes      |

### Forgot PIN

If you forget your PIN, your data cannot be recovered. This is by design - the encryption key is derived from your PIN, so without it, the data is cryptographically inaccessible. You must use "Clear All Data" in Settings and re-import your CSV files.

## Content Security Policy (Tauri App)

The Tauri (cross-platform) version enforces a strict Content Security Policy:

```
default-src 'self';
script-src 'self';
style-src 'self' 'unsafe-inline';
connect-src 'self' https://api.coingecko.com;
img-src 'self' data:;
font-src 'self';
object-src 'none';
frame-src 'none';
base-uri 'self'
```

This prevents:
- Loading scripts from external sources (XSS protection)
- Making network requests to unauthorized domains
- Embedding the app in iframes
- Loading external objects or plugins

## Filesystem Permissions (Tauri App)

The Tauri app's filesystem access is scoped to `$APPDATA/**` only. It cannot read or write files outside its application data directory, except through explicit user-initiated file dialogs (for CSV import/export).

## Platform-Specific Security

### macOS Native (SwiftUI)
- PIN hash and salt stored in **macOS Keychain** (hardware-backed on Apple Silicon)
- Encryption salt also stored in Keychain
- Data files stored in `~/Library/Application Support/BTCCalcApp/`
- App sandbox not enabled (would require App Store distribution)

### Tauri (Cross-Platform)
- PIN hash, salt, and encrypted data stored in `localStorage` (WebView data directory)
- Content Security Policy enforced by Tauri's security layer
- Filesystem access restricted via capabilities system
- No Node.js runtime - Rust backend with WebView frontend

## How to Verify

### Build from Source

Both versions can be built from source to verify the binary matches the code:

**macOS Native:**
```bash
cd BTCCalcApp
swift build -c release
```

**Tauri (macOS/Windows/Linux):**
```bash
cd sovereign-tax-desktop
npm install
npx tauri build
```

### Verify No Hidden Network Calls

Monitor the app's network activity:
```bash
# macOS - monitor all network connections from the app
sudo lsof -i -n -P | grep "Sovereign"
```

You should only see connections to `api.coingecko.com` (port 443).

### Verify Encrypted Storage

**Tauri:** Open browser DevTools (if enabled) and check `localStorage` - financial data keys should contain base64-encoded encrypted data, not readable JSON.

**macOS:** Check files in `~/Library/Application Support/BTCCalcApp/` - they should be binary (encrypted), not readable JSON.

## Cryptographic Algorithms Summary

| Purpose | Algorithm | Parameters |
|---------|-----------|------------|
| PIN hashing | PBKDF2-HMAC-SHA256 | 600,000 iterations, 16-byte salt, 256-bit output |
| Data encryption | AES-256-GCM | 12-byte IV, 128-bit auth tag |
| Encryption key derivation | PBKDF2-HMAC-SHA256 | 600,000 iterations, separate 16-byte salt |
| File hashing (dedup) | SHA-256 | Standard |
| Random generation | OS CSPRNG | `SecRandomCopyBytes` (macOS), `crypto.getRandomValues` (Web) |

## Responsible Disclosure

If you discover a security vulnerability, please report it via GitHub Issues with the `security` label. Do not include exploit details in public issues - provide a general description and contact information for private follow-up.

## License

This software is distributed under the Business Source License 1.1 (BSL 1.1). The source code is available for security auditing and personal verification. See LICENSE for full terms.
