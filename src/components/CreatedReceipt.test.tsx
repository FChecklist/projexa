/// <reference types="bun-types" />
// R67 D-67 -- the receipt that replaces toast.success().
//
// R-257: "After Save, router.replace to /module/[id] in display mode with the
// footer message 'Created {object} {id}' — never back to an empty form or a
// list." A toast is gone in four seconds; a user reading the record they just
// saved, rather than the corner of the screen, had no confirmation at all.
import { GlobalRegistrator } from "@happy-dom/global-registrator";
if (typeof globalThis.document === "undefined") GlobalRegistrator.register();

import { afterEach, describe, expect, test } from "bun:test";
import { cleanup, render, waitFor } from "@testing-library/react";
import { CreatedReceipt, createdHref, CREATED_PARAM } from "./CreatedReceipt";

afterEach(cleanup);

describe("createdHref", () => {
  test("carries the identifier a user would recognise", () => {
    expect(createdHref("/permits", "p1", "BP-2026-0142")).toBe(`/permits/p1?${CREATED_PARAM}=BP-2026-0142`);
  });

  test("escapes it, so a title with a space or an ampersand still round-trips", () => {
    expect(createdHref("/scope", "b1", "Civil & Structural Works")).toBe(
      `/scope/b1?${CREATED_PARAM}=Civil%20%26%20Structural%20Works`
    );
  });

  test("a record with no readable identifier still marks the arrival as a save", () => {
    // The parameter is present but empty: the page still shows "Created
    // permit", which is the fact the user needs.
    expect(createdHref("/permits", "p1", null)).toBe(`/permits/p1?${CREATED_PARAM}=`);
  });
});

describe("CreatedReceipt", () => {
  test("renders the receipt when the page was arrived at from a save", async () => {
    const { container } = render(<CreatedReceipt objectLabel="Permit" search={`?${CREATED_PARAM}=BP-2026-0142`} />);
    await waitFor(() => expect(container.textContent).toContain("Created permit BP-2026-0142"));
  });

  test("renders nothing on a page opened normally", async () => {
    const { container } = render(<CreatedReceipt objectLabel="Permit" search="" />);
    await waitFor(() => expect(container.textContent).toBe(""));
  });

  test("an empty identifier still confirms the save, without a stray id", async () => {
    const { container } = render(<CreatedReceipt objectLabel="Permit" search={`?${CREATED_PARAM}=`} />);
    await waitFor(() => expect(container.textContent).toBe("Created permit"));
  });

  test("it is a status region, so it is announced and it persists", async () => {
    const { findByRole } = render(
      <CreatedReceipt objectLabel="Meeting" search={`?${CREATED_PARAM}=Weekly%20site%20review`} />
    );
    const region = await findByRole("status");
    expect(region.textContent).toBe("Created meeting Weekly site review");
  });
});
