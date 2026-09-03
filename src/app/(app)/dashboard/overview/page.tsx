import { redirect } from "next/navigation";

// R67 E-21 (R-205). This route used to be a second, weaker copy of the home
// screen: a list of per-project progress bars whose numbers came from calling
// GET /dashboard/{projectId} once per project (src/lib/dashboard-overview.ts's
// fetchProjectProgressBars, now deleted) -- an N+1 over the VERIDIAN API for a
// figure /dashboard already had the rows for. getOrgDashboard now returns
// progressPercent per project on the ONE call the home page makes, so the home
// page carries the bars and this page has nothing left of its own to show.
//
// It REDIRECTS rather than being deleted, and stays registered in
// src/lib/nav-routes.ts, because the route is linked from real places (saved
// links, the OVERVIEW nav entry, prior screenshots) and a 404 is a worse
// answer than the screen the user was actually looking for.
export default function ProjectsOverviewPage() {
  redirect("/dashboard");
}
