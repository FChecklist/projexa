/// <reference types="bun-types" />
// PROJEXA-BUILD-002 WP-10, way 1 (AW-601, screen half). The "Make a project from a file" screen and the hook under it: a person picks a file,
// the file is read, the result and the questions are shown, one confirm creates the project, and the person is pointed at it. The server is a
// scripted fake client (what it is sent is recorded); the screen, the hook and the panel are the real ones.
import { GlobalRegistrator } from "@happy-dom/global-registrator";
if (typeof globalThis.document === "undefined") GlobalRegistrator.register();

import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
const { act, cleanup, fireEvent, render, screen, waitFor } = await import("@testing-library/react");

mock.module("next/navigation", () => ({ useRouter: () => ({ push: () => {}, refresh: () => {}, replace: () => {} }) }));
const { UploadProjectDocumentScreen, projectHrefFor } = await import("./UploadProjectDocumentClient");
import { listRememberedJobs } from "@/lib/document-job-memory";
import { DocumentError, parseJob, type DocJob, type FromDocumentClient, type SubmitInput, type SubmitResult } from "@/lib/project-from-document-client";

const SHA = "c".repeat(64);
const PRODUCTS = [
  { id: "prod-1", name: "Villa Projects" },
  { id: "prod-2", name: "Fit-outs" },
];
const RECON = { status: "matched", expected: 1596280, actual: 1596280, difference: 0, tolerance: 1, source: "reader", byArea: [] };
const QUESTION = { kind: "no_rate", sheet: "Table 4", row: 7, text: "Row 7 has a quantity and no rate." };

function job(state: DocJob["state"], updatedAt: string, over: Record<string, unknown> = {}): DocJob {
  return parseJob({ jobId: "j1", state, fileName: "boq.xlsx", projectId: state === "created" ? "proj-42" : null, questions: [], reconciliation: RECON, stats: { sheets: 22, rows: 343, lines: 53 }, error: null, updatedAt, ...over });
}

type Scripted = FromDocumentClient & { submits: SubmitInput[]; reads: number };

/** The next `job()` answer is the next entry of the queue for the current step; the last entry repeats. */
function scripted(steps: { submit?: SubmitResult | Error; jobs: Array<DocJob | Error> }[]): Scripted {
  let step = -1;
  let read = 0;
  const client: Scripted = {
    submits: [],
    reads: 0,
    fingerprint: async (f) => (f.name === "other.xlsx" ? "d".repeat(64) : SHA),
    async submit(input) {
      client.submits.push(input);
      step += 1;
      read = 0;
      const answer = steps[step]?.submit ?? { kind: "queued", state: "received", jobId: "j1" };
      if (answer instanceof Error) throw answer;
      return answer as SubmitResult;
    },
    async job() {
      client.reads += 1;
      const queue = steps[Math.max(step, 0)].jobs;
      const next = queue[Math.min(read, queue.length - 1)];
      read += 1;
      if (next instanceof Error) throw next;
      return next;
    },
  };
  return client;
}

const timing = { intervalMs: 1, timeoutMs: 5000 };
const workbook = (name = "boq.xlsx") => new File(["PK"], name);

function open(client: FromDocumentClient, props: { role?: string | null; resumeSha256?: string | null; products?: typeof PRODUCTS } = {}) {
  return render(
    <UploadProjectDocumentScreen
      role={props.role === undefined ? "member" : props.role}
      products={props.products ?? PRODUCTS}
      resumeSha256={props.resumeSha256}
      client={client}
      timing={timing}
    />,
  );
}

async function pick(file: File) {
  await act(async () => void fireEvent.change(screen.getByTestId("doc-file"), { target: { files: [file] } }));
}

beforeEach(() => {
  try {
    localStorage.clear();
  } catch {
    /* no storage in this environment */
  }
});
afterEach(cleanup);

describe("who sees the screen", () => {
  test("a role that may send sees the form; client_viewer sees a sentence; an unknown role sees nothing yet", () => {
    const client = scripted([{ jobs: [] }]);
    open(client);
    expect(screen.getByTestId("doc-file")).toBeTruthy();
    cleanup();
    open(client, { role: "client_viewer" });
    expect(screen.queryByTestId("doc-file")).toBeNull();
    expect(screen.getByTestId("doc-role-note").textContent).toContain("member role");
    cleanup();
    expect(open(client, { role: null }).container.innerHTML).toBe("");
  });
});

describe("choosing a file", () => {
  test("Read the file stays off, with the reason, until a file and a product are chosen", async () => {
    open(scripted([{ jobs: [] }]));
    expect((screen.getByTestId("doc-read") as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByTestId("doc-read-reason").textContent).toBe("Choose a file and a product to continue.");
    await pick(workbook());
    expect(screen.getByTestId("doc-read-reason").textContent).toBe("Choose a product to continue.");
    act(() => void fireEvent.change(screen.getByTestId("doc-product"), { target: { value: "prod-1" } }));
    expect((screen.getByTestId("doc-read") as HTMLButtonElement).disabled).toBe(false);
    expect(screen.queryByTestId("doc-read-reason")).toBeNull();
  });

  test("a file of the wrong type or over the size is refused in words before anything is sent", async () => {
    const client = scripted([{ jobs: [] }]);
    open(client);
    await pick(new File(["x"], "photo.png"));
    expect(screen.getByTestId("doc-file-error").textContent).toMatch(/Wrong type: \.png/);
    expect((screen.getByTestId("doc-read") as HTMLButtonElement).disabled).toBe(true);
    const big = new File(["x"], "big.xlsx");
    Object.defineProperty(big, "size", { value: 9 * 1024 * 1024 });
    await pick(big);
    expect(screen.getByTestId("doc-file-error").textContent).toMatch(/^Too large: 9 MB, limit 4 MB/);
    expect(client.submits).toHaveLength(0);
  });

  test("with one product it is chosen already", async () => {
    open(scripted([{ jobs: [] }]), { products: [PRODUCTS[0]] });
    expect((screen.getByTestId("doc-product") as HTMLSelectElement).value).toBe("prod-1");
  });

  test("without a given list the screen reads the products once, and a failed read says so instead of showing an empty picker", async () => {
    let reads = 0;
    render(<UploadProjectDocumentScreen role="member" client={scripted([{ jobs: [] }])} loadProducts={async () => { reads += 1; return PRODUCTS }} timing={timing} />);
    await waitFor(() => expect(screen.getAllByRole("option").map((o) => o.textContent)).toEqual(["Choose a product", "Villa Projects", "Fit-outs"]));
    expect(reads).toBe(1);
    cleanup();
    render(<UploadProjectDocumentScreen role="member" client={scripted([{ jobs: [] }])} loadProducts={async () => { throw new Error("x") }} timing={timing} />);
    await waitFor(() => expect(screen.getByRole("alert").textContent).toBe("Could not load the products: the request did not complete"));
  });
});

describe("the whole way: read, answer, create, land on the project", () => {
  test("reads with mode prepare, shows the questions, and creates only after the confirm, with the name and the acknowledgements", async () => {
    const parkedJob = job("needs_answers", "t1", { questions: [QUESTION] });
    const client = scripted([
      { jobs: [job("received", "t0"), job("reading", "t0"), parkedJob] },
      { jobs: [parkedJob, job("reading", "t2"), job("created", "t3", { questions: [QUESTION] })] },
    ]);
    open(client);
    await pick(workbook());
    act(() => void fireEvent.change(screen.getByTestId("doc-product"), { target: { value: "prod-2" } }));
    act(() => void fireEvent.change(screen.getByTestId("doc-name"), { target: { value: "Zoomies Dubai" } }));
    await act(async () => void fireEvent.click(screen.getByTestId("doc-read")));

    await waitFor(() => expect(screen.getByTestId("doc-parked")).toBeTruthy());
    expect(client.submits).toHaveLength(1);
    expect(client.submits[0]).toMatchObject({ productId: "prod-2", name: "Zoomies Dubai", mode: "prepare" });
    expect(client.submits[0].file.name).toBe("boq.xlsx");
    expect(screen.getAllByTestId("doc-question")).toHaveLength(1);
    // nothing has been created and the file waits on this device's list
    expect(screen.queryByTestId("doc-created")).toBeNull();
    expect(listRememberedJobs().map((j) => j.sha256)).toEqual([SHA]);

    expect((screen.getByTestId("doc-create") as HTMLButtonElement).disabled).toBe(true);
    act(() => void fireEvent.click(screen.getByTestId("doc-ack-questions")));
    await act(async () => void fireEvent.click(screen.getByTestId("doc-create")));

    await waitFor(() => expect(screen.getByTestId("doc-created")).toBeTruthy());
    expect(client.submits).toHaveLength(2);
    expect(client.submits[1]).toMatchObject({ productId: "prod-2", name: "Zoomies Dubai", mode: "create", acknowledgeQuestions: true, acknowledgeShortfall: false });
    // the old parked answer (t1) was read past, not shown as the result of the create
    expect(screen.getByTestId("doc-open-project").getAttribute("href")).toBe(projectHrefFor("proj-42"));
    // a finished job leaves the list of files that wait
    expect(listRememberedJobs()).toEqual([]);
  });

  test("a file with nothing to ask goes ready, and one click creates it with no acknowledgement", async () => {
    const ready = job("ready", "t1");
    const client = scripted([{ jobs: [ready] }, { jobs: [ready, job("created", "t2")] }]);
    open(client);
    await pick(workbook());
    act(() => void fireEvent.change(screen.getByTestId("doc-product"), { target: { value: "prod-1" } }));
    await act(async () => void fireEvent.click(screen.getByTestId("doc-read")));
    await waitFor(() => expect(screen.getByTestId("doc-create")).toBeTruthy());
    await act(async () => void fireEvent.click(screen.getByTestId("doc-create")));
    await waitFor(() => expect(screen.getByTestId("doc-created")).toBeTruthy());
    expect(client.submits[1]).toMatchObject({ mode: "create", acknowledgeQuestions: false, acknowledgeShortfall: false });
  });

  test("the file that already made a project answers with that project and creates nothing new", async () => {
    const client = scripted([{ submit: { kind: "duplicate", projectId: "proj-7" }, jobs: [] }]);
    open(client);
    await pick(workbook());
    act(() => void fireEvent.change(screen.getByTestId("doc-product"), { target: { value: "prod-1" } }));
    await act(async () => void fireEvent.click(screen.getByTestId("doc-read")));
    await waitFor(() => expect(screen.getByTestId("doc-created").textContent).toContain("already made a project"));
    expect(screen.getByTestId("doc-open-project").getAttribute("href")).toBe(projectHrefFor("proj-7"));
    expect(client.submits).toHaveLength(1);
  });
});

describe("refusals", () => {
  test("a refusal of the server on the send is shown in its own words, and the form stays for another try", async () => {
    const client = scripted([{ submit: new DocumentError("Only .xlsx workbooks are read", 400, "unsupported_file_type"), jobs: [] }]);
    open(client);
    await pick(new File(["x"], "plan.pdf"));
    act(() => void fireEvent.change(screen.getByTestId("doc-product"), { target: { value: "prod-1" } }));
    await act(async () => void fireEvent.click(screen.getByTestId("doc-read")));
    await waitFor(() => expect(screen.getByTestId("doc-failed")).toBeTruthy());
    expect(screen.getByTestId("doc-failed").textContent).toContain("Only .xlsx workbooks are read");
    expect(screen.getByTestId("doc-failed").getAttribute("data-code")).toBe("unsupported_file_type");
    expect(screen.getByTestId("doc-file")).toBeTruthy();
    expect(listRememberedJobs()).toEqual([]);
  });

  test("a job that ends rejected shows the code and sentence the job holds, and leaves the file list", async () => {
    const rejected = job("rejected", "t1", { error: { code: "extraction_not_grounded", message: "The extraction cites a row the file does not have.", issues: ["sheet Table 9 row 2"] } });
    const client = scripted([{ jobs: [job("reading", "t0"), rejected] }]);
    open(client);
    await pick(workbook());
    act(() => void fireEvent.change(screen.getByTestId("doc-product"), { target: { value: "prod-1" } }));
    await act(async () => void fireEvent.click(screen.getByTestId("doc-read")));
    await waitFor(() => expect(screen.getByTestId("doc-failed")).toBeTruthy());
    expect(screen.getByTestId("doc-failed").textContent).toContain("The extraction cites a row the file does not have.");
    expect(screen.getByTestId("doc-issues").textContent).toContain("sheet Table 9 row 2");
    expect(listRememberedJobs()).toEqual([]);
  });

  test("a refused shortfall can be accepted: the same file is read again with acknowledgeShortfall", async () => {
    const refused = job("rejected", "t1", { error: { code: "extraction_total_mismatch", message: "The lines add up to less than the file prints, so nothing was created.", issues: ["difference 207800"] } });
    const ready = job("ready", "t3", { reconciliation: { ...RECON, status: "shortfall", actual: 1388480, difference: 207800 } });
    const client = scripted([{ jobs: [refused] }, { jobs: [ready] }]);
    open(client);
    await pick(workbook());
    act(() => void fireEvent.change(screen.getByTestId("doc-product"), { target: { value: "prod-1" } }));
    await act(async () => void fireEvent.click(screen.getByTestId("doc-read")));
    await waitFor(() => expect(screen.getByTestId("doc-accept-shortfall")).toBeTruthy());
    await act(async () => void fireEvent.click(screen.getByTestId("doc-accept-shortfall")));
    await waitFor(() => expect(screen.getByTestId("doc-parked")).toBeTruthy());
    expect(client.submits[1]).toMatchObject({ mode: "prepare", acknowledgeShortfall: true });
    expect(screen.getByTestId("doc-ack-shortfall")).toBeTruthy();
  });
});

describe("opening a job this browser sent earlier", () => {
  test("shows its questions, asks for the same file again, refuses a different one, and finishes with the same one", async () => {
    const parkedJob = job("needs_answers", "t1", { questions: [QUESTION] });
    // one step: the read of the resumed job is the first entry; after the send the queue starts again, so its first two entries are the old parked answer
    const client = scripted([{ jobs: [parkedJob, parkedJob, job("created", "t2")] }]);
    open(client, { resumeSha256: SHA });
    await waitFor(() => expect(screen.getByTestId("doc-parked")).toBeTruthy());
    expect(client.submits).toHaveLength(0);
    expect(screen.getAllByTestId("doc-question")).toHaveLength(1);
    expect(screen.getByLabelText("Choose the same file again to finish")).toBeTruthy();

    // creating before the file is chosen says so and sends nothing
    act(() => void fireEvent.click(screen.getByTestId("doc-ack-questions")));
    await act(async () => void fireEvent.click(screen.getByTestId("doc-create")));
    expect(screen.getByTestId("doc-note").textContent).toContain("Choose the same file again");
    expect(client.submits).toHaveLength(0);

    await pick(workbook("other.xlsx"));
    await waitFor(() => expect(screen.getByTestId("doc-note").textContent).toContain("not the file that was sent"));

    await pick(workbook("boq.xlsx"));
    // the same file: the product is needed by the server, so the screen asks for it before sending
    await act(async () => void fireEvent.click(screen.getByTestId("doc-create")));
    expect(client.submits).toHaveLength(0);
    expect(screen.getByTestId("doc-note").textContent).toContain("Choose a product");

    act(() => void fireEvent.change(screen.getByTestId("doc-product"), { target: { value: "prod-1" } }));
    await act(async () => void fireEvent.click(screen.getByTestId("doc-create")));
    await waitFor(() => expect(screen.getByTestId("doc-created")).toBeTruthy());
    expect(client.submits).toHaveLength(1);
    expect(client.submits[0]).toMatchObject({ mode: "create", productId: "prod-1", acknowledgeQuestions: true });
    expect(screen.getByTestId("doc-open-project").getAttribute("href")).toBe(projectHrefFor("proj-42"));
  });
});
