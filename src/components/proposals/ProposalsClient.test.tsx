/// <reference types="bun-types" />
// PROJEXA-BUILD-002 WP-10. "Proposals and questions": the proposals prepared for the projects of the organisation, Approve (with the values a
// proposal still needs), the files that wait for a person, and that a failed read is never shown as an empty list. VERIDIAN is a fake client.
import { GlobalRegistrator } from "@happy-dom/global-registrator";
if (typeof globalThis.document === "undefined") GlobalRegistrator.register();

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
const { act, cleanup, fireEvent, render, screen, waitFor, within } = await import("@testing-library/react");
const { ProposalsScreen } = await import("./ProposalsClient");
import { rememberJob, listRememberedJobs } from "@/lib/document-job-memory";
import { ApprovalError, type ApprovalsClient, type ApproveResult, type Proposal } from "@/lib/project-approvals-client";
import { DocumentError, parseJob, type DocJob, type FromDocumentClient } from "@/lib/project-from-document-client";

const proposal = (over: Partial<Proposal> = {}): Proposal => ({
  submissionId: "sub-1",
  projectId: "p1",
  source: "email_intelligence",
  label: "Create BOQ",
  title: "Revised joinery",
  lineCount: 9,
  lines: [{ itemCode: "J-1", description: "Vanity unit", unit: "nos", quantity: 4, rate: 1500 }],
  total: 6000,
  missing: [],
  note: "From the 12 Sept email",
  preparedAt: "2026-09-26T08:00:00.000Z",
  ...over,
});

type FakeApprovals = ApprovalsClient & { approvals: Array<{ projectId: string; submissionId: string; params: Record<string, string> }> };
function fakeApprovals(opts: {
  projects?: Array<{ id: string; name: string }>;
  lists?: Record<string, Proposal[] | Error>;
  approve?: () => Promise<ApproveResult>;
  projectsError?: Error;
}): FakeApprovals {
  const client: FakeApprovals = {
    approvals: [],
    projects: async () => {
      if (opts.projectsError) throw opts.projectsError;
      return opts.projects ?? [{ id: "p1", name: "Tower A" }];
    },
    list: async (id) => {
      const answer = opts.lists?.[id] ?? [];
      if (answer instanceof Error) throw answer;
      return answer;
    },
    approve: async (projectId, submissionId, params) => {
      client.approvals.push({ projectId, submissionId, params });
      return opts.approve ? opts.approve() : { kind: "approved", boqId: "boq-1", lineItemIds: ["l1", "l2"] };
    },
  };
  return client;
}

const SHA_A = "a".repeat(64);
const SHA_B = "b".repeat(64);
function jobOf(state: DocJob["state"], questions = 0): DocJob {
  return parseJob({ jobId: "j", state, fileName: "x.xlsx", projectId: null, questions: Array.from({ length: questions }, (_, i) => ({ kind: "no_rate", sheet: "T", row: i + 1, text: "q" })), reconciliation: null, stats: null, error: null, updatedAt: "t" });
}
function fakeDocuments(byHash: Record<string, DocJob | Error>): FromDocumentClient {
  return {
    fingerprint: async () => SHA_A,
    submit: async () => ({ kind: "queued", state: "received", jobId: "j" }),
    job: async (ref) => {
      const answer = "sha256" in ref ? byHash[ref.sha256] : undefined;
      if (!answer) throw new DocumentError("No such extraction job", 404, "job_not_found");
      if (answer instanceof Error) throw answer;
      return answer;
    },
  };
}

beforeEach(() => {
  try {
    localStorage.clear();
  } catch {
    /* no storage here */
  }
});
afterEach(cleanup);

describe("the proposals", () => {
  test("lists what was prepared for each project: title, project, source, note, line count, total, and the first lines", async () => {
    render(<ProposalsScreen role="pm" approvals={fakeApprovals({ lists: { p1: [proposal()] } })} documents={fakeDocuments({})} />);
    const card = await screen.findByTestId("proposal");
    expect(card.textContent).toContain("Revised joinery");
    expect(card.textContent).toContain("Tower A");
    expect(card.textContent).toContain("Prepared from an email");
    expect(card.textContent).toContain("From the 12 Sept email");
    expect(screen.getByTestId("proposal-lines").textContent).toContain("9 line items, adding up to 6,000");
    expect(screen.getByTestId("proposal-lines").textContent).toContain("J-1 Vanity unit - 4 nos at 1,500");
    expect(screen.getByTestId("proposal-lines").textContent).toContain("and 8 more");
  });

  test("says nothing waits only after every read worked", async () => {
    render(<ProposalsScreen role="pm" approvals={fakeApprovals({ lists: { p1: [] } })} documents={fakeDocuments({})} />);
    expect((await screen.findByTestId("proposals-empty")).textContent).toBe("Nothing waits for approval.");
  });

  test("a project whose proposals could not be read is named with the server's sentence, and the list is not called empty", async () => {
    const approvals = fakeApprovals({ projects: [{ id: "p1", name: "Tower A" }, { id: "p2", name: "Villa B" }], lists: { p1: [proposal()], p2: new ApprovalError("Failed to load the proposals of this project", 500) } });
    render(<ProposalsScreen role="pm" approvals={approvals} documents={fakeDocuments({})} />);
    expect((await screen.findByTestId("proposals-project-error")).textContent).toBe("Could not read the proposals of Villa B: Failed to load the proposals of this project");
    expect(screen.getAllByTestId("proposal")).toHaveLength(1);
    expect(screen.queryByTestId("proposals-empty")).toBeNull();
  });

  test("a failed read of the project list is an error, never 'nothing waits'", async () => {
    render(<ProposalsScreen role="pm" approvals={fakeApprovals({ projectsError: new ApprovalError("Failed to load projects", 502) })} documents={fakeDocuments({})} />);
    expect((await screen.findByTestId("proposals-load-error")).textContent).toBe("Could not load your projects: Failed to load projects");
    expect(screen.queryByTestId("proposals-empty")).toBeNull();
  });

  test("the project filter shows the proposals of one project", async () => {
    const approvals = fakeApprovals({ projects: [{ id: "p1", name: "Tower A" }, { id: "p2", name: "Villa B" }], lists: { p1: [proposal()], p2: [proposal({ submissionId: "sub-2", projectId: "p2", title: "Pool works" })] } });
    render(<ProposalsScreen role="pm" approvals={approvals} documents={fakeDocuments({})} />);
    await waitFor(() => expect(screen.getAllByTestId("proposal")).toHaveLength(2));
    act(() => void fireEvent.change(screen.getByTestId("proposals-project"), { target: { value: "p2" } }));
    expect(screen.getAllByTestId("proposal")).toHaveLength(1);
    expect(screen.getByTestId("proposal").textContent).toContain("Pool works");
  });
});

describe("Approve", () => {
  test("a project manager approves: the submission id goes to the service, the proposal leaves the list, and the BOQ is linked", async () => {
    const approvals = fakeApprovals({ lists: { p1: [proposal()] } });
    render(<ProposalsScreen role="pm" approvals={approvals} documents={fakeDocuments({})} />);
    await screen.findByTestId("proposal");
    await act(async () => void fireEvent.click(screen.getByTestId("proposal-approve")));
    await waitFor(() => expect(screen.getByTestId("proposal-approved")).toBeTruthy());
    expect(approvals.approvals).toEqual([{ projectId: "p1", submissionId: "sub-1", params: {} }]);
    expect(screen.queryByTestId("proposal")).toBeNull();
    expect(screen.getByTestId("proposal-approved").textContent).toContain("2 line items written");
    expect(screen.getByText("Open the BOQ").getAttribute("href")).toBe("/scope/boq-1");
  });

  test("a role below project manager reads the proposal, sees why Approve is off, and cannot approve", async () => {
    const approvals = fakeApprovals({ lists: { p1: [proposal()] } });
    render(<ProposalsScreen role="site_engineer" approvals={approvals} documents={fakeDocuments({})} />);
    await screen.findByTestId("proposal");
    expect((screen.getByTestId("proposal-approve") as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByTestId("approve-role-note").textContent).toContain("project manager role");
    await act(async () => void fireEvent.click(screen.getByTestId("proposal-approve")));
    expect(approvals.approvals).toHaveLength(0);
  });

  test("Reject is shown off with its reason, because the service has no reject action", async () => {
    render(<ProposalsScreen role="owner" approvals={fakeApprovals({ lists: { p1: [proposal()] } })} documents={fakeDocuments({})} />);
    await screen.findByTestId("proposal");
    const reject = screen.getByTestId("proposal-reject") as HTMLButtonElement;
    expect(reject.disabled).toBe(true);
    expect(reject.textContent).toBe("Reject (not available yet)");
  });

  test("values the proposal still needs are asked for in the card and sent with the approval; none are sent blank", async () => {
    const missing = [{ name: "unit", label: "Unit of measure", options: [{ value: "m2", label: "Square metres" }] }, { name: "note", label: "A note", options: [] }];
    const approvals = fakeApprovals({ lists: { p1: [proposal({ missing })] } });
    render(<ProposalsScreen role="admin" approvals={approvals} documents={fakeDocuments({})} />);
    await screen.findByTestId("proposal");
    await act(async () => void fireEvent.click(screen.getByTestId("proposal-approve")));
    expect(screen.getByTestId("proposal-error").textContent).toBe("Fill in Unit of measure, A note first.");
    expect(approvals.approvals).toHaveLength(0);

    const [unit, note] = screen.getAllByTestId("proposal-answer");
    act(() => void fireEvent.change(unit, { target: { value: "m2" } }));
    act(() => void fireEvent.change(note, { target: { value: "  checked  " } }));
    await act(async () => void fireEvent.click(screen.getByTestId("proposal-approve")));
    await waitFor(() => expect(screen.getByTestId("proposal-approved")).toBeTruthy());
    expect(approvals.approvals[0].params).toEqual({ unit: "m2", note: "checked" });
  });

  test("an answer that is a question shows the values it wants and writes nothing", async () => {
    const approvals = fakeApprovals({ lists: { p1: [proposal()] }, approve: async () => ({ kind: "needs_input", missing: [{ name: "projectLabel", label: "Project label", options: [] }] }) });
    render(<ProposalsScreen role="pm" approvals={approvals} documents={fakeDocuments({})} />);
    await screen.findByTestId("proposal");
    await act(async () => void fireEvent.click(screen.getByTestId("proposal-approve")));
    await waitFor(() => expect(screen.getByTestId("proposal-missing")).toBeTruthy());
    expect(screen.getByTestId("proposal-missing").textContent).toContain("Project label");
    expect(screen.getByTestId("proposal-error").textContent).toContain("needs these values");
    expect(screen.queryByTestId("proposal-approved")).toBeNull();
  });

  test("a refusal (already decided) is shown beside the proposal in the server's words, and the proposal stays", async () => {
    const approvals = fakeApprovals({ lists: { p1: [proposal()] }, approve: async () => { throw new ApprovalError("That proposal has already been decided", 409, "done") } });
    render(<ProposalsScreen role="pm" approvals={approvals} documents={fakeDocuments({})} />);
    await screen.findByTestId("proposal");
    await act(async () => void fireEvent.click(screen.getByTestId("proposal-approve")));
    await waitFor(() => expect(screen.getByTestId("proposal-error").textContent).toBe("That proposal has already been decided"));
    expect(screen.getByTestId("proposal")).toBeTruthy();
    expect(screen.queryByTestId("proposal-approved")).toBeNull();
  });
});

describe("files that wait for a person", () => {
  test("shows each file this browser sent that still waits, with its state read from the server, and a link to open it", async () => {
    rememberJob({ sha256: SHA_A, fileName: "zoomies.xlsx" });
    rememberJob({ sha256: SHA_B, fileName: "villa.xlsx" });
    const documents = fakeDocuments({ [SHA_A]: jobOf("needs_answers", 3), [SHA_B]: jobOf("ready") });
    render(<ProposalsScreen role="member" approvals={fakeApprovals({})} documents={documents} />);
    await waitFor(() => expect(screen.getAllByTestId("waiting-file")).toHaveLength(2));
    const rows = screen.getAllByTestId("waiting-file");
    expect(within(rows[0]).getByText("villa.xlsx")).toBeTruthy();
    expect(rows[0].textContent).toContain("Read and checked, waiting for you to create the project");
    expect(rows[1].textContent).toContain("3 questions need a person");
    expect(within(rows[1]).getByTestId("waiting-file-open").getAttribute("href")).toBe(`/projects/from-file?job=${SHA_A}`);
  });

  test("a file whose job is finished leaves the list and the browser's memory; a file whose state could not be read says so", async () => {
    rememberJob({ sha256: SHA_A, fileName: "done.xlsx" });
    rememberJob({ sha256: SHA_B, fileName: "unknown.xlsx" });
    const documents = fakeDocuments({ [SHA_A]: jobOf("created"), [SHA_B]: new DocumentError("The server could not be reached.", 0, "NETWORK") });
    render(<ProposalsScreen role="member" approvals={fakeApprovals({})} documents={documents} />);
    await waitFor(() => expect(screen.getAllByTestId("waiting-file")).toHaveLength(1));
    expect(screen.getByTestId("waiting-file-state").textContent).toBe("Could not read its state: The server could not be reached.");
    expect(listRememberedJobs().map((j) => j.sha256)).toEqual([SHA_B]);
  });

  test("with no file remembered it says none is waiting", async () => {
    render(<ProposalsScreen role="member" approvals={fakeApprovals({})} documents={fakeDocuments({})} />);
    expect((await screen.findByTestId("files-empty")).textContent).toBe("No file sent from this browser is waiting.");
  });
});
