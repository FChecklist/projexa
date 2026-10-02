"use client";

// LOCAL-FIRST R10: the ONE small, calm way to keep PROJEXA on this laptop as an installed app. It is a single item in the account menu,
// shown only when the browser has actually offered installation and the app is not installed yet. No popup, no banner, no nagging: a
// person who ignores it never hears about it again.

import { Download } from "lucide-react";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { useInstallPrompt } from "@/lib/local-first/persistence";

export function InstallMenuItem() {
  const { canInstall, install } = useInstallPrompt();
  if (!canInstall) return null;
  return (
    <DropdownMenuItem className="gap-2" data-testid="install-pwa" onClick={() => void install()}>
      <Download className="size-4" />
      Install PROJEXA on this laptop
    </DropdownMenuItem>
  );
}
