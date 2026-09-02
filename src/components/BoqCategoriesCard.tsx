"use client";

// R67 lane I (WS-I item I-05, R-177): "an org-level BOQ category list ...
// editable under settings".
//
// Lives on the existing /settings screen rather than a new route, so no
// nav-routes.ts entry is needed and an admin finds it where every other
// org-wide list already is (currency, roles, invites).
//
// THE TWO RULES THAT MATTER ARE ENFORCED SERVER-SIDE, and this card only
// SURFACES them -- it never re-derives either:
//   * renaming updates the BOQ lines by category id, and the response says how
//     many lines moved, which is what the toast reports;
//   * deleting a category that is in use is refused with "Used by N BOQ
//     lines"; that exact message is shown as-is, not replaced with a generic
//     "couldn't delete".
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type BoqCategory = { id: string; name: string; sortOrder: number; isActive: boolean };

export default function BoqCategoriesCard({ canEdit }: { canEdit: boolean }) {
  const [categories, setCategories] = useState<BoqCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const res = await fetch("/api/scope/categories");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Couldn't load BOQ categories");
      setCategories(data.categories ?? []);
      setLoadError(null);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Couldn't load BOQ categories");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  async function addCategory() {
    const name = newName.trim();
    if (!name) return;
    setAdding(true);
    try {
      const res = await fetch("/api/scope/categories", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Couldn't add this category");
      setNewName("");
      await load();
      toast.success(`"${data.name ?? name}" added`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't add this category");
    } finally {
      setAdding(false);
    }
  }

  async function rename(category: BoqCategory, nextName: string) {
    const name = nextName.trim();
    if (!name || name === category.name) return;
    setBusyId(category.id);
    try {
      const res = await fetch(`/api/scope/categories/${category.id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Couldn't rename this category");
      await load();
      const moved = typeof data.lineItemsUpdated === "number" ? data.lineItemsUpdated : 0;
      toast.success(moved === 0 ? `Renamed to "${name}"` : `Renamed to "${name}" — ${moved} BOQ line${moved === 1 ? "" : "s"} updated`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't rename this category");
      await load(); // put the input back to the stored name rather than leaving a rejected edit on screen
    } finally {
      setBusyId(null);
    }
  }

  async function remove(category: BoqCategory) {
    setBusyId(category.id);
    try {
      const res = await fetch(`/api/scope/categories/${category.id}`, { method: "DELETE" });
      const data = await res.json();
      // The refusal ("Used by 12 BOQ lines") is the server's own wording and is
      // shown verbatim -- it names the exact reason and the exact count, which
      // a generic failure message would throw away.
      if (!res.ok) throw new Error(data.error ?? "Couldn't delete this category");
      await load();
      toast.success(`"${category.name}" removed`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't delete this category");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <Card className="shadow-card">
      <CardHeader><CardTitle className="text-base">BOQ Categories</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        <p className="text-xs text-px-muted">
          The categories offered on every BOQ line, and grouped by the Work Progress Report&apos;s Category-wise tab.
        </p>
        {loadError && <p role="alert" className="text-[13px] text-px-error">{loadError}</p>}
        {loading ? (
          <p className="text-sm text-px-muted">Loading…</p>
        ) : categories.length === 0 && !loadError ? (
          <p className="text-sm text-px-muted">No categories yet.</p>
        ) : (
          <ul className="space-y-2">
            {categories.map((c) => (
              // Keyed on id AND stored name on purpose. The name field below is
              // an UNCONTROLLED <Input>: React does not reset a mounted input's
              // DOM value when defaultValue changes, so after a rejected rename
              // (the 409 '"Civil" is already a category') the reload in
              // rename()'s catch would leave the rejected text on screen while
              // the server still holds the old name -- screen and database
              // silently disagreeing. Including the name in the key remounts
              // the row whenever the stored name changes or reverts, so the
              // field always shows what the server actually has.
              <li key={`${c.id}:${c.name}`} className="flex items-center gap-2">
                <Input
                  aria-label={`Category name: ${c.name}`}
                  className="max-w-[240px]"
                  defaultValue={c.name}
                  disabled={!canEdit || busyId === c.id}
                  onBlur={(e) => rename(c, e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
                />
                {canEdit && (
                  <Button variant="outline" size="sm" disabled={busyId === c.id} onClick={() => remove(c)}>
                    Delete
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
        {canEdit && (
          <div className="flex items-center gap-2 pt-1">
            <Input
              aria-label="New category name"
              className="max-w-[240px]"
              placeholder="Add a category"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addCategory(); } }}
            />
            <Button size="sm" disabled={adding || newName.trim() === ""} onClick={addCategory}>Add</Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
