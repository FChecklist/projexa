/// <reference types="bun-types" />
// PROJEXA-BUILD-002 WP-08 (AW-405). The entry points of the AI work link dialog: which role sees a button, which sees a sentence, and what
// each button opens. The service client is a fake; the dialog itself is covered by AiWorkLinkDialog.test.tsx.
import { GlobalRegistrator } from "@happy-dom/global-registrator";
if (typeof globalThis.document === "undefined") GlobalRegistrator.register();

import { afterEach, describe, expect, test } from "bun:test";
// dynamic: `screen` binds to document.body when the module loads, which must be after happy-dom is registered above
const { act, cleanup, fireEvent, render, screen } = await import("@testing-library/react");
// dynamic for the same reason: Radix decides whether layout effects exist when it is first loaded (a document must be there already)
const { AiWorkLinkButtons } = await import("./AiWorkLinkButtons");
import { AI_WORK_LINK_ROLE_NOTE } from "@/lib/ai-work-link-access";
import type { AwlClient } from "@/lib/ai-work-link-client";

const PROJECT = { id: "p1", name: "Tower A" };

function fakeClient(): AwlClient & { asked: string[] } {
  const asked: string[] = [];
  return {
    asked,
    async warning(projectId, level) {
      asked.push(`warning ${projectId} ${level}`);
      return { projectId, projectName: "Tower A", sentence: "SERVER SENTENCE", level, lines: 0, tasks: 0, people: 1, moneyVisible: false, writesEnabled: true, maxLevel: 1 };
    },
    async mint() {
      throw new Error("not used here");
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

afterEach(cleanup);

describe("who sees what", () => {
  test("a role at or above member sees the buttons and no explanation", () => {
    for (const role of ["owner", "admin", "pm", "site_engineer", "member"]) {
      const view = render(<AiWorkLinkButtons role={role} project={PROJECT} showNewProject client={fakeClient()} />);
      expect(screen.getByTestId("ai-work-link-open")).toBeTruthy();
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
    expect(screen.getByTestId("ai-work-link-open")).toBeTruthy();
    expect(screen.queryByTestId("ai-new-project-open")).toBeNull();
  });
});

describe("what each button opens", () => {
  test("AI work link opens the dialog for the project on screen and asks for its warning", async () => {
    const client = fakeClient();
    render(<AiWorkLinkButtons role="owner" project={PROJECT} showNewProject client={client} />);
    await act(async () => void fireEvent.click(screen.getByTestId("ai-work-link-open")));
    expect(await screen.findByRole("dialog")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "AI work link for Tower A" })).toBeTruthy();
    expect(await screen.findByText("SERVER SENTENCE")).toBeTruthy();
    expect(client.asked).toContain("warning p1 0");
    expect(client.asked).toContain("links p1");
  });

  test("with no project selected the button is disabled and says why", () => {
    render(<AiWorkLinkButtons role="owner" project={null} showNewProject client={fakeClient()} />);
    const open = screen.getByTestId("ai-work-link-open") as HTMLButtonElement;
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
  });
});
