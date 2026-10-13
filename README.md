# TwinForge AI — Agentic Industrial Digital Twin

> **Your factory. Reimagined before reality.**
> Create your factory's digital twin. Let AI understand its operations, predict what could go wrong, simulate better decisions, and help you act before losses happen.

TwinForge AI is a working MVP of an industrial digital-twin platform. It digitizes a factory as a live topology, ingests (simulated) telemetry, runs five specialized AI agents that investigate incidents, compares alternative operating plans on a deterministic plant model, and applies the chosen plan to the twin only after human approval, with a full audit trail.

It ships with one complete scenario: an electronics plant with three lines where an assembly robot develops bearing damage just as a critical customer order is due and a key component is in short supply.

---

## Contents

1. [Quick start](#quick-start)
2. [Judge walkthrough (5 minutes)](#judge-walkthrough-5-minutes)
3. [What is implemented](#what-is-implemented)
4. [Architecture](#architecture)
5. [How the numbers are produced](#how-the-numbers-are-produced)
6. [AI agents](#ai-agents)
7. [API reference](#api-reference)
8. [Google Cloud integrations](#google-cloud-integrations)
9. [Deploy (Firebase App Hosting or Cloud Run)](#deploy-to-firebase-app-hosting)
10. [Testing](#testing)
11. [Project structure](#project-structure)
12. [Known limitations](#known-limitations)

---

## Quick start

Requirements: **Node.js ≥ 20.9** and npm. No API keys or cloud accounts are needed.

```bash
npm install
npm run dev            # http://localhost:3000
```

Production mode:

```bash
npm run build
npm start              # http://localhost:3000  (PORT=xxxx to change)
```

Open <http://localhost:3000> and click **Launch Factory Demo**.

| Command | Purpose |
|---|---|
| `npm run dev` | Development server |
| `npm run build && npm start` | Production build and server |
| `npm test` | Vitest unit/integration tests for the domain logic (40 tests) |
| `npm run test:e2e` | Playwright end-to-end tests (starts `npm start` if no server is running; run `npm run build` first) |
| `npm run typecheck` | TypeScript strict type check |
| `npm run reset-demo` | Delete persisted state (`.data/`); the demo factory is re-seeded on next request |

The first Playwright run needs a browser: `npx playwright install chromium`.

Tip — to run a dev server next to a running production build without them overwriting each other:
`NEXT_DIST_DIR=.next-dev TWINFORGE_DATA_DIR=.data-dev npx next dev -p 3001` (then `E2E_PORT=3001 npm run test:e2e`).

---

## Judge walkthrough (5 minutes)

The fastest path is **Demo controls → Run Factory Crisis Demo** (top-right). It resets the factory, injects joint-4 bearing damage on robot **A-ROB-03**, and opens a guided panel that walks through each step:

1. **Command Center**: a critical incident banner appears. OEE, output, health, energy, scrap, incidents, inventory shortages and delivery risk all come from the same state. Delivery risk shows **ORD-1042 ≈700 units short** if nothing is done (a model estimate).
2. **AI Operations**: five agents run a real workflow: OBSERVE → INVESTIGATE → PREDICT → SIMULATE → RECOMMEND → HUMAN APPROVAL. Each stage streams its actual results: anomalies found, per-agent findings with an evidence table, the method, inputs and confidence, the no-intervention forecast (trip at ≈h+16), and the ranked plans.
3. **What-If Simulator**: compares the reference plan with *Continue*, *Stop for preventive maintenance*, and *Reroute to Line B + maintain*. Move any lever (maintenance start or duration, robot speed, Line B allocation, MCU-7 usable stock, expediting, order quantity or priority, repair duration, energy price, idle draw) and every scenario recalculates instantly. Try dropping **MCU-7 usable stock** to 85% to watch the reroute plan go late, then toggle **Expedite PO-7781**.
4. **Digital Twin Studio**: the selected plan's production path is highlighted. A3 shows a maintenance window, Line B is marked as rerouted, packaging is downstream, and the critical order is on the path. Switch between **Topology**, **Isometric** and **Floor plan** views. Click any machine, rack or truck for live telemetry, diagnostics, history, dependencies, documents and fault-injection controls.
5. **Approvals**: review actions, evidence, benefits, risks, the impact table and rollback information. Approve it, then **Fast-forward 8 h**: Line B changes over, A-ROB-03 goes into maintenance, returns healthy, and the incident resolves itself.
6. **Audit Trail**: every alert, agent finding, scenario run, decision, simulated action and resulting state change is listed with links.

**Reset Demo** (Demo controls) restores the exact initial state at any time.

---

## What is implemented

| Area | Status |
|---|---|
| Landing page: Apple-style scroll story — the isometric twin stays pinned while the scripted crisis unfolds (build → detect → investigate → simulate → approve → audit); every figure is computed by running the engine on that scenario | ✅ |
| Light / dark theme toggle (persisted, no flash on load) across the app and landing page | ✅ |
| Onboarding wizard (factory, location, lines, assets, data source, review) and parametric twin generation | ✅ |
| Factory Command Center: OEE, target vs. actual, health distribution, energy, scrap, incidents, shortages, delivery risk, line status, events | ✅ |
| Digital Twin Studio: React Flow topology (lines, machines, sensors, inventory and order nodes; add, edit and connect assets; drag; zoom, pan and fit), an **isometric view** (extruded machines with status stack-lights, animated belts, warehouse racks and order trucks; rotate, zoom, pan, select), and a 2D floor plan, all with scenario highlighting | ✅ |
| Asset management: search, filters, sort, detail sheet linked to the twin | ✅ |
| Live simulated telemetry (deterministic noise) with pause/resume and fast-forward | ✅ |
| Anomaly detection: OLS trend, change-point test, z-score, threshold proximity, excess-power check | ✅ |
| Five agents and a streamed orchestration workflow | ✅ |
| What-if engine: baseline plus three alternatives plus a custom plan, 10+ adjustable parameters, comparison table, charts, timeline, assumptions | ✅ |
| Human approval: approve, reject, rollback, execution status, directive tracking | ✅ |
| Sustainability: energy per unit, by-line energy, idle waste, scrap, avoidable-waste estimates, scenario energy and waste | ✅ |
| Audit trail: category filters, search, cross-links, JSON export | ✅ |
| Gemini on Vertex AI (or Gemini API key) for narratives, with schema validation, timeout, numeric grounding check and deterministic fallback | ✅ implemented; needs credentials |
| BigQuery, Pub/Sub, Cloud Storage and MQTT adapters with real connectivity tests | ✅ implemented; need configuration |
| Dockerfile and Cloud Run deploy script | ✅ |

---

## Architecture

One deployable service: **Next.js 15 (App Router, TypeScript)** for the UI and the JSON API. There is no second backend to keep in sync.

```
Browser (React 19, Tailwind 4, React Flow, Recharts, Zustand)
 │  ▲  state mirror · live tick every 4 s · NDJSON agent stream
 ▼  │
Next.js Route Handlers (/api/*)            ← thin: validate (zod) → domain command → persist
 │
 ├── src/domain/   pure, isomorphic, unit-tested business logic
 │     world.ts        plant model (the physics) — shared by live twin AND simulator
 │     telemetry.ts    live advance, measured readings, trend estimation, incidents
 │     simulation.ts   scenario engine, calibration, metrics, scoring, ranking
 │     anomaly.ts      diagnostics & anomaly detection
 │     agents/*        maintenance · production · supply · energy · orchestrator · pipeline
 │     recommendations.ts, actions.ts (approve/reject/rollback), commands.ts, kpis.ts, seed.ts
 │
 ├── src/server/   server-only adapters
 │     store.ts        file-backed state (globalThis cache + atomic JSON write)
 │     ai/provider.ts  Gemini (Vertex AI / API key) + deterministic fallback
 │     integrations/*  BigQuery · Pub/Sub · Cloud Storage · MQTT · honest status
 │
 └── content/docs  local maintenance manuals (Cloud Storage fallback)
```

**Single source of truth.** The server owns one `FactoryState` (see `src/domain/types.ts`): lines, assets, telemetry, production history, inventory, orders, work orders, directives, incidents, analyses, scenario runs, recommendations and audit. Every page renders from it. The simulator and dashboard forecast run the *same* domain code client-side on a snapshot, so what-if sliders respond instantly, and the server recomputes whenever a run is recorded.

**Persistence.** State is written atomically to `.data/factory-state.json` (`TWINFORGE_DATA_DIR` to change), so it survives navigation, refresh and server restarts. UI preferences (layers, node positions, simulator levers) are kept in `localStorage`.

---

## How the numbers are produced

All metrics come from an explicit, deterministic **plant model** (`src/domain/world.ts`). Language models never produce numbers.

- **Machines in series**: a line runs at the minimum of its machines' capacity × commanded speed. Any machine that is down or in maintenance stops the line. Changeovers block the line for their duration.
- **Wear**: degradation grows at `slope × speed²` while producing. Temperature rises 2.4 °C per mm/s of excess vibration plus any thermal drift. Crossing the **trip** threshold causes an unplanned stop (default 16 h, $24k plus labor). Planned maintenance restores the baseline condition.
- **Quality**: scrap rises 1.2 points per mm/s of vibration above 60% of the alarm level.
- **Materials**: every started unit consumes its BOM. Production is capped by stock, and inbound POs arrive at their ETA.
- **Energy**: active power scales with speed, idle draw applies while waiting, lock-out draws 0 kW, and degraded machines draw extra power (friction).
- **Orders**: packaged units are allocated by priority, then due date. Late units are measured at the due time and charged the per-unit contract penalty.

**Scenario engine** (`src/domain/simulation.ts`):

1. Clone the live state into a simulation world.
2. **Calibrate each machine from telemetry**: OLS over 6 h of running readings with a change-point test. The engine never reads the hidden ground-truth degradation.
3. Turn plan levers into directives (maintenance window, line re-allocation, speed).
4. Run the plant model in 15-minute steps over the horizon.
5. Compute output, downtime, trip time, delivery, energy, scrap and a cost breakdown.
6. Score each plan against the healthy **reference plan**: delivery 40, cost 30, risk 20, sustainability 10. Plans that run the asset to a predicted trip are ranked last (asset-protection policy).

The same inputs always produce the same outputs, and tests verify this. Every scenario lists its assumptions, and the UI labels all results as estimates from demo data.

---

## AI agents

| Agent | Inputs | Method | Output |
|---|---|---|---|
| Predictive Maintenance | Telemetry history, thresholds, maintenance records, power | OLS trend, change-point test, z-score, extrapolated time-to-alarm and time-to-trip, trip probability from slope SE plus 25% model error | Findings with evidence tables, maintenance proposal, confidence from R², n and t |
| Production Optimization | Hourly production, capabilities, allocations, orders | OEE, bottleneck, schedule slack, alternate-line slack | Reroute feasibility and proposal |
| Supply Chain | Inventory, BOMs, inbound POs, scrap projection | BOM explosion, coverage hours, exhaustion vs. ETA, scrap sensitivity | Binding component, shortage risk, expedite options |
| Energy & Sustainability | Energy records, power signals | Intensity, idle share, excess draw, idle exposure of a trip | Standby and lock-out proposals (assumptions stated) |
| Operations Orchestrator | All reports plus simulated scenarios | Scenario generation, scoring, policy, explicit conflict resolution | Ranked plans, one recommendation for approval, narrative |

The workflow (`src/domain/agents/pipeline.ts`) runs on a frozen snapshot, so live telemetry can't change results mid-run. It streams each stage's real output to the UI as NDJSON. Small pauses between stages exist only so people can follow along; the computations themselves are real.

**Gemini's role.** When configured, Gemini writes the orchestrator briefing from structured facts. Its output must pass a JSON schema (zod) and a **numeric grounding check**: any figure of 10 or more that does not appear in the simulation outputs causes the narrative to be rejected and replaced by the deterministic version, with the reason shown.

---

## API reference

`GET /api` returns the endpoint list. The main operations:

| Method & path | Description |
|---|---|
| `GET /api/health` | Health and persistence info |
| `GET /api/factory` · `POST /api/factory` | Fetch state · create a twin from a blueprint |
| `POST /api/factory/reset` · `POST /api/demo/crisis` | Restore the demo · load the scripted crisis |
| `POST /api/telemetry/tick` · `POST /api/telemetry/live` · `POST /api/sim/advance` | Live tick (throttled) · start/stop · fast-forward `{hours}` |
| `GET/POST /api/assets` · `PATCH /api/assets/:id` · `GET /api/assets/:id/telemetry` | Assets · update · telemetry with diagnostics |
| `POST /api/connections` · `POST /api/faults` · `GET /api/anomalies` | Dependencies · fault injection · anomaly detection |
| `POST /api/agents/analyze` | Multi-agent investigation (NDJSON stream; `?fast=1` skips pacing) |
| `POST /api/scenarios` · `POST /api/scenarios/compare` | Run and record · stateless comparison |
| `GET/POST /api/recommendations` · `POST /api/recommendations/:id/{approve,reject,rollback}` | Recommendations and decisions |
| `GET /api/audit` · `GET /api/kpis` · `GET /api/integrations` · `POST /api/integrations/test` | Audit, KPIs, integration status and tests |
| `GET /api/documents?assetId=` · `GET /api/documents/:id` | Asset documents |

Inputs are validated with zod. Errors return `{ error, issues? }` with 400, 404 or 409 status codes.

```bash
curl -s -X POST localhost:3000/api/demo/crisis >/dev/null
curl -s -X POST "localhost:3000/api/agents/analyze?fast=1" | tail -n 2
curl -s localhost:3000/api/kpis | jq .kpis.oee
```

---

## Google Cloud integrations

Everything works **without credentials**. Each integration activates when its environment variables are set (see `.env.example`). The **Integrations** page reports status honestly:

- **Active · simulated/local**: a local implementation is in use.
- **Not configured**: required environment variables are missing.
- **Configured · not yet verified**: variables are set but no call has succeeded yet.
- **Connected (verified)**: shown only after a real API call succeeded.
- **Connection failed**: the error is shown.

| Service | What it does here | Required configuration |
|---|---|---|
| **Gemini on Vertex AI** | Orchestrator narratives (never metrics) | `GOOGLE_CLOUD_PROJECT`, ADC (`gcloud auth application-default login`), optional `GOOGLE_CLOUD_LOCATION` (default `global`), `GEMINI_MODEL` (default `gemini-3.5-flash`). Alternatively `GOOGLE_GENAI_USE_VERTEXAI=false` with `GEMINI_API_KEY`. |
| **BigQuery** | Mirrors scenario outcomes and decisions; schema for telemetry, production and health history | `BIGQUERY_DATASET`, then create tables with `infra/bigquery/schema.sql` |
| **Pub/Sub** | Telemetry ingestion: `{assetId, vibration, temperature, powerKw}` messages override simulated measurements | `PUBSUB_TELEMETRY_SUBSCRIPTION`, `TELEMETRY_SOURCE=pubsub` |
| **Cloud Storage** | Per-asset documents under `assets/<assetId>/` | `GCS_BUCKET` |
| **Cloud Run** | Hosting (detected via `K_SERVICE`) | See below |
| MQTT | TCP reachability probe only | `MQTT_BROKER_URL` |

> **Model note.** `gemini-2.5-flash` is scheduled for retirement in October 2026, so the default is `gemini-3.5-flash`. Confirm the model ID and region are enabled for your project in Vertex AI Model Garden, or set `GEMINI_MODEL`.

Use **Integrations → Test connection** to verify each configured service.

---

## Deploy to Firebase App Hosting

The repo is configured for [Firebase App Hosting](https://firebase.google.com/docs/app-hosting) (Next.js on Cloud Run, managed by Firebase). The project needs the **Blaze** plan.

- `apphosting.yaml`: runtime settings. **`maxInstances: 1`**, because demo state lives in the instance's `/tmp`.
- `.firebaserc` / `firebase.json`: default project `twin-forge`, backend `twinforge` (region `asia-southeast1`).

Deploy the current local source:

```bash
firebase deploy --only apphosting --project twin-forge
```

To deploy automatically on every push to `main`, connect the GitHub repository to the backend: Firebase console → **App Hosting** → `twinforge` → **Settings → Deployment** → connect `The-OWLabs/twin-forge-ai`, live branch `main`, root directory `/`.

**Cost.** App Hosting bills the underlying Cloud Build, Cloud Run, Artifact Registry and bandwidth usage. Light demo traffic stays inside Blaze's monthly no-cost allowances. Each open dashboard tab polls telemetry every 4 s, roughly 45 MB/hour of bandwidth against a 10 GiB free allowance. Set a budget alert in Cloud Billing.

## Deploy to Cloud Run

```bash
export GOOGLE_CLOUD_PROJECT=my-project
export REGION=us-central1                 # optional
# optional: BIGQUERY_DATASET, GCS_BUCKET, PUBSUB_TELEMETRY_SUBSCRIPTION, GEMINI_MODEL
./infra/cloudrun/deploy.sh
```

The script enables the required APIs and creates a least-privilege runtime service account with these roles: `aiplatform.user`, `bigquery.dataEditor`, `bigquery.jobUser`, `pubsub.subscriber` and `storage.objectViewer`. It then builds from the `Dockerfile` (multi-stage, Node 22, standalone output) and deploys with **`--max-instances 1`**, because demo state lives in each instance.

> **Security note.** The script deploys a **public, unauthenticated** service so judges can open it. The app has no user authentication. Anyone with the URL can reset the demo or approve plans (simulated only). Remove `--allow-unauthenticated` or put the service behind IAP for anything beyond a demo.

Local container:

```bash
docker build -t twinforge-ai .
docker run -p 8080:8080 twinforge-ai     # http://localhost:8080
```

---

## Testing

```bash
npm test               # 40 Vitest tests
npm run build && npm run test:e2e   # 6 Playwright tests against the production server
```

- **Unit and integration tests** (`tests/`, 40 tests), including a check that the landing story's figures are engine-derived:
  - seed reproducibility and entity counts
  - health and status rules, OLS and trend estimation, change-point detection
  - KPIs
  - scenario outcomes for all plans, ranking, determinism and calibration
  - **parameter sensitivity**: maintenance duration, derating, repair duration, reroute allocation, MCU-7 availability with and without expediting, order quantity, energy price, idle factor, horizon
  - infeasible reroute
  - the agent pipeline's stage order, evidence and recommendation
  - approval execution through to completion, rejection, double-approval guard and rollback
  - commands (add, edit and connect assets; forced trip)
  - the LLM grounding check and deterministic fallback
- **End-to-end tests** (`e2e/demo.spec.ts`, 6 tests): isometric selection and rotation, theme persistence, every landing-story chapter appearing on scroll; every page renders with no console errors; the full guided crisis demo (incident → agents → scenario sensitivity → twin highlight → approval → fast-forward → audit); reset reproducibility; API validation.

---

## Project structure

```
src/
  app/                 routes: landing, onboarding, (platform)/{dashboard,twin,assets,agents,simulator,approvals,sustainability,audit,integrations}, api/*
  components/          ui primitives, shell, theme toggle, dashboard, twin (graph, nodes, canvas, floor view), iso (isometric renderer),
                       assets, agents, simulator, landing (scroll story)
  client/              API client, Zustand stores (factory, UI prefs, simulator workbench), hooks
  domain/              plant model, telemetry, simulation, agents, recommendations, actions, KPIs, seed
  server/              persistence, AI provider, integrations, documents, request schemas
content/docs/          demo maintenance manuals and procedures (fictional)
infra/                 BigQuery schema, Cloud Run deploy script
tests/ e2e/            Vitest and Playwright suites
```

---

## Known limitations

- **Simulated plant.** All telemetry, production and costs come from a deterministic model with fictional demo data. Results are estimates, not validated forecasts.
- **No real equipment control.** Approval changes only the digital twin. The platform never writes to PLCs or commands machines; that would need a separately authenticated, authorized and safety-validated integration.
- **Single tenant, per-instance state.** One factory per server, stored in a local JSON file. Cloud Run instances do not share state (hence max-instances 1), and state resets when an instance is recycled. A production version would use Firestore, Cloud SQL or BigQuery.
- **No authentication or authorization.**
- **Cloud adapters are not verified against live services in this build.** BigQuery, Pub/Sub, Cloud Storage and Vertex AI calls are implemented and are exercised only when configured. MQTT is a reachability probe; subscription is not implemented.
- **Custom factories** created through onboarding use electronics-assembly templates (products, BOMs, orders) for any chosen industry.
- **Time model.** Live telemetry advances 2 minutes of plant time every 4 seconds while the app is open in a visible tab. Fast-forward runs the same model in larger jumps.
- **Desktop-first.** Pages work on phones (no horizontal page scrolling), but the twin canvas and wide tables are best on a laptop or larger screen.
