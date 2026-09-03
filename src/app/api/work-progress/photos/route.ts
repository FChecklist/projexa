import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/supabase/auth-guard";
import { createClient } from "@/lib/supabase/server";
import { withTiming } from "@/lib/with-timing";

const BUCKET = "work-progress-photos";

// Closes the disclosed gap from work-progress-queue.ts: a photo captured
// offline is now actually uploaded once its progress entry syncs (see that
// file's sync loop). Written via the signed-in user's own Supabase session
// (this repo's established RLS-respecting pattern for org-scoped tables --
// see org/provision/route.ts -- not a service-role bypass), so Storage's own
// RLS policies (drizzle/0013) apply exactly the same as every other
// PROJEXA-owned table.
export const POST = withTiming("POST", async function POST(request: NextRequest) {
  const ctx = await requireAuth();
  if (ctx.response) return ctx.response;

  const form = await request.formData().catch(() => null);
  const veridianEntryId = form?.get("veridianEntryId");
  const file = form?.get("file");
  if (typeof veridianEntryId !== "string" || !veridianEntryId) {
    return NextResponse.json({ error: "veridianEntryId is required" }, { status: 400 });
  }
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "file is required" }, { status: 400 });
  }

  const supabase = await createClient();
  const organizationId = ctx.organizationId!;
  const storagePath = `${organizationId}/${veridianEntryId}/${Date.now()}-${file.name}`;

  const { error: uploadError } = await supabase.storage
    .from(BUCKET)
    .upload(storagePath, await file.arrayBuffer(), { contentType: file.type || "application/octet-stream" });
  if (uploadError) {
    return NextResponse.json({ error: `Photo upload failed: ${uploadError.message}` }, { status: 502 });
  }

  const { data: row, error: insertError } = await supabase
    .from("work_progress_photos")
    .insert({
      organization_id: organizationId,
      veridian_entry_id: veridianEntryId,
      uploaded_by: ctx.user!.id,
      storage_path: storagePath,
      file_name: file.name,
      content_type: file.type || "application/octet-stream",
    })
    .select()
    .single();
  if (insertError || !row) {
    return NextResponse.json({ error: insertError?.message ?? "Failed to record photo attachment" }, { status: 500 });
  }

  return NextResponse.json(row, { status: 201 });
});

export const GET = withTiming("GET", async function GET(request: NextRequest) {
  const ctx = await requireAuth();
  if (ctx.response) return ctx.response;

  const veridianEntryId = request.nextUrl.searchParams.get("veridianEntryId");
  if (!veridianEntryId) return NextResponse.json({ error: "veridianEntryId query param is required" }, { status: 400 });

  const supabase = await createClient();
  const { data: rows, error } = await supabase
    .from("work_progress_photos")
    .select("id, storage_path, file_name, content_type, created_at")
    .eq("organization_id", ctx.organizationId!)
    .eq("veridian_entry_id", veridianEntryId)
    .order("created_at", { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const photos = await Promise.all(
    (rows ?? []).map(async (r) => {
      const { data: signed } = await supabase.storage.from(BUCKET).createSignedUrl(r.storage_path, 3600);
      return { id: r.id, fileName: r.file_name, contentType: r.content_type, createdAt: r.created_at, url: signed?.signedUrl ?? null };
    })
  );

  return NextResponse.json({ photos });
});
