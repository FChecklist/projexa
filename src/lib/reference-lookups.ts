"use client";

// R67 F-06 (R-088/R-094). Reference data shared across a module's three
// screens.
//
// THE PATTERN THIS REPLACES. /labour, /labour/new and /labour/[id] each
// fetched GET /api/vendors independently, from their own useEffect, on every
// mount -- three identical requests for the same never-changing subcontractor
// list during one user's trip through the module, plus one more every time
// they came back. LabourClient additionally awaited it inside the same
// Promise.allSettled as the roster, so a slow vendor lookup delayed the roster
// table it only decorates with a company name.
//
// The fix is the same shape currency.ts already uses for /api/currencies: one
// tab-lifetime cache, one in-flight request shared by every caller, and a
// failure that is never cached (a blip must not pin "this org has no vendors"
// for a minute -- that renders every Company cell as an em-dash and looks like
// data, not an outage).
//
// The store itself is src/lib/shell-cache.ts's -- the same TTL + request
// coalescing the shell uses. It is not shell-specific; only the keys are.
import { cachedShellJson, invalidateShellCache, SHELL_CACHE_TTL_MS } from "@/lib/shell-cache";

export type Vendor = { id: string; vendorName: string };

export const VENDORS_CACHE_KEY = "reference:vendors";

/**
 * The org's subcontractor/vendor list, memoised for the tab.
 *
 * NEVER REJECTS. Every caller uses this for a display-only lookup (a company
 * name next to a worker, the options in an optional Company select), so a
 * failed lookup degrades that one cell to "—" rather than turning a working
 * roster into an error card. The failure is logged, not swallowed silently,
 * and is not cached, so the next mount retries.
 */
export async function loadVendors(ttlMs: number = SHELL_CACHE_TTL_MS): Promise<Vendor[]> {
  try {
    const data = await cachedShellJson<{ vendors?: Vendor[] }>(VENDORS_CACHE_KEY, "/api/vendors", { ttlMs });
    return data.vendors ?? [];
  } catch (err) {
    console.error("[reference-lookups] vendors lookup failed:", err instanceof Error ? err.message : err);
    return [];
  }
}

/** Drops the memoised vendor list -- call after creating or editing a vendor. */
export function invalidateVendors(): void {
  invalidateShellCache(VENDORS_CACHE_KEY);
}
