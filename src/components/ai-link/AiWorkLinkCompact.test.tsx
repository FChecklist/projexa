/// <reference types="bun-types" />
// WO ai-work-link-ui-and-projects-tab (2026-09-29). The shared one-click component AiWorkLinkButtons.tsx, ProjectsListClient.tsx's
// row action and M24Shell.tsx's left-panel banner all reuse: mint immediately with the safe defaults (level 0, 7 days), copy to the
// clipboard, show a small inline confirmation IN PLACE OF THE BUTTON (not a modal), and "Change access or expiry" opens the real,
// unchanged AiWorkLinkDialog. The service client is a fake; the dialog itself is covered by AiWorkLinkDialog.test.tsx.
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

function fakeClient(over: { mint?: () => Promise<AwlMinted> } = {}): AwlClient & { minted: unknown[] } {
  const minted: unknown[] = [];
  return {
    minted,
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

describe("one click mints with the safe defaults, copies, and confirms -- no dialog", () => {
  test("mints level 0 / 7 days, copies the link, and shows the inline confirmation naming the assistants", async () => {
    const client = fakeClient();
    render(<AiWorkLinkCompact role="owner" project={PROJECT} client={client} triggerLabel="AI work link for this project" />);

    // No dialog opens on click -- this is the whole point of the change.
    await act(async () => void fireEvent.click(screen.getByTestId("awl-compact-trigger")));
    expect(screen.queryByRole("dialog")).toBeNull();

    expect(client.minted).toEqual([{ projectId: "p1", level: AWL_ONE_CLICK_LEVEL, days: AWL_ONE_CLICK_DAYS }]);
    expect(AWL_ONE_CLICK_LEVEL).toBe(0);
    expect(AWL_ONE_CLICK_DAYS).toBe(7);
    expect(clipboard).toEqual(["https://example.supabase.co/functions/v1/ai-work-link/pxa_token"]);

    const confirm = await screen.findByTestId("awl-compact-confirm");
    expect(confirm.textContent).toContain("Link copied");
    expect(confirm.textContent).toContain(AI_ASSISTANT_NAMES);
    expect(confirm.textContent).toContain("Read-and-draft access, expires in 7 days.");
    // The button itself is gone -- replaced, not merely covered.
    expect(screen.queryByTestId("awl-compact-trigger")).toBeNull();
  });

  test("a mint failure shows the reason and offers 'Change access or expiry', not a stuck spinner", async () => {
    const client = fakeClient({ mint: async () => Promise.reject(new AwlError("You made 10 links in the last hour. Wait before making another.", 429, "MINT_CAP_HOUR")) });
    render(<AiWorkLinkCompact role="owner" project={PROJECT} client={client} />);
    await act(async () => void fireEvent.click(screen.getByTestId("awl-compact-trigger")));
    expect((await screen.findByTestId("awl-compact-error")).textContent).toContain("You made 10 links in the last hour.");
    // The trigger is back (not replaced by a permanent confirmation) so the person can retry.
    expect(screen.getByTestId("awl-compact-trigger")).toBeTruthy();
  });
});

describe("'Change access or expiry' opens the real, unchanged dialog", () => {
  test("after a successful one-click copy", async () => {
    const client = fakeClient();
    render(<AiWorkLinkCompact role="owner" project={PROJECT} client={client} />);
    await act(async () => void fireEvent.click(screen.getByTestId("awl-compact-trigger")));
    await screen.findByTestId("awl-compact-confirm");

    fireEvent.click(screen.getByTestId("awl-compact-change"));
    expect(await screen.findByRole("dialog")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "AI work link for Tower A" })).toBeTruthy();
    // The dialog's own warning-before-write gate is intact -- unaffected by the one-click path above it.
    expect(await screen.findByText("SERVER SENTENCE")).toBeTruthy();
  });

  test("after a mint failure, as the escape hatch out of the error state", async () => {
    const client = fakeClient({ mint: async () => Promise.reject(new AwlError("Refused.", 403, "ROLE_TOO_LOW")) });
    render(<AiWorkLinkCompact role="owner" project={PROJECT} client={client} />);
    await act(async () => void fireEvent.click(screen.getByTestId("awl-compact-trigger")));
    await screen.findByTestId("awl-compact-error");

    fireEvent.click(screen.getByTestId("awl-compact-change"));
    expect(await screen.findByRole("dialog")).toBeTruthy();
  });
});
