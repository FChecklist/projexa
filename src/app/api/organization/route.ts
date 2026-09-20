import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/supabase/auth-guard";
import { getSettingsOrgInfo } from "@/lib/settings-source";
import { withTiming } from "@/lib/with-timing";

// Real PROJEXA-side data (organizations table), not VERIDIAN -- see
// drizzle/0001_projexa_tenant_schema.sql. requireAuth() already resolves
// organizationId/role from the membership row; this just adds the
// organization's own name/slug, which nothing else in the app has needed
// to fetch until now.
//
// PROJEXA-E2E-001 cold-load fix (2026-09-21): the actual query moved into
// settings-source.ts's getSettingsOrgInfo(), which /settings's own server
// component now ALSO calls (SSR'd + streamed, so this route is no longer
// the only way to get this data) -- one implementation, two callers, same
// precedent as risk-register-service.ts's *WithDb extraction. This route's
// own behavior (shape, status codes) is unchanged; it's still the real
// client-side refresh path SettingsClient's currency/role edits use.
export const GET = withTiming("GET", async function GET() {
  const ctx = await requireAuth();
  if (ctx.response) return ctx.response;

  const result = await getSettingsOrgInfo(ctx);
  if ("error" in result) return NextResponse.json({ error: result.error }, { status: 404 });
  return NextResponse.json(result);
});
