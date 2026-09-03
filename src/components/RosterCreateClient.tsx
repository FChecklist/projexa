"use client";

// Real-screen conversion (2026-08-30): replaces LabourClient.tsx's old "Add
// Worker" Dialog popup with a real create screen.
//
// R67 D-67: this screen is the one the audit picked out as the MODEL
// (correction C-11: "the good create-form pattern in PROJEXA is
// /labour/new's 'Save (Name, Daily Rate)' disabled-with-reason button"), so
// it is the one that most needs to be built from the shared archetype
// rather than beside it -- otherwise the model and the thing modelled on it
// are two separate implementations that can drift apart.
//
// Two real gains beyond the shared frame. The vendor read's failure was
// `.catch(() => {})`: the Company select silently had no options, and a
// site manager could not tell an empty subcontractor list from a failed
// one. And a refused save was a toast, so the worker's details vanished
// with the notification; the refusal is now in place with every value kept.
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { CreateScreen } from "@/components/screens/CreateScreen";
import { PaneErrorCard } from "@/components/PaneState";
import { createdHref } from "@/components/CreatedReceipt";
import { fetchJson, ApiError } from "@/lib/fetch-json";
import { useOrgMoney } from "@/lib/use-org-money";
import { useSubmit } from "@/lib/use-submit";
import { getShellVendors } from "@/lib/shell-store";
import type { CreateField } from "@/lib/create-screen";
// R67 D-34 (R-085), folded in by the integration train: the org's trade
// vocabulary. Trade was free text, so the same job arrived as "Mason", "mason"
// and "Masonry" and split every trade-wise total downstream. useTrades() reads
// the merged list (seed trades plus every trade this org has actually used)
// from /api/labour-roster/trades and never blocks the form -- a failed lookup
// leaves the field as plain free text, which is what it was before.
import { useTrades, type Vendor } from "@/components/RosterFields";

export default function RosterCreateClient({ projectId }: { projectId: string }) {
  const router = useRouter();
  const orgMoney = useOrgMoney();
  const trades = useTrades();
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [vendorsError, setVendorsError] = useState<{ status: number | null; message: string | null } | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});

  const loadVendors = useCallback(async () => {
    setVendorsError(null);
    try {
      const d = await fetchJson<{ vendors?: Vendor[] }>("/api/vendors");
      setVendors(d.vendors ?? []);
    } catch (err) {
      setVendors([]);
      setVendorsError({
        status: err instanceof ApiError ? err.status : null,
        message: err instanceof Error && err.message ? err.message : null,
      });
    }
  }, []);

  // R67 MERGE (lane F2's F-25, audit R-241): when the user reached this form
  // from /labour, the shell bootstrap ALREADY holds the subcontractor list, so
  // this form makes no request for it at all. getShellVendors() is a passive
  // read of the session store -- it never subscribes and never triggers a
  // fetch, so F-19's rule that the bootstrap stays off a create route's
  // critical path is untouched. It is read HERE, in the effect, rather than in
  // a ref during render, which the repo's react-hooks/refs rule rejects. On a
  // cold arrival the seed is null and the lookup runs exactly as D0 wrote it;
  // the Retry beside the field always goes to the network.
  useEffect(() => {
    const seed = getShellVendors();
    if (seed) {
      setVendors(seed);
      return;
    }
    void loadVendors();
  }, [loadVendors]);

  const moduleHref = `/labour?projectId=${projectId}`;

  const fields: CreateField[] = [
    { name: "employeeCode", label: "ID", kind: "text", placeholder: "e.g. EMP-001" },
    { name: "name", label: "Name", kind: "text", required: true, placeholder: "e.g. Ramesh Kumar" },
    {
      name: "trade",
      label: "Trade",
      kind: "text",
      // D3 x D21 MERGE (decision D-11). The two lanes changed this ONE field
      // for two different reasons, and the reasons do not collide -- so both
      // survive, and nothing here is a compromise between them.
      //
      // D3 / D-53: Trade is REQUIRED. It used to be optional, and the cost of
      // that was only visible once the Daily Summary existed: every un-traded
      // worker fell into an "Uncategorised trade" bucket on the one report the
      // site manager reads each morning, so the trade-wise cost he is looking
      // for was silently spread across a bucket that means nothing. The point
      // of entry is the only place that can be fixed -- the summary can only
      // report what was recorded. Existing rows are untouched and still group
      // under the bucket; this stops the bucket growing. Marking it required
      // here is also what puts it in the button: "Save (Name, Trade, Daily
      // Rate)", through the same archetype that produced "Save (Name, Daily
      // Rate)" before it.
      required: true,
      placeholder: "e.g. Mason, Electrician",
      // D21 / D-34: the suggestion list is OFFERED, not enforced. Picking from
      // it is what stops "Mason"/"mason"/"Masonry" splitting the same crew
      // three ways; typing a trade the org genuinely has and the list does not
      // is still allowed. `required` and `suggestions` are orthogonal in the
      // archetype -- required is checked by missingCreateFields() against the
      // typed value, and suggestions only renders a <datalist> -- so "must be
      // answered" and "here are the answers we already know" compose exactly
      // as a user would expect.
      suggestions: trades,
      // Both help sentences said something true and neither said the other's,
      // so the merged line keeps D3's REASON (why the field is mandatory) and
      // adds D21's ADVICE (prefer an existing trade) only when there is a list
      // to prefer. On a cold or failed /trades lookup the field degrades to
      // required free text, which is exactly what D3 shipped.
      help:
        trades.length > 0
          ? "Groups this worker on the Daily Summary's trade-wise cost -- pick an existing trade where you can, so the totals stay together."
          : "Groups this worker on the Daily Summary's trade-wise cost",
    },
    {
      name: "vendorId",
      label: "Company",
      kind: "select",
      placeholder: vendorsError ? "Could not be loaded" : "Select subcontractor",
      options: vendors.map((v) => ({ value: v.id, label: v.vendorName })),
      help: "Leave blank for a directly employed worker.",
    },
    {
      name: "dailyRate",
      label: "Daily Rate",
      // R67 D-39 / G-05: a money box carries the org's currency CODE inside
      // it, beside the caret, for as long as the number is being typed. This
      // was kind "number", so the amount was entered with nothing on screen
      // saying what unit it was in -- and the cell that reads it back is
      // labelled.
      kind: "money",
      required: true,
      placeholder: "e.g. 180",
    },
  ];

  const submit = useSubmit<{ id?: unknown }>({
    objectLabel: "Worker",
    buildRequest: () => ({
      input: "/api/labour-roster",
      init: {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId,
          name: values.name,
          employeeCode: values.employeeCode || undefined,
          trade: values.trade,
          vendorId: values.vendorId || undefined,
          dailyRate: Number(values.dailyRate),
        }),
      },
    }),
    onSuccess: (entry) => {
      const id = typeof entry?.id === "string" ? entry.id : "";
      if (!id) throw new Error("The server did not confirm a saved worker");
      router.replace(createdHref("/labour", id, values.name));
    },
  });

  return (
    <CreateScreen
      module="Labour"
      moduleHref={moduleHref}
      objectLabel="Worker"
      // R67 D-34, folded in by the integration train: the title override is
      // GONE, so the archetype's own `New ${objectLabel}` applies. "Add Worker
      // to Roster" was the one create screen not reading "New <Object>", and
      // it is also the label the create menu uses for this route
      // (module-create-routes.ts: "Worker"). One name, one destination.
      fields={fields}
      values={values}
      onChange={(name, value) => setValues((v) => ({ ...v, [name]: value }))}
      money={{ currency: orgMoney.currency, loaded: orgMoney.loaded, currencySet: orgMoney.currencySet }}
      // Company is OPTIONAL, so a failed vendor read must not block the save
      // -- it is stated, and the form still works for a direct employee.
      banner={
        vendorsError ? (
          <PaneErrorCard entity="the subcontractor list" error={vendorsError} onRetry={() => void loadVendors()} />
        ) : undefined
      }
      failure={submit.failure}
      onRetry={submit.submit}
      saving={submit.saving}
      saved={submit.saved}
      onSubmit={submit.submit}
    />
  );
}
