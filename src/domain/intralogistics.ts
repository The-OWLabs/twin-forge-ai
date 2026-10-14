/**
 * Intralogistics: the mobile robots (AMRs) that move material around the plant.
 *
 * The fleet is derived from the twin's material flow rather than stored: each process line gets a
 * kitting robot that brings its components from stores, and each packing line gets a robot that
 * takes finished pallets to the dock. Trip rates follow the line's measured output, and a robot
 * parks (with the reason) when its line stops or a component runs out — so the robots always agree
 * with the plant model. It is a simulated layer: no real robots are connected.
 */
import type { FactoryState, LineState, ProductionLine } from "./types";

/** Units of the line's product kitted into one tote (one trip from stores). */
export const KIT_UNITS_PER_TRIP = 60;
/** Packed units on one pallet (one trip to the dock). */
export const PALLET_UNITS_PER_TRIP = 120;
/** Load or unload time per stop, minutes. */
export const DWELL_MIN = 1.5;
/** Travel speed, metres per second (typical indoor AMR in mixed traffic). */
export const AMR_SPEED_MPS = 1.0;
/** Metres per layout unit (machine pitch 2.7 units ≈ 5.4 m). */
export const METRES_PER_UNIT = 2;

export type AmrMission = "kitting" | "finished-goods";

export interface Amr {
  id: string;
  name: string;
  mission: AmrMission;
  lineId: string;
  lineName: string;
  /** Where it loads and unloads (for display). */
  from: string;
  to: string;
  payload: string;
  unitsPerTrip: number;
  /** Line output the trips are sized from, units per hour. */
  lineRate: number;
  tripsPerHour: number;
  status: "active" | "parked";
  reason: string | null;
}

const PARKED_REASON: Partial<Record<LineState, string>> = {
  down: "Line stopped (breakdown)",
  maintenance: "Line in maintenance",
  changeover: "Line in changeover",
  idle: "Line idle",
};

/** Recent output of a line, units per hour: the last complete hour, else its planned rate. */
export function lineOutputRate(state: FactoryState, line: ProductionLine): number {
  const hour = Math.floor(state.clock.hour);
  const recs = state.production.filter((r) => r.lineId === line.id && r.hour >= hour - 1 && r.hour < hour);
  const planned = recs.reduce((s, r) => s + r.plannedHours, 0);
  if (planned > 0.25) return recs.reduce((s, r) => s + r.goodUnits + r.scrapUnits, 0) / planned;
  return Object.entries(line.allocation).reduce((s, [pid, share]) => s + (line.capabilities.find((c) => c.productId === pid)?.ratePerHour ?? 0) * share, 0);
}

function lineComponents(state: FactoryState, line: ProductionLine) {
  const ids = new Set<string>();
  for (const pid of Object.keys(line.allocation)) for (const b of line.capabilities.find((c) => c.productId === pid)?.bom ?? []) ids.add(b.itemId);
  return state.inventory.filter((i) => ids.has(i.id));
}

export function amrFleet(state: FactoryState): Amr[] {
  const fleet: Amr[] = [];
  const process = state.lines.filter((l) => l.kind === "assembly");
  const packing = state.lines.filter((l) => l.kind === "packaging");
  process.forEach((line) => {
    const comps = lineComponents(state, line).filter((i) => i.category !== "packaging");
    const empty = comps.find((i) => i.onHand <= 0);
    const rate = line.state === "running" ? lineOutputRate(state, line) : 0;
    const parked = line.state !== "running" && line.state !== "starved" ? (PARKED_REASON[line.state] ?? "Line not running") : line.state === "starved" ? `Nothing to deliver: ${empty?.name ?? "a component"} is out of stock` : null;
    fleet.push({
      id: `AMR-${line.code}1`,
      name: `Kitting AMR ${line.code}1`,
      mission: "kitting",
      lineId: line.id,
      lineName: line.name,
      from: "Component stores",
      to: `${line.name} infeed`,
      payload: comps.length ? comps.slice(0, 3).map((i) => i.name).join(", ") + (comps.length > 3 ? ` +${comps.length - 3}` : "") : "Components",
      unitsPerTrip: KIT_UNITS_PER_TRIP,
      lineRate: Math.round(rate),
      tripsPerHour: Math.round((rate / KIT_UNITS_PER_TRIP) * 10) / 10,
      status: parked ? "parked" : "active",
      reason: parked,
    });
  });
  packing.forEach((line) => {
    const rate = line.state === "running" ? lineOutputRate(state, line) : 0;
    const parked = line.state === "running" ? null : line.state === "starved" ? "No packed goods: the packing line is waiting for product" : (PARKED_REASON[line.state] ?? "Line not running");
    const open = state.orders.filter((o) => o.completedHour === null);
    fleet.push({
      id: `AMR-${line.code}1`,
      name: `Pallet AMR ${line.code}1`,
      mission: "finished-goods",
      lineId: line.id,
      lineName: line.name,
      from: `${line.name} outfeed`,
      to: open.length ? `Shipping dock (${open[0].id})` : "Shipping dock",
      payload: "Pallet of packed cartons",
      unitsPerTrip: PALLET_UNITS_PER_TRIP,
      lineRate: Math.round(rate),
      tripsPerHour: Math.round((rate / PALLET_UNITS_PER_TRIP) * 10) / 10,
      status: parked ? "parked" : "active",
      reason: parked,
    });
  });
  return fleet;
}

/** Share of the hour a robot is busy, given its round-trip path length in layout units. */
export function amrUtilisation(amr: Amr, roundTripUnits: number): number {
  const travelMin = (roundTripUnits * METRES_PER_UNIT) / AMR_SPEED_MPS / 60;
  const cycleMin = travelMin + 2 * DWELL_MIN;
  return Math.min(1, (amr.tripsPerHour * cycleMin) / 60);
}
