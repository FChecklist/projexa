// Sumeet audit 2026-10-20 (defect 1): a create that outlives the screen's wait has usually still completed on the server. These
// helpers let a create form look for the record it was making, after a timeout, so it can land on it instead of showing
// "it may have been saved". Pure functions plus one small poll; the screens own the fetch.

/** A record counts as "the one just made" only if it was created within this long of the lookup. */
export const RECOVER_WINDOW_MS = 60_000;

const norm = (s: unknown) => (typeof s === "string" ? s.trim().toLowerCase() : "");
const ageMs = (createdAt: unknown, now: number) => {
  const t = typeof createdAt === "string" ? Date.parse(createdAt) : NaN;
  return Number.isNaN(t) ? Infinity : now - t;
};

export type SiteInstructionRow = {
  id?: string;
  siNumber?: number | null;
  issueDate?: string | null;
  toContractor?: string | null;
  description?: string | null;
  createdAt?: string | null;
};

/**
 * The site instruction a timed-out save was creating: same issue date, contractor and instruction text, created in the last
 * minute. The newest match wins; an older identical record (a deliberate earlier one) never matches.
 */
export function findRecentSiteInstruction(
  rows: ReadonlyArray<SiteInstructionRow> | null | undefined,
  sent: { issueDate: string; toContractor: string; description: string },
  now: number = Date.now(),
  windowMs: number = RECOVER_WINDOW_MS
): SiteInstructionRow | null {
  const matches = (rows ?? []).filter(
    (r) =>
      typeof r.id === "string" &&
      (r.issueDate ?? "").slice(0, 10) === sent.issueDate.slice(0, 10) &&
      norm(r.toContractor) === norm(sent.toContractor) &&
      norm(r.description) === norm(sent.description) &&
      ageMs(r.createdAt, now) <= windowMs &&
      ageMs(r.createdAt, now) >= -windowMs
  );
  matches.sort((a, b) => Date.parse(b.createdAt ?? "") - Date.parse(a.createdAt ?? ""));
  return matches[0] ?? null;
}

export type BoqHeaderRow = { id?: string; title?: string | null; status?: string | null; createdAt?: string | null };

/** The BOQ a timed-out save was creating: same title, still a draft, created within the window (the create is one transaction, so it is whole or absent). */
export function findRecentBoq(
  rows: ReadonlyArray<BoqHeaderRow> | null | undefined,
  sent: { title: string },
  now: number = Date.now(),
  windowMs: number = 2 * RECOVER_WINDOW_MS
): BoqHeaderRow | null {
  const matches = (rows ?? []).filter(
    (r) =>
      typeof r.id === "string" &&
      norm(r.title) === norm(sent.title) &&
      (r.status ?? "draft") === "draft" &&
      ageMs(r.createdAt, now) <= windowMs &&
      ageMs(r.createdAt, now) >= -windowMs
  );
  matches.sort((a, b) => Date.parse(b.createdAt ?? "") - Date.parse(a.createdAt ?? ""));
  return matches[0] ?? null;
}

/** Runs `look` up to `attempts` times, `delayMs` apart (the write may still be finishing), and returns the first hit. A throwing lookup counts as a miss. */
export async function lookForCreated<T>(
  look: () => Promise<T | null>,
  options: { attempts?: number; delayMs?: number; sleep?: (ms: number) => Promise<void> } = {}
): Promise<T | null> {
  const attempts = options.attempts ?? 3;
  const delayMs = options.delayMs ?? 3_000;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  for (let i = 0; i < attempts; i++) {
    try {
      const hit = await look();
      if (hit) return hit;
    } catch {
      /* a failed read is a miss, not an answer */
    }
    if (i < attempts - 1) await sleep(delayMs);
  }
  return null;
}
