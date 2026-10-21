/// <reference types="bun-types" />
// OrgEnsure makes NO request of its own on a healthy session, and reacts only to the shell's "No organization".
import { GlobalRegistrator } from "@happy-dom/global-registrator";
if (typeof globalThis.document === "undefined") GlobalRegistrator.register();

import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { cleanup, render, waitFor, fireEvent } from "@testing-library/react";

let shellError: string | undefined;
let ensureCalls = 0;
let ensureResult: { status: string; error?: string } = { status: "provisioned" };
let reloads = 0;
let reported: string[] = [];

mock.module("next/navigation", () => ({ useRouter: () => ({ refresh: () => {}, push: () => {} }) }));
mock.module("@/lib/shell-store", () => ({
  useShell: () => ({ errors: shellError ? { shell: shellError } : {}, loaded: true }),
  loadShell: async () => { reloads++; },
  resetShellStore: () => {},
}));
mock.module("@/lib/org/browser-ensure", () => ({ browserEnsureDeps: () => ({}) }));
mock.module("@/lib/local-first/client-error-report", () => ({ reportClientError: (_k: string, e: Error) => { reported.push(e.message); } }));
mock.module("@/lib/org/ensure-org-client", () => ({
  ENSURE_FAILED_MESSAGE: "We couldn't set up your workspace just now. Please try again.",
  NO_ORGANIZATION_PATTERN: /no organi[sz]ation/i,
  ensureOrganization: async () => { ensureCalls++; return ensureResult; },
}));

const { OrgEnsure } = await import("./OrgEnsure");

beforeEach(() => { shellError = undefined; ensureCalls = 0; ensureResult = { status: "provisioned" }; reloads = 0; reported = []; });
afterEach(cleanup);

describe("OrgEnsure", () => {
  test("a healthy shell: no request, nothing rendered", async () => {
    const { container } = render(<OrgEnsure />);
    await new Promise((r) => setTimeout(r, 20));
    expect(ensureCalls).toBe(0);
    expect(container.textContent).toBe("");
  });

  test("the shell says 'No organization': set up once, then reload the shell", async () => {
    shellError = "No organization";
    const { container } = render(<OrgEnsure />);
    await waitFor(() => expect(reloads).toBe(1));
    expect(ensureCalls).toBe(1);
    expect(container.textContent).toBe("");
  });

  test("a failure shows one plain sentence and Try again, and is reported", async () => {
    shellError = "No organization";
    ensureResult = { status: "failed", error: "VERIDIAN down" };
    const { container } = render(<OrgEnsure />);
    await waitFor(() => expect(container.textContent).toContain("We couldn't set up your workspace just now."));
    expect(container.textContent).not.toContain("No organization");
    expect(reported).toEqual(["VERIDIAN down"]);
    ensureResult = { status: "provisioned" };
    fireEvent.click(container.querySelector("button")!);
    await waitFor(() => expect(ensureCalls).toBe(2));
    await waitFor(() => expect(container.textContent).toBe(""));
  });
});
