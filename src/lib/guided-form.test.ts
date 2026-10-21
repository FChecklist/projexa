/// <reference types="bun-types" />
// GUIDED ERRORS G3 -- the pieces every G3 screen relies on: the fault a form raises for itself, the facts an error carries, the code derived from a
// server sentence, and (most important) that every fault the G3 screens raise lands on the guide written for it, with the exact place to fix.
import { describe, expect, test } from "bun:test";
import { contextFromError, contextFromFailure } from "./error-guide/context";
import { matchGuide, resolveGuide } from "./error-guide/match";
import { fault, httpError, notANumber, serverMessageCode, todayLocalIso, withServerCode } from "./guided-form";

describe("fault()", () => {
  test("is a not-sent failure carrying the code, the field and the sentence", () => {
    const f = fault("QTY_NOT_POSITIVE", "quantity", "The quantity is not valid.");
    expect(f.kind).toBe("not-sent");
    expect(f.retryable).toBe(false);
    expect(f.code).toBe("QTY_NOT_POSITIVE");
    expect(f.field).toBe("quantity");
    const ctx = contextFromFailure(f, { projectId: "p1" });
    expect(ctx.code).toBe("QTY_NOT_POSITIVE");
    expect(ctx.field).toBe("quantity");
    expect(ctx.serverMessage).toBe("The quantity is not valid.");
    expect(ctx.projectId).toBe("p1");
  });
});

describe("httpError()", () => {
  test("keeps the server's own words and the facts the matcher reads", () => {
    const e = httpError({ status: 409 }, { error: "Meeting is already published", code: "X" }, "fallback", "patch", "/api/moms/1") as Error & Record<string, unknown>;
    expect(e.message).toBe("Meeting is already published");
    expect(e.status).toBe(409);
    expect(e.code).toBe("X");
    expect(e.method).toBe("PATCH");
    expect(e.apiPath).toBe("/api/moms/1");
    const ctx = contextFromError(e);
    expect(ctx.status).toBe(409);
    expect(ctx.method).toBe("PATCH");
  });
  test("falls back when the body has no sentence", () => {
    expect(httpError({ status: 500 }, null, "Failed to save", "POST", "/x").message).toBe("Failed to save");
  });
});

describe("serverMessageCode() / withServerCode()", () => {
  test("maps the server sentences the harvested catalogue does not hold", () => {
    expect(serverMessageCode("Meeting is already published")).toBe("MOM_ALREADY_PUBLISHED");
    expect(serverMessageCode("This meeting is published and locked -- its details cannot be edited")).toBe("MOM_LOCKED");
    expect(serverMessageCode("Only published meetings can be shared")).toBe("MOM_SHARE_UNPUBLISHED");
    expect(serverMessageCode("Meeting has no minutes to analyze")).toBe("MOM_NO_MINUTES");
    expect(serverMessageCode("That person is not in your organisation")).toBe("MOM_ASSIGNEE_NOT_IN_ORG");
    expect(serverMessageCode("This share link is invalid or has expired")).toBe("MOM_SHARE_EXPIRED");
    expect(serverMessageCode("The submitter cannot review their own time entry")).toBe("SELF_REVIEW");
    expect(serverMessageCode("No submitted hours to review for this day")).toBe("DAY_NOT_SUBMITTED");
    expect(serverMessageCode("This invitation has been revoked.")).toBe("INVITE_REVOKED");
    expect(serverMessageCode("This invitation was issued to a different email address.")).toBe("INVITE_WRONG_EMAIL");
    expect(serverMessageCode("Something nobody mapped")).toBeUndefined();
    expect(serverMessageCode(undefined)).toBeUndefined();
  });
  test("an error that already carries its own code keeps it", () => {
    const e = Object.assign(new Error("Meeting is already published"), { code: "OWN" });
    expect(withServerCode(e, { projectId: "p" })).toEqual({ projectId: "p" });
    expect(withServerCode(new Error("Meeting is already published"), { projectId: "p" })).toEqual({ projectId: "p", code: "MOM_ALREADY_PUBLISHED" });
  });
});

describe("small helpers", () => {
  test("notANumber", () => {
    expect(notANumber("")).toBe(true);
    expect(notANumber("  ")).toBe(true);
    expect(notANumber("abc")).toBe(true);
    expect(notANumber("12.5")).toBe(false);
    expect(notANumber("-3")).toBe(false);
  });
  test("todayLocalIso is the local calendar day, zero-padded", () => {
    expect(todayLocalIso(new Date(2026, 0, 5, 23, 59))).toBe("2026-01-05");
    expect(todayLocalIso(new Date(2026, 11, 31, 0, 1))).toBe("2026-12-31");
  });
});

// Every fault a G3 screen raises, with the screen it is raised on: the guide that must answer it and where its Fix button must go.
type Case = { code: string; field?: string; route: string; guide: string; to: string; focus?: string };
const CASES: Case[] = [
  { code: "BAD_UNIT_COST", field: "unitCost", route: "/materials/new", guide: "materials-unit-cost-invalid", to: "/materials/new", focus: "unitCost" },
  { code: "BAD_UNIT_COST", field: "material-unit-cost", route: "/materials/m1", guide: "materials-unit-cost-invalid", to: "/materials/m1", focus: "material-unit-cost" },
  { code: "REORDER_NEGATIVE", field: "reorderLevel", route: "/materials/new", guide: "materials-reorder-negative", to: "/materials/new", focus: "reorderLevel" },
  { code: "QTY_NOT_POSITIVE", field: "quantity", route: "/materials/receipts/new", guide: "materials-qty-not-positive", to: "/materials/receipts/new", focus: "quantity" },
  { code: "ISSUE_EXCEEDS_STOCK", field: "quantity", route: "/materials/issues/new", guide: "materials-issue-more-than-stock", to: "/materials/issues/new", focus: "quantity" },
  { code: "NOTHING_ON_HAND", field: "materialId", route: "/materials/issues/new", guide: "materials-nothing-on-hand", to: "/materials/receipts/new", focus: "materialId" },
  { code: "NO_MATERIALS", field: "materialId", route: "/materials/receipts/new", guide: "materials-none-yet", to: "/materials/new", focus: "name" },
  { code: "DATE_FUTURE", field: "receivedDate", route: "/materials/receipts/new", guide: "input-date-in-future", to: "/materials/receipts/new", focus: "receivedDate" },
  { code: "RATE_INVALID", field: "dailyRate", route: "/labour/new", guide: "labour-rate-invalid", to: "/labour/new", focus: "dailyRate" },
  { code: "HOURS_RANGE", field: "hoursWorked", route: "/labour/attendance/new", guide: "design-timesheet-hours", to: "/labour/attendance/new", focus: "hoursWorked" },
  { code: "HOURS_RANGE", field: "hours-abc", route: "/labour/attendance/2026-10-21", guide: "design-timesheet-hours", to: "/labour/attendance/2026-10-21", focus: "hours-abc" },
  { code: "NO_WORKERS", field: "rosterId", route: "/labour/attendance/new", guide: "labour-none-yet", to: "/labour/new", focus: "name" },
  { code: "ATTENDANCE_FUTURE_DATE", route: "/labour/attendance/2099-01-01", guide: "labour-attendance-future-sheet", to: "/labour/attendance/" },
  { code: "NO_FILE", field: "document-drop-zone", route: "/documents/upload", guide: "docs-no-file", to: "/documents/upload", focus: "document-drop-zone" },
  { code: "EMPTY_FILE", field: "document-drop-zone", route: "/documents/upload", guide: "file-empty", to: "/documents/upload", focus: "document-drop-zone" },
  { code: "FILE_REJECTED", field: "file", route: "/drawings/new", guide: "file-rejected", to: "/drawings/new", focus: "file" },
  { code: "EXPIRY_BEFORE_ISSUE", field: "endDate", route: "/permits/new", guide: "permit-expiry-order", to: "/permits/new", focus: "endDate" },
  { code: "MOM_DATE_INVALID", field: "scheduledAt", route: "/moms/new", guide: "mom-date-invalid", to: "/moms/new", focus: "scheduledAt" },
  { code: "MOM_ALREADY_PUBLISHED", route: "/moms/m1", guide: "mom-already-published", to: "/moms/m1" },
  { code: "MOM_LOCKED", route: "/moms/m1", guide: "mom-locked", to: "/moms/m1" },
  { code: "MOM_SHARE_UNPUBLISHED", route: "/moms/m1", guide: "mom-share-unpublished", to: "/moms/e1", focus: "mom-publish" },
  { code: "MOM_NO_MINUTES", route: "/moms/m1", guide: "mom-no-minutes-to-summarise", to: "/moms/e1", focus: "mom-minutes" },
  { code: "MOM_ASSIGNEE_NOT_IN_ORG", route: "/moms/m1", guide: "mom-assignee-not-in-org", to: "/moms/e1", focus: "mom-action-assignee" },
  { code: "TASK_DATES_ORDER", field: "dueDate", route: "/schedule/tasks/new", guide: "schedule-task-dates-order", to: "/schedule/tasks/new", focus: "dueDate" },
  { code: "TASK_DURATION_INVALID", field: "durationDays", route: "/schedule/tasks/new", guide: "schedule-task-duration", to: "/schedule/tasks/new", focus: "durationDays" },
  { code: "NO_TASK_TYPES", field: "typeId", route: "/schedule/tasks/new", guide: "schedule-no-task-types", to: "/settings" },
  { code: "SPRINT_DATES_ORDER", field: "sprint-end", route: "/schedule/sprints/new", guide: "schedule-sprint-dates-order", to: "/schedule/sprints/new", focus: "sprint-end" },
  { code: "MILESTONE_NO_DATE", field: "milestone-target-date", route: "/schedule", guide: "schedule-milestone-no-date", to: "/schedule", focus: "milestone-target-date" },
  { code: "HOURS_RANGE", field: "new-entry-hours", route: "/design-studio/timesheets/new", guide: "design-timesheet-hours", to: "/design-studio/timesheets/new", focus: "new-entry-hours" },
  { code: "NO_TASKS", field: "new-entry-task", route: "/design-studio/timesheets/new", guide: "design-no-tasks", to: "/schedule/tasks/new", focus: "title" },
  { code: "TASK_NOT_PICKED", field: "design-row-task", route: "/design-studio/timesheets", guide: "design-pick-task", to: "/design-studio/timesheets", focus: "design-row-task" },
  { code: "SELF_REVIEW", route: "/design-studio/review", guide: "design-review-self", to: "/design-studio/review" },
  { code: "DAY_NOT_SUBMITTED", route: "/design-studio/review", guide: "design-day-not-submitted", to: "/design-studio/review" },
  { code: "TIMESHEET_LOCKED", route: "/design-studio/timesheets/t1", guide: "design-timesheet-locked", to: "/design-studio" },
  { code: "INVITE_EMAIL_INVALID", field: "invite-email", route: "/settings", guide: "invite-email-invalid", to: "/settings", focus: "invite-email" },
  { code: "INVITE_REVOKED", route: "/invite/abc", guide: "invite-revoked", to: "/login" },
  { code: "INVITE_WRONG_EMAIL", route: "/invite/abc", guide: "invite-wrong-email", to: "/login" },
  { code: "CLIPBOARD_BLOCKED", route: "/settings", guide: "clipboard-blocked", to: "" },
  { code: "MOM_SHARE_EXPIRED", route: "/shared/mom/abc", guide: "mom-share-expired", to: "/login" },
];

describe("every fault a G3 screen raises lands on its own guide, with the exact place to fix", () => {
  for (const c of CASES) {
    test(`${c.code}${c.field ? ` (${c.field})` : ""} on ${c.route}`, () => {
      const ctx = contextFromFailure(fault(c.code, c.field, "A specific sentence about the value."), { projectId: "p1", entityId: "e1", route: c.route, search: "?projectId=p1" });
      const guide = matchGuide(ctx);
      expect(guide.id).toBe(c.guide);
      const r = resolveGuide(guide, ctx);
      expect(r.title.trim().split(/\s+/).length).toBeLessThanOrEqual(8);
      // a guide that quotes the sentence shows the form's own words; a guide with a fixed description still has one
      if (guide.what.includes("{serverMessage}")) expect(r.what).toContain("A specific sentence about the value.");
      else expect(r.what.trim().length).toBeGreaterThan(0);
      expect(r.steps.length).toBeGreaterThanOrEqual(1);
      if (!c.to) {
        expect(r.fix).toBeNull();
        return;
      }
      expect(r.fix).not.toBeNull();
      const url = new URL(r.fix!.href, "https://x.test");
      expect(url.pathname.startsWith(c.to)).toBe(true);
      if (c.focus) expect(url.searchParams.get("focus")).toBe(c.focus);
    });
  }
});
