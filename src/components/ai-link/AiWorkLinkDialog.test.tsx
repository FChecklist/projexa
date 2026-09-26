/// <reference types="bun-types" />
// PROJEXA-BUILD-002 WP-08 (AW-405, AW-406). The AI work link dialog, rendered for real in happy-dom against a fake service client that
// behaves like the Edge function's contract (ai-work-link-client.ts): the sentence comes from the service and is shown as it arrives,
// Create shows the link once with a working Copy, the list re-reads after a revoke, and closing the dialog leaves no token behind.
import { GlobalRegistrator } from "@happy-dom/global-registrator";
if (typeof globalThis.document === "undefined") GlobalRegistrator.register();

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
// dynamic: `screen` binds to document.body when the module loads, which must be after happy-dom is registered above
const { act, cleanup, fireEvent, render, screen, waitFor } = await import("@testing-library/react");
// dynamic for the same reason: Radix decides whether layout effects exist when it is first loaded (a document must be there already)
const { AiWorkLinkDialog } = await import("./AiWorkLinkDialog");
import { useState } from "react";
import { AWL_URL, AwlError, type AwlClient, type AwlLinkRow, type AwlMinted, type AwlWarning } from "@/lib/ai-work-link-client";

const TOKEN = `pxa_${"cd34".repeat(16)}`;
const LINK = `${AWL_URL}/${TOKEN}`;
const PROJECT = { id: "p1", name: "Tower A" };

function warningFor(level: 0 | 1, over: Partial<AwlWarning> = {}): AwlWarning {
  return {
    projectId: "p1",
    projectName: "Tower A",
    sentence: `SERVER SENTENCE for level ${level}: 12 BOQ lines, 3 tasks, 4 people.`,
    level,
    lines: 12,
    tasks: 3,
    people: 4,
    moneyVisible: false,
    writesEnabled: true,
    maxLevel: 1,
    ...over,
  };
}

function minted(over: Partial<AwlMinted> = {}): AwlMinted {
  return {
    linkId: "lnk_new",
    level: 0,
    expiresAt: "2026-10-03T10:00:00Z",
    label: null,
    project: { id: "p1", name: "Tower A" },
    link: LINK,
    inbox: null,
    notice: "This is the only time the link is shown. Copy it now and paste it into an assistant that only you use.",
    shell: false,
    ...over,
  };
}

function row(over: Partial<AwlLinkRow> = {}): AwlLinkRow {
  return { id: "old1", projectId: "p1", projectName: "Tower A", label: "home assistant", level: 0, createdAt: "2026-09-20T10:00:00Z", expiresAt: "2026-10-01T10:00:00Z", revokedAt: null, lastUsedAt: null, status: "active", ...over };
}

type Fake = AwlClient & {
  log: { warning: Array<[string, number]>; mint: unknown[]; links: string[]; revoke: string[]; newProject: unknown[] };
  rows: AwlLinkRow[];
};

/** A service client that keeps the person's links the way the database does: a revoke changes the row the next list returns. */
function fakeClient(over: { warning?: (projectId: string, level: 0 | 1) => Promise<AwlWarning>; mint?: () => Promise<AwlMinted>; rows?: AwlLinkRow[]; newProject?: () => Promise<AwlMinted> } = {}): Fake {
  const log: Fake["log"] = { warning: [], mint: [], links: [], revoke: [], newProject: [] };
  const client: Fake = {
    log,
    rows: over.rows ?? [],
    async warning(projectId, level) {
      log.warning.push([projectId, level]);
      return over.warning ? over.warning(projectId, level) : warningFor(level);
    },
    async mint(input) {
      log.mint.push(input);
      const made = over.mint ? await over.mint() : minted();
      client.rows = [row({ id: made.linkId, label: input.label || null, level: input.level, status: "active" }), ...client.rows.map((r) => (r.status === "active" ? { ...r, status: "revoked" as const, revokedAt: "2026-09-26T10:00:00Z" } : r))];
      return made;
    },
    async links(projectId) {
      log.links.push(projectId);
      return client.rows.map((r) => ({ ...r }));
    },
    async revoke(linkId) {
      log.revoke.push(linkId);
      client.rows = client.rows.map((r) => (r.id === linkId ? { ...r, status: "revoked" as const, revokedAt: "2026-09-26T10:00:00Z" } : r));
      return { linkId, revoked: true, already: false };
    },
    async newProject(input) {
      log.newProject.push(input);
      return over.newProject ? over.newProject() : minted({ shell: true, project: { id: "shell1", name: "New project" }, linkId: "lnk_shell" });
    },
  };
  return client;
}

function Host({ client, mode = "project", onProjectCreated }: { client: AwlClient; mode?: "project" | "new-project"; onProjectCreated?: (p: { id: string; name: string }) => void }) {
  const [open, setOpen] = useState(true);
  return (
    <div>
      <button type="button" onClick={() => setOpen(true)}>reopen</button>
      <AiWorkLinkDialog open={open} onOpenChange={setOpen} mode={mode} project={PROJECT} client={client} onProjectCreated={onProjectCreated} />
    </div>
  );
}

let clipboard: string[];
beforeEach(() => {
  clipboard = [];
  Object.defineProperty(globalThis.navigator, "clipboard", {
    configurable: true,
    value: { writeText: async (text: string) => void clipboard.push(text) },
  });
});
afterEach(cleanup);

const create = () => screen.getByTestId("awl-create") as HTMLButtonElement;

describe("the warning", () => {
  test("is the sentence the service sent, and Create waits for it", async () => {
    let release!: (w: AwlWarning) => void;
    const client = fakeClient({ warning: () => new Promise<AwlWarning>((resolve) => (release = resolve)) });
    render(<Host client={client} />);
    // not shown yet: no sentence, and Create cannot be pressed
    expect(screen.queryByText(/SERVER SENTENCE/)).toBeNull();
    expect(create().disabled).toBe(true);
    await act(async () => release(warningFor(0)));
    expect(await screen.findByText("SERVER SENTENCE for level 0: 12 BOQ lines, 3 tasks, 4 people.")).toBeTruthy();
    expect(create().disabled).toBe(false);
    expect(client.log.warning).toEqual([["p1", 0]]);
  });

  test("a warning that fails shows the reason and leaves Create disabled", async () => {
    const client = fakeClient({ warning: async () => Promise.reject(new AwlError("No such project for you.", 404, "PROJECT_NOT_FOUND")) });
    render(<Host client={client} />);
    expect(await screen.findByText("No such project for you.")).toBeTruthy();
    expect(create().disabled).toBe(true);
  });

  test("choosing level 1 asks for the level 1 sentence and shows that one", async () => {
    const client = fakeClient();
    render(<Host client={client} />);
    await screen.findByText(/SERVER SENTENCE for level 0/);
    fireEvent.click(screen.getByLabelText(/Direct entries/));
    expect(await screen.findByText(/SERVER SENTENCE for level 1/)).toBeTruthy();
    expect(screen.queryByText(/SERVER SENTENCE for level 0/)).toBeNull();
    expect(client.log.warning).toEqual([["p1", 0], ["p1", 1]]);
  });

  test("level 1 is not offered to a role that may only read and draft", async () => {
    const client = fakeClient({ warning: async (_p, level) => warningFor(level, { maxLevel: 0 }) });
    render(<Host client={client} />);
    await screen.findByText(/SERVER SENTENCE for level 0/);
    expect((screen.getByLabelText(/Direct entries/) as HTMLInputElement).disabled).toBe(true);
    expect(screen.getByText("Your role can read and draft only.")).toBeTruthy();
  });

  test("while direct entries are switched off the dialog says so beside level 1", async () => {
    const client = fakeClient({ warning: async (_p, level) => warningFor(level, { writesEnabled: false }) });
    render(<Host client={client} />);
    await screen.findByText(/SERVER SENTENCE for level 0/);
    expect(screen.getByTestId("awl-writes-off").textContent).toContain("not switched on yet");
  });
});

describe("Create", () => {
  test("shows the link once, Copy puts exactly that link on the clipboard, and the list gains the new link", async () => {
    const client = fakeClient({ rows: [row()] });
    render(<Host client={client} />);
    await screen.findByText(/SERVER SENTENCE for level 0/);
    fireEvent.change(screen.getByLabelText(/Name for this link/), { target: { value: "my laptop AI" } });
    fireEvent.click(screen.getByLabelText("30 days"));
    await act(async () => void fireEvent.click(create()));

    expect(client.log.mint).toEqual([{ projectId: "p1", level: 0, days: 30, label: "my laptop AI" }]);
    const shown = (await screen.findByTestId("awl-link")) as HTMLInputElement;
    expect(shown.value).toBe(LINK);
    expect(screen.getByTestId("awl-instruction").textContent).toContain("Paste this link into your AI assistant");
    // the options and Create are gone: the link is not made twice by a second press
    expect(screen.queryByTestId("awl-create")).toBeNull();

    await act(async () => void fireEvent.click(screen.getByTestId("awl-copy")));
    expect(clipboard).toEqual([LINK]);
    expect(screen.getByTestId("awl-status").textContent).toBe("Link copied.");

    // the list was re-read, and shows the new link (no token in it) with the earlier one switched off
    await waitFor(() => expect(screen.getAllByTestId("awl-link-row")).toHaveLength(2));
    const rows = screen.getAllByTestId("awl-link-row");
    expect(rows[0].getAttribute("data-status")).toBe("active");
    expect(rows[0].textContent).toContain("my laptop AI");
    expect(rows[1].getAttribute("data-status")).toBe("revoked");
  });

  test("a refusal from the service is shown and no link appears", async () => {
    const client = fakeClient({ mint: async () => Promise.reject(new AwlError("You made 10 links in the last hour. Wait before making another.", 429, "MINT_CAP_HOUR")) });
    render(<Host client={client} />);
    await screen.findByText(/SERVER SENTENCE for level 0/);
    await act(async () => void fireEvent.click(create()));
    expect((await screen.findByRole("alert")).textContent).toBe("You made 10 links in the last hour. Wait before making another.");
    expect(screen.queryByTestId("awl-link")).toBeNull();
    expect(create().disabled).toBe(false);
  });

  test("tells the person a new link switches off the earlier one", async () => {
    const client = fakeClient({ rows: [row()] });
    render(<Host client={client} />);
    expect((await screen.findByTestId("awl-replace-note")).textContent).toContain("switches the earlier one off");
  });
});

describe("the link is shown once", () => {
  test("Escape closes the dialog and reopening it shows no token anywhere", async () => {
    const client = fakeClient();
    render(<Host client={client} />);
    await screen.findByText(/SERVER SENTENCE for level 0/);
    await act(async () => void fireEvent.click(create()));
    await screen.findByTestId("awl-link");
    expect(document.body.innerHTML).toContain(TOKEN);

    await act(async () => void fireEvent.keyDown(document, { key: "Escape" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(document.body.innerHTML).not.toContain(TOKEN);

    fireEvent.click(screen.getByText("reopen"));
    await screen.findByRole("dialog");
    await screen.findByText(/SERVER SENTENCE for level 0/);
    expect(document.body.innerHTML).not.toContain(TOKEN);
    expect(document.body.textContent).not.toContain(TOKEN);
    for (const input of Array.from(document.querySelectorAll("input"))) expect((input as HTMLInputElement).value).not.toContain(TOKEN);
    // a fresh open starts on the options, and Create is there again (nothing was kept)
    expect(create()).toBeTruthy();
    expect(client.log.mint).toHaveLength(1);
  });

  test("Done closes the dialog and the token goes with it", async () => {
    const client = fakeClient();
    render(<Host client={client} />);
    await screen.findByText(/SERVER SENTENCE for level 0/);
    await act(async () => void fireEvent.click(create()));
    await screen.findByTestId("awl-link");
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(document.body.innerHTML).not.toContain(TOKEN);
  });
});

describe("Revoke", () => {
  test("sends the link id, re-reads the list, and the row shows revoked with no Revoke button", async () => {
    const client = fakeClient({ rows: [row()] });
    render(<Host client={client} />);
    const revoke = await screen.findByRole("button", { name: "Revoke link home assistant" });
    expect(screen.getByTestId("awl-link-row").getAttribute("data-status")).toBe("active");
    const readsBefore = client.log.links.length;

    await act(async () => void fireEvent.click(revoke));

    expect(client.log.revoke).toEqual(["old1"]);
    await waitFor(() => expect(screen.getByTestId("awl-link-row").getAttribute("data-status")).toBe("revoked"));
    expect(screen.queryByRole("button", { name: /Revoke link/ })).toBeNull();
    expect(client.log.links.length).toBeGreaterThan(readsBefore);
    expect(screen.getByTestId("awl-status").textContent).toBe("Link revoked.");
  });
});

describe("New project with my AI", () => {
  test("one press makes the project and the link, tells the shell, and shows the new project's warning beside the link", async () => {
    const client = fakeClient();
    const created: Array<{ id: string; name: string }> = [];
    render(<Host client={client} mode="new-project" onProjectCreated={(p) => created.push(p)} />);
    expect(screen.getByRole("heading", { name: "New project with my AI" })).toBeTruthy();
    fireEvent.click(screen.getByLabelText("1 day"));
    await act(async () => void fireEvent.click(screen.getByTestId("awl-create-project")));

    expect(client.log.newProject).toEqual([{ days: 1 }]);
    expect(client.log.mint).toEqual([]);
    expect(((await screen.findByTestId("awl-link")) as HTMLInputElement).value).toBe(LINK);
    expect(created).toEqual([{ id: "shell1", name: "New project" }]);
    // the warning of the project that now exists, asked at level 0
    expect(await screen.findByTestId("awl-result-warning")).toBeTruthy();
    expect(client.log.warning).toEqual([["shell1", 0]]);
  });

  test("a refusal (a role below member) is shown and nothing is created", async () => {
    const client = fakeClient({ newProject: async () => Promise.reject(new AwlError("Creating a project needs the member role or above.", 403, "ROLE_TOO_LOW")) });
    render(<Host client={client} mode="new-project" />);
    await act(async () => void fireEvent.click(screen.getByTestId("awl-create-project")));
    expect((await screen.findByRole("alert")).textContent).toBe("Creating a project needs the member role or above.");
    expect(screen.queryByTestId("awl-link")).toBeNull();
  });
});
