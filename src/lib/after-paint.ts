"use client";

// R67 F-09 (R-122). The app shell issues its own reads -- the task list and
// the pill ranking -- from a mount effect, which runs BEFORE the browser has
// painted. On a page whose own data call is already in flight that is two more
// requests competing for connections during the exact window the user is
// waiting to see anything at all, for two things that are not the reason they
// navigated.
//
// Neither is needed for the first frame: the Task Master renders its own empty
// frame, and the pill strip renders its locally ranked set until the server's
// ranking arrives. So they are scheduled AFTER the first paint instead.
//
// TWO nested requestAnimationFrame callbacks, not one: a single rAF still runs
// BEFORE the paint it is scheduled for. The second fires on the following
// frame, i.e. once the browser has actually painted. This is the standard
// technique and it is the only one that means what the name says.
//
// Returns its own canceller so a React effect can clean up on unmount without
// the work firing into a dead component.
export function afterFirstPaint(callback: () => void): () => void {
  // Server render, or a test environment with no rAF: fall back to a macrotask.
  // "After paint" has no meaning where there is no paint, and the work must
  // still happen.
  if (typeof requestAnimationFrame !== "function") {
    const timer = setTimeout(callback, 0);
    return () => clearTimeout(timer);
  }

  let cancelled = false;
  let innerHandle = 0;
  const outerHandle = requestAnimationFrame(() => {
    if (cancelled) return;
    innerHandle = requestAnimationFrame(() => {
      if (!cancelled) callback();
    });
  });

  return () => {
    cancelled = true;
    cancelAnimationFrame(outerHandle);
    if (innerHandle) cancelAnimationFrame(innerHandle);
  };
}
