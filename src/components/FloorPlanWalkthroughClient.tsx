"use client";

import { useCallback, useEffect, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Loader2, LayoutPanelLeft } from "lucide-react";
import { fetchJson, errorMessage } from "@/lib/fetch-json";

export type ScenePoint = { x: number; y: number };
export type SceneMaterial = { colorHex: string; roughness: number; metalness: number };
export type SceneRoom = {
  id: string; name: string; polygon: ScenePoint[]; ceilingHeightCm: number;
  floorMaterial: SceneMaterial; wallMaterial: SceneMaterial; ceilingMaterial: SceneMaterial;
};
export type ScenePlacement = {
  id: string; roomId: string | null; x: number; y: number; rotationDeg: number;
  itemName: string; category: string; widthCm: number; depthCm: number; heightCm: number;
};
export type SceneData = { id: string; name: string; rooms: SceneRoom[]; placements: ScenePlacement[] };

// Three.js/react-three-fiber need a real WebGL context -- deferred to a
// client-only dynamic import (ssr: false) so Next.js never tries to
// server-render the Canvas.
const FloorPlanScene3D = dynamic(() => import("@/components/FloorPlanScene3D"), {
  ssr: false,
  loading: () => <div className="grid h-[600px] place-items-center"><Loader2 className="size-6 animate-spin text-px-muted" /></div>,
});

export default function FloorPlanWalkthroughClient({ floorPlanId }: { floorPlanId: string }) {
  const [scene, setScene] = useState<SceneData | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // R52 / A4S14_05. This route carried its own crash on top of the parent
  // editor's: an uncaught "Cannot read properties of undefined (reading
  // 'length')" a few seconds after load, ending on the browser's own "This
  // page could not load" screen with no walkthrough UI ever rendering.
  //
  // Same defect as A4S14_04, a second call site. GET
  // /api/floor-plans/[id]/scene answers a failure with { error: "..." } and a
  // real status (src/app/api/floor-plans/[id]/scene/route.ts:15); res.ok was
  // never read, so that body was stored AS the scene. It is truthy, so the
  // `!scene` guard below passed it through, and `scene.rooms.length` read
  // .length off undefined. fetchJson reads the status first and throws the
  // backend's own message, so `scene` is now either a real scene or null.
  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      setScene(await fetchJson<SceneData>(`/api/floor-plans/${floorPlanId}/scene`));
    } catch (err) {
      const message = errorMessage(err, "Couldn't load 3D scene");
      setScene(null);
      setLoadError(message);
      toast.error(message);
    } finally {
      setLoading(false);
    }
  }, [floorPlanId]);

  useEffect(() => { load(); }, [load]);

  if (loading) return <div className="grid h-64 place-items-center"><Loader2 className="size-6 animate-spin text-px-muted" /></div>;
  // An error is not "no rooms". Name the real reason and offer a way on.
  if (!scene) {
    return (
      <Card>
        <CardContent className="space-y-3 p-8 text-center">
          <p role="alert" className="text-sm text-px-error">{loadError ?? "Couldn't load this floor plan."}</p>
          <div className="flex justify-center gap-2">
            <Button size="sm" variant="outline" onClick={() => load()}>Retry</Button>
            <Link href={`/floor-plans/${floorPlanId}`}><Button size="sm" variant="ghost">Back to 2D Editor</Button></Link>
          </div>
        </CardContent>
      </Card>
    );
  }

  // Defensive even now that an error body can no longer reach here: a 200 that
  // omits rooms is still not something to read .length off, and the 3D scene
  // component calls .flatMap on the same array.
  const rooms = Array.isArray(scene.rooms) ? scene.rooms : [];

  return (
    <Card className="shadow-card">
      <CardContent className="space-y-3 p-4">
        <div className="flex items-center justify-between">
          <h2 className="font-heading text-base text-px-ink">{scene.name}</h2>
          <Link href={`/floor-plans/${floorPlanId}`}>
            <Button size="sm" variant="outline"><LayoutPanelLeft className="size-3.5" /> Back to 2D Editor</Button>
          </Link>
        </div>
        {rooms.length === 0 ? (
          <p className="py-16 text-center text-sm text-px-muted">No rooms drawn yet -- add rooms in the 2D editor first.</p>
        ) : (
          <>
            <FloorPlanScene3D scene={{ ...scene, rooms, placements: Array.isArray(scene.placements) ? scene.placements : [] }} />
            <p className="text-xs text-px-muted">Drag to orbit, scroll to zoom, right-click drag to pan.</p>
          </>
        )}
      </CardContent>
    </Card>
  );
}
