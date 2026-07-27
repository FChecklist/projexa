-- Owner directive PROJEXA_ERP_END_TO_END_REQUIREMENT_ANALYSIS_GAP_FILL_AND_
-- IMPLEMENTATION: PROJEXA's memberships.role check constraint (see
-- drizzle/0001_projexa_tenant_schema.sql) only ever allowed
-- 'owner' | 'admin' | 'member', which is thinner than the Owner's real
-- 5-role matrix (Super Admin, Org Admin, PM, Site Engineer, Client Viewer).
-- Adds 'pm', 'site_engineer', and 'client_viewer' as real PROJEXA-native
-- roles alongside the existing 3 -- see src/lib/supabase/auth-guard.ts's
-- OrgRole type/ROLE_GROUPS for why client_viewer is native here rather than
-- routed through VERIDIAN's own client_viewer concept (PROJEXA's server
-- routes call VERIDIAN with one shared per-org API key, not a per-user
-- VERIDIAN identity, so there is nothing on the VERIDIAN side to gate a
-- per-user role against at this boundary).
--
-- Applied directly to the projexa Supabase project via Supabase MCP, same
-- as every prior migration in this directory; this file is the durable
-- repo record of that DDL.
alter table public.memberships
  drop constraint if exists memberships_role_check;

alter table public.memberships
  add constraint memberships_role_check
  check (role in ('owner', 'admin', 'pm', 'site_engineer', 'member', 'client_viewer'));
