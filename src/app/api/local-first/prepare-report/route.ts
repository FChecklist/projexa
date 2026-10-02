import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/supabase/auth-guard";
import { withTiming } from "@/lib/with-timing";

// LOCAL-FIRST, second line of the prepare monitor (src/lib/local-first/prepare-report.ts). The first line is the sync service (POST /prepare of
// projexa-sync, recorded in platform.projexa_prepare_state). When that service cannot be reached, the laptop sends the same small report here,
// and it lands in THIS site's runtime log as one greppable line, so a backend outage is not also a blind spot. It stores nothing and changes
// nothing; it only logs what a signed-in person's own laptop says about its own preparation. Every role may send it (a read-only person's
// laptop must be watched too).

const STAGES = new Set(["start", "worker", "app", "database", "projects", "done"]);
const STATUSES = new Set(["running", "retrying", "done", "failed"]);
const CLASSES = new Set([
  "service_unreachable", "signed_out", "not_linked", "worker_failed", "no_service_worker", "storage_blocked",
  "download_failed", "timeout", "project_unreadable", "rate_limited", "update_required", "other",
]);

export const POST = withTiming("POST", async function POST(request: NextRequest) {
  const ctx = await requireAuth();
  if (ctx.response) return ctx.response;
  if (!ctx.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const raw = await request.text();
  if (raw.length > 4096) return NextResponse.json({ error: "Too large" }, { status: 413 });
  let b: Record<string, unknown>;
  try {
    const v = JSON.parse(raw);
    if (v === null || typeof v !== "object" || Array.isArray(v)) throw new Error("shape");
    b = v as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Body must be a JSON object" }, { status: 400 });
  }
  const stage = typeof b.stage === "string" && STAGES.has(b.stage) ? b.stage : null;
  const status = typeof b.status === "string" && STATUSES.has(b.status) ? b.status : null;
  const percent = typeof b.percent === "number" && Number.isInteger(b.percent) && b.percent >= 0 && b.percent <= 100 ? b.percent : null;
  if (!stage || !status || percent === null) return NextResponse.json({ error: "stage, status and percent are required" }, { status: 400 });

  const line = {
    user: ctx.user.id,
    device: typeof b.device_id === "string" ? b.device_id.slice(0, 64) : null,
    release: typeof b.release_version === "string" ? b.release_version.slice(0, 40) : null,
    stage, status, percent,
    attempt: typeof b.attempt === "number" && Number.isInteger(b.attempt) ? b.attempt : null,
    error_class: typeof b.error_class === "string" && CLASSES.has(b.error_class) ? b.error_class : null,
    error_detail: typeof b.error_detail === "string" ? b.error_detail.slice(0, 300) : null,
  };
  // console.error so it is kept at error level in the runtime log for the cases that matter; progress lines are info
  (status === "failed" || status === "retrying" ? console.error : console.info)(`[prepare-report] ${JSON.stringify(line)}`);
  return new NextResponse(null, { status: 204 });
});
