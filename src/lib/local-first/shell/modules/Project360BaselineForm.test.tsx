/// <reference types="bun-types" />
// Sumeet R-100 on the installed shell's Project 360 screen: the confirm-baseline control (online only, evidence required, server decides).
import { GlobalRegistrator } from "@happy-dom/global-registrator";
if (typeof globalThis.document === "undefined") GlobalRegistrator.register();

import { afterEach, describe, expect, test } from "bun:test";
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";

const Form = (await import("./Project360BaselineForm")).default;

afterEach(cleanup);

/** Types into a CONTROLLED input (fireEvent.change cannot drive one in this environment): calls its React onChange inside act(). */
function typeInto(el: Element, value: string) {
  const key = Object.keys(el).find((k) => k.startsWith("__reactProps"));
  const props = (el as unknown as Record<string, { onChange?: (e: unknown) => void }>)[key!];
  act(() => { props.onChange!({ target: { value }, currentTarget: { value } }); });
}
const res = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("Project360BaselineForm", () => {
  test("online: posts the evidence to the revisions route with ?action=baseline, then tells the screen to re-read", async () => {
    let posted: { url: string; body: unknown } | null = null;
    let confirmed = 0;
    const fetchImpl = (async (url: RequestInfo | URL, init?: RequestInit) => { posted = { url: String(url), body: JSON.parse(String(init?.body)) }; return res({ id: "b1" }, 201); }) as typeof fetch;
    const { getByLabelText, getByText } = render(<Form boqId="boq-1" online onConfirmed={() => { confirmed += 1; }} fetchImpl={fetchImpl} />);
    typeInto(getByLabelText("Evidence for the baseline"), "PO-2026-114");
    fireEvent.click(getByText("Confirm baseline"));
    await waitFor(() => expect(confirmed).toBe(1));
    expect(posted!.url).toBe("/api/scope/boq-1/revisions?action=baseline");
    expect(posted!.body).toEqual({ evidenceArtefactRef: "PO-2026-114" });
  });

  test("blank evidence sends nothing and says why", async () => {
    let calls = 0;
    const fetchImpl = (async () => { calls += 1; return res({}, 201); }) as typeof fetch;
    const { getByText, findByRole } = render(<Form boqId="boq-1" online onConfirmed={() => {}} fetchImpl={fetchImpl} />);
    fireEvent.click(getByText("Confirm baseline"));
    expect((await findByRole("alert")).textContent).toContain("Name the evidence first");
    expect(calls).toBe(0);
  });

  test("a refusal is shown in the server's words and nothing is re-read", async () => {
    let confirmed = 0;
    const fetchImpl = (async () => res({ error: "Forbidden: manager role required" }, 403)) as typeof fetch;
    const { getByLabelText, getByText, findByRole } = render(<Form boqId="boq-1" online onConfirmed={() => { confirmed += 1; }} fetchImpl={fetchImpl} />);
    typeInto(getByLabelText("Evidence for the baseline"), "PO-1");
    fireEvent.click(getByText("Confirm baseline"));
    expect((await findByRole("alert")).textContent).toContain("Forbidden: manager role required");
    expect(confirmed).toBe(0);
  });

  test("offline: no form, a plain sentence that it needs a connection", () => {
    const { queryByText, getByTestId } = render(<Form boqId="boq-1" online={false} onConfirmed={() => {}} />);
    expect(queryByText("Confirm baseline")).toBeNull();
    expect(getByTestId("baseline-needs-connection").textContent).toContain("needs a connection");
  });
});
