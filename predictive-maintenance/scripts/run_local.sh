#!/usr/bin/env bash
set -e
echo "Starting GCP Predictive Maintenance Platform in Local Mode..."

# 1. Train model if artifact missing
if [ ! -f "ml/artifacts/model.joblib" ]; then
    echo "Training initial scikit-learn model..."
    python3 scripts/train_model.py
fi

# 2. Run test suite
echo "Running automated verification tests..."
python3 -m pytest tests/ -v

echo "Ready! Start FastAPI with: uvicorn backend.main:app --port 8000"
echo "Start Streamlit with: streamlit run dashboard/app.py --server.port 8501"
