import "server-only";
import { appendAudit } from "@/domain/audit";
import { aiCapabilities, aiConfig, aiRuntime, modelLabel, PROVIDER_NAME, resetAiRuntime } from "@/server/ai/config";
import { testAi } from "@/server/ai/provider";
import { describeSettings, setting, settingsStorage, SETTINGS, updateSettings, type SettingKey, type SettingView } from "@/server/settings";
import { mutate, persistenceInfo } from "@/server/store";
import type { Recommendation, ScenarioRun } from "@/domain/types";
import { bigQuery, cloudStorage, mqtt, pubSub } from "./adapters";
import { testVisionService, visionService } from "./vision-service";

export type IntegrationState = "active" | "active-simulated" | "not-configured" | "configured-untested" | "connected" | "error";

export interface IntegrationStatus {
  id: string;
  name: string;
  service: string;
  purpose: string;
  state: IntegrationState;
  detail: string;
  /** Settings an admin can change in the UI (each overrides the environment variable of the same name). */
  settings: SettingView[];
  fallback: string;
  lastCheckedAt: string | null;
  testable: boolean;
}

type Check = { ok: boolean; detail: string; at: string };
const g = globalThis as unknown as { __twinforgeChecks?: Record<string, Check> };
const checks: Record<string, Check> = (g.__twinforgeChecks ??= {});

/** Which settings belong to which integration card (the shared project id is edited once, at the top of the page). */
export const INTEGRATION_SETTINGS: Record<string, SettingKey[]> = {
  telemetry: ["TELEMETRY_SOURCE"],
  "vertex-ai": ["AI_ENABLED", "AI_PROVIDER", "GOOGLE_CLOUD_LOCATION", "GEMINI_MODEL", "GEMINI_API_KEY", "ANTHROPIC_MODEL", "ANTHROPIC_API_KEY", "OPENAI_BASE_URL", "OPENAI_MODEL", "OPENAI_API_KEY"],
  "vision-service": ["VISION_SERVICE_URL", "VISION_SERVICE_AUTH"],
  mcp: ["TWINFORGE_MCP_ENABLED", "TWINFORGE_MCP_TOKEN"],
  bigquery: ["BIGQUERY_DATASET"],
  pubsub: ["PUBSUB_TELEMETRY_SUBSCRIPTION"],
  gcs: ["GCS_BUCKET"],
  mqtt: ["MQTT_BROKER_URL", "MQTT_TOPIC"],
};
const settingsFor = (id: string) => describeSettings(INTEGRATION_SETTINGS[id] ?? []);

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
  const caps = aiCapabilities(ai);
  const lacks = [!caps.video && "video (frames are sent instead)", !caps.webSearch && "web research", !caps.pdf && "PDF drawings"].filter(Boolean);
  let aiDetail =
    ai.provider === "none"
      ? ai.disabled
        ? "Turned off in Integrations: no AI calls are made (no AI cost). Agents use deterministic narratives generated from simulation outputs; the copilot is unavailable and the Twin Builder starts from templates."
        : `${PROVIDER_NAME[ai.wanted ?? "vertex"]} is selected but missing: ${ai.missing.join(", ")}. Agents use deterministic narratives.`
      : `${modelLabel(ai)}${ai.provider === "vertex" ? ` · project ${ai.project}` : ""}.${lacks.length ? ` Not available with this provider: ${lacks.join(", ")}.` : ""}`;
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
  const vs = stateFor("vision-service", visionService.configured());
  const persistence = persistenceInfo();
  const store = settingsStorage();
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
      settings: settingsFor("telemetry"),
      fallback: "Always available.",
      lastCheckedAt: null,
      testable: false,
    },
    {
      id: "vertex-ai",
      name: "AI model provider",
      service: ai.provider === "none" ? PROVIDER_NAME[ai.wanted ?? "vertex"] : PROVIDER_NAME[ai.provider],
      purpose: "Agent narratives, the copilot, the Twin Builder and footage review (never the numbers). Gemini, Claude, OpenAI or a compatible endpoint.",
      state: aiState,
      detail: aiDetail,
      settings: settingsFor("vertex-ai"),
      fallback: "Deterministic template narrative from simulation outputs.",
      lastCheckedAt: checks["vertex-ai"]?.at ?? rt.lastSuccessAt,
      testable: ai.provider !== "none",
    },
    {
      id: "vision-service",
      name: "Vision service (FastAPI + OpenCV)",
      service: "Cloud Run · Python",
      purpose: "Deterministic machine-vision checks: golden-board comparison, barcode/QR reading, image quality and video stoppages.",
      state: vs.state,
      detail: vs.detail ?? (visionService.configured() ? `${visionService.url()} — run a connectivity test or an inspection to verify.` : "Machine-vision checks are off. Station-log reviews (and Gemini, if configured) still work."),
      settings: settingsFor("vision-service"),
      fallback: "Station-log review from the plant model.",
      lastCheckedAt: vs.at,
      testable: visionService.configured(),
    },
    mcpStatus(),
    {
      id: "bigquery",
      name: "BigQuery",
      service: "BigQuery",
      purpose: "Telemetry history, production events, health history, scenario outcomes and decisions.",
      state: bq.state,
      detail: bq.detail ?? (bigQuery.configured() ? `Dataset ${bigQuery.dataset()} — mirrors scenario runs and decisions when connected.` : "Local in-memory history is used."),
      settings: settingsFor("bigquery"),
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
      settings: settingsFor("pubsub"),
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
      settings: settingsFor("gcs"),
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
      settings: settingsFor("mqtt"),
      fallback: "Simulated telemetry.",
      lastCheckedAt: mq.at,
      testable: mqtt.configured(),
    },
    {
      id: "persistence",
      name: "State persistence",
      service: "Local JSON file",
      purpose: "Keeps factory state across refreshes and restarts.",
      state: persistence.lastWriteError || !store.ok ? "error" : "active-simulated",
      detail: `${persistence.note} ${persistence.path}${persistence.lastWriteError ? ` — write error: ${persistence.lastWriteError}` : ""} Integration settings: ${store.where}${store.detail ? ` — ${store.detail}` : ""}.`,
      settings: [],
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
      settings: [],
      fallback: "Local Node.js server.",
      lastCheckedAt: null,
      testable: false,
    },
  ];
}

function mcpStatus(): IntegrationStatus {
  const on = setting("TWINFORGE_MCP_ENABLED") !== "false";
  const token = !!setting("TWINFORGE_MCP_TOKEN");
  return {
    id: "mcp",
    name: "MCP server (agent tools)",
    service: "Model Context Protocol · /api/mcp",
    purpose: "Lets external agents (ADK, Gemini CLI, IDEs) use the twin's deterministic tools; plans they propose still need a person's approval.",
    state: on ? "active" : "not-configured",
    detail: on
      ? `Streamable HTTP endpoint at /api/mcp with ${token ? "a bearer token required" : "no token — anyone with the URL can read the twin and propose plans for approval"}.`
      : "Turned off. External agents get 503 from /api/mcp.",
    settings: settingsFor("mcp"),
    fallback: "The in-app copilot uses the same tools directly.",
    lastCheckedAt: null,
    testable: false,
  };
}

/** The shared Google Cloud project id, edited once for every Google Cloud integration. */
export const projectSetting = () => describeSettings(["GOOGLE_CLOUD_PROJECT"])[0];

/**
 * Apply settings changed in the UI: validate, save, forget connection checks that no longer
 * describe the current configuration, and write the change to the audit trail (never the values
 * of secrets).
 */
export async function applySettings(changes: Record<string, string | null>, actor: string) {
  const changed = await updateSettings(changes, actor);
  if (!changed.length) return changed;
  const affected = new Set<string>();
  for (const key of changed) {
    for (const [id, keys] of Object.entries(INTEGRATION_SETTINGS)) if (keys.includes(key)) affected.add(id);
    if (key === "GOOGLE_CLOUD_PROJECT") ["vertex-ai", "bigquery", "pubsub", "gcs"].forEach((id) => affected.add(id));
  }
  for (const id of affected) delete checks[id];
  if (affected.has("vertex-ai")) resetAiRuntime();
  const describe = (k: SettingKey) => {
    const def: { label: string; secret?: boolean } = SETTINGS[k];
    if (def.secret) return `${def.label} ${setting(k) ? "updated" : "cleared"}`;
    const v = setting(k);
    return `${def.label} = ${v ? v : "(off)"}`;
  };
  mutate((s) =>
    appendAudit(s, new Date().toISOString(), {
      category: "system",
      actor,
      title: `Integration settings changed: ${[...affected].join(", ") || "platform"}`,
      detail: changed.map(describe).join(" · ").slice(0, 600),
      severity: "info",
      refs: {},
    }),
  );
  return changed;
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
      case "vision-service":
        if (!visionService.configured()) return { ok: false, detail: "Not configured (VISION_SERVICE_URL)." };
        return testVisionService();
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
    id === "vertex-ai" ? aiConfig().provider !== "none" : id === "bigquery" ? bigQuery.configured() : id === "pubsub" ? pubSub.configured() : id === "gcs" ? cloudStorage.configured() : id === "mqtt" ? mqtt.configured() : id === "vision-service" ? visionService.configured() : false;
  if (configured) checks[id] = check;
  return check;
}

/** Record the outcome of a real call (not a test) so the status reflects actual use. */
export function recordCheck(id: string, ok: boolean, detail: string) {
  checks[id] = { ok, detail, at: new Date().toISOString() };
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
