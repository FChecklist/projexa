"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Loader2, LayoutPanelLeft } from "lucide-react";

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
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`/api/floor-plans/${floorPlanId}/scene`);
        const data = await res.json();
        setScene(data);
      } catch {
        toast.error("Couldn't load 3D scene");
      } finally {
        setLoading(false);
      }
    })();
  }, [floorPlanId]);

  if (loading) return <div className="grid h-64 place-items-center"><Loader2 className="size-6 animate-spin text-px-muted" /></div>;
  if (!scene) return <Card><CardContent className="p-8 text-center text-sm text-px-muted">Couldn't load this floor plan.</CardContent></Card>;

  return (
    <Card className="shadow-card">
      <CardContent className="space-y-3 p-4">
        <div className="flex items-center justify-between">
          <h2 className="font-heading text-base text-px-ink">{scene.name}</h2>
          <Link href={`/floor-plans/${floorPlanId}`}>
            <Button size="sm" variant="outline"><LayoutPanelLeft className="size-3.5" /> Back to 2D Editor</Button>
          </Link>
        </div>
        {scene.rooms.length === 0 ? (
          <p className="py-16 text-center text-sm text-px-muted">No rooms drawn yet -- add rooms in the 2D editor first.</p>
        ) : (
          <>
            <FloorPlanScene3D scene={scene} />
            <p className="text-xs text-px-muted">Drag to orbit, scroll to zoom, right-click drag to pan.</p>
          </>
        )}
      </CardContent>
    </Card>
  );
}
