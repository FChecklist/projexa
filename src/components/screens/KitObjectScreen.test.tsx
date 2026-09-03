/// <reference types="bun-types" />
// Sibling test for the D-09 fork at src/components/screens/KitObjectScreen.tsx.
//
// WHAT THIS FILE IS FOR. The fork exists to add exactly two things to the kit's
// ObjectScreen, both required by R67 D-33, and both easy to lose the next time
// someone re-syncs this file against a kit release:
//
//   deleteLabel      The kit hard-codes "Delete" on the destructive footer
//                    action. On a worker that word is a lie -- the action sets
//                    isActive=false and keeps every attendance row and every
//                    cost -- so the screen must be able to call it "Deactivate".
//   secondaryAction  A display-mode action beside Edit, so "Reactivate" exists
//                    and deactivation is not one-way in the UI.
//
// It ALSO pins the name. This component sits at KitObjectScreen, not
// ObjectScreen, because lane D0 (merged) owns a completely different component
// at src/components/screens/ObjectScreen.tsx and decision D-11 §3 forbids two
// different components sharing one import path. If someone ever moves this back,
// the import in this file breaks and says so.
//
// Everything else here is the kit's behaviour, imported and unchanged; only the
// two additions and the mode switch are asserted.
import { GlobalRegistrator } from "@happy-dom/global-registrator";
if (typeof globalThis.document === "undefined") GlobalRegistrator.register();

import { afterEach, describe, expect, test } from "bun:test";
import { cleanup, fireEvent, render } from "@testing-library/react";

const { KitObjectScreen } = await import("./KitObjectScreen");

afterEach(() => cleanup());

type Overrides = Record<string, unknown>;

function renderScreen(overrides: Overrides = {}) {
  return render(
    <KitObjectScreen
      breadcrumb="Manpower / Roster / Ali Hassan"
      title="Ali Hassan"
      mode="display"
      hasDraft={false}
      messages={[]}
      onEdit={() => {}}
      onDelete={() => {}}
      {...overrides}
    >
      <p>details</p>
    </KitObjectScreen>
  );
}

describe("KitObjectScreen -- deleteLabel", () => {
  test("defaults to the kit's word, 'Delete'", () => {
    const { getByText } = renderScreen();
    expect(getByText("Delete")).toBeDefined();
  });

  test("a screen can name the destructive action for what it actually does", () => {
    const { getByText, queryByText } = renderScreen({ deleteLabel: "Deactivate" });
    expect(getByText("Deactivate")).toBeDefined();
    // ...and the misleading word is gone entirely, not merely hidden.
    expect(queryByText("Delete")).toBeNull();
  });

  test("the destructive action fires its handler, and does not when it carries a reason", () => {
    let fired = 0;
    const { getByText, rerender } = render(
      <KitObjectScreen breadcrumb="b" title="t" mode="display" hasDraft={false} messages={[]} deleteLabel="Deactivate" onDelete={() => { fired += 1; }}>
        <p>details</p>
      </KitObjectScreen>
    );
    fireEvent.click(getByText("Deactivate"));
    expect(fired).toBe(1);

    rerender(
      <KitObjectScreen breadcrumb="b" title="t" mode="display" hasDraft={false} messages={[]} deleteLabel="Deactivate" deleteDisabledReason="Already inactive" onDelete={() => { fired += 1; }}>
        <p>details</p>
      </KitObjectScreen>
    );
    fireEvent.click(getByText("Deactivate"));
    expect(fired).toBe(1);
    expect((getByText("Deactivate") as HTMLButtonElement).title).toBe("Already inactive");
  });

  test("no onDelete means no destructive action at all", () => {
    const { queryByText } = renderScreen({ onDelete: undefined });
    expect(queryByText("Delete")).toBeNull();
  });
});

describe("KitObjectScreen -- secondaryAction", () => {
  test("renders beside Edit in display mode and calls back when clicked", () => {
    let reactivated = 0;
    const { getByText } = renderScreen({
      secondaryAction: { label: "Reactivate", onClick: () => { reactivated += 1; } },
    });
    expect(getByText("Edit")).toBeDefined();
    fireEvent.click(getByText("Reactivate"));
    expect(reactivated).toBe(1);
  });

  test("a disabled secondary action names its reason in the label, in the product's 'Label (reason)' form", () => {
    let reactivated = 0;
    const { getByText } = renderScreen({
      secondaryAction: { label: "Reactivate", disabledReason: "Needs PM role", onClick: () => { reactivated += 1; } },
    });
    const button = getByText("Reactivate (Needs PM role)") as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    fireEvent.click(button);
    expect(reactivated).toBe(0);
  });

  test("it is a DISPLAY-mode action -- editing shows Save and Cancel instead", () => {
    const { queryByText, getByText } = renderScreen({
      mode: "edit",
      secondaryAction: { label: "Reactivate", onClick: () => {} },
    });
    expect(queryByText("Reactivate")).toBeNull();
    expect(queryByText("Edit")).toBeNull();
    expect(getByText("Save")).toBeDefined();
    expect(getByText("Cancel")).toBeDefined();
  });

  test("omitting it renders nothing extra", () => {
    const { queryByText } = renderScreen();
    expect(queryByText("Reactivate")).toBeNull();
  });
});

describe("KitObjectScreen -- the kit behaviour the fork must not have broken", () => {
  test("the Save label carries the disabled reason in brackets, as every R67 create form relies on", () => {
    const { getByText } = renderScreen({ mode: "create", saveDisabled: true, saveDisabledReason: "2 required fields" });
    expect((getByText("Save (2 required fields)") as HTMLButtonElement).disabled).toBe(true);
  });

  test("title, facets and children all render", () => {
    const { getByText } = renderScreen({
      facets: [{ label: "Trade", value: "Mason" }, { label: "Daily Rate", value: "AED 300.00" }],
    });
    expect(getByText("Ali Hassan")).toBeDefined();
    expect(getByText("Mason")).toBeDefined();
    expect(getByText("AED 300.00")).toBeDefined();
    expect(getByText("details")).toBeDefined();
  });
});
