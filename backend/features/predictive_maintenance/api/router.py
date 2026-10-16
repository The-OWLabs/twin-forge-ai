"""FastAPI router for predictive maintenance endpoints."""
from fastapi import APIRouter, HTTPException
from backend.features.predictive_maintenance.services.maintenance_service import PredictiveMaintenanceService
from backend.features.predictive_maintenance.adapters.mock_telemetry import InMemoryTelemetryReader
from backend.features.predictive_maintenance.domain.models import AssetDiagnosticReport, RulEstimate

router = APIRouter(prefix="/maintenance", tags=["Predictive Maintenance"])

# Singleton wire-up (can also be resolved via DI container)
_telemetry_reader = InMemoryTelemetryReader()
_service = PredictiveMaintenanceService(_telemetry_reader)


@router.get("/diagnostics/{asset_id}", response_model=AssetDiagnosticReport)
async def get_asset_diagnostics(asset_id: str) -> AssetDiagnosticReport:
    """Diagnose an asset's bearing condition, ISO 10816 zone, and failure risk."""
    return await _service.diagnose_asset(asset_id)


@router.get("/rul/{asset_id}", response_model=RulEstimate)
async def get_asset_rul(asset_id: str) -> RulEstimate:
    """Estimate the Remaining Useful Life (RUL) of an asset before trip threshold breach."""
    return await _service.estimate_rul(asset_id)
