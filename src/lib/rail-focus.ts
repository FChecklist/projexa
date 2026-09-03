// R67 D-51 -- "a 'Change project' link that focuses the top-rail switcher".
//
// The rail is the kit's own TopRail component (M24: "THE PROJECT MUST BE
// VISIBLE AT ALL TIMES ... logging progress or a variation against the wrong
// project is the most expensive mistake available in this product"). Its
// project button is the one control that changes the project, and the kit gives
// it a stable, deliberate accessible name -- `Project: <name>. Click to switch
// project.` or `No project selected. Click to choose a project.` -- so a screen
// can reach it without the shell being forked or a new prop being threaded
// through every page.
//
// WHY NOT A FORK OR A PROP. Forking TopRail (D-09's mechanism) would clone a
// component this item does not otherwise change, and threading a callback from
// M24Shell down through every page.tsx into every form would touch fifty files
// for one link. Matching on the aria-label the kit itself authored is the
// smallest honest coupling, and it fails SOFTLY: if the rail is not on screen
// (or the kit renames the label) this returns false and the caller says so,
// rather than throwing or pretending it worked.

const PROJECT_BUTTON_SELECTORS = [
  'header button[aria-label^="Project:"]',
  'header button[aria-label^="No project selected"]',
];

/**
 * Moves keyboard focus to the top rail's project switcher.
 * Returns false when the rail is not present, which the caller must handle.
 */
export function focusRailProjectSwitcher(): boolean {
  if (typeof document === "undefined") return false;
  try {
    for (const selector of PROJECT_BUTTON_SELECTORS) {
      const button = document.querySelector<HTMLElement>(selector);
      if (button) {
        button.scrollIntoView?.({ block: "nearest" });
        button.focus();
        return true;
      }
    }
  } catch {
    // A DOM that refuses querySelector/focus (a non-browser test environment,
    // a detached document) must not take the form down with it.
  }
  return false;
}
