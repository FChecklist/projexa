# Organisation kinds and "as per role" on the laptop (package lf-e7)

Requirements R4 / G5 / R12: the laptop holds the person's projects AND their organisation's master data, exactly as their role allows,
and stays in step when the role, the organisation's cost-visibility setting or the server's data epoch changes. Backend: compliance-tracker
`supabase/functions/projexa-sync/README.md` ("Organisation kinds"), drizzle/0684 and 0686.

## What the client engine does

| Piece | File | Behaviour |
|---|---|---|
| Wire | `sync-client.ts` | manifest `org_kinds` + `org_view_class`; page `view_class` / `org_view_class` / `sig3`; feed `reset_required` + `epoch`; `heads()` (GET /heads). `ORG_PROJECT = "__org__"`. |
| Copy | `replica.ts` + `replica-org.ts` | A WHOLE run copies every kind of `org_kinds` under project `__org__`: same keyset pull and cursor, pull by ids, id-inventory repair, organisation feed, versions, dirty-row rules, signature + key id kept. A viewer gets `cost_visibility` only and asks for nothing else. |
| Scheduler round | `replica-org.ts` `checkOrganisation` | A one-project run with no kind (the scheduler's round) checks the organisation at most hourly: ONE `GET /heads`, plus one `/changes {project_id:"__org__"}` only when its head moved. Older service (no /heads): the one `/changes`. A screen's kind-scoped run never does. |
| Role / class / epoch | `replica-class.ts` | The class each project (and `__org__`) was pulled under is recorded (`sync:class:<project>`). A manifest, a page or /heads naming another class resets that project (clean rows + positions dropped, pulled again); a page of another class is never stored. An org kind the role lost is dropped. A new epoch (`sync:epoch`) resets everything. `reset_required` resets one project. Dirty rows, outbox ops and drafts are never touched. Then one more run, silently. |
| Prune floor | `replica.ts` `applyChanges` | The overlap re-read refused under a floor is retried from the laptop's own position and remembered (`noOverlapBelow`); a head below the server's own floor for a position taken < 1 day ago is not a reset loop. |
| Reads | `org-local.ts` `loadOrgLocal(kind)` | `not_allowed` / `not_synced` / `local`; laptop only; untrusted rows filtered. |
| Masters | `shell/modules/org-masters.ts` | `vendorNames`, `customerNames`, `companyNames`, `peopleNames`, `peoplePicker`, `departmentPicker`, `boqCategoryPicker`, `moneyMasters` + `formatInBase`, `costRule` / `hiddenCostFields` (the server's rule). One interface: `orgMasters`. |
| Peers | `peer/protocol.ts`, `peer/verify.ts` | `__org__` is shared only when both server-signed tokens carry `org_view` and it is equal; `org_people` never moves. Today's /attest sends no `org_view`, so organisation rows do not move between laptops yet. |

## Wiring for module screens (one line each, for the integrator; module files were not edited)

- materials (`materials-adapter.ts`, receipts' Vendor column): `const vendors = await orgMasters.vendorNames({ db })` and print `vendors.state === "local" ? vendors.names.get(r.vendor_id) ?? r.vendor_id : r.vendor_id`.
- work progress (`work-progress-adapter.ts`, "recorded by"): `orgMasters.peopleNames({ db })`, same pattern.
- design change / change orders (`DesignChangeShared.tsx` money): `const m = await orgMasters.moneyMasters({ db }); formatInBase(value, m.state === "local" ? m.base : null) ?? <today's CURRENCY_FALLBACK_LABEL text>`.
- assignment pickers: `orgMasters.peoplePicker({ db })` / `orgMasters.departmentPicker({ db })`; `not_allowed` -> `orgStateWords("not_allowed", "people")`.
- any screen that derives a cost figure locally: `const rule = await orgMasters.costRule(role, { db }); if (rule.state === "local") hide(rule.hidden(moneyColumns))`, else keep hiding as today.

## Tests

`sync-client-org.test.ts`, `replica-org.test.ts`, `replica-class.test.ts`, `org-local.test.ts`, `shell/modules/org-masters.test.ts`,
`peer/org-peer.test.ts`, and section O (W40-W47) of `conformance/wire.integration.test.ts` against the real handler (`CT_ROOT`).
