/// <reference types="bun-types" />
import { GlobalRegistrator } from "@happy-dom/global-registrator";
if (typeof globalThis.document === "undefined") GlobalRegistrator.register();

import { afterEach, describe, expect, mock, test } from "bun:test";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { ReleaseUpdateNotice } from "./ReleaseUpdateNotice";
import { announceReleaseUpdated } from "@/lib/local-first/release/shell-handoff";

afterEach(() => cleanup());

describe("ReleaseUpdateNotice (R-C15)", () => {
  test("says nothing until a newer release has been installed", () => {
    const { queryByTestId } = render(<ReleaseUpdateNotice />);
    expect(queryByTestId("release-update-notice")).toBeNull();
  });
  test("after an update it says so in words with the version, and Reload runs the reload", () => {
    const reload = mock(() => {});
    const { getByTestId } = render(<ReleaseUpdateNotice reload={reload} />);
    act(() => announceReleaseUpdated("2026.10.22-003"));
    expect(getByTestId("release-update-notice").textContent).toContain("A newer version of PROJEXA (2026.10.22-003) was installed on this laptop");
    fireEvent.click(getByTestId("release-update-reload"));
    expect(reload).toHaveBeenCalledTimes(1);
  });
});
