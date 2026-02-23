/**
 * Cross-platform file saving utility.
 * Uses Tauri dialog + fs plugins in production (works on macOS, Windows, Linux).
 * Falls back to browser download API in development (Vite dev server).
 *
 * The browser's `<a>.click()` download pattern does NOT work in Tauri on Linux.
 * Tauri's dialog:save() automatically adds the selected path to the fs scope,
 * allowing writeTextFile()/writeFile() to write there without extra permissions.
 */

import { save } from "@tauri-apps/plugin-dialog";
import { writeTextFile, writeFile } from "@tauri-apps/plugin-fs";

/** Check if running inside Tauri (production) vs browser (dev) */
function isTauri(): boolean {
  return !!(window as any).__TAURI_INTERNALS__;
}

interface SaveOptions {
  /** Default filename (e.g., "transactions.csv") */
  defaultPath: string;
  /** File type filters for the save dialog */
  filters?: { name: string; extensions: string[] }[];
}

/**
 * Save text content to a user-chosen file via native save dialog.
 * Returns true if saved, false if user cancelled.
 */
export async function saveTextFile(
  content: string,
  options: SaveOptions
): Promise<boolean> {
  if (isTauri()) {
    const filePath = await save({
      defaultPath: options.defaultPath,
      filters: options.filters,
    });
    if (!filePath) return false; // User cancelled
    await writeTextFile(filePath, content);
    return true;
  }

  // Browser fallback (dev mode)
  const blob = new Blob([content], { type: "text/plain" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = options.defaultPath;
  a.click();
  URL.revokeObjectURL(url);
  return true;
}

/**
 * Save binary content to a user-chosen file via native save dialog.
 * Returns true if saved, false if user cancelled.
 */
export async function saveBinaryFile(
  data: Uint8Array,
  options: SaveOptions
): Promise<boolean> {
  if (isTauri()) {
    const filePath = await save({
      defaultPath: options.defaultPath,
      filters: options.filters,
    });
    if (!filePath) return false;
    await writeFile(filePath, data);
    return true;
  }

  // Browser fallback (dev mode)
  const blob = new Blob([data.buffer as ArrayBuffer], { type: "application/octet-stream" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = options.defaultPath;
  a.click();
  URL.revokeObjectURL(url);
  return true;
}
