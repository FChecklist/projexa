// R-63: the last organisation currency code this browser was told, kept so the laptop-first Settings screen can show it without any network call
// (a daily walk of the laptop shell must stay off Vercel: e2e/lf-lifecycle-vercel-budget.spec.ts). Written whenever a currency list is read (the replica
// copy, or the online /api/currencies answer); dropped on sign-out with the rest of the currency cache. Storage failures mean "nothing remembered", never an error.
const KEY = "px:last-org-currency";

export function rememberOrgCurrency(code: string | null | undefined): void {
  try {
    if (code && typeof localStorage !== "undefined") localStorage.setItem(KEY, code);
  } catch {
    /* storage unavailable */
  }
}

export function recalledOrgCurrency(): string | null {
  try {
    return typeof localStorage !== "undefined" ? localStorage.getItem(KEY) || null : null;
  } catch {
    return null;
  }
}

export function forgetOrgCurrency(): void {
  try {
    if (typeof localStorage !== "undefined") localStorage.removeItem(KEY);
  } catch {
    /* nothing to clear */
  }
}
