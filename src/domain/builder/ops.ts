/**
 * Edit operations on a TwinSpec. The agent's chat refinements and the review screen's manual edits
 * both go through these, so every change is explicit, validated and attributable.
 */
import { z } from "zod";
import { ASSET_KINDS } from "../archetypes";
import type { AssetKind } from "../types";
import { INTEGRATION_KINDS, uniqueId, type Prov, type TwinSpec } from "./spec";

const s = (max = 80) => z.string().trim().max(max);
const opt = <T extends z.ZodTypeAny>(t: T) => t.nullish();

export const SpecOpSchema = z.object({
  op: z.enum([
    "add_machine",
    "update_machine",
    "remove_machine",
    "move_machine",
    "add_line",
    "update_line",
    "remove_line",
    "add_product",
    "update_product",
    "remove_product",
    "add_material",
    "update_material",
    "add_integration",
    "remove_integration",
    "update_site",
    "answer_question",
    "add_assumption",
    "set_option",
  ]),
  lineId: opt(s(40)),
  machineId: opt(s(40)),
  productId: opt(s(40)),
  materialId: opt(s(40)),
  integrationId: opt(s(40)),
  questionId: opt(s(40)),
  position: opt(z.number().int().min(0).max(20)),
  name: opt(s()),
  archetype: opt(s(20)),
  ratePerHour: opt(z.number().finite().positive().max(200000)),
  clearRate: opt(z.boolean()),
  role: opt(z.enum(["process", "packing"])),
  productIds: opt(z.array(s(40)).max(4)),
  unit: opt(s(20)),
  unitPrice: opt(z.number().finite().positive()),
  unitMaterialCost: opt(z.number().finite().positive()),
  materials: opt(z.array(z.object({ materialId: s(40), qtyPerUnit: z.number().finite().positive() })).max(8)),
  unitCost: opt(z.number().finite().positive()),
  leadTimeHours: opt(z.number().finite().positive()),
  onHand: opt(z.number().finite().min(0)),
  target: opt(s(40)),
  kind: opt(s(20)),
  address: opt(s(200)),
  industry: opt(s()),
  location: opt(s()),
  productionType: opt(s(120)),
  text: opt(s(400)),
  option: opt(z.enum(["rehearsalIncident", "linesInterchangeable"])),
  value: opt(z.boolean()),
});
export type SpecOp = z.infer<typeof SpecOpSchema>;

export interface ApplyResult {
  spec: TwinSpec;
  applied: string[];
  rejected: string[];
}

/** Apply operations in order. Invalid operations are rejected with a reason; the rest still apply. */
export function applyOps(input: TwinSpec, ops: SpecOp[], prov: Prov): ApplyResult {
  const spec = structuredClone(input);
  const applied: string[] = [];
  const rejected: string[] = [];
  const taken = new Set<string>([
    ...spec.lines.map((l) => l.id),
    ...spec.lines.flatMap((l) => l.machines.map((m) => m.id)),
    ...spec.products.map((p) => p.id),
    ...spec.materials.map((m) => m.id),
    ...spec.integrations.map((i) => i.id),
  ]);
  // A line needs one machine, so add_line creates a placeholder; it is replaced by the first real add_machine.
  const placeholders = new Map<string, string>();
  const archetype = (a: string | null | undefined): AssetKind | null => (a && (ASSET_KINDS as string[]).includes(a) ? (a as AssetKind) : null);
  const findLine = (id?: string | null) => spec.lines.find((l) => l.id === id);
  const findMachine = (id?: string | null) => {
    for (const l of spec.lines) {
      const i = l.machines.findIndex((m) => m.id === id);
      if (i >= 0) return { line: l, index: i, machine: l.machines[i] };
    }
    return null;
  };

  for (const raw of ops) {
    const parsed = SpecOpSchema.safeParse(raw);
    if (!parsed.success) {
      rejected.push(`Invalid operation: ${parsed.error.issues[0]?.message ?? "unknown"}`);
      continue;
    }
    const o = parsed.data;
    const fail = (why: string) => rejected.push(`${o.op}: ${why}`);
    switch (o.op) {
      case "add_machine": {
        const line = findLine(o.lineId);
        // Models sometimes put the machine type in `kind`; accept it only if it is a valid machine type.
        const kind = archetype(o.archetype) ?? archetype(o.kind);
        if (!line) fail(`line "${o.lineId}" not found`);
        else if (!kind) fail(`"${o.archetype}" is not a supported machine type`);
        else if (line.machines.length >= 8) fail(`${line.name} already has 8 machines`);
        else {
          const name = o.name || kind;
          const ph = placeholders.get(line.id);
          if (ph && line.machines.length === 1 && line.machines[0].id === ph) line.machines = [];
          placeholders.delete(line.id);
          const m = { id: uniqueId(`${line.name} ${name}`, taken), name, archetype: kind, ratePerHour: o.ratePerHour ?? null, notes: null, box: null, prov };
          const at = o.position == null ? line.machines.length : Math.min(o.position, line.machines.length);
          line.machines.splice(at, 0, m);
          applied.push(`Added ${name} to ${line.name}`);
        }
        break;
      }
      case "update_machine": {
        const hit = findMachine(o.machineId);
        if (!hit) fail(`machine "${o.machineId}" not found`);
        else {
          const kind = o.archetype ? archetype(o.archetype) : null;
          if (o.archetype && !kind) {
            fail(`"${o.archetype}" is not a supported machine type`);
            break;
          }
          if (o.name) hit.machine.name = o.name;
          if (kind) hit.machine.archetype = kind;
          if (o.ratePerHour) hit.machine.ratePerHour = o.ratePerHour;
          if (o.clearRate) hit.machine.ratePerHour = null;
          hit.machine.prov = prov;
          applied.push(`Updated ${hit.machine.name}`);
        }
        break;
      }
      case "remove_machine": {
        const hit = findMachine(o.machineId);
        if (!hit) fail(`machine "${o.machineId}" not found`);
        else if (hit.line.machines.length === 1) fail(`${hit.line.name} needs at least one machine; remove the line instead`);
        else {
          hit.line.machines.splice(hit.index, 1);
          spec.integrations = spec.integrations.filter((i) => i.target !== hit.machine.id);
          applied.push(`Removed ${hit.machine.name} from ${hit.line.name}`);
        }
        break;
      }
      case "move_machine": {
        const hit = findMachine(o.machineId);
        if (!hit || o.position == null) fail("machine or position missing");
        else {
          const [m] = hit.line.machines.splice(hit.index, 1);
          hit.line.machines.splice(Math.min(o.position, hit.line.machines.length), 0, m);
          applied.push(`Moved ${m.name} to position ${Math.min(o.position, hit.line.machines.length - 1) + 1}`);
        }
        break;
      }
      case "add_line": {
        const kind = archetype(o.archetype) ?? "workstation";
        if (spec.lines.length >= 5) fail("at most 5 lines are supported");
        else {
          const name = o.name || `Line ${spec.lines.length + 1}`;
          const id = uniqueId(name, taken);
          const role = o.role ?? "process";
          const productIds = role === "process" ? (o.productIds ?? (spec.products[0] ? [spec.products[0].id] : [])) : [];
          const line = { id, name, role, productIds, box: null, prov, machines: [{ id: uniqueId(`${name} ${kind}`, taken), name: o.text || kind, archetype: kind, ratePerHour: null, notes: null, box: null, prov }] };
          if (!o.archetype && !o.text) placeholders.set(id, line.machines[0].id);
          if (role === "packing") spec.lines.push(line);
          else {
            const firstPacking = spec.lines.findIndex((l) => l.role === "packing");
            spec.lines.splice(firstPacking < 0 ? spec.lines.length : firstPacking, 0, line);
          }
          applied.push(`Added ${role} line ${name}`);
        }
        break;
      }
      case "update_line": {
        const line = findLine(o.lineId);
        if (!line) fail(`line "${o.lineId}" not found`);
        else {
          if (o.name) line.name = o.name;
          if (o.role) line.role = o.role;
          if (o.productIds) line.productIds = o.productIds.filter((p) => spec.products.some((x) => x.id === p));
          line.prov = prov;
          applied.push(`Updated ${line.name}`);
        }
        break;
      }
      case "remove_line": {
        const line = findLine(o.lineId);
        if (!line) fail(`line "${o.lineId}" not found`);
        else if (spec.lines.length === 1) fail("a twin needs at least one line");
        else {
          spec.lines = spec.lines.filter((l) => l.id !== line.id);
          const gone = new Set([line.id, ...line.machines.map((m) => m.id)]);
          spec.integrations = spec.integrations.filter((i) => !gone.has(i.target));
          applied.push(`Removed ${line.name}`);
        }
        break;
      }
      case "add_product": {
        if (spec.products.length >= 6) fail("at most 6 products are supported");
        else {
          const name = o.name || `Product ${spec.products.length + 1}`;
          const id = uniqueId(name, taken);
          spec.products.push({ id, name, unit: o.unit || "units", ratePerHour: o.ratePerHour ?? null, unitPrice: o.unitPrice ?? null, unitMaterialCost: o.unitMaterialCost ?? null, materials: o.materials ?? [], prov });
          const line = findLine(o.lineId);
          if (line && line.role === "process" && line.productIds.length < 4) line.productIds.push(id);
          applied.push(`Added product ${name}${line ? ` on ${line.name}` : ""}`);
        }
        break;
      }
      case "update_product": {
        const p = spec.products.find((x) => x.id === o.productId);
        if (!p) fail(`product "${o.productId}" not found`);
        else {
          if (o.name) p.name = o.name;
          if (o.unit) p.unit = o.unit;
          if (o.ratePerHour) p.ratePerHour = o.ratePerHour;
          if (o.clearRate) p.ratePerHour = null;
          if (o.unitPrice) p.unitPrice = o.unitPrice;
          if (o.unitMaterialCost) p.unitMaterialCost = o.unitMaterialCost;
          if (o.materials) p.materials = o.materials;
          p.prov = prov;
          applied.push(`Updated product ${p.name}`);
        }
        break;
      }
      case "remove_product": {
        const p = spec.products.find((x) => x.id === o.productId);
        if (!p) fail(`product "${o.productId}" not found`);
        else {
          spec.products = spec.products.filter((x) => x.id !== p.id);
          for (const l of spec.lines) l.productIds = l.productIds.filter((x) => x !== p.id);
          applied.push(`Removed product ${p.name}`);
        }
        break;
      }
      case "add_material": {
        if (spec.materials.length >= 12) fail("at most 12 materials are supported");
        else {
          const name = o.name || `Material ${spec.materials.length + 1}`;
          spec.materials.push({ id: uniqueId(name, taken), name, unit: o.unit || "pcs", onHand: o.onHand ?? null, unitCost: o.unitCost ?? null, leadTimeHours: o.leadTimeHours ?? null, supplier: null, prov });
          applied.push(`Added material ${name}`);
        }
        break;
      }
      case "update_material": {
        const m = spec.materials.find((x) => x.id === o.materialId);
        if (!m) fail(`material "${o.materialId}" not found`);
        else {
          if (o.name) m.name = o.name;
          if (o.unit) m.unit = o.unit;
          if (o.unitCost) m.unitCost = o.unitCost;
          if (o.leadTimeHours) m.leadTimeHours = o.leadTimeHours;
          if (o.onHand != null) m.onHand = o.onHand;
          m.prov = prov;
          applied.push(`Updated material ${m.name}`);
        }
        break;
      }
      case "add_integration": {
        const kind = o.kind as (typeof INTEGRATION_KINDS)[number];
        const validTarget = o.target === "site" || !!findLine(o.target) || !!findMachine(o.target);
        if (!(INTEGRATION_KINDS as readonly string[]).includes(o.kind ?? "")) fail(`"${o.kind}" is not a supported connection type`);
        else if (!validTarget) fail(`target "${o.target}" not found`);
        else {
          spec.integrations.push({ id: uniqueId(`conn ${kind} ${o.target}`, taken), target: o.target!, kind, address: o.address ?? null, notes: o.text ?? null, prov });
          applied.push(`Planned ${kind.toUpperCase()} connection for ${o.target}`);
        }
        break;
      }
      case "remove_integration": {
        const before = spec.integrations.length;
        spec.integrations = spec.integrations.filter((i) => i.id !== o.integrationId);
        if (spec.integrations.length === before) fail(`connection "${o.integrationId}" not found`);
        else applied.push("Removed a planned connection");
        break;
      }
      case "update_site": {
        if (o.name) spec.site.name = o.name;
        if (o.industry) spec.site.industry = o.industry;
        if (o.location != null) spec.site.location = o.location;
        if (o.productionType != null) spec.site.productionType = o.productionType;
        spec.site.prov = prov;
        applied.push("Updated site details");
        break;
      }
      case "answer_question": {
        const q = spec.questions.find((x) => x.id === o.questionId);
        if (!q) fail(`question "${o.questionId}" not found`);
        else {
          q.answer = o.text ?? "";
          applied.push(`Answered: ${q.text.slice(0, 60)}`);
        }
        break;
      }
      case "add_assumption": {
        if (o.text) {
          spec.assumptions.push(o.text);
          applied.push("Recorded an assumption");
        } else fail("text missing");
        break;
      }
      case "set_option": {
        if (!o.option || o.value == null) fail("option or value missing");
        else {
          spec.options[o.option] = o.value;
          applied.push(`${o.option} ${o.value ? "on" : "off"}`);
        }
        break;
      }
    }
  }
  return { spec, applied, rejected };
}
