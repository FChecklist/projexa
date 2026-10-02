import { GlobalRegistrator } from "@happy-dom/global-registrator";

if (typeof globalThis.document === "undefined") GlobalRegistrator.register();

import { afterEach, describe, expect, test } from "bun:test";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { ShellSignOut } from "./ShellSignOut";

// lf-e12 (found in a real browser, e2e/lf-lifecycle-session.spec.ts): the on-laptop shell -- which every app page IS once a release is
// installed -- had no way to sign out. It now offers the AccountMenu's two choices; this pins what each does.

afterEach(cleanup);

describe("the shell's sign-out", () => {
  test("Sign Out keeps the copy (deleteLocalCopy false) and goes to the sign-in page", async () => {
    const calls: boolean[] = [];
    let wentToLogin = 0;
    const { getByTestId } = render(<ShellSignOut signOut={async (d) => { calls.push(d); return { notice: null }; }} goToLogin={() => { wentToLogin += 1; }} />);
    expect(getByTestId("local-shell-sign-out").textContent).toBe("Sign Out");
    fireEvent.click(getByTestId("local-shell-sign-out"));
    await waitFor(() => expect(wentToLogin).toBe(1));
    expect(calls).toEqual([false]);
  });

  test("the delete choice asks to delete this laptop's copy", async () => {
    const calls: boolean[] = [];
    const { getByTestId } = render(<ShellSignOut signOut={async (d) => { calls.push(d); return { notice: null }; }} goToLogin={() => {}} />);
    expect(getByTestId("local-shell-sign-out-delete").textContent).toBe("Sign out and delete this laptop's copy");
    fireEvent.click(getByTestId("local-shell-sign-out-delete"));
    await waitFor(() => expect(calls).toEqual([true]));
  });

  test("when the sign-out has something to say (edits kept), the words stay on screen instead of a navigation that would hide them", async () => {
    let wentToLogin = 0;
    const words = "1 change you made on this laptop has not reached the server yet, so this laptop kept your workspace.";
    const { getByTestId, findByRole } = render(<ShellSignOut signOut={async () => ({ notice: words })} goToLogin={() => { wentToLogin += 1; }} />);
    fireEvent.click(getByTestId("local-shell-sign-out-delete"));
    expect((await findByRole("status")).textContent).toBe(words);
    expect(wentToLogin).toBe(0);
  });
});
