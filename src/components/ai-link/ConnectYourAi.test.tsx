/// <reference types="bun-types" />
// "Connect your AI": the person sees all three ways (access link and prompt, MCP, API) in plain steps, and the one button
// that makes the access link. Opens from a real click; the steps mention the exact things an outside AI asks for.
import { GlobalRegistrator } from "@happy-dom/global-registrator";
if (typeof globalThis.document === "undefined") GlobalRegistrator.register();

import { afterEach, describe, expect, test } from "bun:test";
import { cleanup, render, within } from "@testing-library/react";
import ConnectYourAi, { CONNECT_YOUR_AI_STEPS, ConnectGuideBody } from "./ConnectYourAi";

afterEach(cleanup);
const q = () => within(document.body);

describe("Connect your AI", () => {
  test("the three ways are defined: access link and prompt, MCP, API", () => {
    expect(CONNECT_YOUR_AI_STEPS.map((s) => s.id)).toEqual(["prompt", "mcp", "api"]);
    const text = JSON.stringify(CONNECT_YOUR_AI_STEPS);
    expect(text).toContain("Add custom connector");
    expect(text).toContain("OpenAPI");
    expect(text).toContain("paste");
  });

  test("the guide shows every way, the make-link button and the safety line", () => {
    render(<ConnectGuideBody role="member" />);
    const d = q();
    expect(d.getByText(/Access link and prompt/)).toBeTruthy();
    expect(d.getByText(/MCP connector/)).toBeTruthy();
    expect(d.getByText(/API \(custom GPT/)).toBeTruthy();
    expect(d.getByText("Make my access link and copy the AI prompt")).toBeTruthy();
    expect(document.body.textContent).toContain("Your link is your password");
  });

  test("the opener is a real button named for what it does", () => {
    render(<ConnectYourAi role="member" />);
    expect(q().getByRole("button", { name: /Connect your AI/ })).toBeTruthy();
    expect(q().queryByText("Connect your AI to PROJEXA")).toBeNull();
  });
});
