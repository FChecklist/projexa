// R52 -- the shared rule behind three faults:
//   R46S11_01                                (/dashboard)
//   R48_OVERVIEW_ASSERTS_ZERO_PROJECTS_OVER_A_500_01  (/dashboard/overview)
//   R48_TWO_OF_THREE_PER_PAGE_500S_NEVER_SURFACED_01  (every page)
//
// THE RULE: a screen may only state a definite fact about the user's data
// when the read that would establish it SUCCEEDED. When the read failed, the
// true answer is "we could not find out" -- never "zero", never "none",
// never "nothing needs your attention".
//
// This is not the same rule as "show an error". Both of the first two faults
// DID show a truthful error, and then contradicted it one line below with a
// confident count. R48_OVERVIEW_... says so explicitly: the defect "belongs
// to whichever criterion owns EMPTY-STATE HONESTY -- the claim being false
// is the empty state, not the error."

/**
 * True only when the read succeeded, so an empty result really does mean
 * "there are none". Pass the same errorMessage the screen renders.
 */
export function mayAssertEmpty(errorMessage: string | null | undefined): boolean {
  return !errorMessage;
}

export type DashboardSummaryInput = {
  totalProjects: number;
  delayedProjectCount: number;
};

/**
 * The /dashboard greeting sentence.
 *
 * R46S11_01: when GET /api/projects 504'd, `data` was null and the greeting
 * read "No active projects yet — use VERI Chat below to get started." on the
 * PRIMARY owner-facing screen, while the org demonstrably had 5 active
 * projects (proven by the auditor's own retry). The error card below it said
 * the load had failed; the greeting above it reported a result anyway.
 *
 * `data` null + a failure => say the read failed.
 * `data` null + no failure => genuinely nothing yet.
 */
export function dashboardSummary(
  data: DashboardSummaryInput | null,
  errorMessage: string | null | undefined
): string {
  if (!data) {
    return mayAssertEmpty(errorMessage)
      ? "No active projects yet — use VERI Chat below to get started."
      : "Couldn't load your projects just now, so this screen can't show how many you have. The error below has the details.";
  }

  if (data.totalProjects === 0) {
    return mayAssertEmpty(errorMessage)
      ? "No active projects yet — use VERI Chat below to get started."
      : "Couldn't load your projects just now, so this screen can't show how many you have. The error below has the details.";
  }

  const plural = data.totalProjects === 1 ? "" : "s";
  const delayed = data.delayedProjectCount;
  const tail =
    delayed > 0
      ? `${delayed} of them ${delayed === 1 ? "has" : "have"} delayed tasks needing attention.`
      : "None of them have delayed tasks right now.";
  return `You have ${data.totalProjects} active project${plural}. ${tail}`;
}
