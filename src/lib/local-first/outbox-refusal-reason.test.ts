import { describe, expect, test } from "bun:test";
import { IDBFactory } from "fake-indexeddb";
import { createFakeSyncServer } from "./__fixtures__/fake-sync-server";
import { createOutbox, rejectionMessage } from "./outbox";
import { createReplica } from "./replica";

// UAT 2026-10-13, checklist 2.19 / R-90 (log F52): an offline write the server refuses for a business rule came back as the generic card
// "That was not accepted as entered - check the values and try again", while the server knew exactly why ("would reach 110 of 100 sqm ... only
// 5 sqm remains"). When the server sends its own reason and it is safe to show, the card says it. A specific code keeps its own sentence.

const REASON = "Progress on A1 would reach 105 of 100 sqm (105%), more than 100%. Only 5 sqm remains on this line.";
const op = { functionId: "record_work_progress", label: "Progress entry" };

describe("rejectionMessage: the server's own reason for a refused entry", () => {
  test("a business-rule refusal (REQUEST_REJECTED) with the server's reason shows that reason, not the generic card", () => {
    const message = rejectionMessage(op, { code: "REQUEST_REJECTED", message: REASON });
    expect(message).toBe(`Progress entry was not saved. ${REASON} It was undone on this laptop.`);
    expect(message).not.toContain("check the values");
  });

  test("with no reason from the server, the dictionary's sentence stands (nothing is invented)", () => {
    expect(rejectionMessage(op, { code: "REQUEST_REJECTED" })).toBe("Progress entry was not saved. That was not accepted as entered — check the values and try again. It was undone on this laptop.");
  });

  test("a reason that names a parameter, an address or an id is not shown: the dictionary's sentence stands", () => {
    for (const unsafe of ["quantityDone must be a number", "failed at 10.0.0.1:5432", "see https://internal.example/x"]) {
      expect(rejectionMessage(op, { code: "REQUEST_REJECTED", message: unsafe })).toContain("check the values and try again");
    }
  });

  test("a code with its own sentence (role, project ...) keeps it even when a message comes with it", () => {
    expect(rejectionMessage(op, { code: "ROLE_TOO_LOW", message: "something else" })).toContain("Your role in this organisation does not allow this change");
  });
});

describe("the whole path: a push the server refuses with a reason reaches the person's card", () => {
  test("the notice the outbox keeps for the person carries the server's reason", async () => {
    const idb = new IDBFactory();
    const server = createFakeSyncServer();
    server.registerFunction("record_work_progress", () => ({ rejected: "REQUEST_REJECTED", message: REASON }));
    await createReplica({ userId: "u1", client: server.client, idb, yieldFn: async () => {} }).sync();
    let n = 0;
    const outbox = createOutbox({ userId: "u1", client: server.client, deviceId: "dev-1", idb, sleep: async () => {}, autoFlush: false, newOpId: () => `op-${++n}`, locks: null });
    await outbox.enqueue({ functionId: "record_work_progress", projectId: "p1", params: { projectId: "p1", quantityDone: 30 }, label: "Progress entry" });
    const report = await outbox.flush();
    expect(report).toMatchObject({ rejected: 1, remaining: 0 });
    expect(outbox.getState().notices[0]!.message).toBe(`Progress entry was not saved. ${REASON} It was undone on this laptop.`);
  });
});
