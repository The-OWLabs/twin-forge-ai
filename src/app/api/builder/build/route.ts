import { z } from "zod";
import { compileSpec } from "@/domain/builder/compile";
import { validateSpec } from "@/domain/builder/validate";
import { defaultAnchor } from "@/domain/seed";
import { json, nowISO, parseBody, route } from "@/server/http";
import { replaceState } from "@/server/store";

export const dynamic = "force-dynamic";

/** Build the live twin from a reviewed spec. Deterministic; replaces the current factory. */
export const POST = route(async (req: Request) => {
  const { spec, by } = await parseBody(req, z.object({ spec: z.unknown(), by: z.string().trim().min(1).max(60).default("Operator") }));
  const v = validateSpec(spec);
  if (!v.ok || !v.spec) return json({ error: "The spec has errors to fix before building", issues: v.issues.filter((i) => i.level === "error").map((i) => i.message) }, 400);
  const seed = Math.floor(Date.now() / 1000) % 2147483647;
  const state = compileSpec(v.spec, defaultAnchor(), seed, nowISO(), by);
  return json(replaceState(state), 201);
});
