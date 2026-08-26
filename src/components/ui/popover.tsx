"use client"

import * as React from "react"
import * as PopoverPrimitive from "@radix-ui/react-popover"

import { cn } from "@/lib/utils"

// R52 GATE 2 -- SAME ROOT CAUSE AS src/components/ui/dialog.tsx, EXTENDED HERE.
//
// dialog.tsx (see its DialogOverlay comment for the full derivation) removed
// the exit-animation utilities from its Presence-gated portal nodes. Radix
// Presence unmounts such a node immediately ONLY when the computed
// animation-name is `none`; with an exit animation present it enters
// unmountSuspended and waits for `animationend` FOREVER, with no timeout
// fallback. One dropped frame -- a backgrounded or occluded tab -- and the
// node is stranded permanently.
//
// That fix was applied to dialog/sheet/drawer only, but every Radix layer in
// this directory is gated by the same Presence. The MODAL ones are the
// dangerous ones: while a layer is open Radix's DismissableLayer sets
// `document.body.style.pointerEvents = "none"` and RemoveScroll holds
// non-passive wheel/touchmove listeners plus a refcounted `data-scroll-locked`
// attribute on <body>. A stranded node never runs its cleanup, so the body
// stays pointer-events:none: from then on EVERY control on the page is inert
// -- buttons, plain <a href> links, even focusing a bare <input> -- with no
// console error and no network request, which is exactly the shape of the
// dead-control faults filed against this app (F_035 /rfis, F_036 /quotations,
// F_037 /sales, F_011 /permits/[id], F_009 /permits/new). Those pages' own
// handlers were read and are correctly wired; nothing on the page could
// produce that symptom.
//
// With the exit utilities gone the computed animation-name is `none` on close,
// Presence takes its immediate branch, and the node, the RemoveScroll
// listeners and the body attribute all come down in the same commit. Cost is
// the close fade. The OPEN animation is untouched -- it is not gated on
// anything. The `!pointer-events-none` guard is defence in depth and carries
// `!` deliberately: Radix writes `pointer-events: auto` as an INLINE style on
// these nodes, which beats any non-important author rule.

function Popover({
  ...props
}: React.ComponentProps<typeof PopoverPrimitive.Root>) {
  return <PopoverPrimitive.Root data-slot="popover" {...props} />
}

function PopoverTrigger({
  ...props
}: React.ComponentProps<typeof PopoverPrimitive.Trigger>) {
  return <PopoverPrimitive.Trigger data-slot="popover-trigger" {...props} />
}

function PopoverContent({
  className,
  align = "center",
  sideOffset = 4,
  ...props
}: React.ComponentProps<typeof PopoverPrimitive.Content>) {
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Content
        data-slot="popover-content"
        align={align}
        sideOffset={sideOffset}
        className={cn(
          "bg-popover text-popover-foreground data-[state=open]:animate-in data-[state=closed]:!pointer-events-none data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 z-50 w-72 origin-(--radix-popover-content-transform-origin) rounded-md border p-4 shadow-md outline-hidden",
          className
        )}
        {...props}
      />
    </PopoverPrimitive.Portal>
  )
}

function PopoverAnchor({
  ...props
}: React.ComponentProps<typeof PopoverPrimitive.Anchor>) {
  return <PopoverPrimitive.Anchor data-slot="popover-anchor" {...props} />
}

export { Popover, PopoverTrigger, PopoverContent, PopoverAnchor }
