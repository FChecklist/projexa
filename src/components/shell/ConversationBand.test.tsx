/// <reference types="bun-types" />
// R67 WS-C (C-09) -- BAND 2 AS A CONVERSATION.
//
// R-218: pressing Send emptied the box and left nothing behind, so "what did
// I just ask for" had no answer on screen. The sentences and the turn log are
// asserted in src/lib/conversation.test.ts; what a render has to prove is:
//
//   1. the user's own line STAYS, beside the answer rather than instead of it;
//   2. "Sending…" appears immediately, so a Send is never met with silence;
//   3. a turn from before a project switch is GREYED and says which project
//      it was for -- rendering it at full strength is how a right sentence
//      gets read against a wrong project;
//   4. a receipt's link opens a screen and nothing else.
import { GlobalRegistrator } from "@happy-dom/global-registrator";
// Registering twice in one process throws, and `bun test` runs every file in
// ONE process -- same guard as every other happy-dom suite in this repo.
if (typeof globalThis.document === "undefined") GlobalRegistrator.register();

import { afterEach, describe, expect, test } from "bun:test";
// The module-level `screen` helper binds to document.body at IMPORT time,
// before GlobalRegistrator has made one, so queries go through render()'s own.
import { cleanup, fireEvent, render } from "@testing-library/react";
import { ConversationBand } from "./ConversationBand";
import type { ConversationTurn } from "@/lib/conversation";

afterEach(cleanup);

const NAMES: Record<string, string> = { p1: "Cedar Heights Villa - Phase 1", p2: "Marina Tower" };
const nameFor = (id: string) => NAMES[id] ?? null;

const SAID: ConversationTurn = {
  kind: "said",
  id: "1",
  at: 1,
  projectId: "p1",
  text: "record 50% progress on excavation",
};

const RECEIPT: ConversationTurn = {
  kind: "receipt",
  id: "2",
  at: 2,
  projectId: "p1",
  text: "Recorded. 50% on R60SK-A, 02 Sep 2026.",
  href: "/work-progress?projectId=p1",
};

describe("the band", () => {
  test("keeps the user's own sentence beside the answer, not instead of it", () => {
    const view = render(
      <ConversationBand
        turns={[SAID, RECEIPT]}
        currentProjectId="p1"
        projectNameById={nameFor}
        sending={false}
        onOpen={() => {}}
      />
    );
    expect(view.getByText("record 50% progress on excavation")).toBeTruthy();
    expect(view.getByText("Recorded. 50% on R60SK-A, 02 Sep 2026.")).toBeTruthy();
  });

  test("answers a Send immediately -- never an empty silent box", () => {
    const view = render(
      <ConversationBand
        turns={[SAID]}
        currentProjectId="p1"
        projectNameById={nameFor}
        sending
        onOpen={() => {}}
      />
    );
    expect(view.getByRole("status").textContent).toBe("Sending…");
  });

  test("the live card is rendered under the turns, not over them", () => {
    const view = render(
      <ConversationBand
        turns={[SAID]}
        currentProjectId="p1"
        projectNameById={nameFor}
        sending={false}
        onOpen={() => {}}
      >
        <p>I read this as: Record Work Progress &gt; New entry</p>
      </ConversationBand>
    );
    expect(view.getByText(/I read this as:/)).toBeTruthy();
    expect(view.getByText("record 50% progress on excavation")).toBeTruthy();
  });
});

describe("a turn from before a project switch", () => {
  test("says which project it was for", () => {
    const view = render(
      <ConversationBand
        turns={[SAID]}
        currentProjectId="p2"
        projectNameById={nameFor}
        sending={false}
        onOpen={() => {}}
      />
    );
    expect(view.getByText("— was for Cedar Heights Villa - Phase 1")).toBeTruthy();
  });

  test("names 'another project' rather than an id when the name is unknown", () => {
    const view = render(
      <ConversationBand
        turns={[{ ...SAID, projectId: "p-gone" }]}
        currentProjectId="p2"
        projectNameById={nameFor}
        sending={false}
        onOpen={() => {}}
      />
    );
    expect(view.getByText("— was for another project")).toBeTruthy();
  });

  test("a turn made with no project selected is never called stale", () => {
    const view = render(
      <ConversationBand
        turns={[{ ...SAID, projectId: null }]}
        currentProjectId="p2"
        projectNameById={nameFor}
        sending={false}
        onOpen={() => {}}
      />
    );
    expect(view.queryByText(/was for/)).toBeNull();
  });
});

describe("a receipt", () => {
  test("opens its object and nothing else", () => {
    const opened: string[] = [];
    const view = render(
      <ConversationBand
        turns={[RECEIPT]}
        currentProjectId="p1"
        projectNameById={nameFor}
        sending={false}
        onOpen={(href) => opened.push(href)}
      />
    );
    fireEvent.click(view.getByRole("button", { name: "Open" }));
    expect(opened).toEqual(["/work-progress?projectId=p1"]);
  });

  test("a gap turn carries its own link label", () => {
    const view = render(
      <ConversationBand
        turns={[
          {
            kind: "gap",
            id: "3",
            at: 3,
            projectId: null,
            text: "Customers can't be created from PROJEXA yet",
            href: "/customers",
            hrefLabel: "Open Customers",
          },
        ]}
        currentProjectId="p1"
        projectNameById={nameFor}
        sending={false}
        onOpen={() => {}}
      />
    );
    expect(view.getByRole("button", { name: "Open Customers" })).toBeTruthy();
  });

  test("can be dismissed, so the band never becomes a wall a user cannot clear", () => {
    const dismissed: string[] = [];
    const view = render(
      <ConversationBand
        turns={[RECEIPT]}
        currentProjectId="p1"
        projectNameById={nameFor}
        sending={false}
        onOpen={() => {}}
        onDismissTurn={(id) => dismissed.push(id)}
      />
    );
    fireEvent.click(view.getByLabelText("Dismiss: Recorded. 50% on R60SK-A, 02 Sep 2026."));
    expect(dismissed).toEqual(["2"]);
  });
});
