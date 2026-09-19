// Org-configurable digest schedule (drizzle/0025). Pure time-math functions
// are kept separate from the one DB query here so the time math itself is
// trivially unit-testable without a database -- the actual "is this
// schedule due right now, and has it already run today" decision combines
// this module's output with an idempotent claim-insert into
// email_digest_run, which lives in digest.ts's runDigestCadence() (the
// claim itself needs to be a single atomic INSERT ... ON CONFLICT DO
// NOTHING, not a separate read-then-write, so two concurrent trigger
// sources -- the existing vercel.json cron and the new GitHub Actions
// poller -- can never both send the same org's slot for the same local day).
import { eq } from "drizzle-orm";
import { db, orgEmailSchedule, organizations } from "@/lib/db";

/** Org-local calendar date ("YYYY-MM-DD") and minutes-since-midnight for `now`, in `timezone`. */
export function getOrgLocalDateTime(now: Date, timezone: string): { localDate: string; minutesSinceMidnight: number } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "00";
  return {
    localDate: `${get("year")}-${get("month")}-${get("day")}`,
    minutesSinceMidnight: Number(get("hour")) * 60 + Number(get("minute")),
  };
}

/** "HH:MM" -> minutes since midnight. */
export function localTimeToMinutes(localTime: string): number {
  const [h, m] = localTime.split(":").map(Number);
  return h * 60 + m;
}

/**
 * Is `localTime` (org-local, "HH:MM") due right now, given a poll that runs
 * every `bucketMinutes`? Due means "at or after the target minute, but
 * within one bucket of it" -- a poller running every 15 minutes and a slot
 * set to 09:00 fires once, at the first poll >= 09:00 and < 09:15, not on
 * every poll for the rest of the day (idempotency on top of this, via
 * email_digest_run, is what actually prevents a re-send if the poller is
 * somehow invoked twice in the same bucket).
 */
export function isDue(localTime: string, now: Date, timezone: string, bucketMinutes = 15): boolean {
  const { minutesSinceMidnight } = getOrgLocalDateTime(now, timezone);
  const diff = minutesSinceMidnight - localTimeToMinutes(localTime);
  return diff >= 0 && diff < bucketMinutes;
}

export type EnabledSchedule = {
  scheduleId: string;
  organizationId: string;
  slot: string;
  localTime: string;
  timezone: string;
};

/** Every enabled schedule row, joined to its org's timezone. No due-filtering here -- callers apply isDue() themselves. */
export async function listEnabledSchedules(): Promise<EnabledSchedule[]> {
  const rows = await db
    .select({
      scheduleId: orgEmailSchedule.id,
      organizationId: orgEmailSchedule.organizationId,
      slot: orgEmailSchedule.slot,
      localTime: orgEmailSchedule.localTime,
      timezone: organizations.timezone,
    })
    .from(orgEmailSchedule)
    .innerJoin(organizations, eq(orgEmailSchedule.organizationId, organizations.id))
    .where(eq(orgEmailSchedule.enabled, true));

  return rows;
}

export const DEFAULT_SCHEDULE_SLOTS: Array<{ slot: "morning" | "evening"; label: string; localTime: string }> = [
  { slot: "morning", label: "Start of day", localTime: "09:00" },
  { slot: "evening", label: "End of day", localTime: "18:00" },
];
