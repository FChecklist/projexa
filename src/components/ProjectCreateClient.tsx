"use client";

// R67 D-01 (audit R-001, decision D-01 + correction C-01): Create Project was
// the ONE remaining [role=dialog] flow in PROJEXA -- C-01 records it as the
// single exception to the product's own no-dialog rule. This file is that
// exception closed: the same fields, the same GET /api/products and POST
// /api/projects request shapes CreateProjectDialog.tsx used (nothing about
// the contract changed), rendered on a real route with a breadcrumb, a Back
// control and the framed create pattern /labour/new already ships
// (RosterCreateClient.tsx) -- primary action disabled with the missing field
// names beside it, never a fail-after-click.
//
// Scope note, stated rather than silently deviated from: the item's field
// list names "Currency". CreateProjectDialog had no currency field and
// POST /api/projects -> VERIDIAN /api/v1/projexa/projects accepts none, and
// the same item requires both request shapes stay unchanged -- so the fields
// carried over are exactly the ones that existed (Product, Name,
// Description, Start date, Target date). Inventing a currency input that the
// write path would silently drop is the failure mode this programme exists
// to remove.
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ObjectScreen, type FieldMessage } from "@fchecklist/veridian-ui-kit/screens";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { fetchJson, errorMessage } from "@/lib/fetch-json";

export type Product = { id: string; name: string };

/**
 * The missing required fields, in the order the item fixes them: Name, then
 * Product. Rendered inside the primary button as "Save (Name, Product)" and
 * counted down as the form fills -- same convention as /labour/new's
 * "Save (Name, Daily Rate)".
 */
export function missingProjectFields(name: string, productId: string): string[] {
  return [...(name.trim() ? [] : ["Name"]), ...(productId.trim() ? [] : ["Product"])];
}

/**
 * Which form field a backend refusal is about, so the server's own words can
 * be rendered UNDER the field it names instead of in a toast that vanishes.
 * Returns undefined when the message names no field we render -- the message
 * then stays in the persistent footer message area, still in the backend's
 * own words, never replaced with a generic one.
 */
export function fieldForProjectError(message: string): string | undefined {
  const m = message.toLowerCase();
  if (m.includes("product")) return "productId";
  if (m.includes("target date")) return "targetDate";
  if (m.includes("start date")) return "startDate";
  if (m.includes("name")) return "name";
  return undefined;
}

export default function ProjectCreateClient() {
  const router = useRouter();
  const [products, setProducts] = useState<Product[]>([]);
  const [loadingProducts, setLoadingProducts] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [productId, setProductId] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [startDate, setStartDate] = useState("");
  const [targetDate, setTargetDate] = useState("");

  const [submitting, setSubmitting] = useState(false);
  const [messages, setMessages] = useState<FieldMessage[]>([]);

  useEffect(() => {
    let cancelled = false;
    // Same call the dialog made on open (CreateProjectDialog.tsx:45) -- a
    // Project row requires a real productId, so the picker cannot be filled
    // from anything local.
    fetchJson<{ products?: Product[] }>("/api/products")
      .then((data) => {
        if (cancelled) return;
        setProducts(data.products ?? []);
        setLoadError(null);
      })
      .catch((err) => {
        if (cancelled) return;
        setLoadError(errorMessage(err, "Couldn't load products from VERIDIAN"));
      })
      .finally(() => {
        if (!cancelled) setLoadingProducts(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const missing = missingProjectFields(name, productId);
  const fieldError = (field: string) => messages.find((m) => m.field === field && m.level === "error")?.text;

  async function createProject() {
    if (missing.length > 0 || submitting) return;
    setSubmitting(true);
    setMessages([]);
    try {
      // Request shape unchanged from CreateProjectDialog.tsx:76-84.
      const created = await fetchJson<{ id: string }>("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          productId,
          name,
          description: description || undefined,
          startDate: startDate || undefined,
          targetDate: targetDate || undefined,
        }),
      });
      // Persistent message area, never a toast: the receipt has to survive
      // the navigation that follows it.
      setMessages([{ level: "success", text: `Project ${name} created` }]);
      router.push(`/dashboard/project?projectId=${encodeURIComponent(created.id)}`);
    } catch (err) {
      const text = errorMessage(err, "Couldn't create project");
      setMessages([{ level: "error", field: fieldForProjectError(text), text }]);
      setSubmitting(false);
    }
  }

  return (
    <ObjectScreen
      breadcrumb="Dashboard / New Project"
      title="New Project"
      mode="create"
      hasDraft={false}
      onSave={createProject}
      onCancel={() => router.push("/dashboard")}
      onBack={() => router.push("/dashboard")}
      saveDisabled={submitting || missing.length > 0}
      saveDisabledReason={submitting ? "Saving…" : missing.length > 0 ? missing.join(", ") : undefined}
      messages={messages}
    >
      <div className="space-y-3 px-4 py-3">
        <div className="space-y-1.5">
          <Label htmlFor="productId">Product</Label>
          {loadError ? (
            <p role="alert" className="rounded-md border border-px-error-border bg-px-error-light p-2 text-sm text-px-error">
              {loadError}
            </p>
          ) : loadingProducts ? (
            <p className="text-[13px] text-ct-muted">Loading products…</p>
          ) : products.length === 0 ? (
            <p role="status" className="rounded-md border border-px-border bg-px-cloud p-2 text-sm text-px-muted">
              No products are set up for this organisation yet. An administrator must add a product before a
              project can be created.
            </p>
          ) : (
            <Select value={productId} onValueChange={setProductId}>
              <SelectTrigger id="productId"><SelectValue placeholder="Select a product" /></SelectTrigger>
              <SelectContent>
                {products.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
              </SelectContent>
            </Select>
          )}
          {fieldError("productId") && <p className="text-[12.5px] text-px-error">{fieldError("productId")}</p>}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="name">Project Name</Label>
          <Input id="name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Lakeview Residence — Phase 2" />
          {fieldError("name") && <p className="text-[12.5px] text-px-error">{fieldError("name")}</p>}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="description">Description (optional)</Label>
          <Textarea id="description" value={description} onChange={(e) => setDescription(e.target.value)} rows={2} />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1.5">
            <Label htmlFor="startDate">Start Date</Label>
            <Input id="startDate" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
            {fieldError("startDate") && <p className="text-[12.5px] text-px-error">{fieldError("startDate")}</p>}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="targetDate">Target Date</Label>
            <Input id="targetDate" type="date" value={targetDate} onChange={(e) => setTargetDate(e.target.value)} />
            {fieldError("targetDate") && <p className="text-[12.5px] text-px-error">{fieldError("targetDate")}</p>}
          </div>
        </div>
      </div>
    </ObjectScreen>
  );
}
