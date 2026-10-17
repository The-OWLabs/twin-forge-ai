"""Local and production prediction service executing real-time failure inference."""
import json
from pathlib import Path
from typing import Any, Optional

try:
    import joblib
    HAS_JOBLIB = True
except ImportError:
    HAS_JOBLIB = False

try:
    import pandas as pd
    HAS_PANDAS = True
except ImportError:
    HAS_PANDAS = False

from backend.features.predictive_maintenance.schemas.sensor_reading import SensorReadingEvent
from backend.features.predictive_maintenance.feature_engineering.pipeline import FeatureEngineeringPipeline


class FailurePredictor:
    """Loads model artifacts and evaluates real-time probability of failure and risk categories."""

    def __init__(self, model_path: Optional[str] = None) -> None:
        if model_path is None:
            model_path = str(Path(__file__).resolve().parent.parent / "artifacts" / "model.joblib")
        
        self.model_path = Path(model_path)
        self.model = None
        self.metadata = {}
        self._load_model()

    def _load_model(self) -> None:
        if HAS_JOBLIB and self.model_path.exists():
            try:
                self.model = joblib.load(self.model_path)
                meta_path = self.model_path.parent / "metadata.json"
                if meta_path.exists():
                    with open(meta_path, "r") as f:
                        self.metadata = json.load(f)
            except Exception:
                self.model = None
        else:
            self.model = None

    def predict_machine_health(self, readings_history: list[SensorReadingEvent]) -> dict[str, Any]:
        """Calculates failure probability, risk tier, contributing features, and recommended action."""
        if not readings_history:
            return {
                "failure_probability": 0.05,
                "risk_category": "LOW",
                "contributing_features": {},
                "recommended_action": "NORMAL_MONITORING",
                "model_version": "v1.0-baseline",
            }

        # Handle features through pipeline
        records = [r.model_dump() for r in readings_history]
        features = FeatureEngineeringPipeline.extract_features(records, window_size=5)

        if not features or (HAS_PANDAS and isinstance(features, pd.DataFrame) and features.empty):
            return self._heuristic_fallback(readings_history[-1])

        # Get latest feature row
        if HAS_PANDAS and isinstance(features, pd.DataFrame):
            latest_row = features.iloc[-1].to_dict()
        elif isinstance(features, list):
            latest_row = features[-1]
        else:
            latest_row = {}

        roll_mean_vib = latest_row.get("roll_mean_vib", readings_history[-1].vibration_mm_s)
        roll_max_temp = latest_row.get("roll_max_temp", readings_history[-1].temperature_celsius)
        friction = latest_row.get("friction_indicator", (roll_mean_vib * roll_max_temp) / 100.0)
        stability = latest_row.get("stability_index", 1500.0 / (roll_mean_vib + 0.1))

        if self.model is not None and HAS_PANDAS:
            feature_cols = FeatureEngineeringPipeline.get_feature_columns()
            df_feat = pd.DataFrame([latest_row])[feature_cols].fillna(0.0)
            prob = float(self.model.predict_proba(df_feat)[0][1])
        else:
            # Deterministic empirical failure probability curve based on ISO 10816 vibration zones
            # Normal: < 1.8 mm/s -> prob ~ 0.03
            # Acceptable: 1.8 - 4.5 mm/s -> prob ~ 0.05 - 0.35
            # Unsatisfactory: 4.5 - 7.1 mm/s -> prob ~ 0.40 - 0.70
            # Unacceptable / Trip: > 7.1 mm/s -> prob ~ 0.75 - 0.99
            if roll_mean_vib > 7.1:
                prob = min(0.99, 0.75 + (roll_mean_vib - 7.1) * 0.1)
            elif roll_mean_vib > 4.5:
                prob = 0.35 + ((roll_mean_vib - 4.5) / 2.6) * 0.35
            elif roll_mean_vib > 2.0:
                prob = 0.10 + ((roll_mean_vib - 2.0) / 2.5) * 0.25
            else:
                prob = max(0.02, roll_mean_vib * 0.04)

            # Thermal boost if overheating (> 70°C)
            if roll_max_temp > 70.0:
                prob = min(0.99, prob + 0.20)

        prob = round(float(prob), 3)

        # Risk Classification
        if prob >= 0.70:
            category = "HIGH"
            action = "IMMEDIATE_SHUTDOWN: Bearing vibration exceeds ISO Zone D. Overhaul immediately."
        elif prob >= 0.35:
            category = "MEDIUM"
            action = "INSPECT_NEXT_SHIFT: Elevated thermal/vibration drift detected. Lubricate and re-align."
        else:
            category = "LOW"
            action = "NORMAL_OPERATION: Machine running within nominal operating envelope."

        contributions = {
            "roll_mean_vib": round(float(roll_mean_vib), 2),
            "roll_max_temp": round(float(roll_max_temp), 1),
            "friction_indicator": round(float(friction), 2),
            "stability_index": round(float(stability), 1),
        }

        return {
            "failure_probability": prob,
            "risk_category": category,
            "contributing_features": contributions,
            "recommended_action": action,
            "model_version": self.metadata.get("model_type", "RandomForest-v1 (Empirical Fallback)"),
        }

    def _heuristic_fallback(self, latest: SensorReadingEvent) -> dict[str, Any]:
        vib = latest.vibration_mm_s
        prob = 0.85 if vib > 6.0 else (0.45 if vib > 3.5 else 0.05)
        cat = "HIGH" if prob > 0.70 else ("MEDIUM" if prob > 0.30 else "LOW")
        return {
            "failure_probability": prob,
            "risk_category": cat,
            "contributing_features": {"vibration_mm_s": vib, "temperature_celsius": latest.temperature_celsius},
            "recommended_action": "INSPECT: Sensor values anomalous" if cat != "LOW" else "NORMAL_OPERATION",
            "model_version": "heuristic-fallback",
        }
