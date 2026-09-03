// R67 D-18. A meeting is usually being created WHILE it happens, so the
// create form pre-fills "now, rounded up to the next quarter hour". The
// audit's point is that "now" is only meaningful with a zone attached: a
// meeting stamped in the wrong zone puts the wrong time on the minutes PDF
// the client receives.
//
// WHY THIS FILE EXISTS AT ALL rather than `new Date()` inline in the form:
// <input type="datetime-local"> speaks WALL CLOCK with no zone, and
// `new Date("2026-09-02T14:30")` resolves that wall clock against whichever
// machine parses it -- the browser on the way in, and (because the old POST
// body forwarded the raw string) a UTC serverless function on the way out.
// Those are two different answers for the same typed value. Everything here
// is pure and unit-tested in org-time.test.ts.
//
// HONEST LIMITATION, stated rather than hidden: PROJEXA's `organizations`
// table has no timezone column today (src/lib/db/schema.ts -- it carries
// name/slug/country only), so /api/organization does not return one yet.
// resolveOrgTimeZone() is written to USE that field the moment it exists and
// to fall back to the viewer's own zone until then, which is the honest
// answer for a single-site contractor and a visible, labelled one for
// everybody else -- the form always names the zone it used.

/** The zone the form falls back to when nothing else can be resolved. */
export const FALLBACK_TIME_ZONE = "UTC";

function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone }).format(new Date());
    return true;
  } catch {
    return false;
  }
}

/**
 * Pure given its inputs. Order: the organisation's own configured zone, then
 * the viewer's browser zone, then UTC. `browserTimeZone` is passed in rather
 * than read here so this stays testable and server-safe.
 */
export function resolveOrgTimeZone(orgTimeZone?: string | null, browserTimeZone?: string | null): string {
  for (const candidate of [orgTimeZone, browserTimeZone]) {
    const value = candidate?.trim();
    if (value && isValidTimeZone(value)) return value;
  }
  return FALLBACK_TIME_ZONE;
}

/** The viewer's own zone, or the fallback where Intl cannot say. */
export function browserTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || FALLBACK_TIME_ZONE;
  } catch {
    return FALLBACK_TIME_ZONE;
  }
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/** The wall-clock parts of an instant, as read in a given zone. */
function wallClockPartsIn(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone, hour12: false,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).formatToParts(date);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? "0");
  // Some engines render midnight as hour "24" under hour12:false.
  return { year: get("year"), month: get("month"), day: get("day"), hour: get("hour") % 24, minute: get("minute"), second: get("second") };
}

/**
 * The value to put in an <input type="datetime-local">: the current wall
 * clock in `timeZone`, rounded UP to the next quarter hour. Already on a
 * quarter hour stays put. Rolls the hour, day, month and year correctly
 * because the arithmetic is done on the wall-clock components in UTC space.
 */
export function nextQuarterHourLocalInput(timeZone: string, now: Date = new Date()): string {
  const p = wallClockPartsIn(now, timeZone);
  const roundedMinutes = Math.ceil(p.minute / 15) * 15;
  const wall = new Date(Date.UTC(p.year, p.month - 1, p.day, p.hour, 0) + roundedMinutes * 60_000);
  return `${wall.getUTCFullYear()}-${pad(wall.getUTCMonth() + 1)}-${pad(wall.getUTCDate())}T${pad(wall.getUTCHours())}:${pad(wall.getUTCMinutes())}`;
}

/**
 * Turns a datetime-local value (a bare wall clock, no zone) into a real
 * instant, reading it in `timeZone`. Two passes so a value that lands on a
 * DST transition resolves against the offset in force at the resulting
 * instant rather than the one before it. Returns "" for an unparseable value
 * so a caller can treat it as "not filled in" instead of posting NaN.
 */
export function zonedInputToIso(value: string, timeZone: string): string {
  if (!value) return "";
  const asIfUtc = Date.parse(`${value.length === 16 ? `${value}:00` : value}Z`);
  if (Number.isNaN(asIfUtc)) return "";
  let instant = asIfUtc;
  for (let i = 0; i < 2; i++) {
    const p = wallClockPartsIn(new Date(instant), timeZone);
    const offset = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - instant;
    instant = asIfUtc - offset;
  }
  return new Date(instant).toISOString();
}

/**
 * What the hint under the field says, e.g. "Asia/Dubai (GMT+4)". The zone is
 * always named, because a pre-filled time the user cannot attribute to a zone
 * is exactly the failure this closes.
 */
export function timeZoneHint(timeZone: string, at: Date = new Date()): string {
  try {
    const parts = new Intl.DateTimeFormat("en-GB", { timeZone, timeZoneName: "shortOffset" }).formatToParts(at);
    const name = parts.find((p) => p.type === "timeZoneName")?.value;
    return name ? `${timeZone} (${name})` : timeZone;
  } catch {
    return timeZone;
  }
}
