import { GlobalRegistrator } from "@happy-dom/global-registrator";
if (typeof globalThis.document === "undefined") GlobalRegistrator.register();

import { afterEach, describe, expect, test } from "bun:test";
import { cleanup, render } from "@testing-library/react";
import { LocalShellAccount, roleLabel } from "./LocalShellAccount";
import type { ShellData } from "./context";

const base: ShellData = { userId: "u1", name: "Demo CEO", email: "democeo@projexa-ai.com", role: "admin", orgId: "o1", projects: [] };

afterEach(cleanup);

describe("LocalShellAccount", () => {
  test("shows who is signed in, with the role and a sign-out action", () => {
    const { getByTestId, getByText } = render(<LocalShellAccount data={base} />);
    expect(getByTestId("local-shell-person").textContent).toBe("democeo@projexa-ai.com");
    expect(getByText("Administrator")).toBeTruthy();
    expect(getByText("Sign out")).toBeTruthy();
  });

  test("says plainly when no project is copied to this laptop", () => {
    const { getByText } = render(<LocalShellAccount data={base} />);
    expect(getByText("No projects are copied to this laptop for this account.")).toBeTruthy();
  });

  test("counts the projects that are saved", () => {
    const { getByText } = render(<LocalShellAccount data={{ ...base, projects: [{ id: "a", name: "A" }, { id: "b", name: "B" }] }} />);
    expect(getByText("2 projects are saved on this laptop.")).toBeTruthy();
  });

  test("role words are plain", () => {
    expect(roleLabel("team_member")).toBe("Team member");
    expect(roleLabel("site_engineer")).toBe("site engineer");
    expect(roleLabel(null)).toBeNull();
  });
});
