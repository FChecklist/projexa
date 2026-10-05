import { GlobalRegistrator } from "@happy-dom/global-registrator";
if (typeof globalThis.document === "undefined") GlobalRegistrator.register();

import { afterEach, describe, expect, test } from "bun:test";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { LocalShellAiBar } from "./LocalShellAiBar";
import type { AwlClient } from "@/lib/ai-work-link-client";

const LINK = "https://x.supabase.co/functions/v1/ai-work-link/pxa_test";
const client = { mintUserLink: async () => ({ link: LINK }) } as unknown as AwlClient;

afterEach(cleanup);

describe("LocalShellAiBar", () => {
  test("online with NO project: both buttons are there and enabled", () => {
    const { getByTestId } = render(<LocalShellAiBar role="admin" project={null} online client={client} />);
    expect((getByTestId("awl-compact-trigger") as HTMLButtonElement).disabled).toBe(false);
    expect(getByTestId("awl-compact-trigger").textContent).toContain("Copy AI prompt");
    expect((getByTestId("local-shell-connectors") as HTMLButtonElement).disabled).toBe(false);
  });

  test("Connectors makes the link once and shows the three addresses", async () => {
    const { getByTestId } = render(<LocalShellAiBar role="admin" project={null} online client={client} />);
    fireEvent.click(getByTestId("local-shell-connectors"));
    await waitFor(() => expect(getByTestId("awl-connect-value-openapi").textContent).toBe(`${LINK}/openapi.json`));
    expect(getByTestId("awl-connect-value-swagger").textContent).toBe(`${LINK}/swagger.json`);
  });

  test("offline: both buttons are disabled with the reason", () => {
    const { getByTestId } = render(<LocalShellAiBar role="admin" project={null} online={false} client={client} />);
    expect((getByTestId("local-shell-ai-link-offline-button") as HTMLButtonElement).disabled).toBe(true);
    expect((getByTestId("local-shell-connectors-offline") as HTMLButtonElement).disabled).toBe(true);
  });
});
