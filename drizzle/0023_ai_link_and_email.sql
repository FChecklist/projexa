-- WO-PROJEXA-AI-LINK-001: AI Link (read-only snapshot + verb-allowlisted
-- proposal apply) and email-as-interface (one-click action tokens).
-- Hand-authored SQL, applied directly to the projexa Supabase project
-- (evpckeuxgvahguwsaeul) via the Supabase MCP -- this file is the durable
-- repo record of that DDL, same convention as every other migration here
-- (see drizzle/0001's own header).

-- ── AI Link ─────────────────────────────────────────────────────────────
-- The token carries NO authority by itself -- it only addresses a
-- SECURITY DEFINER projection function that already excludes personal data
-- at the query level (see ai_link_projection below). All real authority
-- comes from the signed-in session when a member pastes a proposal back
-- into the app. A leaked token is an annoyance, not a breach -- so it is
-- deliberately plaintext, not signed.
create table if not exists public.org_ai_link (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  token text not null unique,
  created_at timestamptz not null default now(),
  expires_at timestamptz,
  revoked_at timestamptz
);

-- Same posture as veridian_credentials (drizzle/0001): no anon/authenticated
-- policies at all. Readable only by the service_role key from trusted
-- server code -- there is no legitimate reason for a browser session to
-- read this table directly.
alter table public.org_ai_link enable row level security;

-- One ACTIVE link per (org, user) -- rotating replaces it (revoke the old
-- row, insert a new one) rather than accumulating live tokens nobody
-- remembers exist. Revoked/expired rows are kept, not deleted, so "who had
-- a link and when" stays answerable.
create unique index if not exists org_ai_link_active_org_user_idx
  on public.org_ai_link (organization_id, user_id)
  where revoked_at is null;

create index if not exists org_ai_link_token_idx on public.org_ai_link (token);

-- The projection function: the ONE place personal-data exclusion is
-- enforced, at the database layer, not as an app-code field filter.
-- SECURITY DEFINER bypasses RLS entirely, so the guarantee here comes
-- ONLY from which columns this query selects -- it must never be widened
-- to select profiles.*, messages.content, conversations, or any
-- name/email/phone-bearing column. The membership check below is the
-- second half of the guarantee: without it, a caller who already knows
-- (or guesses) an org_id/user_id pair could read another tenant's
-- projection even though the token check in the route already scoped it --
-- defense in depth for the one function in this repo that runs with
-- elevated privilege.
create or replace function public.ai_link_projection(p_org uuid, p_user uuid)
returns text
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  v_org_name text;
  v_todos text;
  v_notifications text;
begin
  if not exists (
    select 1 from public.memberships
    where organization_id = p_org and user_id = p_user
  ) then
    raise exception 'not a member of this organization';
  end if;

  select name into v_org_name from public.organizations where id = p_org;

  select string_agg(line, E'\n') into v_todos
  from (
    select format(
      '- [%s] %s%s%s',
      case when done then 'done' else 'open' end,
      text,
      case when due_date is not null then format(' (due %s)', due_date) else '' end,
      case when note is not null and note <> '' then format(' -- %s', note) else '' end
    ) as line
    from public.todos
    where organization_id = p_org
    order by created_at desc
    limit 30
  ) t;

  select string_agg(format('- %s (%s)', title, type), E'\n') into v_notifications
  from (
    select title, type, created_at
    from public.notifications
    where organization_id = p_org
    order by created_at desc
    limit 15
  ) n;

  return format(
    E'ORGANIZATION: %s\n\nTODOS:\n%s\n\nRECENT NOTIFICATIONS:\n%s\n',
    coalesce(v_org_name, 'Unknown organization'),
    coalesce(v_todos, '(none)'),
    coalesce(v_notifications, '(none)')
  );
end;
$$;

revoke all on function public.ai_link_projection(uuid, uuid) from public, anon, authenticated;
grant execute on function public.ai_link_projection(uuid, uuid) to service_role;

-- Extend todos with the columns the verb allowlist actually needs
-- (ASSIGN/SET_DUE/NOTE). Confirmed via direct schema read: todos was
-- previously just {id, organization_id, user_id, text, done, created_at} --
-- a flat checklist item, not a task-tracker shape. Additive only, all
-- nullable, no existing row or query breaks.
alter table public.todos add column if not exists assignee_id uuid references auth.users(id);
alter table public.todos add column if not exists due_date date;
alter table public.todos add column if not exists note text;

-- ── Email as the interface ─────────────────────────────────────────────
-- Membership-scoped, not user-scoped directly: the trigger below needs an
-- organization_id on the token row to check against the target's own org,
-- and a membership_id is what makes that check a single join instead of a
-- second lookup. Storing the HASH, not the raw token, is a deliberate
-- deviation the equivalent VERIDIAN work order's Owner already approved
-- once ("correct, and better than what I specified") -- applied here from
-- the start rather than discovered the same way twice.
create table if not exists public.email_action_token (
  id uuid primary key default gen_random_uuid(),
  todo_id uuid not null references public.todos(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  membership_id uuid not null references public.memberships(id) on delete cascade,
  action text not null,
  token_hash text not null unique,
  issued_at timestamptz not null default now(),
  expires_at timestamptz not null,
  used_at timestamptz
);

alter table public.email_action_token enable row level security;
-- Same posture as org_ai_link: service-role only. A public, unauthenticated
-- click has no session for RLS to evaluate against in the first place.

create index if not exists email_action_token_hash_idx on public.email_action_token (token_hash);
create index if not exists email_action_token_todo_idx on public.email_action_token (todo_id);

-- The token IS the enforcement, not an app-layer check that a future edit
-- could accidentally skip: a real BEFORE INSERT trigger rejects any token
-- whose membership does not belong to the same org as the todo it targets.
create or replace function public.check_email_action_token_org_match()
returns trigger
language plpgsql
as $$
declare
  v_membership_org uuid;
  v_todo_org uuid;
begin
  select organization_id into v_membership_org from public.memberships where id = new.membership_id;
  select organization_id into v_todo_org from public.todos where id = new.todo_id;

  if v_membership_org is null or v_todo_org is null or v_membership_org <> v_todo_org then
    raise exception 'email_action_token: membership org (%) does not match todo org (%)', v_membership_org, v_todo_org;
  end if;

  if new.organization_id <> v_todo_org then
    raise exception 'email_action_token: organization_id column does not match the todo''s own org';
  end if;

  return new;
end;
$$;

drop trigger if exists email_action_token_org_match on public.email_action_token;
create trigger email_action_token_org_match
  before insert on public.email_action_token
  for each row execute function public.check_email_action_token_org_match();
