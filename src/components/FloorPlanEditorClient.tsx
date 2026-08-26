"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, Pencil, Trash2, RotateCw, Box, X } from "lucide-react";
import { fetchJson, errorMessage } from "@/lib/fetch-json";

type Point = { x: number; y: number };
type Material = { id: string; name: string; category: string; colorHex: string };
type Room = {
  id: string; name: string; polygon: Point[]; ceilingHeightCm: string;
  floorMaterialId: string | null; wallMaterialId: string | null; ceilingMaterialId: string | null;
  floorMaterial: Material | null; wallMaterial: Material | null; ceilingMaterial: Material | null;
};
type Placement = {
  id: string; roomId: string | null; ffeItemId: string; x: string; y: string; rotationDeg: string;
  item: { id: string; itemName: string; category: string; widthCm: string | null; depthCm: string | null } | null;
};
type FloorPlan = { id: string; name: string; projectId: string; status: string; rooms: Room[]; placements: Placement[] };
type FfeItem = { id: string; itemName: string; category: string };

const CATEGORY_COLORS: Record<string, string> = {
  furniture: "#F5820A", fixture: "#0E7C6E", equipment: "#3B82F6",
  finish: "#A855F7", textile: "#EC4899", lighting: "#EAB308", other: "#94A3B8",
};

function hexWithAlpha(hex: string, alpha: number) {
  const r = parseInt(hex.slice(1, 3), 16) || 200, g = parseInt(hex.slice(3, 5), 16) || 200, b = parseInt(hex.slice(5, 7), 16) || 200;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function centroid(points: Point[]): Point {
  if (points.length === 0) return { x: 0, y: 0 };
  const x = points.reduce((s, p) => s + p.x, 0) / points.length;
  const y = points.reduce((s, p) => s + p.y, 0) / points.length;
  return { x, y };
}

export default function FloorPlanEditorClient({ floorPlanId }: { floorPlanId: string }) {
  const [floorPlan, setFloorPlan] = useState<FloorPlan | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [ffeItems, setFfeItems] = useState<FfeItem[]>([]);
  const [materials, setMaterials] = useState<Material[]>([]);
  const [loading, setLoading] = useState(true);
  const [drawMode, setDrawMode] = useState(false);
  const [drawPoints, setDrawPoints] = useState<Point[]>([]);
  const [namingRoom, setNamingRoom] = useState(false);
  const [roomName, setRoomName] = useState("");
  const [selectedPlacementId, setSelectedPlacementId] = useState<string | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const draggingRef = useRef<{ placementId: string; offsetX: number; offsetY: number } | null>(null);

  // R52 / A4S14_04. Opening a floor plan whose GET failed tore down the whole
  // React tree: an uncaught "Cannot read properties of undefined (reading
  // 'flatMap')" left the browser on its own "This page could not load" screen,
  // with no app shell and no in-app error state at all.
  //
  // Both recorded symptoms came from the two lines below. GET
  // /api/floor-plans/[id] answers a failure with { error: "..." } and a real
  // status (src/app/api/floor-plans/[id]/route.ts:15). res.ok was never read,
  // so that error body was stored AS the floor plan -- truthy, so the
  // `!floorPlan` guard let it through, and `floorPlan.rooms.flatMap(...)` then
  // read .flatMap off undefined. The same body also explains the malformed
  // request in the fault record: data.projectId was undefined, and
  // encodeURIComponent(undefined) is the literal string "undefined", which is
  // exactly the GET /api/ffe?projectId=undefined that was observed.
  //
  // fetchJson reads the status first and throws the backend's own message.
  // FF&E and materials are fetched only once a real plan is in hand, and their
  // own failures are non-fatal -- the plan still draws without them.
  async function load() {
    setLoading(true);
    setLoadError(null);
    let plan: FloorPlan;
    try {
      plan = await fetchJson<FloorPlan>(`/api/floor-plans/${floorPlanId}`);
    } catch (err) {
      const message = errorMessage(err, "Couldn't load floor plan");
      setLoadError(message);
      toast.error(message);
      setFloorPlan(null);
      setLoading(false);
      return;
    }
    setFloorPlan(plan);

    const [ffeRes, matRes] = await Promise.allSettled([
      fetchJson<{ items?: FfeItem[] }>(`/api/ffe?projectId=${encodeURIComponent(plan.projectId)}`),
      fetchJson<{ materials?: Material[] }>(`/api/design-materials`),
    ]);
    setFfeItems(ffeRes.status === "fulfilled" ? ffeRes.value.items ?? [] : []);
    setMaterials(matRes.status === "fulfilled" ? matRes.value.materials ?? [] : []);
    if (ffeRes.status === "rejected") toast.error(errorMessage(ffeRes.reason, "Couldn't load FF&E items"));
    if (matRes.status === "rejected") toast.error(errorMessage(matRes.reason, "Couldn't load materials"));
    setLoading(false);
  }

  useEffect(() => { load(); }, [floorPlanId]);

  function toSvgPoint(e: React.PointerEvent | PointerEvent): Point {
    const svg = svgRef.current;
    if (!svg) return { x: 0, y: 0 };
    const pt = svg.createSVGPoint();
    pt.x = e.clientX; pt.y = e.clientY;
    const ctm = svg.getScreenCTM();
    if (!ctm) return { x: 0, y: 0 };
    const p = pt.matrixTransform(ctm.inverse());
    return { x: Math.round(p.x), y: Math.round(p.y) };
  }

  function handleCanvasClick(e: React.PointerEvent<SVGSVGElement>) {
    if (drawMode) {
      setDrawPoints((prev) => [...prev, toSvgPoint(e)]);
    } else {
      setSelectedPlacementId(null);
    }
  }

  async function finishRoom() {
    if (!roomName.trim() || drawPoints.length < 3) return;
    try {
      const res = await fetch(`/api/floor-plans/${floorPlanId}/rooms`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: roomName, polygon: drawPoints }),
      });
      if (!res.ok) throw new Error();
      toast.success("Room added");
      setDrawPoints([]); setDrawMode(false); setNamingRoom(false); setRoomName("");
      load();
    } catch {
      toast.error("Couldn't add room");
    }
  }

  async function removeRoom(roomId: string) {
    try {
      await fetch(`/api/floor-plans/${floorPlanId}/rooms/${roomId}`, { method: "DELETE" });
      load();
    } catch {
      toast.error("Couldn't remove room");
    }
  }

  async function setRoomMaterial(roomId: string, field: "floorMaterialId" | "wallMaterialId" | "ceilingMaterialId", materialId: string) {
    try {
      await fetch(`/api/floor-plans/${floorPlanId}/rooms/${roomId}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [field]: materialId }),
      });
      load();
    } catch {
      toast.error("Couldn't update material");
    }
  }

  async function placeFurniture(ffeItemId: string) {
    if (!floorPlan) return;
    const firstRoom = (floorPlan.rooms ?? [])[0];
    const pos = firstRoom ? centroid(firstRoom.polygon) : { x: 200, y: 200 };
    try {
      const res = await fetch(`/api/floor-plans/${floorPlanId}/placements`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ffeItemId, roomId: firstRoom?.id, x: pos.x, y: pos.y }),
      });
      if (!res.ok) throw new Error();
      load();
    } catch {
      toast.error("Couldn't place item");
    }
  }

  function startDrag(e: React.PointerEvent, p: Placement) {
    e.stopPropagation();
    if (drawMode) return;
    const pt = toSvgPoint(e);
    draggingRef.current = { placementId: p.id, offsetX: pt.x - Number(p.x), offsetY: pt.y - Number(p.y) };
    setSelectedPlacementId(p.id);
  }

  function handlePointerMove(e: React.PointerEvent<SVGSVGElement>) {
    if (!draggingRef.current || !floorPlan) return;
    const pt = toSvgPoint(e);
    const newX = pt.x - draggingRef.current.offsetX;
    const newY = pt.y - draggingRef.current.offsetY;
    setFloorPlan({
      ...floorPlan,
      placements: (floorPlan.placements ?? []).map((pl) =>
        pl.id === draggingRef.current!.placementId ? { ...pl, x: String(newX), y: String(newY) } : pl
      ),
    });
  }

  async function handlePointerUp() {
    if (!draggingRef.current || !floorPlan) return;
    const { placementId } = draggingRef.current;
    draggingRef.current = null;
    const placement = (floorPlan.placements ?? []).find((p) => p.id === placementId);
    if (!placement) return;
    try {
      await fetch(`/api/floor-plans/${floorPlanId}/placements/${placementId}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ x: Number(placement.x), y: Number(placement.y) }),
      });
    } catch {
      toast.error("Couldn't save position");
    }
  }

  async function rotateSelected() {
    if (!selectedPlacementId || !floorPlan) return;
    const placement = (floorPlan.placements ?? []).find((p) => p.id === selectedPlacementId);
    if (!placement) return;
    const nextRotation = (Number(placement.rotationDeg) + 15) % 360;
    try {
      await fetch(`/api/floor-plans/${floorPlanId}/placements/${selectedPlacementId}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rotationDeg: nextRotation }),
      });
      load();
    } catch {
      toast.error("Couldn't rotate item");
    }
  }

  async function removeSelected() {
    if (!selectedPlacementId) return;
    try {
      await fetch(`/api/floor-plans/${floorPlanId}/placements/${selectedPlacementId}`, { method: "DELETE" });
      setSelectedPlacementId(null);
      load();
    } catch {
      toast.error("Couldn't remove item");
    }
  }

  if (loading) return <div className="grid h-64 place-items-center"><Loader2 className="size-6 animate-spin text-px-muted" /></div>;

  // An error is not an empty editor. Say what went wrong, in the app, with a
  // way back and a way to retry -- never the browser's own crash screen.
  if (!floorPlan) {
    return (
      <Card className="shadow-card">
        <CardContent className="space-y-3 p-8 text-center">
          <p role="alert" className="text-sm text-px-error">{loadError ?? "Couldn't load this floor plan."}</p>
          <div className="flex justify-center gap-2">
            <Button size="sm" variant="outline" onClick={() => load()}>Retry</Button>
            <Link href="/floor-plans"><Button size="sm" variant="ghost">Back to floor plans</Button></Link>
          </div>
        </CardContent>
      </Card>
    );
  }

  // Defensive even now that the error body can no longer reach here: a 200
  // that omits either array is still not something to read .flatMap off.
  const rooms = Array.isArray(floorPlan.rooms) ? floorPlan.rooms : [];
  const placements = Array.isArray(floorPlan.placements) ? floorPlan.placements : [];

  const allPoints = [
    ...rooms.flatMap((r) => r.polygon ?? []),
    ...placements.map((p) => ({ x: Number(p.x), y: Number(p.y) })),
    ...drawPoints,
  ];
  const minX = allPoints.length ? Math.min(...allPoints.map((p) => p.x)) - 100 : 0;
  const minY = allPoints.length ? Math.min(...allPoints.map((p) => p.y)) - 100 : 0;
  const maxX = allPoints.length ? Math.max(...allPoints.map((p) => p.x)) + 100 : 600;
  const maxY = allPoints.length ? Math.max(...allPoints.map((p) => p.y)) + 100 : 600;

  const unplacedItems = ffeItems.filter((i) => !placements.some((p) => p.ffeItemId === i.id));
  const floorMaterials = materials.filter((m) => m.category === "flooring");
  const wallMaterials = materials.filter((m) => m.category === "wall");
  const ceilingMaterials = materials.filter((m) => m.category === "ceiling");

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_320px]">
      <Card className="shadow-card">
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <CardTitle className="font-heading text-base">{floorPlan.name}</CardTitle>
          <div className="flex gap-2">
            {drawMode ? (
              <>
                <Button size="sm" variant="secondary" disabled={drawPoints.length < 3} onClick={() => setNamingRoom(true)}>Finish Room ({drawPoints.length} pts)</Button>
                <Button size="sm" variant="ghost" onClick={() => { setDrawMode(false); setDrawPoints([]); }}><X className="size-3.5" /> Cancel</Button>
              </>
            ) : (
              <Button size="sm" variant="outline" onClick={() => setDrawMode(true)}><Pencil className="size-3.5" /> Draw Room</Button>
            )}
            <Link href={`/floor-plans/${floorPlanId}/walkthrough`}>
              <Button size="sm"><Box className="size-3.5" /> 3D Walkthrough</Button>
            </Link>
          </div>
        </CardHeader>
        <CardContent>
          {drawMode && <p className="mb-2 text-xs text-px-muted">Click to add points (min 3), then "Finish Room".</p>}
          <svg
            ref={svgRef}
            viewBox={`${minX} ${minY} ${maxX - minX} ${maxY - minY}`}
            className="h-[600px] w-full rounded-lg border border-px-border bg-px-concrete/20"
            onPointerDown={handleCanvasClick}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
          >
            {rooms.map((r) => (
              <g key={r.id}>
                <polygon
                  points={r.polygon.map((p) => `${p.x},${p.y}`).join(" ")}
                  fill={hexWithAlpha(r.floorMaterial?.colorHex ?? "#cccccc", 0.35)}
                  stroke="#1C2B3A" strokeWidth={4}
                />
                <text x={centroid(r.polygon).x} y={centroid(r.polygon).y} textAnchor="middle" fontSize={16} fill="#1C2B3A" fontWeight={600}>{r.name}</text>
              </g>
            ))}

            {drawPoints.length > 0 && (
              <polyline
                points={drawPoints.map((p) => `${p.x},${p.y}`).join(" ")}
                fill="none" stroke="#F5820A" strokeWidth={3} strokeDasharray="6 4"
              />
            )}
            {drawPoints.map((p, i) => <circle key={i} cx={p.x} cy={p.y} r={5} fill="#F5820A" />)}

            {placements.map((p) => {
              const w = Number(p.item?.widthCm ?? 60);
              const d = Number(p.item?.depthCm ?? 60);
              const x = Number(p.x), y = Number(p.y);
              const rot = Number(p.rotationDeg);
              const color = CATEGORY_COLORS[p.item?.category ?? "other"];
              const isSelected = selectedPlacementId === p.id;
              return (
                <g key={p.id} transform={`rotate(${rot} ${x} ${y})`} onPointerDown={(e) => startDrag(e, p)} className="cursor-move">
                  <rect
                    x={x - w / 2} y={y - d / 2} width={w} height={d} rx={4}
                    fill={color} fillOpacity={0.75}
                    stroke={isSelected ? "#F5820A" : "#1C2B3A"} strokeWidth={isSelected ? 4 : 1.5}
                  />
                  <text x={x} y={y} textAnchor="middle" dominantBaseline="middle" fontSize={11} fill="#fff">{p.item?.itemName}</text>
                </g>
              );
            })}
          </svg>

          {selectedPlacementId && (
            <div className="mt-2 flex items-center gap-2">
              <Button size="sm" variant="outline" onClick={rotateSelected}><RotateCw className="size-3.5" /> Rotate 15°</Button>
              <Button size="sm" variant="outline" onClick={removeSelected}><Trash2 className="size-3.5" /> Remove</Button>
            </div>
          )}
        </CardContent>
      </Card>

      <div className="space-y-4">
        <Card className="shadow-card">
          <CardHeader><CardTitle className="font-heading text-sm">Rooms</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            {rooms.length === 0 && <p className="text-xs text-px-muted">No rooms yet -- draw one on the canvas.</p>}
            {rooms.map((r) => (
              <div key={r.id} className="space-y-1.5 rounded-lg border border-px-border p-2.5">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-medium text-px-ink">{r.name}</p>
                  <Button size="sm" variant="ghost" onClick={() => removeRoom(r.id)}><Trash2 className="size-3.5" /></Button>
                </div>
                <Select value={r.floorMaterialId ?? undefined} onValueChange={(v) => setRoomMaterial(r.id, "floorMaterialId", v)}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Floor material" /></SelectTrigger>
                  <SelectContent>{floorMaterials.map((m) => <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>)}</SelectContent>
                </Select>
                <Select value={r.wallMaterialId ?? undefined} onValueChange={(v) => setRoomMaterial(r.id, "wallMaterialId", v)}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Wall material" /></SelectTrigger>
                  <SelectContent>{wallMaterials.map((m) => <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>)}</SelectContent>
                </Select>
                <Select value={r.ceilingMaterialId ?? undefined} onValueChange={(v) => setRoomMaterial(r.id, "ceilingMaterialId", v)}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Ceiling material" /></SelectTrigger>
                  <SelectContent>{ceilingMaterials.map((m) => <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card className="shadow-card">
          <CardHeader><CardTitle className="font-heading text-sm">Unplaced FF&E Items</CardTitle></CardHeader>
          <CardContent className="space-y-1.5">
            {unplacedItems.length === 0 && <p className="text-xs text-px-muted">All items placed, or none specified yet.</p>}
            {unplacedItems.map((i) => (
              <div key={i.id} className="flex items-center justify-between rounded-lg border border-px-border p-2">
                <span className="text-xs text-px-ink">{i.itemName}</span>
                <Button size="sm" variant="outline" onClick={() => placeFurniture(i.id)}>Place</Button>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      <Dialog open={namingRoom} onOpenChange={setNamingRoom}>
        <DialogContent>
          <DialogHeader><DialogTitle>Name this room</DialogTitle></DialogHeader>
          <div className="space-y-1.5"><Label>Room Name</Label><Input value={roomName} onChange={(e) => setRoomName(e.target.value)} placeholder="e.g. Living Room" /></div>
          <DialogFooter><Button onClick={finishRoom} disabled={!roomName.trim()}>Add Room</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
