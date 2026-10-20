# Fix the errors - one page for the owner

PROJEXA writes down every error a user hits, with the steps they took. When YOU decide, Claude Code reads the open ones, fixes them in the code, and tells you what it changed. Nothing runs by itself and nothing is built into the app.

## What you say

Open Claude Code in the PROJEXA folder and type:

> **Fix the open errors**

That is all. Do it as often as you like (daily, weekly, before a demo).

## One-time setup (3 steps)

1. Create a file named `.env.local` in the PROJEXA folder (if it is not there) and add two lines: `VERIDIAN_API_KEY=<your owner API key>` and, optionally, `VERIDIAN_REPO_PATH=C:\ct\compliance-tracker` (where the backend code lives, so Claude can fix backend errors too). The key never goes into git.
2. Open the PROJEXA folder in a terminal (or in the Claude Code desktop app, choose the folder).
3. Start Claude Code there (`claude`) and say: Fix the open errors.

## Instructions to Claude (do exactly this)

1. Run `node scripts/error-triage/pull-errors.mjs` (add `--limit N` or `--project <id>` if asked). It writes `ERROR_QUEUE/<today>.md`. If it prints a problem in plain words (missing key, refused key, no internet), stop and tell the owner that sentence.
2. Read the queue file. Work the issues in the order listed (most serious first). For each issue:
   1. Use the "Steps the person took", stack, route and API call, and the "Where to look" hint to find the cause in this repo and, when the hint points at `src/app/api/v1/...`, in compliance-tracker via `VERIDIAN_REPO_PATH`. Reproduce it if you can.
   2. Make the smallest correct fix. No refactors.
   3. Add or update a test that FAILS without your fix and passes with it. Run only the targeted test file(s) (`bun test --isolate <file> --timeout 60000`), never the full suite, no dev server. If a test is truly impossible, you must say why in the summary.
   4. Commit on a branch and open a PR following the repo rules (`git commit -F file`, PR via `gh.exe`, wait for CI, merge on green when authorised).
   5. Record it: `node scripts/error-triage/record-fix.mjs --issue <id> --summary "plain English" --file <path> --change "what changed" [--file ... --change ...] --commit <sha>`. The server refuses "fixed" without a summary and at least one file.
3. Never mark an issue fixed without a test, or without a stated reason in the summary why no test was possible.
4. If you cannot reproduce or find the cause, do NOT mark it fixed. Leave it open and say so in your report (for noise that is not a real bug, use `--ignore <id> --reason "why"`).
5. At the end print a short table titled "What I fixed": issue, file path, what changed (plain words). Also list anything left open and why.

Use `--dry-run` on record-fix to preview what would be sent.

## If a fixed error comes back

The system watches for it. If an error you marked fixed happens again, it is reopened automatically (the queue shows "came back N time(s)" with the earlier fix noted), and the next "Fix the open errors" picks it up first-class like any other.
