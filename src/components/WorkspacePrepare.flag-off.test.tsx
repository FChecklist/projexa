/// <reference types="bun-types" />
// LOCAL-FIRST, flag OFF (package lf-fc, review cost:COST-02 / FLAG-16 / TEST-11): the first copy of a person's projects (the
// replica's whole sync, one request per project x kind) must not run when local-first is off, because nothing reads the copy
// then. Two layers are pinned here:
//   * buildSteps leaves the "projects" step out with the flag off (the reviewer's scratch test flagoff2: 0 sync calls);
//   * the WorkspacePrepare component is inert with the flag off: it does not even ask Supabase who is signed in, shows nothing
//     and starts nothing. A visitor who is not signed in never gets the modal either.
// Control cases with the flag ON show each assertion can fail.
import { GlobalRegistrator } from "@happy-dom/global-registrator";
if (typeof globalThis.document === "undefined") GlobalRegistrator.register();

import { afterEach, describe, expect, mock, test } from "bun:test";
import { act, cleanup, render } from "@testing-library/react";

mock.module("next/navigation", () => ({ useRouter: () => ({ prefetch: () => {}, push: () => {} }) }));
const who: { user: { id: string } | null } = { user: null };
const getUser = mock(async () => ({ data: { user: who.user } }));
mock.module("@/lib/supabase/client", () => ({ createClient: () => ({ auth: { getUser } }) }));

const { LOCAL_FIRST_FLAG } = await import("@/lib/local-first/local-reader");
const { WorkspacePrepare, buildSteps } = await import("./WorkspacePrepare");

const settle = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 30)); });

function spyReplica() {
  const sync = mock(async () => ({ status: "done", issues: [] }));
  const replica = { sync, syncProject: sync, reconcileDeletes: async () => ({ removed: 0, skipped: true }), resume() {}, getStatus: () => ({ status: "idle", report: null }) };
  return { sync, replicaFor: () => replica as never };
}

afterEach(() => {
  cleanup();
  localStorage.removeItem(LOCAL_FIRST_FLAG);
  sessionStorage.clear();
  localStorage.clear();
  who.user = null;
  getUser.mockClear();
});

describe("buildSteps and the local-first flag", () => {
  test("flag OFF: there is no 'projects' step, so running every step never calls the replica's sync", async () => {
    const { sync, replicaFor } = spyReplica();
    const steps = buildSteps("u1", () => {}, replicaFor, () => false);
    expect(steps.map((s) => s.id)).not.toContain("projects");
    expect(sync).not.toHaveBeenCalled();
  });

  test("flag ON (control): the 'projects' step is there and runs the sync", async () => {
    const { sync, replicaFor } = spyReplica();
    const steps = buildSteps("u1", () => {}, replicaFor, () => true);
    const projects = steps.find((s) => s.id === "projects")!;
    await projects.run({ signal: new AbortController().signal, onDetail: () => {} });
    expect(sync).toHaveBeenCalledTimes(1);
  });

  test("the default reads the real flag", () => {
    const { replicaFor } = spyReplica();
    expect(buildSteps("u1", () => {}, replicaFor).map((s) => s.id)).not.toContain("projects");
    localStorage.setItem(LOCAL_FIRST_FLAG, "1");
    expect(buildSteps("u1", () => {}, replicaFor).map((s) => s.id)).toContain("projects");
  });
});

describe("the WorkspacePrepare component", () => {
  test("flag OFF, a signed-in person: it does not ask who is signed in, and renders nothing", async () => {
    who.user = { id: "u1" };
    const view = render(<WorkspacePrepare />);
    await settle();
    expect(getUser).not.toHaveBeenCalled();
    expect(view.queryByTestId("workspace-prepare")).toBeNull();
  });

  test("flag ON, nobody signed in: it asks, and opens nothing", async () => {
    localStorage.setItem(LOCAL_FIRST_FLAG, "1");
    const view = render(<WorkspacePrepare />);
    await settle();
    expect(getUser).toHaveBeenCalledTimes(1); // control: the flag-off case above would see this call if the gate were gone
    expect(view.queryByTestId("workspace-prepare")).toBeNull();
  });
});
