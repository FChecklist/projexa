import { GlobalRegistrator } from "@happy-dom/global-registrator";
if (typeof globalThis.document === "undefined") GlobalRegistrator.register();

import { afterEach, expect, test } from "bun:test";
const { act, cleanup, fireEvent, render, screen } = await import("@testing-library/react");
const { LocalShellAiLink, LOCAL_SHELL_AI_LINK_OFFLINE_NOTE } = await import("./LocalShellAiLink");
import type { AwlClient } from "@/lib/ai-work-link-client";

// The local (installed-laptop) shell header carries the AI work link, reusing the one-click AiWorkLinkCompact.
const PROJECT = { id: "p1", name: "Tower A" };
const LINK = "https://example.supabase.co/functions/v1/ai-work-link/pxa_token";

function fakeClient() {
  const minted: unknown[] = [];
  const client = {
    async mint(input: { projectId: string; level: number; days: number }) {
      minted.push(input);
      return { linkId: "l1", level: input.level, expiresAt: "x", label: null, project: { id: input.projectId, name: "Tower A" }, link: LINK, inbox: null, notice: "", shell: false };
    },
  } as unknown as AwlClient;
  return { client, minted };
}

afterEach(() => cleanup());

test("online with a selected project, the control renders and a click mints via the existing path and copies the prompt", async () => {
  const written: string[] = [];
  Object.defineProperty(globalThis.navigator, "clipboard", { configurable: true, value: { writeText: async (s: string) => void written.push(s) } });
  const { client, minted } = fakeClient();
  render(<LocalShellAiLink role="pm" project={PROJECT} online client={client} />);
  const trigger = screen.getByTestId("awl-compact-trigger") as HTMLButtonElement;
  expect(trigger.disabled).toBe(false);
  expect(trigger.textContent).toContain("AI prompt - paste in any AI");
  await act(async () => { fireEvent.click(trigger); });
  expect(minted).toEqual([{ projectId: "p1", level: 1, days: 7 }]);
  expect(written.length).toBe(1);
  expect(written[0]).toContain(LINK);
});

test("offline, the control is disabled with the calm explanation and never mints", () => {
  const { client, minted } = fakeClient();
  render(<LocalShellAiLink role="pm" project={PROJECT} online={false} client={client} />);
  const button = screen.getByTestId("local-shell-ai-link-offline-button") as HTMLButtonElement;
  expect(button.disabled).toBe(true);
  expect(screen.getByTestId("local-shell-ai-link-offline-note").textContent).toBe(LOCAL_SHELL_AI_LINK_OFFLINE_NOTE);
  expect(LOCAL_SHELL_AI_LINK_OFFLINE_NOTE).toContain("needs the internet");
  expect((screen.getByTestId("local-shell-ai-card-offline-button") as HTMLButtonElement).disabled).toBe(true);
  expect(screen.queryByTestId("awl-card-trigger")).toBeNull();
  fireEvent.click(button);
  expect(minted).toEqual([]);
  expect(screen.queryByTestId("awl-compact-trigger")).toBeNull();
});

test("with no selected project nothing is shown", () => {
  const { container } = render(<LocalShellAiLink role="pm" project={null} online />);
  expect(container.innerHTML).toBe("");
});
