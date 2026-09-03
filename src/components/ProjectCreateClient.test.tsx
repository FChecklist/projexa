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
