import { NextRequest, NextResponse } from "next/server";
import { revalidatePath, revalidateTag } from "next/cache";
import { requireAuth } from "@/lib/supabase/auth-guard";
import { withTiming } from "@/lib/with-timing";
import { PX_REVALIDATABLE } from "@/lib/px-api-revalidate-table";

// AUDIT-100 A2 batch 7: the one small Vercel route left for the writes that moved to the Supabase Edge Function `projexa-api`.
//
// WHY IT EXISTS. Twelve of the routes that moved clear a PAGE-SIDE cache when they write: the server-rendered module pages (documents, drawings,
// permits, minutes, meetings, mood boards, manpower, materials, scope, projects, knowledge base) read their first list through unstable_cache
// (module-list-source.ts, 30 s) and the Next write handlers call revalidateTag / revalidatePath so a new row shows up at once instead of up to 30 s
// later, which reads exactly like a failed save. That cache lives in Vercel's data cache; a function on Supabase cannot clear it. So the browser, after
// the edge answered a write (src/lib/px-api.ts), asks THIS route to clear the same entries. Same entries, same moment (before the caller's own
// promise resolves), one tiny invocation per write instead of one per read.
//
// WHAT IT WILL CLEAR. Only the tags and paths named in PX_REVALIDATABLE (= the union of `revalidate` in ai-os/audit37/projexa-api-routes.json, which
// src/lib/projexa-api-edge.test.ts holds equal to what the real Next handlers cleared in the recorded parity contract). Anything else is a 400 and
// nothing is cleared. A tag clears that module's list cache for every organisation of this deployment ("broader than strictly needed, and correct: the
// next read simply re-fetches", module-list-source.ts), exactly what the Next write handler did, so a signed-in person gains nothing here they did not
// already have by saving a record. Open to every signed-in role (a client_viewer can clear a cache entry that holds nothing they cannot read).
const MAX_ITEMS = 4;

export const POST = withTiming("POST", async function POST(request: NextRequest) {
  const ctx = await requireAuth();
  if (ctx.response) return ctx.response;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Request body must be valid JSON" }, { status: 400 });
  }
  const { tags = [], paths = [] } = (body && typeof body === "object" ? body : {}) as { tags?: unknown; paths?: unknown };
  const isList = (v: unknown): v is string[] => Array.isArray(v) && v.length <= MAX_ITEMS && v.every((x) => typeof x === "string");
  if (!isList(tags) || !isList(paths) || tags.length + paths.length === 0) {
    return NextResponse.json({ error: "tags and paths must be lists of at most 4 names, at least one in all" }, { status: 400 });
  }
  const unknownTag = tags.find((t) => !PX_REVALIDATABLE.tags.includes(t));
  const unknownPath = paths.find((p) => !PX_REVALIDATABLE.paths.includes(p));
  if (unknownTag !== undefined || unknownPath !== undefined) {
    return NextResponse.json({ error: "Not a cache entry this route clears" }, { status: 400 });
  }
  for (const t of tags) revalidateTag(t, "max");
  for (const p of paths) revalidatePath(p);
  return NextResponse.json({ ok: true, tags, paths });
});
