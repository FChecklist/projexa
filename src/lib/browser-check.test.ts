/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test";
import { diagnoseBrowser, indexedDbFailure, type BrowserLike } from "./browser-check";
import { inviteFailureCode } from "./org/invite-failure";
import { alternativeFor } from "./copilot-alternatives";
import { suspectedEmailTypo } from "./auth/email-code-login";

const good = (): BrowserLike => ({ navigator: { cookieEnabled: true }, localStorage: { setItem() {}, removeItem() {} }, indexedDB: {}, fetch: () => {}, Promise, URLSearchParams });

describe("browser check", () => {
  test("a healthy browser reports nothing", () => expect(diagnoseBrowser(good())).toEqual([]));
  test("cookies off", () => expect(diagnoseBrowser({ ...good(), navigator: { cookieEnabled: false } }).map((p) => p.code)).toEqual(["BROWSER_COOKIES_BLOCKED"]));
  test("site data blocked (the property access itself throws, as in a locked-down browser)", () => {
    const w = { ...good() };
    Object.defineProperty(w, "localStorage", { get() { throw new DOMException("denied", "SecurityError"); } });
    expect(diagnoseBrowser(w).map((p) => p.code)).toEqual(["BROWSER_STORAGE_BLOCKED"]);
  });
  test("store full", () => {
    const full = { setItem() { const e = new Error("full"); e.name = "QuotaExceededError"; throw e; }, removeItem() {} };
    expect(diagnoseBrowser({ ...good(), localStorage: full }).map((p) => p.code)).toEqual(["STORAGE_FULL"]);
  });
  test("no local database, too old", () => {
    expect(diagnoseBrowser({ ...good(), indexedDB: undefined }).map((p) => p.code)).toEqual(["BROWSER_NO_INDEXEDDB"]);
    const old = { ...good(), fetch: undefined };
    expect(diagnoseBrowser(old)[0]).toEqual({ code: "BROWSER_TOO_OLD", detail: "fetch" });
  });
  test("an IndexedDB open error becomes the right guide code", () => {
    expect(indexedDbFailure(Object.assign(new Error("x"), { name: "QuotaExceededError" })).code).toBe("STORAGE_FULL");
    expect(indexedDbFailure(Object.assign(new Error("mutation not allowed"), { name: "InvalidStateError" })).code).toBe("INDEXEDDB_BLOCKED");
  });
});

describe("invitation failures", () => {
  test("each way an invitation fails has its own code", () => {
    expect(inviteFailureCode({ offline: true })).toBe("INVITE_OFFLINE");
    expect(inviteFailureCode({ status: 401, message: "You must be signed in to accept an invitation." })).toBe("INVITE_SIGNED_OUT");
    expect(inviteFailureCode({ status: 404, message: "This invitation link is not valid." })).toBe("INVITE_NOT_VALID");
    expect(inviteFailureCode({ status: 400, message: "Invitation has expired" })).toBe("INVITE_CLOSED");
    expect(inviteFailureCode({ status: 400, message: "Invitation already used" })).toBe("INVITE_CLOSED");
    expect(inviteFailureCode({ status: 400, message: "This invitation was sent to a different email address" })).toBe("INVITE_WRONG_EMAIL");
    expect(inviteFailureCode({ status: 500, message: "boom" })).toBe("INVITE_FAILED");
  });
});

describe("mistyped e-mail and AI alternatives", () => {
  test("common domain typos are spotted, correct and company addresses are not", () => {
    expect(suspectedEmailTypo("pat@gmial.com")).toEqual({ typed: "gmial.com", meant: "gmail.com" });
    expect(suspectedEmailTypo("pat@gmail.com")).toBeNull();
    expect(suspectedEmailTypo("pat@meridian-build.com")).toBeNull();
    expect(suspectedEmailTypo("nonsense")).toBeNull();
  });
  test("each AI button names the ordinary screen with the same facts", () => {
    expect(alternativeFor("get_construction_budget_status", "p1").href).toBe("/budgets?projectId=p1");
    expect(alternativeFor("unknown_thing").href).toBe("/reports");
  });
});
