# Sovereign Tax — Project Guide

## What This Is
Self-sovereign Bitcoin-only tax software. Desktop app (Tauri v2 + React 19 + TypeScript 5.9). All data stays local, encrypted at rest with AES-256-GCM. No accounts, no cloud, no telemetry. One-time purchase, not a subscription.

## Repository
- **Source code:** `sovereign-tax/` (cloned from github.com/sovereigntax/sovereign-tax)
- **Website/deployment:** `cloudflare-package/` (static site on Cloudflare Pages at sovereigntax.io)
- **Builds archive:** `builds/` (versioned .dmg, .exe, and .rpm installers)
- **Pre-launch backup:** `cloudflare-package-PRELAUNCH-BACKUP/`

**IMPORTANT:** `sovereign-tax-pro` (jhimm2300/sovereign-tax-pro) is a SEPARATE multi-crypto project. Do NOT modify those files.

## Tech Stack
- **Frontend:** React 19, TypeScript 5.9, Tailwind CSS v4, Vite 7
- **Desktop:** Tauri v2 (Rust backend)
- **Encryption:** AES-256-GCM, PBKDF2 key derivation (600,000 iterations)
- **Payments:** BTCPay Server (Bitcoin), Gumroad (card)
- **Hosting:** Cloudflare Pages

## Source Architecture (`sovereign-tax/src/`)

### Components (20 views)
| File | Purpose |
|------|---------|
| `App.tsx` | Root — TOS → PIN setup → Lock screen → Main app |
| `LockScreen.tsx` | PIN entry for returning users |
| `SetupPIN.tsx` | First-time PIN creation |
| `TermsOfService.tsx` | TOS acceptance gate |
| `Sidebar.tsx` | Navigation sidebar |
| `ImportView.tsx` | CSV import with auto-detection (60+ column variations) |
| `TransactionsView.tsx` | Transaction list with edit/delete |
| `HoldingsView.tsx` | Current BTC holdings by lot |
| `TaxReportView.tsx` | Form 8949 generation (PDF, CSV, TXF) |
| `SimulationView.tsx` | "What-if" sale simulator |
| `RecordSaleView.tsx` | Record actual sales |
| `AddTransactionView.tsx` | Manual transaction entry |
| `ComparisonView.tsx` | Side-by-side method comparison |
| `IncomeView.tsx` | Mining/rewards income (Schedule 1) |
| `AuditLogView.tsx` | Change history log |
| `TaxLossHarvestingView.tsx` | Tax-loss harvesting dashboard |
| `MultiYearDashboardView.tsx` | Multi-year analysis |
| `LotMaturityView.tsx` | When lots become long-term |
| `ReconciliationView.tsx` | Match transfers between wallets |
| `SettingsView.tsx` | App settings (method, year, theme, backup/restore) |

### Lib (15 modules)
| File | Purpose |
|------|---------|
| `app-state.tsx` | React context for global state (AppStateProvider) |
| `types.ts` | Enums: AccountingMethod (FIFO/LIFO/HIFO/SpecificID), TransactionType, IncomeType |
| `models.ts` | Core interfaces: Transaction, Lot, SaleRecord, ColumnMapping, Preferences |
| `cost-basis.ts` | Cost basis calculation engine (all 4 methods) |
| `csv-import.ts` | CSV parser with auto-detection for all major exchanges |
| `crypto.ts` | AES-256-GCM encryption/decryption |
| `persistence.ts` | localStorage with encryption layer; encrypted keys vs plaintext keys |
| `export.ts` | Form 8949 CSV/TXF export |
| `pdf-export.ts` | Form 8949 PDF generation (jsPDF) |
| `price-service.ts` | CoinGecko price fetching (optional, can run offline) |
| `audit.ts` | Audit log entries |
| `backup.ts` | Encrypted backup/restore |
| `carryforward.ts` | Year-to-year lot carryforward |
| `reconciliation.ts` | Transfer matching logic |
| `utils.ts` | Shared utilities |

### Tauri Config (`src-tauri/`)
- `tauri.conf.json` — App config: identifier `com.sovereigntax.app`, min 900x600, CSP locked down
- `Cargo.toml` — Rust deps: tauri 2.10, plugins for fs/dialog/store/opener
- Builds to macOS universal binary (.dmg), Windows installer (.exe), and Linux RPM (.rpm)

## Key Data Flow
1. **First launch:** TOS → PIN setup → derives encryption key via PBKDF2 → stores encrypted salt
2. **Returning:** PIN entry → derives key → decrypts localStorage data → unlocks app
3. **Data storage:** localStorage with encrypted/plaintext split. Sensitive keys (transactions, sales, mappings, import history, audit log) are AES-256-GCM encrypted. Preferences and price cache are plaintext.
4. **Import:** CSV file → auto-detect columns (60+ variations) → parse → deduplicate → store
5. **Tax calc:** Transactions + method → cost-basis engine → lots + sale records → Form 8949

## Current Version
**v1.1.0** (released 2026-02-14) — Edit/delete transactions, duplicate detection, fee column visibility.

## Website (`cloudflare-package/`)
- `index.html` — Landing page (glass aesthetic, privacy-first messaging, pricing, screenshots)
- `download.html` — Invoice-gated download page (BTCPay verification)
- `support.html` — Troubleshooting and CSV import guide
- `privacy-policy.html` / `terms-of-service.html` — Legal pages
- `downloads/` — Current .dmg, .exe, and .rpm installers
- `screenshots_original/` — 19 app screenshots for the website
- `version.json` — Version metadata for update checks

## CRITICAL — Live Revenue & Update Paths (DO NOT BREAK)

### Payment Flows
1. **Gumroad (card $59.99):** `https://sovereigntax.gumroad.com/l/epddkw` → Gumroad overlay checkout on `index.html` → Gumroad delivers download link
2. **BTCPay (BTC $49.99):** `https://pay.sovereigntax.io/apps/21zpxF4wbp4FWCkvJyt3PiNWbdSL/pos` → after payment redirects to `download.html?invoiceId=XXX`
3. **Download page:** `download.html` verifies invoice via URL param, BTCPay referrer, or localStorage stored invoices → grants access to `downloads/SovereignTax-macOS.dmg` and `downloads/SovereignTax-Windows.exe`
4. **Returning customers:** invoice IDs stored in localStorage key `st_invoices`

### App Update Check
- `SettingsView.tsx` line 7: fetches `https://raw.githubusercontent.com/sovereigntax/sovereign-tax/main/version.json`
- Compares semver against current app version
- Shows download link to `sovereigntax.io` if update available

### Sacred Paths (never rename/move)
- `cloudflare-package/downloads/SovereignTax-macOS.dmg`
- `cloudflare-package/downloads/SovereignTax-Windows.exe`
- `cloudflare-package/downloads/SovereignTax-Linux.rpm`
- `sovereign-tax/version.json` (GitHub raw — update check source)
- `cloudflare-package/download.html` (invoice gate logic)
- `cloudflare-package/index.html` (Gumroad + BTCPay purchase buttons)

### Binary Policy
- `.dmg`, `.exe`, and `.rpm` files are deployed to Cloudflare but NEVER committed to git
- Use GitHub Releases for versioned binary archival
- `builds/` directory is local-only backup

## Pricing (Beta)
- Bitcoin: $49.99 (BTCPay Server)
- Card: $59.99 (Gumroad)
- Normal price: $100 BTC / $120 card

## Build Commands
```bash
# Dev
cd sovereign-tax && npm run dev        # Vite dev server on :1420
cd sovereign-tax && npm run tauri dev   # Full Tauri dev with hot reload

# Production build
cd sovereign-tax && npm run tauri build # Builds .dmg / .exe
```

## IRS Compliance
- Per-wallet cost basis tracking (2025+ rules)
- 4 accounting methods: FIFO, LIFO, HIFO, Specific ID
- Form 8949 export: PDF, CSV, TurboTax TXF
- Short-term vs long-term capital gains
- Mining/rewards classified as ordinary income (Schedule 1)
- Mixed-term sale splitting
