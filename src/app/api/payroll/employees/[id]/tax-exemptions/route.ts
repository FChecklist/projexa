import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/supabase/auth-guard";
import { callVeridian, VeridianApiError } from "@/lib/veridian-client";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_request: NextRequest, { params }: RouteContext) {
  const ctx = await requireAuth();
  if (ctx.response) return ctx.response;
  try {
    const { id } = await params;
    const data = await callVeridian(`/payroll/employees/${encodeURIComponent(id)}/tax-exemptions`);
    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json({ error: err instanceof VeridianApiError ? err.message : "Failed to load tax exemptions" }, { status: 502 });
  }
}

export async function POST(request: NextRequest, { params }: RouteContext) {
  const ctx = await requireAuth();
  if (ctx.response) return ctx.response;
  const body = await request.json();
  try {
    const { id } = await params;
    const data = await callVeridian(`/payroll/employees/${encodeURIComponent(id)}/tax-exemptions`, { method: "POST", body });
    return NextResponse.json(data, { status: 201 });
  } catch (err) {
    return NextResponse.json({ error: err instanceof VeridianApiError ? err.message : "Failed to create tax exemption" }, { status: 502 });
  }
}
