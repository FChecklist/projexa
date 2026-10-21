"use client";

// GUIDED ERRORS G1, laptop shell: the Scope of Work / New BOQ / Revision / Budget screens say what is wrong in the guided panel (what happened,
// why, what to do, the exact place, the way back), with the original plain sentence kept as "what happened". Two small pieces:
//   ScopeState         a screen that cannot open (no project, project not copied yet, BOQ not here, BOQ waiting to be sent, money hidden, role too low)
//   scopeWriteFailure  a write that was not kept on the laptop (scope-writes.ts ScopeWriteResult.reason) as a failure the panel can show
// Codes are the catalogue's (src/lib/error-guide/catalogue/boq.ts, project.ts).

import type { ReactNode } from "react";
import { ActionFailurePanel, codedFailure, type ActionFailureState } from "@/components/ActionFailure";
import type { ScopeWriteResult } from "./scope-writes";

export type ScopeStateKind = "no_project" | "not_synced" | "not_found" | "parent_waiting" | "money_hidden" | "role";

const STATE_FAILURE: Record<ScopeStateKind, { code: string; status?: number }> = {
  no_project: { code: "NO_PROJECT" },
  not_synced: { code: "NOT_ON_LAPTOP" },
  not_found: { code: "BOQ_NOT_ON_LAPTOP" },
  parent_waiting: { code: "BOQ_WAITING_TO_SYNC" },
  money_hidden: { code: "MONEY_HIDDEN_FOR_ROLE", status: 403 },
  role: { code: "ROLE_TOO_LOW", status: 403 },
};

export function ScopeState({
  testId,
  state,
  title,
  back,
  sentence,
  projectId,
  entityId,
}: {
  testId: string;
  state: ScopeStateKind;
  title: string;
  back?: { href: string; label: string };
  /** The screen's own complete sentence, kept as the panel's "what happened". */
  sentence: ReactNode;
  projectId?: string;
  entityId?: string;
}) {
  const text = typeof sentence === "string" ? sentence : undefined;
  const { code, status } = STATE_FAILURE[state];
  return (
    <section data-testid={testId} data-state={state}>
      <h1 className="font-heading text-2xl text-px-ink">{title}</h1>
      <div className="mt-3 max-w-3xl">
        <ActionFailurePanel
          failure={codedFailure(code, text ?? title, { ...(status !== undefined ? { status } : {}), at: 0 })}
          sentence={text}
          entityType="boq"
          entityId={entityId}
          projectId={projectId}
          quiet
        />
      </div>
      {back ? (
        <p className="mt-3 text-sm">
          <a className="text-px-ink underline underline-offset-2" href={back.href}>{back.label}</a>
        </p>
      ) : null}
    </section>
  );
}

const REASON_CODE: Record<Exclude<ScopeWriteResult, { queued: true }>["reason"], string> = {
  no_copy: "NOT_ON_LAPTOP",
  no_row: "BOQ_NOT_ON_LAPTOP",
  invalid: "FIELD_INVALID",
  blocked: "SCOPE_REDUCTION_BLOCKED",
  too_large: "BOQ_TOO_LARGE",
  failed: "LOCAL_SAVE_FAILED",
  revision_waiting: "REVISION_WAITING",
  change_order: "CHANGE_ORDER_NOT_LINKABLE",
};

/** A write the laptop did not keep, as a failure for the panel; `sentence` is scopeNotQueuedMessage(reason). */
export function scopeWriteFailure(reason: Exclude<ScopeWriteResult, { queued: true }>["reason"], sentence: string, field?: string): ActionFailureState {
  return { ...codedFailure(REASON_CODE[reason], sentence), ...(field ? { field } : {}), message: sentence };
}
