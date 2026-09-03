import { NextResponse, type NextRequest } from "next/server";
import { requireAuth } from "@/lib/supabase/auth-guard";
import { callVeridianResult } from "@/lib/veridian-client";
import { veridianErrorResponse } from "@/lib/veridian-response";
import { withTiming } from "@/lib/with-timing";

// Thin proxy: the browser-side Chain Selector needs this tree, but the
// VERIDIAN Bearer key must never reach the client -- this route holds it
// server-side and forwards only the resulting node tree.
//
// R67 F-21 (audit recommendation R-236). THIS PAYLOAD IS 14 KB AND IT WAS
// RE-SENT ON EVERY NAVIGATION. The construction capability tree changes when
// the product ships new modules, not while a user is working, so it now
// carries an ETag and Cache-Control: private, max-age=86400 and honours
// If-None-Match: a repeat request costs a 304 with no body instead of 14 KB.
//
// `private` and not `public`: the tree is resolved with the caller's OWN org
// key and differs per organisation, so it must never sit in a shared cache.
// The ETag is derived from the body, so an org that gets a different tree gets
// a different tag and can never be served another org's 304.
export const dynamic = "force-dynamic";

const ONE_DAY_SECONDS = 86_400;

// FNV-1a: a short, stable, dependency-free content hash. This is a cache
// validator, not a security primitive -- it only has to change when the bytes
// change.
function etagFor(body: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < body.length; i++) {
    hash ^= body.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `W/"ct-${body.length.toString(36)}-${hash.toString(36)}"`;
}

export const GET = withTiming("GET", async function GET(request: NextRequest) {
  const ctx = await requireAuth();
  if (ctx.response) return ctx.response;

  const result = await callVeridianResult<{ nodes: unknown[] }>("/capability-tree", {
    organizationId: ctx.organizationId!,
  });
  if (!result.ok) return veridianErrorResponse(result, "Failed to load capability tree from VERIDIAN");

  const body = JSON.stringify(result.data);
  const etag = etagFor(body);
  // No Server-Timing here: withTiming() above sets it from the request-timing
  // ledger AFTER this returns and overwrites anything set locally, so a second
  // one could never be observed.
  const headers = {
    ETag: etag,
    "Cache-Control": "private, max-age=" + ONE_DAY_SECONDS,
  };

  // A matching validator means the client already has these exact bytes.
  // If-None-Match may carry a list; a match on any entry is a hit.
  const ifNoneMatch = request.headers.get("if-none-match");
  if (ifNoneMatch && ifNoneMatch.split(",").some((tag) => tag.trim() === etag)) {
    return new NextResponse(null, { status: 304, headers });
  }

  return new NextResponse(body, {
    status: 200,
    headers: { ...headers, "Content-Type": "application/json" },
  });
});
