"""Local in-memory mock repository backed by the industrial simulator for zero-cloud development."""
from typing import Optional
from backend.repositories.base import IMachineRepository
from schemas.sensor_reading import SensorReadingEvent
from simulator.generator import IndustrialSensorSimulator
from ml.inference.predictor import FailurePredictor


class LocalMockMachineRepository(IMachineRepository):
    """High-fidelity in-memory machine repository seeded with 20 simulated industrial machines."""

    def __init__(self, num_machines: int = 20) -> None:
        self.simulator = IndustrialSensorSimulator(num_machines=num_machines, seed=42)
        self.history: dict[str, list[SensorReadingEvent]] = {}
        self.predictions: dict[str, dict] = {}
        self.predictor = FailurePredictor()
        self._seed_initial_history()

    def _seed_initial_history(self) -> None:
        """Seed each machine with 15 historical readings and generate initial predictions."""
        for _ in range(15):
            readings = self.simulator.generate_tick(elapsed_minutes=5.0)
            for r in readings:
                if r.machine_id not in self.history:
                    self.history[r.machine_id] = []
                self.history[r.machine_id].append(r)

        # Generate baseline predictions
        for m_id, hist in self.history.items():
            pred = self.predictor.predict_machine_health(hist)
            pred["machine_id"] = m_id
            pred["prediction_timestamp"] = hist[-1].timestamp.isoformat()
            pred["prediction_horizon_hours"] = 24
            self.predictions[m_id] = pred

    async def get_all_machines(self) -> list[dict]:
        machines = []
        for m in self.simulator.machines:
            latest = self.history.get(m.machine_id, [None])[-1]
            pred = self.predictions.get(m.machine_id, {})
            machines.append({
                "machine_id": m.machine_id,
                "machine_type": m.machine_type.value,
                "plant_id": m.plant_id.value,
                "operating_hours": round(m.operating_hours, 1),
                "current_health_state": m.health_state.value,
                "risk_category": pred.get("risk_category", "LOW"),
                "failure_probability": pred.get("failure_probability", 0.05),
                "latest_vibration": latest.vibration_mm_s if latest else 1.2,
                "latest_temperature": latest.temperature_celsius if latest else 42.0,
            })
        return machines

    async def get_machine_by_id(self, machine_id: str) -> Optional[dict]:
        all_m = await self.get_all_machines()
        for m in all_m:
            if m["machine_id"] == machine_id:
                return m
        return None

    async def get_recent_readings(self, machine_id: str, limit: int = 50) -> list[SensorReadingEvent]:
        return self.history.get(machine_id, [])[-limit:]

    async def get_latest_prediction(self, machine_id: str) -> Optional[dict]:
        return self.predictions.get(machine_id)

    async def save_prediction(self, prediction_record: dict) -> None:
        m_id = prediction_record["machine_id"]
        self.predictions[m_id] = prediction_record

    async def get_high_risk_machines(self) -> list[dict]:
        all_m = await self.get_all_machines()
        return [m for m in all_m if m["risk_category"] == "HIGH"]

    async def get_analytics_summary(self) -> dict:
        all_m = await self.get_all_machines()
        total = len(all_m)
        high = sum(1 for m in all_m if m["risk_category"] == "HIGH")
        med = sum(1 for m in all_m if m["risk_category"] == "MEDIUM")
        low = sum(1 for m in all_m if m["risk_category"] == "LOW")
        avg_prob = sum(m["failure_probability"] for m in all_m) / total if total > 0 else 0.0

        return {
            "total_machines_monitored": total,
            "high_risk_count": high,
            "medium_risk_count": med,
            "low_risk_count": low,
            "average_fleet_failure_probability": round(avg_prob, 3),
            "healthy_fleet_percentage": round((low / total) * 100.0, 1) if total > 0 else 100.0,
        }
