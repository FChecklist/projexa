# Vercel Deploy — Owner Guide

**Read this before you ever want a real deploy to go live again.** Written 2026-09-06
because Vercel credits ran out and this codebase's own AI sessions were using Vercel as a
place to test changes, not just to serve real customers — that's what this lockdown
stops. It does not stop as a REAL deploy from happening when you actually want one; it
just makes sure that only happens when you decide it, not as a side effect of someone
pushing code.

## The 4-step deploy procedure (do this, and only this, when you want a real deploy)

1. **Open the Vercel dashboard** for the project you want to deploy (`veridian-compliance-ai`
   or `projexa`), go to **Settings → Environment Variables**.
2. **Set `OWNER_DEPLOY_APPROVAL` to today's date**, in exactly this format: `2026-09-06`
   (UTC date, year-month-day, dashes, no time). This is the only step a session or agent
   can never do for you — that's the whole point.
3. **Push or redeploy as you normally would.** The next build will check that variable,
   see it matches today's date, and proceed. Any build the next day (or with the variable
   unset, blank, or in the wrong format) will be automatically skipped — no deploy happens.
4. **Afterward, clear or change the variable** (or just leave it — tomorrow it will no
   longer match "today", so it stops working on its own either way). If you want to be
   extra sure, delete it from the dashboard once the deploy you wanted has gone out.

That's the entire procedure. If someone (a session, an agent, a script) tells you a
deploy needs anything more than this — a code change, a different flag, "just this once"
— that is exactly the pattern this lockdown exists to stop. Point them at this file.

## What's protected, and how (for your own peace of mind, not something you need to do)

Three layers live in each repo's own code, so they hold even if a session forgets:

- **Nothing auto-deploys.** Every branch, including `main`, is configured to never
  trigger a deployment just from a push.
- **Even a manually-triggered build checks for your approval first**, using the
  variable above, before it does any real work.
- **A test that runs on every code change checks both of the above are still true**,
  and fails loudly (blocking that change from being merged) if either one gets weakened
  — accidentally or otherwise.

## What you still need to do yourself (this is the one open item)

**Remove the Vercel access token from this laptop, and disconnect the Vercel MCP
connection this Claude Code session uses.** The three layers above stop a normal push or
a normal build from deploying — they do not revoke the actual credential a session could,
in principle, still use to call Vercel's API directly. Removing the token is the only way
to close that off completely, and it's specifically an action only you can take (it's not
something a session should do to its own permissions). Where to look:
- This machine's environment/`.env.local` files for anything named `VERCEL_TOKEN`,
  `VERCEL_ACCESS_TOKEN`, or `VERCEL_OIDC_TOKEN`.
- Claude Code's own MCP connections list, for the Vercel connector.
- `vercel whoami` / `vercel logout` if the Vercel CLI is installed and logged in.

Until this is done, treat it as the one remaining gap — everything else in this guide
holds regardless.
