import { redirect } from "next/navigation";

// R67 E-01 (R-007). This screen WAS the project-rows-with-bars list, and the
// requirement it satisfied was written against it -- but almost nobody lands
// here: /dashboard is the product's HOME_ROUTE (see (app)/layout.tsx) and is
// where the composer, the module directory and every "go home" affordance
// point. So the rows moved onto the route users actually land on, and this
// route redirects there.
//
// A REDIRECT, NOT A DELETION, and the difference is the point: this URL is in
// the sidebar history, in bookmarks, in screenshots from the audit itself, and
// in at least one shared link. Deleting the page would turn every one of those
// into a 404; redirecting turns them into the screen the reader wanted. It
// also keeps src/lib/nav-routes.ts's SHIPPED_ROUTES honest with no edit --
// nav-routes.test.ts regenerates that list from the real page.tsx files on
// disk, and this is still one of them.
//
// The nav ENTRY is what was removed (src/components/AppSidebar.tsx's
// "Projects Overview"), so the module directory no longer offers two doors to
// one room; ProjectsOverviewClient.tsx and src/lib/dashboard-overview.ts stay
// on disk, unreferenced by this route, because the follow-on items in this
// workstream still have work against the project-row rendering and deleting
// them now would only make that a two-step change.
export default function ProjectsOverviewPage() {
  redirect("/dashboard");
}
