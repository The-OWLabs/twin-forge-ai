/**
 * Serializable model for the isometric factory renderer, plus world-space layout.
 * Used by the Twin Studio (live state) and by the landing-page story (scripted scenario).
 */
import type { AssetKind, AssetStatus, FactoryState, LineState } from "@/domain/types";

const SERIES = ["var(--color-series-1)", "var(--color-series-2)", "var(--color-series-3)", "var(--color-series-4)"];

export interface IsoMachine {
  id: string;
  name: string;
  kind: AssetKind;
  status: AssetStatus;
  health: number;
  throughput: number;
  sensors: number;
}

export interface IsoLine {
  id: string;
  name: string;
  kind: "assembly" | "packaging";
  color: string;
  state: LineState;
  product: string;
  machines: IsoMachine[];
}

export interface IsoModel {
  lines: IsoLine[];
  inventory: { id: string; name: string; fill: number; low: boolean }[];
  orders: { id: string; customer: string; progress: number; atRisk: boolean; priority: string }[];
}

export function isoModelFromState(state: FactoryState, orderRisk: Record<string, boolean> = {}): IsoModel {
  return {
    lines: state.lines.map((l, i) => ({
      id: l.id,
      name: l.name,
      kind: l.kind,
      color: SERIES[i % SERIES.length],
      state: l.state,
      product: Object.entries(l.allocation)
        .filter(([, s]) => s > 0)
        .map(([p]) => p)
        .join(" · "),
      machines: l.assetIds
        .map((id) => state.assets.find((a) => a.id === id))
        .filter((a): a is NonNullable<typeof a> => !!a)
        .map((a) => ({ id: a.id, name: a.name, kind: a.kind, status: a.status, health: a.healthScore, throughput: a.signal.throughput, sensors: a.sensors.length })),
    })),
    inventory: state.inventory.map((i) => ({ id: i.id, name: i.name, fill: Math.max(0.08, Math.min(1, i.onHand / (i.reorderPoint * 3))), low: i.onHand < i.reorderPoint * 1.25 })),
    orders: state.orders.map((o) => ({ id: o.id, customer: o.customer, progress: o.fulfilled / o.quantity, atRisk: !!orderRisk[o.id], priority: o.priority })),
  };
}

/* ───────────────────────────── World layout ───────────────────────────── */

export type Dir = "x" | "y";

export interface PlacedMachine {
  m: IsoMachine;
  lineId: string;
  color: string;
  x: number; // footprint centre
  y: number;
  dir: Dir; // material flow direction
  index: number; // global order (used for staggered build)
}

export interface Belt {
  id: string;
  lineId: string;
  color: string;
  from: [number, number];
  to: [number, number];
  running: boolean;
}

export interface Bay {
  id: string;
  name: string;
  color: string;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface Layout {
  machines: PlacedMachine[];
  belts: Belt[];
  bays: Bay[];
  racks: { id: string; name: string; x: number; y: number; fill: number; low: boolean }[];
  trucks: { id: string; customer: string; x: number; y: number; progress: number; atRisk: boolean; priority: string }[];
  bounds: { x0: number; y0: number; x1: number; y1: number };
}

/** Footprint along flow (L), across flow (W) and body height (H), in world units. */
export const FOOTPRINT: Record<AssetKind, { L: number; W: number; H: number }> = {
  conveyor: { L: 1.9, W: 0.8, H: 0.42 },
  press: { L: 1.25, W: 1.15, H: 0.7 },
  robot: { L: 1.0, W: 1.0, H: 0.32 },
  camera: { L: 1.3, W: 1.05, H: 0.62 },
  packager: { L: 1.6, W: 1.35, H: 1.05 },
  labeler: { L: 1.1, W: 0.95, H: 0.78 },
};

const PITCH = 2.7; // machine spacing along flow
const LINE_GAP = 3.4; // spacing between assembly lines

export function layoutIso(model: IsoModel): Layout {
  const machines: PlacedMachine[] = [];
  const belts: Belt[] = [];
  const bays: Bay[] = [];
  const assembly = model.lines.filter((l) => l.kind === "assembly");
  const packaging = model.lines.filter((l) => l.kind === "packaging");
  const running = (s: LineState) => s === "running" || s === "starved";
  let idx = 0;
  let maxX = 0;

  assembly.forEach((line, li) => {
    const y = li * LINE_GAP;
    line.machines.forEach((m, j) => {
      const x = 1.2 + j * PITCH;
      machines.push({ m, lineId: line.id, color: line.color, x, y, dir: "x", index: idx++ });
      if (j > 0) {
        const prevX = 1.2 + (j - 1) * PITCH;
        belts.push({ id: `${line.id}-${j}`, lineId: line.id, color: line.color, from: [prevX + 0.55, y], to: [x - 0.55, y], running: running(line.state) });
      }
      maxX = Math.max(maxX, x);
    });
    const endX = 1.2 + (line.machines.length - 1) * PITCH;
    bays.push({ id: line.id, name: line.name, color: line.color, x0: 0, y0: y - 1.15, x1: endX + 1.1, y1: y + 1.15 });
  });

  const asmWidth = assembly.length ? maxX : 0;
  const pkgX = asmWidth + 2.9;
  const asmSpanY = Math.max(0, (assembly.length - 1) * LINE_GAP);
  let dockY = asmSpanY + 3;

  packaging.forEach((line) => {
    // Packaging runs along +y from the merge point at the top of the assembly area.
    const startY = 0;
    line.machines.forEach((m, j) => {
      const y = startY + j * PITCH;
      machines.push({ m, lineId: line.id, color: line.color, x: pkgX, y, dir: "y", index: idx++ });
      if (j > 0) {
        belts.push({ id: `${line.id}-${j}`, lineId: line.id, color: line.color, from: [pkgX, startY + (j - 1) * PITCH + 0.55], to: [pkgX, y - 0.55], running: running(line.state) });
      }
    });
    const endY = startY + Math.max(0, line.machines.length - 1) * PITCH;
    bays.push({ id: line.id, name: line.name, color: line.color, x0: pkgX - 1.15, y0: startY - 1.15, x1: pkgX + 1.15, y1: endY + 1.15 });
    // Transfer belts from each assembly line end into the packaging infeed
    assembly.forEach((al, li) => {
      const y = li * LINE_GAP;
      const endX = 1.2 + (al.machines.length - 1) * PITCH;
      const targetY = Math.min(y, endY);
      belts.push({ id: `xfer-${al.id}`, lineId: al.id, color: al.color, from: [endX + 0.6, y], to: [pkgX - 0.75, targetY], running: running(al.state) });
    });
    dockY = endY + 2.4;
  });

  // Warehouse racks (inventory) on the infeed side
  const racks = model.inventory.map((it, k) => ({ id: it.id, name: it.name, x: -1.9 - (k % 2) * 1.25, y: -0.6 + Math.floor(k / 2) * 1.35, fill: it.fill, low: it.low }));

  // Shipping dock trucks (orders) at the end of packaging
  const trucks = model.orders.map((o, k) => ({ id: o.id, customer: o.customer, x: pkgX - 1.4 - k * 2.25, y: dockY, progress: o.progress, atRisk: o.atRisk, priority: o.priority }));

  const xs = [...machines.map((m) => m.x), ...racks.map((r) => r.x), ...trucks.map((t) => t.x), pkgX + 1.5];
  const ys = [...machines.map((m) => m.y), ...racks.map((r) => r.y), ...trucks.map((t) => t.y), -1.5];
  return {
    machines,
    belts,
    bays,
    racks,
    trucks,
    bounds: { x0: Math.min(...xs) - 1.6, y0: Math.min(...ys) - 1.2, x1: Math.max(...xs) + 1.6, y1: Math.max(...ys) + 1.6 },
  };
}
