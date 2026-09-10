-- P2.1 fixture: drop-and-recreate a CHECK constraint to widen it, and drop a
-- default/not-null -- all schema-only, no data loss. Should PASS the guard.
-- Mirrors the real, already-applied drizzle/0012_membership_roles_pm_site_engineer.sql.
alter table "public"."test_p2_1_widget"
  drop constraint if exists "test_p2_1_widget_status_check";

alter table "public"."test_p2_1_widget"
  add constraint "test_p2_1_widget_status_check"
  check ("status" in ('a', 'b', 'c'));

alter table "public"."test_p2_1_widget"
  alter column "note" drop not null;

alter table "public"."test_p2_1_widget"
  alter column "note" drop default;
