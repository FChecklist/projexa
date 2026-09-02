/// <reference types="bun-types" />
// R67 D-11. The fork's one behavioural difference, held to: the destructive
// control's word is a prop, defaulting to the kit's "Delete", so a screen with
// two genuinely different destructive acts (Remove inside the grace window,
// Dispose under the retention policy) can name the one it is offering.
import { GlobalRegistrator } from "@happy-dom/global-registrator";
if (typeof globalThis.document === "undefined") GlobalRegistrator.register();

import { afterEach, describe, expect, mock, test } from "bun:test";
import { cleanup, render } from "@testing-library/react";
import { ObjectScreen } from "./ObjectScreen";

afterEach(cleanup);

function renderScreen(props: Partial<Parameters<typeof ObjectScreen>[0]> = {}) {
  return render(
    <ObjectScreen breadcrumb="Drawings & 3D / Drawing" title="AR-101 Rev B" mode="display" hasDraft={false} messages={[]} {...props}>
      <p>body</p>
    </ObjectScreen>
  );
}

describe("the forked ObjectScreen", () => {
  test("keeps the kit's word when no label is given", () => {
    const view = renderScreen({ onDelete: mock(() => {}) });
    expect(view.getByRole("button", { name: "Delete" })).toBeTruthy();
  });

  test("uses the screen's own verb when one is given", () => {
    const view = renderScreen({ onDelete: mock(() => {}), deleteLabel: "Remove" });
    expect(view.getByRole("button", { name: "Remove" })).toBeTruthy();
    expect(view.queryByRole("button", { name: "Delete" })).toBeNull();
  });

  test("a reason disables the control and is carried on it, whatever it is called", () => {
    const view = renderScreen({
      onDelete: mock(() => {}),
      deleteLabel: "Dispose",
      deleteDisabledReason: "Kept under the retention policy - ask an admin to dispose",
    });
    const button = view.getByRole("button", { name: "Dispose" }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(button.title).toBe("Kept under the retention policy - ask an admin to dispose");
  });

  test("no destructive control at all when the screen offers none", () => {
    const view = renderScreen();
    expect(view.queryByRole("button", { name: "Delete" })).toBeNull();
    expect(view.queryByRole("button", { name: "Remove" })).toBeNull();
  });

  test("edit mode still shows Save and Cancel, carried over from the kit unchanged", () => {
    const view = renderScreen({ mode: "edit", onSave: mock(() => {}), onCancel: mock(() => {}), saveDisabled: true, saveDisabledReason: "Name is required" });
    expect(view.getByRole("button", { name: "Save (Name is required)" })).toBeTruthy();
    expect(view.getByRole("button", { name: "Cancel" })).toBeTruthy();
  });
});
