import "server-only";
import { Type, type Schema } from "@google/genai";
import { z } from "zod";

/**
 * Convert a tool's zod shape into a Gemini function-declaration schema. ADK ships its own zod
 * copy, so tools hand it plain schemas; arguments are still validated by the tool layer.
 */
function toSchema(t: z.ZodTypeAny): Schema {
  const description = t.description;
  if (t instanceof z.ZodOptional || t instanceof z.ZodNullable) return { ...toSchema(t.unwrap()), nullable: true, ...(description ? { description } : {}) };
  if (t instanceof z.ZodDefault) return toSchema(t._def.innerType);
  const base = (s: Schema): Schema => (description ? { ...s, description } : s);
  if (t instanceof z.ZodString) return base({ type: Type.STRING });
  if (t instanceof z.ZodBoolean) return base({ type: Type.BOOLEAN });
  if (t instanceof z.ZodEnum) return base({ type: Type.STRING, enum: [...t.options] });
  if (t instanceof z.ZodNumber) {
    const checks = t._def.checks as { kind: string; value?: number }[];
    const min = checks.find((c) => c.kind === "min")?.value;
    const max = checks.find((c) => c.kind === "max")?.value;
    return base({ type: checks.some((c) => c.kind === "int") ? Type.INTEGER : Type.NUMBER, ...(min !== undefined ? { minimum: min } : {}), ...(max !== undefined ? { maximum: max } : {}) });
  }
  if (t instanceof z.ZodArray) return base({ type: Type.ARRAY, items: toSchema(t.element) });
  if (t instanceof z.ZodObject) return base(objectSchema(t.shape));
  return base({ type: Type.STRING });
}

export function objectSchema(shape: z.ZodRawShape): Schema {
  const entries = Object.entries(shape) as [string, z.ZodTypeAny][];
  return {
    type: Type.OBJECT,
    properties: Object.fromEntries(entries.map(([k, v]) => [k, toSchema(v)])),
    required: entries.filter(([, v]) => !v.isOptional()).map(([k]) => k),
  };
}
