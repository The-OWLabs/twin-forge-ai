import "server-only";
import { aiConfig, aiRuntime, testAi } from "@/server/ai/provider";
import { persistenceInfo } from "@/server/store";
import type { Recommendation, ScenarioRun } from "@/domain/types";
import { bigQuery, cloudStorage, mqtt, pubSub } from "./adapters";

export type IntegrationState = "active-simulated" | "not-configured" | "configured-untested" | "connected" | "error";

export interface IntegrationStatus {
  id: string;
  name: string;
  service: string;
  purpose: string;
  state: IntegrationState;
  detail: string;
  env: { name: string; set: boolean }[];
  fallback: string;
  lastCheckedAt: string | null;
  testable: boolean;
}

type Check = { ok: boolean; detail: string; at: string };
const g = globalThis as unknown as { __twinforgeChecks?: Record<string, Check> };
const checks: Record<string, Check> = (g.__twinforgeChecks ??= {});

const envList = (...names: string[]) => names.map((name) => ({ name, set: !!process.env[name] }));

function stateFor(id: string, configured: boolean): { state: IntegrationState; detail?: string; at: string | null } {
  if (!configured) return { state: "not-configured", at: null };
  const c = checks[id];
  if (!c) return { state: "configured-untested", at: null };
  return { state: c.ok ? "connected" : "error", detail: c.detail, at: c.at };
}

export function integrationStatuses(): IntegrationStatus[] {
  const ai = aiConfig();
  const rt = aiRuntime();
  let aiState: IntegrationState = ai.provider === "none" ? "not-configured" : "configured-untested";
  let aiDetail =
    ai.provider === "none"
      ? "Agents use deterministic narratives generated from simulation outputs."
      : `${ai.model} via ${ai.provider === "vertex" ? `Vertex AI · project ${ai.project} · ${ai.location}` : "Gemini API key"}.`;
  if (ai.provider !== "none") {
    const c = checks["vertex-ai"];
    const lastOk = rt.lastSuccessAt ? Date.parse(rt.lastSuccessAt) : 0;
    const lastErrAt = rt.lastError ? Date.parse(rt.lastError.slice(0, 24)) : 0;
    if (rt.lastSuccessAt && lastOk >= lastErrAt) {
      aiState = "connected";
      aiDetail += ` Last successful call ${rt.lastSuccessAt}${rt.lastLatencyMs ? ` (${rt.lastLatencyMs} ms)` : ""}.`;
    } else if (rt.lastError) {
      aiState = "error";
      aiDetail += ` Last error: ${rt.lastError}`;
    } else if (c) {
      aiState = c.ok ? "connected" : "error";
      aiDetail += ` ${c.detail}`;
    }
  }
  const telemetrySource = pubSub.ingestionEnabled() ? "Pub/Sub" : "Simulated plant model";
  const bq = stateFor("bigquery", bigQuery.configured());
  const ps = stateFor("pubsub", pubSub.configured());
  const gcs = stateFor("gcs", cloudStorage.configured());
  const mq = stateFor("mqtt", mqtt.configured());
  const persistence = persistenceInfo();
  const onCloudRun = !!process.env.K_SERVICE;

  return [
    {
      id: "telemetry",
      name: "Telemetry source",
      service: telemetrySource,
      purpose: "Machine readings that drive the twin.",
      state: "active-simulated",
      detail: pubSub.ingestionEnabled()
        ? "Pub/Sub messages override simulated measurements for matching assets; the plant model still drives production."
        : "Deterministic plant model with seeded noise (2 min of plant time per 4 s tick). This is simulated data, not a live plant.",
      env: envList("TELEMETRY_SOURCE"),
      fallback: "Always available.",
      lastCheckedAt: null,
      testable: false,
    },
    {
      id: "vertex-ai",
      name: "Gemini on Vertex AI",
      service: "Vertex AI",
      purpose: "Agent narratives, trade-off explanations and operator briefings (never the numbers).",
      state: aiState,
      detail: aiDetail,
      env: envList("GOOGLE_CLOUD_PROJECT", "GOOGLE_CLOUD_LOCATION", "GEMINI_MODEL", "GEMINI_API_KEY"),
      fallback: "Deterministic template narrative from simulation outputs.",
      lastCheckedAt: checks["vertex-ai"]?.at ?? rt.lastSuccessAt,
      testable: ai.provider !== "none",
    },
    {
      id: "bigquery",
      name: "BigQuery",
      service: "BigQuery",
      purpose: "Telemetry history, production events, health history, scenario outcomes and decisions.",
      state: bq.state,
      detail: bq.detail ?? (bigQuery.configured() ? `Dataset ${bigQuery.dataset()} — mirrors scenario runs and decisions when connected.` : "Local in-memory history is used."),
      env: envList("GOOGLE_CLOUD_PROJECT", "BIGQUERY_DATASET"),
      fallback: "Seeded local history inside the factory state.",
      lastCheckedAt: bq.at,
      testable: bigQuery.configured(),
    },
    {
      id: "pubsub",
      name: "Pub/Sub telemetry ingestion",
      service: "Pub/Sub",
      purpose: "Streaming ingestion of sensor messages.",
      state: ps.state,
      detail: ps.detail ?? (pubSub.configured() ? `Subscription ${pubSub.subscription()} (ingestion ${pubSub.ingestionEnabled() ? "enabled" : "disabled — set TELEMETRY_SOURCE=pubsub"}).` : "Simulated telemetry is used."),
      env: envList("GOOGLE_CLOUD_PROJECT", "PUBSUB_TELEMETRY_SUBSCRIPTION", "TELEMETRY_SOURCE"),
      fallback: "Simulated telemetry.",
      lastCheckedAt: ps.at,
      testable: pubSub.configured(),
    },
    {
      id: "gcs",
      name: "Cloud Storage documents",
      service: "Cloud Storage",
      purpose: "Maintenance manuals, inspection reports and images per asset.",
      state: gcs.state,
      detail: gcs.detail ?? (cloudStorage.configured() ? `Bucket gs://${cloudStorage.bucket()} (objects under assets/<assetId>/).` : "Bundled local demo documents are served."),
      env: envList("GOOGLE_CLOUD_PROJECT", "GCS_BUCKET"),
      fallback: "Local demo document store (content/docs).",
      lastCheckedAt: gcs.at,
      testable: cloudStorage.configured(),
    },
    {
      id: "mqtt",
      name: "MQTT broker",
      service: "MQTT",
      purpose: "Shop-floor telemetry via an MQTT broker.",
      state: mq.state,
      detail: mq.detail ?? (mqtt.configured() ? `${mqtt.url()} — reachability probe only; subscription not implemented in this MVP.` : "Not configured."),
      env: envList("MQTT_BROKER_URL", "MQTT_TOPIC"),
      fallback: "Simulated telemetry.",
      lastCheckedAt: mq.at,
      testable: mqtt.configured(),
    },
    {
      id: "persistence",
      name: "State persistence",
      service: "Local JSON file",
      purpose: "Keeps factory state across refreshes and restarts.",
      state: persistence.lastWriteError ? "error" : "active-simulated",
      detail: `${persistence.note} ${persistence.path}${persistence.lastWriteError ? ` — write error: ${persistence.lastWriteError}` : ""}`,
      env: envList("TWINFORGE_DATA_DIR"),
      fallback: "In-memory only if the file cannot be written.",
      lastCheckedAt: null,
      testable: false,
    },
    {
      id: "cloud-run",
      name: "Cloud Run runtime",
      service: "Cloud Run",
      purpose: "Container hosting for the web app and API.",
      state: onCloudRun ? "connected" : "not-configured",
      detail: onCloudRun
        ? `Running as service ${process.env.K_SERVICE} (revision ${process.env.K_REVISION ?? "?"}).`
        : "Running locally. See README → Deploy to Cloud Run.",
      env: envList("K_SERVICE"),
      fallback: "Local Node.js server.",
      lastCheckedAt: null,
      testable: false,
    },
  ];
}

export async function testIntegration(id: string): Promise<Check> {
  const at = new Date().toISOString();
  const run = async (): Promise<{ ok: boolean; detail: string }> => {
    switch (id) {
      case "vertex-ai":
        return testAi();
      case "bigquery":
        if (!bigQuery.configured()) return { ok: false, detail: "Not configured (GOOGLE_CLOUD_PROJECT, BIGQUERY_DATASET)." };
        return { ok: true, detail: await bigQuery.test() };
      case "pubsub":
        if (!pubSub.configured()) return { ok: false, detail: "Not configured (GOOGLE_CLOUD_PROJECT, PUBSUB_TELEMETRY_SUBSCRIPTION)." };
        return { ok: true, detail: await pubSub.test() };
      case "gcs":
        if (!cloudStorage.configured()) return { ok: false, detail: "Not configured (GOOGLE_CLOUD_PROJECT, GCS_BUCKET)." };
        return { ok: true, detail: await cloudStorage.test() };
      case "mqtt":
        if (!mqtt.configured()) return { ok: false, detail: "Not configured (MQTT_BROKER_URL)." };
        return { ok: true, detail: await mqtt.test() };
      default:
        return { ok: false, detail: `Integration ${id} has no connectivity test.` };
    }
  };
  let result: { ok: boolean; detail: string };
  try {
    result = await run();
  } catch (e) {
    result = { ok: false, detail: e instanceof Error ? e.message : String(e) };
  }
  const check = { ...result, at };
  // Only record checks for configured integrations so unconfigured ones never appear "connected" or "error".
  const configured =
    id === "vertex-ai" ? aiConfig().provider !== "none" : id === "bigquery" ? bigQuery.configured() : id === "pubsub" ? pubSub.configured() : id === "gcs" ? cloudStorage.configured() : id === "mqtt" ? mqtt.configured() : false;
  if (configured) checks[id] = check;
  return check;
}

/** Best-effort mirroring of scenario runs and decisions to BigQuery when configured. Never throws. */
export async function mirrorScenarioRun(run: ScenarioRun, factoryId: string) {
  if (!bigQuery.configured()) return;
  try {
    await bigQuery.insert("scenario_outcomes", bigQuery.scenarioRows(run, factoryId));
    checks["bigquery"] = { ok: true, detail: `Mirrored ${run.id} (${run.results.length} rows) to scenario_outcomes.`, at: new Date().toISOString() };
  } catch (e) {
    checks["bigquery"] = { ok: false, detail: `Mirror of ${run.id} failed: ${e instanceof Error ? e.message : String(e)}`, at: new Date().toISOString() };
  }
}

export async function mirrorDecision(rec: Recommendation, factoryId: string) {
  if (!bigQuery.configured()) return;
  try {
    await bigQuery.insert("decisions", [bigQuery.decisionRow(rec, factoryId)]);
    checks["bigquery"] = { ok: true, detail: `Mirrored decision ${rec.id} to decisions.`, at: new Date().toISOString() };
  } catch (e) {
    checks["bigquery"] = { ok: false, detail: `Mirror of ${rec.id} failed: ${e instanceof Error ? e.message : String(e)}`, at: new Date().toISOString() };
  }
}
