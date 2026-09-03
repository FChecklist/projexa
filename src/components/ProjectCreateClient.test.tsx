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

import { afterEach, describe, expect, mock, test } from "bun:test";
import { cleanup, render } from "@testing-library/react";

mock.module("next/navigation", () => ({
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {}, back: () => {} }),
  usePathname: () => "/projects/new",
}));

mock.module("sonner", () => ({ toast: { success: () => {}, error: () => {} } }));

const ProjectCreateClient = (await import("./ProjectCreateClient")).default;

afterEach(cleanup);

const PRODUCTS = [
  { id: "prod-construction", name: "Construction" },
  { id: "prod-fitout", name: "Fit-out" },
];

describe("ProjectCreateClient", () => {
  test("it is a create SCREEN -- breadcrumb, title, and no dialog anywhere", () => {
    const { container } = render(<ProjectCreateClient products={PRODUCTS} productsError={null} />);

    expect(container.textContent).toContain("Dashboard / New Project");
    expect(container.textContent).toContain("New Project");
    // The whole point of D-01: the one popup left in PROJEXA became a route.
    expect(container.querySelector('[role="dialog"]')).toBeNull();
  });

  test("Save is disabled and NAMES the fields still missing, rather than sitting inert", () => {
    const { container } = render(<ProjectCreateClient products={PRODUCTS} productsError={null} />);

    const save = Array.from(container.querySelectorAll("button")).find((b) =>
      (b.textContent ?? "").startsWith("Save")
    );
    expect(save).toBeDefined();
    expect(save?.disabled).toBe(true);
    // Not "2 required fields" and not a title attribute nobody hovers: the
    // user's own words for the fields, on the button.
    expect(save?.textContent).toContain("Product");
    expect(save?.textContent).toContain("Project Name");
  });

  test("a FAILED product read says so in the backend's own words", () => {
    const { container } = render(
      <ProjectCreateClient products={[]} productsError="The construction data service did not respond in time." />
    );

    expect(container.textContent).toContain("Couldn't load products:");
    expect(container.textContent).toContain("The construction data service did not respond in time.");
    // The load-bearing half: a failed read must never be presented as "this
    // organisation has no products".
    expect(container.textContent).not.toContain("No products are set up for this organisation yet.");
  });

  test("a SUCCESSFUL but empty read says something completely different, and says what to do", () => {
    const { container } = render(<ProjectCreateClient products={[]} productsError={null} />);

    expect(container.textContent).toContain("No products are set up for this organisation yet.");
    expect(container.textContent).toContain("An administrator must add a product");
    expect(container.textContent).not.toContain("Couldn't load products:");
  });

  test("with products, the picker is offered and neither notice is shown", () => {
    const { container } = render(<ProjectCreateClient products={PRODUCTS} productsError={null} />);

    expect(container.textContent).toContain("Select a product");
    expect(container.textContent).not.toContain("Couldn't load products:");
    expect(container.textContent).not.toContain("No products are set up");
  });

  test("the optional fields are marked optional, so the required set is unambiguous", () => {
    const { container } = render(<ProjectCreateClient products={PRODUCTS} productsError={null} />);
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
    expect(fieldForProjectError("Couldn't create project: productId is required")).toBe("productId");
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
