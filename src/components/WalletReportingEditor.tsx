import { useAppState } from "../lib/app-state";
import { WalletReporting } from "../lib/models";
import { getWalletReporting, normalizeWalletKey, suggestWalletKind } from "../lib/form8949-boxes";

/**
 * Per-wallet Form 8949 classification: exchange (issues Form 1099-DA) vs self-custody.
 * Shared by Settings → Wallets and the Review checklist. Changes persist immediately
 * (Preferences.walletReporting via the savePreferences effect).
 */
export function WalletReportingEditor({ wallets }: { wallets: string[] }) {
  const { walletReporting, setWalletReporting } = useAppState();
  // Settings are keyed by normalized name — show "Coinbase" and "coinbase " once
  const seen = new Set<string>();
  wallets = wallets.filter((w) => {
    const key = normalizeWalletKey(w);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  if (wallets.length === 0) {
    return <p className="text-xs text-gray-500">No wallets yet — import or add transactions first.</p>;
  }

  return (
    <div className="space-y-2">
      {wallets.map((wallet) => {
        const setting = getWalletReporting(walletReporting, wallet);
        const suggestion = setting ? undefined : suggestWalletKind(wallet);
        return (
          <div key={wallet} className={`flex items-center gap-3 flex-wrap px-3 py-2 rounded text-sm ${setting ? "bg-gray-50 dark:bg-zinc-800/50" : "bg-yellow-50 dark:bg-yellow-900/10"}`}>
            <span className="font-medium min-w-[8rem]">{wallet}</span>
            <select
              className="select text-xs"
              aria-label={`How ${wallet} is reported`}
              value={setting?.kind ?? ""}
              onChange={(e) => {
                const kind = e.target.value as WalletReporting["kind"] | "";
                setWalletReporting(wallet, kind === "" ? null : kind === "exchange" ? { kind, basisReported: setting?.basisReported ?? "covered" } : { kind });
              }}
            >
              <option value="">Not set</option>
              <option value="exchange">Exchange — sends me a Form 1099-DA</option>
              <option value="self-custody">Self-custody / no Form 1099-DA</option>
            </select>
            {setting?.kind === "exchange" && (
              <select
                className="select text-xs"
                aria-label={`Basis shown on the ${wallet} Form 1099-DA`}
                value={setting.basisReported ?? "covered"}
                onChange={(e) => setWalletReporting(wallet, { kind: "exchange", basisReported: e.target.value as WalletReporting["basisReported"] })}
              >
                <option value="covered">1099-DA shows basis only for coins bought there since 2026 (default)</option>
                <option value="all">1099-DA shows basis for all sales</option>
                <option value="none">1099-DA shows no basis</option>
              </select>
            )}
            {suggestion && (
              <button
                className="text-xs px-2 py-1 rounded bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-400 font-medium hover:bg-yellow-200 dark:hover:bg-yellow-900/50"
                onClick={() => setWalletReporting(wallet, { kind: suggestion, basisReported: "covered" })}
              >
                Looks like an exchange — confirm
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}
