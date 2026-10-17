# Predictive Maintenance Domain (`backend/features/predictive_maintenance`)

## 1. Domain Overview & Purpose
The **Predictive Maintenance** module is an enterprise condition-monitoring and failure prediction system. It monitors asset health, detects early mechanical/electrical degradation, and estimates the **Remaining Useful Life (RUL)** of rotating machinery, robotics, pumps, compressors, and CNC mills across manufacturing plants.

It provides both:
1. **Domain & Physics Modeling**: High-frequency FFT vibration analysis, ISO 10816-3 severity classification, RUL hazard rate estimation, and dynamic runtime threshold configuration.
2. **GCP End-to-End Pipeline**: Industrial IoT simulator, Google Cloud Pub/Sub ingestion, Apache Beam / Cloud Dataflow streaming aggregations, BigQuery time-series analytics, scikit-learn & Vertex AI predictive ML models, and REST endpoints.

---

## 2. GCP End-to-End Architecture

```
Industrial Sensor Simulator (20+ Assets, Physics & Wear)
                  │
                  ▼
Google Cloud Pub/Sub (machine-readings topic)
                  │
                  ▼
Apache Beam / Cloud Dataflow (Windowing, Normalization, DLT)
                  │
                  ▼
Google BigQuery Storage (machine_readings & health_features)
                  │
                  ▼
Machine Learning & Failure Prediction (Random Forest / Vertex AI)
                  │
                  ▼
BigQuery Predictions Table (machine_predictions)
                  │
                  ▼
FastAPI Backend (REST API & Dynamic Configuration)
                  │
                  ▼
Streamlit Dashboard (Plotly Visualizations & Fleet Risk Alerts)
```

---

## 3. Subsystem Organization

- `simulator/`: Generates high-fidelity physics-based telemetry for 20+ machines across 5 archetypes and 3 plants, modeling bearing wear, thermal runaway, and cavitation.
- `schemas/`: Pydantic & BigQuery schemas with strict type validation for sensor readings, dead-letter events, and predictions.
- `ingestion/`: Pub/Sub telemetry publisher with exponential backoff retries and local in-memory fallback.
- `dataflow/`: Apache Beam streaming pipeline for schema validation, dead-letter routing, rolling window aggregations, and BigQuery writes.
- `feature_engineering/`: Rolling time-window aggregators computing RMS vibration, mean temperatures, stability index, and friction metrics.
- `ml/`: Model training (`training/train.py`), synthetic dataset generation (`training/dataset_generator.py`), real-time inference (`inference/predictor.py`), evaluation metrics (`evaluation/metrics.py`), and Vertex AI deployment workflows (`vertex_ai/deployment.py`).
- `repositories/`: Repository abstraction supporting both Google Cloud BigQuery (`bigquery_repo.py`) and zero-cloud in-memory development (`local_mock_repo.py`).
- `config/`: Dynamic runtime configuration store exposing ISO 10816 thresholds and model hyperparameters via `GET` and `PUT /api/v1/maintenance/config`.
- `api/`: FastAPI route handlers for `/machines`, `/readings`, `/predictions`, `/diagnostics`, `/rul`, `/analytics/summary`, and `/config`.
- `services/`: `MachineService` and `PredictiveMaintenanceService` separating business logic from persistence and transport.

---

## 4. Mathematical Foundations & Standards

### ISO 10816-3 Vibration Severity Zones
- **Zone A (Good)**: $V_{\text{RMS}} < 1.8 \text{ mm/s}$ (newly commissioned machinery)
- **Zone B (Acceptable)**: $1.8 \le V_{\text{RMS}} < 4.5 \text{ mm/s}$ (unrestricted long-term operation)
- **Zone C (Unsatisfactory)**: $4.5 \le V_{\text{RMS}} < 7.1 \text{ mm/s}$ (remedial action required)
- **Zone D (Unacceptable)**: $V_{\text{RMS}} \ge 7.1 \text{ mm/s}$ (trip / danger of catastrophic failure)

*All thresholds are dynamically configurable at runtime via API.*

### RUL Hazard Rate Formulation
$$RUL(t) = \frac{\text{Threshold}_{\text{trip}} - \text{Measured}(t)}{\alpha \cdot \text{Slope}_{\text{OLS}} + (1-\alpha) \cdot \text{Slope}_{\text{change\_point}}}$$

---

## 5. Quick Verification & Execution

```bash
# Run automated verification suite
python3 backend/scripts/run_tests.py

# Run prediction worker in background
python3 backend/scripts/run_prediction_worker.py

# Launch interactive Streamlit dashboard
cd dashboard && streamlit run app.py --server.port 8501
```
