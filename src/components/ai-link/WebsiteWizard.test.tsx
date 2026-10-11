/// <reference types="bun-types" />
// The step-by-step wizard under each AI: step 1 makes the person's PROJEXA code (level 1, 30 days, labelled with the AI), the next steps say where to
// click, and the last button checks whether the AI really used the code. Real: the component and the diagnosis. Faked: the work-link client.
// Falsifiability: skip the mint in make(), or answer "connected" without comparing times, and these fail.
import { GlobalRegistrator } from "@happy-dom/global-registrator";
if (typeof globalThis.document === "undefined") GlobalRegistrator.register();

import { afterEach, describe, expect, mock, test } from "bun:test";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { WebsiteWizard } from "./WebsiteWizard";
import { CONNECT_PROVIDERS } from "./connect-your-ai-providers";
import { AwlError, type AwlClient, type AwlLinkRow } from "@/lib/ai-work-link-core";

afterEach(cleanup);

const LINK = "https://x.supabase.co/functions/v1/ai-work-link/pxa_fakefakefake";
const by = (id: string) => CONNECT_PROVIDERS.find((p) => p.id === id)!;
const NOW = new Date("2026-10-11T12:00:00Z");

function fakeClient(opts: { rows?: AwlLinkRow[] | "throw"; mintError?: Error } = {}) {
  const minted: unknown[] = [];
  const client = {
    mintUserLink: async (input: unknown) => {
      minted.push(input);
      if (opts.mintError) throw opts.mintError;
      return { linkId: "l1", level: 1, expiresAt: "2026-11-10T12:00:00Z", label: "x", project: null, link: LINK, inbox: null, notice: "", shell: false };
    },
    listAllLinks: async () => { if (opts.rows === "throw") throw new Error("offline"); return opts.rows ?? []; },
  } as unknown as AwlClient;
  return { client, minted };
}
const usedRow = (lastUsedAt: string | null): AwlLinkRow => ({
  id: "l1", scope: "user", projectId: "", projectName: null, label: "ChatGPT connection", level: 1,
  createdAt: "2026-10-11T11:59:50Z", expiresAt: "2026-11-10T12:00:00Z", revokedAt: null, lastUsedAt, status: "active",
});

describe("WebsiteWizard", () => {
  test("ChatGPT: honest about plans, then numbered steps in the owner's words, then a check button", () => {
    const { getByTestId, getByText } = render(<WebsiteWizard provider={by("chatgpt")} role="admin" client={fakeClient().client} />);
    expect(getByTestId("wizard-support-chatgpt").textContent).toContain("Depends on your plan and country");
    expect(getByText(/Step 1\. Make your PROJEXA code/)).toBeTruthy();
    expect(getByText(/Step 2\./)).toBeTruthy();
    expect(getByTestId("wizard-chatgpt").textContent).toContain("Developer mode");
    expect(getByTestId("wizard-check")).toBeTruthy();
    expect(getByTestId("wizard-if-missing").textContent).toContain("If you cannot find it");
  });

  test("step 1 makes a level 1, 30-day code labelled with the AI and shows the whole address", async () => {
    const { client, minted } = fakeClient();
    const { getByTestId, findByTestId } = render(<WebsiteWizard provider={by("grok")} role="member" client={client} now={() => NOW} />);
    fireEvent.click(getByTestId("wizard-make"));
    const code = await findByTestId("wizard-code");
    expect((code.querySelector("input") as HTMLInputElement).value).toBe(LINK);
    expect(minted).toEqual([{ days: 30, level: 1, label: "Grok connection" }]);
  });

  test("a refused code shows the service's plain words, and the button is still there to try again", async () => {
    const { client } = fakeClient({ mintError: new AwlError("You have made too many links. Try again later.", 429, "MINT_CAP_HOUR") });
    const { getByTestId, findByRole } = render(<WebsiteWizard provider={by("claude")} role="member" client={client} />);
    fireEvent.click(getByTestId("wizard-make"));
    expect((await findByRole("alert")).textContent).toContain("too many links");
    expect(getByTestId("wizard-make")).toBeTruthy();
  });

  test("check: the AI has NOT used the code yet -> not yet, with that AI's usual mistakes", async () => {
    const { client } = fakeClient({ rows: [usedRow(null)] });
    const { getByTestId, findByTestId } = render(<WebsiteWizard provider={by("chatgpt")} role="admin" client={client} now={() => NOW} />);
    fireEvent.click(getByTestId("wizard-make"));
    await findByTestId("wizard-code");
    fireEvent.click(getByTestId("wizard-check"));
    const d = await findByTestId("wizard-diagnosis");
    expect(d.getAttribute("data-state")).toBe("waiting");
    expect(getByTestId("wizard-mistakes").textContent).toContain("Developer mode was not switched on");
    expect(getByTestId("wizard-mistakes").textContent).toContain("No authentication");
  });

  test("check: the AI used the code after it was made -> connected", async () => {
    const { client } = fakeClient({ rows: [usedRow("2026-10-11T11:59:58Z")] });
    const { getByTestId, findByTestId } = render(<WebsiteWizard provider={by("chatgpt")} role="admin" client={client} now={() => NOW} />);
    fireEvent.click(getByTestId("wizard-make"));
    await findByTestId("wizard-code");
    fireEvent.click(getByTestId("wizard-check"));
    const d = await findByTestId("wizard-diagnosis");
    expect(d.getAttribute("data-state")).toBe("connected");
    expect(d.textContent).toContain("Connected. ChatGPT used PROJEXA just now.");
  });

  test("check with no internet: says so instead of guessing", async () => {
    const { client } = fakeClient({ rows: "throw" });
    const { getByTestId, findByTestId } = render(<WebsiteWizard provider={by("gemini")} role="admin" client={client} />);
    fireEvent.click(getByTestId("wizard-check"));
    expect((await findByTestId("wizard-diagnosis")).getAttribute("data-state")).toBe("unreachable");
  });

  test("a read-only role gets the plain note and no make button", () => {
    const { getByTestId, queryByTestId } = render(<WebsiteWizard provider={by("chatgpt")} role="client_viewer" client={fakeClient().client} />);
    expect(getByTestId("wizard-role-note")).toBeTruthy();
    expect(queryByTestId("wizard-make")).toBeNull();
  });

  test("DeepSeek: no steps for the website, an honest 'cannot' and where to go instead; no make button", () => {
    const { getByTestId, queryByTestId } = render(<WebsiteWizard provider={by("deepseek")} role="admin" client={fakeClient().client} />);
    expect(getByTestId("wizard-support-deepseek").textContent).toContain("Cannot connect from the website");
    expect(queryByTestId("wizard-make")).toBeNull();
    expect(getByTestId("wizard-deepseek").textContent).toContain("key steps in part B");
  });

  test("Copilot: the company-administrator route, still with a code to hand over", () => {
    const { getByTestId } = render(<WebsiteWizard provider={by("copilot")} role="admin" client={fakeClient().client} />);
    expect(getByTestId("wizard-support-copilot").textContent).toContain("Cannot connect from the website");
    expect(getByTestId("wizard-copilot").textContent).toContain("IT administrator");
    expect(getByTestId("wizard-make")).toBeTruthy();
  });

  test("copy: confirms when copied, and explains Ctrl+A / Ctrl+C when the browser refuses", async () => {
    const { client } = fakeClient();
    Object.defineProperty(navigator, "clipboard", { value: { writeText: async () => {} }, configurable: true });
    const first = render(<WebsiteWizard provider={by("chatgpt")} role="admin" client={client} />);
    fireEvent.click(first.getByTestId("wizard-make"));
    await first.findByTestId("wizard-code");
    fireEvent.click(first.getByTestId("wizard-copy"));
    await waitFor(() => expect(first.getByRole("status").textContent).toContain("Copied"));
    cleanup();
    Object.defineProperty(navigator, "clipboard", { value: { writeText: async () => { throw new Error("denied"); } }, configurable: true });
    const second = render(<WebsiteWizard provider={by("chatgpt")} role="admin" client={client} />);
    fireEvent.click(second.getByTestId("wizard-make"));
    await second.findByTestId("wizard-code");
    fireEvent.click(second.getByTestId("wizard-copy"));
    await waitFor(() => expect(second.getByRole("alert").textContent).toContain("Ctrl+A"));
  });
});
