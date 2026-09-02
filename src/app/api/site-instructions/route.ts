import { NextRequest, NextResponse } from "next/server";
import { requireAuth, requireRole, ROLE_GROUPS } from "@/lib/supabase/auth-guard";
import { callVeridian, callVeridianUpload, VeridianApiError } from "@/lib/veridian-client";

// R39/R-C14: Architect/Site Instruction (SI) -- SCHEMA-ASSUMED-INDUSTRY-
// STANDARD, see the VERIDIAN-side schema.ts comment for the full explanation.
export async function GET(request: NextRequest) {
  const ctx = await requireAuth();
  if (ctx.response) return ctx.response;
  const projectId = request.nextUrl.searchParams.get("projectId");
  if (!projectId) return NextResponse.json({ error: "projectId query param is required" }, { status: 400 });
  try {
    const data = await callVeridian(`/site-instructions?projectId=${encodeURIComponent(projectId)}`, { organizationId: ctx.organizationId! });
    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json({ error: err instanceof VeridianApiError ? err.message : "Failed to load site instructions" }, { status: err instanceof VeridianApiError ? err.status : 502 });
  }
}

/**
 * R67 D-27: this handler now accepts a multipart body as well as JSON.
 *
 * WHY BOTH: a site instruction is a RECORD (constructionSiteInstructions --
 * project, issue date, to-contractor, description, optional boqId) and the
 * PDF or photo that authorises the change is a FILE. The record's table has no
 * file column, and this codebase's established way to attach a file to a row is
 * the documents table with linkedEntityType/linkedEntityId -- the same
 * mechanism construction_work_progress photos already use. So a multipart POST
 * here does the two real writes in order: create the SI, then upload the file
 * against it. A JSON POST is untouched and still creates the record alone.
 *
 * The order matters and is deliberate: the RECORD is created first, so a failed
 * upload leaves a real, findable site instruction that the file can be attached
 * to on a retry, rather than an orphaned file with nothing pointing at it. When
 * the upload fails the response is a 207 naming both halves, so the caller can
 * say exactly what happened instead of reporting a whole failure.
 */
export const SI_DOCUMENT_ENTITY_TYPE = "construction_site_instruction";

export async function POST(request: NextRequest) {
  const ctx = await requireAuth();
  if (ctx.response) return ctx.response;
  const roleError = requireRole(ctx, ROLE_GROUPS.PM_OR_ABOVE);
  if (roleError) return roleError;

  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.includes("multipart/form-data")) {
    const body = await request.json();
    try {
      const data = await callVeridian("/site-instructions", { organizationId: ctx.organizationId!, method: "POST", body });
      return NextResponse.json(data, { status: 201 });
    } catch (err) {
      return NextResponse.json({ error: err instanceof VeridianApiError ? err.message : "Failed to create site instruction" }, { status: err instanceof VeridianApiError ? err.status : 502 });
    }
  }

  const form = await request.formData();
  const file = form.get("file");
  const projectId = String(form.get("projectId") ?? "");
  if (!projectId) return NextResponse.json({ error: "projectId is required" }, { status: 400 });

  const record = {
    projectId,
    issueDate: String(form.get("issueDate") ?? new Date().toISOString().slice(0, 10)),
    toContractor: String(form.get("toContractor") ?? "").trim() || "Main contractor",
    description: String(form.get("description") ?? "").trim() || "Site instruction authorising this BOQ revision",
    ...(form.get("boqId") ? { boqId: String(form.get("boqId")) } : {}),
    ...(form.get("drawingRef") ? { drawingRef: String(form.get("drawingRef")) } : {}),
    costImpact: true,
  };

  let siteInstruction: { id?: string; siNumber?: number };
  try {
    siteInstruction = await callVeridian<{ id?: string; siNumber?: number }>("/site-instructions", {
      organizationId: ctx.organizationId!, method: "POST", body: record,
    });
  } catch (err) {
    return NextResponse.json({ error: err instanceof VeridianApiError ? err.message : "Failed to create site instruction" }, { status: err instanceof VeridianApiError ? err.status : 502 });
  }

  if (!(file instanceof File) || !siteInstruction?.id) {
    return NextResponse.json({ siteInstruction }, { status: 201 });
  }

  try {
    const upload = new FormData();
    upload.set("file", file);
    upload.set("name", file.name);
    upload.set("category", "site_instruction");
    upload.set("linkedEntityType", SI_DOCUMENT_ENTITY_TYPE);
    upload.set("linkedEntityId", siteInstruction.id);
    const document = await callVeridianUpload("/documents", upload, { organizationId: ctx.organizationId!, root: true });
    return NextResponse.json({ siteInstruction, document, fileName: file.name }, { status: 201 });
  } catch (err) {
    // 207: the record landed, the file did not. Never reported as a clean
    // success, and never as a whole failure either -- both halves are named so
    // the caller can offer a retry that attaches to the SI that now exists.
    return NextResponse.json(
      {
        siteInstruction,
        attachmentError: err instanceof VeridianApiError ? err.message : "Failed to attach the site instruction file",
      },
      { status: 207 }
    );
  }
}
