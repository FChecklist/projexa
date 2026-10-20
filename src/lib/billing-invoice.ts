// R-94/R-95: the pure rules of "Invoice" on an approved billing claim, kept out of the component so they can be tested without a DOM.
// The server (PATCH /api/billing-claims/[id] {action:"invoice"} -> compliance-tracker invoiceApprovedClaim) answers { claim, bill, invoice };
// the invoice is the sales invoice it raised. Nothing here decides anything about money: it reads the receipt and words the refusal.

export type InvoiceReceipt = { invoiceId: string; invoiceNumber: number | null };

/** The page of one sales invoice (src/app/(app)/invoices/[id]). */
export const invoicePath = (invoiceId: string) => `/invoices/${encodeURIComponent(invoiceId)}`;

/**
 * The invoice the server raised. No invoice id in the answer means the server did not confirm an invoice, which is a failure and throws
 * (a success message with nothing behind it is exactly what this action must never show).
 */
export function readInvoiceReceipt(body: { invoice?: { id?: unknown; invoiceNumber?: unknown } | null } | null | undefined): InvoiceReceipt {
  const id = body?.invoice?.id;
  if (typeof id !== "string" || !id) throw new Error("The server did not confirm an invoice for this billing claim");
  const n = body?.invoice?.invoiceNumber;
  return { invoiceId: id, invoiceNumber: typeof n === "number" ? n : null };
}

export const invoiceLabel = (n: number | null) => (n === null ? "Invoice" : `Invoice #${n}`);

/** The server's own refusal sentence, kept word for word ("No new progress to bill ..."); a generic line only when it said nothing. */
export function refusalText(err: unknown): string {
  return err instanceof Error && err.message.trim() ? err.message : "The invoice could not be raised";
}

/** What to send: both are required by the server and checked here first so the person sees which is missing. */
export function missingInvoiceInput(input: { billDate: string; taxTemplateId: string }): string | null {
  if (!input.billDate) return "Choose the bill date";
  if (!input.taxTemplateId) return "Choose the tax template";
  return null;
}
