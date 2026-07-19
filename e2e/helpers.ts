import type { Locator, Page } from "@playwright/test";

// Real, verified DOM fact (confirmed via Playwright accessibility snapshots
// while iterating on this suite against the live site): every form in this
// app follows the exact same shadcn pattern --
//   <div className="space-y-1.5"><Label>Field Name</Label><Input/></div>
// -- with NO `htmlFor`/`id` association between Label and Input (grep of
// src/components/ui/label.tsx + every *Client.tsx form confirms this is
// systemic, not a one-off). `page.getByLabel(...)` therefore never matches
// anything in this app. This helper locates the real control the same way
// a sighted user would -- the form element immediately following the
// label text within their shared wrapper -- instead.
export function fieldByLabel(scope: Locator, labelText: string): Locator {
  return scope.getByText(labelText, { exact: true }).first().locator("xpath=following-sibling::*[1]");
}

// The persistent app shell (sidebar project switcher `<select>`-like
// combobox, mounted once in (app)/layout.tsx) renders BEFORE any page's
// own content in the DOM, so an unscoped `page.getByRole("combobox").first()`
// silently grabs the project switcher instead of the page's own filter --
// a real trap this suite hit repeatedly while iterating. Scope real
// in-page filter controls to the active tab panel (Radix Tabs renders
// `[role=tabpanel]` for the active tab) or a dialog instead of the bare page.
export function activeTabPanel(page: Page): Locator {
  return page.getByRole("tabpanel");
}
