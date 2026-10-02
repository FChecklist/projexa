# The on-laptop shell: how to add a module

PROJEXA's pages are server-rendered, so an app that works with no internet and with our server down needs a **static, client-rendered
shell**. That shell is `/local` (`src/app/local/page.tsx`, `src/app/local/[...path]/page.tsx`): one prerendered document, no server data.
The service worker (`src/lib/local-first/release/sw-core.ts`) serves it for any app URL when the browser is offline, when the network
fails, when our server answers 5xx, and -- once a release is installed and local-first mode is on -- **first**, so a page navigation costs
the server nothing. The shell draws the right screen in the browser, from the laptop's own database.

A module the shell does not have yet is **not broken**: online, the shell opens the same screen from the server (`/<path>?px-server=1`,
which tells the worker not to hand the shell back); offline, it says plainly that the screen is not on this laptop yet.

## One module = one file of screens + ~10 lines

1. **Read adapter** (`src/lib/local-first/shell/modules/<module>-adapter.ts`, plain TypeScript, no React). It reads the local database
   and returns exactly what the screen needs. Reuse the loaders that already exist:

   ```ts
   import { loadLocalFirst } from "../../local-reader";          // rows only when that (project, kind) was pulled to the end
   const result = await loadLocalFirst<unknown>("rfis", projectId, async () => [], { userId: data.userId, idb: data.idb });
   if (result.state !== "local") return { state: "not_synced", projectId };
   ```

   The replica's rows are **untrusted input** until they look like what the screen expects (see `isGatewayLine` in `boq-local.ts`): filter,
   never cast. Return a small tagged union (`no_project` / `not_synced` / `local` ...) so the screen can say a true, calm thing in each case.
   Never call the server from an adapter.

2. **Screens** (`modules/<Module>Screen.tsx`, `"use client"`, default export). They receive
   `{ shell, params, query, data }` (`ShellScreenProps<D>` in `types.ts`): `shell.data` (person, organisation, projects), `shell.projectId`,
   `shell.writer`, `shell.navigate`, `shell.connectivity`, `shell.refresh()`. Use plain `<a href="/rfis/42?projectId=...">` for links: the
   shell intercepts clicks on links to app pages. Never show an error dialog for being offline.

3. **Register it** in `src/lib/local-first/shell/route-table.ts` -- this is the whole registration:

   ```ts
   defineShellRoute({
     pattern: "/rfis/:id",                       // the app's own path; ":name" is a parameter
     title: "RFI",                               // document title
     nav: { label: "RFIs", order: 40 },          // optional: a link in the shell header (parameterless routes only)
     load: () => import("./modules/RfiObjectScreen"),
     adapter: (shell, params, query) => loadRfi(shell.data, params.id!, query.get("projectId")),
   }),
   ```

4. **Tests** (`route-table.test.ts` already proves every registered route loads a function component). Add: an adapter test against
   `fake-indexeddb` (seed the person's database as `scope-adapter.test.ts` does), and a render test in the style of `LocalShell.test.tsx`
   (network off, `fetch` spy, assert it was never called).

## Writes

A write goes through `shell.writer` (`ShellWriter`, `pending-edits.ts`): it is kept on the laptop at once, shown at once
(`applyPendingEdits` lays waiting edits over rows read from the replica), and sent when the laptop can reach the server. Today's writer
sends a BOQ line category through `PATCH /api/scope/line-items/<id>` (the route the online screen uses, so the server's role gate decides).
When `src/lib/local-first/outbox.ts` lands on `feat/lf-client-core`, a `ShellWriter` backed by it replaces `createEditQueue()` in
`LocalShell.tsx`; the screens do not change. **Money and approvals are never computed on the laptop**: send the person's intent, let the
server recompute.

## Rules the shell keeps (and tests pin)

- Nothing reachable from the two `/local` pages is a server module, and neither page reads the request
  (`src/app/local/local-shell-static.test.ts` walks the import graph).
- The first client render equals the prerendered HTML (a skeleton): the location is read in an effect, never in render.
- `/local` and `/local/**` are public in the page gate (`src/lib/authz/page-access.ts`); *who* is signed in comes from the identity kept on
  the laptop (`src/lib/local-first/identity.ts`), *what* they see comes from rows the sync service already scoped to their role.
- Per person: the shell reads `projexa-local:<userId>` only; a manifest or replica belonging to another person contributes nothing.
