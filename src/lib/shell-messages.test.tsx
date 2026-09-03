/// <reference types="bun-types" />
// R67 WS-C (C-14) -- THE SHELL MESSAGE REGION.
//
// C-14's acceptance is "push a saved message, simulate a router push, the
// region still contains it; a second navigation clears it". That is exactly
// what the navigation half below asserts -- through the provider, driven by a
// mocked usePathname, so the rule is proven where it actually lives rather
// than only in the pure helper underneath it.
import { GlobalRegistrator } from "@happy-dom/global-registrator";
// Registering twice in one process throws, and `bun test` runs every file in
// ONE process -- same guard as every other happy-dom suite in this repo.
if (typeof globalThis.document === "undefined") GlobalRegistrator.register();

import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { act, cleanup, fireEvent, render } from "@testing-library/react";

// The provider reads usePathname() to know a navigation happened. Driven by
// hand here so a "navigation" is one line and needs no router.
let pathname = "/permits/new";
mock.module("next/navigation", () => ({ usePathname: () => pathname }));

import {
  MAX_SHELL_MESSAGES,
  ShellMessageRegion,
  ShellMessagesProvider,
  advanceNavigation,
  appendMessage,
  groupMessages,
  parseMessages,
  removeMessage,
  savedText,
  serialiseMessages,
  serviceUnavailableText,
  useShellMessages,
  type ShellMessage,
} from "./shell-messages";

afterEach(cleanup);
beforeEach(() => {
  pathname = "/permits/new";
  try {
    sessionStorage.clear();
  } catch {}
});

function message(over: Partial<ShellMessage> = {}): ShellMessage {
  return { id: "m1", kind: "saved", text: "Saved — Permit P-12", at: 1_756_800_000_000, navs: 0, ...over };
}

describe("the sentence", () => {
  test("C-14's own shape", () => {
    expect(savedText("Permit", "P-12")).toBe("Saved — Permit P-12");
    expect(savedText("Worker", "Rakesh Kumar")).toBe("Saved — Worker Rakesh Kumar");
  });

  test("with no id it still says what was saved rather than trailing a space", () => {
    expect(savedText("Permit", null)).toBe("Saved — Permit");
    expect(savedText("Permit", "   ")).toBe("Saved — Permit");
  });

  test("C-13's system line carries the TIME, which is the useful half", () => {
    const at = new Date(2026, 8, 3, 10, 42).getTime();
    expect(serviceUnavailableText(at)).toBe("The service was unavailable at 10:42");
  });
});

describe("the list", () => {
  test("newest last, so the region reads in the order things happened", () => {
    const list = appendMessage(appendMessage([], message({ id: "a" })), message({ id: "b" }));
    expect(list.map((m) => m.id)).toEqual(["a", "b"]);
  });

  test("it is a message region, not a log -- the oldest fall off", () => {
    let list: ShellMessage[] = [];
    for (let i = 0; i < MAX_SHELL_MESSAGES + 3; i++) list = appendMessage(list, message({ id: `m${i}` }));
    expect(list).toHaveLength(MAX_SHELL_MESSAGES);
    expect(list[0].id).toBe(`m${3}`);
  });

  test("pushing the same id twice replaces rather than duplicates", () => {
    const list = appendMessage(appendMessage([], message({ id: "a" })), message({ id: "a", text: "changed" }));
    expect(list).toHaveLength(1);
    expect(list[0].text).toBe("changed");
  });

  test("dismiss removes exactly one", () => {
    const list = [message({ id: "a" }), message({ id: "b" })];
    expect(removeMessage(list, "a").map((m) => m.id)).toEqual(["b"]);
  });
});

describe("it survives exactly one navigation", () => {
  test("the navigation the save itself caused keeps it", () => {
    const after = advanceNavigation([message()]);
    expect(after).toHaveLength(1);
    expect(after[0].navs).toBe(1);
  });

  test("the next one clears it", () => {
    expect(advanceNavigation(advanceNavigation([message()]))).toEqual([]);
  });
});

describe("identical kinds group with a count", () => {
  test("two saves read as '2 saved'", () => {
    const groups = groupMessages([message({ id: "a" }), message({ id: "b" })]);
    expect(groups).toHaveLength(1);
    expect(groups[0].label).toBe("2 saved");
    expect(groups[0].messages).toHaveLength(2);
  });

  test("one of a kind carries no count -- '1 saved' is noise", () => {
    expect(groupMessages([message()])[0].label).toBeNull();
  });

  test("different kinds stay apart, in the order they arrived", () => {
    const groups = groupMessages([
      message({ id: "e", kind: "error", text: "It failed" }),
      message({ id: "a" }),
      message({ id: "b" }),
    ]);
    expect(groups.map((g) => g.kind)).toEqual(["error", "saved"]);
    expect(groups[1].label).toBe("2 saved");
  });
});

describe("the stored blob is untrusted input", () => {
  test("a round trip keeps everything that can be stored", () => {
    const list = [message({ href: "/permits/12" })];
    const back = parseMessages(serialiseMessages(list));
    expect(back[0].text).toBe("Saved — Permit P-12");
    expect(back[0].href).toBe("/permits/12");
    expect(back[0].navs).toBe(0);
  });

  test("a retry is deliberately NOT persisted -- it belongs to the page that made it", () => {
    const list = [message({ kind: "error", retry: () => {} })];
    expect(parseMessages(serialiseMessages(list))[0].retry).toBeUndefined();
  });

  test("garbage, a wrong shape and an unknown kind all produce an empty region, never a crash", () => {
    expect(parseMessages("not json")).toEqual([]);
    expect(parseMessages(JSON.stringify({ nope: true }))).toEqual([]);
    expect(parseMessages(JSON.stringify([{ id: "a", kind: "explode", text: "x" }]))).toEqual([]);
    expect(parseMessages(JSON.stringify([{ id: "a", kind: "saved", text: "" }]))).toEqual([]);
    expect(parseMessages(null)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// C-14's acceptance, through the real provider.
// ---------------------------------------------------------------------------

function Harness({ onOpen }: { onOpen?: (href: string) => void }) {
  const { push } = useShellMessages();
  return (
    <>
      <button type="button" onClick={() => push({ kind: "saved", text: "Saved — Permit P-12", href: "/permits/12" })}>
        save
      </button>
      <ShellMessageRegion onOpen={onOpen} />
    </>
  );
}

describe("the region, driven by the provider", () => {
  test("a save survives the navigation it causes, and the next one clears it", () => {
    const view = render(
      <ShellMessagesProvider>
        <Harness />
      </ShellMessagesProvider>
    );

    act(() => {
      fireEvent.click(view.getByText("save"));
    });
    expect(view.queryByText("Saved — Permit P-12")).toBeTruthy();

    // The navigation the save itself caused.
    pathname = "/permits/12";
    view.rerender(
      <ShellMessagesProvider>
        <Harness />
      </ShellMessagesProvider>
    );
    expect(view.queryByText("Saved — Permit P-12")).toBeTruthy();

    // The user moving on.
    pathname = "/dashboard";
    view.rerender(
      <ShellMessagesProvider>
        <Harness />
      </ShellMessagesProvider>
    );
    expect(view.queryByText("Saved — Permit P-12")).toBeNull();
  });

  test("the Open control carries the href the caller gave", () => {
    const opened: string[] = [];
    const view = render(
      <ShellMessagesProvider>
        <Harness onOpen={(h) => opened.push(h)} />
      </ShellMessagesProvider>
    );
    act(() => {
      fireEvent.click(view.getByText("save"));
    });
    fireEvent.click(view.getByLabelText("Open: Saved — Permit P-12"));
    expect(opened).toEqual(["/permits/12"]);
  });

  test("Dismiss removes it before any navigation", () => {
    const view = render(
      <ShellMessagesProvider>
        <Harness />
      </ShellMessagesProvider>
    );
    act(() => {
      fireEvent.click(view.getByText("save"));
    });
    fireEvent.click(view.getByLabelText("Dismiss: Saved — Permit P-12"));
    expect(view.queryByText("Saved — Permit P-12")).toBeNull();
  });

  test("with nothing to say the region renders NOTHING -- an empty bar costs the composer real height", () => {
    const view = render(
      <ShellMessagesProvider>
        <ShellMessageRegion />
      </ShellMessagesProvider>
    );
    expect(view.container.querySelector("[role='status']")).toBeNull();
  });
});
