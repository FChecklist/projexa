/// <reference types="bun-types" />
// R67 D-01 -- "+ Create Project" is a ROUTE, not a dialog.
//
// src/lib/project-form.test.ts asserts the required-field rule as a pure
// function. What only a render can show is that this screen is the thing
// correction C-01 asked for rather than the old dialog moved behind a URL:
// a create screen in the same ObjectScreen archetype as /labour/new, with the
// breadcrumb, the Back control and a Save that NAMES what is missing.
//
// WHAT THIS FILE CANNOT DRIVE. Typing does not reach a React-controlled input
// in this environment (documented at length in MaterialCreateClient.test.tsx
// and CreateScreen.test.tsx), and Radix's Select does not open under
// happy-dom's synthetic pointer events. So the behaviour that depends on
// typed state is asserted where it is reachable -- the missing-field list and
// the disabled reason in project-form.test.ts -- and what is asserted HERE is
// what this screen decides for itself: its archetype, and the three different
// things it says about the product list depending on how that read went.
import { GlobalRegistrator } from "@happy-dom/global-registrator";
if (typeof globalThis.document === "undefined") GlobalRegistrator.register();

import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { cleanup, render } from "@testing-library/react";

mock.module("next/navigation", () => ({
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {}, back: () => {} }),
  usePathname: () => "/projects/new",
}));

mock.module("sonner", () => ({ toast: { success: () => {}, error: () => {} } }));

const ProjectCreateClient = (await import("./ProjectCreateClient")).default;

afterEach(cleanup);

describe("ProjectCreateClient", () => {
  test("it is a create SCREEN -- breadcrumb, title, and no dialog anywhere", () => {
    const { container } = render(<ProjectCreateClient />);

    expect(container.textContent).toContain("Dashboard / New Project");
    expect(container.textContent).toContain("New Project");
    // The whole point of D-01: the one popup left in PROJEXA became a route.
    expect(container.querySelector('[role="dialog"]')).toBeNull();
  });

  test("Save is live with every field empty: nothing is required, the name is optional", () => {
    const { container } = render(<ProjectCreateClient />);

    const save = Array.from(container.querySelectorAll("button")).find((b) =>
      (b.textContent ?? "").startsWith("Save")
    );
    expect(save).toBeDefined();
    expect(save?.disabled).toBe(false);
    expect(save?.textContent).not.toContain("Project Name");
  });

  test("there is no Product field -- only the project name is asked for", () => {
    const { container } = render(<ProjectCreateClient />);

    expect(container.textContent).not.toContain("Product");
    expect(container.textContent).not.toContain("Couldn't load products:");
    expect(container.querySelector("#productId")).toBeNull();
    expect(container.textContent).toContain("Project Name");
  });

  test("the optional fields are marked optional, so the required set is unambiguous", () => {
    const { container } = render(<ProjectCreateClient />);
    expect(container.textContent).toContain("Description (optional)");
    expect(container.textContent).toContain("Start Date (optional)");
    expect(container.textContent).toContain("Target Date (optional)");
  });
});

// ─── R67 D-01 / D-69 (lane D1, folded into this canonical suite) ─────────────
//
// Lane D1 wrote its own suite against its own version of this component. That
// version is gone (main's server-fed one is canonical under D-11), so these are
// restated against the merged component rather than dropped.
//
// ONE assertion of lane D1's is deliberately NOT restated here: its
// `missingProjectFields("", "")` block. That function moved to
// src/lib/project-form.ts and takes an object now, and src/lib/project-form.
// test.ts already asserts the identical rule on the merged signature (empty
// form names both fields in form order, whitespace is not a value, a chosen
// product drops only that field, a complete form is saveable). Restating it
// here would be a second copy of one rule, not extra coverage.
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fieldForProjectError } from "./ProjectCreateClient";

describe("fieldForProjectError -- a refusal lands next to the field it is about", () => {
  test("attributes the backend's own words to the field it names", () => {
    expect(fieldForProjectError("Couldn't create project: name is required")).toBe("name");
    expect(fieldForProjectError("Couldn't create project: target date must be after start date")).toBe("targetDate");
    expect(fieldForProjectError("Couldn't create project: start date is invalid")).toBe("startDate");
  });

  test("names no field when the message names none, so the message stays in the screen's own strip", () => {
    expect(fieldForProjectError("Couldn't create project: Request failed (HTTP 502)")).toBeUndefined();
  });
});

// D-01 replaced CreateProjectDialog with this route and deleted the dialog;
// D-69's acceptance is that nothing on /dashboard, /projects or /projects/new
// puts one back. The rendered assertions for the other two screens live in
// DashboardHomeView.test.tsx and ProjectsListClient.test.tsx; this is the third,
// plus a source guard so a future edit cannot reintroduce the component the
// programme's one dialog exception (correction C-01) was closed by removing.
describe("R67 D-69: the project flow has no dialogs", () => {
  test("CreateProjectDialog.tsx is gone, and none of the three screens imports a Dialog", () => {
    const dir = path.join(import.meta.dir);
    expect(existsSync(path.join(dir, "CreateProjectDialog.tsx"))).toBe(false);
    for (const file of ["ProjectCreateClient.tsx", "ProjectsListClient.tsx", "DashboardHomeView.tsx"]) {
      const source = readFileSync(path.join(dir, file), "utf8");
      expect(source).not.toMatch(/from ["']@\/components\/ui\/dialog["']/);
      expect(source).not.toMatch(/role=["']dialog["']/);
    }
  });
});

// ─── GUIDED ERROR RECOVERY (reference screen) ───────────────────────────────────────────────
// What was typed survives leaving and coming back; a refusal becomes the guided panel (inline, role=alert, no dialog) with the field-level message
// beside the field it is about; the first bad field is focused and outlined; bad dates are caught before anything is sent.
import { fireEvent, waitFor } from "@testing-library/react";
import { projectDateProblem } from "./ProjectCreateClient";

describe("ProjectCreateClient: guided error recovery", () => {
  const realFetch = globalThis.fetch;
  beforeEach(() => (window as unknown as { happyDOM: { setURL(u: string): void } }).happyDOM.setURL("http://localhost:3000/projects/new"));
  afterEach(() => {
    globalThis.fetch = realFetch;
    sessionStorage.clear();
  });

  function saveButton(container: HTMLElement) {
    return Array.from(container.querySelectorAll("button")).find((b) => (b.textContent ?? "").startsWith("Save")) as HTMLButtonElement;
  }

  test("values typed earlier come back on a fresh mount (leaving through a fix link and returning), with a plain way to start fresh", async () => {
    sessionStorage.setItem("px-draft:project-new", JSON.stringify({ savedAt: Date.now(), value: { name: "Lakeview", description: "phase 2", startDate: "2026-11-01", targetDate: "2027-01-01" } }));
    const { container, getByTestId } = render(<ProjectCreateClient />);
    await waitFor(() => expect((container.querySelector("#name") as HTMLInputElement).value).toBe("Lakeview"));
    expect((container.querySelector("#description") as HTMLTextAreaElement).value).toBe("phase 2");
    expect((container.querySelector("#startDate") as HTMLInputElement).value).toBe("2026-11-01");
    expect((container.querySelector("#targetDate") as HTMLInputElement).value).toBe("2027-01-01");
    fireEvent.click(getByTestId("draft-restored").querySelector("button")!);
    await waitFor(() => expect((container.querySelector("#name") as HTMLInputElement).value).toBe(""));
    expect(sessionStorage.getItem("px-draft:project-new")).toBeNull();
  });

  test("dates that run backwards are caught before anything is sent: field message, panel, focus, values kept", async () => {
    let calls = 0;
    globalThis.fetch = (async () => {
      calls += 1;
      return new Response("{}", { status: 201 });
    }) as typeof fetch;
    sessionStorage.setItem("px-draft:project-new", JSON.stringify({ savedAt: Date.now(), value: { name: "A", description: "", startDate: "2026-12-01", targetDate: "2026-11-01" } }));
    const { container, findByTestId } = render(<ProjectCreateClient />);
    await waitFor(() => expect((container.querySelector("#targetDate") as HTMLInputElement).value).toBe("2026-11-01"));
    fireEvent.click(saveButton(container));
    const panel = await findByTestId("guided-error");
    expect(panel.getAttribute("data-guide-id")).toBe("project-date-order-form");
    expect(panel.textContent).toContain("The target date must be on or after the start date");
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    expect(calls).toBe(0);
    const target = container.querySelector("#targetDate") as HTMLInputElement;
    expect(target.getAttribute("aria-invalid")).toBe("true");
    expect(target.getAttribute("data-px-highlighted")).toBe("true");
    expect(container.textContent).toContain("Pick a later target date");
    expect((container.querySelector("#startDate") as HTMLInputElement).value).toBe("2026-12-01");
  });

  test("a server refusal becomes the guided panel; the field it names is marked; nothing typed is lost", async () => {
    globalThis.fetch = (async () => new Response(JSON.stringify({ error: "name is already used by another project" }), { status: 400, headers: { "content-type": "application/json" } })) as typeof fetch;
    sessionStorage.setItem("px-draft:project-new", JSON.stringify({ savedAt: Date.now(), value: { name: "Lakeview", description: "", startDate: "", targetDate: "" } }));
    const { container, findByTestId } = render(<ProjectCreateClient />);
    await waitFor(() => expect((container.querySelector("#name") as HTMLInputElement).value).toBe("Lakeview"));
    fireEvent.click(saveButton(container));
    const panel = await findByTestId("guided-error");
    expect(panel.getAttribute("data-guide-id")).toBe("validation-generic");
    expect(panel.textContent).toContain("name is already used by another project");
    expect(container.querySelector("#name")?.getAttribute("aria-invalid")).toBe("true");
    expect((container.querySelector("#name") as HTMLInputElement).value).toBe("Lakeview");
    expect(sessionStorage.getItem("px-draft:project-new")).not.toBeNull(); // kept until a save succeeds
  });

  test("a signed-out save shows the sign-in guide; a timed-out save says it may have been saved", async () => {
    globalThis.fetch = (async () => new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { "content-type": "application/json" } })) as typeof fetch;
    const a = render(<ProjectCreateClient />);
    fireEvent.click(saveButton(a.container));
    expect((await a.findByTestId("guided-error")).getAttribute("data-guide-id")).toBe("auth-expired");
    expect(a.getByTestId("guided-error-fix").getAttribute("href")).toContain("/login?redirectTo=%2Fprojects%2Fnew");
    a.unmount();

    globalThis.fetch = (async () => {
      throw Object.assign(new Error("timed out"), { name: "TimeoutError" });
    }) as typeof fetch;
    const b = render(<ProjectCreateClient />);
    fireEvent.click(saveButton(b.container));
    const panel = await b.findByTestId("guided-error");
    expect(panel.getAttribute("data-guide-id")).toBe("timeout-write");
    expect(b.getByTestId("guided-error-what").textContent?.toLowerCase()).toContain("may have been saved");
    expect(b.getByTestId("guided-error-fix").getAttribute("href")!.startsWith("/projects")).toBe(true);
  });

  test("projectDateProblem: only backwards dates are a problem", () => {
    expect(projectDateProblem("2026-11-01", "2026-10-01")?.field).toBe("targetDate");
    expect(projectDateProblem("2026-11-01", "2026-11-01")).toBeNull();
    expect(projectDateProblem("", "2026-10-01")).toBeNull();
    expect(projectDateProblem("2026-11-01", "")).toBeNull();
  });
});
