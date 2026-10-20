import { describe, expect, test } from "bun:test";
import { invoiceLabel, invoicePath, missingInvoiceInput, readInvoiceReceipt, refusalText } from "./billing-invoice";

describe("billing invoice rules (R-94/R-95)", () => {
  test("the receipt is the invoice the server raised: its id and number, linked to /invoices/<id>", () => {
    const r = readInvoiceReceipt({ invoice: { id: "inv 1", invoiceNumber: 12 } });
    expect(r).toEqual({ invoiceId: "inv 1", invoiceNumber: 12 });
    expect(invoicePath(r.invoiceId)).toBe("/invoices/inv%201");
    expect(invoiceLabel(r.invoiceNumber)).toBe("Invoice #12");
    expect(invoiceLabel(null)).toBe("Invoice");
  });
  test("an answer with no invoice is a failure, never a success", () => {
    expect(() => readInvoiceReceipt({})).toThrow("did not confirm an invoice");
    expect(() => readInvoiceReceipt({ invoice: null })).toThrow();
    expect(() => readInvoiceReceipt(null)).toThrow();
  });
  test("the server's refusal text is kept word for word", () => {
    expect(refusalText(new Error("No new progress to bill since the last interim bill"))).toBe("No new progress to bill since the last interim bill");
    expect(refusalText("x")).toBe("The invoice could not be raised");
  });
  test("both bill date and tax template are needed", () => {
    expect(missingInvoiceInput({ billDate: "", taxTemplateId: "t" })).toBe("Choose the bill date");
    expect(missingInvoiceInput({ billDate: "2026-10-20", taxTemplateId: "" })).toBe("Choose the tax template");
    expect(missingInvoiceInput({ billDate: "2026-10-20", taxTemplateId: "t" })).toBeNull();
  });
});
