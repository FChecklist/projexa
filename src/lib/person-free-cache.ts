// PROJEXA-BUILD-001 U-20b (PROJEXA half) -- CROSS-REQUEST CACHES NEVER CARRY A PERSON.
//
// THE HAZARD THIS CLOSES. veridian-client now attaches the request's acting
// person (acting-person-context.ts) to every VERIDIAN call a signed-in route
// makes. Next's unstable_cache runs its callback, on a miss AND on a
// background revalidation, inside the async context of whichever request
// triggered it -- so a plain unstable_cache around callVeridian would fetch
// with THAT person's X-Acting-User, and then serve the stored answer to every
// other person of the org for the whole TTL, because the person is not part of
// the cache key. VERIDIAN shapes some answers by the acting person's role (the
// U-01c financial redaction is the live example), so that is one person's view
// served to another -- a leak created by attaching the headers, not by the
// cache.
//
// THE RULE. Every cross-request cache fill runs as nobody
// (runWithoutActingPerson), so the value stored is the same person-free,
// org-level answer every cache in this repo stored before the headers existed.
// The cache key therefore still describes everything the value depends on
// (org via keyParts and arguments, exactly as before) and needs no person in
// it. The alternative -- a per-person key -- was rejected: it would keep a
// separate copy of org reference data (currencies, fiscal years, screen
// definitions) per person for no benefit, and a single missed key part would
// reintroduce the leak silently. The caches here are all reads; VERIDIAN never
// refuses a read that names nobody (resolveOptionalActingPerson), so running
// them as nobody costs nothing.
//
// THE KEY IS BYTE-IDENTICAL TO BEFORE. Next derives an entry's key from
// `${cb.toString()}-${keyParts}` plus the JSON of the arguments
// (next/dist/server/web/spec-extension/unstable-cache.js). Every wrapper this
// module builds has the same source text, so without care two caches with
// equal keyParts would start sharing entries. The wrapper therefore reports
// the WRAPPED function's own source from toString(), which keeps every key
// exactly what it was: no new sharing, and no cold cache on deploy.
//
// src/lib/acting-person-coverage.test.ts fails if any module in src imports
// unstable_cache from next/cache directly instead of going through here.

import { unstable_cache } from "next/cache";
import { runWithoutActingPerson } from "@/lib/acting-person-context";

type CacheOptions = { revalidate?: number | false; tags?: string[] };

export function personFreeCache<A extends unknown[], R>(
  fn: (...args: A) => Promise<R>,
  keyParts?: string[],
  options?: CacheOptions
): (...args: A) => Promise<R> {
  const fill = (...args: A): Promise<R> => runWithoutActingPerson(() => fn(...args));
  Object.defineProperty(fill, "toString", { value: () => fn.toString() });
  Object.defineProperty(fill, "name", { value: fn.name });
  return unstable_cache(fill, keyParts, options);
}
