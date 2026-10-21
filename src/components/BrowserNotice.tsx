"use client";

// BROWSER AND DEVICE PROBLEMS, said in full where the person will see them (the sign-in page, the install menu). One guided panel per problem;
// see src/lib/browser-check.ts for what is detected and g4-session-laptop.ts for the words. Nothing here opens a database or fetches anything.

import { GuidedPanel } from "@/components/GuidedPanel";
import { currentScreen } from "@/lib/error-guide/context";
import type { BrowserProblem } from "@/lib/browser-check";

export function BrowserNotice({ problems }: { problems: BrowserProblem[] }) {
  if (problems.length === 0) return null;
  const screen = currentScreen();
  return (
    <div className="space-y-2" data-testid="browser-notice">
      {problems.map((p) => (
        <GuidedPanel key={p.code} ctx={{ route: screen.route, search: screen.search, code: p.code, serverMessage: p.detail }} testId={`browser-problem-${p.code}`} />
      ))}
    </div>
  );
}

export default BrowserNotice;
