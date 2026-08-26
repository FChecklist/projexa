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

// R52 / R48_GLOBAL_SEARCH_OPENS_NOTHING_01.
//
// THE RECORDED DIAGNOSIS -- "the advertised capability is entirely absent" --
// is wrong. The palette is fully built: a real debounced query, real grouped
// results, a real /api/search behind it. Only the button was disconnected
// from it, and by a race rather than a missing handler, which is why the click
// demonstrably landed (activeElement became the Search button) and still
// opened nothing.
//
// WHAT WAS THERE: `let openDialog: (() => void) | null = null` -- a
// MODULE-LEVEL singleton. Each mounted SearchDialog wrote its own setOpen into
// that one slot on mount and wrote `null` back on unmount, unconditionally,
// without checking whether it still owned the slot.
//
// SearchTrigger renders TWO SearchDialogs by construction:
//
//     <Suspense fallback={<SearchDialog projectId={null} />}>
//       <SearchDialogWithProject />      // a second SearchDialog
//     </Suspense>
//
// So: the fallback mounts and claims the slot; the real child mounts and
// overwrites it; the fallback then unmounts and its cleanup sets the shared
// slot to null -- clobbering the registration belonging to the child that is
// still mounted. `openDialog?.()` is a no-op from that moment on. Nothing
// throws and nothing logs, which is exactly the reported signature.
//
// Cmd+K was the mirror image of the same bug: each instance registered its own
// document keydown listener, so with both mounted the two listeners fired on
// one keypress and toggled the SAME intent twice -- open then closed.
//
// THE FIX: delete the singleton. `open` lives in SearchTrigger, the one
// component that owns both the button and the dialog, and is passed down. The
// keyboard shortcut is registered ONCE there, next to the state it drives, so
// it cannot double-fire no matter how many times the dialog subtree remounts.
function SearchDialog({
  projectId,
  open,
  onOpenChange,
}: {
  projectId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResults | null>(null);
  const [loading, setLoading] = useState(false);
  const router = useRouter();
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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
    onOpenChange(false);
    setQuery("");
    setResults(null);
    router.push(group.route(item));
  }

  const total = results ? GROUPS.reduce((n, g) => n + results[g.key].length, 0) : 0;

  return (
    <CommandDialog
      open={open}
      onOpenChange={(o) => {
        onOpenChange(o);
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
function SearchDialogWithProject({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const searchParams = useSearchParams();
  return <SearchDialog projectId={searchParams.get("projectId")} open={open} onOpenChange={onOpenChange} />;
}

export function SearchTrigger() {
  // The single owner of "is the palette open". Both the button and every
  // SearchDialog instance below read and write this one piece of state, so the
  // question of which instance "owns" the opener cannot arise again.
  const [open, setOpen] = useState(false);

  // Registered here, once, rather than inside SearchDialog -- the subtree
  // below renders more than one SearchDialog (Suspense fallback plus child),
  // and two listeners toggling one boolean is a no-op, not a shortcut.
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

  return (
    <>
      <Suspense fallback={<SearchDialog projectId={null} open={open} onOpenChange={setOpen} />}>
        <SearchDialogWithProject open={open} onOpenChange={setOpen} />
      </Suspense>
      <Button
        variant="ghost"
        size="sm"
        onClick={() => setOpen(true)}
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
