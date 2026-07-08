"use client";

// Wave 47 brand refresh: makes every chat composer grow taller as the user
// types, the same feel as Claude Desktop's message box, instead of a
// fixed-height input the text scrolls inside of.
import { useEffect, useRef } from "react";

export function useAutoGrowTextarea(value: string, maxHeightPx = 200) {
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, maxHeightPx)}px`;
  }, [value, maxHeightPx]);

  return ref;
}
