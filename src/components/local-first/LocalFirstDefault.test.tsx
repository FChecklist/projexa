import { GlobalRegistrator } from "@happy-dom/global-registrator";
// Registering twice in one process throws, and `bun test` runs every file in ONE process.
if (typeof globalThis.document === "undefined") GlobalRegistrator.register();

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { useEffect } from "react";
import { cleanup, render } from "@testing-library/react";
import { LocalFirstDefault } from "./LocalFirstDefault";
import { LOCAL_FIRST_FLAG, LOCAL_FIRST_OPT_OUT, isLocalFirstEnabled } from "@/lib/local-first/local-reader";

// The layout mounts <LocalFirstDefault/> first; WorkspacePrepare, M24Shell and the outbox hooks each read the flag in THEIR OWN mount effect. The default must
// already be in place when those effects run, or the first page load of a person would still be flag-off (the bug the offline e2e found).
function Reader({ seen }: { seen: boolean[] }) {
  useEffect(() => {
    seen.push(isLocalFirstEnabled());
  }, [seen]);
  return null;
}

beforeEach(() => localStorage.clear());
afterEach(cleanup);

describe("<LocalFirstDefault/> in the signed-in layout", () => {
  test("renders nothing, and a sibling's mount effect already sees the flag ON on the very first page load", () => {
    const seen: boolean[] = [];
    const { container } = render(
      <>
        <LocalFirstDefault />
        <Reader seen={seen} />
      </>
    );
    expect(container.innerHTML).toBe("");
    expect(seen).toEqual([true]);
    expect(localStorage.getItem(LOCAL_FIRST_FLAG)).toBe("1");
  });

  test("a person's own opt-out is respected: the sibling sees the flag OFF and nothing is written", () => {
    localStorage.setItem(LOCAL_FIRST_OPT_OUT, "1");
    const seen: boolean[] = [];
    render(
      <>
        <LocalFirstDefault />
        <Reader seen={seen} />
      </>
    );
    expect(seen).toEqual([false]);
    expect(localStorage.getItem(LOCAL_FIRST_FLAG)).toBeNull();
  });

  test("without the component the same sibling sees the flag OFF (the state the deploy would have shipped)", () => {
    const seen: boolean[] = [];
    render(<Reader seen={seen} />);
    expect(seen).toEqual([false]);
  });
});
