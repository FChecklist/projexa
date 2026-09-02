import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/supabase/auth-guard";
import { callVeridian } from "@/lib/veridian-client";
import { veridianErrorResponse } from "@/lib/veridian-response";

// Real-screen conversion (2026-08-30): the Vendor Object Page's Banking
// facet -- erp-vendor-master-service.ts's addBankAccount/listBankAccounts
// existed since Wave 80 with zero proxy route ever built.
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireAuth();
  if (ctx.response) return ctx.response;
  try {
    const { id } = await params;
    const data = await callVeridian(`/vendors/${encodeURIComponent(id)}/bank-accounts`, { organizationId: ctx.organizationId! });
    return NextResponse.json(data);
  } catch (err) {
    return veridianErrorResponse(err, "Failed to load bank accounts");
  }
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireAuth();
  if (ctx.response) return ctx.response;
  const body = await request.json();
  try {
    const { id } = await params;
    const data = await callVeridian(`/vendors/${encodeURIComponent(id)}/bank-accounts`, { organizationId: ctx.organizationId!, method: "POST", body });
    return NextResponse.json(data, { status: 201 });
  } catch (err) {
    return veridianErrorResponse(err, "Failed to add bank account");
  }
}
