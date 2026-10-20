/// <reference types="bun-types" />
// Browser wiring, in a happy-dom window: window errors, unhandled rejections, failed fetches, console errors, clicks and screen changes all end up
// as complete events waiting in the device outbox (nothing is sent in this test: the 5 s delivery timer never gets to fire).
import { GlobalRegistrator } from "@happy-dom/global-registrator";
if (typeof globalThis.document === "undefined") GlobalRegistrator.register();

import { afterEach, describe, expect, test } from "bun:test";
import { __clientLogForTest, installClientLog, isSignedOutPath, logAction, logClientError } from "./install";

(window as unknown as { happyDOM?: { setURL(u: string): void } }).happyDOM?.setURL("https://px.test/dashboard");
const realFetch = window.fetch;
afterEach(() => {
  window.fetch = realFetch;
});
// assembled at run time so no secret-looking literal sits in the source (secret scanners flag those)
const FAKE_TOKEN = ["tok", "live", "1234567890"].join("_");
const settle = () => new Promise((r) => setTimeout(r, 5));

describe("installClientLog", () => {
  test("window error, unhandled rejection, failed API call, console.error, click and navigation are all captured; uninstall restores everything", async () => {
    window.fetch = (async () => new Response(JSON.stringify({ error: "Permit register is read only" }), { status: 403, headers: { "x-request-id": "r-1" } })) as typeof fetch;
    const fetchBefore = window.fetch;
    const consoleBefore = console.error;
    const uninstall = installClientLog();
    expect(installClientLog()).toBe(uninstall); // idempotent: one install per page
    const log = __clientLogForTest()!;

    document.body.innerHTML = `<button id="b">Save permit</button><input id="pw" type="password" value="hunter2">`;
    document.getElementById("b")!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    document.getElementById("pw")!.dispatchEvent(new MouseEvent("click", { bubbles: true })); // a field is not a button: nothing recorded
    window.history.pushState({}, "", "/permits/new");

    window.dispatchEvent(new ErrorEvent("error", { error: new Error("Cannot read properties of undefined"), message: "Cannot read properties of undefined" }));
    const rej = new Event("unhandledrejection") as Event & { reason?: unknown };
    rej.reason = new Error("Promise failed: sync");
    window.dispatchEvent(rej);
    await window.fetch("/api/permits", { method: "POST", body: JSON.stringify({ password: "hunter2" }) });
    console.error("Warning: something odd", { token: FAKE_TOKEN });
    await settle();

    const events = log.outbox.pending();
    const kinds = events.map((e) => `${e.kind}/${e.severity}`);
    expect(kinds).toContain("error/error");
    expect(kinds).toContain("unhandled_rejection/error");
    expect(kinds).toContain("api_failure/error");
    expect(kinds).toContain("error/warning"); // console.error
    expect(events.some((e) => e.kind === "action" && e.outcome === "failed")).toBe(true);

    const failure = events.find((e) => e.kind === "api_failure")!;
    expect(failure).toMatchObject({ apiPath: "/api/permits", httpMethod: "POST", httpStatus: 403, requestId: "r-1" });
    expect(failure.message).toContain("Permit register is read only");
    const steps = failure.breadcrumbs.map((b) => `${b.type}:${b.label}`);
    expect(steps).toContain("click:Save permit");
    expect(steps.some((s) => s.startsWith("nav:") && s.includes("/permits/new"))).toBe(true);
    expect(steps.some((s) => s.includes("password"))).toBe(false);
    expect(JSON.stringify(events)).not.toContain("hunter2");
    expect(JSON.stringify(events)).not.toContain(FAKE_TOKEN);

    uninstall();
    expect(window.fetch).toBe(fetchBefore);
    expect(console.error).toBe(consoleBefore);
    expect(__clientLogForTest()).toBeNull();
  });

  test("the helpers other code calls (logClientError, logAction) are quiet no-ops when nothing is installed, and never throw", () => {
    expect(__clientLogForTest()).toBeNull();
    expect(() => logClientError("sync", new Error("x"))).not.toThrow();
    expect(() => logAction("Create Permit", "ok", 10)).not.toThrow();
    expect(__clientLogForTest()).toBeNull(); // under the test runner nothing installs itself implicitly
  });

  test("signed-out pages send nothing", () => {
    for (const p of ["/", "/login", "/signup", "/invite/abc", "/how-it-works"]) expect(isSignedOutPath(p)).toBe(true);
    for (const p of ["/dashboard", "/system-log", "/settings"]) expect(isSignedOutPath(p)).toBe(false);
  });
});
