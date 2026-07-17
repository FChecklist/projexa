// Marketing site "Talk to an Engineer" lead capture -- same precedent as
// compliance-tracker's own contact-service.ts: these rows belong to an
// anonymous public visitor, not a tenant, so this uses the raw `db` client
// with no organizationId/RLS scoping (see drizzle/0010, schema.ts's
// contactRequests). No email-sending step -- this repo has no email/Resend
// infra, so a stored, queryable lead is the honest scope.
import { createId } from "@paralleldrive/cuid2";
import { db, contactRequests } from "@/lib/db";

export type ContactRequestPayload = {
  name?: string;
  email?: string;
  company?: string;
  phone?: string;
  message?: string;
  sourcePage?: string;
};

export class ContactRequestError extends Error {}

function sanitize(p: ContactRequestPayload) {
  return {
    name: p.name?.trim().slice(0, 200) || "",
    email: p.email?.trim().slice(0, 200) || "",
    company: p.company?.trim().slice(0, 200) || null,
    phone: p.phone?.trim().slice(0, 40) || null,
    message: p.message?.trim().slice(0, 4000) || null,
    sourcePage: p.sourcePage?.trim().slice(0, 100) || null,
  };
}

export async function submitContactRequest(payload: ContactRequestPayload): Promise<void> {
  const clean = sanitize(payload);
  if (!clean.name || !clean.email) {
    throw new ContactRequestError("Name and email are required.");
  }

  await db.insert(contactRequests).values({
    id: createId(),
    name: clean.name,
    email: clean.email,
    company: clean.company,
    phone: clean.phone,
    message: clean.message,
    sourcePage: clean.sourcePage,
  });
}
