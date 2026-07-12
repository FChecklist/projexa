"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Building2 } from "lucide-react";

type Project = { id: string; name: string };

// Lets the user pick which project the 17 project-scoped pages (RFIs,
// Scope, Labour, Schedule, ...) render data for. Selection is carried via
// a `?projectId=` search param rather than any client-side global state,
// so it's visible in the URL, shareable, survives a refresh, and each
// Server Component page can read it directly -- see resolveSelectedProject
// in src/lib/project-selection.ts, which every one of those pages calls.
//
// `pathname` and `projectId` are passed in from AppSidebar (which already
// resolves them via usePathname/useSearchParams) rather than read here, so
// this component doesn't need its own Suspense boundary for useSearchParams.
export function ProjectSwitcher({ pathname, projectId }: { pathname: string; projectId: string | null }) {
  const router = useRouter();
  const [projects, setProjects] = useState<Project[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/projects")
      .then((res) => (res.ok ? res.json() : { projects: [] }))
      .then((data: { projects?: Project[] }) => {
        if (!cancelled) setProjects(data.projects ?? []);
      })
      .catch(() => {
        if (!cancelled) setProjects([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Nothing to switch between yet (still loading, org has 0 or 1 projects) --
  // stay out of the way rather than showing a dropdown with nothing useful in it.
  if (!projects || projects.length <= 1) return null;

  const selectedId = projectId && projects.some((p) => p.id === projectId) ? projectId : projects[0].id;

  function handleChange(id: string) {
    router.push(`${pathname}?projectId=${encodeURIComponent(id)}`);
  }

  return (
    <div className="px-3 pb-3">
      <Select value={selectedId} onValueChange={handleChange}>
        <SelectTrigger
          size="sm"
          className="w-full border-px-ink2 bg-px-ink2 text-px-cloud data-[placeholder]:text-px-cloud2 [&_svg:not([class*='text-'])]:text-px-cloud2"
        >
          <Building2 className="size-3.5 shrink-0" />
          <SelectValue placeholder="Select project" />
        </SelectTrigger>
        <SelectContent>
          {projects.map((p) => (
            <SelectItem key={p.id} value={p.id}>
              {p.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
