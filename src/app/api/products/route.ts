import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/supabase/auth-guard";
import { callVeridian } from "@/lib/veridian-client";
import { veridianErrorResponse } from "@/lib/veridian-response";
import { withTiming } from "@/lib/with-timing";

// Feeds the Product picker on /projects/new (ProjectCreateClient.tsx, which
// replaced CreateProjectDialog in R67 D-01) -- a Project row requires
// a productId (VERIDIAN's schema), so the dialog needs the org's real
// product list (business lines like "Villa Projects", "Commercial &
// Office Fit-outs") before it can create one.
export const GET = withTiming("GET", async function GET() {
  const ctx = await requireAuth();
  if (ctx.response) return ctx.response;

  try {
    const data = await callVeridian<{ products: { id: string; name: string }[] }>("/products", { organizationId: ctx.organizationId! });
    return NextResponse.json({ products: data.products ?? [] });
  } catch (err) {
    return veridianErrorResponse(err, "Failed to load products");
  }
});
