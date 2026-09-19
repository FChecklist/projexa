-- Org-configurable start-of-day / end-of-day email digest, actionable by
-- reply. Owner directive 2026-09-19, follow-up on WO-PROJEXA-AI-LINK-001's
-- own deliberately-deferred scope (digest.ts's header comment: "does NOT
-- implement the mandatory cadence engine... or a cron trigger" -- a fixed
-- single daily cron was added after that comment was written, but per-org
-- schedule/timezone, morning/evening split, and inbound reply parsing still
-- did not exist). Hand-authored SQL, applied directly to the projexa
-- Supabase project (evpckeuxgvahguwsaeul) via the Supabase MCP -- this file
-- is the durable repo record of that DDL, same convention as every other
-- migration here (see drizzle/0001's own header, repeated verbatim in
-- drizzle/0023).
--
-- All changes here are additive: one new nullable/defaulted column on
-- organizations, five new tables. The existing email_action_token /
-- applyOneClickAction one-click flow (drizzle/0023) is untouched and keeps
-- working exactly as it does today -- these tables generalize it to cover
-- more entity types and a real per-org schedule, they do not replace it.

-- ── Per-org schedule ────────────────────────────────────────────────────
alter table public.organizations add column if not exists timezone text not null default 'Asia/Kolkata';
comment on column public.organizations.timezone is 'IANA timezone (e.g. Asia/Kolkata) used to compute when this org''s digest slots are due. Defaults to Asia/Kolkata (PROJEXA''s primary market) rather than UTC so a newly-provisioned org with no explicit setting still gets a sensible local send time.';

create table if not exists public.org_email_schedule (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  slot text not null check (slot in ('morning', 'evening', 'custom')),
  label text not null default '',
  -- "HH:MM", 24h, org-local. Kept as text rather than a SQL `time` column --
  -- all the actual timezone math happens in app code
  -- (schedule-service.ts), so there is no benefit to a native time type and
  -- a plain string is trivially portable to/from the settings UI.
  local_time text not null check (local_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- At most one 'morning' and one 'evening' row per org; 'custom' rows are
-- unrestricted at the DB layer (the "max 3 active slots" business rule is
-- enforced in the settings API route, not here -- a business rule, not a
-- security boundary, same level app-level validation is used at elsewhere
-- in this repo, e.g. the currency code check in
-- src/app/api/organization/currency/route.ts).
create unique index if not exists org_email_schedule_org_slot_idx
  on public.org_email_schedule (organization_id, slot)
  where slot in ('morning', 'evening');

create index if not exists org_email_schedule_org_idx on public.org_email_schedule (organization_id);

alter table public.org_email_schedule enable row level security;
-- Same posture as org_ai_link / email_action_token / veridian_credentials:
-- no anon/authenticated policies. This table is only ever touched by
-- trusted server code (the settings route, gated by requireRole() in app
-- code; the digest-cadence cron route) -- never read directly by a
-- browser-side Supabase client, so there is no legitimate RLS policy to add.

-- ── Digest runs (idempotency) ──────────────────────────────────────────
-- One row per (schedule, org-local-calendar-day) that actually ran. The
-- unique constraint below is what makes it safe for more than one trigger
-- source (the existing vercel.json daily cron AND the new GitHub Actions
-- 15-minute poller) to hit the run endpoint redundantly -- whichever one
-- gets there first wins, the other one's attempt is a no-op.
create table if not exists public.email_digest_run (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  -- Nullable: a manual "send me my digest now" (POST /api/email/send-digest,
  -- the existing button) creates a run with no schedule behind it. Postgres
  -- treats each NULL as distinct in the unique(schedule_id, local_date)
  -- constraint below, so manual runs never collide with each other or with
  -- a real scheduled one -- idempotency only ever applies to actual schedules.
  schedule_id uuid references public.org_email_schedule(id) on delete cascade,
  local_date text not null,
  status text not null default 'pending' check (status in ('pending', 'sent', 'partial', 'failed', 'skipped_no_items')),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  memberships_sent integer not null default 0,
  memberships_failed integer not null default 0,
  unique (schedule_id, local_date)
);

create index if not exists email_digest_run_org_idx on public.email_digest_run (organization_id);

alter table public.email_digest_run enable row level security;

-- ── Per-membership delivery + reply addressing ─────────────────────────
-- reply_token is the Reply-To local-part (d-{reply_token}@reply.projexa-ai.com)
-- the inbound webhook uses to resolve which membership/org/run a reply
-- belongs to. Plaintext, not hashed -- unlike email_action_token, this
-- value on its own can only ever resolve to a read (which items were on
-- this delivery); it carries no authority to apply a verb without the
-- reply also passing the sender-email-match check in the inbound route.
create table if not exists public.email_digest_delivery (
  id uuid primary key default gen_random_uuid(),
  -- Nullable for the same reason email_digest_run.schedule_id is: a manual
  -- "send me my digest now" delivery has no run behind it either.
  run_id uuid references public.email_digest_run(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  membership_id uuid not null references public.memberships(id) on delete cascade,
  reply_token text not null unique,
  sent_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists email_digest_delivery_reply_token_idx on public.email_digest_delivery (reply_token);
create index if not exists email_digest_delivery_run_idx on public.email_digest_delivery (run_id);

alter table public.email_digest_delivery enable row level security;

-- ── Individually-addressable items within a delivery ───────────────────
-- Generalizes email_action_token beyond `todos`: one row per open item
-- shown in a given email, numbered (ref_code) so a plain-text reply like
-- "2 done" or "3 answer: use grade-40 rebar" can be matched deterministically.
-- allowed_verbs is fixed at issue time from a small per-entity-type
-- vocabulary (see reply-parser.ts / digest-item-dispatcher.ts) -- it is not
-- user input, so no separate DB-level verb-allowlist trigger is needed here
-- the way email_action_token's org-match trigger is (that trigger protects
-- against a cross-org id mix-up, which is already impossible here since
-- entity_id/allowed_verbs are only ever written server-side from the same
-- collectDigestItems() call that already scoped the query to this org).
create table if not exists public.email_digest_item (
  id uuid primary key default gen_random_uuid(),
  delivery_id uuid not null references public.email_digest_delivery(id) on delete cascade,
  ref_code integer not null,
  entity_type text not null check (entity_type in ('todo', 'rfi', 'submittal', 'punch_list', 'billing_milestone')),
  entity_id text not null,
  allowed_verbs jsonb not null default '[]'::jsonb,
  consumed_at timestamptz,
  applied_verb text,
  applied_payload jsonb,
  unique (delivery_id, ref_code)
);

create index if not exists email_digest_item_delivery_idx on public.email_digest_item (delivery_id);

alter table public.email_digest_item enable row level security;

-- ── Freeform notes (unmatched reply text, EOD reports) ─────────────────
create table if not exists public.daily_report_note (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  membership_id uuid not null references public.memberships(id) on delete cascade,
  delivery_id uuid references public.email_digest_delivery(id) on delete set null,
  raw_text text not null,
  created_at timestamptz not null default now()
);

create index if not exists daily_report_note_org_idx on public.daily_report_note (organization_id, created_at desc);

alter table public.daily_report_note enable row level security;
