/// <reference types="bun-types" />
// PROJEXA-BUILD-002 WP-10. The browser client of "Proposals and questions": the list, the approve action and how every answer is read.
import { describe, expect, test } from "bun:test";
import { ApprovalError, createApprovalsClient, linesOf } from "./project-approvals-client";

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

type Call = { url: string; init?: RequestInit };
function fakeFetch(answers: Array<() => Response>): { fetch: typeof fetch; calls: Call[] } {
  const calls: Call[] = [];
  let i = 0;
  const fake = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), init });
    const next = answers[Math.min(i, answers.length - 1)];
    i += 1;
    return next();
  }) as typeof fetch;
  return { fetch: fake, calls };
}

const PROPOSAL = {
  submissionId: "sub-1",
  source: "email_intelligence",
  functionId: "create_boq",
  label: "Create BOQ",
  params: {
    projectId: "p1",
    title: "Revised joinery",
    lineItems: [
      { itemCode: "J-1", description: "Vanity unit", unit: "nos", quantity: 4, rate: 1500 },
      { itemCode: "J-2", description: "Wardrobe", unit: "nos", quantity: 2, rate: 4200.5 },
    ],
  },
  missing: [{ name: "note", label: "A note for the record", code: "REQUIRED_PARAM_MISSING" }],
  note: "From the 12 Sept email",
  preparedById: "u1",
  preparedAt: "2026-09-26T08:00:00.000Z",
  approve: { action: "approve", method: "POST", path: "/x", body: { submissionId: "sub-1" } },
};

describe("list", () => {
  test("reads the proposals of one project: title, line count, a preview, the total when every line is priced, and what is missing", async () => {
    const { fetch, calls } = fakeFetch([() => json(200, { projectId: "p1", count: 1, proposals: [PROPOSAL] })]);
    const [proposal] = await createApprovalsClient({ fetch }).list("p 1");
    expect(calls[0].url).toBe("/api/projects/p%201/approvals");
    expect(proposal).toMatchObject({
      submissionId: "sub-1",
      projectId: "p 1",
      title: "Revised joinery",
      lineCount: 2,
      total: 4 * 1500 + 2 * 4200.5,
      note: "From the 12 Sept email",
      source: "email_intelligence",
    });
    expect(proposal.lines[0]).toEqual({ itemCode: "J-1", description: "Vanity unit", unit: "nos", quantity: 4, rate: 1500 });
    expect(proposal.missing).toEqual([{ name: "note", label: "A note for the record", options: [] }]);
  });

  test("shows no total when a rate was withheld, instead of a wrong one", async () => {
    const withheld = { ...PROPOSAL, params: { ...PROPOSAL.params, lineItems: [{ description: "Vanity unit", quantity: 4 }, { description: "Wardrobe", quantity: 2, rate: 10 }] } };
    const [proposal] = await createApprovalsClient({ fetch: fakeFetch([() => json(200, { proposals: [withheld] })]).fetch }).list("p1");
    expect(proposal.total).toBeNull();
    expect(proposal.lineCount).toBe(2);
  });

  test("keeps at most six lines for the preview but counts all of them", async () => {
    const many = { ...PROPOSAL, params: { lineItems: Array.from({ length: 9 }, (_, i) => ({ description: `L${i}`, quantity: 1, rate: 1 })) } };
    const [proposal] = await createApprovalsClient({ fetch: fakeFetch([() => json(200, { proposals: [many] })]).fetch }).list("p1");
    expect(proposal.lines).toHaveLength(6);
    expect(proposal.lineCount).toBe(9);
  });

  test("an empty list is an empty list, and a failed read is an error, never an empty list", async () => {
    const client = createApprovalsClient({ fetch: fakeFetch([() => json(200, { proposals: [] })]).fetch });
    expect(await client.list("p1")).toEqual([]);
    const failing = createApprovalsClient({ fetch: fakeFetch([() => json(500, { error: "Failed to load the proposals of this project" })]).fetch });
    const error = await failing.list("p1").catch((e) => e);
    expect(error).toBeInstanceOf(ApprovalError);
    expect(error.message).toBe("Failed to load the proposals of this project");
    expect(error.status).toBe(500);
  });

  test("an answer that is not a list is unreadable, not empty", async () => {
    const error = await createApprovalsClient({ fetch: fakeFetch([() => json(200, { hello: 1 })]).fetch }).list("p1").catch((e) => e);
    expect(error.status).toBe(502);
  });

  test("linesOf reads only well-formed lines", () => {
    expect(linesOf({ lineItems: [{ description: "ok", quantity: 1 }, { nope: 1 }, "x"] })).toHaveLength(1);
    expect(linesOf(null)).toEqual([]);
    expect(linesOf({ lineItems: "x" })).toEqual([]);
  });
});

describe("approve", () => {
  test("posts the submission id and the values the person added, and reads an approval", async () => {
    const { fetch, calls } = fakeFetch([() => json(201, { approved: true, submissionId: "sub-1", boqId: "boq-1", lineItemIds: ["l1", "l2"], route: "x" })]);
    const result = await createApprovalsClient({ fetch }).approve("p1", "sub-1", { note: "ok" });
    expect(calls[0].url).toBe("/api/projects/p1/approvals");
    expect(calls[0].init?.method).toBe("POST");
    expect(JSON.parse(String(calls[0].init?.body))).toEqual({ submissionId: "sub-1", params: { note: "ok" } });
    expect(result).toEqual({ kind: "approved", boqId: "boq-1", lineItemIds: ["l1", "l2"] });
  });

  test("a needs_input answer is a question with nothing written", async () => {
    const result = await createApprovalsClient({
      fetch: fakeFetch([() => json(200, { approved: false, status: "needs_input", missing: [{ name: "unit", label: "Unit", options: [{ value: "m2", label: "Square metres" }] }] })]).fetch,
    }).approve("p1", "sub-1", {});
    expect(result).toEqual({ kind: "needs_input", missing: [{ name: "unit", label: "Unit", options: [{ value: "m2", label: "Square metres" }] }] });
  });

  test("a 409 keeps the sentence and the decision status", async () => {
    const error = await createApprovalsClient({
      fetch: fakeFetch([() => json(409, { error: "That proposal has already been decided", code: null, upstreamStatus: "done" })]).fetch,
    }).approve("p1", "sub-1", {}).catch((e) => e);
    expect(error).toBeInstanceOf(ApprovalError);
    expect(error.message).toBe("That proposal has already been decided");
    expect(error.status).toBe(409);
    expect(error.upstreamStatus).toBe("done");
  });

  test("a 2xx answer that is neither an approval nor a question is refused as unreadable", async () => {
    const error = await createApprovalsClient({ fetch: fakeFetch([() => json(200, { approved: false })]).fetch }).approve("p1", "sub-1", {}).catch((e) => e);
    expect(error.status).toBe(502);
  });

  test("a dropped connection says nothing was changed", async () => {
    const error = await createApprovalsClient({ fetch: (async () => { throw new TypeError("x") }) as unknown as typeof fetch }).approve("p1", "sub-1", {}).catch((e) => e);
    expect(error.status).toBe(0);
    expect(error.message).toContain("Nothing was changed");
  });
});

describe("projects", () => {
  test("reads the id and name of each project", async () => {
    const { fetch, calls } = fakeFetch([() => json(200, { projects: [{ id: "p1", name: "Tower A", status: "active" }, { id: "p2" }, { nope: 1 }] })]);
    expect(await createApprovalsClient({ fetch }).projects()).toEqual([{ id: "p1", name: "Tower A" }, { id: "p2", name: "p2" }]);
    expect(calls[0].url).toBe("/api/projects");
  });
});
