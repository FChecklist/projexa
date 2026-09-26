/// <reference types="bun-types" />
// PROJEXA-BUILD-002 WP-10, way 2. The chat attach control: a file attached in the chat goes to the same "make a project from a file" flow as the
// upload screen, the result shows in the chat, and the project is announced in the shell's message region. The server is a scripted fake client.
import { GlobalRegistrator } from "@happy-dom/global-registrator";
if (typeof globalThis.document === "undefined") GlobalRegistrator.register();

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { ReactNode } from "react";
const { act, cleanup, fireEvent, render, screen, waitFor } = await import("@testing-library/react");
const { ChatDocumentAttach } = await import("./ChatDocumentAttach");
const { ShellMessagesProvider, useShellMessages } = await import("@/lib/shell-messages");
import { parseJob, type DocJob, type FromDocumentClient, type SubmitInput } from "@/lib/project-from-document-client";

const SHA = "e".repeat(64);
const RECON = { status: "matched", expected: 100, actual: 100, difference: 0, tolerance: 1, source: "reader", byArea: [] };
function job(state: DocJob["state"], updatedAt: string, over: Record<string, unknown> = {}): DocJob {
  return parseJob({ jobId: "j", state, fileName: "boq.xlsx", projectId: state === "created" ? "proj-5" : null, questions: [], reconciliation: RECON, stats: { sheets: 2, rows: 30, lines: 12 }, error: null, updatedAt, ...over });
}

function scripted(jobs: DocJob[][]): FromDocumentClient & { submits: SubmitInput[] } {
  let step = -1;
  let read = 0;
  const client = {
    submits: [] as SubmitInput[],
    fingerprint: async () => SHA,
    submit: async (input: SubmitInput) => {
      client.submits.push(input);
      step += 1;
      read = 0;
      return { kind: "queued", state: "received", jobId: "j" } as const;
    },
    job: async () => {
      const queue = jobs[Math.max(step, 0)];
      const next = queue[Math.min(read, queue.length - 1)];
      read += 1;
      return next;
    },
  };
  return client;
}

/** Shows the messages of the shell's region as text, so the test reads what the chat would show above the composer. */
function Region() {
  const { messages } = useShellMessages();
  return (
    <ul data-testid="region">
      {messages.map((m) => (
        <li key={m.id} data-kind={m.kind}>
          {m.text} {m.href ? `[${m.linkLabel ?? "Open"} ${m.href}]` : ""}
        </li>
      ))}
    </ul>
  );
}
const Frame = ({ children }: { children: ReactNode }) => (
  <ShellMessagesProvider>
    {children}
    <Region />
  </ShellMessagesProvider>
);

const timing = { intervalMs: 1, timeoutMs: 5000 };
const PRODUCTS = [{ id: "prod-1", name: "Villa Projects" }, { id: "prod-2", name: "Fit-outs" }];

function attach(client: FromDocumentClient, over: { role?: string | null; products?: typeof PRODUCTS } = {}) {
  return render(
    <Frame>
      <ChatDocumentAttach role={over.role === undefined ? "member" : over.role} client={client} loadProducts={async () => over.products ?? PRODUCTS} timing={timing} />
    </Frame>,
  );
}
async function pickFile(file: File) {
  const input = document.querySelector('input[type="file"]') as HTMLInputElement;
  await act(async () => void fireEvent.change(input, { target: { files: [file] } }));
}

beforeEach(() => {
  try {
    localStorage.clear();
    // the message region hydrates from session storage, which another test file of the same run may have filled
    sessionStorage.clear();
  } catch {
    /* no storage here */
  }
});
afterEach(cleanup);

describe("who sees the control", () => {
  test("every role that may send a file sees the attach button; client_viewer and an unknown role see nothing", () => {
    const client = scripted([[job("ready", "t")]]);
    attach(client);
    expect(screen.getByLabelText("Attach a project file, up to 4 MB", { selector: "button" })).toBeTruthy();
    cleanup();
    expect(attach(client, { role: "client_viewer" }).container.querySelector('[data-testid="chat-document-attach"]')).toBeNull();
    cleanup();
    expect(attach(client, { role: null }).container.querySelector('[data-testid="chat-document-attach"]')).toBeNull();
  });
});

describe("attaching a file", () => {
  test("a file of the wrong type is refused on the chip before anything is sent", async () => {
    const client = scripted([[job("ready", "t")]]);
    attach(client);
    await pickFile(new File(["x"], "photo.png"));
    expect(screen.getByRole("alert").textContent).toMatch(/Wrong type: \.png/);
    expect(screen.queryByTestId("chat-doc-read")).toBeNull();
    expect(client.submits).toHaveLength(0);
  });

  test("with one product it reads at once on the button and creates nothing until the confirm; the result and the project show in the chat", async () => {
    const ready = job("ready", "t1");
    const client = scripted([[job("reading", "t0"), ready], [ready, job("created", "t2")]]);
    attach(client, { products: [PRODUCTS[0]] });
    await pickFile(new File(["PK"], "boq.xlsx"));
    await waitFor(() => expect((screen.getByTestId("chat-doc-read") as HTMLButtonElement).disabled).toBe(false));
    await act(async () => void fireEvent.click(screen.getByTestId("chat-doc-read")));

    await waitFor(() => expect(screen.getByTestId("doc-parked")).toBeTruthy());
    expect(client.submits).toHaveLength(1);
    expect(client.submits[0]).toMatchObject({ mode: "prepare", productId: "prod-1" });
    expect(screen.getByTestId("doc-stats").textContent).toBe("Read 2 sheets, 30 rows, 12 BOQ lines.");
    expect(screen.getByTestId("region").textContent).not.toContain("Project created from");

    await act(async () => void fireEvent.click(screen.getByTestId("doc-create")));
    await waitFor(() => expect(screen.getByTestId("doc-created")).toBeTruthy());
    expect(client.submits[1]).toMatchObject({ mode: "create", productId: "prod-1", acknowledgeQuestions: false });
    expect(screen.getByTestId("region").textContent).toContain("Project created from boq.xlsx [Open the project /dashboard/project?projectId=proj-5]");
    expect(document.querySelector('[data-kind="saved"]')).toBeTruthy();
  });

  test("with several products the person chooses one before the file can be read", async () => {
    const client = scripted([[job("ready", "t1")]]);
    attach(client);
    await pickFile(new File(["PK"], "boq.xlsx"));
    await screen.findByTestId("chat-doc-product");
    expect((screen.getByTestId("chat-doc-read") as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText("Choose a product first.")).toBeTruthy();
    act(() => void fireEvent.change(screen.getByTestId("chat-doc-product"), { target: { value: "prod-2" } }));
    expect((screen.getByTestId("chat-doc-read") as HTMLButtonElement).disabled).toBe(false);
    await act(async () => void fireEvent.click(screen.getByTestId("chat-doc-read")));
    await waitFor(() => expect(client.submits).toHaveLength(1));
    expect(client.submits[0].productId).toBe("prod-2");
  });

  test("a job with questions shows them in the chat and links to the full screen", async () => {
    const parked = job("needs_answers", "t1", { questions: [{ kind: "no_rate", sheet: "Table 4", row: 7, text: "Row 7 has a quantity and no rate." }] });
    const client = scripted([[parked]]);
    attach(client, { products: [PRODUCTS[0]] });
    await pickFile(new File(["PK"], "boq.xlsx"));
    await waitFor(() => expect((screen.getByTestId("chat-doc-read") as HTMLButtonElement).disabled).toBe(false));
    await act(async () => void fireEvent.click(screen.getByTestId("chat-doc-read")));
    await waitFor(() => expect(screen.getByTestId("doc-questions")).toBeTruthy());
    expect(screen.getByTestId("doc-question").textContent).toContain("Row 7 has a quantity and no rate.");
    expect(screen.getByText("Open it on its own screen").getAttribute("href")).toBe(`/projects/from-file?job=${SHA}`);
  });

  test("removing the chip clears the file and the result", async () => {
    const client = scripted([[job("ready", "t1")]]);
    attach(client, { products: [PRODUCTS[0]] });
    await pickFile(new File(["PK"], "boq.xlsx"));
    await waitFor(() => expect(screen.getByTestId("chat-doc-read")).toBeTruthy());
    act(() => void fireEvent.click(screen.getByLabelText("Remove boq.xlsx")));
    expect(screen.queryByTestId("chat-doc-read")).toBeNull();
    expect(screen.queryByLabelText("Remove boq.xlsx")).toBeNull();
  });
});
