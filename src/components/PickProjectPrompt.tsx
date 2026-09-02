"use client";

// R67 lane D22 (item D-41): the "nothing is selected yet" state for a
// project-scoped screen.
//
// It exists because the old /budgets answered that state with "No budgets
// found." -- a sentence that describes the DATA when the real situation is
// that the user has not told the app which project they mean. A screen that
// needs a selection says so, and then puts the cursor in the control that
// makes it, rather than leaving the reader to discover the rail on their own.
//
// The rail's own control is ProjectSwitcher's Select trigger, marked with
// data-project-switcher for exactly this. If the rail is not rendering one
// (the org has 0 or 1 projects, so ProjectSwitcher deliberately renders
// nothing) the button is not shown at all -- never a control that focuses
// something that is not there.
import { useEffect, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

export default function PickProjectPrompt({ message }: { message: string }) {
  const [hasSwitcher, setHasSwitcher] = useState(false);

  useEffect(() => {
    setHasSwitcher(!!document.querySelector<HTMLElement>("[data-project-switcher]"));
  }, []);

  function focusSwitcher() {
    const el = document.querySelector<HTMLElement>("[data-project-switcher]");
    if (!el) return;
    el.scrollIntoView({ block: "nearest" });
    el.focus();
  }

  return (
    <Card>
      <CardContent className="flex flex-col items-center gap-3 p-8 text-center">
        <p className="text-sm text-px-muted">{message}</p>
        {hasSwitcher && (
          <Button variant="outline" size="sm" onClick={focusSwitcher}>Pick a project</Button>
        )}
      </CardContent>
    </Card>
  );
}
