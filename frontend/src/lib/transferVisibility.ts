export const SHOW_ALL_TRANSFERS_KEY = "cryptotracker.showAllTransfers";
const OLD_SHOW_SCAM_KEY = "cryptotracker.showScam";

export function readShowAllTransfers(): boolean {
  try { return (localStorage.getItem(SHOW_ALL_TRANSFERS_KEY) ?? localStorage.getItem(OLD_SHOW_SCAM_KEY)) === "true"; }
  catch { return false; }
}

export function writeShowAllTransfers(value: boolean): void {
  try { localStorage.setItem(SHOW_ALL_TRANSFERS_KEY, String(value)); } catch { /* storage unavailable */ }
}

export function hasUsdValue(t: { usdValue?: number | null }): boolean {
  return t.usdValue != null && Number.isFinite(t.usdValue) && t.usdValue > 0;
}

export function transferIsVisible(t: { usdValue?: number | null }, showAll: boolean): boolean {
  return showAll || hasUsdValue(t);
}

export function assetKey(t: { asset?: string; contract?: string | null }): string {
  return `${t.asset ?? ""}|${t.contract ?? ""}`;
}
