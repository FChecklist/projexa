// GUIDED ERRORS, GROUP G2 (work progress, change orders, billing, site instructions): the faults a person can make BEFORE anything is sent.
// Pure functions: given what was typed, they return the list of faults in screen order. Each fault carries
//   code   -- the client-raised machine code the catalogue (catalogue/progress.ts, change-orders.ts, billing.ts, misc.ts) has a guide for,
//   field  -- the data-testid of the control that must be corrected (the guide's "Fix it now" scrolls to it and outlines it),
//   message -- one complete sentence for the field's own message line.
// Nothing here reads the DOM or the network, so every rule is unit-tested (g2-faults.test.ts) and the screens only render the result.

import type { GuideContext } from "./types";
import { currentScreen, projectIdFromSearch } from "./context";

export type Fault = { code: string; field: string; message: string };

/** The context for a fault the form found itself (nothing was sent). The guide matched is the one for `fault.code` + `fault.field`. */
export function faultContext(fault: Fault, extra: Partial<GuideContext> = {}): GuideContext {
  const screen = currentScreen();
  return {
    route: screen.route,
    search: screen.search,
    projectId: projectIdFromSearch(screen.search),
    serverMessage: fault.message,
    status: 0,
    code: fault.code,
    field: fault.field,
    ...extra,
  };
}

// ---------------------------------------------------------------- work progress

/** A site photo is sent through the app's own server (a serverless function); 4 MB keeps it under the platform's request-body limit. */
export const WP_PHOTO_MAX_MB = 4;
export const WP_PHOTO_TYPES = ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"];

export function photoFault(file: { name: string; size: number; type: string } | null): Fault | null {
  if (!file) return null;
  const okType = WP_PHOTO_TYPES.includes((file.type || "").toLowerCase()) || /\.(jpe?g|png|webp|heic|heif)$/i.test(file.name);
  if (!okType) {
    return { code: "WP_PHOTO_TYPE", field: "wp-photo", message: `"${file.name}" is not a photo. Choose a JPG, PNG, WebP or HEIC picture.` };
  }
  if (file.size > WP_PHOTO_MAX_MB * 1024 * 1024) {
    const mb = Math.round((file.size / 1024 / 1024) * 10) / 10;
    return { code: "WP_PHOTO_TOO_BIG", field: "wp-photo", message: `"${file.name}" is ${mb} MB. A site photo can be at most ${WP_PHOTO_MAX_MB} MB.` };
  }
  return null;
}

export function todayIso(now: Date = new Date()): string {
  // the person's own calendar day, not UTC (a site engineer in Dubai at 01:00 is already on the next UTC-less day)
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export type ProgressInput = {
  activityId?: unknown;
  boqLineItemId?: unknown;
  entryDate?: unknown;
  quantityDone?: unknown;
  percentComplete?: unknown;
  photo?: { name: string; size: number; type: string } | null;
};

/** Every fault in a progress entry, in the order the fields appear on the form. */
export function progressFaults(v: ProgressInput, opts: { projectHasBoq: boolean; hasActivities: boolean; today?: string }): Fault[] {
  const out: Fault[] = [];
  const blank = (x: unknown) => x === undefined || x === null || x === "";
  if (blank(v.activityId)) {
    out.push(
      opts.hasActivities
        ? { code: "WP_ACTIVITY_MISSING", field: "wp-activity", message: "Choose the activity this work belongs to." }
        : { code: "WP_NO_ACTIVITIES", field: "first-activity-name", message: "This project has no activities yet. Add the first one, then choose it." }
    );
  }
  if (opts.projectHasBoq && blank(v.boqLineItemId)) {
    out.push({ code: "WP_BOQ_LINE_MISSING", field: "wp-boq-line", message: "Choose the BOQ line this work was done on." });
  }
  const today = opts.today ?? todayIso();
  if (blank(v.entryDate)) {
    out.push({ code: "WP_DATE_MISSING", field: "wp-date", message: "Choose the day the work was done." });
  } else if (typeof v.entryDate === "string" && v.entryDate > today) {
    out.push({ code: "WP_DATE_FUTURE", field: "wp-date", message: `${v.entryDate} is in the future. Progress can only be logged for today or an earlier day.` });
  }
  if (blank(v.quantityDone)) {
    out.push({ code: "WP_QTY_MISSING", field: "wp-quantity", message: "Type the quantity done. Type 0 if you are only entering a percentage." });
  } else {
    const q = Number(v.quantityDone);
    if (!Number.isFinite(q)) out.push({ code: "WP_QTY_INVALID", field: "wp-quantity", message: "The quantity must be a number, such as 12.5." });
    else if (q < 0) out.push({ code: "WP_QTY_INVALID", field: "wp-quantity", message: "The quantity cannot be below 0. To undo a wrong entry, open it and delete it." });
  }
  if (blank(v.percentComplete)) {
    out.push({ code: "WP_PERCENT_MISSING", field: "wp-percent", message: "Type the % complete, a number from 0 to 100." });
  } else {
    const p = Number(v.percentComplete);
    if (!Number.isFinite(p)) out.push({ code: "WP_PERCENT_RANGE", field: "wp-percent", message: "The % complete must be a number from 0 to 100." });
    else if (p < 0 || p > 100) out.push({ code: "WP_PERCENT_RANGE", field: "wp-percent", message: `${v.percentComplete}% is outside 0 to 100. Type the share of this BOQ line that is done, between 0 and 100.` });
  }
  const pf = photoFault(v.photo ?? null);
  if (pf) out.push(pf);
  return out;
}

/**
 * The server's refusal of a progress entry that would take a BOQ line past 100%, turned into the field it is about.
 * (construction-progress-service.createProgressEntry: "Progress on X would reach A of B unit (C%), more than 100%. Only D unit remains ..." for a
 * quantity entry; "... would reach C%, more than 100%. Only D% remains ..." for a percentage-only entry.)
 */
export function overHundredField(message: string | undefined): "wp-quantity" | "wp-percent" | undefined {
  if (!message || !/more than 100%/i.test(message)) return undefined;
  return /would reach\s+-?[\d.,]+\s+of\s+-?[\d.,]+/i.test(message) ? "wp-quantity" : "wp-percent";
}

// ---------------------------------------------------------------- change orders

export function changeOrderFaults(v: { title: string; costImpact: string; scheduleImpactDays: string }): Fault[] {
  const out: Fault[] = [];
  if (!v.title.trim()) out.push({ code: "CO_TITLE_MISSING", field: "co-title", message: "Give the change order a title, such as Extra false ceiling in lobby." });
  else if (v.title.trim().length > 200) out.push({ code: "CO_TITLE_LONG", field: "co-title", message: `The title is ${v.title.trim().length} letters. Keep it to 200 or fewer.` });
  const cost = v.costImpact.trim();
  if (cost && !Number.isFinite(Number(cost))) out.push({ code: "CO_COST_NOT_NUMBER", field: "co-cost", message: `"${cost}" is not a number. Type digits only, such as 50000, with a minus sign for a saving.` });
  const days = v.scheduleImpactDays.trim();
  if (days) {
    if (!Number.isFinite(Number(days))) out.push({ code: "CO_DAYS_INVALID", field: "co-days", message: `"${days}" is not a number of days. Type a whole number, such as 5, with a minus sign for time saved.` });
    else if (!Number.isInteger(Number(days))) out.push({ code: "CO_DAYS_INVALID", field: "co-days", message: `${days} days is not a whole number. Round it to whole days.` });
  }
  return out;
}

export const EMAIL_RX = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function signerFaults(v: { name: string; email: string }): Fault[] {
  const out: Fault[] = [];
  if (!v.name.trim()) out.push({ code: "CO_SIGNER_NAME_MISSING", field: "co-signer-name", message: "Type the name of the person who will sign." });
  const e = v.email.trim();
  if (!e) out.push({ code: "CO_SIGNER_EMAIL_MISSING", field: "co-signer-email", message: "Type the e-mail address the signing link is sent to." });
  else if (!EMAIL_RX.test(e)) out.push({ code: "CO_SIGNER_EMAIL_INVALID", field: "co-signer-email", message: `"${e}" is not a complete e-mail address. It needs an @ and a part after the dot, such as name@company.com.` });
  return out;
}

// ---------------------------------------------------------------- billing

export function claimFaults(v: { customerId: string; milestoneDescription: string; scheduledDate: string; retentionPercent: string; hasBoq: boolean }): Fault[] {
  const out: Fault[] = [];
  if (!v.hasBoq) out.push({ code: "BILL_NO_APPROVED_BOQ", field: "billing-new-milestone", message: "This project has no approved BOQ yet, so there is nothing to bill against." });
  if (!v.customerId) out.push({ code: "BILL_CUSTOMER_MISSING", field: "claim-customer", message: "Choose the customer this milestone is billed to." });
  if (!v.scheduledDate) out.push({ code: "BILL_DATE_MISSING", field: "claim-scheduled-date", message: "Choose the planned billing date." });
  const r = v.retentionPercent.trim();
  if (r !== "") {
    const n = Number(r);
    if (!Number.isFinite(n) || n < 0 || n > 100) out.push({ code: "BILL_RETENTION_RANGE", field: "claim-retention", message: `${r} is not a valid retention. Type a percentage from 0 to 100.` });
  }
  if (!v.milestoneDescription.trim()) out.push({ code: "BILL_DESCRIPTION_MISSING", field: "claim-description", message: "Describe the milestone, for example Foundation complete, ready to bill." });
  return out;
}

/** `ids` are the data-testid / id of the two controls of the invoice form that is on screen (the page and the claim card each have their own). */
export function invoiceInputFaults(v: { billDate: string; taxTemplateId: string; hasTemplates: boolean; ids: { billDate: string; taxTemplate: string } }): Fault[] {
  const out: Fault[] = [];
  if (!v.billDate) out.push({ code: "BILL_BILLDATE_MISSING", field: v.ids.billDate, message: "Choose the date of the invoice." });
  if (!v.hasTemplates) out.push({ code: "BILL_NO_TAX_TEMPLATE", field: "tax-template-form", message: "No tax template exists yet, and an invoice cannot work out tax without one." });
  else if (!v.taxTemplateId) out.push({ code: "BILL_TAX_TEMPLATE_MISSING", field: v.ids.taxTemplate, message: "Choose the tax template (for example GST 18%)." });
  return out;
}

// ---------------------------------------------------------------- site instructions

export function siteInstructionFaults(v: { issueDate: string; toContractor: string; description: string }, today: string = todayIso()): Fault[] {
  const out: Fault[] = [];
  if (!v.issueDate) out.push({ code: "SI_DATE_MISSING", field: "issueDate", message: "Choose the date the instruction was issued." });
  else if (v.issueDate > today) out.push({ code: "SI_DATE_FUTURE", field: "issueDate", message: `${v.issueDate} is in the future. An instruction is dated the day it is issued.` });
  if (!v.toContractor.trim()) out.push({ code: "SI_CONTRACTOR_MISSING", field: "toContractor", message: "Type who the instruction is addressed to, for example Apex MEP Contractors LLC." });
  if (!v.description.trim()) out.push({ code: "SI_DESCRIPTION_MISSING", field: "description", message: "Write what the contractor is instructed to do." });
  return out;
}

// ---------------------------------------------------------------- sales invoices (create, post to ledger, record payment)

export type InvoiceLineInput = { description: string; quantity: string; rate: string };

export function invoiceCreateFaults(v: { customerId: string; isNewCustomer: boolean; newCustomerName: string; postingDate: string; lines: InvoiceLineInput[] }): Fault[] {
  const out: Fault[] = [];
  if (!v.customerId) out.push({ code: "INV_CUSTOMER_MISSING", field: "inv-customer", message: "Choose the customer this invoice is for, or add a new one." });
  else if (v.isNewCustomer && !v.newCustomerName.trim()) out.push({ code: "INV_NEW_CUSTOMER_NAME_MISSING", field: "inv-new-customer-name", message: "Type the new customer's name." });
  if (!v.postingDate) out.push({ code: "INV_DATE_MISSING", field: "inv-posting-date", message: "Choose the invoice date." });
  v.lines.forEach((l, i) => {
    const n = i + 1;
    if (!l.description.trim()) out.push({ code: "INV_LINE_DESCRIPTION_MISSING", field: `inv-line-description-${i}`, message: `Line ${n}: describe what is being charged.` });
    const q = Number(l.quantity);
    if (l.quantity === "" || !Number.isFinite(q) || q <= 0) out.push({ code: "INV_LINE_QTY_INVALID", field: `inv-line-qty-${i}`, message: `Line ${n}: the quantity must be a number above 0.` });
    const r = Number(l.rate);
    if (l.rate === "" || !Number.isFinite(r) || r < 0) out.push({ code: "INV_LINE_RATE_INVALID", field: `inv-line-rate-${i}`, message: `Line ${n}: the rate must be a number, 0 or more.` });
  });
  return out;
}

export function invoicePostFaults(v: { revenueAccountId: string; hasRevenueAccounts: boolean }): Fault[] {
  if (!v.hasRevenueAccounts) return [{ code: "INV_NO_REVENUE_ACCOUNT", field: "inv-revenue-account", message: "There is no income (revenue) account to post this invoice to." }];
  if (!v.revenueAccountId) return [{ code: "INV_REVENUE_ACCOUNT_MISSING", field: "inv-revenue-account", message: "Choose the revenue account this invoice is posted to." }];
  return [];
}

export function paymentFaults(v: { amount: string; outstanding: number; accountId: string; hasBankAccounts: boolean; date: string }, today: string = todayIso()): Fault[] {
  const out: Fault[] = [];
  const a = Number(v.amount);
  if (v.amount.trim() === "" || !Number.isFinite(a) || a <= 0) out.push({ code: "INV_PAYMENT_AMOUNT_INVALID", field: "inv-payment-amount", message: "Type the amount received, a number above 0." });
  else if (a > v.outstanding + 0.005) out.push({ code: "INV_PAYMENT_TOO_MUCH", field: "inv-payment-amount", message: `${v.amount} is more than the ${v.outstanding} still owed on this invoice. Type ${v.outstanding} or less.` });
  if (!v.hasBankAccounts) out.push({ code: "INV_NO_BANK_ACCOUNT", field: "inv-payment-account", message: "There is no bank or cash account to receive the payment into." });
  else if (!v.accountId) out.push({ code: "INV_PAYMENT_ACCOUNT_MISSING", field: "inv-payment-account", message: "Choose the bank or cash account the money was received into." });
  if (!v.date) out.push({ code: "INV_PAYMENT_DATE_MISSING", field: "inv-payment-date", message: "Choose the date the money was received." });
  else if (v.date > today) out.push({ code: "INV_PAYMENT_DATE_FUTURE", field: "inv-payment-date", message: `${v.date} is in the future. Choose the day the money actually arrived.` });
  return out;
}

/** The optional instruction file (create form: field "file"; the Add file box: field "si-add-file-input"). */
export function siteInstructionFileFault(file: { name: string; size: number } | null, field: string): Fault | null {
  if (!file) return null;
  const lower = file.name.toLowerCase();
  if (![".pdf", ".png", ".jpg", ".jpeg"].some((ext) => lower.endsWith(ext))) {
    return { code: "SI_FILE_TYPE", field, message: `"${file.name}" is not a PDF or a photo. Choose a .pdf, .png or .jpg file.` };
  }
  if (file.size > 10 * 1024 * 1024) {
    const mb = Math.round((file.size / 1024 / 1024) * 10) / 10;
    return { code: "SI_FILE_TOO_BIG", field, message: `"${file.name}" is ${mb} MB. An instruction file can be at most 10 MB.` };
  }
  return null;
}

/** Looks up the message for one field, for the control's own error line. */
export function messageFor(faults: Fault[], field: string): string | undefined {
  return faults.find((f) => f.field === field)?.message;
}

/**
 * Every client-raised code of group G2, with the screen field (data-testid / id) its guide points at. The catalogue coverage test fails when a code here
 * has no guide. The four in `screenRaised` (g2-faults.test.ts) are raised by a screen directly, not by a validator above: the photo that failed to upload
 * after the entry was saved, a change order with no approved BOQ to revise, a wrong tax rate, and "Add file" with no file chosen.
 */
export const G2_FAULT_FIELDS: Record<string, string> = {
  WP_ACTIVITY_MISSING: "wp-activity", WP_NO_ACTIVITIES: "first-activity-name", WP_BOQ_LINE_MISSING: "wp-boq-line", WP_DATE_MISSING: "wp-date",
  WP_DATE_FUTURE: "wp-date", WP_QTY_MISSING: "wp-quantity", WP_QTY_INVALID: "wp-quantity", WP_PERCENT_MISSING: "wp-percent", WP_PERCENT_RANGE: "wp-percent",
  WP_PHOTO_TYPE: "wp-photo", WP_PHOTO_TOO_BIG: "wp-photo", WP_PHOTO_UPLOAD_FAILED: "",
  CO_TITLE_MISSING: "co-title", CO_TITLE_LONG: "co-title", CO_COST_NOT_NUMBER: "co-cost", CO_DAYS_INVALID: "co-days",
  CO_SIGNER_NAME_MISSING: "co-signer-name", CO_SIGNER_EMAIL_MISSING: "co-signer-email", CO_SIGNER_EMAIL_INVALID: "co-signer-email", CO_NO_APPROVED_BOQ: "",
  BILL_NO_APPROVED_BOQ: "billing-new-milestone", BILL_CUSTOMER_MISSING: "claim-customer", BILL_DATE_MISSING: "claim-scheduled-date",
  BILL_RETENTION_RANGE: "claim-retention", BILL_DESCRIPTION_MISSING: "claim-description", BILL_BILLDATE_MISSING: "bill-date",
  BILL_NO_TAX_TEMPLATE: "tax-template-form", BILL_TAX_TEMPLATE_MISSING: "tax-template", BILL_TAX_RATE_INVALID: "tax-template-form",
  INV_CUSTOMER_MISSING: "inv-customer", INV_NEW_CUSTOMER_NAME_MISSING: "inv-new-customer-name", INV_DATE_MISSING: "inv-posting-date",
  INV_LINE_DESCRIPTION_MISSING: "inv-line-description-0", INV_LINE_QTY_INVALID: "inv-line-qty-0", INV_LINE_RATE_INVALID: "inv-line-rate-0",
  INV_NO_REVENUE_ACCOUNT: "inv-revenue-account", INV_REVENUE_ACCOUNT_MISSING: "inv-revenue-account",
  INV_PAYMENT_AMOUNT_INVALID: "inv-payment-amount", INV_PAYMENT_TOO_MUCH: "inv-payment-amount", INV_NO_BANK_ACCOUNT: "inv-payment-account",
  INV_PAYMENT_ACCOUNT_MISSING: "inv-payment-account", INV_PAYMENT_DATE_MISSING: "inv-payment-date", INV_PAYMENT_DATE_FUTURE: "inv-payment-date",
  SI_DATE_MISSING: "issueDate", SI_DATE_FUTURE: "issueDate", SI_CONTRACTOR_MISSING: "toContractor", SI_DESCRIPTION_MISSING: "description",
  SI_FILE_TYPE: "file", SI_FILE_TOO_BIG: "file", SI_FILE_NONE: "si-add-file-input",
};
export const G2_FAULT_CODES = Object.keys(G2_FAULT_FIELDS);
