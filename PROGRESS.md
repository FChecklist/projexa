# PROGRESS -- task-20260727-122821-projexa-e2e--pwa-offline-sync---real-tas

## Completed
- [x] Phase 0 investigation confirmed (per SPEC KNOWN_CONTEXT): PWA infra absent, offline/IndexedDB absent, dependency-blocking absent in compliance-tracker's pms-issue-service.ts
- [x] Checked ai-os/boss/ACTIVE-CLAIMS.yaml in both repos, no real conflicting active claims found
- [x] Claimed scope in PROJEXA's ACTIVE-CLAIMS.yaml
- [x] Cloned compliance-tracker fresh into a dedicated task workspace (repo dir /opt/veridian/repos/compliance-tracker was dirty with unrelated in-flight sessions -- avoided editing it directly)
- [x] Claimed scope in compliance-tracker's ACTIVE-CLAIMS.yaml (branch feat/pms-dependency-blocking-enforcement), pushed

## Remaining
- [ ] PROJEXA: src/app/manifest.ts (PWA manifest, adapt compliance-tracker's working pattern, no share_target)
- [ ] PROJEXA: public/sw.js + client-component registration (offline app-shell caching)
- [ ] PROJEXA: IndexedDB (idb-keyval) offline queue for work-progress entries (qty/notes/photo blobs), visible "queued, will sync" UI, sync-on-reconnect to real constructionWorkProgressEntries API
- [ ] PROJEXA: Playwright E2E test -- offline entry queues locally, reconnect syncs server-side
- [ ] compliance-tracker: pms-issue-service.ts updateIssue() checks pmsIssueRelations before allowing "done" transition; addIssueRelation() rejects relation that would conflict with an already-completed successor
- [ ] compliance-tracker: test proving block-then-allow-after-predecessor-completes
- [ ] npx tsc --noEmit clean both repos; bun test passing both repos
- [ ] Lighthouse/equivalent real check confirming PWA manifest is valid+installable
- [ ] Open PRs against both repos through normal dispatch/review pipeline (no direct push to main)
