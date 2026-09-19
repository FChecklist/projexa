import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/supabase/auth-guard";
import { callVeridian } from "@/lib/veridian-client";
import { veridianErrorResponse } from "@/lib/veridian-response";
import { MODULE_TAGS } from "@/lib/module-list-source";
import { revalidateTag } from "next/cache";
import { withTiming } from "@/lib/with-timing";

// Point 33: the material master (name/spec/unit/unitCost). Lives at VERIDIAN's
// /api/v1/construction/materials -- root:true because it was never
// re-exported under /api/v1/projexa/*, same reasoning as labour-roster.
//
// COST-VISIBILITY GAP FOUND AND FIXED (2026-09-19, Owner-authorized): unlike
// BOQ, this route (and VERIDIAN's own GET /api/v1/construction/materials)
// had NO cost-visibility gate at all -- unitCost was returned unconditionally
// to any authenticated org member, so site_engineer (and client_viewer, if
// they ever hit this route directly -- they never reach it from the
// workspace UI, but the API itself enforced nothing) saw the same
// unredacted figures an owner does. Cannot reuse
// cost-visibility-service.ts's canRoleSeeCost() as-is: that config is keyed
// by COMPLIANCE-TRACKER's own role model, which has no concept of
// site_engineer at all -- every PROJEXA site_engineer resolves there as
// plain "member" (confirmed live: Manoj Yadav's own compliance.users row),
// indistinguishable from a real Finance-titled member who SHOULD see cost.
// Redacting via that shared config would either leak for site_engineer
// (today's config has member's canSeeCost=true) or wrongly block a real
// Finance member too -- neither is right. Gating here instead, on
// PROJEXA's OWN real role (correct and already resolved at this layer,
// unlike compliance-tracker's flattened one): site_engineer and
// client_viewer, both structurally outside ROLE_GROUPS.PM_OR_ABOVE and
// outside any "acting as Finance" concept, never receive unitCost. member
// is left unredacted here (unchanged) rather than guessed at, since
// distinguishing a real Finance-titled member from a site_engineer mapped
// to "member" needs the same per-org config architecture BOQ already has --
// a real, separate follow-up, not invented in this pass.
const NO_MATERIAL_COST_ROLES = new Set(["site_engineer", "client_viewer"]);

function redactMaterialCost<T>(data: T): T {
  if (!data || typeof data !== "object") return data;
  const materials = (data as { materials?: unknown }).materials;
  if (!Array.isArray(materials)) return data;
  return {
    ...data,
    // null, not a deleted key: MaterialsClient's own Material type declares
    // unitCost as a required string, and its shared money() formatter
    // already renders null as "–" (format-money.ts's own documented
    // behaviour) -- the same "absent figure is an en-dash, never a
    // confident value" convention this screen already uses for quantities.
    materials: materials.map((m) => (m && typeof m === "object" ? { ...m, unitCost: null } : m)),
  };
}

export const GET = withTiming("GET", async function GET(request: NextRequest) {
  const ctx = await requireAuth();
  if (ctx.response) return ctx.response;
  const projectId = request.nextUrl.searchParams.get("projectId");
  if (!projectId) return NextResponse.json({ error: "projectId query param is required" }, { status: 400 });
  try {
    const data = await callVeridian(`/construction/materials?projectId=${encodeURIComponent(projectId)}`, { organizationId: ctx.organizationId!, root: true });
    const responseBody = ctx.role && NO_MATERIAL_COST_ROLES.has(ctx.role) ? redactMaterialCost(data) : data;
    return NextResponse.json(responseBody);
  } catch (err) {
    return veridianErrorResponse(err, "Failed to load material master");
  }
});

export const POST = withTiming("POST", async function POST(request: NextRequest) {
  const ctx = await requireAuth();
  if (ctx.response) return ctx.response;
  const body = await request.json();
  try {
    const data = await callVeridian("/construction/materials", { organizationId: ctx.organizationId!, method: "POST", body, root: true });
    // R67 F-18: the module list is cached for 30 s on the server, so a
    // create must clear it or the new row is invisible until the window
    // expires -- which reads exactly like a failed save.
    revalidateTag(MODULE_TAGS.materials, "max");
    return NextResponse.json(data, { status: 201 });
  } catch (err) {
    return veridianErrorResponse(err, "Failed to create material");
  }
});
