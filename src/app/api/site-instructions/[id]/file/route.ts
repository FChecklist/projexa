import { NextRequest, NextResponse } from "next/server";
import { requireAuth, requireRole, ROLE_GROUPS } from "@/lib/supabase/auth-guard";
import { callVeridianUpload } from "@/lib/veridian-client";
import { veridianErrorResponse } from "@/lib/veridian-response";
import { withTiming } from "@/lib/with-timing";
import { SI_DOCUMENT_ENTITY_TYPE, siteInstructionFileError } from "@/lib/site-instruction-form";

// R-C14: attach a PDF or photo to a site instruction that ALREADY exists. The laptop-first form cannot carry a file (the registry's
// create_site_instruction has no file address), so the file is added here, after the instruction has been sent. It is the same documents
// write the multipart branch of POST /api/site-instructions makes (category site_instruction, linked to the instruction), nothing new.
export const POST = withTiming("POST", async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireAuth();
  if (ctx.response) return ctx.response;
  const roleError = requireRole(ctx, ROLE_GROUPS.PM_OR_ABOVE);
  if (roleError) return roleError;
  const { id } = await params;

  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "Choose the file to add" }, { status: 400 });
  const fileError = siteInstructionFileError({ name: file.name, size: file.size });
  if (fileError) return NextResponse.json({ error: fileError }, { status: 400 });

  try {
    const upload = new FormData();
    upload.set("file", file);
    upload.set("name", file.name);
    upload.set("category", "site_instruction");
    upload.set("linkedEntityType", SI_DOCUMENT_ENTITY_TYPE);
    upload.set("linkedEntityId", id);
    const document = await callVeridianUpload("/documents", upload, { organizationId: ctx.organizationId!, root: true });
    return NextResponse.json({ document, fileName: file.name }, { status: 201 });
  } catch (err) {
    return veridianErrorResponse(err, "Failed to attach the file to this site instruction");
  }
});
