-- P2.1 fixture: additive-only migration, should PASS the guard.
alter table "public"."organizations"
  add column if not exists "test_p2_1_marker" text;

create table if not exists "public"."test_p2_1_widget" (
  "id" uuid primary key default gen_random_uuid(),
  "created_at" timestamptz not null default now()
);

create index if not exists "test_p2_1_widget_created_at_idx"
  on "public"."test_p2_1_widget" ("created_at");
