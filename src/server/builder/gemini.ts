import "server-only";
import { ASSET_KINDS } from "@/domain/archetypes";
import { ARCHETYPE_CATALOG, BlueprintReadingSchema, DraftSchema, type ResearchResult } from "@/domain/builder/draft";
import { SpecOpSchema } from "@/domain/builder/ops";
import type { BuilderAi } from "@/domain/builder/pipeline";
import { INTEGRATION_KINDS, type TwinSpec } from "@/domain/builder/spec";
import { aiConfig, geminiGenerate } from "@/server/ai/provider";

/**
 * Gemini implementation of the Twin Builder agent. Every call uses a JSON schema (except grounded
 * research, which returns cited notes) and every response is validated with zod before use.
 */

const SOURCES = ["blueprint", "requirement", "reference", "template", "default"];
const nstr = { type: ["string", "null"] };
const nnum = { type: ["number", "null"] };

const READ_SCHEMA = {
  type: "object",
  properties: {
    legible: { type: "boolean" },
    drawingKind: { type: "string", description: "floor plan, process flow diagram, P&ID, equipment layout, hand sketch, photo or other" },
    summary: { type: "string", description: "Two or three sentences describing what the drawing shows." },
    siteName: nstr,
    industry: nstr,
    elements: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string", description: "e1, e2, …" },
          label: { type: "string", description: "Label exactly as written on the drawing, or a short description if unlabelled." },
          role: { type: "string", enum: ["machine", "conveyor", "storage", "dock", "utility", "office", "other"] },
          archetype: { type: "string", enum: [...ASSET_KINDS, "none"] },
          lineHint: nstr,
          box: { type: "array", items: { type: "number" }, description: "[ymin, xmin, ymax, xmax] on a 0–1000 grid" },
          confidence: { type: "number" },
        },
        required: ["id", "label", "role", "archetype", "lineHint", "box", "confidence"],
      },
    },
    flows: { type: "array", items: { type: "object", properties: { from: { type: "string" }, to: { type: "string" } }, required: ["from", "to"] } },
    notes: { type: "array", items: { type: "string" } },
  },
  required: ["legible", "drawingKind", "summary", "siteName", "industry", "elements", "flows", "notes"],
};

const DRAFT_SCHEMA = {
  type: "object",
  properties: {
    site: {
      type: "object",
      properties: { name: { type: "string" }, industry: { type: "string" }, location: { type: "string" }, productionType: { type: "string" } },
      required: ["name", "industry", "location", "productionType"],
    },
    lines: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: { type: "string" },
          role: { type: "string", enum: ["process", "packing"] },
          products: { type: "array", items: { type: "string" } },
          source: { type: "string", enum: SOURCES },
          note: nstr,
          machines: {
            type: "array",
            items: {
              type: "object",
              properties: {
                name: { type: "string" },
                archetype: { type: "string", enum: ASSET_KINDS },
                ratePerHour: nnum,
                source: { type: "string", enum: SOURCES },
                note: nstr,
                refs: { type: "array", items: { type: "string" } },
                blueprintElement: nstr,
              },
              required: ["name", "archetype", "ratePerHour", "source", "note", "refs", "blueprintElement"],
            },
          },
        },
        required: ["name", "role", "products", "source", "note", "machines"],
      },
    },
    products: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: { type: "string" },
          unit: { type: "string" },
          ratePerHour: nnum,
          unitPrice: nnum,
          unitMaterialCost: nnum,
          source: { type: "string", enum: SOURCES },
          note: nstr,
          refs: { type: "array", items: { type: "string" } },
          materials: { type: "array", items: { type: "object", properties: { material: { type: "string" }, qtyPerUnit: { type: "number" } }, required: ["material", "qtyPerUnit"] } },
        },
        required: ["name", "unit", "ratePerHour", "unitPrice", "unitMaterialCost", "source", "note", "refs", "materials"],
      },
    },
    materials: {
      type: "array",
      items: {
        type: "object",
        properties: { name: { type: "string" }, unit: { type: "string" }, unitCost: nnum, leadTimeHours: nnum, source: { type: "string", enum: SOURCES }, note: nstr },
        required: ["name", "unit", "unitCost", "leadTimeHours", "source", "note"],
      },
    },
    integrations: {
      type: "array",
      items: {
        type: "object",
        properties: { target: { type: "string" }, kind: { type: "string", enum: INTEGRATION_KINDS }, address: nstr, note: nstr, source: { type: "string", enum: SOURCES } },
        required: ["target", "kind", "address", "note", "source"],
      },
    },
    assumptions: { type: "array", items: { type: "string" } },
    questions: { type: "array", items: { type: "string" } },
  },
  required: ["site", "lines", "products", "materials", "integrations", "assumptions", "questions"],
};

const OP_FIELDS = Object.keys(SpecOpSchema.shape).filter((k) => k !== "op" && !["archetype", "kind", "position", "lineId", "machineId"].includes(k));
/** Fields models confuse most, described explicitly. */
const OP_DESCRIPTIONS = {
  archetype: { type: ["string", "null"], enum: [...ASSET_KINDS, null], description: "Machine type. Required for add_machine; optional for update_machine and add_line." },
  kind: { type: ["string", "null"], enum: [...INTEGRATION_KINDS, null], description: "Connection type. Only for add_integration." },
  position: { type: ["number", "null"], description: "0-based index in the line's machine list (add_machine, move_machine). To insert after the machine at index i, use i + 1." },
  lineId: { type: ["string", "null"], description: "Existing line id from the spec." },
  machineId: { type: ["string", "null"], description: "Existing machine id from the spec." },
};
const REFINE_SCHEMA = {
  type: "object",
  properties: {
    explanation: { type: "string", description: "One or two sentences on what you changed and why." },
    ops: {
      type: "array",
      items: {
        type: "object",
        properties: {
          op: { type: "string", enum: SpecOpSchema.shape.op.options },
          ...OP_DESCRIPTIONS,
          ...Object.fromEntries(
            OP_FIELDS.map((k) => [
              k,
              ["position", "ratePerHour", "unitPrice", "unitMaterialCost", "unitCost", "leadTimeHours", "onHand"].includes(k)
                ? nnum
                : ["clearRate", "value"].includes(k)
                  ? { type: ["boolean", "null"] }
                  : k === "productIds"
                    ? { type: ["array", "null"], items: { type: "string" } }
                    : k === "materials"
                      ? { type: ["array", "null"], items: { type: "object", properties: { materialId: { type: "string" }, qtyPerUnit: { type: "number" } }, required: ["materialId", "qtyPerUnit"] } }
                      : nstr,
            ]),
          ),
        },
        // Every field is required (null when it does not apply): optional fields get silently dropped otherwise.
        required: ["op", ...Object.keys(OP_DESCRIPTIONS), ...OP_FIELDS],
      },
    },
  },
  required: ["explanation", "ops"],
};

const json = (text: string | undefined) => {
  const t = (text ?? "").trim().replace(/^```(?:json)?\s*|\s*```$/g, "");
  return JSON.parse(t);
};

function compactSpec(spec: TwinSpec) {
  return {
    site: { name: spec.site.name, industry: spec.site.industry, location: spec.site.location, productionType: spec.site.productionType },
    lines: spec.lines.map((l) => ({ id: l.id, name: l.name, role: l.role, productIds: l.productIds, machines: l.machines.map((m) => ({ id: m.id, name: m.name, archetype: m.archetype, ratePerHour: m.ratePerHour })) })),
    products: spec.products.map((p) => ({ id: p.id, name: p.name, unit: p.unit, ratePerHour: p.ratePerHour, materials: p.materials })),
    materials: spec.materials.map((m) => ({ id: m.id, name: m.name, unit: m.unit })),
    integrations: spec.integrations.map((i) => ({ id: i.id, target: i.target, kind: i.kind, address: i.address })),
    questions: spec.questions,
    options: spec.options,
  };
}

/** Insert [R#] markers after the sentences each grounding chunk supports. */
function citeNotes(text: string, supports: { segment?: { text?: string }; groundingChunkIndices?: number[] }[], refIdForChunk: (i: number) => string | null) {
  let out = text;
  const seen = new Set<string>();
  for (const s of supports) {
    const seg = s.segment?.text?.trim();
    if (!seg || seen.has(seg)) continue;
    seen.add(seg);
    const ids = [...new Set((s.groundingChunkIndices ?? []).map(refIdForChunk).filter((x): x is string => !!x))];
    if (!ids.length) continue;
    const at = out.indexOf(seg);
    if (at >= 0) out = `${out.slice(0, at + seg.length)} [${ids.join(", ")}]${out.slice(at + seg.length)}`;
  }
  return out;
}

export function geminiBuilderAi(): BuilderAi {
  const cfg = aiConfig();
  const available = cfg.provider !== "none";
  return {
    available,
    model: available ? cfg.model : null,

    async readBlueprint(file, hints) {
      const prompt = [
        "You are reading a drawing of an industrial facility for a digital-twin builder. It may be a floor plan, process flow diagram, P&ID, equipment layout, hand sketch or photo.",
        "List every production machine, conveyor or transfer path, storage area, dock and utility you can actually see. Do not invent anything that is not on the drawing.",
        "For each element: give the label exactly as written (or a short description if unlabelled), its role, the closest machine archetype from this catalog (\"none\" if it is not production equipment), a lineHint grouping elements that belong to the same line (from arrows, flow lines or layout), and a bounding box [ymin, xmin, ymax, xmax] on a 0–1000 grid.",
        "Report material-flow links between elements. confidence is your own 0–1 estimate. If the drawing is illegible, set legible to false and explain in summary.",
        "",
        "Machine archetype catalog:",
        ARCHETYPE_CATALOG,
        "",
        `Context from the user (may be empty): industry=${hints.industry ?? ""}; requirements=${hints.requirements.slice(0, 1500)}`,
      ].join("\n");
      const { res } = await geminiGenerate({
        contents: [{ role: "user", parts: [{ inlineData: { mimeType: file.mimeType, data: file.data } }, { text: prompt }] }],
        config: { responseMimeType: "application/json", responseJsonSchema: READ_SCHEMA, maxOutputTokens: 8192 },
        timeoutMs: 90_000,
      });
      const raw = json(res.text);
      for (const e of raw.elements ?? []) if (e.archetype === "none") e.archetype = null;
      return BlueprintReadingSchema.parse(raw);
    },

    async research(q) {
      const prompt = [
        `Research the standard production setup for this factory, using current web sources: industry "${q.industry}"${q.productionType ? `, process "${q.productionType}"` : ""}.`,
        q.requirements ? `The owner says: ${q.requirements.slice(0, 1500)}` : "",
        q.drawing ? `Their layout drawing shows: ${q.drawing}` : "",
        "Report concisely in bullet points:",
        "1. The typical sequence of process steps and equipment from raw material to packed product (standard line layout).",
        "2. Typical throughput of a line and of the key machines, with units, only where sources state them.",
        "3. Common failure modes and condition-monitoring sensors for the key equipment.",
        "4. Quality checks and the standards that apply.",
        "5. Typical data interfaces for this equipment (for example OPC UA, MQTT, Modbus).",
        "Do not state numbers that your sources do not support.",
      ]
        .filter(Boolean)
        .join("\n");
      const { res } = await geminiGenerate({ contents: prompt, config: { tools: [{ googleSearch: {} }], maxOutputTokens: 8192 }, timeoutMs: 90_000 });
      const cand = res.candidates?.[0];
      const gm = (cand?.groundingMetadata ?? {}) as {
        groundingChunks?: { web?: { uri?: string; title?: string } }[];
        groundingSupports?: { segment?: { text?: string }; groundingChunkIndices?: number[] }[];
        webSearchQueries?: string[];
        searchEntryPoint?: { renderedContent?: string };
      };
      const references: ResearchResult["references"] = [];
      const idForUri = new Map<string, string>();
      const chunkRef: (string | null)[] = (gm.groundingChunks ?? []).map((c) => {
        const uri = c.web?.uri;
        if (!uri) return null;
        if (!idForUri.has(uri)) {
          if (references.length >= 15) return null;
          const id = `R${references.length + 1}`;
          idForUri.set(uri, id);
          references.push({ id, title: (c.web?.title || new URL(uri).hostname).slice(0, 200), url: uri });
        }
        return idForUri.get(uri)!;
      });
      const notes = citeNotes(res.text ?? "", gm.groundingSupports ?? [], (i) => chunkRef[i] ?? null).slice(0, 8000);
      return { notes, references, queries: gm.webSearchQueries ?? [], searchEntryPoint: gm.searchEntryPoint?.renderedContent ?? null };
    },

    async draft(ctx) {
      const prompt = [
        "You are the Twin Builder agent of an industrial digital-twin platform. Propose the factory structure as JSON matching the schema.",
        "",
        "Rules:",
        "- Use ONLY these machine archetypes. Map each real machine to the closest archetype. `name` is a short descriptive name plus the tag shown on the drawing, if any (for example \"Blow molder BM-101\"):",
        ARCHETYPE_CATALOG,
        "- The simulator supports 1–4 process lines and at most one packing / end-of-line area (role \"packing\") that receives all process-line output. List machines in material-flow order, at most 8 per line. Represent parallel identical machines as one machine with their combined rate and say so in `note`.",
        "- Provenance (`source`): \"blueprint\" only for elements on the blueprint reading (set `blueprintElement` to its id); \"requirement\" for what the user asked for; \"reference\" only when supported by the research notes, citing their [R#] ids in `refs`; \"template\" for elements kept from the given template; otherwise \"default\" for your own typical assumptions.",
        "- Numbers: give ratePerHour, prices and costs ONLY when stated in the requirements, the blueprint or the cited research; otherwise use null and the system will derive stated defaults. Never invent supplier names, addresses or credentials.",
        "- Integrations: only connections the user asked for or that the blueprint shows (PLC, SCADA, historian, cameras). `target` is a line name, a machine name, or \"site\". If the user asks to monitor something without naming the protocol, pick the most likely interface, set source to \"default\" and explain the choice in `note`.",
        "- Put every assumption you make in `assumptions`, and ask up to 6 short `questions` where information that matters is missing.",
        "- If a template is given, start from it and change it to match the requirements and blueprint.",
        "",
        "INPUT:",
        JSON.stringify({
          requirements: ctx.requirements.slice(0, 4000),
          site: ctx.site,
          blueprintReading: ctx.reading,
          researchNotes: ctx.research?.notes ?? null,
          references: ctx.research?.references.map((r) => ({ id: r.id, title: r.title })) ?? [],
          template: ctx.template ? compactSpec(ctx.template) : null,
        }),
      ].join("\n");
      const { res } = await geminiGenerate({ contents: prompt, config: { responseMimeType: "application/json", responseJsonSchema: DRAFT_SCHEMA, maxOutputTokens: 16384 }, timeoutMs: 120_000 });
      return DraftSchema.parse(json(res.text));
    },

    async refine(spec, instruction) {
      const prompt = [
        "You edit a factory digital-twin spec by returning edit operations as JSON. Apply exactly what the user asks, nothing more.",
        "Use existing ids from the spec for lineId, machineId, productId, materialId, integrationId and questionId. For new items give a `name`.",
        `Machine archetypes (archetype field): ${ASSET_KINDS.join(", ")}. Connection kinds (kind field): ${INTEGRATION_KINDS.join(", ")}. For add_integration, target is a line id, machine id or "site".`,
        "Do every part of the request that these operations can express. Skip only the parts they cannot (for example an unsupported protocol) and say which parts you skipped and why in `explanation`.",
        "Only set numbers the user states. Never include credentials.",
        "",
        `SPEC: ${JSON.stringify(compactSpec(spec))}`,
        "",
        `USER REQUEST: ${instruction.slice(0, 2000)}`,
      ].join("\n");
      const { res } = await geminiGenerate({ contents: prompt, config: { responseMimeType: "application/json", responseJsonSchema: REFINE_SCHEMA, maxOutputTokens: 8192 }, timeoutMs: 60_000 });
      const raw = json(res.text) as { explanation?: string; ops?: unknown[] };
      return { explanation: String(raw.explanation ?? "").slice(0, 600), ops: (raw.ops ?? []) as never };
    },
  };
}
