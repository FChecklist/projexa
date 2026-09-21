import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/supabase/auth-guard";
import { withTiming } from "@/lib/with-timing";
import { setLastProjectId } from "@/lib/services/project-preference-service";

// PROJEXA-NEXT-001 (2026-09-21). M24Shell.tsx's chooseProject() calls this
// alongside writeStoredProjectId() (the existing cookie/localStorage write),
// so an explicit project choice survives past this browser -- see
// project-selection.ts's readPreferredProjectId() for the read side.
export const PATCH = withTiming("PATCH", async function PATCH(request: NextRequest) {
  const ctx = await requireAuth();
  if (ctx.response) return ctx.response;
  if (!ctx.user || !ctx.organizationId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const projectId =
    typeof body?.projectId === "string" ? body.projectId : body?.projectId === null ? null : undefined;
  if (projectId === undefined) {
    return NextResponse.json({ error: "projectId must be a string or null" }, { status: 400 });
  }

  await setLastProjectId(ctx.organizationId, ctx.user.id, projectId);
  return NextResponse.json({ success: true });
});
