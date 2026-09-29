/// <reference types="bun-types" />
// PROJEXA-BUILD-002 WP-08 (AW-405). The entry points of the AI work link feature: which role sees which buttons, which sees a sentence.
// The service client is a fake; the main trigger's own one-click mint/copy/confirm behaviour is covered by AiWorkLinkCompact.test.tsx
// (this file only proves AiWorkLinkButtons composes it correctly), and the dialog itself by AiWorkLinkDialog.test.tsx.
//
// UPDATED 2026-09-29 (WO ai-work-link-ui-and-projects-tab): "AI work link" opened AiWorkLinkDialog directly on every click before this
// change -- it is now AiWorkLinkCompact's one-click trigger (testid awl-compact-trigger, no dialog on click) renamed to "AI work link
// for this project", so the "what each button opens" tests below were rewritten for the new behaviour rather than deleted; every other
// test (role gating, showNewProject, the still-dialog-based "New project with my AI") is unchanged in intent. `showMainTrigger` is new
// (ProjectsListClient.tsx's "New project with my AI" header button needs the main trigger hidden -- no single project on a list screen).
import { GlobalRegistrator } from "@happy-dom/global-registrator";
if (typeof globalThis.document === "undefined") GlobalRegistrator.register();

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
// dynamic: `screen` binds to document.body when the module loads, which must be after happy-dom is registered above
const { act, cleanup, fireEvent, render, screen } = await import("@testing-library/react");
// dynamic for the same reason: Radix decides whether layout effects exist when it is first loaded (a document must be there already)
const { AiWorkLinkButtons } = await import("./AiWorkLinkButtons");
import { AI_WORK_LINK_ROLE_NOTE } from "@/lib/ai-work-link-access";
import type { AwlClient } from "@/lib/ai-work-link-client";

const PROJECT = { id: "p1", name: "Tower A" };

function fakeClient(): AwlClient & { minted: unknown[]; asked: string[] } {
  const asked: string[] = [];
  const minted: unknown[] = [];
  return {
    asked,
    minted,
    async warning(projectId, level) {
      asked.push(`warning ${projectId} ${level}`);
      return { projectId, projectName: "Tower A", sentence: "SERVER SENTENCE", level, lines: 0, tasks: 0, people: 1, moneyVisible: false, writesEnabled: true, maxLevel: 1 };
    },
    async mint(input) {
      minted.push(input);
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
    async links(projectId) {
      asked.push(`links ${projectId}`);
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
  test("a role at or above member sees both buttons and no explanation", () => {
    for (const role of ["owner", "admin", "pm", "site_engineer", "member"]) {
      const view = render(<AiWorkLinkButtons role={role} project={PROJECT} showNewProject client={fakeClient()} />);
      expect(screen.getByTestId("awl-compact-trigger")).toBeTruthy();
      expect(screen.getByTestId("ai-new-project-open")).toBeTruthy();
      expect(screen.queryByTestId("ai-work-link-role-note")).toBeNull();
      view.unmount();
    }
  });

  test("a lower role (client_viewer) sees no button and a plain sentence", () => {
    render(<AiWorkLinkButtons role="client_viewer" project={PROJECT} showNewProject client={fakeClient()} />);
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.getByTestId("ai-work-link-role-note").textContent).toBe(AI_WORK_LINK_ROLE_NOTE);
  });

  test("while the role is not known nothing is drawn, so a button never flashes up and goes away", () => {
    const view = render(<AiWorkLinkButtons role={null} project={PROJECT} showNewProject client={fakeClient()} />);
    expect(view.container.innerHTML).toBe("");
  });

  test("New project with my AI is only there when the screen asks for it", () => {
    render(<AiWorkLinkButtons role="owner" project={PROJECT} client={fakeClient()} />);
    expect(screen.getByTestId("awl-compact-trigger")).toBeTruthy();
    expect(screen.queryByTestId("ai-new-project-open")).toBeNull();
  });

  test("showMainTrigger=false hides the main trigger, leaving only 'New project with my AI' (ProjectsListClient.tsx's own use)", () => {
    render(<AiWorkLinkButtons role="owner" project={null} showNewProject showMainTrigger={false} client={fakeClient()} />);
    expect(screen.queryByTestId("awl-compact-trigger")).toBeNull();
    expect(screen.getByTestId("ai-new-project-open")).toBeTruthy();
  });
});

describe("what each button does", () => {
  test("'AI work link for this project' mints one click, with no dialog, for the project on screen", async () => {
    const client = fakeClient();
    render(<AiWorkLinkButtons role="owner" project={PROJECT} showNewProject client={client} />);
    const trigger = screen.getByTestId("awl-compact-trigger");
    expect(trigger.textContent).toContain("AI work link for this project");

    await act(async () => void fireEvent.click(trigger));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(client.minted).toEqual([{ projectId: "p1", level: 0, days: 7 }]);
    expect(clipboard).toEqual(["https://example.supabase.co/functions/v1/ai-work-link/pxa_token"]);
    expect(await screen.findByTestId("awl-compact-confirm")).toBeTruthy();
  });

  test("'AI work link for this project' opens the real dialog (with its own warning fetch) via 'Change access or expiry'", async () => {
    const client = fakeClient();
    render(<AiWorkLinkButtons role="owner" project={PROJECT} showNewProject client={client} />);
    await act(async () => void fireEvent.click(screen.getByTestId("awl-compact-trigger")));
    await act(async () => void fireEvent.click(await screen.findByTestId("awl-compact-change")));

    expect(await screen.findByRole("dialog")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "AI work link for Tower A" })).toBeTruthy();
    expect(await screen.findByText("SERVER SENTENCE")).toBeTruthy();
    expect(client.asked).toContain("warning p1 0");
    expect(client.asked).toContain("links p1");
  });

  test("with no project selected the main trigger is disabled and says why", () => {
    render(<AiWorkLinkButtons role="owner" project={null} showNewProject client={fakeClient()} />);
    const open = screen.getByTestId("awl-compact-trigger") as HTMLButtonElement;
    expect(open.disabled).toBe(true);
    expect(open.title).toBe("Select a project first");
    // creating a project needs no project
    expect((screen.getByTestId("ai-new-project-open") as HTMLButtonElement).disabled).toBe(false);
  });

  test("New project with my AI opens the dialog in its new-project mode and asks for nothing until Create", async () => {
    const client = fakeClient();
    render(<AiWorkLinkButtons role="member" project={null} showNewProject client={client} />);
    await act(async () => void fireEvent.click(screen.getByTestId("ai-new-project-open")));
    expect(await screen.findByRole("heading", { name: "New project with my AI" })).toBeTruthy();
    expect(screen.getByTestId("awl-create-project")).toBeTruthy();
    expect(client.asked).toEqual([]);
    expect(client.minted).toEqual([]);
  });
});
