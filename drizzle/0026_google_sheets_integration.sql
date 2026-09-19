-- Google Sheets integration (src/lib/google-sheets/): one row per PROJEXA
-- org that has connected a spreadsheet. A single PROJEXA-owned Google
-- service account owns every org's sheet, so there is no per-org OAuth
-- token to store here -- only which spreadsheet belongs to this org and a
-- hash of the token its Apps Script uses to call back into this app.
--
-- Handwritten rather than `drizzle-kit generate`: this repo's drizzle/meta/
-- snapshot history is not committed (only drizzle/meta/0000_snapshot.json
-- exists, none of 0001-0024's), so `generate` has no real base to diff
-- against and produces a full from-scratch recreation of all 17 existing
-- tables instead of an incremental migration. Matches the shape of
-- src/lib/db/schema.ts's googleSheetsIntegration table exactly, and follows
-- 0001_projexa_tenant_schema.sql's own convention for veridian_credentials
-- (RLS enabled, no policies -- readable only via the direct Postgres
-- connection in src/lib/db/index.ts, never through PostgREST/anon/
-- authenticated).

create table if not exists public.google_sheets_integration (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  spreadsheet_id text not null unique,
  spreadsheet_url text not null,
  webhook_token_hash text not null,
  status text not null default 'idle',
  last_error text,
  last_pushed_at timestamptz,
  last_pulled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.google_sheets_integration enable row level security;

-- No policies for anon/authenticated, matching veridian_credentials: this
-- table is readable/writable only via the direct Postgres connection
-- (src/lib/db/index.ts), never through a browser-facing Supabase client.
