/// <reference types="bun-types" />
// The owner's System log, against a fake API (the rows are shaped exactly like compliance.client_error_issues / client_log_events).
import { GlobalRegistrator } from "@happy-dom/global-registrator";
if (typeof globalThis.document === "undefined") GlobalRegistrator.register();

import { afterEach, describe, expect, test } from "bun:test";
import { cleanup, fireEvent, render, waitFor, within } from "@testing-library/react";
import SystemLogClient from "./SystemLogClient";
import { buildCopyReport, normaliseIssue, timelineEntries } from "@/lib/client-log/report";

afterEach(cleanup);

const breadcrumbs = [
  { t: "2026-10-20T09:00:00Z", type: "nav", label: "Opened /budgets/41", route: "/budgets/41" },
  { t: "2026-10-20T09:00:05Z", type: "click", label: "Save", route: "/budgets/41" },
  { t: "2026-10-20T09:00:06Z", type: "api", label: "PATCH /api/budgets/41 500 812ms", route: "/budgets/41" },
  { t: "2026-10-20T09:00:06Z", type: "error", label: "PATCH /api/budgets/41 failed (500)", route: "/budgets/41" },
];
const sample = {
  id: "ev-1", kind: "api_failure", severity: "error", message: "PATCH /api/budgets/41 failed (500): database is busy", stack: "Error: x\n    at save (a.js:1:1)",
  route: "/budgets/41", project_id: "p1", api_path: "/api/budgets/41", http_method: "PATCH", http_status: 500, request_id: "req-9", duration_ms: 812, user_id: "u1",
  breadcrumbs, context: { platform: "Android", screen: "390x800@3", language: "en-IN", online: true, appVersion: "abc123", userAgent: "UA" }, occurred_at: "2026-10-20T09:00:06Z",
};
const openIssue = { id: "iss-open", fingerprint: "f1", title: "x", first_seen_at: "2026-10-19T09:00:00Z", last_seen_at: "2026-10-20T09:00:06Z", occurrences: 7, people: 2, last_event_at: "2026-10-20T09:00:06Z", status: "open", severity: "error", project_ids: ["p1"], routes: ["/budgets/41"], reopened_count: 0, sample_event: sample };
const reopened = { ...openIssue, id: "iss-re", status: "reopened", reopened_count: 2, occurrences: 3 };
const fixedIssue = {
  ...openIssue, id: "iss-fixed", status: "fixed", fixed_at: "2026-10-18T10:00:00Z", fix_commit: "0123456789abcdef",
  fix_summary: "Budgets no longer lock the table while saving", fix_files: [{ path: "src/lib/budget-save.ts", change: "save in one short transaction" }, { path: "src/app/api/budgets/[id]/route.ts", change: "return 409 not 500" }],
};

function api(overrides: Record<string, unknown> = {}) {
  const calls: string[] = [];
  const load = async (url: string) => {
    calls.push(url);
    if (url in overrides) {
      const v = overrides[url];
      if (v instanceof Error) throw v;
      return v;
    }
    if (url.startsWith("/api/client-logs/issues?")) return { issues: [openIssue, reopened, fixedIssue] };
    if (url === "/api/projects") return { projects: [{ id: "p1", name: "Cedar Heights" }, { id: "p2", name: "Lake View" }] };
    if (url.startsWith("/api/client-logs/timeline")) {
      return {
        projectId: "p1",
        events: [
          { id: "t1", kind: "action", action_name: "Create Budget", outcome: "ok", duration_ms: 400, occurred_at: "2026-10-20T08:00:00Z", user_id: "u1", project_id: "p1", severity: "info" },
          { id: "t2", kind: "api_failure", message: "x", route: "/budgets/41", api_path: "/api/budgets/41", http_method: "PATCH", http_status: 500, occurred_at: "2026-10-20T09:00:06Z", user_id: "u1", project_id: "p1", severity: "error" },
        ],
      };
    }
    throw new Error(`unexpected ${url}`);
  };
  return { load, calls };
}

describe("System log: Open problems", () => {
  test("shows each problem in plain words with count, people, last seen, project, steps and collapsed technical details", async () => {
    const view = render(<SystemLogClient load={api().load} />);
    const list = await view.findByTestId("open-list");
    const cards = within(list).getAllByTestId("issue-card");
    expect(cards.length).toBe(2); // open + reopened, not the fixed one
    const first = cards[0]!;
    expect(within(first).getByTestId("issue-title").textContent).toBe("Saving or changing Budgets did not work: the server had a problem");
    expect(within(first).getByTestId("issue-facts").textContent).toContain("to 2 people");
    const facts = within(first).getByTestId("issue-facts").textContent!;
    expect(facts).toContain("Happened 7 times");
    expect(facts).toContain("Project: Cedar Heights");
    const steps = within(first).getByTestId("steps").textContent!;
    expect(steps).toContain("Opened /budgets/41");
    expect(steps).toContain('Pressed "Save"');
    const tech = within(first).getByTestId("technical") as HTMLDetailsElement;
    expect(tech.open).toBe(false); // collapsed
    expect(tech.textContent).toContain("req-9");
    expect(tech.textContent).toContain("Android");
    expect(within(cards[1]!).getByTestId("came-back").textContent).toContain("2 times");
    expect(view.getByTestId("tab-open").textContent).toContain("(2)");
    expect(view.getByTestId("tab-fixed").textContent).toContain("(1)");
  });

  test("friendly empty state when nothing has gone wrong", async () => {
    const view = render(<SystemLogClient load={api({ "/api/client-logs/issues?status=all&limit=200": { issues: [] } }).load} />);
    expect((await view.findByTestId("empty-state")).textContent).toContain("Nothing has gone wrong yet");
  });

  test("a failed read says so in words and offers Try again (never a blank)", async () => {
    const view = render(<SystemLogClient load={api({ "/api/client-logs/issues?status=all&limit=200": new Error("Forbidden: your role does not permit this action") }).load} />);
    const alert = await view.findByRole("alert");
    expect(alert.textContent).toContain("The list could not be loaded");
    expect(alert.textContent).toContain("Forbidden");
    expect(view.queryByTestId("empty-state")).toBeNull();
  });

  test("Copy report puts a complete plain-text report on the clipboard", async () => {
    let copied = "";
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: async (t: string) => void (copied = t) } });
    const view = render(<SystemLogClient load={api().load} />);
    const first = (await view.findAllByTestId("issue-card"))[0]!;
    fireEvent.click(within(first).getByTestId("copy-report"));
    await waitFor(() => expect(within(first).getByTestId("copy-report").textContent).toBe("Copied"));
    for (const must of [
      "PROJEXA PROBLEM REPORT", "Happened: 7 time(s) to 2 person(s)", "Screen: /budgets/41", "Cedar Heights (p1)", "PATCH /api/budgets/41 -> HTTP 500 after 812 ms (request id req-9)",
      "Android", '2. [2026-10-20T09:00:05Z] Pressed "Save"', "Error message:", "database is busy", "Stack:", "at save (a.js:1:1)",
    ]) expect(copied).toContain(must);
  });

  test("when the clipboard is blocked the report is shown to copy by hand", async () => {
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: async () => { throw new Error("denied"); } } });
    const view = render(<SystemLogClient load={api().load} />);
    const first = (await view.findAllByTestId("issue-card"))[0]!;
    fireEvent.click(within(first).getByTestId("copy-report"));
    const box = (await within(first).findByTestId("manual-copy")) as HTMLTextAreaElement;
    expect(box.value).toContain("PROJEXA PROBLEM REPORT");
  });
});

describe("System log: people count", () => {
  test("no detail request is made per card; an older backend without people just leaves the count out", async () => {
    const { people: _p, ...old } = openIssue as Record<string, unknown>;
    const a = api({ "/api/client-logs/issues?status=all&limit=200": { issues: [old] } });
    const view = render(<SystemLogClient load={a.load} />);
    const card = await view.findByTestId("issue-card");
    expect(within(card).getByTestId("issue-facts").textContent).not.toContain("person");
    expect(within(card).getByTestId("issue-facts").textContent).toContain("Happened 7 times.");
    expect(a.calls.some((c) => c.startsWith("/api/client-logs/issues/"))).toBe(false);
  });
});

describe("System log: Fixed", () => {
  test("shows what was done, the files changed and when", async () => {
    const view = render(<SystemLogClient load={api().load} />);
    await view.findByTestId("open-list");
    fireEvent.click(view.getByTestId("tab-fixed"));
    const record = await view.findByTestId("fix-record");
    expect(record.textContent).toContain("Budgets no longer lock the table while saving");
    const files = within(view.getByTestId("fix-files")).getAllByRole("listitem").map((li) => li.textContent);
    expect(files).toEqual(["src/lib/budget-save.ts — save in one short transaction", "src/app/api/budgets/[id]/route.ts — return 409 not 500"]);
    expect(view.getByTestId("fix-date").textContent).toContain("2026-10-18 10:00 UTC");
    expect(view.getByTestId("fix-date").textContent).toContain("01234567");
  });

  test("empty state", async () => {
    const view = render(<SystemLogClient load={api({ "/api/client-logs/issues?status=all&limit=200": { issues: [openIssue] } }).load} />);
    await view.findByTestId("open-list");
    fireEvent.click(view.getByTestId("tab-fixed"));
    expect((await view.findByTestId("empty-state")).textContent).toContain("No fixes recorded yet");
  });
});

describe("System log: Project timeline", () => {
  test("pick a project: actions and errors in time order, errors highlighted", async () => {
    const a = api();
    const view = render(<SystemLogClient load={a.load} />);
    await view.findByTestId("open-list");
    fireEvent.click(view.getByTestId("tab-timeline"));
    expect(view.getByText(/Pick a project/)).toBeTruthy();
    await waitFor(() => expect(within(view.getByTestId("timeline-project")).getAllByRole("option").length).toBe(3));
    fireEvent.change(view.getByTestId("timeline-project"), { target: { value: "p1" } });
    const list = await view.findByTestId("timeline-list");
    const rows = within(list).getAllByRole("listitem");
    expect(rows.map((r) => r.getAttribute("data-testid"))).toEqual(["timeline-action", "timeline-error"]);
    expect(rows[0]!.textContent).toContain("Created a budget — worked (0.4 s)");
    expect(rows[1]!.textContent).toContain("Problem: Saving or changing Budgets did not work");
    expect(a.calls.some((c) => c.startsWith("/api/client-logs/timeline?projectId=p1"))).toBe(true);
  });

  test("a project with nothing recorded gets a friendly empty state", async () => {
    const view = render(<SystemLogClient load={api({ "/api/client-logs/timeline?projectId=p2&limit=200": { events: [] } }).load} />);
    await view.findByTestId("open-list");
    fireEvent.click(view.getByTestId("tab-timeline"));
    await waitFor(() => expect(within(view.getByTestId("timeline-project")).getAllByRole("option").length).toBe(3));
    fireEvent.change(view.getByTestId("timeline-project"), { target: { value: "p2" } });
    expect((await view.findByTestId("empty-state")).textContent).toContain("Nothing recorded for this project yet");
  });
});

describe("report helpers", () => {
  test("a problem with no sample still gets a title and a report that says no steps were recorded", () => {
    const issue = normaliseIssue({ id: "i", title: "Something odd", status: "open", occurrences: 1, project_ids: [], routes: [] });
    expect(issue.title).toBe("Something odd");
    expect(buildCopyReport(issue)).toContain("(no steps were recorded)");
  });
  test("timeline writes read in plain words, older stored names too, in the order given", () => {
    const rows = timelineEntries([
      { id: "1", kind: "action", action_name: "Saved a BOQ", outcome: "ok", occurred_at: "a" },
      { id: "2", kind: "action", action_name: "Update · scope", outcome: "failed", occurred_at: "b" },
      { id: "3", kind: "action", action_name: "Create or run · scope / approve", outcome: "ok", occurred_at: "c" },
      { id: "4", kind: "action", action_name: "Create Permit", outcome: "ok", occurred_at: "d" },
    ]);
    expect(rows.map((r) => r.text)).toEqual(["Saved a BOQ — worked", "Saved a BOQ — failed", "Approved a BOQ — worked", "Created a permit — worked"]);
  });
  test("timeline entries mark errors and failed actions", () => {
    const [a, b] = timelineEntries([{ id: "1", kind: "action", action_name: "Approve", outcome: "failed", occurred_at: "x" }, { id: "2", kind: "render_error", route: "/scope/3", occurred_at: "y" }]);
    expect(a!.isError).toBe(false);
    expect(a!.text).toBe("Approve — failed");
    expect(b!.isError).toBe(true);
    expect(b!.text).toBe('The screen "Scope" could not open');
  });
});
