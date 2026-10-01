export const SCAM_STORAGE_KEY = "cryptotracker.showScam";

export function readShowScam(): boolean {
  try { return localStorage.getItem(SCAM_STORAGE_KEY) === "true"; }
  catch { return false; }
}

export function writeShowScam(value: boolean): void {
  try { localStorage.setItem(SCAM_STORAGE_KEY, String(value)); } catch { /* storage unavailable */ }
}

export function assetKey(t: { asset?: string; contract?: string | null }): string {
  return `${t.asset ?? ""}|${t.contract ?? ""}`;
}
