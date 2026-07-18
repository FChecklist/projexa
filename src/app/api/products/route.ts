import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/supabase/auth-guard";
import { callVeridian, VeridianApiError } from "@/lib/veridian-client";

// Feeds the Product picker in CreateProjectDialog -- a Project row requires
// a productId (VERIDIAN's schema), so the dialog needs the org's real
// product list (business lines like "Villa Projects", "Commercial &
// Office Fit-outs") before it can create one.
export async function GET() {
  const ctx = await requireAuth();
  if (ctx.response) return ctx.response;

  try {
    const data = await callVeridian<{ products: { id: string; name: string }[] }>("/products", { organizationId: ctx.organizationId! });
    return NextResponse.json({ products: data.products ?? [] });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof VeridianApiError ? err.message : "Failed to load products" },
      { status: err instanceof VeridianApiError ? err.status : 502 }
    );
  }
}
