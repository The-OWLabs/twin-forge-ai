import type { Amr } from "@/domain/intralogistics";
import type { Layout } from "../iso/model";

/** A robot's route on the floor (layout units): it runs start → end loaded, then back empty. */
export interface AmrPath {
  amr: Amr;
  color: string;
  points: [number, number][];
  length: number;
}

const polyLength = (ps: [number, number][]) => ps.slice(1).reduce((s, p, i) => s + Math.hypot(p[0] - ps[i][0], p[1] - ps[i][1]), 0);

/**
 * Routes that keep to the aisles: kitting robots use the corridor between the stores racks and
 * the line bays, then enter their line's bay beside the first machine; pallet robots leave the
 * packing line's outfeed and run along the dock apron to the truck being loaded.
 */
export function amrPaths(layout: Layout, fleet: Amr[], lineOrder: string[]): AmrPath[] {
  const out: AmrPath[] = [];
  const racks = layout.racks;
  const rackEdge = racks.length ? Math.max(...racks.map((r) => r.x)) + 0.45 : -1.4;
  const pickY = racks.length ? racks.reduce((s, r) => s + r.y, 0) / racks.length : 0;
  let k = 0;
  for (const amr of fleet) {
    const bay = layout.bays.find((b) => b.id === amr.lineId);
    const ms = layout.machines.filter((m) => m.lineId === amr.lineId);
    if (!bay || !ms.length) continue;
    const color = ms[0].color;
    if (amr.mission === "kitting") {
      const corridor = (rackEdge + bay.x0) / 2 - 0.12 * (k % 3);
      const first = ms[0];
      const dropY = first.y - 0.88;
      const points: [number, number][] = [
        [corridor, pickY + 0.3 * (k % 3)],
        [corridor, dropY],
        [Math.max(bay.x0 + 0.45, first.x - 0.25), dropY],
      ];
      out.push({ amr, color, points, length: polyLength(points) });
      k++;
    } else {
      const last = ms[ms.length - 1];
      const truck = layout.trucks.find((t) => t.progress < 1) ?? layout.trucks[0];
      const outfeed: [number, number] = last.dir === "y" ? [last.x, last.y + 0.95] : [last.x + 0.95, last.y];
      if (!truck) continue;
      const apronY = truck.y - 0.85;
      const points: [number, number][] = [outfeed, [outfeed[0], apronY], [truck.x, apronY]];
      out.push({ amr, color, points, length: polyLength(points) });
    }
  }
  // Keep a stable order for rendering (by line order).
  return out.sort((a, b) => lineOrder.indexOf(a.amr.lineId) - lineOrder.indexOf(b.amr.lineId));
}

/**
 * Where a robot is at time `t` (seconds) on a looped mission: load, run to the end, unload, run
 * back. Returns position, heading (radians, layout frame) and whether it is carrying a load.
 */
export function amrPose(path: AmrPath, t: number, speed: number, dwell: number, phase = 0) {
  const travel = path.length / speed;
  const cycle = 2 * travel + 2 * dwell;
  let s = (((t + phase) % cycle) + cycle) % cycle;
  const at = (d: number) => {
    let rem = d;
    for (let i = 1; i < path.points.length; i++) {
      const [x0, y0] = path.points[i - 1];
      const [x1, y1] = path.points[i];
      const seg = Math.hypot(x1 - x0, y1 - y0);
      if (rem <= seg || i === path.points.length - 1) {
        const f = seg ? Math.min(1, rem / seg) : 0;
        return { x: x0 + (x1 - x0) * f, y: y0 + (y1 - y0) * f, heading: Math.atan2(y1 - y0, x1 - x0) };
      }
      rem -= seg;
    }
    const [x, y] = path.points[0];
    return { x, y, heading: 0 };
  };
  if (s < dwell) return { ...at(0), loaded: s > dwell / 2, phase: "loading" as const };
  s -= dwell;
  if (s < travel) return { ...at(s * speed), loaded: true, phase: "moving" as const };
  s -= travel;
  if (s < dwell) return { ...at(path.length), loaded: s < dwell / 2, phase: "unloading" as const };
  s -= dwell;
  const back = at(path.length - s * speed);
  return { ...back, heading: back.heading + Math.PI, loaded: false, phase: "returning" as const };
}
