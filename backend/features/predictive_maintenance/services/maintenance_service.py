"""Predictive maintenance application service implementing deterministic physics & trend evaluation."""
from datetime import datetime, timedelta
from typing import Optional
from backend.features.predictive_maintenance.ports.contracts import (
    IPredictiveMaintenanceUseCase,
    ITelemetryReader,
)
from backend.features.predictive_maintenance.domain.models import (
    AssetDiagnosticReport,
    BearingHealth,
    RulEstimate,
    ISO10816Severity,
)


class PredictiveMaintenanceService(IPredictiveMaintenanceUseCase):
    """Application service calculating condition metrics, ISO 10816-3 zones, and RUL."""

    def __init__(self, telemetry_reader: ITelemetryReader, trip_threshold_rms: float = 8.5) -> None:
        self.telemetry = telemetry_reader
        self.trip_threshold_rms = trip_threshold_rms

    def _classify_iso_zone(self, vib_rms: float) -> ISO10816Severity:
        if vib_rms < 1.8:
            return ISO10816Severity.ZONE_A_GOOD
        elif vib_rms < 4.5:
            return ISO10816Severity.ZONE_B_ACCEPTABLE
        elif vib_rms < 7.1:
            return ISO10816Severity.ZONE_C_UNSATISFACTORY
        else:
            return ISO10816Severity.ZONE_D_UNACCEPTABLE

    def _calculate_health_score(self, vib_rms: float, temp_c: float) -> float:
        # Base penalty from vibration (normal is ~1.0 mm/s, trip is 8.5 mm/s)
        vib_penalty = min(1.0, max(0.0, (vib_rms - 1.0) / (self.trip_threshold_rms - 1.0)))
        # Thermal penalty (nominal ~40C, high > 75C)
        temp_penalty = min(1.0, max(0.0, (temp_c - 40.0) / 40.0))
        composite_damage = 0.7 * vib_penalty + 0.3 * temp_penalty
        return max(0.0, min(1.0, round(1.0 - composite_damage, 3)))

    def _compute_linear_slope(self, values: list[float]) -> float:
        """Ordinary Least Squares (OLS) slope per interval."""
        n = len(values)
        if n < 2:
            return 0.0
        x = list(range(n))
        x_mean = sum(x) / n
        y_mean = sum(values) / n
        numerator = sum((x[i] - x_mean) * (values[i] - y_mean) for i in range(n))
        denominator = sum((x[i] - x_mean) ** 2 for i in range(n))
        if denominator == 0.0:
            return 0.0
        return numerator / denominator

    async def estimate_rul(self, asset_id: str) -> RulEstimate:
        history = await self.telemetry.get_vibration_history(asset_id, limit=30)
        current_rms = await self.telemetry.get_latest_vibration_rms(asset_id)

        # Slope per 10-minute interval converted to slope per hour (x6)
        interval_slope = self._compute_linear_slope(history)
        hourly_degradation = max(0.01, interval_slope * 6.0)

        remaining_headroom = max(0.0, self.trip_threshold_rms - current_rms)
        hours_to_trip = round(remaining_headroom / hourly_degradation, 1)

        estimated_trip = datetime.utcnow() + timedelta(hours=hours_to_trip)
        confidence = 0.92 if len(history) >= 20 else 0.70

        return RulEstimate(
            asset_id=asset_id,
            hours_to_trip=hours_to_trip,
            estimated_trip_time=estimated_trip,
            confidence=confidence,
            degradation_rate_per_hour=round(hourly_degradation, 4),
        )

    async def diagnose_asset(self, asset_id: str) -> AssetDiagnosticReport:
        vib_rms = await self.telemetry.get_latest_vibration_rms(asset_id)
        temp_c = await self.telemetry.get_latest_temperature(asset_id)
        iso_zone = self._classify_iso_zone(vib_rms)
        health_score = self._calculate_health_score(vib_rms, temp_c)
        rul = await self.estimate_rul(asset_id)

        is_imminent = (iso_zone == ISO10816Severity.ZONE_D_UNACCEPTABLE) or (rul.hours_to_trip <= 24.0)

        if is_imminent:
            rec = "IMMEDIATE_MAINTENANCE_REQUIRED: Schedule preventive overhaul to avoid line trip."
        elif iso_zone == ISO10816Severity.ZONE_C_UNSATISFACTORY:
            rec = "SCHEDULE_INSPECTION: Lubricate bearings and inspect alignment at next planned shift change."
        else:
            rec = "NORMAL_OPERATION: Continue condition monitoring."

        bearing_health = BearingHealth(
            asset_id=asset_id,
            vibration_rms=round(vib_rms, 2),
            temperature_c=round(temp_c, 1),
            iso_zone=iso_zone,
            health_score=health_score,
            primary_fault_signature="INNER_RACE_BEARING_WEAR" if vib_rms > 4.5 else None,
        )

        return AssetDiagnosticReport(
            asset_id=asset_id,
            health=bearing_health,
            rul=rul,
            is_trip_imminent=is_imminent,
            recommended_action=rec,
        )
