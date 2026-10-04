"use client";

// LOCAL-FIRST shell, Settings (read-only): your account, and the organisation's own lists this role may read -- base currency, BOQ
// categories, team (names and roles; e-mail addresses are not copied to the laptop). A list the role may not read is said to be
// "not available to your role", never shown empty. Everything that CHANGES settings (currency, roles, invites, integrations, digest
// schedule, sign-out) needs the server and is not offered here.

import type { ReactNode } from "react";
import type { ShellScreenProps } from "../types";
import type { Master, SettingsData } from "./platform-adapter";
import { Facts, OnlineOnly } from "./DocumentsShared";

function Card({ title, testId, children }: { title: string; testId: string; children: ReactNode }) {
  return (
    <section className="mt-6 rounded-lg border border-black/10 bg-white p-4" data-testid={testId}>
      <h2 className="text-sm font-medium text-px-ink">{title}</h2>
      <div className="mt-2 text-sm text-px-ink">{children}</div>
    </section>
  );
}

function Unavailable({ m }: { m: Exclude<Master<unknown>, { state: "local" }> }) {
  return <p className="text-px-muted" data-testid={`master-${m.state}`}>{m.state === "not_allowed" ? "This list is not available to your role." : "This list has not been copied to this laptop yet."}</p>;
}

export default function SettingsLocalScreen({ data }: ShellScreenProps<SettingsData>) {
  return (
    <section data-testid="settings" data-state="local">
      <h1 className="font-heading text-2xl text-px-ink">Settings</h1>
      <p className="mt-1 text-xs text-px-muted">Saved on this laptop</p>
      <Card title="Your account" testId="settings-account">
        <Facts rows={[["Name", data.name ?? "-"], ["Email", data.email ?? "-"], ["Role", data.role ?? "-"], ["Projects on this laptop", String(data.projectCount)]]} />
      </Card>
      <Card title="Currency" testId="settings-currency">
        {data.currency.state !== "local" ? (
          <Unavailable m={data.currency} />
        ) : data.currency.value ? (
          <span data-testid="settings-currency-code">{data.currency.value.code}{data.currency.value.name ? ` (${data.currency.value.name})` : ""}</span>
        ) : (
          <span className="text-px-muted">Not set</span>
        )}
      </Card>
      <Card title="BOQ categories" testId="settings-categories">
        {data.categories.state !== "local" ? (
          <Unavailable m={data.categories} />
        ) : data.categories.value.length === 0 ? (
          <span className="text-px-muted">No categories yet.</span>
        ) : (
          <ul className="list-disc pl-5" data-testid="settings-category-list">{data.categories.value.map((c, i) => <li key={`${i}-${c}`}>{c}</li>)}</ul>
        )}
      </Card>
      <Card title="Team" testId="settings-team">
        {data.team.state !== "local" ? (
          <Unavailable m={data.team} />
        ) : data.team.value.length === 0 ? (
          <span className="text-px-muted">No teammates yet.</span>
        ) : (
          <ul data-testid="settings-team-list">
            {data.team.value.map((m) => (
              <li key={m.id} data-testid="settings-team-member">
                {m.name}<span className="ml-2 text-px-muted">{m.role ?? ""}{m.active ? "" : " (inactive)"}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
      <OnlineOnly>Changing the currency, roles, invitations, integrations and the daily digest needs a connection.</OnlineOnly>
    </section>
  );
}
