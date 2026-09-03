import { redirect } from "next/navigation";

// R67 E-02 (R-012): "Retire /dashboard/hierarchy as a destination: move its
// Company and Department selects into a Filter drawer on the home."
//
// Those two selects, and the date range, now live in
// src/components/dashboard/DashboardFilterDrawer.tsx on /dashboard, where they
// re-query the real org payload through the URL (?companyId&departmentId&from&to)
// rather than fanning out one request per project from the browser the way
// this screen did. Its category-distribution charts moved to the per-project
// dashboard, fed by the project-scoped /api/reports/category-progress.
//
// A REDIRECT, NOT A DELETION: this URL is bookmarked, is in the audit's own
// screenshots, and was in the sidebar until this change. Deleting the page
// would turn all of those into a 404. Keeping the file also keeps
// src/lib/nav-routes.ts's SHIPPED_ROUTES exact with no edit --
// nav-routes.test.ts regenerates that list from the page.tsx files on disk and
// fails in both directions.
//
// The nav ENTRY ("Company Dashboard") is what was removed, in
// src/components/AppSidebar.tsx, so the module directory stops offering a door
// to a room whose furniture is now on the home page.
export default function DashboardHierarchyPage() {
  redirect("/dashboard");
}
