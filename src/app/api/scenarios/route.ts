import { addScenarioRun } from "@/domain/agents/pipeline";
import { appendAudit } from "@/domain/audit";
import { nextId } from "@/domain/ids";
import { pickFocusAsset, presetScenarios } from "@/domain/scenarios";
import { rankScenarios, simulateScenarios } from "@/domain/simulation";
import type { ScenarioDefinition, ScenarioRun } from "@/domain/types";
import { json, nowISO, parseBody, route } from "@/server/http";
import { mirrorScenarioRun } from "@/server/integrations/status";
import { ScenarioRunSchema } from "@/server/schemas";
import { getState, mutate } from "@/server/store";

export const dynamic = "force-dynamic";

export const GET = route(() => json({ runs: getState().scenarioRuns }));

/** Run (and by default persist) a scenario comparison. Calculations are recomputed server-side. */
export const POST = route(async (req: Request) => {
  const body = await parseBody(req, ScenarioRunSchema);
  const at = nowISO();
  const run = mutate((s) => {
    const target = body.targetAssetId ?? body.definitions?.[0]?.params.targetAssetId ?? pickFocusAsset(s).id;
    if (!s.assets.some((a) => a.id === target)) throw new Error(`Unknown asset ${target}`);
    const defs = (body.definitions as ScenarioDefinition[] | undefined) ?? presetScenarios(s, target);
    const results = simulateScenarios(s, defs);
    const ranking = rankScenarios(results);
    const r: ScenarioRun = {
      id: body.persist ? nextId(s, "RUN", 500) : "PREVIEW",
      createdHour: s.clock.hour,
      at,
      source: "operator",
      targetAssetId: target,
      results,
      baselineId: results.find((x) => x.definition.kind === "baseline")?.definition.id ?? results[0].definition.id,
      recommendedId: ranking[0]?.scenarioId ?? null,
      ranking,
    };
    if (body.persist) {
      addScenarioRun(s, r);
      appendAudit(s, at, {
        category: "scenario",
        actor: "Operator",
        title: `Scenario run ${r.id}: ${results.length} scenarios for ${target}`,
        detail: ranking.map((x) => `${results.find((y) => y.definition.id === x.scenarioId)?.definition.name} ${x.score.toFixed(1)}`).join(" · "),
        severity: "info",
        refs: { scenarioRunId: r.id, assetIds: [target] },
      });
    }
    return r;
  });
  if (body.persist) void mirrorScenarioRun(run, getState().profile.id);
  return json({ run, state: getState() });
});
