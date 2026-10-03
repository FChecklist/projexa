"use client";

// LOCAL-FIRST shell, one employee (/employees/:id): the allow-listed profile fields from the laptop's own copy. No date of birth,
// emergency contact or tax slab: the kind omits them on purpose and this screen has no place for them.

import type { ShellScreenProps } from "../types";
import { CopyNote, DASH, Screen, ServerOnly } from "./DeliveryParts";
import type { EmployeeData } from "./erp-b-adapter";
import { Facts, GateScreen, dateOrDash, statusWords } from "./ErpBParts";

export default function EmployeeObjectScreen({ shell, data }: ShellScreenProps<EmployeeData>) {
  if (data.state === "not_allowed" || data.state === "not_synced") return <GateScreen testId="employee-object" title="Employee" state={data.state} what="employees" />;
  if (data.state === "not_found") {
    return (
      <Screen testId="employee-object" state="not_found" title="Employee">
        <p className="mt-3 text-sm text-px-muted">This employee is not in the copy on this laptop. They may not have been copied yet.</p>
        <p className="mt-3 text-sm"><a className="underline underline-offset-2" href="/employees">Back to Employees</a></p>
      </Screen>
    );
  }
  const e = data.employee;
  return (
    <Screen testId="employee-object" state="local" title={e.name ?? e.code ?? "Employee"}>
      <p className="text-sm"><a className="text-px-muted underline underline-offset-2" href="/employees">Employees</a></p>
      <CopyNote testId="employee-copy-note" syncedAt={data.syncedAt} />
      <Facts testId="employee-facts" rows={[
        ["Emp. code", e.code ?? DASH], ["Designation", e.jobTitle ?? DASH], ["Employment type", e.employmentType ? statusWords(e.employmentType) : DASH],
        ["Joined", dateOrDash(e.joined)], ["Status", statusWords(e.status)], ["Company", e.company ?? DASH],
      ]} />
      <ServerOnly shell={shell} what="Leave, payroll and personal details are on the server, not on this laptop." path={`/employees/${encodeURIComponent(e.userId ?? e.id)}`} />
    </Screen>
  );
}
