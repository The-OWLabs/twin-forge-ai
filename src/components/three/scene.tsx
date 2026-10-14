"use client";

import { useEffect, useMemo, useRef } from "react";
import { useFrame, type ThreeEvent } from "@react-three/fiber";
import { Line } from "@react-three/drei";
import * as THREE from "three";
import type { AssetStatus } from "@/domain/types";
import { machineParts, type Part, type Tone } from "../iso/geometry";
import { FOOTPRINT, type Belt, type Bay, type Layout, type PlacedCamera, type PlacedMachine } from "../iso/model";
import { amrPose, type AmrPath } from "./amr-paths";
import type { Palette } from "./palette";

/** Layout (x, y on the floor, z up) → three.js (x, y up, z). */
export const P = (x: number, y: number, z = 0) => [x, z, y] as [number, number, number];

export const STATUS_COLOR: Record<AssetStatus, string> = {
  healthy: "#10b981",
  warning: "#f59e0b",
  critical: "#ef4444",
  offline: "#64748b",
  maintenance: "#818cf8",
};
const CAM_LENS: Record<string, string> = { area: "#38bdf8", inspection: "#4c8dff", thermal: "#fb923c", dock: "#38bdf8" };
const CARTON = "#c8935f";

function toneColor(tone: Tone, pal: Palette, accent: string) {
  switch (tone) {
    case "body":
      return pal["top"];
    case "trim":
      return pal["trim-top"];
    case "dark":
      return pal["dark"];
    case "belt":
      return pal["belt"];
    case "carton":
      return CARTON;
    case "white":
      return "#eef2f8";
    case "glass":
      return "#7dd3fc";
    case "accent":
      return accent;
  }
}

const pick = (fn?: () => void) =>
  fn
    ? {
        onClick: (e: ThreeEvent<MouseEvent>) => {
          e.stopPropagation();
          fn();
        },
        onPointerOver: (e: ThreeEvent<PointerEvent>) => {
          e.stopPropagation();
          document.body.style.cursor = "pointer";
        },
        onPointerOut: () => {
          document.body.style.cursor = "";
        },
      }
    : {};

/* ─────────────────────────────── floor ─────────────────────────────── */

export function Floor({ layout, pal, onMiss }: { layout: Layout; pal: Palette; onMiss: () => void }) {
  const b = layout.bounds;
  const w = b.x1 - b.x0 + 6;
  const d = b.y1 - b.y0 + 6;
  const grid = useMemo(() => {
    const pts: number[] = [];
    for (let x = Math.ceil(b.x0 - 3); x <= b.x1 + 3; x += 1) pts.push(x, 0.002, b.y0 - 3, x, 0.002, b.y1 + 3);
    for (let y = Math.ceil(b.y0 - 3); y <= b.y1 + 3; y += 1) pts.push(b.x0 - 3, 0.002, y, b.x1 + 3, 0.002, y);
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
    return g;
  }, [b.x0, b.x1, b.y0, b.y1]);
  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={P((b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2, 0)} receiveShadow onClick={onMiss}>
        <planeGeometry args={[w, d]} />
        <meshStandardMaterial color={pal.floor} roughness={0.95} />
      </mesh>
      <lineSegments geometry={grid}>
        <lineBasicMaterial color={pal.grid} transparent opacity={0.9} />
      </lineSegments>
    </group>
  );
}

export function BayZone({ bay, pal, color, hot, dim }: { bay: Bay; pal: Palette; color: string; hot: boolean; dim: boolean }) {
  const corners: [number, number, number][] = [
    P(bay.x0, bay.y0, 0.01),
    P(bay.x1, bay.y0, 0.01),
    P(bay.x1, bay.y1, 0.01),
    P(bay.x0, bay.y1, 0.01),
    P(bay.x0, bay.y0, 0.01),
  ];
  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={P((bay.x0 + bay.x1) / 2, (bay.y0 + bay.y1) / 2, 0.004)} receiveShadow>
        <planeGeometry args={[bay.x1 - bay.x0, bay.y1 - bay.y0]} />
        <meshStandardMaterial color={pal.bay} roughness={0.9} transparent opacity={dim ? 0.5 : 1} />
      </mesh>
      <Line points={corners} color={hot ? pal.accent : color} lineWidth={hot ? 2.2 : 1.2} dashed={!hot} dashSize={0.35} gapSize={0.25} transparent opacity={dim ? 0.4 : 0.8} />
    </group>
  );
}

/* ─────────────────────────────── machines ─────────────────────────────── */

function RobotArm({ points, color, pal, moving, phase }: { points: [number, number, number][]; color: string; pal: Palette; moving: boolean; phase: number }) {
  const ref = useRef<THREE.Group>(null);
  const [bu, bv, bz] = points[0];
  const local = points.map(([u, v, z]) => new THREE.Vector3(u - bu, z - bz, v - bv));
  useFrame(({ clock }) => {
    if (!ref.current) return;
    const t = clock.elapsedTime + phase;
    ref.current.rotation.y = moving ? Math.sin(t * 1.3) * 0.75 : ref.current.rotation.y * 0.95;
  });
  return (
    <group ref={ref} position={[bu, bz, bv]}>
      {local.slice(1).map((p, i) => {
        const a = local[i];
        const dir = new THREE.Vector3().subVectors(p, a);
        const len = dir.length();
        const mid = new THREE.Vector3().addVectors(a, p).multiplyScalar(0.5);
        const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize());
        return (
          <group key={i}>
            <mesh position={mid} quaternion={q} castShadow>
              <cylinderGeometry args={[0.07, 0.085, len, 12]} />
              <meshStandardMaterial color={pal.arm} roughness={0.5} metalness={0.2} />
            </mesh>
            <mesh position={a} castShadow>
              <sphereGeometry args={[0.11, 16, 12]} />
              <meshStandardMaterial color={pal["trim-top"]} roughness={0.5} />
            </mesh>
          </group>
        );
      })}
      <mesh position={local[local.length - 1]}>
        <sphereGeometry args={[0.09, 14, 10]} />
        <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.4} />
      </mesh>
    </group>
  );
}

function StackLight({ position, height, status }: { position: [number, number]; height: number; status: AssetStatus }) {
  const lamp = useRef<THREE.MeshStandardMaterial>(null);
  const color = STATUS_COLOR[status];
  const blink = status === "critical" || status === "offline";
  useFrame(({ clock }) => {
    if (lamp.current) lamp.current.emissiveIntensity = blink ? (Math.sin(clock.elapsedTime * 6) > 0 ? 1.6 : 0.2) : 0.9;
  });
  return (
    <group position={[position[0], 0, position[1]]}>
      <mesh position={[0, height * 0.55 + (height * 0.45 + 0.45) / 2, 0]}>
        <cylinderGeometry args={[0.022, 0.022, height * 0.45 + 0.45, 6]} />
        <meshStandardMaterial color="#64748b" />
      </mesh>
      <mesh position={[0, height + 0.5, 0]}>
        <cylinderGeometry args={[0.07, 0.07, 0.16, 12]} />
        <meshStandardMaterial ref={lamp} color={color} emissive={color} emissiveIntensity={0.9} toneMapped={false} />
      </mesh>
    </group>
  );
}

function Pulse({ w, d, color, dashed }: { w: number; d: number; color: string; dashed?: boolean }) {
  const ref = useRef<THREE.Group>(null);
  useFrame(({ clock }) => {
    if (ref.current) {
      const s = 1 + (dashed ? 0 : 0.04 * Math.sin(clock.elapsedTime * 4));
      ref.current.scale.set(s, 1, s);
    }
  });
  const c: [number, number, number][] = [
    [-w / 2, 0.02, -d / 2],
    [w / 2, 0.02, -d / 2],
    [w / 2, 0.02, d / 2],
    [-w / 2, 0.02, d / 2],
    [-w / 2, 0.02, -d / 2],
  ];
  return (
    <group ref={ref}>
      <Line points={c} color={color} lineWidth={dashed ? 1.6 : 2.6} dashed={dashed} dashSize={0.25} gapSize={0.18} />
    </group>
  );
}

export function Machine3D({
  pm,
  pal,
  status,
  dim,
  selected,
  target,
  reroute,
  onSelect,
}: {
  pm: PlacedMachine;
  pal: Palette;
  status: AssetStatus;
  dim: boolean;
  selected: boolean;
  target: boolean;
  reroute: boolean;
  onSelect?: () => void;
}) {
  const { parts, height } = useMemo(() => machineParts(pm.m.kind), [pm.m.kind]);
  const f = FOOTPRINT[pm.m.kind];
  const line = pal.resolve(pm.color);
  const color = STATUS_COLOR[status];
  const running = status !== "offline" && status !== "maintenance";
  const opacity = dim ? 0.25 : 1;
  const phase = useMemo(() => (pm.index * 1.7) % 6, [pm.index]);
  return (
    <group position={P(pm.x, pm.y)} {...pick(onSelect)}>
      <group rotation={[0, pm.dir === "x" ? 0 : -Math.PI / 2, 0]}>
        {/* status pad */}
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.012, 0]}>
          <planeGeometry args={[f.L + 0.64, f.W + 0.64]} />
          <meshBasicMaterial color={status === "maintenance" ? "#818cf8" : color} transparent opacity={(status === "healthy" ? 0.14 : status === "maintenance" ? 0.5 : 0.3) * (dim ? 0.4 : 1)} depthWrite={false} />
        </mesh>
        {(selected || target || reroute) && <Pulse w={f.L + (selected ? 0.8 : 1.2)} d={f.W + (selected ? 0.8 : 1.2)} color={pal.accent} dashed={reroute && !target && !selected} />}
        {parts.map((p: Part, i) =>
          p.t === "box" ? (
            <mesh key={i} position={[p.u, p.z0 + p.H / 2, p.v]} castShadow receiveShadow>
              <boxGeometry args={[p.L, Math.max(0.01, p.H), p.W]} />
              <meshStandardMaterial
                color={toneColor(p.tone, pal, line)}
                roughness={p.tone === "glass" ? 0.15 : 0.65}
                metalness={p.tone === "trim" || p.tone === "dark" ? 0.25 : 0.05}
                transparent={p.tone === "glass" || dim}
                opacity={(p.tone === "glass" ? 0.55 : 1) * opacity}
              />
            </mesh>
          ) : p.t === "arm" ? (
            <RobotArm key={i} points={p.points} color={line} pal={pal} moving={running && !dim} phase={phase} />
          ) : null,
        )}
        <StackLight position={[-f.L / 2 + 0.16, -f.W / 2 + 0.16]} height={height} status={status} />
      </group>
    </group>
  );
}

/* ─────────────────────────────── belts ─────────────────────────────── */

export function Belt3D({ bt, pal, hot, dim }: { bt: Belt; pal: Palette; hot: boolean; dim: boolean }) {
  const [ax, ay] = bt.from;
  const [bx, by] = bt.to;
  const len = Math.hypot(bx - ax, by - ay);
  const angle = Math.atan2(by - ay, bx - ax);
  const cartons = useRef<THREE.Group>(null);
  const n = Math.max(1, Math.floor(len / 0.75));
  useFrame(({ clock }) => {
    if (!cartons.current || !bt.running) return;
    cartons.current.children.forEach((c, i) => {
      c.position.x = (((clock.elapsedTime * 0.55 + (i * len) / n) % len) + len) % len - len / 2;
    });
  });
  const line = pal.resolve(bt.color);
  return (
    <group position={P((ax + bx) / 2, (ay + by) / 2)} rotation={[0, -angle, 0]}>
      <mesh position={[0, 0.13, 0]} castShadow receiveShadow>
        <boxGeometry args={[len, 0.26, 0.48]} />
        <meshStandardMaterial color={pal.belt} roughness={0.8} transparent={dim} opacity={dim ? 0.3 : 1} />
      </mesh>
      <mesh position={[0, 0.262, 0]}>
        <boxGeometry args={[len, 0.005, 0.36]} />
        <meshBasicMaterial color={hot ? pal.accent : line} transparent opacity={bt.running ? 0.55 : 0.18} />
      </mesh>
      {bt.running && !dim && (
        <group ref={cartons}>
          {Array.from({ length: n }).map((_, i) => (
            <mesh key={i} position={[0, 0.34, 0]} castShadow>
              <boxGeometry args={[0.22, 0.14, 0.26]} />
              <meshStandardMaterial color={CARTON} roughness={0.8} />
            </mesh>
          ))}
        </group>
      )}
    </group>
  );
}

/* ─────────────────────────────── stores & dock ─────────────────────────────── */

export function Rack3D({ rk, pal, selected, dim, onSelect }: { rk: Layout["racks"][number]; pal: Palette; selected: boolean; dim: boolean; onSelect?: () => void }) {
  const h = 1.25;
  const posts: [number, number][] = [
    [-0.42, -0.42],
    [0.42, -0.42],
    [0.42, 0.42],
    [-0.42, 0.42],
  ];
  const op = dim ? 0.35 : 1;
  return (
    <group position={P(rk.x, rk.y)} {...pick(onSelect)}>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.012, 0]}>
        <planeGeometry args={[1.1, 1.1]} />
        <meshBasicMaterial color={rk.low ? "#f59e0b" : pal.grid} transparent opacity={rk.low ? 0.35 : 0.6} depthWrite={false} />
      </mesh>
      {selected && <Pulse w={1.3} d={1.3} color={pal.accent} />}
      {posts.map(([x, z], i) => (
        <mesh key={i} position={[x, h / 2, z]} castShadow>
          <boxGeometry args={[0.05, h, 0.05]} />
          <meshStandardMaterial color="#f59e0b" transparent={dim} opacity={op} />
        </mesh>
      ))}
      {[0.05, 0.62, 1.2].map((y) => (
        <mesh key={y} position={[0, y, 0]} castShadow receiveShadow>
          <boxGeometry args={[0.9, 0.04, 0.9]} />
          <meshStandardMaterial color={pal["trim-top"]} transparent={dim} opacity={op} />
        </mesh>
      ))}
      {rk.fill > 0.01 && (
        <mesh position={[0, 0.07 + (1.1 * rk.fill) / 2, 0]} castShadow>
          <boxGeometry args={[0.78, 1.1 * rk.fill, 0.78]} />
          <meshStandardMaterial color={CARTON} roughness={0.85} transparent={dim} opacity={op} />
        </mesh>
      )}
    </group>
  );
}

export function Truck3D({ t, pal, selected, onSelect }: { t: Layout["trucks"][number]; pal: Palette; selected: boolean; onSelect?: () => void }) {
  const pad = useRef<THREE.MeshBasicMaterial>(null);
  useFrame(({ clock }) => {
    if (pad.current && t.atRisk) pad.current.opacity = 0.18 + 0.14 * (Math.sin(clock.elapsedTime * 3) + 1);
  });
  const fill = Math.max(0.04, Math.min(1, t.progress));
  const wheels: [number, number][] = [
    [-0.6, -0.44],
    [0.6, -0.44],
    [-0.6, 0.44],
    [0.6, 0.44],
    [-1.25, -0.44],
    [-1.25, 0.44],
  ];
  return (
    <group position={P(t.x, t.y)} {...pick(onSelect)}>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[-0.3, 0.012, 0]}>
        <planeGeometry args={[3.1, 1.5]} />
        <meshBasicMaterial ref={pad} color={t.atRisk ? "#ef4444" : pal.grid} transparent opacity={t.atRisk ? 0.25 : 0.5} depthWrite={false} />
      </mesh>
      {selected && <Pulse w={3.3} d={1.7} color={pal.accent} />}
      {/* load inside the trailer */}
      <mesh position={[0.85 - (1.7 * fill) / 2, 0.17 + 0.36, 0]} castShadow>
        <boxGeometry args={[1.7 * fill - 0.04, 0.72, 0.76]} />
        <meshStandardMaterial color={CARTON} roughness={0.85} />
      </mesh>
      <mesh position={[0, 0.17 + 0.42, 0]} castShadow>
        <boxGeometry args={[1.72, 0.84, 0.86]} />
        <meshStandardMaterial color="#f4f7fb" transparent opacity={0.35} roughness={0.4} depthWrite={false} />
      </mesh>
      <mesh position={[-1.18, 0.4, 0]} castShadow>
        <boxGeometry args={[0.55, 0.62, 0.84]} />
        <meshStandardMaterial color={t.priority === "critical" ? "#ef4444" : "#4c8dff"} roughness={0.5} />
      </mesh>
      {wheels.map(([x, z], i) => (
        <mesh key={i} position={[x, 0.12, z]} rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[0.12, 0.12, 0.08, 14]} />
          <meshStandardMaterial color="#111827" />
        </mesh>
      ))}
    </group>
  );
}

/* ─────────────────────────────── cameras ─────────────────────────────── */

export function Camera3D({ pc, pal, selected, onSelect }: { pc: PlacedCamera; pal: Palette; selected: boolean; onSelect?: () => void }) {
  const lens = pc.cam.alert ? "#ef4444" : (CAM_LENS[pc.cam.kind] ?? "#38bdf8");
  const fov = useMemo(() => {
    const head = new THREE.Vector3(...P(pc.x, pc.y, pc.z));
    let corners: THREE.Vector3[];
    if (pc.aim) {
      const [ax, ay] = pc.aim;
      const dx = ax - pc.x;
      const dy = ay - pc.y;
      const len = Math.hypot(dx, dy) || 1;
      const px = (-dy / len) * pc.spread;
      const py = (dx / len) * pc.spread;
      const far = 1.18;
      const near = 0.45;
      corners = [
        new THREE.Vector3(...P(pc.x + dx * near + px * 0.4, pc.y + dy * near + py * 0.4, 0.02)),
        new THREE.Vector3(...P(pc.x + dx * far + px, pc.y + dy * far + py, 0.02)),
        new THREE.Vector3(...P(pc.x + dx * far - px, pc.y + dy * far - py, 0.02)),
        new THREE.Vector3(...P(pc.x + dx * near - px * 0.4, pc.y + dy * near - py * 0.4, 0.02)),
      ];
    } else {
      const r = 0.45;
      corners = [
        new THREE.Vector3(...P(pc.x - r, pc.y - r, pc.z - 1.0)),
        new THREE.Vector3(...P(pc.x + r, pc.y - r, pc.z - 1.0)),
        new THREE.Vector3(...P(pc.x + r, pc.y + r, pc.z - 1.0)),
        new THREE.Vector3(...P(pc.x - r, pc.y + r, pc.z - 1.0)),
      ];
    }
    const g = new THREE.BufferGeometry();
    const v: number[] = [];
    for (let i = 0; i < 4; i++) {
      const a = corners[i];
      const b = corners[(i + 1) % 4];
      v.push(head.x, head.y, head.z, a.x, a.y, a.z, b.x, b.y, b.z);
    }
    v.push(corners[0].x, corners[0].y, corners[0].z, corners[1].x, corners[1].y, corners[1].z, corners[2].x, corners[2].y, corners[2].z);
    v.push(corners[0].x, corners[0].y, corners[0].z, corners[2].x, corners[2].y, corners[2].z, corners[3].x, corners[3].y, corners[3].z);
    g.setAttribute("position", new THREE.Float32BufferAttribute(v, 3));
    g.computeVertexNormals();
    return g;
  }, [pc]);
  const fovColor = pc.cam.kind === "thermal" ? "#fb923c" : pal.accent;
  return (
    <group>
      {/* Field of view: only for the selected camera, so the floor stays readable. */}
      {selected && (
        <mesh geometry={fov}>
          <meshBasicMaterial color={fovColor} transparent opacity={0.14} side={THREE.DoubleSide} depthWrite={false} toneMapped={false} />
        </mesh>
      )}
      <group position={P(pc.x, pc.y)} {...pick(onSelect)}>
        {pc.aim && (
          <mesh position={[0, pc.z / 2, 0]} castShadow>
            <cylinderGeometry args={[0.03, 0.04, pc.z, 8]} />
            <meshStandardMaterial color="#64748b" />
          </mesh>
        )}
        <mesh position={[0, pc.z, 0]} castShadow>
          <boxGeometry args={[0.32, 0.2, 0.22]} />
          <meshStandardMaterial color={pal.theme === "dark" ? "#1f2937" : "#e2e8f0"} roughness={0.4} />
        </mesh>
        <mesh position={[0, pc.z - (pc.aim ? 0 : 0.12), 0]}>
          <sphereGeometry args={[0.075, 14, 10]} />
          <meshStandardMaterial color={lens} emissive={lens} emissiveIntensity={0.8} toneMapped={false} />
        </mesh>
        {/* invisible, larger hit area */}
        <mesh position={[0, pc.z, 0]} visible={false}>
          <sphereGeometry args={[0.35, 8, 6]} />
          <meshBasicMaterial />
        </mesh>
      </group>
    </group>
  );
}

/* ─────────────────────────────── mobile robots ─────────────────────────────── */

export const AMR_SPEED = 1.1; // layout units per second of animation
export const AMR_DWELL = 1.6; // seconds per load / unload in the animation

export function Amr3D({ path, pal, index, selected, onSelect, register }: { path: AmrPath; pal: Palette; index: number; selected: boolean; onSelect?: () => void; register?: (id: string, o: THREE.Object3D | null) => void }) {
  const body = useRef<THREE.Group>(null);
  useEffect(() => {
    register?.(path.amr.id, body.current);
    return () => register?.(path.amr.id, null);
  }, [register, path.amr.id]);
  const cargo = useRef<THREE.Mesh>(null);
  const forks = useRef<THREE.Group>(null);
  const beacon = useRef<THREE.MeshStandardMaterial>(null);
  const color = pal.resolve(path.color);
  const amr = path.amr;
  const parked = amr.status === "parked";
  const speed = AMR_SPEED * (amr.speedMps || 1);
  // Robots of one fleet are spread evenly along their shared route.
  const cycle = (2 * path.length) / speed + 2 * AMR_DWELL;
  const phase = (index % 3) * 0.7 + (path.slot * cycle) / Math.max(1, path.fleetSize);
  const heading = useRef(0);
  // Parking spots side by side at the start of the route.
  const park = useMemo(() => {
    const [x0, y0] = path.points[0];
    const [x1, y1] = path.points[1] ?? [x0 + 1, y0];
    const len = Math.hypot(x1 - x0, y1 - y0) || 1;
    const off = path.slot * 0.6;
    return { x: x0 + (-(y1 - y0) / len) * off, y: y0 + ((x1 - x0) / len) * off, heading: Math.atan2(y1 - y0, x1 - x0) };
  }, [path.points, path.slot]);
  useFrame(({ clock }) => {
    if (!body.current) return;
    if (parked) {
      body.current.position.set(...P(park.x, park.y));
      body.current.rotation.y = -park.heading;
      if (cargo.current) cargo.current.visible = false;
      if (beacon.current) beacon.current.emissiveIntensity = Math.sin(clock.elapsedTime * 3) > 0 ? 1.4 : 0.3;
      return;
    }
    const pose = amrPose(path, clock.elapsedTime, speed, AMR_DWELL, phase);
    body.current.position.set(...P(pose.x, pose.y));
    // Smoothly turn toward the travel direction (layout y maps to three z, so the angle is negated).
    const target = -pose.heading;
    let d = target - heading.current;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    heading.current += d * 0.2;
    body.current.rotation.y = heading.current;
    if (cargo.current) cargo.current.visible = pose.loaded;
    if (forks.current) forks.current.position.y = pose.loaded ? 0.22 : 0.06;
    if (beacon.current) beacon.current.emissiveIntensity = pose.phase === "moving" || pose.phase === "returning" ? 1.2 : 0.5;
  });
  const routePts = path.points.map(([x, y]) => P(x, y, 0.025));
  const beaconColor = parked ? "#f59e0b" : "#22c55e";
  const type = amr.robotType;
  const big = type === "agv" || type === "forklift-agv";
  const L = big ? 0.78 : 0.62;
  const W = big ? 0.52 : 0.44;
  const bodyColor = type === "forklift-agv" ? "#f59e0b" : pal.dark;
  const cargoGeom: [number, number, number] = amr.mission === "kitting" ? [0.42, 0.18, 0.32] : amr.mission === "line-transfer" ? [0.44, 0.22, 0.34] : [0.5, 0.3, 0.38];
  const cargoColor = amr.mission === "finished-goods" ? CARTON : "#3b82f6";
  return (
    <group>
      {path.slot === 0 && (
        <Line points={routePts} color={color} lineWidth={selected ? 2.4 : 1.3} dashed dashSize={0.2} gapSize={0.16} transparent opacity={parked ? 0.25 : selected ? 0.95 : 0.5} />
      )}
      <group ref={body} {...pick(onSelect)}>
        <mesh position={[0, 0.11, 0]} castShadow>
          <boxGeometry args={[L, type === "forklift-agv" ? 0.26 : 0.16, W]} />
          <meshStandardMaterial color={bodyColor} roughness={0.5} metalness={0.3} />
        </mesh>
        <mesh position={[0, 0.11, W / 2 + 0.003]}>
          <boxGeometry args={[L - 0.12, 0.05, 0.005]} />
          <meshBasicMaterial color={color} />
        </mesh>
        <mesh position={[0, 0.11, -W / 2 - 0.003]}>
          <boxGeometry args={[L - 0.12, 0.05, 0.005]} />
          <meshBasicMaterial color={color} />
        </mesh>
        {/* lidar */}
        <mesh position={[L / 2 - 0.08, type === "forklift-agv" ? 0.3 : 0.22, 0]}>
          <cylinderGeometry args={[0.05, 0.05, 0.06, 14]} />
          <meshStandardMaterial color="#111827" />
        </mesh>
        <mesh position={[-L / 2 + 0.1, type === "forklift-agv" ? 0.32 : 0.24, W / 2 - 0.09]}>
          <sphereGeometry args={[0.045, 12, 8]} />
          <meshStandardMaterial ref={beacon} color={beaconColor} emissive={beaconColor} emissiveIntensity={1} toneMapped={false} />
        </mesh>
        {type === "forklift-agv" ? (
          <>
            {/* mast and forks in front */}
            {[-0.16, 0.16].map((z) => (
              <mesh key={z} position={[L / 2 + 0.04, 0.55, z]} castShadow>
                <boxGeometry args={[0.05, 1.05, 0.05]} />
                <meshStandardMaterial color="#334155" />
              </mesh>
            ))}
            <group ref={forks} position={[L / 2 + 0.3, 0.06, 0]}>
              {[-0.13, 0.13].map((z) => (
                <mesh key={z} position={[0, 0, z]}>
                  <boxGeometry args={[0.5, 0.03, 0.07]} />
                  <meshStandardMaterial color="#475569" metalness={0.4} />
                </mesh>
              ))}
              <mesh ref={cargo} position={[0, 0.2, 0]} castShadow>
                <boxGeometry args={[0.5, 0.36, 0.42]} />
                <meshStandardMaterial color={cargoColor} roughness={0.75} />
              </mesh>
            </group>
          </>
        ) : type === "tugger" ? (
          <>
            {/* tow bar and cart behind */}
            <mesh position={[-L / 2 - 0.12, 0.1, 0]}>
              <boxGeometry args={[0.24, 0.03, 0.04]} />
              <meshStandardMaterial color="#334155" />
            </mesh>
            <mesh position={[-L / 2 - 0.55, 0.12, 0]} castShadow>
              <boxGeometry args={[0.62, 0.06, 0.44]} />
              <meshStandardMaterial color="#64748b" />
            </mesh>
            <mesh ref={cargo} position={[-L / 2 - 0.55, 0.12 + cargoGeom[1] / 2 + 0.03, 0]} castShadow>
              <boxGeometry args={cargoGeom} />
              <meshStandardMaterial color={cargoColor} roughness={0.7} />
            </mesh>
          </>
        ) : (
          <mesh ref={cargo} position={[-0.02, 0.19 + cargoGeom[1] / 2, 0]} castShadow>
            <boxGeometry args={cargoGeom} />
            <meshStandardMaterial color={cargoColor} roughness={0.7} />
          </mesh>
        )}
        {/* larger, invisible hit area */}
        <mesh visible={false}>
          <boxGeometry args={[L + 0.3, 0.6, W + 0.3]} />
          <meshBasicMaterial />
        </mesh>
      </group>
    </group>
  );
}
