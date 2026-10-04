// draftText (outbox-drafts.ts): what the outbox card shows of a change the server turned down when no screen can reopen it. The
// browser-level proof is e2e/lf-delivery-writes.spec.ts ("a change the server turns down reaches the person ..."): the card for a
// turned-down attendance mark showed the date and the status but not the 9 hours the person had typed.

import { describe, expect, test } from "bun:test";
import { draftText } from "./outbox-drafts";

describe("draftText", () => {
  test("keeps the amounts the person typed, with their field's name (attendance hours, receipt quantity, progress quantity)", () => {
    expect(draftText({ params: { projectId: "p1", rosterId: "w-1", date: "2026-10-01", status: "present", hours: 9 } })).toBe("2026-10-01\n\npresent\n\nHours: 9");
    expect(draftText({ params: { projectId: "p1", materialId: "m1", quantity: 6, receivedDate: "2026-10-01", reference: "DN-4610" } })).toBe("Quantity: 6\n\nDN-4610");
    expect(draftText({ params: { projectId: "p1", boqLineItemId: "l1", entryDate: "2026-10-01", quantityDone: 37.5, remarks: "Second coat" } })).toBe("Quantity done: 37.5\n\nSecond coat");
  });

  test("free text as typed; ids, dates named *Date, empty text and non-finite numbers are left out", () => {
    expect(draftText({ params: { id: "x", rfiId: "r1", subject: "Door clash", question: "Which door?", dueDate: "2026-10-09", note: "  ", n: Number.NaN, flag: true } })).toBe("Door clash\n\nWhich door?");
  });
});
