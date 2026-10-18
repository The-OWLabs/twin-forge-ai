# Visual Quality Inspection: Google Cloud-First Architecture & Automated Optical Inspection (AOI)

An enterprise-grade, Google Cloud-native Automated Optical Inspection (AOI) platform built for electronics and precision manufacturing lines (IPC-A-610 Class 2 standards).

---

## 1. Google Cloud-First Architecture Overview

The platform uses **Google Cloud Platform (GCP)** managed services as the primary infrastructure. It eliminates dependencies on AWS, Azure, or third-party hosted SaaS AI services.

```
Industrial Cameras (AOI / GigE / Thermal / CCTV)
       │
       ▼
Google Cloud Storage (GCS)
  ├── gs://${PROJECT_ID}-visual-inspection/raw-frames/
  ├── gs://${PROJECT_ID}-visual-inspection/golden-templates/
  └── gs://${PROJECT_ID}-visual-inspection/overlays/
       │
       ▼ (Eventarc / Cloud Workflows Trigger)
Cloud Run Backend Service (Python 3.12+ / FastAPI)
  ├── 1. Google Cloud Vision API: Barcode & DataMatrix OCR Reading (ISO/IEC 15416)
  ├── 2. OpenCV Complementary Engine: Golden-Template Keypoint Homography & Pixel Difference
  ├── 3. Vertex AI Custom-Trained Model: Image Classification & Object Detection (IPC-A-610)
  ├── 4. Deterministic IPC-A-610 Class 2 Rule Engine: Decisive PASS / FAIL / REVIEW
  └── 5. Gemini 3.5 Flash on Vertex AI: Advisory Visual Explanations & Root Cause Hypotheses
       │
       ├──► Google Cloud Pub/Sub
       │      ├── quality-inspection-events
       │      └── quality-defect-alerts (Immediate shop-floor line halt / routing)
       │
       ├──► Google Cloud BigQuery Lakehouse (`visual_quality_lakehouse`)
       │      ├── fact_inspection_events (Partitioned by DATE, Clustered by Line & Verdict)
       │      ├── fact_defect_detections (Partitioned by DATE, Clustered by Defect Class)
       │      ├── dim_golden_templates
       │      ├── fact_quality_kpis_hourly (Hourly FPY & DPMO rollups)
       │      └── fact_human_disposition_audit (Immutable compliance audit trail)
       │
       └──► Looker / Streamlit / TwinForge Digital Twin
              └── Real-time FPY, DPMO, defect Pareto, and camera live-view overlays
```

---

## 2. Technical Justification & Capability Gap Analysis

Before introducing any complementary library, each capability was evaluated against native Google Cloud managed services:

| Function | Selected Component | Why Native GCP is Used | Gap Justification (Why OpenCV is Complementary) |
|---|---|---|---|
| **Defect Detection & Classification** | **Vertex AI Custom Models** | Managed AutoML / Custom Container training, model registry, versioning, and auto-scaling endpoints. | N/A — Native GCP managed service satisfies requirement completely. |
| **Generative Visual Reasoning** | **Gemini on Vertex AI** | Multimodal reasoning, natural language engineering briefings, and root-cause hypotheses. | Strictly advisory; explicitly guarded so Gemini is never the sole pass/fail authority. |
| **Barcode & OCR Reading** | **Google Cloud Vision API** | Managed text/OCR (`TEXT_DETECTION`) and barcode recognition meeting ISO/IEC 15416. | N/A — Native GCP managed service satisfies requirement completely. |
| **Golden-Template Alignment & Difference Detection** | **OpenCV (in Cloud Run)** | N/A — **Documented GCP Gap**: Google Cloud Vision API does not provide reference-image homography keypoint alignment (ORB/RANSAC) or pixel-level differential subtraction ($|\text{live} - \text{golden}|$). | OpenCV is used **only** for this deterministic mathematical subtraction and keypoint homography step. |
| **Image Storage** | **Google Cloud Storage** | Managed object lifecycle, versioning, dual-region availability, and CMEK encryption. | N/A — Native GCP managed service satisfies requirement completely. |
| **Analytics & KPIs** | **Google Cloud BigQuery** | Partitioned & clustered lakehouse tables, sub-second analytical queries, and Looker integration. | N/A — Native GCP managed service satisfies requirement completely. |
| **Event Streaming** | **Google Cloud Pub/Sub** | High-throughput, at-least-once messaging with dead-letter topics. | N/A — Native GCP managed service satisfies requirement completely. |
| **Orchestration** | **Cloud Workflows & Scheduler** | Serverless event-driven orchestration and cron jobs. | N/A — Native GCP managed service satisfies requirement completely. |
| **Infrastructure as Code** | **Terraform** | Declarative GCP resource provisioning. | N/A — Native GCP managed service satisfies requirement completely. |

---

## 3. IPC-A-610 Class 2 Standards & Defect Taxonomy

The deterministic rule engine evaluates defects against IPC-A-610 Class 2 (Dedicated Service Electronic Products):

| Defect Class | IPC-A-610 Section | Class 2 Acceptability Threshold | Severity |
|---|---|---|---|
| `SOLDER_BRIDGE` | Section 7.3.5 | Zero bridge allowance between non-common conductors. | CRITICAL |
| `TOMBSTONING` | Section 8.3.2 | Component end-cap lift angle > 15° or termination separation. | HIGH |
| `COMPONENT_MISALIGNMENT` | Section 8.3.1 | Component overhang > 50% of component termination width. | MEDIUM |
| `MISSING_PART` | Section 8.3.12 | 100% presence required for all BOM components. | CRITICAL |
| `LIFTED_LEAD` | Section 8.3.5 | Coplanarity deviation > 0.05 mm above solder land. | HIGH |
| `SOLDER_BALLS` | Section 5.2.7 | Solder balls within 0.13 mm of traces or > 0.1 mm diameter. | MEDIUM |
| `POLARITY_ERROR` | Section 8.3.11 | Diodes, polarized capacitors, IC pin 1 oriented incorrectly. | CRITICAL |
| `INSUFFICIENT_SOLDER` | Section 7.3.3 | Fillet height < 50% of lead height or non-wetting. | HIGH |

---

## 4. Mathematical Quality Formulations

### A. First-Pass Yield (FPY)
The percentage of units that pass inspection on the first run without requiring manual rework or re-inspection:
$$\text{FPY} = \frac{\text{Total units passed on first run}}{\text{Total units inspected}} \times 100\%$$

### B. Defects Per Million Opportunities (DPMO)
Standard six-sigma defect metric accounting for complexity:
$$\text{DPMO} = \frac{\text{Total defects detected}}{\text{Total inspected units} \times \text{Defect opportunities per unit}} \times 10^6$$

### C. Rolled Throughput Yield (RTY)
Probability that a unit passes all $m$ sequential inspection stages without defects:
$$\text{RTY} = \prod_{k=1}^m \text{FPY}_k$$

---

## 5. Auditable Human Review Dispositions

To guarantee regulatory compliance, quality engineers review flagged units through an auditable disposition workflow:
1. **Automated Optical Assessment**: Vertex AI and OpenCV flag anomalies (`FAIL` or `REVIEW_REQUIRED`).
2. **Advisory Synthesis**: Gemini on Vertex AI proposes probable root causes and containment actions.
3. **Human Disposition**: Certified auditors confirm, dismiss, or reclassify the defect with mandatory compliance rationale:
   - `CONFIRM_DEFECT`: Upholds defect; triggers rework ticket in CMMS.
   - `DISMISS_DEFECT`: Overrides defect if within acceptable visual variance; logs auditor ID.
   - `OVERRIDE_PASS`: Releases unit with justification.
   - `RECLASSIFY`: Corrects defect class for continuous MLOps model retraining.
4. **Audit Trail**: Every disposition is written immutably to BigQuery `fact_human_disposition_audit`.

---

## 6. REST API Reference

The router is mounted at `/api/v1/quality` in [`backend/main.py`](file:///Volumes/DiskD/HACKATHONS/Twin/backend/main.py).

| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/quality/inspect` | Multipart image inspection with Vertex AI, Cloud Vision OCR, and OpenCV template alignment. |
| `GET` | `/quality/summary/{line_id}` | Real-time First-Pass Yield (FPY), DPMO, and defect distribution. |
| `GET` | `/quality/pareto` | Defect Pareto breakdown categorized by IPC-A-610 Class 2 clauses. |
| `POST` | `/quality/templates/register` | Registers verified golden template with keypoint homography in GCS. |
| `GET` | `/quality/templates/{part_number}` | Retrieves active golden template metadata. |
| `POST` | `/quality/disposition` | Records auditable human disposition (confirm/dismiss/override) with compliance rationale. |
| `GET` | `/quality/audit/dispositions` | Retrieves chronological human review audit log. |
| `POST` | `/quality/mlops/trigger-training` | Triggers Vertex AI AutoML / custom training pipeline. |
| `GET` | `/quality/config` | Retrieves active similarity and FPY thresholds. |
| `PUT` | `/quality/config` | Updates quality thresholds at runtime. |

---

## 7. Local Mode vs Google Cloud Platform Deployment

### Local Development Mode (Zero Cloud Credentials Required)
The platform runs locally using simulated Vertex AI inference, in-memory template matching, and deterministic defect evaluations:
```bash
export PYTHONPATH=.
uvicorn backend.main:app --host 0.0.0.0 --port 8000 --reload
```

### Google Cloud Platform Deployment
1. **Provision Infrastructure with Terraform**:
   ```bash
   cd infra/terraform
   terraform init
   terraform apply -target=google_bigquery_dataset.visual_quality
   ```
2. **Deploy Cloud Run Backend**:
   ```bash
   gcloud builds submit --tag gcr.io/$PROJECT_ID/visual-quality-backend:latest
   gcloud run deploy visual-quality-backend \
     --image gcr.io/$PROJECT_ID/visual-quality-backend:latest \
     --platform managed \
     --region us-central1
   ```
3. **Deploy Cloud Workflows**:
   ```bash
   gcloud workflows deploy quality-inspection-pipeline \
     --source=infra/workflows/quality_inspection_workflow.yaml \
     --location=us-central1
   ```
