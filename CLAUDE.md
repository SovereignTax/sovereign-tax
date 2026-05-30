# Sovereign Tax — Developer Guide

> This is the in-repo developer guide. Maintainer-only operational runbooks
> (release/signing/deployment, infrastructure, payment configuration) are kept
> out of this public, source-available repository.

## What This Is
Self-sovereign Bitcoin-only tax software. Desktop app (Tauri v2 + React 19 + TypeScript 5.9). All data stays local, encrypted at rest with AES-256-GCM. No accounts, no cloud, no telemetry. One-time purchase, not a subscription.

**IMPORTANT:** `sovereign-tax-pro` is a SEPARATE multi-crypto project. Do NOT modify those files.

## Tech Stack
- **Frontend:** React 19, TypeScript 5.9, Tailwind CSS v4, Vite 7
- **Desktop:** Tauri v2 (Rust backend)
- **Encryption:** AES-256-GCM, PBKDF2 key derivation (600,000 iterations)
- **Hosting:** Cloudflare Pages (marketing site + invoice-gated downloads)

## Source Architecture (`src/`)

### Components (20 active views)
| File | Purpose |
|------|---------|
| `App.tsx` | Root — TOS → PIN setup → Lock screen → Main app; Help Guide bar |
| `LockScreen.tsx` | PIN entry for returning users (keyboard + click input) |
| `SetupPIN.tsx` | First-time PIN creation (keyboard + click input) |
| `TermsOfService.tsx` | TOS acceptance gate |
| `Sidebar.tsx` | Navigation — Data, Portfolio, Tax (incl. Review), Insights |
| `ImportView.tsx` | CSV import with auto-detection (60+ column variations) |
| `TransactionsView.tsx` | Transaction list, edit/delete, EditLots (Specific ID), Optimize All |
| `HoldingsView.tsx` | Current BTC holdings by lot (FIFO, wallet filter) |
| `TaxReportView.tsx` | Form 8949 generation (PDF, CSV, TXF) |
| `SimulationView.tsx` | "What-if" sale simulator |
| `AddTransactionView.tsx` | Manual transaction entry |
| `ComparisonView.tsx` | FIFO vs Optimal Specific ID comparison |
| `IncomeView.tsx` | Mining/rewards income (Schedule 1) |
| `AuditLogView.tsx` | Change history log |
| `TaxLossHarvestingView.tsx` | Tax-loss harvesting dashboard |
| `MultiYearDashboardView.tsx` | Multi-year analysis |
| `LotMaturityView.tsx` | When lots become long-term |
| `ReviewView.tsx` | Guided tax-prep checklist (unassigned transfers, mismatches, readiness) |
| `ReconciliationView.tsx` | Match transfers between wallets |
| `SettingsView.tsx` | Settings (method, year, theme, backup/restore, carryforward) |

`RecordSaleView.tsx` is legacy — removed from navigation/routing, file retained.

### Lib (16 modules)
| File | Purpose |
|------|---------|
| `app-state.tsx` | React context for global state; `isMaterialChange()`; edit invalidation |
| `types.ts` | Enums: AccountingMethod (FIFO / SpecificID), TransactionType, IncomeType |
| `models.ts` | Core interfaces: Transaction, Lot, SaleRecord, LotSelection, Preferences |
| `cost-basis.ts` | Cost basis engine (FIFO + Specific ID), batchOptimizeSpecificId |
| `csv-import.ts` | CSV parser with auto-detection for all major exchanges |
| `crypto.ts` | AES-256-GCM encryption/decryption (chunked encoding for large data) |
| `persistence.ts` | localStorage with encryption layer; encrypted vs plaintext keys |
| `export.ts` | Form 8949 CSV/TXF export |
| `pdf-export.ts` | Form 8949 PDF generation (jsPDF) |
| `price-service.ts` | CoinGecko price fetching (optional, can run offline) |
| `audit.ts` | Audit log entries |
| `backup.ts` | Encrypted backup/restore, in-app backup management |
| `carryforward.ts` | Capital loss carryforward with IRS ST/LT split (Schedule D worksheet) |
| `review-helpers.ts` | Shared warning-aggregation utilities for the review/report views |
| `reconciliation.ts` | Transfer matching logic, source-wallet suggestions |
| `utils.ts` | Shared utilities |

### Theming
- `src/index.css` — Original flat light/dark theme
- `src/index-glass.css` — Glass aesthetic (translucent cards, backdrop blur)
- Switch the import in `src/main.tsx`. Users toggle System/Light/Dark in Settings (default Dark).

### Tauri Config (`src-tauri/`)
- `tauri.conf.json` — identifier `com.sovereigntax.app`, min 900×600, locked-down CSP
- macOS builds use the `universal-apple-darwin` target (ARM + Intel).

### Build Config
- `vite.config.ts` injects `__APP_VERSION__` from `package.json`. Never hardcode version strings in components.

## Key Data Flow
1. **First launch:** TOS → PIN setup → derive key via PBKDF2 → store encrypted salt
2. **Returning:** PIN entry → derive key → decrypt localStorage → unlock
3. **Storage:** localStorage, encrypted/plaintext split. Sensitive keys (transactions, sales, mappings, import history, audit log) are AES-256-GCM encrypted; preferences and price cache are plaintext. All saves are async and must be awaited.
4. **Import:** CSV → auto-detect columns → parse → deduplicate → store
5. **Tax calc:** transactions + method → cost-basis engine → lots + sale records → Form 8949

## CSV Import
- **Required:** Date, Amount, and (Price OR Total)
- **Optional:** Type, Fee, Wallet, Exchange, Notes
- Bitcoin-only (non-BTC rows skipped); dual-column (Received/Sent) supported; file- and transaction-level dedup.

## Build & Test
```bash
# Dev
npm run dev          # Vite dev server on :1420
npm run tauri dev    # Full Tauri dev with hot reload

# Test (must pass before commit/release)
npm test             # vitest run — full suite

# Production build (macOS — universal binary for Intel + ARM)
npm run tauri build -- --target universal-apple-darwin
# Windows/Linux installers are produced via CI.
```

## Version Bump
Update `package.json`, `src-tauri/tauri.conf.json`, and `version.json` together. The in-app update check reads `version.json` from the repo's raw GitHub URL, so it must stay in sync with the app version.

## IRS Compliance
- Per-wallet cost basis tracking (2025+ rules, Treasury Reg. §1.1012-1(j))
- Two IRS-permitted accounting methods: **FIFO** and **Specific ID** (LIFO/HIFO are not permitted and were removed)
- Form 8949 export: PDF, CSV, TurboTax TXF; Form 8283 CSV for charitable donations
- Short-term vs long-term capital gains (1-year holding period, IRC §1222)
- Mining/rewards as ordinary income (Schedule 1)
- Mixed-term sale splitting
- Capital loss carryforward ($3,000 annual limit, ST/LT split per Schedule D worksheet)
