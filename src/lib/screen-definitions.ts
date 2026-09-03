import { unstable_cache } from "next/cache";
import type { ScreenColumn } from "@fchecklist/veridian-ui-kit/screens";
import { callVeridian, VeridianApiError } from "@/lib/veridian-client";

export type RegistryColumn = ScreenColumn;

// R67 F-02/F-03 (R-035/R-052). Every module page resolved its column labels by
// calling VERIDIAN's /screen-definitions/{functionId} on EVERY navigation --
// a full authenticated round trip, in the pre-paint critical path, for a
// registry row that changes when somebody edits the registry, i.e. almost
// never. Several pages awaited it SERIALLY after resolving the project, so
// the two costs added up before any HTML was sent.
//
// This is the one cached resolver those pages share. Three things it
// guarantees, each of which was a real bug class in the hand-rolled copies it
// replaces:
//
//  1. IT NEVER THROWS. A missing registry row is a 404 and is EXPECTED (not
//     every screen has been seeded), and any other failure is still not fatal
//     -- every caller falls back to its own hardcoded column labels. A screen
//     must not fail to render because a label lookup did.
//  2. IT IS ORG-SCOPED TWO WAYS. `organizationId` is both an explicit cache
//     key part and the wrapped function's argument, so one org's labels can
//     never be served to another. This matters because callVeridian attaches
//     a PER-ORG bearer token and Next's ordinary fetch cache keys on URL +
//     method + body only, NOT headers -- see veridian-client.ts's
//     createCachedVeridianGet comment for the cross-tenant leak that would
//     otherwise be (see AR-04 / E-45).
//  3. TTL IS THE CALLER'S CHOICE. A registry row that changes rarely (MoMs,
//     1 h) and one being actively edited (documents, 10 min) are different
//     bets, so the page states its own.
//
// The cached wrapper is created per call rather than once at module scope so
// the revalidation tag can name the org (`screen-definitions:{org}`) --
// unstable_cache takes tags as static options, and a per-org tag is what lets
// a registry edit for ONE org invalidate only that org. The underlying cache
// is keyed by keyParts + serialized arguments, not by the wrapper's identity,
// so re-wrapping per request still hits the same entry.
export function screenDefinitionsTag(organizationId: string | null): string {
  return `screen-definitions:${organizationId ?? "shared"}`;
}

export async function resolveRegistryColumns(
  functionId: string,
  organizationId: string | null,
  revalidateSeconds: number
): Promise<RegistryColumn[] | null> {
  const read = unstable_cache(
    async (orgId: string | null) => {
      try {
        const definition = await callVeridian<{ columns: RegistryColumn[] }>(`/screen-definitions/${functionId}`, {
          organizationId: orgId ?? undefined,
        });
        return Array.isArray(definition.columns) && definition.columns.length > 0 ? definition.columns : null;
      } catch (err) {
        // A 404 means "no row seeded yet" -- expected, and cached as null so
        // an unseeded screen does not re-ask on every single navigation.
        if (err instanceof VeridianApiError && err.status === 404) return null;
        console.error(
          `[screen-definitions] resolve failed for ${functionId}, falling back to hardcoded columns:`,
          err instanceof Error ? err.message : err
        );
        // Deliberately RETHROWN as a sentinel below rather than cached: a
        // transient backend failure must not pin "no labels" for the whole
        // TTL. See the catch outside the cache.
        throw err;
      }
    },
    ["screen-definitions", functionId, organizationId ?? "shared"],
    { revalidate: revalidateSeconds, tags: [screenDefinitionsTag(organizationId)] }
  );

  try {
    return await read(organizationId);
  } catch {
    // Already logged above. The caller renders its own hardcoded labels.
    return null;
  }
}
