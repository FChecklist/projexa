"use client";

// LOCAL-FIRST shell, Employees and HR (/employees, /hr: one screen set for both): the staff directory from the laptop's own copy.
// Read-only. The kind carries no date of birth, emergency contact or tax slab (left out by the server on purpose), and this screen has
// nowhere to show them. Payroll, leave and recruitment are not on this laptop.

import { useState } from "react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { ShellScreenProps } from "../types";
import { CopyNote, DASH, Screen, ServerOnly, textHandlers } from "./DeliveryParts";
import type { EmployeesData } from "./erp-b-adapter";
import { GateScreen, MAX_ROWS, dateOrDash, selectClass, statusWords } from "./ErpBParts";

export type EmployeesScreenData = { heading: string; result: EmployeesData };

export default function EmployeesScreen({ shell, data }: ShellScreenProps<EmployeesScreenData>) {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const { heading, result } = data;
  if (result.state !== "local") return <GateScreen testId="employees" title={heading} state={result.state} what="employees" />;
  const needle = search.trim().toLowerCase();
  const matches = result.employees.filter((e) => (status === "all" || e.status === status) && (!needle || `${e.name ?? ""} ${e.code ?? ""} ${e.jobTitle ?? ""}`.toLowerCase().includes(needle)));
  return (
    <Screen testId="employees" state="local" title={heading}>
      <CopyNote testId="employees-copy-note" syncedAt={result.syncedAt} />
      <ServerOnly shell={shell} what="Adding or changing an employee, leave, payroll and recruitment are on the server, not on this laptop." path="/employees" />
      <p className="mt-2 text-sm text-px-ink" data-testid="employees-headcount">{result.employees.length} {result.employees.length === 1 ? "person" : "people"} on this laptop</p>
      <div className="flex flex-wrap items-end gap-3">
        <input aria-label="Search employees" data-testid="employees-search" placeholder="Search name, code or designation..." value={search} {...textHandlers(setSearch)} className={`${selectClass} w-64`} />
        <select aria-label="Status" data-testid="employees-status" value={status} {...textHandlers(setStatus)} className={selectClass}>
          <option value="all">All statuses</option>
          {result.statuses.map((s) => <option key={s} value={s}>{statusWords(s)}</option>)}
        </select>
      </div>
      {matches.length === 0 ? (
        <p className="mt-4 text-sm text-px-muted" data-testid="employees-empty">No employees found.</p>
      ) : (
        <div className="mt-3 overflow-x-auto rounded-lg border border-black/10 bg-white">
          <Table>
            <TableHeader>
              <TableRow><TableHead>Name</TableHead><TableHead>Emp. Code</TableHead><TableHead>Designation</TableHead><TableHead>Employment Type</TableHead><TableHead>Joined</TableHead><TableHead>Status</TableHead></TableRow>
            </TableHeader>
            <TableBody>
              {matches.slice(0, MAX_ROWS).map((e) => (
                <TableRow key={e.id} data-testid="employees-row">
                  <TableCell className="font-medium"><a className="underline underline-offset-2" href={`/employees/${encodeURIComponent(e.userId ?? e.id)}`}>{e.name ?? e.code ?? "Employee"}</a></TableCell>
                  <TableCell>{e.code ?? DASH}</TableCell>
                  <TableCell>{e.jobTitle ?? DASH}</TableCell>
                  <TableCell>{e.employmentType ? statusWords(e.employmentType) : DASH}</TableCell>
                  <TableCell>{dateOrDash(e.joined)}</TableCell>
                  <TableCell className="capitalize">{statusWords(e.status)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      {matches.length > MAX_ROWS ? <p className="mt-2 text-xs text-px-muted">Showing the first {MAX_ROWS} of {matches.length}; search to narrow them.</p> : null}
    </Screen>
  );
}
