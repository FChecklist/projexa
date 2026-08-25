-- R48_NO_INVITE_UI_01 (found 2026-08-25): PROJEXA had NO user-provisioning
-- surface of any kind. SettingsClient.tsx was 143 lines with exactly one
-- button (Sign Out); there is no src/app/api/users route in this app at all.
-- The only way a second person ever joined an org was /api/org/provision,
-- which creates a BRAND NEW org for whoever calls it -- so an owner could
-- not add a colleague to their own organisation, and platform.uat_persona's
-- CEO row ("must be able to ... invite a user") was unimplementable.
--
-- Ruled at L5 (ERP convention): SAP, Dynamics 365 and Odoo all place user
-- provisioning under organisation admin settings. This is that table.
--
-- DESIGN NOTE -- WHY A LINK AND NOT AN EMAIL: this repo has no service-role
-- Supabase client (see schema.ts:124 -- "service_role Postgres roles ...
-- don't exist in this repo"), so auth.admin.inviteUserByEmail() is not
-- reachable without introducing a new privileged credential. A tokenised
-- invite the admin shares is the same mechanism Odoo and Dynamics expose
-- alongside email, needs no new secret, and is honest about what it does.
--
-- SECURITY -- THE INVITE IS BOUND TO ITS EMAIL. accept_org_invite() below
-- refuses a token whose email does not match the redeeming user's own
-- profile email. A leaked link therefore grants nothing to a third party;
-- it is a convenience for delivery, not a bearer credential.
create table if not exists public.org_invites (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  email text not null,
  role text not null default 'member',
  token text not null unique,
  invited_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '14 days'),
  accepted_at timestamptz,
  accepted_by uuid references public.profiles(id) on delete set null,
  revoked_at timestamptz,
  constraint org_invites_role_check
    check (role in ('owner', 'admin', 'pm', 'site_engineer', 'member', 'client_viewer'))
);

create index if not exists org_invites_org_idx
  on public.org_invites (organization_id, created_at desc);

-- At most ONE live invite per (org, email). A re-invite must revoke or
-- consume the old one first, so a revoked invite can never be resurrected
-- by issuing a second link to the same person.
create unique index if not exists org_invites_one_pending_per_email
  on public.org_invites (organization_id, lower(email))
  where accepted_at is null and revoked_at is null;

alter table public.org_invites enable row level security;

-- Reads/writes through an ordinary user session are limited to org admins,
-- mirroring ROLE_GROUPS.ORG_ADMIN in src/lib/supabase/auth-guard.ts. The
-- INVITEE never selects from this table directly -- they cannot, they are
-- not a member yet -- which is exactly why redemption goes through the
-- security-definer function below rather than a policy.
create policy "org admins can view their organization's invites"
  on public.org_invites for select
  using (
    exists (
      select 1 from public.memberships m
      where m.organization_id = org_invites.organization_id
        and m.user_id = auth.uid()
        and m.role in ('owner', 'admin')
    )
  );

create policy "org admins can create invites in their organization"
  on public.org_invites for insert
  with check (
    exists (
      select 1 from public.memberships m
      where m.organization_id = org_invites.organization_id
        and m.user_id = auth.uid()
        and m.role in ('owner', 'admin')
    )
  );

create policy "org admins can revoke their organization's invites"
  on public.org_invites for update
  using (
    exists (
      select 1 from public.memberships m
      where m.organization_id = org_invites.organization_id
        and m.user_id = auth.uid()
        and m.role in ('owner', 'admin')
    )
  );

-- Redemption. security definer because the caller is BY DEFINITION not yet
-- a member of the target org, so no RLS policy on org_invites or
-- memberships could let them read the invite or insert their own row.
-- Every branch that could grant access is checked explicitly, and the
-- email binding is what stops a leaked link being useful to anyone else.
create or replace function public.accept_org_invite(p_token text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_invite public.org_invites;
  v_uid uuid := auth.uid();
  v_email text;
begin
  if v_uid is null then
    raise exception 'You must be signed in to accept an invitation.' using errcode = '28000';
  end if;

  select * into v_invite from public.org_invites where token = p_token;
  if not found then
    raise exception 'This invitation link is not valid.' using errcode = 'P0002';
  end if;
  if v_invite.revoked_at is not null then
    raise exception 'This invitation has been revoked.' using errcode = 'P0001';
  end if;
  if v_invite.accepted_at is not null then
    raise exception 'This invitation has already been used.' using errcode = 'P0001';
  end if;
  if v_invite.expires_at < now() then
    raise exception 'This invitation has expired. Ask an administrator for a new one.' using errcode = 'P0001';
  end if;

  select email into v_email from public.profiles where id = v_uid;
  if v_email is null or lower(v_email) <> lower(v_invite.email) then
    raise exception 'This invitation was issued to a different email address.' using errcode = 'P0001';
  end if;

  insert into public.memberships (user_id, organization_id, role)
  values (v_uid, v_invite.organization_id, v_invite.role)
  on conflict (user_id, organization_id) do nothing;

  update public.org_invites
     set accepted_at = now(), accepted_by = v_uid
   where id = v_invite.id;

  insert into public.security_audit_log (event, target_user_id, target_email, actor, metadata)
  values (
    'org_invite.accepted', v_uid, v_invite.email, v_uid::text,
    jsonb_build_object('organization_id', v_invite.organization_id, 'role', v_invite.role)
  );

  return v_invite.organization_id;
end;
$$;

revoke all on function public.accept_org_invite(text) from public;
grant execute on function public.accept_org_invite(text) to authenticated;

-- Lets an invited person see WHO invited them and to WHAT before they
-- accept, without exposing the token, the email or anything else in the
-- table. Returns org name + role only.
create or replace function public.org_invite_preview(p_token text)
returns table (organization_name text, role text, expires_at timestamptz, is_open boolean)
language sql
security definer
set search_path = public
stable
as $$
  select o.name,
         i.role,
         i.expires_at,
         (i.accepted_at is null and i.revoked_at is null and i.expires_at >= now())
  from public.org_invites i
  join public.organizations o on o.id = i.organization_id
  where i.token = p_token;
$$;

revoke all on function public.org_invite_preview(text) from public;
grant execute on function public.org_invite_preview(text) to authenticated, anon;
