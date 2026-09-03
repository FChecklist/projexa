"use client";

// R67 D-67 -- ONE create screen for every module.
//
// WHY THIS IS A FORK AND NOT A KIT CHANGE: programme decision D-09. The kit
// exports a FormScreen, but the kit source is not on this machine and is
// consumed as a pinned git tarball; changing it needs a release this
// programme does not do. So the archetype lives here, in projexa, and every
// kit component this screen does NOT need is still imported from the kit
// unchanged.
//
// WHAT IT REPLACES. R-257 recorded three conventions on one product:
//
//   /labour/new   "← Back Labour / New Worker", labelled fields with
//                 "(optional)" and example placeholders, one primary reading
//                 "Save (Name, Daily Rate)". This is the model.
//   /permits/new  a button that said "Create", with the missing-field count
//                 in a separate sentence beside it.
//   /scope/new    a teal Save ENABLED on a completely empty form, over seven
//                 unlabelled inputs whose placeholders truncated mid-word to
//                 "Parent Item Coc".
//
// The rules -- what is missing, what the primary says -- are in
// src/lib/create-screen.ts where they are unit tests. This file is their
// rendering plus four things a create screen must do and these three did not
// agree about:
//
//   1. A BREADCRUMB THAT SAYS WHERE YOU ARE AND HOW TO LEAVE.
//   2. A PRIMARY THAT NAMES WHAT IS MISSING and is disabled until nothing is.
//   3. A SERVER REFUSAL RENDERED IN PLACE, above the buttons, with every
//      value and every chosen File still on the form. A toast that fades and
//      a form that resets are how a user loses ten minutes of typing.
//   4. VALIDATORS THAT RUN ON BLUR, never while the user is mid-word.
//
// R67 D-72 adds the fifth: the primary's three states are the SUBMIT's three
// states. "Save (…)" while nothing has been sent, "Saving…" from the click,
// "Saved" from the 2xx until the caller's navigation lands -- so the screen
// is never idle-looking over a write that already happened. The words for a
// failure come from src/lib/use-submit.ts, whole, because a timeout and a
// refusal are different sentences and only one of them fits "Could not save".

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent } from "@/components/ui/card";
import { MoneyInput } from "@/components/ui/money-input";
import { CurrencyNotSetNotice } from "@/components/CurrencyNotSetNotice";
import { ProjectBreadcrumb } from "@/components/ProjectBreadcrumb";
import { createSaveLabel, missingCreateFields, type CreateField, type CreateFiles, type CreateValues } from "@/lib/create-screen";
import { saveDisabledReason } from "@/lib/save-label";
import type { SubmitFailure } from "@/lib/use-submit";

export type CreateScreenProps = {
  /** "Permits", "Minutes of Meeting" -- what the breadcrumb and Back point at. */
  module: string;
  moduleHref: string;
  /** "Permit", "BOQ", "Meeting", "Worker" -- the thing being created. */
  objectLabel: string;
  /** Overrides "New {objectLabel}". */
  title?: string;
  fields: CreateField[];
  values: CreateValues;
  onChange: (name: string, value: string) => void;
  files?: CreateFiles;
  onFileChange?: (name: string, file: File | null) => void;
  /** Required things the field list does not own -- "at least one complete line". */
  extraMissing?: string[];
  /** Anything below the fields: a line grid, an org-precondition banner's body. */
  children?: React.ReactNode;
  /** Rendered above the fields. Used for a precondition the user must read first. */
  banner?: React.ReactNode;
  /**
   * How the save failed, from src/lib/use-submit.ts. Rendered in place, above
   * the buttons, with every value and every chosen File still on the form.
   *
   * R67 D-72: this used to be a bare reason string that THIS component framed
   * ("Could not save the permit — {error} Nothing was saved."). That frame
   * only fits a refusal: a ten-second timeout and a click that sent nothing
   * are not refusals, and wrapping them in it produced sentences that said
   * "nothing was saved" twice. The whole sentence is written once, in the
   * hook, where it is unit-tested.
   */
  failure?: SubmitFailure | null;
  /** Re-issues the same save. Rendered as "Try again" beside the failure. */
  onRetry?: () => void;
  saving?: boolean;
  /** A 2xx landed; the primary reads "Saved" until the caller has navigated. */
  saved?: boolean;
  onSubmit: () => void;
  /** Defaults to going back to the module list. */
  onCancel?: () => void;
  /** An action rendered beside Save -- C-15's "Set up in VERIDIAN" link. */
  secondaryAction?: React.ReactNode;
  /**
   * The org's money settings, for any field of kind "money" (R67 G-05).
   *
   * Passed in rather than read here with useOrgMoney(): that hook mounts its
   * own /api/currencies fetch, and eleven of the thirteen create screens have
   * no money field at all. A screen that HAS one calls the hook and hands the
   * answer down. With nothing passed, a money box shows NO currency token and
   * no warning glyph -- an unlabelled number is recoverable, a confidently
   * wrong code is not.
   */
  money?: { currency: string | null; loaded?: boolean; currencySet?: boolean };
};

export function CreateScreen({
  module,
  moduleHref,
  objectLabel,
  title,
  fields,
  values,
  onChange,
  files = {},
  onFileChange,
  extraMissing = [],
  children,
  banner,
  failure,
  onRetry,
  saving = false,
  saved = false,
  onSubmit,
  onCancel,
  secondaryAction,
  money,
}: CreateScreenProps) {
  const router = useRouter();
  const [touched, setTouched] = useState<Record<string, string | null>>({});
  const missing = missingCreateFields(fields, values, files, extraMissing);
  const blocked = missing.length > 0 || saving || saved;

  const cancel = onCancel ?? (() => router.push(moduleHref));

  return (
    <div className="flex-1 space-y-4 p-6">
      <ProjectBreadcrumb
        module={module}
        moduleHref={moduleHref}
        trail={[title ?? `New ${objectLabel}`]}
        backHref={moduleHref}
      />
      <h1 className="font-heading text-xl text-ct-navy">{title ?? `New ${objectLabel}`}</h1>

      {banner}

      <Card className="max-w-3xl">
        <CardContent className="space-y-4 p-6">
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              if (!blocked) onSubmit();
            }}
          >
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {fields.map((field) => {
                const value = values[field.name] ?? "";
                const fieldError = touched[field.name] ?? null;
                const describedBy = [field.help ? `${field.name}-help` : null, fieldError ? `${field.name}-error` : null]
                  .filter(Boolean)
                  .join(" ");
                return (
                  <div
                    key={field.name}
                    className={`space-y-1 ${field.wide || field.kind === "textarea" ? "sm:col-span-2" : ""}`}
                  >
                    <Label htmlFor={field.name}>
                      {field.label}
                      {/* R67 G-05: the code goes in the LABEL as well as the
                          box, so a screen reader hears "Unit Cost, AED" and
                          not "AED" as a stray word before an unlabelled box. */}
                      {field.kind === "money" && money?.currency ? ` (${money.currency})` : ""}
                      {/* R-257: "Optional fields carry no marker" is the rule
                          for ASTERISKS. The word is the opposite -- it tells
                          the user they may skip the field, which is the
                          information they actually want. */}
                      {!field.required && <span className="ml-1 text-xs text-px-muted">(optional)</span>}
                    </Label>

                    {field.kind === "textarea" ? (
                      <Textarea
                        id={field.name}
                        name={field.name}
                        value={value}
                        placeholder={field.placeholder}
                        aria-describedby={describedBy || undefined}
                        onChange={(e) => onChange(field.name, e.target.value)}
                        onBlur={() =>
                          setTouched((t) => ({ ...t, [field.name]: field.validate ? field.validate(value) : null }))
                        }
                      />
                    ) : field.kind === "select" && field.loading ? (
                      /* R67 G-04 (R-231): while the options are in flight the
                         control is a disabled skeleton in the select's own
                         shape. It cannot be opened onto an empty menu (which
                         reads exactly like "there is nothing to choose"), and
                         it puts NO WORD in the value slot -- "Loading…" there
                         reads as a chosen answer. Nothing moves when the real
                         select replaces it: same height, same width. */
                      <div
                        id={field.name}
                        aria-busy="true"
                        aria-disabled="true"
                        aria-label={`${field.label}, loading`}
                        data-testid={field.testId ? `${field.testId}-loading` : undefined}
                        className="flex h-9 w-full items-center rounded-md border border-px-border bg-white px-3 opacity-60"
                      >
                        <Skeleton className="h-4 w-28" />
                      </div>
                    ) : field.kind === "select" ? (
                      <select
                        id={field.name}
                        name={field.name}
                        value={value}
                        disabled={field.disabled}
                        data-testid={field.testId}
                        aria-describedby={describedBy || undefined}
                        onChange={(e) => onChange(field.name, e.target.value)}
                        onBlur={() =>
                          setTouched((t) => ({ ...t, [field.name]: field.validate ? field.validate(value) : null }))
                        }
                        className="h-9 w-full rounded-md border border-px-border bg-white px-3 text-sm disabled:opacity-60"
                      >
                        <option value="">{field.placeholder ?? "Choose…"}</option>
                        {(field.options ?? []).map((o) => (
                          <option key={o.value} value={o.value}>
                            {o.label}
                          </option>
                        ))}
                      </select>
                    ) : field.kind === "money" ? (
                      /* R67 G-05 (R-260): the currency sits inside the box,
                         beside the caret, so it is still visible while the
                         number is being typed -- a placeholder vanishes on
                         the first keystroke, which is exactly when the unit
                         matters. The prefix is NOT part of the value. */
                      <div className="space-y-1">
                        <MoneyInput
                          id={field.name}
                          name={field.name}
                          currency={money?.currency ?? null}
                          pending={money ? money.loaded === false : true}
                          value={value}
                          placeholder={field.placeholder}
                          aria-describedby={describedBy || undefined}
                          onChange={(e) => onChange(field.name, e.target.value)}
                          onBlur={() =>
                            setTouched((t) => ({ ...t, [field.name]: field.validate ? field.validate(value) : null }))
                          }
                        />
                        {money && (
                          <CurrencyNotSetNotice
                            currencySet={money.currencySet ?? true}
                            loaded={money.loaded ?? true}
                          />
                        )}
                      </div>
                    ) : field.kind === "file" ? (
                      <div className="space-y-1">
                        <Input
                          id={field.name}
                          name={field.name}
                          type="file"
                          accept={field.accept}
                          aria-describedby={describedBy || undefined}
                          onChange={(e) => onFileChange?.(field.name, e.target.files?.[0] ?? null)}
                        />
                        {/* The chosen file's name is echoed, because a failed
                            save re-renders the input EMPTY -- a file input's
                            value cannot be restored programmatically -- and
                            the user needs to know the File is still held. */}
                        {files[field.name] && (
                          <p className="text-xs text-px-muted">Chosen: {files[field.name]?.name}</p>
                        )}
                      </div>
                    ) : (
                      <Input
                        id={field.name}
                        name={field.name}
                        type={field.kind}
                        value={value}
                        placeholder={field.placeholder}
                        aria-describedby={describedBy || undefined}
                        onChange={(e) => onChange(field.name, e.target.value)}
                        onBlur={() =>
                          setTouched((t) => ({ ...t, [field.name]: field.validate ? field.validate(value) : null }))
                        }
                      />
                    )}

                    {field.help && (
                      <p id={`${field.name}-help`} className="text-xs text-px-muted">
                        {field.help}
                      </p>
                    )}
                    {fieldError && (
                      <p id={`${field.name}-error`} role="alert" className="text-xs text-px-error">
                        {fieldError}
                      </p>
                    )}
                  </div>
                );
              })}
            </div>

            {children}

            {/* The failure, in place, above the buttons, with every value
                still on the form behind it -- and its own way out. */}
            {failure && (
              <div role="alert" className="rounded-lg border border-px-error-border bg-px-error-light p-3 text-sm">
                <p className="flex items-start gap-2 text-px-error">
                  <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
                  <span>
                    {failure.message}
                    {failure.retryable && onRetry && (
                      <>
                        {" "}
                        <button
                          type="button"
                          onClick={onRetry}
                          className="font-medium underline underline-offset-2"
                        >
                          Try again
                        </button>
                      </>
                    )}
                  </span>
                </p>
              </div>
            )}

            <div className="flex flex-wrap items-center justify-end gap-2">
              {secondaryAction && <div className="mr-auto">{secondaryAction}</div>}
              <Button type="button" variant="outline" onClick={cancel}>
                Cancel
              </Button>
              <Button type="submit" disabled={blocked} title={saveDisabledReason(missing, saving)}>
                {saved ? (
                  "Saved"
                ) : saving ? (
                  <>
                    <Loader2 className="size-4 animate-spin" aria-hidden /> Saving…
                  </>
                ) : (
                  createSaveLabel(missing)
                )}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

export default CreateScreen;
