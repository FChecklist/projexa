"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Building2 } from "lucide-react";

type Project = { id: string; name: string };

// Same data source and same visual language as ProjectSwitcher.tsx (the
// top-rail one every ?projectId= page already uses), but this route is a
// real PATH segment (/workspace/[id]) rather than a query param, so
// switching project here navigates to a genuinely different URL instead of
// appending ?projectId= to the current one.
export function WorkspaceProjectSwitcher({ projectId, initialProjects }: { projectId: string; initialProjects: Project[] }) {
  const router = useRouter();
  const [projects, setProjects] = useState<Project[]>(initialProjects);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/projects")
      .then((res) => (res.ok ? res.json() : { projects: initialProjects }))
      .then((data: { projects?: Project[] }) => {
        if (!cancelled && Array.isArray(data.projects) && data.projects.length > 0) setProjects(data.projects);
      })
      .catch(() => {
        /* keep the server-provided initialProjects -- a failed refresh is not a reason to show nothing */
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (projects.length <= 1) return null;

  function handleChange(id: string) {
    router.push(`/workspace/${encodeURIComponent(id)}`);
  }

  return (
    <Select value={projectId} onValueChange={handleChange}>
      <SelectTrigger data-workspace-project-switcher size="sm" className="w-56">
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
  );
}
