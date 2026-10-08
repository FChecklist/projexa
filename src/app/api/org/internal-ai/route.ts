import { NextResponse } from "next/server";
import { requireAuth, requireRole, ROLE_GROUPS } from "@/lib/supabase/auth-guard";
import { callVeridian, VeridianApiError } from "@/lib/veridian-client";
import { withTiming } from "@/lib/with-timing";

// P6 (aims 5-6): the organisation owner's switch for PROJEXA's own AI. Thin proxy over VERIDIAN's
// /api/v1/projexa/internal-ai-allowance, which reads and writes the per-organisation flag (compliance-tracker migration 0692,
// default OFF) and stamps who/when. The change is limited to the organisation's owner/admin HERE (requireRole, plus the central
// table in lib/authz/api-write-policy.ts) and AGAIN on the VERIDIAN side, on the acting person's own role.
// Reading is open to any signed-in person so a screen can show the state; nothing sensitive is in it.
export const GET = withTiming("GET", async function GET() {
  const ctx = await requireAuth();
  if (ctx.response) return ctx.response;
  try {
    return NextResponse.json(await callVeridian("/internal-ai-allowance", { organizationId: ctx.organizationId! }));
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof VeridianApiError ? err.message : "Could not read this setting" },
      { status: err instanceof VeridianApiError ? err.status : 502 }
    );
  }
});

export const PUT = withTiming("PUT", async function PUT(req: Request) {
  const ctx = await requireAuth();
  if (ctx.response) return ctx.response;
  const forbidden = requireRole(ctx, ROLE_GROUPS.ORG_ADMIN);
  if (forbidden) return forbidden;

  const body = (await req.json().catch(() => null)) as { allowed?: unknown } | null;
  if (typeof body?.allowed !== "boolean") {
    return NextResponse.json({ error: "allowed must be true or false." }, { status: 400 });
  }
  try {
    const data = await callVeridian("/internal-ai-allowance", {
      method: "PUT",
      organizationId: ctx.organizationId!,
      body: { allowed: body.allowed },
    });
    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof VeridianApiError ? err.message : "Could not save this setting" },
      { status: err instanceof VeridianApiError ? err.status : 502 }
    );
  }
});
