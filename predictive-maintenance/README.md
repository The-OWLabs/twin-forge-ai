# GCP-Powered Predictive Maintenance Platform

An enterprise industrial predictive maintenance system demonstrating real-time sensor simulation, stream processing, BigQuery time-series analytics, scikit-learn failure forecasting, FastAPI endpoints, and an interactive Streamlit dashboard.

---

## 1. Architectural Blueprint

```
+------------------------------------+
|  Industrial Sensor Simulator       |
|  (20+ Assets, Physics & Wear)      |
+------------------------------------+
                  |
                  v
+------------------------------------+
|  Google Cloud Pub/Sub Ingestion    |
|  (Topic: machine-readings)         |
+------------------------------------+
                  |
                  v
+------------------------------------+
|  Apache Beam / Cloud Dataflow      |
|  (Windowing, Normalization, DLT)   |
+------------------------------------+
                  |
                  v
+------------------------------------+
|  Google BigQuery Storage           |
|  (Partitioned & Clustered Tables)  |
+------------------------------------+
                  |
                  v
+------------------------------------+
|  Machine Learning & Prediction     |
|  (Random Forest, Feature Pipeline) |
+------------------------------------+
                  |
                  v
+------------------------------------+
|  FastAPI Backend REST Service      |
|  (Port 8000)                       |
+------------------------------------+
                  |
                  v
+------------------------------------+
|  Streamlit Operations Dashboard    |
|  (Port 8501, Plotly Diagnostics)   |
+------------------------------------+
```

---

## 2. Quick Start (Local Offline Mode)

The entire application runs locally with zero cloud dependencies or costs required.

### Step 1: Install Dependencies
```bash
pip install -r requirements.txt
```

### Step 2: Train Model
```bash
python3 scripts/train_model.py
```

### Step 3: Run Automated Tests
```bash
python3 -m pytest tests/ -v
```

### Step 4: Launch FastAPI Backend
```bash
uvicorn backend.main:app --port 8000 --reload
# Interactive Swagger docs: http://localhost:8000/docs
```

### Step 5: Launch Streamlit Dashboard
```bash
streamlit run dashboard/app.py --server.port 8501
# Dashboard: http://localhost:8501
```

---

## 3. GCP Cloud Deployment

### 1. Enable Required GCP APIs
```bash
gcloud services enable \
    pubsub.googleapis.com \
    dataflow.googleapis.com \
    bigquery.googleapis.com \
    aiplatform.googleapis.com \
    storage.googleapis.com
```

### 2. Deploy Infrastructure via Terraform
```bash
cd terraform
cp terraform.tfvars.example terraform.tfvars
terraform init
terraform apply
```

### 3. Run Dataflow Ingestion Pipeline
```bash
python3 -m dataflow.pipeline \
    --project=$GCP_PROJECT_ID \
    --runner=DataflowRunner \
    --input_topic=projects/$GCP_PROJECT_ID/topics/machine-readings \
    --bq_dataset=predictive_maintenance \
    --region=asia-southeast1
```

### 4. Teardown / Cleanup
To avoid ongoing GCP cloud charges:
```bash
cd terraform && terraform destroy
```
