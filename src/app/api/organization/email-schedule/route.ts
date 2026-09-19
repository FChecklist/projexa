import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { requireAuth, requireRole, ROLE_GROUPS } from "@/lib/supabase/auth-guard";
import { db, organizations, orgEmailSchedule } from "@/lib/db";
import { withTiming } from "@/lib/with-timing";
import { DEFAULT_SCHEDULE_SLOTS } from "@/lib/email/schedule-service";

// The org-configurable start-of-day/end-of-day digest schedule (Owner
// directive 2026-09-19) -- read/written from the Settings page's "Daily
// Digest" card. Same GET-open-to-any-member / PUT-owner-admin-only split as
// the existing currency card (src/app/api/organization/currency/route.ts),
// for the same reason: everyone should be able to see when their org's
// digest goes out, only an admin should be able to change it.
const MAX_SLOTS = 3;
const ALLOWED_SLOTS = new Set(["morning", "evening", "custom"]);
const LOCAL_TIME_RE = /^([01][0-9]|2[0-3]):[0-5][0-9]$/;

function isValidTimezone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat(undefined, { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export const GET = withTiming("GET", async function GET() {
  const ctx = await requireAuth();
  if (ctx.response) return ctx.response;

  const [org] = await db.select().from(organizations).where(eq(organizations.id, ctx.organizationId!)).limit(1);
  if (!org) return NextResponse.json({ error: "Organization not found" }, { status: 404 });

  const schedules = await db.select().from(orgEmailSchedule).where(eq(orgEmailSchedule.organizationId, ctx.organizationId!));

  return NextResponse.json({
    timezone: org.timezone,
    schedules: schedules.map((s) => ({ id: s.id, slot: s.slot, label: s.label, localTime: s.localTime, enabled: s.enabled })),
    defaults: DEFAULT_SCHEDULE_SLOTS,
  });
});

type ScheduleInput = { slot?: string; label?: string; localTime?: string; enabled?: boolean };

export const PUT = withTiming("PUT", async function PUT(request: NextRequest) {
  const ctx = await requireAuth();
  if (ctx.response) return ctx.response;
  const roleError = requireRole(ctx, ROLE_GROUPS.ORG_ADMIN);
  if (roleError) return roleError;

  const body = (await request.json().catch(() => null)) as { timezone?: string; schedules?: ScheduleInput[] } | null;
  if (!body) return NextResponse.json({ error: "Invalid request body" }, { status: 400 });

  if (body.timezone !== undefined && !isValidTimezone(body.timezone)) {
    return NextResponse.json({ error: "timezone must be a valid IANA timezone, e.g. Asia/Kolkata" }, { status: 400 });
  }

  const schedules = Array.isArray(body.schedules) ? body.schedules : [];
  if (schedules.length > MAX_SLOTS) {
    return NextResponse.json({ error: `An organization can have at most ${MAX_SLOTS} digest emails a day` }, { status: 400 });
  }

  const seenFixedSlots = new Set<string>();
  const rows: Array<{ organizationId: string; slot: string; label: string; localTime: string; enabled: boolean }> = [];
  for (const s of schedules) {
    if (!s.slot || !ALLOWED_SLOTS.has(s.slot)) {
      return NextResponse.json({ error: `slot must be one of: ${Array.from(ALLOWED_SLOTS).join(", ")}` }, { status: 400 });
    }
    if (!s.localTime || !LOCAL_TIME_RE.test(s.localTime)) {
      return NextResponse.json({ error: "localTime must be 24h \"HH:MM\"" }, { status: 400 });
    }
    if (s.slot === "morning" || s.slot === "evening") {
      if (seenFixedSlots.has(s.slot)) {
        return NextResponse.json({ error: `Only one "${s.slot}" slot is allowed` }, { status: 400 });
      }
      seenFixedSlots.add(s.slot);
    }
    rows.push({ organizationId: ctx.organizationId!, slot: s.slot, label: (s.label ?? "").slice(0, 100), localTime: s.localTime, enabled: s.enabled !== false });
  }

  await db.transaction(async (tx) => {
    if (body.timezone) {
      await tx.update(organizations).set({ timezone: body.timezone }).where(eq(organizations.id, ctx.organizationId!));
    }
    await tx.delete(orgEmailSchedule).where(eq(orgEmailSchedule.organizationId, ctx.organizationId!));
    if (rows.length > 0) {
      await tx.insert(orgEmailSchedule).values(rows);
    }
  });

  return NextResponse.json({ ok: true });
});
