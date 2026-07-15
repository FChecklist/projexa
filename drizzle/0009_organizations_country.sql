-- Priority 19 Part 2, Workstream C (2026-07-15): UAE tax-field leak fix.
--
-- Root cause, corrected from the plan's original assumption: PLATFORM-01
-- Wave 2 already added `organisations.country` on compliance-tracker's own
-- backend DB, keyed by VERIDIAN org_id. But every real PROJEXA org's ERP
-- write path shares ONE VERIDIAN org_id ('projexa_demo_org', see
-- PROJEXA-NO-TENANT-ISOLATION-01 / PROJEXA-IDENTITY-BRIDGE-01 --
-- veridian_credentials.veridian_org_id is null for every real PROJEXA org
-- except the 2 real-signup PLATFORM-01 test orgs), so that column's single
-- shared value cannot distinguish Al Maha Skyline (UAE) from Meridian
-- Skyline Group (India) or any other PROJEXA tenant -- gating PROJEXA's UI
-- on it would either show or hide the India-specific fields identically for
-- every PROJEXA org, not per-tenant.
--
-- PROJEXA's OWN `organizations` table, by contrast, IS genuinely per-tenant
-- (confirmed by Priority 19 Part 1's own finding: the Team/Settings page,
-- which reads from this table, correctly isolates each org's members with
-- zero cross-org leakage -- unlike the ERP/business-data layer). So this is
-- the correct place to add `country`: additive, nullable, defaults 'IN' to
-- match compliance-tracker's own column default and this codebase's
-- existing "India is the historical default" convention. Not a change to
-- the `memberships` table or any auth/role shape.
alter table public.organizations
  add column if not exists country text default 'IN';

comment on column public.organizations.country is
  'ISO 3166-1 alpha-2 country code for this PROJEXA org. Nullable, defaults ''IN''. Drives country-conditional UI (e.g. hiding GSTIN/GST/India Income Tax Slab fields for non-IN orgs) -- see src/hooks/use-org-role.ts and CustomersClient.tsx/VendorsClient.tsx/PayrollClient.tsx. Deliberately independent of compliance-tracker''s organisations.country, which is keyed by a VERIDIAN org_id every real PROJEXA org currently shares (PROJEXA-IDENTITY-BRIDGE-01) and so cannot serve as a per-tenant signal today.';
