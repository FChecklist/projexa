"use client";

// Real-screen conversion (2026-08-30) -- replaced ScopeClient.tsx's old "New
// BOQ" Dialog popup with a real create route. No draft lifecycle here (unlike
// Permits): a BOQ is created in one shot with its full line-item set, matching
// the backend's own createBoq() contract, so there is nothing to autosave.
//
// ─── R67 D-67: the screen R-257 singles out ──────────────────────────────
//
// "/scope/new, the screen a quantity surveyor lives in, has a teal Save
//  enabled on an empty form and seven unlabelled inputs truncating to
//  'Parent Item Coc'."
//
// Every word of that was true, and each half was its own fault:
//
//  * SAVE WAS ENABLED ON AN EMPTY FORM. Pressing it called the API, which
//    refused, and the refusal arrived as a toast. The user learned what was
//    required by failing. The primary now names what is missing --
//    "Save (Title, Description, Qty, Rate)" -- and cannot be pressed until
//    nothing is.
//  * THE LINE GRID HAD NO HEADERS. Seven inputs in a row, each labelled only
//    by a placeholder, and a placeholder disappears the moment you type in
//    it -- so after the first row the columns were unlabelled entirely. There
//    is a real header row now, and the placeholders are short enough not to
//    truncate ("Parent code", "Breakdown %").
//  * THE TWO HARDEST COLUMNS WERE UNEXPLAINED. Parent Item Code and
//    Breakdown % encode the whole sub-task model and nothing on screen said
//    so. The help line does.
//  * "✕" WAS THE ONLY WAY TO REMOVE A LINE. A glyph with no accessible name.
//  * CATEGORY COULD NOT BE SET AT ALL. LineItemDraft has carried `activityId`
//    and toPayloadLineItems has forwarded it since this file was written, but
//    no input ever set it -- so every BOQ created here had uncategorised
//    lines, and the Work Progress report's Category-wise view had nothing to
//    group by. The select is fed from the project's REAL activity list
//    (/api/work-progress/activities), the same source the progress form uses.
//
// The greying of Qty/Rate on a sub-task row was already right; it keeps its
// behaviour and gains the reason in words rather than only in a title
// attribute.
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { CreateScreen } from "@/components/screens/CreateScreen";
import { createdHref } from "@/components/CreatedReceipt";
import { fetchJson } from "@/lib/fetch-json";
import { emptyLine, childPercentSum, collectLines, toPayloadLineItems, type LineItemDraft } from "@/lib/boq-helpers";
import type { CreateField } from "@/lib/create-screen";

type Activity = { id: string; name: string; unit: string | null };

const FIELDS: CreateField[] = [
  {
    name: "title",
    label: "Title",
    kind: "text",
    required: true,
    placeholder: "e.g. Civil Works — Phase 1",
    wide: true,
  },
];

const SUB_TASK_REASON = "derived from the root line";

/**
 * What the line grid still needs, in the words the header row uses. Returned
 * as labels so they can go straight into the primary's own label -- an empty
 * form reads "Save (Title, Description, Qty, Rate)".
 */
function missingLineFields(lines: LineItemDraft[]): string[] {
  const val = (s: string | undefined) => (s ?? "").trim();
  const touched = lines.filter(
    (l) =>
      val(l.description) || val(l.unit) || val(l.quantity) || val(l.rate) ||
      val(l.itemCode) || val(l.parentItemCode) || val(l.breakdownPercentage)
  );
  // A BOQ with no lines at all is legitimate to the backend, but it is not
  // what someone opening this screen means to create, and R-257 lists "at
  // least one complete line" as required. An untouched grid therefore names
  // the columns of the first line.
  const first = touched[0] ?? lines[0];
  if (!first) return ["Description", "Qty", "Rate"];
  const missing: string[] = [];
  if (!val(first.description)) missing.push("Description");
  if (val(first.parentItemCode)) {
    if (!val(first.breakdownPercentage)) missing.push("Breakdown %");
  } else {
    if (!val(first.quantity)) missing.push("Qty");
    if (!val(first.rate)) missing.push("Rate");
  }
  return missing;
}

export default function ScopeCreateClient({ projectId }: { projectId: string }) {
  const router = useRouter();
  const [values, setValues] = useState<Record<string, string>>({});
  const [lines, setLines] = useState<LineItemDraft[]>([emptyLine()]);
  const [activities, setActivities] = useState<Activity[]>([]);
  const [activitiesError, setActivitiesError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const data = await fetchJson<{ activities?: Activity[] }>(
          `/api/work-progress/activities?projectId=${encodeURIComponent(projectId)}`
        );
        if (live) setActivities(Array.isArray(data.activities) ? data.activities : []);
      } catch (err) {
        // Category is optional, so a failed lookup must not block the save --
        // but it must be SAID, rather than leaving an empty select that looks
        // like a project with no activities.
        if (live) setActivitiesError(err instanceof Error ? err.message : "the request did not complete");
      }
    })();
    return () => {
      live = false;
    };
  }, [projectId]);

  function updateLine(index: number, field: keyof LineItemDraft, value: string) {
    setLines((prev) => prev.map((l, i) => (i === index ? { ...l, [field]: value } : l)));
  }

  async function save() {
    const { valid: validLines, error: lineError } = collectLines(lines);
    if (lineError) {
      setError(lineError);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/scope", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId, title: (values.title ?? "").trim(), lineItems: toPayloadLineItems(validLines) }),
      });
      let data: { id?: unknown; lineItems?: unknown; error?: unknown } | null = null;
      let parseFailed = false;
      try {
        data = await res.json();
      } catch {
        parseFailed = true;
      }

      if (!res.ok) throw new Error((typeof data?.error === "string" && data.error) || `The server refused the save (HTTP ${res.status}).`);
      if (parseFailed || !data) throw new Error("The server's response was unreadable, so nothing is confirmed saved.");
      const savedId = typeof data.id === "string" ? data.id.trim() : "";
      if (!savedId) throw new Error("The server did not confirm a saved BOQ.");
      const savedLineItems = Array.isArray(data.lineItems) ? data.lineItems.length : 0;
      if (savedLineItems < validLines.length) {
        throw new Error(`${validLines.length} line item(s) were submitted but only ${savedLineItems} came back saved.`);
      }
      router.replace(createdHref("/scope", savedId, (values.title ?? "").trim()));
    } catch (err) {
      setError(err instanceof Error ? err.message : "The request did not complete.");
      setSaving(false);
    }
  }

  const scopeHref = `/scope?projectId=${encodeURIComponent(projectId)}`;

  return (
    <CreateScreen
      module="Scope"
      moduleHref={scopeHref}
      objectLabel="BOQ"
      title="New Bill of Quantities"
      fields={FIELDS}
      values={values}
      onChange={(name, value) => setValues((prev) => ({ ...prev, [name]: value }))}
      extraMissing={missingLineFields(lines)}
      error={error}
      saving={saving}
      onSubmit={() => void save()}
      onCancel={() => router.push(scopeHref)}
    >
      <div className="space-y-2">
        <Label>Line Items</Label>
        <p className="text-xs text-px-muted">
          Parent Item Code links a sub-task to its root line; Breakdown % is its share of the root&apos;s quantity
        </p>
        {activitiesError && (
          <p role="alert" className="text-xs text-px-error">
            Could not load this project&apos;s categories: {activitiesError}. Lines can still be saved without one.
          </p>
        )}

        <div className="overflow-x-auto">
          <table className="w-full min-w-[1100px] text-sm">
            <thead>
              {/* The header row R-257 asks for. Placeholders vanish the moment
                  a field is typed into; a header does not. */}
              <tr className="text-left text-[12px] text-px-muted">
                <th scope="col" className="px-1 pb-1 font-medium">Description</th>
                <th scope="col" className="px-1 pb-1 font-medium">Category</th>
                <th scope="col" className="px-1 pb-1 font-medium">Unit</th>
                <th scope="col" className="px-1 pb-1 text-right font-medium">Qty</th>
                <th scope="col" className="px-1 pb-1 text-right font-medium">Rate</th>
                <th scope="col" className="px-1 pb-1 font-medium">Item code</th>
                <th scope="col" className="px-1 pb-1 font-medium">Parent code</th>
                <th scope="col" className="px-1 pb-1 text-right font-medium">Breakdown %</th>
                <th scope="col" className="px-1 pb-1 font-medium">Action</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((line, i) => {
                const isSubTask = Boolean(line.parentItemCode?.trim());
                const childSum = childPercentSum(lines, line.itemCode);
                return (
                  <tr key={i} className="align-top">
                    <td className="px-1 py-1">
                      <Input
                        className="min-w-[200px]"
                        aria-label={`Description, line ${i + 1}`}
                        placeholder="Excavation to reduced level"
                        value={line.description}
                        onChange={(e) => updateLine(i, "description", e.target.value)}
                      />
                    </td>
                    <td className="px-1 py-1">
                      <select
                        aria-label={`Category, line ${i + 1}`}
                        className="h-9 w-[150px] rounded-md border border-px-border bg-white px-2 text-sm"
                        value={line.activityId ?? ""}
                        onChange={(e) => updateLine(i, "activityId", e.target.value)}
                      >
                        <option value="">
                          {activities.length ? "Uncategorised" : "No categories yet"}
                        </option>
                        {activities.map((a) => (
                          <option key={a.id} value={a.id}>
                            {a.name}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="px-1 py-1">
                      <Input
                        className="w-[80px]"
                        aria-label={`Unit, line ${i + 1}`}
                        placeholder="m3"
                        value={line.unit}
                        onChange={(e) => updateLine(i, "unit", e.target.value)}
                      />
                    </td>
                    <td className="px-1 py-1">
                      <Input
                        className="w-[90px] text-right tabular-nums"
                        aria-label={`Qty, line ${i + 1}`}
                        placeholder="120"
                        type="number"
                        value={line.quantity}
                        onChange={(e) => updateLine(i, "quantity", e.target.value)}
                        disabled={isSubTask}
                        title={isSubTask ? SUB_TASK_REASON : undefined}
                      />
                    </td>
                    <td className="px-1 py-1">
                      <Input
                        className="w-[90px] text-right tabular-nums"
                        aria-label={`Rate, line ${i + 1}`}
                        placeholder="45"
                        type="number"
                        value={line.rate}
                        onChange={(e) => updateLine(i, "rate", e.target.value)}
                        disabled={isSubTask}
                        title={isSubTask ? SUB_TASK_REASON : undefined}
                      />
                      {/* The reason in WORDS, once per row, rather than only in
                          a title attribute nobody hovers. */}
                      {isSubTask && <p className="mt-0.5 text-[11px] text-px-muted">{SUB_TASK_REASON}</p>}
                    </td>
                    <td className="px-1 py-1">
                      <Input
                        className="w-[110px]"
                        aria-label={`Item code, line ${i + 1}`}
                        placeholder="A-10"
                        value={line.itemCode ?? ""}
                        onChange={(e) => updateLine(i, "itemCode", e.target.value)}
                      />
                    </td>
                    <td className="px-1 py-1">
                      <Input
                        className="w-[110px]"
                        aria-label={`Parent code, line ${i + 1}`}
                        placeholder="A-10"
                        value={line.parentItemCode ?? ""}
                        onChange={(e) => updateLine(i, "parentItemCode", e.target.value)}
                      />
                    </td>
                    <td className="px-1 py-1">
                      <Input
                        className="w-[100px] text-right tabular-nums"
                        aria-label={`Breakdown %, line ${i + 1}`}
                        placeholder="40"
                        type="number"
                        value={line.breakdownPercentage ?? ""}
                        onChange={(e) => updateLine(i, "breakdownPercentage", e.target.value)}
                      />
                      {childSum != null && <p className="mt-0.5 text-[11px] text-px-muted">{childSum}% total</p>}
                    </td>
                    <td className="px-1 py-1">
                      {/* A word, not a glyph. "✕" had no accessible name at all. */}
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => setLines((prev) => prev.filter((_, idx) => idx !== i))}
                        disabled={lines.length === 1}
                        title={lines.length === 1 ? "A BOQ needs at least one line" : undefined}
                      >
                        Remove
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <Button type="button" variant="outline" size="sm" onClick={() => setLines((prev) => [...prev, emptyLine()])}>
          + Add Line
        </Button>
      </div>
    </CreateScreen>
  );
}
