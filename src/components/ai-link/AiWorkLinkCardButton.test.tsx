/// <reference types="bun-types" />
// The "no browsing" AI prompt (Audit 37): one self-contained text, the paste card plus the selected project's data, with no token in it.
// The service client and the text fetcher are fakes.
import { GlobalRegistrator } from "@happy-dom/global-registrator";
if (typeof globalThis.document === "undefined") GlobalRegistrator.register();

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
const { act, cleanup, fireEvent, render, screen } = await import("@testing-library/react");
const { AiWorkLinkCardButton, buildCardPrompt, AWL_CARD_DATA_MAX_CHARS, AWL_CARD_LABEL } = await import("./AiWorkLinkCardButton");
import { AwlError, type AwlClient } from "@/lib/ai-work-link-client";

const PROJECT = { id: "p1", name: "Tower A" };
const TOKEN = "pxa_secret_token";
const LINK = `https://example.supabase.co/functions/v1/ai-work-link/${TOKEN}`;
const CARD = "# PROJEXA work link: paste card\n\nThis card holds no address and no token.\n\n```projexa-proposal\n{}\n```";
const DATA = "# PROJEXA data snapshot (no token in it)\n\n## project\n\n```data\n{\"name\":\"Tower A\"}\n```";

function fakeClient(): AwlClient & { minted: unknown[] } {
  const minted: unknown[] = [];
  return {
    minted,
    async mint(input: { projectId: string; level: number; days: number }) {
      minted.push(input);
      return { linkId: "l1", level: input.level, expiresAt: "x", label: null, project: { id: input.projectId, name: "Tower A" }, link: LINK, inbox: null, notice: "", shell: false };
    },
  } as unknown as AwlClient & { minted: unknown[] };
}

function fakeFetch(over: { data?: () => Promise<string>; card?: () => Promise<string> } = {}) {
  const calls: string[] = [];
  const fn = async (link: string, path: string) => {
    calls.push(`${link}${path}`);
    if (path.startsWith("/card-data.md")) return over.data ? over.data() : DATA;
    return over.card ? over.card() : CARD;
  };
  return { fn, calls };
}

let clipboard: string[];
beforeEach(() => {
  clipboard = [];
  Object.defineProperty(globalThis.navigator, "clipboard", { configurable: true, value: { writeText: async (s: string) => void clipboard.push(s) } });
});
afterEach(cleanup);

describe("the no-browsing prompt", () => {
  test("one click copies the card and the project data, with the instruction sentence", async () => {
    const client = fakeClient();
    const f = fakeFetch();
    render(<AiWorkLinkCardButton role="pm" project={PROJECT} client={client} fetchText={f.fn} />);
    const trigger = screen.getByTestId("awl-card-trigger");
    expect(trigger.textContent).toContain(AWL_CARD_LABEL);
    await act(async () => { fireEvent.click(trigger); });
    expect(client.minted).toEqual([{ projectId: "p1", level: 0, days: 7 }]);
    expect(f.calls).toEqual([`${LINK}/card.md`, `${LINK}/card-data.md?kinds=project,tasks,boq_lines`]);
    expect(clipboard.length).toBe(1);
    expect(clipboard[0]).toContain("PROJEXA work link: paste card");
    expect(clipboard[0]).toContain("projexa-proposal");
    expect(clipboard[0]).toContain("Project data: Tower A");
    expect(clipboard[0]).toContain('{"name":"Tower A"}');
    expect(clipboard[0]).toContain("you cannot open links");
  });

  test("the token and the link are not in the copied text, and the link is reused on a second click", async () => {
    const client = fakeClient();
    render(<AiWorkLinkCardButton role="pm" project={PROJECT} client={client} fetchText={fakeFetch().fn} />);
    await act(async () => { fireEvent.click(screen.getByTestId("awl-card-trigger")); });
    await act(async () => { fireEvent.click(screen.getByTestId("awl-card-trigger")); });
    expect(clipboard.length).toBe(2);
    for (const text of clipboard) {
      expect(text).not.toContain(TOKEN);
      expect(text).not.toContain("https://");
    }
    expect(client.minted.length).toBe(1);
  });

  test("when the data cannot be fetched the card is still copied, with a plain note", async () => {
    const f = fakeFetch({ data: async () => { throw new AwlError("down", 500); } });
    render(<AiWorkLinkCardButton role="pm" project={PROJECT} client={fakeClient()} fetchText={f.fn} />);
    await act(async () => { fireEvent.click(screen.getByTestId("awl-card-trigger")); });
    expect(clipboard[0]).toContain("PROJEXA work link: paste card");
    expect(clipboard[0]).toContain("The project data could not be loaded just now");
    expect(clipboard[0]).not.toContain("Project data:");
    expect(screen.getByTestId("awl-card-confirm").textContent).toContain("without the project data");
  });

  test("when the card cannot be fetched nothing is copied and the error is shown", async () => {
    const f = fakeFetch({ card: async () => { throw new AwlError("The AI work link service answered 500 for the card.", 500); } });
    render(<AiWorkLinkCardButton role="pm" project={PROJECT} client={fakeClient()} fetchText={f.fn} />);
    await act(async () => { fireEvent.click(screen.getByTestId("awl-card-trigger")); });
    expect(clipboard).toEqual([]);
    expect(screen.getByTestId("awl-card-error").textContent).toContain("answered 500");
  });

  test("with no project it is disabled; a read-only role sees only the plain note", () => {
    const { unmount } = render(<AiWorkLinkCardButton role="pm" project={null} client={fakeClient()} fetchText={fakeFetch().fn} />);
    expect((screen.getByTestId("awl-card-trigger") as HTMLButtonElement).disabled).toBe(true);
    unmount();
    render(<AiWorkLinkCardButton role="client_viewer" project={PROJECT} client={fakeClient()} fetchText={fakeFetch().fn} />);
    expect(screen.queryByTestId("awl-card-trigger")).toBeNull();
    expect(screen.getByTestId("awl-card-role-note")).toBeTruthy();
  });
});

describe("buildCardPrompt", () => {
  test("long data is cut at a line boundary with a note", () => {
    const data = Array.from({ length: 5000 }, (_, i) => `{"row":${i},"pad":"xxxxxxxxxx"}`).join("\n");
    const text = buildCardPrompt(CARD, data, "Tower A");
    expect(text.length).toBeLessThan(AWL_CARD_DATA_MAX_CHARS + CARD.length + 1000);
    expect(text).toContain("shortened to fit");
    expect(text.split("\n").every((l) => !l.startsWith('{"row"') || l.endsWith("}"))).toBe(true);
  });
});
