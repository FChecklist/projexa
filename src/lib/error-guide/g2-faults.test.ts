/// <reference types="bun-types" />
// GUIDED ERRORS, GROUP G2: the faults a person can make before anything is sent. Every rule has a test that fails when the rule is broken.
import { describe, expect, test } from "bun:test";
import {
  changeOrderFaults, claimFaults, G2_FAULT_CODES, invoiceCreateFaults, invoiceInputFaults, invoicePostFaults, overHundredField, paymentFaults,
  photoFault, progressFaults, signerFaults, siteInstructionFaults, siteInstructionFileFault, todayIso,
} from "./g2-faults";

const T = "2026-10-21";
const ok = { activityId: "a1", boqLineItemId: "l1", entryDate: T, quantityDone: "5", percentComplete: "20" };
const codes = (f: { code: string }[]) => f.map((x) => x.code);
const withBoq = { projectHasBoq: true, hasActivities: true, today: T };

describe("progressFaults", () => {
  test("a complete, valid entry has no faults", () => {
    expect(progressFaults(ok, withBoq)).toEqual([]);
  });
  test("every missing required box is named, in screen order", () => {
    const f = progressFaults({ entryDate: "" }, withBoq);
    expect(codes(f)).toEqual(["WP_ACTIVITY_MISSING", "WP_BOQ_LINE_MISSING", "WP_DATE_MISSING", "WP_QTY_MISSING", "WP_PERCENT_MISSING"]);
  });
  test("a project with no BOQ needs no BOQ line", () => {
    expect(codes(progressFaults({ ...ok, boqLineItemId: "" }, { projectHasBoq: false, hasActivities: true, today: T }))).toEqual([]);
  });
  test("no activities on the project points at the add-activity box, not an empty list", () => {
    const f = progressFaults({ ...ok, activityId: "" }, { projectHasBoq: true, hasActivities: false, today: T });
    expect(f[0]).toMatchObject({ code: "WP_NO_ACTIVITIES", field: "first-activity-name" });
  });
  test("percentage above 100, below 0 or not a number", () => {
    for (const bad of ["101", "140", "-1", "abc"]) {
      expect(codes(progressFaults({ ...ok, percentComplete: bad }, withBoq))).toEqual(["WP_PERCENT_RANGE"]);
    }
    for (const good of ["0", "100", "12.5"]) {
      expect(progressFaults({ ...ok, percentComplete: good }, withBoq)).toEqual([]);
    }
  });
  test("quantity negative or not a number; zero is allowed (a percentage-only entry)", () => {
    expect(codes(progressFaults({ ...ok, quantityDone: "-3" }, withBoq))).toEqual(["WP_QTY_INVALID"]);
    expect(codes(progressFaults({ ...ok, quantityDone: "1,5" }, withBoq))).toEqual(["WP_QTY_INVALID"]);
    expect(progressFaults({ ...ok, quantityDone: "0" }, withBoq)).toEqual([]);
  });
  test("a date after today is refused, today and earlier are fine", () => {
    expect(codes(progressFaults({ ...ok, entryDate: "2026-10-22" }, withBoq))).toEqual(["WP_DATE_FUTURE"]);
    expect(progressFaults({ ...ok, entryDate: "2026-10-01" }, withBoq)).toEqual([]);
  });
  test("a photo that is the wrong kind or too big", () => {
    expect(photoFault({ name: "plan.pdf", size: 1000, type: "application/pdf" })?.code).toBe("WP_PHOTO_TYPE");
    expect(photoFault({ name: "big.jpg", size: 5 * 1024 * 1024, type: "image/jpeg" })?.code).toBe("WP_PHOTO_TOO_BIG");
    expect(photoFault({ name: "ok.jpg", size: 1024 * 1024, type: "image/jpeg" })).toBeNull();
    expect(photoFault({ name: "IMG_1.HEIC", size: 1000, type: "" })).toBeNull();
    expect(photoFault(null)).toBeNull();
    expect(codes(progressFaults({ ...ok, photo: { name: "plan.pdf", size: 10, type: "application/pdf" } }, withBoq))).toEqual(["WP_PHOTO_TYPE"]);
  });
  test("todayIso is the local calendar day", () => {
    expect(todayIso(new Date(2026, 9, 21, 23, 59))).toBe("2026-10-21");
    expect(todayIso(new Date(2026, 0, 5, 0, 1))).toBe("2026-01-05");
  });
});

describe("overHundredField: the server's refusal belongs next to the number that caused it", () => {
  test("quantity entry", () => {
    expect(overHundredField("Progress on 1.01 would reach 12 of 10 m2 (120%), more than 100%. Only 4 m2 remains on this line.")).toBe("wp-quantity");
  });
  test("percentage-only entry", () => {
    expect(overHundredField("Progress on 1.01 would reach 130%, more than 100%. Only 20% remains on this line.")).toBe("wp-percent");
  });
  test("any other message is not about these boxes", () => {
    expect(overHundredField("BOQ line item not found")).toBeUndefined();
    expect(overHundredField(undefined)).toBeUndefined();
  });
});

describe("changeOrderFaults", () => {
  test("title is required and bounded", () => {
    expect(codes(changeOrderFaults({ title: "  ", costImpact: "", scheduleImpactDays: "" }))).toEqual(["CO_TITLE_MISSING"]);
    expect(codes(changeOrderFaults({ title: "x".repeat(201), costImpact: "", scheduleImpactDays: "" }))).toEqual(["CO_TITLE_LONG"]);
    expect(changeOrderFaults({ title: "Extra ceiling", costImpact: "", scheduleImpactDays: "" })).toEqual([]);
  });
  test("cost must be a number (a minus sign is a saving); days must be whole", () => {
    expect(codes(changeOrderFaults({ title: "t", costImpact: "Rs 5,000", scheduleImpactDays: "" }))).toEqual(["CO_COST_NOT_NUMBER"]);
    expect(changeOrderFaults({ title: "t", costImpact: "-5000", scheduleImpactDays: "-2" })).toEqual([]);
    expect(codes(changeOrderFaults({ title: "t", costImpact: "", scheduleImpactDays: "2.5" }))).toEqual(["CO_DAYS_INVALID"]);
    expect(codes(changeOrderFaults({ title: "t", costImpact: "", scheduleImpactDays: "five" }))).toEqual(["CO_DAYS_INVALID"]);
  });
});

describe("signerFaults", () => {
  test("name and a complete e-mail address are required", () => {
    expect(codes(signerFaults({ name: "", email: "" }))).toEqual(["CO_SIGNER_NAME_MISSING", "CO_SIGNER_EMAIL_MISSING"]);
    for (const bad of ["priya", "priya@", "priya@company", "priya@company.", "pri ya@x.com"]) {
      expect(codes(signerFaults({ name: "Priya", email: bad }))).toEqual(["CO_SIGNER_EMAIL_INVALID"]);
    }
    expect(signerFaults({ name: "Priya", email: " priya@company.com " })).toEqual([]);
  });
});

describe("claimFaults (billing milestone)", () => {
  const good = { customerId: "c1", milestoneDescription: "Slab done", scheduledDate: "2026-11-01", retentionPercent: "5", hasBoq: true };
  test("valid", () => expect(claimFaults(good)).toEqual([]));
  test("every missing box, and the BOQ prerequisite first", () => {
    expect(codes(claimFaults({ ...good, customerId: "", scheduledDate: "", milestoneDescription: " ", hasBoq: false }))).toEqual([
      "BILL_NO_APPROVED_BOQ", "BILL_CUSTOMER_MISSING", "BILL_DATE_MISSING", "BILL_DESCRIPTION_MISSING",
    ]);
  });
  test("retention outside 0-100 or not a number", () => {
    for (const bad of ["101", "-1", "five"]) expect(codes(claimFaults({ ...good, retentionPercent: bad }))).toEqual(["BILL_RETENTION_RANGE"]);
    expect(claimFaults({ ...good, retentionPercent: "0" })).toEqual([]);
  });
});

describe("invoice faults", () => {
  const ids = { billDate: "bill-date-c1", taxTemplate: "tax-template-c1" };
  test("claim invoice form: bill date, template present, template chosen", () => {
    expect(codes(invoiceInputFaults({ billDate: "", taxTemplateId: "t", hasTemplates: true, ids }))).toEqual(["BILL_BILLDATE_MISSING"]);
    expect(invoiceInputFaults({ billDate: "2026-10-21", taxTemplateId: "", hasTemplates: true, ids })[0]).toMatchObject({ code: "BILL_TAX_TEMPLATE_MISSING", field: "tax-template-c1" });
    expect(invoiceInputFaults({ billDate: "2026-10-21", taxTemplateId: "", hasTemplates: false, ids })[0]).toMatchObject({ code: "BILL_NO_TAX_TEMPLATE", field: "tax-template-form" });
    expect(invoiceInputFaults({ billDate: "2026-10-21", taxTemplateId: "t", hasTemplates: true, ids })).toEqual([]);
  });
  test("create: customer, new-customer name, lines", () => {
    const line = { description: "Labour", quantity: "2", rate: "100" };
    expect(invoiceCreateFaults({ customerId: "c", isNewCustomer: false, newCustomerName: "", postingDate: T, lines: [line] })).toEqual([]);
    expect(codes(invoiceCreateFaults({ customerId: "", isNewCustomer: false, newCustomerName: "", postingDate: T, lines: [line] }))).toEqual(["INV_CUSTOMER_MISSING"]);
    expect(codes(invoiceCreateFaults({ customerId: "__new__", isNewCustomer: true, newCustomerName: " ", postingDate: T, lines: [line] }))).toEqual(["INV_NEW_CUSTOMER_NAME_MISSING"]);
    expect(codes(invoiceCreateFaults({ customerId: "c", isNewCustomer: false, newCustomerName: "", postingDate: T, lines: [{ description: "", quantity: "0", rate: "-1" }] }))).toEqual([
      "INV_LINE_DESCRIPTION_MISSING", "INV_LINE_QTY_INVALID", "INV_LINE_RATE_INVALID",
    ]);
  });
  test("post to the ledger needs a revenue account", () => {
    expect(codes(invoicePostFaults({ revenueAccountId: "", hasRevenueAccounts: false }))).toEqual(["INV_NO_REVENUE_ACCOUNT"]);
    expect(codes(invoicePostFaults({ revenueAccountId: "", hasRevenueAccounts: true }))).toEqual(["INV_REVENUE_ACCOUNT_MISSING"]);
    expect(invoicePostFaults({ revenueAccountId: "a", hasRevenueAccounts: true })).toEqual([]);
  });
  test("payment: amount above 0 and not above what is owed, an account, a date not in the future", () => {
    const base = { amount: "500", outstanding: 1000, accountId: "b", hasBankAccounts: true, date: T };
    expect(paymentFaults(base, T)).toEqual([]);
    expect(codes(paymentFaults({ ...base, amount: "" }, T))).toEqual(["INV_PAYMENT_AMOUNT_INVALID"]);
    expect(codes(paymentFaults({ ...base, amount: "0" }, T))).toEqual(["INV_PAYMENT_AMOUNT_INVALID"]);
    expect(codes(paymentFaults({ ...base, amount: "1500" }, T))).toEqual(["INV_PAYMENT_TOO_MUCH"]);
    expect(codes(paymentFaults({ ...base, accountId: "" }, T))).toEqual(["INV_PAYMENT_ACCOUNT_MISSING"]);
    expect(codes(paymentFaults({ ...base, hasBankAccounts: false, accountId: "" }, T))).toEqual(["INV_NO_BANK_ACCOUNT"]);
    expect(codes(paymentFaults({ ...base, date: "2026-12-01" }, T))).toEqual(["INV_PAYMENT_DATE_FUTURE"]);
  });
});

describe("site instruction faults", () => {
  test("date, addressee and instruction are required; a future date is refused", () => {
    expect(siteInstructionFaults({ issueDate: T, toContractor: "Apex", description: "Do it" }, T)).toEqual([]);
    expect(codes(siteInstructionFaults({ issueDate: "", toContractor: " ", description: "" }, T))).toEqual(["SI_DATE_MISSING", "SI_CONTRACTOR_MISSING", "SI_DESCRIPTION_MISSING"]);
    expect(codes(siteInstructionFaults({ issueDate: "2026-11-01", toContractor: "a", description: "b" }, T))).toEqual(["SI_DATE_FUTURE"]);
  });
  test("the file must be a pdf or photo within 10 MB", () => {
    expect(siteInstructionFileFault({ name: "a.docx", size: 10 }, "file")?.code).toBe("SI_FILE_TYPE");
    expect(siteInstructionFileFault({ name: "a.pdf", size: 11 * 1024 * 1024 }, "file")?.code).toBe("SI_FILE_TOO_BIG");
    expect(siteInstructionFileFault({ name: "A.PDF", size: 1024 }, "file")).toBeNull();
    expect(siteInstructionFileFault(null, "file")).toBeNull();
  });
});

describe("G2_FAULT_CODES lists every code the validators can raise", () => {
  test("a code raised by any validator is in the list (so the catalogue test covers it)", () => {
    const raised = new Set<string>();
    const add = (f: { code: string }[]) => f.forEach((x) => raised.add(x.code));
    add(progressFaults({ entryDate: "", quantityDone: "x", percentComplete: "x", photo: { name: "a.pdf", size: 9e9, type: "application/pdf" } }, withBoq));
    add(progressFaults({ entryDate: "2999-01-01", quantityDone: "-1", percentComplete: "200", activityId: "" }, { projectHasBoq: true, hasActivities: false, today: T }));
    add(progressFaults({ ...ok, photo: { name: "a.jpg", size: 9e9, type: "image/jpeg" } }, withBoq));
    add(progressFaults({}, withBoq));
    add(changeOrderFaults({ title: "", costImpact: "x", scheduleImpactDays: "x" }));
    add(changeOrderFaults({ title: "x".repeat(300), costImpact: "", scheduleImpactDays: "1.5" }));
    add(signerFaults({ name: "", email: "" }));
    add(signerFaults({ name: "a", email: "bad" }));
    add(claimFaults({ customerId: "", milestoneDescription: "", scheduledDate: "", retentionPercent: "999", hasBoq: false }));
    add(invoiceInputFaults({ billDate: "", taxTemplateId: "", hasTemplates: true, ids: { billDate: "a", taxTemplate: "b" } }));
    add(invoiceInputFaults({ billDate: "", taxTemplateId: "", hasTemplates: false, ids: { billDate: "a", taxTemplate: "b" } }));
    add(invoiceCreateFaults({ customerId: "__new__", isNewCustomer: true, newCustomerName: "", postingDate: "", lines: [{ description: "", quantity: "0", rate: "-1" }] }));
    add(invoiceCreateFaults({ customerId: "", isNewCustomer: false, newCustomerName: "", postingDate: T, lines: [] }));
    add(invoicePostFaults({ revenueAccountId: "", hasRevenueAccounts: false }));
    add(invoicePostFaults({ revenueAccountId: "", hasRevenueAccounts: true }));
    add(paymentFaults({ amount: "", outstanding: 1, accountId: "", hasBankAccounts: false, date: "" }, T));
    add(paymentFaults({ amount: "9", outstanding: 1, accountId: "", hasBankAccounts: true, date: "2999-01-01" }, T));
    add(siteInstructionFaults({ issueDate: "", toContractor: "", description: "" }, T));
    add(siteInstructionFaults({ issueDate: "2999-01-01", toContractor: "a", description: "a" }, T));
    add([siteInstructionFileFault({ name: "a.docx", size: 1 }, "file")!, siteInstructionFileFault({ name: "a.pdf", size: 9e9 }, "file")!]);
    for (const c of raised) expect(G2_FAULT_CODES).toContain(c);
    const screenRaised = ["WP_PHOTO_UPLOAD_FAILED", "CO_NO_APPROVED_BOQ", "BILL_TAX_RATE_INVALID", "SI_FILE_NONE"];
    expect(G2_FAULT_CODES.filter((c) => !raised.has(c) && !screenRaised.includes(c))).toEqual([]);
  });
});
