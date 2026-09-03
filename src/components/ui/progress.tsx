"use client"

import * as React from "react"
import * as ProgressPrimitive from "@radix-ui/react-progress"

import { cn } from "@/lib/utils"

// R67 WS-G (R-227). The bar used to be `bg-primary`, i.e. SAFFRON -- the
// same colour as the one primary action on the screen. A progress bar is not
// an action, and a screen that paints both in one colour teaches the reader
// that saffron means nothing in particular. It is now the chart's own dusty
// blue, and it turns sage at 100%, so "finished" is a state change the reader
// can see without reading the number.
//
// Colour is still not the only carrier: `value` is on the element as
// aria-valuenow (Radix sets it), and every caller in this app prints the
// percentage beside the bar.

function Progress({
  className,
  value,
  ...props
}: React.ComponentProps<typeof ProgressPrimitive.Root>) {
  const complete = (value ?? 0) >= 100
  return (
    <ProgressPrimitive.Root
      data-slot="progress"
      className={cn(
        "relative h-2 w-full overflow-hidden rounded-full",
        className
      )}
      // The track is the same hue at low opacity, so the bar reads as a
      // fraction OF something rather than as two unrelated colours.
      style={{ backgroundColor: "color-mix(in srgb, var(--chart-1) 20%, transparent)" }}
      {...props}
    >
      <ProgressPrimitive.Indicator
        data-slot="progress-indicator"
        data-complete={complete ? "true" : undefined}
        className="h-full w-full flex-1 transition-all"
        style={{
          transform: `translateX(-${100 - (value || 0)}%)`,
          backgroundColor: complete ? "var(--chart-2)" : "var(--chart-1)",
        }}
      />
    </ProgressPrimitive.Root>
  )
}

export { Progress }
