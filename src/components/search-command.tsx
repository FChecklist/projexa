"use client";

// Real command-palette search -- same UX pattern as compliance-tracker's
// search-command.tsx (Cmd+K/Ctrl+K, debounced query, grouped results), but
// with only the "Standard" (keyword) mode: no AI-semantic tab, since
// semantic/embedding search is explicitly out of scope for this build.
// Groups match PROJEXA's own real entities (see src/lib/services/
// search-service.ts): the org's projects, the current project's RFIs/
// submittals/punch list/change orders (VERIDIAN-backed), and PROJEXA's own
// local todos.
import { Suspense, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Search, Building2, FileQuestion, FileCheck, ListChecks, FileEdit, ListTodo } from "lucide-react";
import {
  CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList,
} from "@/components/ui/command";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

type ResultItem = {
  type: "project" | "rfi" | "submittal" | "punch_list" | "change_order" | "todo";
  id: string;
  title: string;
  status?: string | null;
  projectId?: string;
};

type SearchResults = {
  projects: ResultItem[];
  rfis: ResultItem[];
  submittals: ResultItem[];
  punchList: ResultItem[];
  changeOrders: ResultItem[];
  todos: ResultItem[];
};

const EMPTY_RESULTS: SearchResults = { projects: [], rfis: [], submittals: [], punchList: [], changeOrders: [], todos: [] };

const GROUPS: { key: keyof SearchResults; heading: string; icon: typeof Search; route: (item: ResultItem) => string }[] = [
  { key: "projects", heading: "Projects", icon: Building2, route: () => "/dashboard" },
  { key: "rfis", heading: "RFIs", icon: FileQuestion, route: (i) => `/rfis?projectId=${encodeURIComponent(i.projectId ?? "")}` },
  { key: "submittals", heading: "Submittals", icon: FileCheck, route: (i) => `/submittals?projectId=${encodeURIComponent(i.projectId ?? "")}` },
  { key: "punchList", heading: "Punch List", icon: ListChecks, route: (i) => `/punch-list?projectId=${encodeURIComponent(i.projectId ?? "")}` },
  { key: "changeOrders", heading: "Change Orders", icon: FileEdit, route: (i) => `/change-orders?projectId=${encodeURIComponent(i.projectId ?? "")}` },
  { key: "todos", heading: "To-Dos", icon: ListTodo, route: () => "/dashboard" },
];

let openDialog: (() => void) | null = null;

function SearchDialog({ projectId }: { projectId: string | null }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResults | null>(null);
  const [loading, setLoading] = useState(false);
  const router = useRouter();
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    openDialog = () => setOpen(true);
    return () => {
      openDialog = null;
    };
  }, []);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setOpen((prev) => !prev);
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, []);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);

    if (!query.trim()) {
      setResults(null);
      setLoading(false);
      return;
    }

    setLoading(true);
    debounceRef.current = setTimeout(async () => {
      try {
        const params = new URLSearchParams({ q: query, limit: "8" });
        if (projectId) params.set("projectId", projectId);
        const res = await fetch(`/api/search?${params.toString()}`);
        if (res.ok) {
          const data = await res.json();
          setResults(data.results ?? null);
        } else {
          setResults(null);
        }
      } catch {
        setResults(null);
      } finally {
        setLoading(false);
      }
    }, 300);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, projectId]);

  function handleSelect(group: (typeof GROUPS)[number], item: ResultItem) {
    setOpen(false);
    setQuery("");
    setResults(null);
    router.push(group.route(item));
  }

  const total = results ? GROUPS.reduce((n, g) => n + results[g.key].length, 0) : 0;

  return (
    <CommandDialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) {
          setQuery("");
          setResults(null);
        }
      }}
      title="Search"
      description="Search across projects, RFIs, submittals, punch list items, change orders, and to-dos."
    >
      <CommandInput placeholder="Search…" value={query} onValueChange={setQuery} />
      <CommandList>
        <CommandEmpty>
          {loading ? "Searching..." : query && total === 0 ? "No results found." : "Type to search..."}
        </CommandEmpty>
        {results && GROUPS.map((group) => {
          const items = results[group.key];
          if (items.length === 0) return null;
          const Icon = group.icon;
          return (
            <CommandGroup key={group.key} heading={group.heading}>
              {items.map((item) => (
                <CommandItem
                  key={`${group.key}-${item.id}`}
                  value={`${group.key}-${item.id}-${item.title}`}
                  onSelect={() => handleSelect(group, item)}
                  className="flex items-center justify-between gap-2 cursor-pointer"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <Icon className="size-4 shrink-0 text-px-muted" />
                    <span className="truncate text-sm font-medium">{item.title}</span>
                  </div>
                  {item.status && (
                    <Badge variant="outline" className="shrink-0 text-[10px]">
                      {item.status.replace(/_/g, " ")}
                    </Badge>
                  )}
                </CommandItem>
              ))}
            </CommandGroup>
          );
        })}
      </CommandList>
    </CommandDialog>
  );
}

// Isolates useSearchParams() behind a Suspense boundary, same convention as
// AppSidebar.tsx's SidebarInnerWithProject.
function SearchDialogWithProject() {
  const searchParams = useSearchParams();
  return <SearchDialog projectId={searchParams.get("projectId")} />;
}

export function SearchTrigger() {
  return (
    <>
      <Suspense fallback={<SearchDialog projectId={null} />}>
        <SearchDialogWithProject />
      </Suspense>
      <Button
        variant="ghost"
        size="sm"
        onClick={() => openDialog?.()}
        aria-label="Search"
        className="gap-1.5 px-2.5 text-ct-muted hover:bg-ct-cloud hover:text-ct-navy"
      >
        <Search className="size-4" />
        <span className="hidden md:inline text-sm">Search</span>
        <kbd className="hidden lg:inline-flex items-center gap-0.5 text-[10px] font-medium opacity-70">
          <span className="text-xs">⌘</span>K
        </kbd>
      </Button>
    </>
  );
}
