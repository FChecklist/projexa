import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/supabase/auth-guard";
import { callVeridian, VeridianApiError } from "@/lib/veridian-client";
import { veridianErrorResponse } from "@/lib/veridian-response";
import { withTiming } from "@/lib/with-timing";

// DEVICE LOG intake. A person's own phone or laptop keeps its error / action log and sends it here in batches of at most 50
// (src/lib/client-log/outbox.ts). Any signed-in member may send -- including a read-only client_viewer, whose errors matter just as much --
// so the write tier is ANY_ROLE (api-write-policy.ts). VERIDIAN stores the rows; this route only checks the shape and forwards it.
// A 429 from upstream is passed through as 429 so the device backs off instead of retrying hot.
const MAX_BODY_CHARS = 400_000;
const MAX_EVENTS = 50;

export const POST = withTiming("POST", async function POST(request: NextRequest) {
  const ctx = await requireAuth();
  if (ctx.response) return ctx.response;
  const raw = await request.text();
  if (raw.length > MAX_BODY_CHARS) return NextResponse.json({ error: "Too large" }, { status: 413 });
  let events: unknown;
  try {
    events = (JSON.parse(raw) as { events?: unknown }).events;
  } catch {
    return NextResponse.json({ error: "Body must be JSON" }, { status: 400 });
  }
  if (!Array.isArray(events) || events.length === 0) return NextResponse.json({ error: "events must be a non-empty array" }, { status: 400 });
  if (events.length > MAX_EVENTS) return NextResponse.json({ error: `At most ${MAX_EVENTS} events per request` }, { status: 400 });
  try {
    const data = await callVeridian("/client-logs", { organizationId: ctx.organizationId!, method: "POST", body: { events } });
    return NextResponse.json(data);
  } catch (err) {
    // The backend's rate limit (429, Retry-After: 60): pass it through so the device backs off by that long, not by a guess.
    if (err instanceof VeridianApiError && err.status === 429) {
      return NextResponse.json({ error: "Rate limit: slow down", retryAfterSeconds: 60 }, { status: 429, headers: { "Retry-After": "60" } });
    }
    return veridianErrorResponse(err, "Failed to store the device log");
  }
});
