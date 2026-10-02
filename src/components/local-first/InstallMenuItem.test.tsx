import { GlobalRegistrator } from "@happy-dom/global-registrator";
// Registering twice in one process throws, and `bun test` runs every file in ONE process.
if (typeof globalThis.document === "undefined") GlobalRegistrator.register();

import { afterEach, describe, expect, mock, test } from "bun:test";
import { act, cleanup, render } from "@testing-library/react";

// A Radix dropdown cannot open in happy-dom (it needs layout), so the item is drawn as a plain element. The real module is SPREAD first:
// replacing a module with a subset breaks every other export for the rest of the process (see CLAUDE.md, the mock.module() gotcha).
const real = await import("@/components/ui/dropdown-menu");
mock.module("@/components/ui/dropdown-menu", () => ({
  ...real,
  DropdownMenuItem: ({ children, onClick, ...rest }: { children?: React.ReactNode; onClick?: () => void } & Record<string, unknown>) => (
    <div role="menuitem" onClick={onClick} {...rest}>{children}</div>
  ),
}));
const { sharedInstallPrompt } = await import("@/lib/local-first/persistence");
const { InstallMenuItem } = await import("./InstallMenuItem");

afterEach(cleanup);

describe("the one calm install action in the account menu", () => {
  test("nothing is shown until the browser has offered installation; then ONE menu item, no popup; it is gone after the person answered", async () => {
    const { baseElement, queryByTestId } = render(<InstallMenuItem />);
    expect(queryByTestId("install-pwa") === null).toBe(true);
    expect(baseElement.textContent).toBe("");

    const event = new Event("beforeinstallprompt", { cancelable: true });
    let prompted = 0;
    Object.assign(event, { prompt: async () => { prompted += 1; }, userChoice: Promise.resolve({ outcome: "accepted" }) });
    act(() => { sharedInstallPrompt().adopt(event); });

    const items = baseElement.querySelectorAll('[data-testid="install-pwa"]');
    expect(items.length).toBe(1);
    expect(items[0]!.textContent).toBe("Install PROJEXA on this laptop");
    expect(baseElement.querySelector('[role="dialog"], [role="alertdialog"]') === null).toBe(true);

    await act(async () => { (items[0] as HTMLElement).click(); });
    expect(prompted).toBe(1);
    expect(baseElement.querySelector('[data-testid="install-pwa"]') === null).toBe(true);
  });
});
