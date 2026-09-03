/// <reference types="bun-types" />
// R67 F-34 (R-290). The acceptance is a Playwright screenshot at 300 ms of a
// navigation into /moms/<id> with the record delayed: the DOM must carry the
// breadcrumb text and an aria-busy element, and the literal "Loading…" must not
// stand alone. Every one of those is a property of this component, so it is
// asserted here, where it can be run without a server -- the Playwright run is
// then a check that the component is actually mounted on those routes, not the
// only place the rule exists.
//
// Queries come from the render RESULT, never from `screen`: the happy-dom
// global is registered at module scope and @testing-library's `screen` binds to
// document.body at ITS import time, which is earlier. (Same note as
// ListScreenFrame.test.tsx.)
import { GlobalRegistrator } from "@happy-dom/global-registrator";
GlobalRegistrator.register();

import { afterEach, describe, expect, test } from "bun:test";
import { cleanup, render, waitFor } from "@testing-library/react";
import { KitObjectScreen, OBJECT_LOADING_REASON } from "./KitObjectScreen";
import { MOM_OBJECT_BREADCRUMB, OBJECT_BREADCRUMBS } from "@/lib/object-breadcrumbs";

afterEach(cleanup);

describe("KitObjectScreen loading variant", () => {
  test("the breadcrumb is real text while the record is still in flight", () => {
    const { getByText } = render(
      <KitObjectScreen loading breadcrumb={MOM_OBJECT_BREADCRUMB.breadcrumb} label={MOM_OBJECT_BREADCRUMB.label} />
    );
    // The exact literal the acceptance screenshots for.
    expect(getByText(/Minutes of Meeting/)).toBeDefined();
  });

  test("the waiting region is marked busy and states its loading data-state", () => {
    const { container } = render(<KitObjectScreen loading breadcrumb="Permits / Permit" />);
    const region = container.querySelector("[data-testid='object-screen-loading']")!;
    expect(region.getAttribute("aria-busy")).toBe("true");
    expect(region.getAttribute("data-state")).toBe("loading");
  });

  test("the title is a bar, not the word 'Loading…' -- and that word never stands alone", () => {
    const { container, queryByText } = render(
      <KitObjectScreen loading breadcrumb={MOM_OBJECT_BREADCRUMB.breadcrumb} label={MOM_OBJECT_BREADCRUMB.label} />
    );
    expect(container.querySelector("[data-testid='object-screen-title-skeleton']")).not.toBeNull();
    // "Loading…" appears ONLY as the reason beside a disabled action, never as
    // the whole answer: there is a breadcrumb and a title bar beside it.
    const loadingText = queryByText(OBJECT_LOADING_REASON);
    expect(loadingText).not.toBeNull();
    expect(container.textContent).toContain("Minutes of Meeting");
  });

  test("the action bar is present and disabled with its reason, not absent", () => {
    const { getByRole } = render(
      <KitObjectScreen loading breadcrumb="Permits / Permit" actions={["Edit"]} />
    );
    const edit = getByRole("button", { name: "Edit" }) as HTMLButtonElement;
    expect(edit.disabled).toBe(true);
    expect(edit.getAttribute("title")).toBe(OBJECT_LOADING_REASON);
  });

  test("each screen outlines the actions it really has -- a BOQ revision is never offered Edit", () => {
    const { queryByRole, getByRole } = render(
      <KitObjectScreen
        loading
        breadcrumb={OBJECT_BREADCRUMBS.scope.breadcrumb}
        actions={OBJECT_BREADCRUMBS.scope.actions}
      />
    );
    expect(queryByRole("button", { name: "Edit" })).toBeNull();
    expect(getByRole("button", { name: "Create Revision" })).toBeDefined();
  });

  test("after three seconds it says what it is waiting for, in the user's own noun", async () => {
    const { findByText } = render(
      <KitObjectScreen loading breadcrumb={MOM_OBJECT_BREADCRUMB.breadcrumb} label={MOM_OBJECT_BREADCRUMB.label} />
    );
    // Real elapsed time, not fake timers: the assertion is that a user staring
    // at the screen is told something, not that the component reads a constant.
    const words = await findByText(/Still loading the meeting/, {}, { timeout: 6000 });
    expect(words.textContent).toMatch(/Still loading the meeting…\s*\d+\s*s/);
  }, 10000);

  test("nothing is said for the first three seconds -- an ordinary wait is not narrated", () => {
    const { queryByText } = render(
      <KitObjectScreen loading breadcrumb={MOM_OBJECT_BREADCRUMB.breadcrumb} label={MOM_OBJECT_BREADCRUMB.label} />
    );
    expect(queryByText(/Still loading/)).toBeNull();
  });

  test("a screen with no noun for what it is waiting on simply shows the frame", () => {
    const { container } = render(<KitObjectScreen loading breadcrumb="Schedule / Task" />);
    expect(container.textContent).toContain("Schedule / Task");
    expect(container.textContent).not.toContain("Still loading");
  });
});

describe("KitObjectScreen loaded variant -- unchanged from the kit's", () => {
  test("renders the title, the breadcrumb, the children and a ready data-state", () => {
    const { container, getByText } = render(
      <KitObjectScreen
        breadcrumb={MOM_OBJECT_BREADCRUMB.breadcrumb}
        title="Site walkthrough 12 Aug"
        mode="display"
        hasDraft={false}
        messages={[]}
      >
        <p>the record</p>
      </KitObjectScreen>
    );
    expect(getByText("Site walkthrough 12 Aug")).toBeDefined();
    expect(getByText("the record")).toBeDefined();
    expect(container.querySelector("[data-state='ready']")).not.toBeNull();
    expect(container.querySelector("[data-testid='object-screen-loading']")).toBeNull();
  });

  test("Edit is live once the record is there, and Save carries its disabled reason in edit mode", () => {
    const display = render(
      <KitObjectScreen breadcrumb="Permits / Permit" title="Fire NOC" mode="display" hasDraft={false} messages={[]} onEdit={() => {}}>
        <p>fields</p>
      </KitObjectScreen>
    );
    const edit = display.getByRole("button", { name: "Edit" }) as HTMLButtonElement;
    expect(edit.disabled).toBe(false);
    cleanup();

    const editing = render(
      <KitObjectScreen
        breadcrumb="Permits / Permit" title="Fire NOC" mode="edit" hasDraft={false} messages={[]}
        saveDisabled saveDisabledReason="2 required fields"
      >
        <p>fields</p>
      </KitObjectScreen>
    );
    expect(editing.getByRole("button", { name: "Save (2 required fields)" })).toBeDefined();
  });

  test("the breadcrumb is the SAME string loading and loaded, so it cannot rewrite itself on arrival", async () => {
    const loading = render(<KitObjectScreen loading breadcrumb={MOM_OBJECT_BREADCRUMB.breadcrumb} />);
    const whileLoading = loading.container.textContent ?? "";
    cleanup();
    const loaded = render(
      <KitObjectScreen breadcrumb={MOM_OBJECT_BREADCRUMB.breadcrumb} title="Kickoff" mode="display" hasDraft={false} messages={[]}>
        <p>fields</p>
      </KitObjectScreen>
    );
    expect(whileLoading).toContain(MOM_OBJECT_BREADCRUMB.breadcrumb);
    expect(loaded.container.textContent).toContain(MOM_OBJECT_BREADCRUMB.breadcrumb);
    await waitFor(() => expect(true).toBe(true));
  });
});
