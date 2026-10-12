import { DomainError } from "@/domain/actions";
import { appendAudit } from "@/domain/audit";
import { buildRecommendation } from "@/domain/recommendations";
import { json, nowISO, parseBody, route } from "@/server/http";
import { CreateRecommendationSchema } from "@/server/schemas";
import { getState, mutate } from "@/server/store";

export const dynamic = "force-dynamic";

export const GET = route(() => json({ recommendations: getState().recommendations }));

/** Operator-initiated recommendation from a stored scenario run. */
export const POST = route(async (req: Request) => {
  const { scenarioRunId, scenarioId } = await parseBody(req, CreateRecommendationSchema);
  const at = nowISO();
  const rec = mutate((s) => {
    const run = s.scenarioRuns.find((r) => r.id === scenarioRunId);
    if (!run) throw new DomainError(`Scenario run ${scenarioRunId} not found`, 404);
    const result = run.results.find((r) => r.definition.id === scenarioId);
    if (!result) throw new DomainError(`Scenario ${scenarioId} not in ${scenarioRunId}`, 404);
    if (result.definition.kind === "baseline") throw new DomainError("The reference plan is not an actionable option", 400);
    if (!result.feasible) throw new DomainError(`Scenario is infeasible: ${result.infeasibleReason}`, 400);
    if (!result.hourly.length) throw new DomainError("Scenario run is too old to act on — re-run the simulation", 409);
    const r = buildRecommendation(s, run, scenarioId, { source: "operator", analysisId: null, nowISO: at });
    for (const other of s.recommendations) {
      if (other.status === "pending" && other.affectedAssetIds[0] === r.affectedAssetIds[0]) other.status = "superseded";
    }
    s.recommendations.unshift(r);
    s.recommendations = s.recommendations.slice(0, 20);
    appendAudit(s, at, {
      category: "recommendation",
      actor: "Operator",
      title: `${r.id} created from scenario "${result.definition.name}" — awaiting approval`,
      detail: r.title,
      severity: "warning",
      refs: { recommendationId: r.id, scenarioRunId: run.id, assetIds: r.affectedAssetIds },
    });
    return r;
  });
  return json({ recommendation: rec, state: getState() }, 201);
});
