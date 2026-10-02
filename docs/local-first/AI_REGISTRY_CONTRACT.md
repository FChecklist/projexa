# The AI work link registry vs. this laptop (package lf-e11, 2026-10-02)

Generated from `src/lib/local-first/ai/__fixtures__/live-registry-contract.ts` (compliance-tracker@d1119f69, `src/lib/pipeline/function-registry.ts`)
and `src/lib/local-first/ai/function-registry.json`; enforced by `src/lib/local-first/ai/registry-contract.test.ts`.

Live registry: 159 function ids (reads, asks, runs and writes), 118 writes. "Copy" = the laptop's copy has the same declared and required
parameter names, role rank, money flag and link level as the live write. "Laptop writer" = a screen/outbox path that builds this op itself;
the contract test RUNS each one and checks the params it builds against the live names (all pass). The browser AI passes the AI's own params,
checked against the copy (declared names only, required present) before anything is queued.

Before lf-e11 the copy held 73 of these 118 writes (45 missing; of the 17 removals only `void_material_receipt` was there), and
`dispose_document` would have been an update an AI could send without the person's confirmation.

| function id | spec line | min rank | money | browser AI | laptop writer | copy == live |
|---|---|---|---|---|---|---|
| `add_boq_lines` | 859 | 2 | yes | create |  | PASS |
| `add_meeting_action_item` | 1307 | 2 |  | create |  | PASS |
| `add_meeting_outcome` | 1330 | 2 |  | create |  | PASS |
| `add_mood_board_item` | 1810 | 2 |  | create |  | PASS |
| `add_room` | 1900 | 2 |  | create |  | PASS |
| `add_roster_entry` | 194 | 2 | yes | create |  | PASS |
| `add_sprint_task` | 2087 | 2 |  | create |  | PASS |
| `answer_rfi` | 983 | 2 |  | update | local-writes.ts | PASS |
| `apply_boq_import` | 782 | 2 | yes | create |  | PASS |
| `approve_kpi_entry` | 1685 | 3 | yes | update |  | PASS |
| `approve_timesheet` | 673 | 3 |  | update | design-change-writes.ts | PASS |
| `archive_project` | 2401 | 3 |  | delete (draft) |  | PASS |
| `archive_task` | 2017 | 2 |  | delete (draft) |  | PASS |
| `cancel_change_order` | 2459 | 2 |  | delete (draft) |  | PASS |
| `capture_artifact` | 730 | 2 |  | create |  | PASS |
| `capture_schedule_baseline` | 1389 | 3 |  | create |  | PASS |
| `close_rfi` | 1000 | 2 |  | update |  | PASS |
| `close_sprint` | 2074 | 2 |  | update |  | PASS |
| `create_activity` | 907 | 2 |  | create |  | PASS |
| `create_boq` | 243 | 2 | yes | create |  | PASS |
| `create_boq_category` | 2467 | 2 |  | create |  | PASS |
| `create_boq_revision` | 267 | 2 | yes | create |  | PASS |
| `create_change_order` | 417 | 2 | yes | create | design-change-writes.ts | PASS |
| `create_company` | 2484 | 3 |  | create |  | PASS |
| `create_currency` | 2487 | 3 | yes | create |  | PASS |
| `create_customer` | 2478 | 2 | yes | create |  | PASS |
| `create_document` | 289 | 2 |  | create |  | PASS |
| `create_drawing` | 591 | 2 |  | create |  | PASS |
| `create_exchange_rate` | 2489 | 3 | yes | create |  | PASS |
| `create_ffe_item` | 1830 | 2 | yes | create |  | PASS |
| `create_floor_plan` | 1881 | 2 |  | create |  | PASS |
| `create_material` | 1240 | 2 | yes | create |  | PASS |
| `create_meeting` | 216 | 2 |  | create |  | PASS |
| `create_milestone` | 533 | 2 |  | create |  | PASS |
| `create_mom` | 618 | 2 |  | create |  | PASS |
| `create_mood_board` | 1790 | 2 |  | create |  | PASS |
| `create_permit` | 1702 | 2 |  | create |  | PASS |
| `create_progress_category` | 1134 | 2 |  | create |  | PASS |
| `create_progress_claim` | 1551 | 3 | yes | create |  | PASS |
| `create_project` | 811 | 2 |  | not offered (made online) |  | PASS |
| `create_punch_list_item` | 1054 | 2 |  | create |  | PASS |
| `create_rfi` | 960 | 2 |  | create | local-writes.ts | PASS |
| `create_schedule_task` | 508 | 2 |  | create | outbox.ts (recreate) | PASS |
| `create_site_diary` | 1103 | 2 |  | create |  | PASS |
| `create_site_instruction` | 442 | 2 |  | create |  | PASS |
| `create_sprint` | 2031 | 2 |  | create |  | PASS |
| `create_submittal` | 1013 | 2 |  | create |  | PASS |
| `create_vendor` | 2472 | 2 | yes | create |  | PASS |
| `create_wiki_page` | 1750 | 2 |  | create |  | PASS |
| `delete_attendance` | 2454 | 3 | yes | delete (draft) |  | PASS |
| `delete_boq` | 1961 | 3 | yes | delete (draft) |  | PASS |
| `delete_boq_category` | 2470 | 3 |  | delete (draft) |  | PASS |
| `delete_meeting` | 2464 | 2 |  | delete (draft) |  | PASS |
| `delete_mom` | 2189 | 2 |  | delete (draft) |  | PASS |
| `delete_permit` | 2388 | 2 |  | delete (draft) |  | PASS |
| `delete_progress_entry` | 2000 | 2 |  | delete (draft) |  | PASS |
| `delete_time_entry` | 2138 | 2 |  | delete (draft) |  | PASS |
| `dispose_document` | 2151 | 3 |  | delete (draft) |  | PASS |
| `draft_progress_claim` | 1575 | 3 | yes | update |  | PASS |
| `link_roster_employee` | 1525 | 0 |  | not usable (no link level / excluded) |  | PASS |
| `mark_punch_item_ready` | 1077 | 2 |  | update |  | PASS |
| `place_furniture` | 1921 | 2 |  | create |  | PASS |
| `publish_mom` | 1350 | 3 |  | update |  | PASS |
| `record_attendance` | 172 | 2 |  | create | delivery-writes.ts | PASS |
| `record_attendance_batch` | 1176 | 2 | yes | create |  | PASS |
| `record_customer_approval` | 1503 | 3 |  | create |  | PASS |
| `record_customer_complaint` | 1483 | 2 |  | create |  | PASS |
| `record_material_issue` | 1215 | 2 |  | create | delivery-writes.ts | PASS |
| `record_material_receipt` | 644 | 2 | yes | create | delivery-writes.ts | PASS |
| `record_timesheet` | 327 | 2 |  | create | design-change-writes.ts | PASS |
| `record_vendor_dispute` | 1463 | 2 | yes | create |  | PASS |
| `record_work_progress` | 139 | 2 |  | create | delivery-writes.ts | PASS |
| `reject_progress_claim` | 1609 | 3 | yes | update |  | PASS |
| `reject_timesheet` | 705 | 3 |  | update | design-change-writes.ts | PASS |
| `remove_mood_board_item` | 2350 | 2 |  | delete (draft) |  | PASS |
| `remove_placement` | 2302 | 2 |  | delete (draft) |  | PASS |
| `remove_room` | 2266 | 2 |  | delete (draft) |  | PASS |
| `remove_sprint_task` | 2101 | 2 |  | delete (draft) |  | PASS |
| `rename_boq_category` | 2468 | 3 |  | update |  | PASS |
| `review_submittal` | 1034 | 3 |  | update |  | PASS |
| `seal_boq` | 880 | 3 | yes | update |  | PASS |
| `set_progress_drawing` | 1440 | 2 |  | update |  | PASS |
| `submit_boq_for_approval` | 1646 | 3 | yes | update |  | PASS |
| `submit_change_order_for_approval` | 1626 | 3 | yes | update | design-change-writes.ts | PASS |
| `submit_kpi_entry` | 1663 | 2 | yes | update |  | PASS |
| `submit_progress_claim` | 1592 | 3 | yes | update |  | PASS |
| `submit_timesheet` | 688 | 2 |  | update | design-change-writes.ts | PASS |
| `update_activity` | 2447 | 2 |  | update |  | PASS |
| `update_attendance` | 2451 | 3 | yes | update |  | PASS |
| `update_boq` | 1947 | 2 |  | update |  | PASS |
| `update_boq_line` | 2461 | 2 |  | update |  | PASS |
| `update_boq_line_amounts` | 1978 | 3 | yes | update |  | PASS |
| `update_change_order` | 2456 | 2 | yes | update |  | PASS |
| `update_customer` | 2481 | 2 | yes | update |  | PASS |
| `update_document_metadata` | 1730 | 2 |  | update | documents-writes.ts | PASS |
| `update_ffe_status` | 1861 | 3 | yes | update |  | PASS |
| `update_floor_plan_status` | 2316 | 2 |  | update |  | PASS |
| `update_line_item_budget` | 481 | 3 | yes | update |  | PASS |
| `update_material` | 2222 | 2 | yes | update |  | PASS |
| `update_meeting` | 2202 | 2 |  | update |  | PASS |
| `update_milestone` | 553 | 2 |  | update |  | PASS |
| `update_mom_details` | 2168 | 2 |  | update |  | PASS |
| `update_mom_minutes` | 1287 | 2 |  | update | documents-writes.ts | PASS |
| `update_mood_board` | 2330 | 2 |  | update |  | PASS |
| `update_permit` | 2365 | 2 |  | update |  | PASS |
| `update_placement` | 2280 | 2 |  | update |  | PASS |
| `update_progress_category` | 2449 | 2 |  | update |  | PASS |
| `update_progress_entry` | 1151 | 2 | yes | update |  | PASS |
| `update_project` | 831 | 2 | yes | update |  | PASS |
| `update_room` | 2245 | 2 |  | update |  | PASS |
| `update_roster_entry` | 1193 | 2 | yes | update |  | PASS |
| `update_sprint` | 2052 | 2 |  | update |  | PASS |
| `update_task` | 1406 | 2 |  | update | local-writes.ts | PASS |
| `update_time_entry` | 2115 | 2 | yes | update |  | PASS |
| `update_vendor` | 2475 | 2 | yes | update |  | PASS |
| `update_wiki_page` | 1770 | 2 |  | update |  | PASS |
| `verify_punch_item_closed` | 1090 | 3 |  | update |  | PASS |
| `void_material_receipt` | 1263 | 3 | yes | delete (draft) |  | PASS |
