"use client";

// THE ON-LAPTOP SHELL'S "I cannot show this yet" SCREENS, said in full. Every shell module has the same few states -- no project on this laptop,
// the project is still being copied, the record is not in the copy, your role cannot do this, amounts are hidden, the parent is still waiting -- and
// each used to be one grey sentence. Here each is the guided panel: what it means, why, the numbered steps, the exact place to go, and (for "still
// being copied") an honest progress bar that the page replaces by itself when the copy lands. The three StateMessage helpers of the shell modules
// (DesignChangeShared, DeliveryParts, DocumentsShared) all draw through this. It reads nothing and opens nothing: it only draws.

import type { ReactNode } from "react";
import { GuidedPanel } from "@/components/GuidedPanel";

const CODE_OF: Record<string, string> = {
  no_project: "LAPTOP_NO_PROJECT",
  not_synced: "LAPTOP_NOT_COPIED",
  not_found: "LAPTOP_RECORD_MISSING",
  role: "LAPTOP_ROLE",
  money_hidden: "LAPTOP_MONEY_HIDDEN",
  parent_waiting: "LAPTOP_PARENT_WAITING",
};

export type ShellStateNoteProps = {
  testId: string;
  state: string;
  title: string;
  back?: { href: string; label: string };
  children?: ReactNode;
};

export function ShellStateNote({ testId, state, title, back, children }: ShellStateNoteProps) {
  const code = CODE_OF[state];
  const text = typeof children === "string" ? children : null;
  const screen = typeof window === "undefined" ? { pathname: "/", search: "" } : window.location;
  return (
    <section data-testid={testId} data-state={state}>
      <h1 className="font-heading text-2xl text-px-ink">{title}</h1>
      {code && (text !== null || state === "no_project" || state === "not_synced") ? (
        <GuidedPanel
          className="mt-3 max-w-2xl"
          ctx={{ route: screen.pathname, search: screen.search, code, serverMessage: text ?? undefined }}
          what={text ?? undefined}
          progress={state === "not_synced" ? { label: "Copying this project to the laptop. Nothing to press: this screen fills in by itself." } : undefined}
          noCopy
          quiet
          role="status"
        />
      ) : (
        <p className="mt-3 text-sm text-px-muted">{children}</p>
      )}
      {back ? (
        <p className="mt-3 text-sm">
          <a className="text-px-ink underline underline-offset-2" href={back.href}>{back.label}</a>
        </p>
      ) : null}
    </section>
  );
}

export default ShellStateNote;
