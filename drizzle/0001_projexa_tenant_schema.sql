-- PROJEXA's own schema: customer/org/auth/billing data only.
-- All construction domain data (BOQ, progress, site diary, etc.) lives in
-- VERIDIAN and is fetched server-side through /api/v1/projexa/*.
-- Applied directly to the projexa Supabase project (evpckeuxgvahguwsaeul)
-- via Supabase MCP; this file is the durable repo record of that DDL.

create table if not exists public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  created_at timestamptz not null default now()
);

create table if not exists public.memberships (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  role text not null default 'member' check (role in ('owner', 'admin', 'member')),
  created_at timestamptz not null default now(),
  unique (user_id, organization_id)
);

-- One row per PROJEXA org, pointing at that customer's VERIDIAN tenant.
-- Holds a secret Bearer key -- service-role access only, never exposed to
-- the browser and never readable by anon/authenticated roles.
create table if not exists public.veridian_credentials (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  veridian_org_id text not null,
  veridian_api_key text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.organizations enable row level security;
alter table public.memberships enable row level security;
alter table public.veridian_credentials enable row level security;

create policy "members can view their organization"
  on public.organizations for select
  using (
    id in (select organization_id from public.memberships where user_id = auth.uid())
  );

create policy "users can view their own memberships"
  on public.memberships for select
  using (user_id = auth.uid());

-- No policies on veridian_credentials for anon/authenticated: it is
-- readable only by the service_role key from trusted server code.
