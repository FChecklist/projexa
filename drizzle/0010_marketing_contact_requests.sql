-- Marketing site redesign (2026-07-17): "Talk to an Engineer" lead capture.
--
-- The redesigned marketing site (src/components/marketing/ContactForm.tsx)
-- removes all pricing/self-serve "Start free" framing in favour of a real,
-- working contact-capture form -- same precedent as compliance-tracker's
-- own contact_submissions table (src/lib/services/contact-service.ts
-- there): these rows belong to an anonymous public visitor, not a tenant,
-- so this table intentionally has no organization_id FK and no RLS policy.
-- No email-sending step exists here (unlike that sibling table's
-- confirm-by-email flow) -- this repo has no email/Resend infra, so a
-- stored, queryable lead is the honest scope: POST /api/contact inserts a
-- row, nothing more.
create table if not exists public.contact_requests (
  id text primary key,
  name text not null,
  email text not null,
  company text,
  phone text,
  message text,
  source_page text,
  created_at timestamptz not null default now()
);

comment on table public.contact_requests is
  'Public "Talk to an Engineer" lead-capture rows from the marketing site (home + /how-it-works). Anonymous-visitor data, not a tenant table -- no organization_id, no RLS. See src/app/api/contact/route.ts.';
comment on column public.contact_requests.source_page is
  'Which marketing page the visitor submitted from, e.g. "home" or "how-it-works".';
