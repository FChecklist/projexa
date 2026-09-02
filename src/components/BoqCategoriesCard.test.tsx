/// <reference types="bun-types" />
// R67 lane I (WS-I item I-05, R-177): the org-level BOQ category list on
// /settings.
//
// TWO HARNESSES, ON PURPOSE:
//   * renderToStaticMarkup for the FIRST-PAINT states. The role gate has to be
//     right before any fetch resolves -- edit controls must not flash into
//     existence for someone who may not use them.
//   * happy-dom + @testing-library/react for the behaviour that only exists
//     once effects and fetches have run: rename()'s rejection path. That one is
//     a DOM-identity question (does the uncontrolled field re-sync to what the
//     server actually holds?) and static markup structurally cannot see it.
//
// RETRACTION, recorded rather than quietly deleted: an earlier revision of this
// file asserted that "@happy-dom/global-registrator is declared in package.json
// but absent from node_modules in this environment" and used that to justify
// covering the rename path in prose instead of in a test. That was false -- the
// package is installed, and src/components/ProcurementClient.test.tsx has been
// driving a live DOM with it all along. The claim is withdrawn. It matters
// because the rename tests below caught a real defect that the prose had
// asserted was fixed.
import { GlobalRegistrator } from "@happy-dom/global-registrator";
// Registering twice in one process throws ("Happy DOM has already been
// globally registered"), and `bun test` runs every file in ONE process --
// register only if no DOM is installed yet, so this suite passes standalone
// AND alongside every other happy-dom-based suite.
if (typeof globalThis.document === "undefined") GlobalRegistrator.register();

import { afterEach, describe, expect, mock, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";

const toasts: { kind: "success" | "error"; message: string }[] = [];
mock.module("sonner", () => ({
  toast: {
    success: (m: string) => void toasts.push({ kind: "success", message: m }),
    error: (m: string) => void toasts.push({ kind: "error", message: m }),
  },
}));

// Dynamic, not a static top-level import, so the component is evaluated only
// after register() has created `document` -- the same ordering requirement
// ProcurementClient.test.tsx documents for its Radix chain.
const BoqCategoriesCard = (await import("./BoqCategoriesCard")).default;

describe("BoqCategoriesCard -- canEdit=false (the read-only first paint)", () => {
  const html = renderToStaticMarkup(<BoqCategoriesCard canEdit={false} />);

  test("shows the card and says what the list is FOR", () => {
    expect(html).toContain("BOQ Categories");
    expect(html).toContain("The categories offered on every BOQ line");
  });

  test("offers NO Delete button", () => {
    expect(html).not.toContain("Delete");
  });

  test("offers NO add row -- no 'Add a category' field and no Add button", () => {
    expect(html).not.toContain("Add a category");
    expect(html).not.toContain('aria-label="New category name"');
  });

  test("first paint is an explicit loading state, not an empty card that reads as 'no categories'", () => {
    expect(html).toContain("Loading…");
    expect(html).not.toContain("No categories yet.");
  });
});

describe("BoqCategoriesCard -- canEdit=true (the first paint)", () => {
  const html = renderToStaticMarkup(<BoqCategoriesCard canEdit />);

  test("offers the labelled add row", () => {
    expect(html).toContain('aria-label="New category name"');
    expect(html).toContain('placeholder="Add a category"');
    expect(html).toContain(">Add</button>");
  });

  test("Add starts disabled -- an empty name can never be submitted", () => {
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Add<\/button>/);
  });

  test("still shows the same explanatory copy as the read-only render", () => {
    expect(html).toContain("BOQ Categories");
    expect(html).toContain("The categories offered on every BOQ line");
  });
});

// ---------------------------------------------------------------------------
// Live DOM: rename()'s two outcomes.
// ---------------------------------------------------------------------------

type Row = { id: string; name: string; sortOrder: number; isActive: boolean };

const CIVIL: Row = { id: "cat-civil", name: "Civil", sortOrder: 0, isActive: true };

function jsonRes(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

/**
 * `stored` is read fresh on every GET, so it models what the SERVER actually
 * holds. That is the whole point of these tests: after a refused rename the
 * server still holds the OLD name, so the reload in rename()'s catch returns a
 * row identical to the one already on screen. Anything that relies on the
 * reloaded value *differing* to refresh the field will not fire.
 */
function categoryFetch(stored: () => Row[], onPatch: () => Response) {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    const method = (init?.method ?? "GET").toUpperCase();
    if (method === "PATCH" && /\/api\/scope\/categories\/.+/.test(url)) return onPatch();
    if (method === "GET" && url.includes("/api/scope/categories")) return jsonRes({ categories: stored() });
    throw new Error(`unexpected fetch in test: ${method} ${url}`);
  }) as typeof fetch;
}

/** The row's field, found by the aria-label the card builds from the STORED name. */
function fieldFor(name: string): HTMLInputElement {
  const el = document.querySelector<HTMLInputElement>(`input[aria-label="Category name: ${name}"]`);
  if (!el) throw new Error(`no field for stored name "${name}"`);
  return el;
}

async function renderWithRow(stored: () => Row[], onPatch: () => Response) {
  globalThis.fetch = categoryFetch(stored, onPatch);
  render(<BoqCategoriesCard canEdit />);
  await waitFor(() => fieldFor(stored()[0]!.name));
}

afterEach(() => {
  cleanup();
  toasts.length = 0;
  // @ts-expect-error -- test-only global fetch stub cleanup
  delete globalThis.fetch;
});

describe("BoqCategoriesCard -- rename", () => {
  test("a REFUSED rename puts the stored name back on screen: the field never keeps a value the server rejected", async () => {
    // The server refuses and therefore does NOT change: every GET keeps
    // returning "Civil".
    await renderWithRow(
      () => [CIVIL],
      () => jsonRes({ error: '"Gypsum" is already a category' }, 409),
    );

    const field = fieldFor("Civil");
    expect(field.value).toBe("Civil");

    fireEvent.change(field, { target: { value: "Gypsum" } });
    fireEvent.blur(field);

    await waitFor(() => {
      if (!toasts.some((t) => t.kind === "error")) throw new Error("rename has not settled");
    });
    // The server's own wording, verbatim -- not a generic "couldn't rename".
    expect(toasts.at(-1)).toEqual({ kind: "error", message: '"Gypsum" is already a category' });

    // THE REGRESSION THIS FILE EXISTS FOR: the screen and the database must not
    // disagree. The stored name is still "Civil", so the field must read
    // "Civil" -- not the "Gypsum" the server just refused.
    expect(fieldFor("Civil").value).toBe("Civil");
  });

  test("a SUCCESSFUL rename shows the new stored name, and the toast reports how many BOQ lines moved", async () => {
    let stored: Row[] = [CIVIL];
    await renderWithRow(
      () => stored,
      () => {
        stored = [{ ...CIVIL, name: "Gypsum" }];
        return jsonRes({ id: CIVIL.id, name: "Gypsum", lineItemsUpdated: 12 });
      },
    );

    const field = fieldFor("Civil");
    fireEvent.change(field, { target: { value: "Gypsum" } });
    fireEvent.blur(field);

    await waitFor(() => {
      if (!toasts.some((t) => t.kind === "success")) throw new Error("rename has not settled");
    });
    expect(toasts.at(-1)).toEqual({ kind: "success", message: 'Renamed to "Gypsum" — 12 BOQ lines updated' });
    expect(fieldFor("Gypsum").value).toBe("Gypsum");
  });

  test("renaming to the unchanged stored name is not sent to the server at all", async () => {
    await renderWithRow(
      () => [CIVIL],
      () => {
        throw new Error("PATCH must not be issued when the name did not change");
      },
    );

    const field = fieldFor("Civil");
    fireEvent.change(field, { target: { value: "  Civil  " } }); // whitespace only
    fireEvent.blur(field);

    expect(toasts).toEqual([]);
  });
});
