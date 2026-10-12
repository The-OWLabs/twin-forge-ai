import { json } from "@/server/http";

/** API index — a lightweight, self-describing endpoint list. */
export function GET() {
  return json({
    name: "TwinForge AI API",
    version: "0.1.0",
    endpoints: [
      ["GET", "/api/health", "Service health and persistence info"],
      ["GET", "/api/factory", "Full factory state (single source of truth)"],
      ["POST", "/api/factory", "Create a factory twin from a blueprint"],
      ["POST", "/api/factory/reset", "Restore the reproducible demo factory"],
      ["POST", "/api/demo/crisis", "Reset + inject the scripted bearing-damage incident"],
      ["POST", "/api/telemetry/tick", "Advance live simulated telemetry one step (throttled)"],
      ["POST", "/api/telemetry/live", "Start/stop live telemetry simulation {enabled}"],
      ["POST", "/api/sim/advance", "Fast-forward the plant model {hours}"],
      ["GET", "/api/assets", "List assets"],
      ["POST", "/api/assets", "Add an asset to a line"],
      ["PATCH", "/api/assets/:id", "Update asset properties"],
      ["GET", "/api/assets/:id/telemetry", "Telemetry history, trend estimates and diagnostics"],
      ["POST", "/api/connections", "Add a dependency between nodes"],
      ["POST", "/api/faults", "Fault injection (simulation control)"],
      ["GET", "/api/anomalies", "Run anomaly detection on current telemetry"],
      ["POST", "/api/agents/analyze", "Run the multi-agent investigation (NDJSON stream)"],
      ["POST", "/api/scenarios", "Run and store a scenario comparison"],
      ["POST", "/api/scenarios/compare", "Stateless scenario comparison"],
      ["GET", "/api/recommendations", "List recommendations"],
      ["POST", "/api/recommendations", "Create a recommendation from a scenario"],
      ["POST", "/api/recommendations/:id/approve", "Approve and execute (simulated)"],
      ["POST", "/api/recommendations/:id/reject", "Reject"],
      ["POST", "/api/recommendations/:id/rollback", "Roll back an approved plan"],
      ["GET", "/api/audit", "Audit timeline (?category=&limit=)"],
      ["GET", "/api/kpis", "Executive KPIs"],
      ["GET", "/api/integrations", "Integration status (honest)"],
      ["POST", "/api/integrations/test", "Run a connectivity test {id}"],
      ["GET", "/api/documents", "Asset documents (?assetId=)"],
      ["GET", "/api/documents/:id", "Read a local document"],
    ].map(([method, path, description]) => ({ method, path, description })),
  });
}
