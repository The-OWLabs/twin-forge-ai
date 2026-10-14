# TwinForge AI — Agentic Industrial Digital Twin

> **Your factory. Reimagined before reality.**
> Create your factory's digital twin. Let AI understand its operations, predict what could go wrong, simulate better decisions, and help you act before losses happen.

TwinForge AI is a working MVP of an industrial digital-twin platform. It digitizes a factory as a live topology, ingests (simulated) telemetry, watches the line through inspection, thermal and CCTV cameras placed in the twin, runs six specialized AI agents that investigate incidents, compares alternative operating plans on a deterministic plant model, and applies the chosen plan to the twin only after human approval, with a full audit trail.

Operators can ask the **TwinForge Copilot**, a multi-agent system built on Google's Agent Development Kit (ADK). Its specialist agents answer with figures from deterministic tools, and it can propose plans, but only for human approval. External agents can use the same tools through the built-in **MCP server**.

New users build their own twin with the **Twin Builder**: they give an agent their factory's drawing and requirements, and it reads the layout, researches standard setups with cited sources, and drafts a twin. The user reviews every element, with where each one came from, before a deterministic build ([design](docs/twin-builder.md)).

It ships with one complete scenario: an electronics plant with three lines where an assembly robot develops bearing damage just as a critical customer order is due and a key component is in short supply.

---

## Contents

1. [Quick start](#quick-start)
2. [Judge walkthrough (5 minutes)](#judge-walkthrough-5-minutes)
3. [What is implemented](#what-is-implemented)
4. [Architecture](#architecture)
5. [How the numbers are produced](#how-the-numbers-are-produced)
6. [AI agents](#ai-agents)
7. [Visual quality and cameras](#visual-quality-and-cameras)
8. [Twin Builder](#twin-builder)
9. [Copilot (ADK) and MCP](#copilot-adk-and-mcp)
10. [API reference](#api-reference)
11. [Google Cloud integrations](#google-cloud-integrations)
12. [Deploy (Firebase App Hosting or Cloud Run)](#deploy-to-firebase-app-hosting)
13. [Testing](#testing)
14. [Project structure](#project-structure)
15. [Known limitations](#known-limitations)

The full architecture and design document is [docs/architecture.md](docs/architecture.md).

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
2. **AI Operations**: six agents run a real workflow: OBSERVE → INVESTIGATE → PREDICT → SIMULATE → RECOMMEND → HUMAN APPROVAL. Each stage streams its actual results: anomalies found, per-agent findings with an evidence table, the method, inputs and confidence, the no-intervention forecast (trip at ≈h+16), and the ranked plans.
3. **What-If Simulator**: compares the reference plan with *Continue*, *Stop for preventive maintenance*, and *Reroute to Line B + maintain*. Move any lever (maintenance start or duration, robot speed, Line B allocation, MCU-7 usable stock, expediting, order quantity or priority, repair duration, energy price, idle draw) and every scenario recalculates instantly. Try dropping **MCU-7 usable stock** to 85% to watch the reroute plan go late, then toggle **Expedite PO-7781**.
4. **Digital Twin Studio**: the selected plan's production path is highlighted. A3 shows a maintenance window, Line B is marked as rerouted, packaging is downstream, and the critical order is on the path. Switch between **Topology**, **Isometric** and **Floor plan** views. Click any machine, rack or truck for live telemetry, diagnostics, history, dependencies, documents and fault-injection controls.
5. **Cameras and Visual Quality**: in the Isometric view, click the thermal camera **THM-A1** above robot A3. A card shows what the camera sees (A-ROB-03 running hot); **Watch live stream** opens the live view, and the access is written to the audit trail. **Visual Quality** shows Line A's AOI reject rate rising from ≈1.7% to ≈3.3%, tracking A-ROB-03 vibration (r ≈ 0.89). **Review last 60 units** lists each reject with its IPC-A-610 criterion and waits for you to confirm or dismiss it.
6. **Approvals**: review actions, evidence, benefits, risks, the impact table and rollback information. Approve it, then **Fast-forward 8 h**: Line B changes over, A-ROB-03 goes into maintenance, returns healthy, and the incident resolves itself.
7. **Audit Trail**: every alert, agent finding, scenario run, decision, simulated action and resulting state change is listed with links.
8. **Ask Copilot** (top bar): ask "Why is Line A rejecting more boards?" The coordinator delegates to the maintenance, quality and planning agents, and every tool call is shown. The answer is checked figure by figure against the tool results. Then say "propose the reroute plan for approval": the copilot pauses for your confirmation and creates a pending recommendation in Approvals.
9. **CCTV Control Room** (Admin): unlock admin, press **All to reference footage** to put real factory video on every camera (each clip credited and labelled *not this plant*), then run **Gemini review** or the **OpenCV motion check** on a feed. The findings land in Visual Quality for a person to confirm.
10. **Twin Builder** (sidebar): describe another plant, for example "two PET bottling lines, case packer and palletizer, OPC UA on the fillers", or upload its drawing. Review the draft with provenance badges on every element, plan a data connection, and build. The new twin runs with the same agents, simulator and cameras. **Reset Demo** brings back the crisis factory.

**Reset Demo** (Demo controls) restores the exact initial state at any time.

---

## What is implemented

| Area | Status |
|---|---|
| Landing page: Apple-style scroll story — the isometric twin stays pinned while the scripted crisis unfolds (build → detect → investigate → simulate → approve → audit); every figure is computed by running the engine on that scenario | ✅ |
| Light / dark theme toggle (persisted, no flash on load) across the app and landing page | ✅ |
| **Twin Builder**: the agent reads a blueprint (Gemini, multimodal), researches standard layouts (Google Search grounding, cited) and drafts a twin spec. The user reviews it with provenance on every element, edits directly or by chat, plans data connections and builds. Deterministic validation and compile; template mode without AI | ✅ live on Vertex AI |
| **TwinForge Copilot on Google ADK (TypeScript)**: coordinator + maintenance, quality and planning specialists (ADK `AgentTool`s) over 12 deterministic tools; a live tool trace; every figure checked against tool results; `propose_plan` behind ADK's human confirmation gate (creates a pending recommendation only); conversation memory | ✅ live on Vertex AI |
| **MCP server** (`/api/mcp`, Streamable HTTP): the same 12 tools with read-only hints for any agent; a **Python ADK agent** (`services/agents`) that operates the twin over MCP | ✅ |
| 16 machine archetypes across industries (CNC, mixer, oven, filler, molding, welding, palletizer, pump, manual station, extruder + the original 6), each with physics, sensors, failure mode, defect classes and a 3D shape; 7 industry templates | ✅ |
| Factory Command Center: OEE, target vs. actual, health distribution, energy, scrap, incidents, shortages, delivery risk, line status, events | ✅ |
| Digital Twin Studio: React Flow topology (lines, machines, sensors, inventory and order nodes; add, edit and connect assets; drag; zoom, pan and fit), an **isometric view** (extruded machines with status stack-lights, animated belts, warehouse racks and order trucks; rotate, zoom, pan, select), and a 2D floor plan, all with scenario highlighting | ✅ |
| Asset management: search, filters, sort, detail sheet linked to the twin | ✅ |
| Live simulated telemetry (deterministic noise) with pause/resume and fast-forward | ✅ |
| Anomaly detection: OLS trend, change-point test, z-score, threshold proximity, excess-power check | ✅ |
| Six agents (including Quality Inspection) and a streamed orchestration workflow | ✅ |
| Cameras in the twin: area CCTV, AOI / final-inspection, radiometric thermal, dock and stores cameras in all three views (iso cameras show their field of view). Click one for a card with its current view and analytics, then open the live view (every opening is audited) | ✅ simulated feeds |
| Live view plays a real HLS / MP4 / MJPEG stream when a camera is pointed at a gateway URL (https only) | ✅ implemented; needs a gateway |
| Visual Quality: FPY, DPMO, rolled throughput yield, defect Pareto, hourly reject trend, vibration ↔ reject correlation, camera wall, standards and privacy panel | ✅ |
| Visual reviews: deterministic station-log review, Gemini review of uploaded clips or photos, human confirm / dismiss | ✅ Gemini part needs credentials |
| Python vision service (FastAPI + OpenCV): golden-board comparison with alignment, barcode/QR reading with an indicative grade, image quality, video stoppage detection; results drawn over the upload and stored as reviews | ✅ runs locally / in Docker; Cloud Run deploy is Phase 2 of [the plan](docs/python-services-plan.md) |
| What-if engine: baseline plus three alternatives plus a custom plan, 10+ adjustable parameters, comparison table, charts, timeline, assumptions | ✅ |
| Human approval: approve, reject, rollback, execution status, directive tracking | ✅ |
| Sustainability: energy per unit, by-line energy, idle waste, scrap, avoidable-waste estimates, scenario energy and waste | ✅ |
| Audit trail: category filters, search, cross-links, JSON export | ✅ |
| Gemini on Vertex AI (or Gemini API key) for narratives, with schema validation, timeout, numeric grounding check and deterministic fallback | ✅ implemented; needs credentials |
| BigQuery, Pub/Sub, Cloud Storage and MQTT adapters with real connectivity tests | ✅ implemented; need configuration |
| Dockerfile and Cloud Run deploy script | ✅ |

---

## Architecture

**Next.js 15 (App Router, TypeScript)** serves the UI and the JSON API, owns all state and runs the deterministic engine. An optional **Python vision service** (FastAPI + OpenCV, `services/vision`) handles machine-vision checks; it is stateless, and Next.js calls it server-to-server. The plan for Python services is in [docs/python-services-plan.md](docs/python-services-plan.md).

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
 │     integrations/*  BigQuery · Pub/Sub · Cloud Storage · MQTT · vision service · honest status
 │
 ├── content/docs  local maintenance manuals (Cloud Storage fallback)
 │
 └──► services/vision (Python, optional)   FastAPI + OpenCV on Cloud Run, called with a Google ID token
       golden-board comparison · barcode/QR reading · image quality · video stoppages
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
| Quality Inspection | AOI and pack-out results (24 h), defect classes, hourly vibration | FPY, DPMO and Pareto per station; recent vs. earlier reject rate; OLS trend; Pearson correlation of each machine's vibration with its line's reject rate | Containment proposal (hold and re-inspect), root-cause corroboration, MSA validation before any threshold change |
| Operations Orchestrator | All reports plus simulated scenarios | Scenario generation, scoring, policy, explicit conflict resolution | Ranked plans, one recommendation for approval, narrative |

The workflow (`src/domain/agents/pipeline.ts`) runs on a frozen snapshot, so live telemetry can't change results mid-run. It streams each stage's real output to the UI as NDJSON. Small pauses between stages exist only so people can follow along; the computations themselves are real.

**Gemini's role.** When configured, Gemini writes the orchestrator briefing from structured facts. Its output must pass a JSON schema (zod) and a **numeric grounding check**: any figure of 10 or more that does not appear in the simulation outputs causes the narrative to be rejected and replaced by the deterministic version, with the reason shown.

---

## Visual quality and cameras

**Where the cameras are.** Every generated factory gets an area CCTV per line, an inspection camera on each AOI / final-inspection station, a radiometric thermal camera on the first robot cell, and cameras on the shipping dock and component stores (9 in the demo). They appear in the Topology (camera chips), Isometric (pole-mounted cameras with field-of-view wedges) and Floor plan views, and in the asset panel of every machine they cover.

**Card first, then live.** Clicking a camera opens a card with its current view and what its analytics report: units counted, lock-out zones, reject rate, hottest target, trailer loading or rack fill. **Watch live stream** opens the full view and logs who opened it. With no real camera connected, the feed is rendered from the live twin state and labelled *Simulated feed*.

**CCTV control room (admin).** **Admin → CCTV Control Room** shows every camera on one wall and switches each one between three sources:
- **Twin feed**: rendered from the twin (the default).
- **Reference footage**: a looped, openly licensed clip of a comparable real factory. It is badged *Reference footage*, credited with its author and license, and always described as *not this plant*, in the UI, the audit trail and the copilot's camera tool. Run **Gemini review** or the **OpenCV motion check** on it to demonstrate visual QA on real video; results wait for a person in Visual Quality.
- **Plant gateway**: an HLS, MP4 or MJPEG URL over HTTPS. Browsers can't play RTSP, so run a gateway on the plant network (for example MediaMTX) that pulls the camera's ONVIF / RTSP stream and republishes it as HLS.

Switching needs the admin passcode (see [Admin access](#admin-access)); every switch is audited.

**How inspection results are produced.** The plant model attributes every scrapped unit to a cause: the baseline process or a specific degraded machine. Each cause maps to the defect classes an inspection station would report, for example a worn placement robot produces misalignment, missing parts and tombstoning. Station metrics (FPY, DPMO, RTY, Pareto) and the per-unit pass/fail frames come from that attribution, so camera evidence always agrees with the twin. They are demo values, not a trained vision model.

**Standards used**

| Standard | Used for |
|---|---|
| IPC-A-610J, Class 2 (with IPC J-STD-001) | Acceptance criteria behind the assembly AOI defect classes |
| ISO/IEC 15416 / 15415 | Barcode print-quality grade at pack-out (below C fails) |
| ISO 18434-1 | Condition-monitoring thermography (THM-A1) |
| ONVIF Profile S / T | Camera streaming and metadata interoperability |
| AIAG MSA (attribute agreement) | Validate the inspection system before trusting or tuning reject limits |

**Gemini video review.** Upload a clip or photo (MP4, WebM, MOV, JPEG, PNG or WebP, up to 15 MB). Gemini returns findings restricted to a fixed category list, with a JSON schema, temperature 0 and zod validation. Results are advisory: every review lands as *awaiting human review*, and nothing is accepted or rejected automatically. Without credentials the upload is disabled and the API returns 503; the deterministic station-log review still works.

**Machine-vision check (Python service).** With the vision service running, **Visual Quality → Machine-vision check** takes a part photo and, optionally, a photo of a known-good part (the *golden reference*). The service aligns the two, normalises lighting and boxes every region that differs. It also reads barcodes and QR codes, rates whether the photo is sharp and lit well enough to judge, and finds still periods in a clip. These are deterministic OpenCV measurements, not a trained model. See [services/vision](services/vision/README.md).

**Safety and privacy.** Video analytics are not safety functions (IEC 61496 / ISO 13849) and never replace guarding or interlocks. Area cameras blur faces, footage has a fixed retention period, analytics are limited to stated purposes, and every live view is audited. This reflects how India's DPDP Act, 2023 treats workplace video as personal data.

---

## Twin Builder

Open **Twin Builder** (sidebar, or **Create your twin** on the landing page). Give it any of:
- a drawing (floor plan, process-flow diagram, P&ID, layout sketch or photo; PNG, JPEG, WebP or PDF)
- requirements in plain language
- a standard layout to start from

The agent then works in four stages, each streamed live:
1. **Read** recognises machines, lines and flow on the drawing.
2. **Research** finds how plants like yours are set up, with citations.
3. **Draft** proposes lines, machines, products, materials and data connections.
4. **Validate** runs deterministic checks.

**Review before build.** Every element shows where it came from: *blueprint*, *your requirement*, *cited source*, *template*, *assumption* or *your edit*. The model can only use the 16 known machine archetypes and may only state numbers that you, the drawing or a cited source provide. A claim it can't back is downgraded to *assumption*.

You can edit lines, machines, rates, products and connections directly, or ask the agent ("add a second filler at 6,000 bottles/h"). Its changes are applied as validated operations. **Build my digital twin** compiles the reviewed spec deterministically, with the same engine as the demo. The defaults it applies are recorded in the audit trail.

**Without AI** (no Gemini configured) the builder says so, matches your description to one of 7 industry templates by keywords, and the review and build work the same way.

**Connections.** Plan data connections per line or machine: Pub/Sub and camera streams work today; OPC UA, Modbus and MQTT are planned through an edge gateway. The Integrations page lists them as planned until they are verified.

Design, guarantees and limits: [docs/twin-builder.md](docs/twin-builder.md).

## Copilot (ADK) and MCP

**Copilot.** Click **Ask Copilot** in the top bar. It's built with Google's Agent Development Kit for TypeScript, running inside the app:
- **Agents.** A coordinator delegates to three specialist agents: maintenance, quality and planning.
- **Tools.** 12 deterministic TwinForge tools: plant overview, assets, diagnosis, incidents, orders, inventory, what-if simulation, quality, camera views, audit search, the latest analysis, and plan proposals.
- **Transparency.** Every tool call is shown above the answer.
- **Grounding.** Every figure in the answer is checked against the tool results, and figures that can't be traced are flagged.
- **Proposals.** The copilot can't approve or run anything. **propose_plan** pauses for your confirmation (ADK `requireConfirmation`) and then creates a *pending* recommendation that a person approves in Approvals.

**MCP.** `POST /api/mcp` serves the same tools over the Model Context Protocol (Streamable HTTP), so any agent can operate the twin: an ADK agent, Gemini CLI, Claude or an IDE. Read tools carry `readOnlyHint`. Set `TWINFORGE_MCP_TOKEN` to require a bearer token. For example, with Gemini CLI or Claude Code, add an HTTP MCP server pointing to `https://<your-host>/api/mcp`.

**Python ADK agent.** `services/agents` is a separate Python agent that reaches TwinForge only through MCP:

```bash
cd services/agents
cp twinforge_mcp_agent/.env.example twinforge_mcp_agent/.env   # Vertex project, region, MCP URL
uv sync && uv run python ask.py "Which machine is most at risk right now?"
uv run adk web     # ADK's dev UI with the same agent
```

Design details: [docs/architecture.md § 7](docs/architecture.md#7-agentic-layers).

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
| `GET /api/audit` · `GET /api/kpis` · `GET /api/integrations` · `POST /api/integrations/test` | Audit, KPIs, integration status (with each setting's source) and tests |
| `PUT /api/integrations/settings` | Change integration settings (admin): `{values: {KEY: "value" \| "" \| null}}`; `""` turns a setting off, `null` returns it to the deployment value |
| `GET/POST/DELETE /api/admin/session` | Admin status · unlock with `{passcode}` (sets an httpOnly cookie) · lock |
| `GET /api/documents?assetId=` · `GET /api/documents/:id` | Asset documents |
| `GET /api/cameras` · `PATCH /api/cameras/:id` · `POST /api/cameras/streams` · `POST /api/cameras/:id/view` | Cameras with their current views · set a camera's source (admin): `simulated`, `footage` + `clipId`, or an https gateway URL · switch several at once (admin) · log a live view |
| `POST /api/cameras/:id/analyze` | Visual QA on the camera's reference footage: `{engine: "gemini" \| "opencv"}` |
| `GET /api/quality` | FPY, DPMO, RTY, Pareto and correlations (24 h) |
| `POST /api/vision/review-log` · `POST /api/vision/analyze` · `PATCH /api/vision/reviews/:id` | Station-log review · Gemini review of an uploaded file (multipart `file`, optional `cameraId`) · confirm or dismiss |
| `GET /api/copilot` · `POST /api/copilot` | Copilot info · one ADK multi-agent turn (`{sessionId, message}` or `{sessionId, confirm}`), streamed as NDJSON |
| `POST /api/mcp` | MCP server (Streamable HTTP, stateless): `initialize`, `tools/list`, `tools/call` for the 12 TwinForge tools |
| `GET /api/builder` · `POST /api/builder/draft` · `POST /api/builder/refine` · `POST /api/builder/validate` · `POST /api/builder/build` | Twin Builder: capabilities and templates · agent draft (multipart, NDJSON stream) · chat edits · deterministic validation · build from a reviewed spec |
| `POST /api/vision/inspect` | Machine-vision check on the Python service (multipart `file` image or video, optional `reference` golden image and `cameraId`) |

Inputs are validated with zod. Errors return `{ error, issues? }` with 400, 401 (admin required), 404 or 409 status codes.

```bash
curl -s -X POST localhost:3000/api/demo/crisis >/dev/null
curl -s -X POST "localhost:3000/api/agents/analyze?fast=1" | tail -n 2
curl -s localhost:3000/api/kpis | jq .kpis.oee
```

---

## Google Cloud integrations

Everything works **without credentials**. Turn integrations on from **Admin → Integrations → Configure** (admin): enter the service's URL, dataset, bucket or token and press **Test connection**, no redeploy needed. A value saved there overrides the environment variable of the same name (`.env.example`, `apphosting.yaml`), which remains the deployment default; secrets (Gemini API key, MCP token) are write-only. Saved settings live in a private Cloud Storage bucket (`TWINFORGE_CONFIG_BUCKET`), or in `.data/settings.json` locally. The **Integrations** page reports status honestly:

- **Active · simulated/local**: a local implementation is in use.
- **Not configured**: required environment variables are missing.
- **Configured · not yet verified**: variables are set but no call has succeeded yet.
- **Connected (verified)**: shown only after a real API call succeeded.
- **Connection failed**: the error is shown.

| Service | What it does here | Required configuration |
|---|---|---|
| **Gemini on Vertex AI** | Twin Builder (reading drawings, Google Search-grounded research, drafting, chat edits); orchestrator narratives (never metrics); advisory review of uploaded inspection footage | `GOOGLE_CLOUD_PROJECT`, ADC (`gcloud auth application-default login`), `GOOGLE_CLOUD_LOCATION` (default `global`; this project uses `asia-southeast1`), `GEMINI_MODEL` (default `gemini-3.5-flash`). Alternatively `GOOGLE_GENAI_USE_VERTEXAI=false` with `GEMINI_API_KEY`. |
| **BigQuery** | Mirrors scenario outcomes and decisions; schema for telemetry, production and health history | `BIGQUERY_DATASET`, then create tables with `infra/bigquery/schema.sql` |
| **Pub/Sub** | Telemetry ingestion: `{assetId, vibration, temperature, powerKw}` messages override simulated measurements | `PUBSUB_TELEMETRY_SUBSCRIPTION`, `TELEMETRY_SOURCE=pubsub` |
| **Cloud Storage** | Per-asset documents under `assets/<assetId>/` | `GCS_BUCKET` |
| **Cloud Run** | Hosting (detected via `K_SERVICE`) | See below |
| **Vision service** (Cloud Run, Python) | OpenCV checks behind `POST /api/vision/inspect` and the control room's motion check | Service URL (deployed privately as `twinforge-vision`); the web app's service account has `roles/run.invoker` ([plan, Phase 2](docs/python-services-plan.md#phase-2-deploy-to-cloud-run--done)) |
| **MCP server** | External agents use the twin's tools at `/api/mcp` | Optional access token, or turn the endpoint off |
| MQTT | TCP reachability probe only | Broker URL |

### Admin access

Camera sources and integration settings need an admin session. On App Hosting the passcode is the Secret Manager secret `twinforge-admin-key` (mapped to `TWINFORGE_ADMIN_KEY`):

```bash
gcloud secrets versions access latest --secret twinforge-admin-key --project twin-forge   # read it
firebase apphosting:secrets:set twinforge-admin-key --project twin-forge                    # rotate it, then roll out
```

Unlock with **Unlock admin** on the control room or Integrations page; the session lasts 8 hours. Without a passcode, admin is open in local development and disabled on Cloud Run.

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
npm test               # 91 Vitest tests
npm run build && npm run test:e2e   # 13 Playwright tests against the production server
cd services/vision && uv run pytest # 16 pytest tests for the Python vision service
```

- **Unit and integration tests** (`tests/`, 91 tests), including a check that the landing story's figures are engine-derived:
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
  - visual quality: scrap fully attributed to causes, FPY / Pareto consistency, the robot ↔ AOI correlation in the crisis, deterministic inspection frames, thermal readings matching the twin
  - cameras: https-only stream URLs, audited live views, station-log reviews and the human disposition guard
  - mapping of vision-service results to review findings
  - Twin Builder: every template validates cleanly, builds, simulates and runs the six-agent analysis; deterministic builds; industry-appropriate defect classes; validation repairs and errors; and the agent workflow with recorded model responses (blueprint links, citation filtering, unsupported machine types, fallbacks, and chat edits as validated operations). The demo factory is checked byte-identical after the generator refactor.
- **Admin and settings** (`tests/admin.test.ts`): signed admin cookies (expiry, tampering, passcode rotation, rate limit); settings overriding the environment, turning off and returning to the deployment value; never overwriting saved settings that could not be read from Cloud Storage; validation (https only, no metadata host); secrets never returned; settings driving the AI and vision adapters; camera source switching with audit; every footage clip shipped with its file, poster and license; stock-outs reported once.
- **Agent tools** (`tests/tools.test.ts`): every read tool leaves the twin unchanged; what-if matches the engine; the proposal only creates a pending recommendation; invalid arguments are rejected; no tool can approve, execute or command equipment; numeric grounding of answers.
- **Python vision service** (`services/vision/tests`, 16 tests, synthetic media): a missing IC found where it should be, a rotated and shifted part aligned, lighting changes ignored, QR and EAN-13 decoding with grades, deterministic output, a video stoppage found at the right time, and API limits.
- **End-to-end tests** (`e2e/demo.spec.ts`, 13 tests): the CCTV control room switching all cameras to reference footage and back (audited, served as video/mp4); integration settings saved from the UI and returned to the deployment value; MCP protocol (initialize, tools/list with read-only hints, tools/call, errors); the ADK copilot giving a grounded answer with a tool trace (when Gemini is configured); Twin Builder from description to built twin with a planned connection; camera card → audited live view → Visual Quality review confirmed by a person; camera API validation and honest Gemini status; isometric selection and rotation, theme persistence, every landing-story chapter appearing on scroll; every page renders with no console errors; the full guided crisis demo (incident → agents → scenario sensitivity → twin highlight → approval → fast-forward → audit); reset reproducibility; API validation.

---

## Project structure

```
src/
  app/                 routes: landing, onboarding, (platform)/{dashboard,twin,assets,quality,agents,simulator,approvals,sustainability,audit,integrations}, api/*
  components/          ui primitives, shell, theme toggle, dashboard, twin (graph, nodes, canvas, floor view), iso (isometric renderer),
                       assets, agents, simulator, vision (camera feeds, camera card, live view, reviews), landing (scroll story)
  client/              API client, Zustand stores (factory, UI prefs, simulator workbench), hooks
  domain/              plant model, telemetry, simulation, agents, quality, vision, archetypes, builder/ (spec, validation,
                       compile, templates, edit operations, agent workflow), tools/ (agent tool layer, grounding),
                       recommendations, actions, KPIs, seed
  server/              persistence, AI provider, integrations, documents, request schemas
services/vision/       Python vision service (FastAPI + OpenCV), tests, Dockerfile
services/agents/       Python ADK agent that operates the twin over MCP
docs/                  architecture.md, twin-builder.md, python-services-plan.md
content/docs/          demo maintenance manuals and procedures (fictional)
infra/                 BigQuery schema, Cloud Run deploy script
tests/ e2e/            Vitest and Playwright suites
```

---

## Known limitations

- **Simulated plant.** All telemetry, production and costs come from a deterministic model with fictional demo data. Results are estimates, not validated forecasts.
- **No real cameras in the demo.** Camera feeds are rendered from the twin, or play reference footage of other factories, which is labelled as such. Inspection results come from the plant model's scrap attribution, not a trained vision model, and are not derived from the footage. Real streams need a plant-side gateway (HLS / MP4 / MJPEG over HTTPS). Gemini footage review is advisory and unvalidated; run an attribute-agreement study before relying on it.
- **No real equipment control.** Approval changes only the digital twin. The platform never writes to PLCs or commands machines; that would need a separately authenticated, authorized and safety-validated integration.
- **Single tenant, per-instance state.** One factory per server, stored in a local JSON file. Cloud Run instances do not share state (hence max-instances 1), and state resets when an instance is recycled. A production version would use Firestore, Cloud SQL or BigQuery.
- **No per-user login.** Configuration changes (camera sources, integration settings) need the admin passcode; everything else is open to anyone with the URL.
- **No automatic re-ordering.** Parts without an open purchase order run out after about 55–61 hours of plant time (about 2 hours of an open tab after a reset), and the lines starve. Use **Reset Demo**.
- **Cloud adapters are not verified against live services in this build.** BigQuery, Pub/Sub, Cloud Storage and Vertex AI calls are implemented and are exercised only when configured. MQTT is a reachability probe; subscription is not implemented.
- **Twin Builder limits.** Machines on a line run in series, with up to 4 process lines plus one packing area and 8 machines per line. Parallel or batch steps are approximated. Default rates, prices, stock and the sample orders are typical values until real systems are connected. The AI steps use Gemini 3.5 Flash on Vertex AI (asia-southeast1); without it, template mode is used.
- **Time model.** Live telemetry advances 2 minutes of plant time every 4 seconds while the app is open in a visible tab. Fast-forward runs the same model in larger jumps.
- **Desktop-first.** Pages work on phones (no horizontal page scrolling), but the twin canvas and wide tables are best on a laptop or larger screen.
