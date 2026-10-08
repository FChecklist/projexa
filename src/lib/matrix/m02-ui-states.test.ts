import { describe, expect, test } from "bun:test";
import { dashboardSummary, listOutcomeFromError, listOutcomeFromResponse, listOutcomeFromRows, listOutcomeRows, mayAssertEmpty } from "@/lib/read-outcome";
import { STILL_LOADING_AFTER_MS, TAKING_LONGER_AFTER_MS, listDataState, loadingWords } from "@/lib/list-loading";
import { filterShippedNav, filterVisibleNav, isShippedRoute } from "@/lib/nav-routes";
import { saveDisabledReason, saveLabel } from "@/lib/save-label";
import { getLastChoice, lastChoiceKey, setLastChoice } from "@/lib/last-choice";
import { setScreenMessage, takeScreenMessage, parseScreenMessage } from "@/lib/screen-message";
import { WORKING_LOCALLY_TEXT } from "@/lib/local-first/connectivity";

// MATRIX category 2: UI/UX normal use WITHOUT AI: navigation, forms, empty / loading / error states, roles. Cases M02-01 ... M02-40.
// (Phone width and real clicks are in e2e/matrix-100-browser.spec.ts; this file holds the rules those screens obey.)

describe("M02 loading / empty / error / ready states", () => {
  test.each([
    [{ loading: true, rowCount: 0 }, "loading"], [{ loading: true, rowCount: 5 }, "ready"], [{ loading: false, rowCount: 0 }, "empty"],
    [{ loading: false, rowCount: 3 }, "ready"], [{ loading: false, rowCount: 3, error: "boom" }, "error"], [{ loading: true, rowCount: 0, error: "boom" }, "error"],
    [{ loading: false, rowCount: 0, error: "" }, "empty"], [{ loading: false, rowCount: 0, error: null }, "empty"],
  ])("M02-01 list state %j = %p", (input, want) => { expect(listDataState(input as never)).toBe(want as never); });
  test.each([[0, null], [2_999, null], [STILL_LOADING_AFTER_MS, "Still loading minutes… 3 s"], [5_400, "Still loading minutes… 5 s"], [TAKING_LONGER_AFTER_MS - 1, "Still loading minutes… 7 s"], [TAKING_LONGER_AFTER_MS, "This is taking longer than usual"], [60_000, "This is taking longer than usual"]])(
    "M02-02 loading words at %p ms", (ms, text) => { expect(loadingWords("minutes", ms).text).toBe(text); });
  test("M02-03 Retry is offered only once the wait is abnormal", () => {
    expect(loadingWords("x", 7_999).showRetry).toBe(false);
    expect(loadingWords("x", 8_000).showRetry).toBe(true);
  });
  test("M02-04 negative elapsed time never shows negative seconds", () => { expect(loadingWords("x", -500).seconds).toBe(0); });
  test("M02-05 an empty read is only claimed when the read SUCCEEDED", () => {
    expect(mayAssertEmpty(null)).toBe(true);
    expect(mayAssertEmpty("")).toBe(true);
    expect(mayAssertEmpty("504")).toBe(false);
  });
  test("M02-06 greeting: a failed load never says 'No active projects'", () => {
    expect(dashboardSummary(null, "Gateway timeout")).toContain("Couldn't load your projects");
    expect(dashboardSummary(null, null)).toContain("No active projects yet");
    expect(dashboardSummary({ totalProjects: 0, delayedProjectCount: 0 }, "x")).toContain("Couldn't load");
  });
  test("M02-07 greeting with real data states the count", () => {
    expect(dashboardSummary({ totalProjects: 5, delayedProjectCount: 0 }, null)).toContain("5");
    expect(dashboardSummary({ totalProjects: 1, delayedProjectCount: 1 }, null)).toMatch(/1/);
  });
  test("M02-08 200 with rows = ready; 200 with [] = empty; 200 with {} body = empty (not an error)", async () => {
    const ok = await listOutcomeFromResponse(new Response(JSON.stringify({ rows: [1, 2] })), (b) => (b as { rows: number[] }).rows);
    expect(ok).toEqual({ status: "ready", rows: [1, 2] });
    expect(await listOutcomeFromResponse(new Response(JSON.stringify({ rows: [] })), (b) => (b as { rows: number[] }).rows)).toEqual({ status: "empty" });
    expect(await listOutcomeFromResponse(new Response("{}"), (b) => (b as { rows?: number[] }).rows)).toEqual({ status: "empty" });
  });
  test.each([[500, true], [502, true], [504, true], [401, false], [403, false], [404, false]])("M02-09 HTTP %p error: retry offered = %p, never reported as empty", async (status, retry) => {
    const o = await listOutcomeFromResponse(new Response(JSON.stringify({ error: "nope" }), { status }), () => []);
    expect(o.status).toBe("error");
    if (o.status === "error") { expect(o.httpStatus).toBe(status); expect(o.retry).toBe(retry); }
  });
  test("M02-10 an error body that is not JSON still produces a readable error, never a crash", async () => {
    const o = await listOutcomeFromResponse(new Response("<html>bad gateway</html>", { status: 502 }), () => []);
    expect(o.status).toBe("error");
    if (o.status === "error") expect(o.safeMessage).not.toContain("<html>");
  });
  test("M02-11 a thrown network failure is an error with a retry, never 'empty'", () => {
    const o = listOutcomeFromError(new TypeError("Failed to fetch"));
    expect(o.status).toBe("error");
    expect(listOutcomeRows(o)).toEqual([]);
  });
  test("M02-12 rows helpers", () => {
    expect(listOutcomeFromRows([])).toEqual({ status: "empty" });
    expect(listOutcomeRows(listOutcomeFromRows([7]))).toEqual([7]);
  });
});

describe("M02 navigation and roles", () => {
  test.each(["/", "/dashboard", "/projects", "/materials", "/budgets"])("M02-13 core route %p is a shipped page", (r) => { expect(isShippedRoute(r)).toBe(true); });
  test.each(["/nope", "/projects/does/not/exist/at/all", "/site-materials", "/admin/secret"])("M02-14 %p is not a shipped page, so no dead pill is shown", (r) => { expect(isShippedRoute(r)).toBe(false); });
  test("M02-15 query string and hash do not change whether a route exists", () => {
    expect(isShippedRoute("/projects?x=1#top")).toBe(true);
    expect(isShippedRoute("/nope?x=1")).toBe(false);
  });
  test("M02-16 a dynamic detail route matches by shape", () => {
    expect(isShippedRoute("/accounting/journal-entries/abc-123")).toBe(true);
  });
  test("M02-17 nav filtering removes unknown pills and then empty sections", () => {
    const out = filterShippedNav([{ title: "A", items: [{ href: "/projects" }, { href: "/nope" }] }, { title: "B", items: [{ href: "/nope2" }] }]);
    expect(out.map((s) => s.title)).toEqual(["A"]);
    expect(out[0]!.items).toEqual([{ href: "/projects" }]);
    expect(filterVisibleNav([{ items: [{ href: "/nope" }] }])).toEqual([]);
  });
  test("M02-18 filtering never mutates the caller's menu", () => {
    const menu = [{ title: "A", items: [{ href: "/projects" }, { href: "/nope" }] }];
    filterShippedNav(menu);
    expect(menu[0]!.items.length).toBe(2);
  });
});

describe("M02 forms: Save button words", () => {
  test("M02-19 Save names what is still needed", () => {
    expect(saveLabel("Save", [])).toBe("Save");
    expect(saveLabel("Save", ["Title", "Unit"])).toBe("Save (Title, Unit)");
    expect(saveLabel("Create", [" ", "Name"])).toBe("Create (Name)");
  });
  test("M02-20 disabled reason: saving beats missing, nothing missing means live", () => {
    expect(saveDisabledReason(["Title"], true)).toBe("Saving…");
    expect(saveDisabledReason(["Title"], false)).toBe("Still needed: Title");
    expect(saveDisabledReason([], false)).toBeUndefined();
  });
  test("M02-21 the offline marker is calm, with no error words", () => {
    expect(WORKING_LOCALLY_TEXT).toBe("Working on this laptop; will sync when connected");
    expect(WORKING_LOCALLY_TEXT.toLowerCase()).not.toMatch(/error|fail|offline|lost/);
  });
});

describe("M02 remembered choices never leak between people (shared laptop)", () => {
  const store = new Map<string, string>();
  (globalThis as { window?: unknown }).window = { localStorage: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) } };
  test("M02-22 keys differ by user and by project", () => {
    expect(lastChoiceKey("vendor", "p1", "u1")).not.toBe(lastChoiceKey("vendor", "p1", "u2"));
    expect(lastChoiceKey("vendor", "p1", "u1")).not.toBe(lastChoiceKey("vendor", "p2", "u1"));
  });
  test("M02-23 person A's last choice is not read back for person B", () => {
    setLastChoice("vendor", "p1", "acme", "userA");
    expect(getLastChoice("vendor", "p1", "userA")).toBe("acme");
    expect(getLastChoice("vendor", "p1", "userB")).toBeNull();
  });
  test("M02-24 an unknown user (null) writes nothing and reads nothing", () => {
    setLastChoice("vendor", "p9", "secret", null);
    expect(getLastChoice("vendor", "p9", null)).toBeNull();
    expect([...store.keys()].some((k) => k.endsWith("p9.vendor"))).toBe(false);
  });
  test("M02-25 blanking a choice clears it", () => {
    setLastChoice("vendor", "p1", "acme", "userC");
    setLastChoice("vendor", "p1", "", "userC");
    expect(getLastChoice("vendor", "p1", "userC")).toBeNull();
  });
  test("M02-26 blocked storage degrades to 'nothing remembered', never throws", () => {
    const saved = (globalThis as { window?: unknown }).window;
    (globalThis as { window?: unknown }).window = { localStorage: { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); }, removeItem: () => { throw new Error("blocked"); } } };
    expect(() => setLastChoice("v", "p", "x", "u")).not.toThrow();
    expect(getLastChoice("v", "p", "u")).toBeNull();
    (globalThis as { window?: unknown }).window = saved;
  });
});

describe("M02 screen messages (receipts survive the next page)", () => {
  test("M02-27 bad stored message text is rejected, not rendered", () => {
    expect(parseScreenMessage("not json")).toBeNull();
    expect(parseScreenMessage(JSON.stringify({ level: "weird", text: "x" }))).toBeNull();
    expect(parseScreenMessage(JSON.stringify({ level: "success", text: "Saved" }))).toEqual({ level: "success", text: "Saved" });
  });
  test("M02-28 a message is shown once, then gone", () => {
    const ss = new Map<string, string>();
    (globalThis as { window?: unknown; sessionStorage?: unknown }).sessionStorage = { getItem: (k: string) => ss.get(k) ?? null, setItem: (k: string, v: string) => void ss.set(k, v), removeItem: (k: string) => void ss.delete(k) };
    (globalThis as { window?: Record<string, unknown> }).window = { ...(globalThis as { window?: Record<string, unknown> }).window, sessionStorage: (globalThis as { sessionStorage?: unknown }).sessionStorage };
    setScreenMessage("k1", { level: "success", text: "Saved" });
    const first = takeScreenMessage("k1");
    const second = takeScreenMessage("k1");
    expect(first).toEqual({ level: "success", text: "Saved" });
    expect(second).toBeNull();
  });
});
