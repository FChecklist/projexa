import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/supabase/auth-guard";
import { callVeridian, callVeridianUpload, VeridianApiError } from "@/lib/veridian-client";
import { veridianErrorResponse } from "@/lib/veridian-response";
import { withTiming } from "@/lib/with-timing";

// PROJEXA-BUILD-002 WP-10 (way 1 and way 2): thin proxy of VERIDIAN's /projects/from-document, which reads a file and makes a project and
// its BOQ from it (compliance-tracker src/app/api/v1/projexa/projects/from-document/route.ts).
//
// POST relays the multipart form (file, productId, name, mode, acknowledgeQuestions, acknowledgeShortfall) with callVeridianUpload and
// ALWAYS adds ?async=1. With it VERIDIAN answers as soon as the file is claimed (202 {state, jobId}, or 200 {duplicate, projectId}) and
// reads the file after the answer, so this function stays short and the browser reads the job with GET. Without it the request would wait
// for the model for up to two minutes inside a Vercel function.
// GET reads one job by `sha256` (the hash of the file, which the browser has before it sends anything) or by `jobId`.
//
// The person is named by requireAuth() through the acting-person scope (withTiming), so the ledger row and the project name a real person.
// Error shape: the shared classifier, plus the upstream's own `code` as `upstreamCode` and its `issues` list, so a screen can tell a rate
// limit from an unreadable file without parsing a sentence. The file is relayed and never logged.
const SHA256 = /^[0-9a-f]{64}$/;
const JOB_ID = /^[A-Za-z0-9_-]{1,64}$/;

/** The upstream refusal's own code and issue list, or nothing when the error is not a VERIDIAN answer. */
function upstreamExtras(err: unknown): Record<string, unknown> {
  if (!(err instanceof VeridianApiError)) return {};
  const issues = (err.body as { issues?: unknown } | undefined)?.issues;
  return {
    ...(err.ruleCode ? { upstreamCode: err.ruleCode } : {}),
    ...(Array.isArray(issues) ? { issues: issues.filter((i): i is string => typeof i === "string").slice(0, 20) } : {}),
  };
}

export const POST = withTiming("POST", async function POST(request: NextRequest) {
  const ctx = await requireAuth();
  if (ctx.response) return ctx.response;
  try {
    const formData = await request.formData();
    if (!(formData.get("file") instanceof File)) return NextResponse.json({ error: "Choose a file to send.", code: "no_file" }, { status: 400 });
    if (!String(formData.get("productId") ?? "").trim()) return NextResponse.json({ error: "Choose a product for the project.", code: "product_required" }, { status: 400 });
    const data = await callVeridianUpload<{ duplicate?: boolean }>("/projects/from-document?async=1", formData, { organizationId: ctx.organizationId! });
    return NextResponse.json(data, { status: data && data.duplicate === true ? 200 : 202 });
  } catch (err) {
    return veridianErrorResponse(err, "Failed to send the file", undefined, upstreamExtras(err));
  }
});

export const GET = withTiming("GET", async function GET(request: NextRequest) {
  const ctx = await requireAuth();
  if (ctx.response) return ctx.response;
  const sha256 = (request.nextUrl.searchParams.get("sha256") ?? "").trim().toLowerCase();
  const jobId = (request.nextUrl.searchParams.get("jobId") ?? "").trim();
  if (!SHA256.test(sha256) && !JOB_ID.test(jobId)) {
    return NextResponse.json({ error: "Give the sha256 of the file or the job id.", code: "job_reference_required" }, { status: 400 });
  }
  try {
    const query = SHA256.test(sha256) ? `sha256=${sha256}` : `jobId=${encodeURIComponent(jobId)}`;
    const data = await callVeridian(`/projects/from-document?${query}`, { organizationId: ctx.organizationId! });
    return NextResponse.json(data);
  } catch (err) {
    return veridianErrorResponse(err, "Failed to read the file's progress", undefined, upstreamExtras(err));
  }
});
