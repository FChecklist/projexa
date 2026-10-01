/// <reference types="bun-types" />
// The shared one-click component (top rail, composer, Projects-list row action, workspace header). SIMPLIFIED 2026-10-01 (owner: "a
// simple prompt ... the user copies it as many times as they want"): ONE button mints once with the safe defaults (level 0, 7 days),
// copies a ready-to-paste prompt with the real link inside it, and every later click just copies it again. No dialog, no "Change"
// link, no language toggle. The service client is a fake.
import { GlobalRegistrator } from "@happy-dom/global-registrator";
if (typeof globalThis.document === "undefined") GlobalRegistrator.register();

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
// dynamic: `screen` binds to document.body when the module loads, which must be after happy-dom is registered above
const { act, cleanup, fireEvent, render, screen } = await import("@testing-library/react");
// dynamic for the same reason: Radix decides whether layout effects exist when it is first loaded (a document must be there already)
const { AiWorkLinkCompact, AWL_ONE_CLICK_DAYS, AWL_ONE_CLICK_LEVEL } = await import("./AiWorkLinkCompact");
import { AI_ASSISTANT_NAMES, AI_WORK_LINK_ROLE_NOTE } from "@/lib/ai-work-link-access";
import { AwlError, type AwlClient, type AwlMinted } from "@/lib/ai-work-link-client";

const PROJECT = { id: "p1", name: "Tower A" };
const LINK = "https://example.supabase.co/functions/v1/ai-work-link/pxa_token";

function fakeClient(over: { mint?: () => Promise<AwlMinted> } = {}): AwlClient & { minted: unknown[]; userMinted: unknown[] } {
  const minted: unknown[] = [];
  const userMinted: unknown[] = [];
  return {
    minted,
    userMinted,
    async warning(projectId, level) {
      return { projectId, projectName: "Tower A", sentence: "SERVER SENTENCE", level, lines: 0, tasks: 0, people: 1, moneyVisible: false, writesEnabled: true, maxLevel: 1 };
    },
    async mint(input) {
      minted.push(input);
      if (over.mint) return over.mint();
      return {
        linkId: "lnk1",
        level: input.level,
        expiresAt: "2026-10-06T10:00:00Z",
        label: null,
        project: { id: input.projectId, name: "Tower A" },
        link: "https://example.supabase.co/functions/v1/ai-work-link/pxa_token",
        inbox: null,
        notice: "This is the only time the link is shown.",
        shell: false,
      };
    },
    async links() {
      return [];
    },
    async revoke() {
      throw new Error("not used here");
    },
    async mintUserLink(input) {
      userMinted.push(input);
      return {
        linkId: "lnk_user",
        level: 0,
        expiresAt: "2026-10-06T10:00:00Z",
        label: null,
        project: null,
        link: "https://example.supabase.co/functions/v1/ai-work-link/pxa_user_token",
        inbox: null,
        notice: "This is the only time the link is shown.",
        shell: false,
      };
    },
    async newProject() {
      throw new Error("not used here");
    },
  };
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

describe("who sees what", () => {
  test("a role at or above member sees the trigger", () => {
    for (const role of ["owner", "admin", "pm", "site_engineer", "member"]) {
      const view = render(<AiWorkLinkCompact role={role} project={PROJECT} client={fakeClient()} />);
      expect(screen.getByTestId("awl-compact-trigger")).toBeTruthy();
      view.unmount();
    }
  });

  test("a lower role (client_viewer) sees no button and a plain sentence", () => {
    render(<AiWorkLinkCompact role="client_viewer" project={PROJECT} client={fakeClient()} />);
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.getByTestId("awl-compact-role-note").textContent).toBe(AI_WORK_LINK_ROLE_NOTE);
  });

  test("while the role is not known nothing is drawn, so a button never flashes up and goes away", () => {
    const view = render(<AiWorkLinkCompact role={null} project={PROJECT} client={fakeClient()} />);
    expect(view.container.innerHTML).toBe("");
  });

  test("with no project selected the trigger is disabled and says why", () => {
    render(<AiWorkLinkCompact role="owner" project={null} client={fakeClient()} />);
    const trigger = screen.getByTestId("awl-compact-trigger") as HTMLButtonElement;
    expect(trigger.disabled).toBe(true);
    expect(trigger.title).toBe("Select a project first");
  });
});

describe("one button: mint once with the safe defaults, copy a ready prompt, copy again as often as wanted", () => {
  test("first click mints level 0 / 7 days and copies a prompt with the real link, naming no dialog", async () => {
    const client = fakeClient();
    render(<AiWorkLinkCompact role="owner" project={PROJECT} client={client} moduleLabel="Scope" triggerLabel="AI prompt" />);

    await act(async () => void fireEvent.click(screen.getByTestId("awl-compact-trigger")));
    expect(screen.queryByRole("dialog")).toBeNull();

    expect(client.minted).toEqual([{ projectId: "p1", level: AWL_ONE_CLICK_LEVEL, days: AWL_ONE_CLICK_DAYS }]);
    expect(AWL_ONE_CLICK_LEVEL).toBe(0);
    expect(AWL_ONE_CLICK_DAYS).toBe(7);
    expect(clipboard).toHaveLength(1);
    expect(clipboard[0]).toContain(LINK);
    expect(clipboard[0]).toContain("Scope");
    expect(clipboard[0]).toContain("GET");

    const confirm = await screen.findByTestId("awl-compact-confirm");
    expect(confirm.textContent).toContain(AI_ASSISTANT_NAMES);
    expect(confirm.textContent).toContain("expires in 7 days");
    // The button stays (it is the "copy again" control) and says what happened.
    expect(screen.getByTestId("awl-compact-trigger").textContent).toContain("Prompt copied");
    // The complications are gone.
    expect(screen.queryByTestId("awl-compact-change")).toBeNull();
    expect(screen.queryByTestId("awl-compact-locale-toggle")).toBeNull();
  });

  test("clicking again copies the same prompt again with NO second mint, as many times as wanted", async () => {
    const client = fakeClient();
    render(<AiWorkLinkCompact role="owner" project={PROJECT} client={client} />);
    for (let i = 0; i < 3; i++) await act(async () => void fireEvent.click(screen.getByTestId("awl-compact-trigger")));

    expect(client.minted).toHaveLength(1);
    expect(clipboard).toHaveLength(3);
    expect(clipboard[1]).toEqual(clipboard[0]);
    expect(clipboard[2]).toEqual(clipboard[0]);
  });

  test("switching to another project makes that project's own link", async () => {
    const client = fakeClient();
    const view = render(<AiWorkLinkCompact role="owner" project={PROJECT} client={client} />);
    await act(async () => void fireEvent.click(screen.getByTestId("awl-compact-trigger")));
    view.rerender(<AiWorkLinkCompact role="owner" project={{ id: "p2", name: "Tower B" }} client={client} />);
    await act(async () => void fireEvent.click(screen.getByTestId("awl-compact-trigger")));
    expect(client.minted).toHaveLength(2);
  });

  test("copyMode=\"link\" still copies the bare link", async () => {
    render(<AiWorkLinkCompact role="owner" project={PROJECT} client={fakeClient()} copyMode="link" />);
    await act(async () => void fireEvent.click(screen.getByTestId("awl-compact-trigger")));
    expect(clipboard).toEqual([LINK]);
  });

  test("a mint failure shows the reason and the button stays so the person can retry", async () => {
    const client = fakeClient({ mint: async () => Promise.reject(new AwlError("You made 10 links in the last hour. Wait before making another.", 429, "MINT_CAP_HOUR")) });
    render(<AiWorkLinkCompact role="owner" project={PROJECT} client={client} />);
    await act(async () => void fireEvent.click(screen.getByTestId("awl-compact-trigger")));
    expect((await screen.findByTestId("awl-compact-error")).textContent).toContain("You made 10 links in the last hour.");
    expect(screen.getByTestId("awl-compact-trigger")).toBeTruthy();
    expect(clipboard).toHaveLength(0);
  });
});

describe("scope=\"user\" -- ONE link for the whole person, no project needed", () => {
  test("is enabled with no project, mints a user link (no project id), and copies a prompt naming the list, the report and the new-project option", async () => {
    const client = fakeClient();
    render(<AiWorkLinkCompact role="owner" project={null} client={client} scope="user" triggerLabel="AI prompt" />);
    const trigger = screen.getByTestId("awl-compact-trigger") as HTMLButtonElement;
    expect(trigger.disabled).toBe(false);

    await act(async () => void fireEvent.click(trigger));

    expect(client.userMinted).toEqual([{ days: AWL_ONE_CLICK_DAYS }]);
    expect(client.minted).toHaveLength(0); // never the per-project mint
    expect(clipboard).toHaveLength(1);
    expect(clipboard[0]).toContain("pxa_user_token");
    expect(clipboard[0]).toContain("numbered list of ALL my projects");
    expect(clipboard[0]).toContain("Report on all above");
    expect(clipboard[0]).toContain("Create New Project");
    expect(screen.getByTestId("awl-compact-trigger").textContent).toContain("Prompt copied");
  });

  test("copies again on every click with no second mint", async () => {
    const client = fakeClient();
    render(<AiWorkLinkCompact role="owner" project={null} client={client} scope="user" />);
    for (let i = 0; i < 3; i++) await act(async () => void fireEvent.click(screen.getByTestId("awl-compact-trigger")));
    expect(client.userMinted).toHaveLength(1);
    expect(clipboard).toHaveLength(3);
    expect(clipboard[2]).toEqual(clipboard[0]);
  });

  test("a read-only role still sees the plain sentence, not a button", () => {
    render(<AiWorkLinkCompact role="client_viewer" project={null} client={fakeClient()} scope="user" />);
    expect(screen.queryByTestId("awl-compact-trigger")).toBeNull();
    expect(screen.getByTestId("awl-compact-role-note")).toBeTruthy();
  });
});
