import { GlobalRegistrator } from "@happy-dom/global-registrator";
if (typeof globalThis.document === "undefined") GlobalRegistrator.register();

import { afterEach, describe, expect, test } from "bun:test";
import { cleanup, render } from "@testing-library/react";
import { AI_BAR_CAPTION, AI_BAR_OFFLINE_CAPTION, LocalShellAiBar } from "./LocalShellAiBar";

afterEach(cleanup);

// Owner 2026-10-11: ONE AI control in the laptop shell, "+ Connect to AI". The copy-prompt and Connectors buttons are gone from this bar.
describe("LocalShellAiBar", () => {
  test("online: the only AI control is + Connect to AI; no copy-prompt button, no Connectors button", () => {
    const { getByTestId, queryByTestId } = render(<LocalShellAiBar role="admin" project={null} online />);
    expect(getByTestId("connect-your-ai-open").textContent).toContain("+ Connect to AI");
    expect(getByTestId("local-shell-ai-caption").textContent).toBe(AI_BAR_CAPTION);
    expect(queryByTestId("awl-compact-trigger")).toBeNull();
    expect(queryByTestId("local-shell-connectors")).toBeNull();
    expect(document.body.textContent).not.toContain("Copy AI prompt");
  });

  test("offline: the button is still there and says it needs internet; the rest of the shell is not blocked by it", () => {
    const { getByTestId } = render(<LocalShellAiBar role="member" project={null} online={false} />);
    expect(getByTestId("local-shell-ai-bar").getAttribute("data-online")).toBe("0");
    expect((getByTestId("connect-your-ai-open") as HTMLButtonElement).disabled).toBe(false);
    expect(getByTestId("local-shell-ai-caption").textContent).toBe(AI_BAR_OFFLINE_CAPTION);
  });

  test("a read-only role sees a plain sentence instead of the button", () => {
    const { getByTestId, queryByTestId } = render(<LocalShellAiBar role="client_viewer" project={null} online />);
    expect(getByTestId("local-shell-ai-role-note").textContent?.length).toBeGreaterThan(10);
    expect(queryByTestId("connect-your-ai-open")).toBeNull();
  });
});
