-- P2.1 fixture: destructive migration with NO override marker, should FAIL the guard.
alter table "public"."organizations" drop column "test_p2_1_marker";

drop table "public"."test_p2_1_widget";

truncate table "public"."notifications";
