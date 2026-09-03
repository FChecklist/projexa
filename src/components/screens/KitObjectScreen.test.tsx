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
import { KitObjectScreen, OBJECT_LOADING_REASON, type KitObjectScreenLoadedProps } from "./KitObjectScreen";
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

// ─── R67 D-11 (lane D1, folded in here under D-11's addendum) ────────────────
//
// These arrived on lane D1 against its own fork of this component at
// src/components/screens/ObjectScreen.tsx. That path is lane D0's display-first
// archetype and is canonical, so per D-11's addendum the fork does not survive
// at it -- D1's two distinct capabilities (deleteLabel, and a ReactNode facet
// value) were folded into THIS component, and its assertions come with them
// rather than being dropped.
//
// The capability: the destructive control's word is a prop, defaulting to the
// kit's "Delete", so a screen with two genuinely different destructive acts
// (Remove inside the 24-hour grace window, Dispose under the retention policy)
// can name the one it is offering.
describe("KitObjectScreen -- the destructive control names its own act (D-11)", () => {
  function renderScreen(props: Partial<KitObjectScreenLoadedProps> = {}) {
    return render(
      <KitObjectScreen breadcrumb="Drawings & 3D / Drawing" title="AR-101 Rev B" mode="display" hasDraft={false} messages={[]} {...props}>
        <p>body</p>
      </KitObjectScreen>
    );
  }

  test("keeps the kit's word when no label is given", () => {
    const view = renderScreen({ onDelete: () => {} });
    expect(view.getByRole("button", { name: "Delete" })).toBeTruthy();
  });

  test("uses the screen's own verb when one is given", () => {
    const view = renderScreen({ onDelete: () => {}, deleteLabel: "Remove" });
    expect(view.getByRole("button", { name: "Remove" })).toBeTruthy();
    expect(view.queryByRole("button", { name: "Delete" })).toBeNull();
  });

  // R67 merge (D-11, D1 x D21, 2026-09-03): RESTATED, and the fact it pins down
  // got stronger. D1 asserted the reason was carried in the button's `title`
  // only, so the accessible name was exactly "Dispose". D-21 additionally
  // renders the reason as VISIBLE text beside the verb -- a title-only tooltip
  // is invisible to touch and to most screen readers -- which makes it part of
  // the accessible name. Both halves are now asserted: the verb still leads, the
  // reason is still on the control, and it is now readable without a hover.
  test("a reason disables the control and is carried on it, whatever it is called", () => {
    const reason = "Kept under the retention policy - ask an admin to dispose";
    const view = renderScreen({
      onDelete: () => {},
      deleteLabel: "Dispose",
      deleteDisabledReason: reason,
    });
    const button = view.getByRole("button", { name: /^Dispose/ }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(button.title).toBe(reason);
    expect(button.textContent).toContain("Dispose");
    expect(button.textContent).toContain(reason);
  });

  test("no destructive control at all when the screen offers none", () => {
    const view = renderScreen();
    expect(view.queryByRole("button", { name: "Delete" })).toBeNull();
    expect(view.queryByRole("button", { name: "Remove" })).toBeNull();
  });

  test("edit mode still shows Save and Cancel, carried over from the kit unchanged", () => {
    const view = renderScreen({ mode: "edit", onSave: () => {}, onCancel: () => {}, saveDisabled: true, saveDisabledReason: "Name is required" });
    expect(view.getByRole("button", { name: "Save (Name is required)" })).toBeTruthy();
    expect(view.getByRole("button", { name: "Cancel" })).toBeTruthy();
  });

  // R67 D-12: a facet value is a ReactNode, so "Supersedes" can LINK to the
  // revision it replaced instead of only naming it.
  test("a facet value may be a node, not just a string", () => {
    const view = renderScreen({
      facets: [{ label: "Supersedes", value: <a href="/drawings/prev">AR-101 Rev A</a> }],
    });
    const link = view.getByRole("link", { name: "AR-101 Rev A" }) as HTMLAnchorElement;
    expect(link.getAttribute("href")).toBe("/drawings/prev");
  });
});
