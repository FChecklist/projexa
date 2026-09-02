"use client";

// R67 G-05 (R-260): "money inputs show the currency as a fixed prefix".
//
// WHY A PREFIX AND NOT A PLACEHOLDER. A placeholder disappears the moment the
// user types, which is exactly when they most need to know what unit they are
// entering. A label saying "Unit Cost (AED)" is better but still sits above
// the field and is read once; the prefix sits inside the box, next to the
// caret, permanently. The user cannot be halfway through typing a rate and be
// unsure whether it is dirhams or rupees.
//
// The prefix is NOT part of the value: `value`/`onChange` carry the bare
// number exactly as a plain <Input> would, so no call site has to strip it
// before POSTing. When the org has no currency set, the warning glyph takes
// the prefix's place -- the field still says "this is money", it just does
// not claim to know which.
import * as React from "react";
import { UNKNOWN_CURRENCY_GLYPH } from "@/lib/format-money";
import { cn } from "@/lib/utils";

export type MoneyInputProps = Omit<React.ComponentProps<"input">, "type" | "prefix"> & {
  /** The org's currency code, or null when it has not set one. */
  currency: string | null;
  /**
   * True while /api/currencies is still in flight. The box then shows NEITHER
   * a code nor the warning glyph: a glyph that says "this org has no currency"
   * is a claim, and during the first paint it is a claim we have not earned.
   */
  pending?: boolean;
};

export function MoneyInput({ currency, pending = false, className, ...props }: MoneyInputProps) {
  const code = currency && currency.trim() ? currency.trim() : null;
  const prefix = code ?? (pending ? null : UNKNOWN_CURRENCY_GLYPH);
  return (
    <div
      className={cn(
        "flex h-9 w-full items-center gap-2 rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs transition-[color,box-shadow]",
        "focus-within:border-ring focus-within:ring-ring/50 focus-within:ring-[3px]",
        className
      )}
    >
      {/* aria-hidden plus the field's own aria-label/labelled-by: a screen
          reader should hear "Unit Cost, AED", not "AED" as a stray word
          before an unlabelled box. Callers pass the currency into the label. */}
      {prefix !== null && (
        <span
          data-testid="money-input-prefix"
          aria-hidden
          className="shrink-0 select-none text-[12px] font-medium text-ct-muted tabular-nums"
        >
          {prefix}
        </span>
      )}
      <input
        type="number"
        inputMode="decimal"
        step="0.01"
        // Right-aligned tabular figures, same as every money CELL, so the
        // number you type looks like the number you will read back.
        className="w-full bg-transparent text-right tabular-nums outline-none placeholder:text-muted-foreground"
        {...props}
      />
    </div>
  );
}
