/**
 * Cross-platform confirm dialog.
 *
 * window.confirm() is a silent no-op on macOS WKWebView (wry does not implement
 * the JS confirm panel delegate — confirm() returns false immediately with no
 * dialog), so any confirm-gated action is dead on macOS. Use the Tauri dialog
 * plugin in production and fall back to window.confirm in the browser dev server.
 */

import { confirm as tauriConfirm } from "@tauri-apps/plugin-dialog";

function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export async function confirmDialog(
  message: string,
  options?: { title?: string; kind?: "info" | "warning" | "error" }
): Promise<boolean> {
  if (isTauri()) {
    return await tauriConfirm(message, {
      title: options?.title ?? "Sovereign Tax",
      kind: options?.kind ?? "warning",
    });
  }
  return window.confirm(message);
}
