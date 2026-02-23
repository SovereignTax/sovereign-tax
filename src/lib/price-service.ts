import { loadPriceCache, savePriceCache } from "./persistence";
import { fetch as tauriFetch } from "@tauri-apps/plugin-http";

const API_URL =
  "https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd";

interface CoinGeckoResponse {
  bitcoin: { usd: number };
}

interface CoinGeckoHistoryResponse {
  market_data?: {
    current_price?: {
      usd?: number;
    };
  };
}

export interface PriceData {
  price: number | null;
  lastUpdated: Date | null;
  isLoading: boolean;
  error: string | null;
}

/**
 * Fetch wrapper: tries Tauri HTTP plugin first, falls back to browser fetch.
 * On Linux, the Tauri HTTP plugin can fail if system TLS libraries are missing.
 */
async function robustFetch(url: string): Promise<Response> {
  try {
    return await tauriFetch(url);
  } catch (tauriErr) {
    console.warn("[price-service] Tauri HTTP plugin failed, falling back to browser fetch:", tauriErr);
    // Fallback to browser's native fetch (works if CSP connect-src allows the domain)
    return await window.fetch(url);
  }
}

export async function fetchBTCPrice(): Promise<{
  price: number;
  timestamp: Date;
}> {
  const response = await robustFetch(API_URL);
  if (!response.ok) throw new Error(`API request failed: ${response.status} ${response.statusText}`);

  const data: CoinGeckoResponse = await response.json();
  if (!data?.bitcoin?.usd) throw new Error("Invalid API response — no price data");
  return {
    price: data.bitcoin.usd,
    timestamp: new Date(),
  };
}

/** Rate limiter: minimum 2s between CoinGecko calls */
let lastHistoricalCall = 0;

/**
 * Fetch historical BTC price for a specific date.
 * Uses CoinGecko free API with localStorage caching.
 * Rate limited to 1 call per 2 seconds.
 */
export async function fetchHistoricalPrice(date: Date): Promise<number | null> {
  const dd = String(date.getDate()).padStart(2, "0");
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const yyyy = date.getFullYear();
  const dateKey = `${yyyy}-${mm}-${dd}`;

  // Check cache first
  const cache = loadPriceCache();
  if (cache[dateKey]) {
    return cache[dateKey];
  }

  // Rate limit
  const now = Date.now();
  const elapsed = now - lastHistoricalCall;
  if (elapsed < 2000) {
    await new Promise((resolve) => setTimeout(resolve, 2000 - elapsed));
  }
  lastHistoricalCall = Date.now();

  // CoinGecko expects dd-mm-yyyy
  const url = `https://api.coingecko.com/api/v3/coins/bitcoin/history?date=${dd}-${mm}-${yyyy}&localization=false`;

  try {
    const response = await robustFetch(url);
    if (!response.ok) return null;

    const data: CoinGeckoHistoryResponse = await response.json();
    const price = data.market_data?.current_price?.usd;
    if (!price) return null;

    // Cache the result
    cache[dateKey] = price;
    savePriceCache(cache);

    return price;
  } catch (err) {
    console.warn("[price-service] Historical price fetch failed:", err);
    return null;
  }
}
