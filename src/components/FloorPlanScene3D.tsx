"use client";

import { useMemo } from "react";
import { Canvas } from "@react-three/fiber";
import { OrbitControls, Text } from "@react-three/drei";
import * as THREE from "three";
import type { SceneData, SceneRoom } from "./FloorPlanWalkthroughClient";

// cm (server units) -> m (three.js scene units). Room polygon x/y map
// directly to world X/Z (Y is up) with no sign flip -- wall/furniture
// rotation math below assumes this exact mapping.
const CM_TO_M = 0.01;

const CATEGORY_COLORS: Record<string, string> = {
  furniture: "#F5820A", fixture: "#0E7C6E", equipment: "#3B82F6",
  finish: "#A855F7", textile: "#EC4899", lighting: "#EAB308", other: "#94A3B8",
};

function flatPolygonGeometry(polygon: { x: number; y: number }[], elevationM: number) {
  const shapePts = polygon.map((p) => new THREE.Vector2(p.x * CM_TO_M, p.y * CM_TO_M));
  const triangles = THREE.ShapeUtils.triangulateShape(shapePts, []);
  const vertices: number[] = [];
  shapePts.forEach((p) => vertices.push(p.x, elevationM, p.y));
  const indices: number[] = [];
  triangles.forEach((tri) => indices.push(tri[0], tri[1], tri[2]));
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(vertices, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function RoomMesh({ room }: { room: SceneRoom }) {
  const heightM = room.ceilingHeightCm * CM_TO_M;
  const floorGeom = useMemo(() => flatPolygonGeometry(room.polygon, 0), [room.polygon]);
  const ceilingGeom = useMemo(() => flatPolygonGeometry(room.polygon, heightM), [room.polygon, heightM]);

  const edges = room.polygon.map((p, i) => {
    const next = room.polygon[(i + 1) % room.polygon.length];
    const dx = next.x - p.x, dy = next.y - p.y;
    const length = Math.sqrt(dx * dx + dy * dy) * CM_TO_M;
    const angle = Math.atan2(dy, dx);
    return {
      length, angle,
      midX: ((p.x + next.x) / 2) * CM_TO_M,
      midZ: ((p.y + next.y) / 2) * CM_TO_M,
    };
  });

  return (
    <group>
      <mesh geometry={floorGeom}>
        <meshStandardMaterial color={room.floorMaterial.colorHex} roughness={room.floorMaterial.roughness} metalness={room.floorMaterial.metalness} side={THREE.DoubleSide} />
      </mesh>
      <mesh geometry={ceilingGeom}>
        <meshStandardMaterial color={room.ceilingMaterial.colorHex} roughness={room.ceilingMaterial.roughness} metalness={room.ceilingMaterial.metalness} side={THREE.DoubleSide} />
      </mesh>
      {edges.map((e, i) => (
        <mesh key={i} position={[e.midX, heightM / 2, e.midZ]} rotation={[0, -e.angle, 0]}>
          <boxGeometry args={[e.length, heightM, 0.1]} />
          <meshStandardMaterial color={room.wallMaterial.colorHex} roughness={room.wallMaterial.roughness} metalness={room.wallMaterial.metalness} />
        </mesh>
      ))}
    </group>
  );
}

export default function FloorPlanScene3D({ scene }: { scene: SceneData }) {
  // R66 code-quality fix: this bounding-box/camera-centering math was
  // recomputed every render with no memoization, unlike RoomMesh's own
  // geometry above (useMemo on room.polygon). Mirrors that pattern.
  const { centerX, centerZ, span } = useMemo(() => {
    const allPoints = scene.rooms.flatMap((r) => r.polygon);
    const cX = (allPoints.reduce((s, p) => s + p.x, 0) / allPoints.length) * CM_TO_M;
    const cZ = (allPoints.reduce((s, p) => s + p.y, 0) / allPoints.length) * CM_TO_M;
    const spanX = (Math.max(...allPoints.map((p) => p.x)) - Math.min(...allPoints.map((p) => p.x))) * CM_TO_M;
    const spanZ = (Math.max(...allPoints.map((p) => p.y)) - Math.min(...allPoints.map((p) => p.y))) * CM_TO_M;
    return { centerX: cX, centerZ: cZ, span: Math.max(spanX, spanZ, 4) };
  }, [scene.rooms]);

  return (
    <div className="h-[600px] w-full overflow-hidden rounded-lg border border-px-border">
      <Canvas
        camera={{ position: [centerX + span * 0.8, span * 0.9, centerZ + span * 0.8], fov: 55 }}
        gl={{ preserveDrawingBuffer: true }}
        onCreated={({ camera }) => camera.lookAt(centerX, 1, centerZ)}
      >
        <ambientLight intensity={0.6} />
        <directionalLight position={[10, 15, 10]} intensity={0.8} />
        {scene.rooms.map((r) => <RoomMesh key={r.id} room={r} />)}
        {scene.placements.map((p) => {
          const w = (p.widthCm || 60) * CM_TO_M, d = (p.depthCm || 60) * CM_TO_M, h = (p.heightCm || 80) * CM_TO_M;
          const x = p.x * CM_TO_M, z = p.y * CM_TO_M;
          const color = CATEGORY_COLORS[p.category] ?? "#888888";
          return (
            <group key={p.id} position={[x, h / 2, z]} rotation={[0, -THREE.MathUtils.degToRad(p.rotationDeg), 0]}>
              <mesh>
                <boxGeometry args={[w, h, d]} />
                <meshStandardMaterial color={color} roughness={0.7} />
              </mesh>
              <Text position={[0, h / 2 + 0.15, 0]} fontSize={0.12} color="#1C2B3A" anchorX="center" anchorY="bottom">
                {p.itemName}
              </Text>
            </group>
          );
        })}
        <OrbitControls target={[centerX, 1, centerZ]} maxPolarAngle={Math.PI / 2 - 0.02} />
      </Canvas>
    </div>
  );
}
