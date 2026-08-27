-- Defense-in-depth hardening, not a fix for an active exploit. Found while
-- investigating platform.r43_faults R43_EXEC_03 (a confirmed FALSE POSITIVE
-- -- PROJEXA org bc689d97-2dd8-47ab-b5f7-5eb3d696ad34 and VERIDIAN org
-- ve45lczmkodbiq1m20fy48r5 are one tenant with two id namespaces, not two
-- tenants; RLS correctly isolates every org today -- live-verified: 59
-- visible rows for ve45lc, 0 foreign-org rows. That fault does not need
-- reopening.
--
-- The investigation surfaced this real, currently-benign, separate gap:
-- organization_id is this table's primary key, but veridian_org_id -- the
-- column compliance-tracker's own tenant isolation is entirely keyed on
-- (via the presented API key -> compliance.api_keys.org_id ->
-- compliance.current_org_id() -> RLS) -- had no uniqueness constraint at
-- all. Nothing today writes a duplicate (verified: 0 rows share a
-- veridian_org_id as of 2026-08-27), but nothing in the schema prevented a
-- future provisioning bug (e.g. a race in POST /api/org/repair or
-- POST /api/org/provision, both in src/app/api/org/) from ever writing the
-- same veridian_org_id for two different PROJEXA organization_id rows. If
-- that ever happened, it WOULD be a genuine cross-tenant leak --
-- compliance-tracker has no visibility into PROJEXA's organization_id
-- space to catch it, since it only ever sees veridian_org_id.
--
-- Verified zero violations immediately before applying:
--   select veridian_org_id, count(*) from public.veridian_credentials
--   group by veridian_org_id having count(*) > 1;
-- returned 0 rows.

ALTER TABLE public.veridian_credentials
  ADD CONSTRAINT veridian_credentials_veridian_org_id_unique UNIQUE (veridian_org_id);
