-- P2.1 fixture: narrowing ALTER COLUMN ... TYPE, should FAIL the guard (can silently drop/truncate data on cast).
alter table "public"."test_p2_1_widget"
  alter column "id" type varchar(8);
